// 計算ライブラリと AQL 表の照合ロジック（ブラウザの test.html と Node の test.js で共用）
// 戻り値: [種類, 条件, 計算値, 参照値, 一致したか] の配列
(function (root) {
  'use strict';

  function runChecks(S, T, REFERENCE) {
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
    return rows;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = runChecks;
  else root.runChecks = runChecks;
})(typeof window !== 'undefined' ? window : globalThis);
