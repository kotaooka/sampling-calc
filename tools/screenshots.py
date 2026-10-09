# README 用スクリーンショット（docs/screenshots/*.png）を撮り直す
#
# Google Fonts が読めない環境で撮ると BIZ UDPゴシックが当たらず、中国語字形などの代替フォントで写る。
# これを防ぐため、Google Fonts への要求を fontsource のローカルファイルに差し替え、
# 読み込みを確認してから撮影する（読めていなければ中断）。
#
# 準備（任意の作業フォルダで）:
#   npm pack @fontsource/biz-udpgothic @fontsource/ibm-plex-mono
#   上の2つの .tgz を展開（tar -xzf <ファイル> --one-top-level）
#   pip install playwright && python -m playwright install chromium
# 実行:
#   python tools/screenshots.py <フォント展開先フォルダ>
#   （Chromium の場所を指定する場合は環境変数 CHROME_PATH）
import os, pathlib, sys
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
FONTS = pathlib.Path(sys.argv[1])
OUT = REPO / "docs/screenshots"
BIZ = next(FONTS.glob("fontsource-biz-udpgothic-*/package/files"))
PLEX = next(FONTS.glob("fontsource-ibm-plex-mono-*/package/files"))

# Google Fonts の CSS を fontsource の CSS（unicode-range 分割済み）に差し替え、ローカルのファイルを返す
def _css(pkg, name, tag):
    return (pkg.parent / name).read_text(encoding="utf-8").replace("./files/", f"https://fonts.gstatic.com/local/{tag}/")
CSS = _css(BIZ, "400.css", "biz") + _css(BIZ, "700.css", "biz") + _css(PLEX, "500.css", "plex")
DIRS = {"biz": BIZ, "plex": PLEX}

def route_fonts(route):
    url = route.request.url
    if "fonts.googleapis.com" in url:
        route.fulfill(status=200, content_type="text/css", body=CSS)
    elif "fonts.gstatic.com/local/" in url:
        tag, name = url.split("/local/", 1)[1].split("/", 1)
        ctype = "font/woff2" if name.endswith("woff2") else "font/woff"
        route.fulfill(status=200, content_type=ctype, body=(DIRS[tag] / name).read_bytes(),
                      headers={"Access-Control-Allow-Origin": "*"})
    else:
        route.continue_()

def open_page(browser, url, **ctx):
    c = browser.new_context(service_workers="block", **ctx)
    p = c.new_page()
    p.route("**/*", route_fonts)
    p.goto(url)
    p.wait_for_load_state("networkidle")
    # フォントが実際に使われているか確認（読めていなければ中断）
    ok = p.evaluate("""async () => { await document.fonts.ready;
        return [document.fonts.check("15px 'BIZ UDPGothic'", "合格率"),
                document.fonts.check("15px 'IBM Plex Mono'", "96.1")]; }""")
    assert all(ok), f"フォント未読込: {ok}"
    return c, p

def show_tab(p, tab):
    p.click(f'nav.tabs button[data-tab="{tab}"]')
    p.wait_for_timeout(500)
    p.evaluate("document.fonts.ready")

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    url = (REPO / "index.html").as_uri()

    # デスクトップ（ライト）：各タブの全体
    c, p = open_page(b, url, viewport={"width": 1008, "height": 800}, color_scheme="light")
    for tab in ["lot", "aql", "oc", "design", "est"]:
        show_tab(p, tab)
        p.evaluate("window.scrollTo(0,0)")
        p.screenshot(path=str(OUT / f"{tab}.png"), full_page=True)
    c.close()

    # スマホ（ダーク）：合格率タブの先頭
    c, p = open_page(b, url, viewport={"width": 390, "height": 844}, device_scale_factor=2,
                     is_mobile=True, has_touch=True, color_scheme="dark")
    show_tab(p, "lot")
    # 結果カード（合格する確率）がヘッダー直下に来るまでスクロール
    p.evaluate("""() => { const h = document.querySelector('header.top').getBoundingClientRect().height;
        const el = [...document.querySelectorAll('#p-lot *')].filter(e => e.offsetParent && e.children.length === 0 && e.textContent.trim() === 'このロットが合格する確率')[0];
        const card = el.closest('.card') || el.parentElement;
        window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - h - 12); }""")
    p.wait_for_timeout(300)
    p.screenshot(path=str(OUT / "mobile.png"))
    c.close()
    b.close()
print("done")
