// 計算ライブラリと AQL 表の照合ロジック（ブラウザの test.html と Node の test.js で共用）
// 戻り値: [種類, 条件, 計算値, 参照値, 一致したか] の配列。ORIG（MIL-STD-105E 写しの抽出値）を渡すと原本との照合も行う
(function (root) {
  'use strict';

  function runChecks(S, T, REFERENCE, ORIG) {
    const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    const rows = [];

    // scipy で求めた参照値との照合
    for (const r of REFERENCE) {
      let got, exp, ok, cond;
      if (r.kind === 'binom') { got = S.binomCdf(r.c, r.n, r.p); exp = r.v; ok = near(got, exp, 1e-9); cond = `P(X≤${r.c}) n=${r.n} p=${r.p}`; }
      if (r.kind === 'hyper') { got = S.hypergeomCdf(r.c, r.N, r.D, r.n); exp = r.v; ok = near(got, exp, 1e-9); cond = `P(X≤${r.c}) N=${r.N} D=${r.D} n=${r.n}`; }
      if (r.kind === 'pois') { got = S.poissonCdf(r.c, r.lam); exp = r.v; ok = near(got, exp, 1e-9); cond = `P(X≤${r.c}) λ=${r.lam}`; }
      if (r.kind === 'cp') {
        const g = S.clopperPearson(r.x, r.n, r.conf);
        got = [g.lower2, g.upper2, g.upper1].map(v => v.toPrecision(6)).join(' / ');
        exp = [r.lower2, r.upper2, r.upper1].map(v => v.toPrecision(6)).join(' / ');
        ok = near(g.lower2, r.lower2, 1e-7) && near(g.upper2, r.upper2, 1e-7) && near(g.upper1, r.upper1, 1e-7);
        cond = `x=${r.x} n=${r.n} 信頼度${r.conf}`;
      }
      if (r.kind === 'design') {
        const d = S.designPlan(r.p1, r.al, r.p2, r.be);
        got = d.plan ? `n=${d.plan.n} c=${d.plan.c}` : 'なし'; exp = `n=${r.n} c=${r.c}`; ok = got === exp;
        cond = `p1=${r.p1} α=${r.al} p2=${r.p2} β=${r.be}`;
      }
      if (r.kind === 'lot') {
        const j = S.lotJudge(r.N, r.D, r.n, r.c);
        got = [j.pa, j.pFindAny, j.escapePerLot].map(v => v.toPrecision(8)).join(' / ');
        exp = [r.pa, r.find, r.esc].map(v => v.toPrecision(8)).join(' / ');
        ok = near(j.pa, r.pa, 1e-9) && near(j.pFindAny, r.find, 1e-9) && near(j.escapePerLot, r.esc, 1e-9);
        cond = `N=${r.N} D=${r.D} n=${r.n} c=${r.c}（合格確率/発見確率/流出不良）`;
      }
      // 未知の種類が混ざったら不一致として扱う（照合漏れを防ぐ）
      if (cond === undefined) { cond = JSON.stringify(r); got = '―'; exp = '―'; ok = false; }
      rows.push([r.kind, cond, got, exp, ok]);
    }

    // AQL表の既知値（ロットサイズ, 検査水準, AQL, 厳しさ → サンプル文字, n, Ac, Re）
    const known = [
      [1000, 'II', '1.0', 'normal', 'J', 80, 2, 3], [1000, 'II', '2.5', 'normal', 'J', 80, 5, 6],
      [1000, 'II', '0.65', 'normal', 'J', 80, 1, 2], [1000, 'II', '0.40', 'normal', 'J', 125, 1, 2],
      [1000, 'II', '0.25', 'normal', 'J', 50, 0, 1], [1000, 'II', '6.5', 'normal', 'J', 80, 10, 11],
      [100, 'II', '2.5', 'normal', 'F', 20, 1, 2], [5000, 'II', '0.65', 'normal', 'L', 200, 3, 4]
    ];
    for (const [N, lv, a, m, L0, n0, ac0, re0] of known) {
      const ri = T.lotRanges.findIndex(([x, y]) => N >= x && (y === null || N <= y));
      const L = T.codeLetters[ri][T.levels.indexOf(lv)];
      const [n, ac, re] = T.plans[m][T.letters.indexOf(L)][T.aql.indexOf(a)];
      const got = `${L} ${n} ${ac}/${re}`, exp = `${L0} ${n0} ${ac0}/${re0}`;
      rows.push(['AQL表', `N=${N} ${lv} AQL${a} ${m}`, got, exp, got === exp]);
    }
    if (ORIG) rows.push(...checkOriginal(T, ORIG));
    return rows;
  }

  // MIL-STD-105E の判読用写し（mil105e-legible.js）と AQL 表の全セルを照合する。
  // 写しには転記の誤りが見つかっているので、次の訂正を当ててから照合する（訂正した件数も検査する）
  //   - 表II-A：「44 65」と印字されたセル（矢印で参照されるセルを含めて 54 セル）→ Re は 45。
  //     一回抜取のなみ検査は常に Re = Ac + 1 で、同じ列の他の行もすべて「44 45」
  //   - 表I ロットサイズ 51〜90：写しは次の行（91〜150）と同じ並びになっている → B B C C C E F
  //   - 表I ロットサイズ 501〜1200 の水準 III：写しは H（前後の行 J→L と単調にならない）→ K
  const ERRATA_44_65 = 54;
  const ERRATA_TABLE1 = { 4: 'BBCCCEF', 8: 'CCEFGJK' };

  function checkOriginal(T, O) {
    const rows = [];
    let fixed = 0;
    for (const m of ['normal', 'tightened', 'reduced']) {
      const bad = [];
      T.letters.forEach((L, li) => T.aql.forEach((a, ai) => {
        let exp = O.plans[m][L] && O.plans[m][L][ai];
        if (exp && m === 'normal' && exp[1] === 44 && exp[2] === 65) { exp = [exp[0], 44, 45]; fixed++; }
        const got = T.plans[m][li][ai];
        if (JSON.stringify(got) !== JSON.stringify(exp)) bad.push(`${L}/${a}: 表 ${JSON.stringify(got)} 原本 ${JSON.stringify(exp)}`);
      }));
      const total = T.letters.length * T.aql.length;
      rows.push(['原本照合', `表II-${{ normal: 'A なみ', tightened: 'B きつい', reduced: 'C ゆるい' }[m]} 全セル`,
        bad.length ? bad.join(' ; ') : `${total} セル一致`, `${total} セル`, bad.length === 0]);
    }
    rows.push(['原本照合', '写しの「44 65」を訂正したセル数', String(fixed), String(ERRATA_44_65), fixed === ERRATA_44_65]);
    const bad1 = [];
    T.codeLetters.forEach((code, i) => {
      const exp = ERRATA_TABLE1[i] !== undefined ? ERRATA_TABLE1[i] : O.codeLetters[i];
      if (code !== exp) bad1.push(`${T.lotRanges[i].join('〜')}: 表 ${code} 原本 ${exp}`);
    });
    // 訂正箇所の写しの値が想定どおり（写しが変わったら訂正の前提を見直す）
    const errOk = O.codeLetters[4] === 'BBCDDFG' && O.codeLetters[8] === 'CCEFGJH';
    rows.push(['原本照合', '表I サンプル文字 全行', bad1.length ? bad1.join(' ; ') : `${T.codeLetters.length} 行一致`,
      `${T.codeLetters.length} 行（写しの誤り2行を訂正）`, bad1.length === 0 && errOk && O.codeLetters.length === T.codeLetters.length]);
    return rows;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = runChecks;
  else root.runChecks = runChecks;
})(typeof window !== 'undefined' ? window : globalThis);
