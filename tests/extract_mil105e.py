# MIL-STD-105E の PDF（テキスト付きの判読用写し "legible copy"）から
# 表I（サンプル文字）と表II-A/B/C（一回抜取方式）を読み取り、tests/mil105e-legible.js に書き出す。
#
#   pip install pymupdf
#   python tests/extract_mil105e.py MIL_STD_105E_legible_copy.pdf
#
# 読み取り方法
#   - 数字（Ac Re・サンプルサイズ）は PDF のテキスト層から座標つきで取り出し、
#     見出しの AQL の x 座標と行ラベル（A〜S）の y 座標で表のセルに割り当てる
#   - 矢印は PDF のベクター図形（軸の線＋三角の矢じり）から取り出し、矢じりの頂点の位置で向きを決める。
#     軸の両端に矢じりがある図形（↕）は、上のセルの↑と下のセルの↓が接して描かれたものとして中点で分ける
#   - 空欄は「矢印の向きに進み、最初に当たった方式を使う」（規格の表の注記どおり）で解決する
# PDF のページ番号（1始まり）は、この写しでは表I=17、表II-A=18、表II-B=19、表II-C=20
import json, re, sys
from pathlib import Path
import pymupdf

AQL = ["0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5", "4.0",
       "6.5", "10", "15", "25", "40", "65", "100", "150", "250", "400", "650", "1000"]
LET = list("ABCDEFGHJKLMNPQRS")
PAGES = {'normal': 18, 'tightened': 19, 'reduced': 20}


def words(page):
    # 表示（回転後）の座標で単語を返す
    M = page.rotation_matrix
    out = []
    for x0, y0, x1, y1, t, *_ in page.get_text('words'):
        r = pymupdf.Rect(x0, y0, x1, y1) * M
        out.append((r.x0, r.y0, r.x1, r.y1, t))
    return out


def vec_arrows(page):
    M = page.rotation_matrix
    shafts, heads = [], []
    for dr in page.get_drawings():
        it = dr['items']
        if dr['type'] == 's' and len(it) == 1 and it[0][0] == 'l':
            shafts.append((it[0][1] * M, it[0][2] * M))
        if dr['type'] == 'f' and len(it) == 2 and all(i[0] == 'l' for i in it):
            heads.append([it[0][1] * M, it[0][2] * M, it[1][2] * M])

    def touching(x, y):
        res = []
        for h in heads:
            xs = [q.x for q in h]; ys = sorted(q.y for q in h)
            if min(xs) - 1 <= x <= max(xs) + 1 and ys[0] - 2 <= y <= ys[2] + 2:
                # 頂点＝他の2点から y が離れている点。下にあれば下向き
                res.append(('down' if (ys[2] - ys[1]) > (ys[1] - ys[0]) else 'up', ys[0], ys[2]))
        return res

    arrows = []
    for a, b in shafts:
        x = (a.x + b.x) / 2; y0, y1 = sorted([a.y, b.y])
        up = [h for h in touching(x, y0) if h[0] == 'up' and h[1] <= y0 + 2]
        dn = [h for h in touching(x, y1) if h[0] == 'down' and h[2] >= y1 - 2]
        if not (up or dn): raise ValueError(f'矢じりのない軸 x={x:.1f} y={y0:.1f}-{y1:.1f}')
        if up and dn:
            top, bot = min(h[1] for h in up), max(h[2] for h in dn); mid = (top + bot) / 2
            arrows += [{'x': x, 'top': top, 'bot': mid, 'dir': 'up'}, {'x': x, 'top': mid, 'bot': bot, 'dir': 'down'}]
        elif up:
            arrows.append({'x': x, 'top': min(h[1] for h in up), 'bot': y1, 'dir': 'up'})
        else:
            arrows.append({'x': x, 'top': y0, 'bot': max(h[2] for h in dn), 'dir': 'down'})
    return arrows


def table2(page, log):
    W = words(page)
    hy = min(w[1] for w in W if w[4] == '0.010')
    cols = {w[4]: (w[0] + w[2]) / 2 for w in W if abs(w[1] - hy) < 1 and w[4] in AQL}
    cx = [cols[a] for a in AQL]
    rows = {w[4]: ((w[1] + w[3]) / 2, w) for w in W if w[0] < 40 and w[1] > 140 and w[4] in LET}
    letters = [l for l in LET if l in rows]
    ry = [rows[l][0] for l in letters]
    # サンプルサイズ列（行ラベルと同じ高さの数字）
    nsize = {}
    for w in W:
        if 50 < w[0] < 75 and w[4].isdigit():
            for l in letters:
                if abs(rows[l][1][1] - w[1]) < 1: nsize[l] = int(w[4])
    bounds = [((ry[i - 1] + y) / 2 if i else y - 8, (y + ry[i + 1]) / 2 if i + 1 < len(ry) else y + 8) for i, y in enumerate(ry)]
    grid = {}
    for w in W:
        if w[0] > 78 and ry[0] - 10 < w[1] < ry[-1] + 10 and re.fullmatch(r'\d+', w[4]):
            xc, yc = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
            j = min(range(26), key=lambda k: abs(cx[k] - xc))
            i = next(k for k, (t, b) in enumerate(bounds) if t <= yc < b)
            grid.setdefault((i, j), []).append((xc, int(w[4])))
    cells = {}
    for (i, j), v in grid.items():
        v.sort()
        if len(v) != 2: raise ValueError(f'Ac Re が対になっていない {letters[i]} {AQL[j]} {v}')
        cells[(i, j)] = (v[0][1], v[1][1])
    # 空欄の矢印：行の高さの3割以上かかっている矢印のうち、最も多くかかっているもの
    av = vec_arrows(page); half = (cx[1] - cx[0]) / 2
    arr = {}
    for i, (t, b) in enumerate(bounds):
        for j, x in enumerate(cx):
            if (i, j) in cells: continue
            ov = lambda a: min(a['bot'], b) - max(a['top'], t)
            hit = [a for a in av if abs(a['x'] - x) < half and ov(a) > 0.3 * (b - t)]
            if hit: arr[(i, j)] = max(hit, key=ov)['dir']
    out = {}
    for i, L in enumerate(letters):
        if L == 'S': continue  # S（3150）は矢印の行き先としてだけ使う
        row = []
        for j in range(26):
            if (i, j) in cells:
                row.append([nsize[L], *cells[(i, j)]]); continue
            d = arr.get((i, j))
            if d is None:
                # 矢じりの先端が手前の行で止まっている描画のずれ。上が↓なら↓、下が↑なら↑とみなす
                d = 'down' if arr.get((i - 1, j)) == 'down' else 'up' if arr.get((i + 1, j)) == 'up' else None
                log.append(f'矢印なしの空欄を {d} とみなした: {L} AQL {AQL[j]}')
            k = i
            while d:
                k += 1 if d == 'down' else -1
                if not 0 <= k < len(letters): raise ValueError(f'矢印の先に方式がない {L} {AQL[j]}')
                if (k, j) in cells: break
            if not d: raise ValueError(f'解決できない空欄 {L} {AQL[j]}')
            row.append([nsize[letters[k]], *cells[(k, j)]])
        out[L] = row
    return out


def table1(page):
    rows = []
    # 行ごとに「下限 To 上限 文字×7」または「下限 And Over 文字×7」を拾う
    W = words(page)
    lines = {}
    for w in W: lines.setdefault(round(w[1]), []).append(w)
    for y in sorted(lines):
        t = [w[4] for w in sorted(lines[y])]
        if len(t) == 10 and t[0].isdigit() and t[1] in ('To', 'And'):
            rows.append(''.join(t[3:]))
    return rows


if __name__ == '__main__':
    doc = pymupdf.open(sys.argv[1])
    log = []
    data = {'source': 'MIL-STD-105E（1989-05-10）判読用写し（テキスト層つきPDF）から tests/extract_mil105e.py で抽出',
            'codeLetters': table1(doc[16]),
            'plans': {name: table2(doc[pg - 1], log) for name, pg in PAGES.items()}}
    for m in log: print(m)
    js = ('// MIL-STD-105E 判読用写しから抽出した表I・表II-A/B/C（extract_mil105e.py で再生成）\n'
          '// plans[厳しさ][サンプル文字] = AQL 26列ぶんの [n, Ac, Re]（矢印は解決済み）\n'
          'const MIL105E_LEGIBLE = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
          "if (typeof module !== 'undefined') module.exports = MIL105E_LEGIBLE;\n")
    (Path(__file__).parent / 'mil105e-legible.js').write_text(js, encoding='utf-8', newline='\n')
    print('表I', len(data['codeLetters']), '行 / 表II', {k: len(v) for k, v in data['plans'].items()}, '行')
