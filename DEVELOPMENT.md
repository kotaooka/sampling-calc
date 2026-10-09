# 開発者向け情報（sampling-calc）

利用者向けの説明は [README.md](README.md) にあります。

## ファイル構成

```
README.md             利用者向けの説明
DEVELOPMENT.md        この文書
index.html            画面
manifest.webmanifest  アプリとして入れるための設定
sw.js                 オフライン用のキャッシュ処理（Service Worker）
icons/                アプリアイコン
js/app.js             画面処理・グラフ描画
js/stats.js           統計計算（外部ライブラリなし。Node でも読み込み可）
js/aql-table.js       MIL-STD-105E の表データ
tests/                計算の照合テスト（test.js / test.html / check.js / reference.js）と原本の抽出値（mil105e-legible.js / extract_mil105e.py）
.github/workflows/     push 時の自動テスト
docs/screenshots/     README 用のスクリーンショット
tools/screenshots.py  スクリーンショットの撮影スクリプト
```

## 更新して公開するとき

`index.html`・`js/`・`icons/` を変更したら、**`sw.js` 先頭の `VERSION` を必ず上げてから** push してください。上げないと、すでに使っている人の端末に古いファイルが残り続けます。

画面の見た目を変えたときは、`docs/screenshots/` の画像も撮り直してください（README に載せています）。撮影は `tools/screenshots.py` で行います（準備手順はファイル先頭に記載）。Google Fonts が読めない状態で撮ると日本語が代替フォント（中国語字形など）で写るため、このスクリプトはフォントをローカルから読み込み、読めていなければ中断します。

ファイルを直接開いた場合（file://）はオフライン機能が動きません（計算は動きます）。

## 計算方法

| 項目 | 方法 |
|---|---|
| 合格率タブ | 超幾何分布による厳密計算（ロット内不良数は 不良率 × N を四捨五入した整数） |
| OC曲線 | 「自動」では n/N > 0.1 のとき超幾何分布、それ以外は二項分布。AQL が 10 を超える場合は 100 単位当たり欠点数としてポアソン分布 |
| AOQ・ATI | 不合格ロットを全数選別し、不良品を良品に置き換える前提 |
| 不良率推定 | Clopper-Pearson 法（正確法） |

超幾何分布の OC 曲線では、ロット内不良数 p × N が整数にならない点を、前後の整数での値から線形補間しています。

## AQL 表のデータ

- 出典：MIL-STD-105E（1989-05-10）表I・表II-A/B/C、DTIC ADA284013（Distribution Statement A、配布制限なし）
- `js/aql-table.js` に、矢印を読み替え済みの [サンプル数, 合格判定個数, 不合格判定個数] で格納しています
- なみ検査は、表の対角構造から独立に組んだ値と全 416 セルを照合し、一致を確認しています。きつい検査・ゆるい検査の値は R パッケージ AQLSchemes 1.7-2 から取りました
- 原本との照合：MIL-STD-105E の判読用写し（テキスト層つき PDF）から `tests/extract_mil105e.py` で表I・表II-A/B/C を機械的に抽出し（`tests/mil105e-legible.js`）、表I 全 15 行と表II-A/B/C の全 1,248 セル（3表 × 16 文字 × 26 AQL、矢印は読み替え後）が一致することをテストで確認しています
- 写しには転記の誤りが3種類あり、テストでは訂正してから照合しています（`tests/check.js` に根拠つきで記載）
  - 表II-A の「44 65」（正しくは 44 45。なみ検査の一回抜取は常に Re = Ac + 1）
  - 表I 51〜90 の行（次の行と同じ並びになっている。正しくは B B C C C E F）
  - 表I 501〜1200 の水準 III（H になっている。正しくは K）
- 抽出のやり直し：`pip install pymupdf` のうえ `python tests/extract_mil105e.py <PDF>`。数字はテキスト層の座標から、矢印は PDF のベクター図形（軸＋矢じり）から読み取ります

## テスト

計算結果を scipy で求めた参照値と、AQL 表を MIL-STD-105E の写しから抽出した値（全セル）と照合します。照合ロジックは `tests/check.js` にまとめてあり、次の2通りで実行できます。

```
node tests/test.js            # 不一致があれば終了コード 1
python tests/make_reference.py  # 参照値 tests/reference.js を作り直す（scipy が必要）
```

`tests/test.html` をブラウザで開くと、同じ照合の結果を一覧で表示します。

push すると GitHub Actions（`.github/workflows/test.yml`）で、コミット済みの参照値との照合と、最新の scipy で参照値を作り直したうえでの照合が自動で実行されます。
