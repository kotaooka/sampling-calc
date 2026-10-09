// 抜取検査の統計計算（ブラウザ・Node 共通）
// 依存ライブラリなし。確率は対数で計算して大きな n でも桁あふれしないようにしている
(function (root) {
  'use strict';

  // ---- 基本関数 ----

  // 対数ガンマ関数（Lanczos 近似、相対誤差 1e-15 程度）
  const LG = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += LG[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  // log C(n, k)
  function lchoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  }
  // 対数の和を安定に足し合わせる
  function logSumExp(arr) {
    let m = -Infinity;
    for (const v of arr) if (v > m) m = v;
    if (m === -Infinity) return -Infinity;
    let s = 0;
    for (const v of arr) s += Math.exp(v - m);
    return m + Math.log(s);
  }
  const clamp01 = v => Math.min(1, Math.max(0, v));

  // ---- 分布の累積確率 P(X <= c) ----

  // 二項分布: n 個中の不良数 X ~ Bin(n, p)
  function binomCdf(c, n, p) {
    if (c < 0) return 0;
    if (c >= n) return 1;
    if (p <= 0) return 1;
    if (p >= 1) return 0;
    const lp = Math.log(p), lq = Math.log1p(-p);
    const terms = [];
    for (let d = 0; d <= c; d++) terms.push(lchoose(n, d) + d * lp + (n - d) * lq);
    return clamp01(Math.exp(logSumExp(terms)));
  }

  // 超幾何分布: ロット N 個中に不良 D 個、そこから n 個抜き取ったときの不良数
  function hypergeomCdf(c, N, D, n) {
    if (c < 0) return 0;
    const lo = Math.max(0, n - (N - D)), hi = Math.min(n, D);
    if (c >= hi) return 1;
    if (c < lo) return 0;
    const base = lchoose(N, n);
    const terms = [];
    for (let d = lo; d <= c; d++) terms.push(lchoose(D, d) + lchoose(N - D, n - d) - base);
    return clamp01(Math.exp(logSumExp(terms)));
  }

  // ポアソン分布: 平均 λ
  function poissonCdf(c, lambda) {
    if (c < 0) return 0;
    if (lambda <= 0) return 1;
    const terms = [];
    const ll = Math.log(lambda);
    for (let d = 0; d <= c; d++) terms.push(-lambda + d * ll - lgamma(d + 1));
    return clamp01(Math.exp(logSumExp(terms)));
  }

  // ---- 確率質量関数 P(X = d) ----
  function hypergeomPmf(d, N, D, n) {
    const lo = Math.max(0, n - (N - D)), hi = Math.min(n, D);
    if (d < lo || d > hi) return 0;
    return Math.exp(lchoose(D, d) + lchoose(N - D, n - d) - lchoose(N, n));
  }
  function binomPmf(d, n, p) {
    if (d < 0 || d > n) return 0;
    if (p <= 0) return d === 0 ? 1 : 0;
    if (p >= 1) return d === n ? 1 : 0;
    return Math.exp(lchoose(n, d) + d * Math.log(p) + (n - d) * Math.log1p(-p));
  }

  // ロット内の不良数 D が分かっているときの判定シミュレーション（超幾何分布、厳密）
  // 戻り値: 抜取中の不良数の分布、合格確率、不良を1個以上見つける確率、
  //         合格して出荷されるロットに残る不良数の期待値（1ロット当たり）
  function lotJudge(N, D, n, c) {
    const lo = Math.max(0, n - (N - D)), hi = Math.min(n, D);
    const pmf = [];
    let pa = 0, eXacc = 0;
    for (let d = 0; d <= hi; d++) {
      const v = d < lo ? 0 : hypergeomPmf(d, N, D, n);
      pmf.push(v);
      if (d <= c) { pa += v; eXacc += d * v; }
    }
    pa = clamp01(pa);
    return {
      pmf, pa,
      pFindAny: 1 - (pmf[0] || 0),
      mean: n * D / N,
      // 合格ロットに残る不良: D − X（X ≤ c のとき）の期待値
      escapePerLot: pa * D - eXacc
    };
  }

  // ---- 合格確率 ----
  // plan: {n, c, N?}、dist: 'binomial' | 'hypergeometric' | 'poisson'
  // p は不良率（0〜1）。ポアソンのときは 1 単位当たりの欠点数として扱う
  function pAccept(p, plan, dist) {
    const { n, c, N } = plan;
    if (dist === 'hypergeometric') {
      // 不良数 D は整数なので、p×N の前後の整数で線形補間する
      const x = p * N, D0 = Math.floor(x), D1 = Math.min(N, D0 + 1), w = x - D0;
      const a = hypergeomCdf(c, N, D0, n);
      if (w === 0 || D0 === D1) return a;
      return a * (1 - w) + hypergeomCdf(c, N, D1, n) * w;
    }
    if (dist === 'poisson') return poissonCdf(c, n * p);
    return binomCdf(c, n, p);
  }

  // 分布の自動選択: N があり n/N > 0.1 なら超幾何、それ以外は二項
  function autoDist(plan) {
    if (plan.N && plan.n / plan.N > 0.1) return 'hypergeometric';
    return 'binomial';
  }

  // AOQ（平均出検品質）: 不合格ロットは全数選別して不良を良品に置き換える前提
  function aoq(p, plan, dist) {
    const pa = pAccept(p, plan, dist);
    if (!plan.N) return pa * p;
    return pa * p * (plan.N - plan.n) / plan.N;
  }
  // ATI（平均総検査数）: 同じ前提。N が必要
  function ati(p, plan, dist) {
    const pa = pAccept(p, plan, dist);
    return plan.n + (1 - pa) * (plan.N - plan.n);
  }

  // Pa = target となる不良率を二分法で求める（Pa は p に対して単調減少）
  function pAtPa(target, plan, dist, pMax) {
    let lo = 0, hi = pMax || 1;
    if (pAccept(hi, plan, dist) > target) return NaN;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (pAccept(mid, plan, dist) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // 曲線上の点列と、AOQL（AOQ の最大値）
  function curve(plan, dist, pMax, steps) {
    steps = steps || 240;
    const pts = [];
    let aoql = 0, aoqlP = 0;
    for (let i = 0; i <= steps; i++) {
      const p = pMax * i / steps;
      const pa = pAccept(p, plan, dist);
      const q = plan.N ? pa * p * (plan.N - plan.n) / plan.N : pa * p;
      const t = plan.N ? plan.n + (1 - pa) * (plan.N - plan.n) : NaN;
      if (q > aoql) { aoql = q; aoqlP = p; }
      pts.push({ p, pa, aoq: q, ati: t });
    }
    // 最大値付近を細かく探索し直す
    const h = pMax / steps;
    let a = Math.max(0, aoqlP - h), b = Math.min(pMax, aoqlP + h);
    for (let i = 0; i < 80; i++) {
      const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
      if (aoq(m1, plan, dist) < aoq(m2, plan, dist)) a = m1; else b = m2;
    }
    const pStar = (a + b) / 2;
    return { pts, aoql: aoq(pStar, plan, dist), aoqlP: pStar };
  }

  // ---- 逆設計 ----
  // 条件: Pa(p1) >= 1 - alpha かつ Pa(p2) <= beta を満たす、n 最小の (n, c)
  // N を与えると超幾何で評価する（n <= N）
  function designPlan(p1, alpha, p2, beta, N, maxC) {
    maxC = maxC == null ? 60 : maxC;
    const dist = N ? 'hypergeometric' : 'binomial';
    const nCap = N || 100000;
    const results = [];
    for (let c = 0; c <= maxC; c++) {
      // Pa(p2) は n に対して単調減少なので、二分法で Pa(p2) <= beta となる最小 n を探す
      if (c + 1 > nCap) break;
      let lo = c + 1, hi = c + 1;
      const pa2 = n => pAccept(p2, { n, c, N }, dist);
      while (hi < nCap && pa2(hi) > beta) { lo = hi + 1; hi = Math.min(nCap, hi * 2); }
      if (pa2(hi) > beta) continue;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (pa2(mid) <= beta) hi = mid; else lo = mid + 1;
      }
      const n = hi;
      const pa1 = pAccept(p1, { n, c, N }, dist);
      const row = { n, c, pa1, pa2: pa2(n), ok: pa1 >= 1 - alpha };
      results.push(row);
      if (row.ok) return { plan: row, tried: results, dist };
    }
    return { plan: null, tried: results, dist };
  }

  // c = 0 方式: Pa(p2) <= beta となる最小 n
  function zeroAcceptN(p2, beta, N) {
    const r = designPlan(0, 1, p2, beta, N, 0);
    return r.tried.length ? r.tried[0] : null;
  }

  // ---- 不完全ベータ関数（Clopper-Pearson 用） ----
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // 正則化不完全ベータ関数 I_x(a, b)
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
    if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
    return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
  }
  // I_x(a, b) = q となる x（二分法）
  function ibetaInv(q, a, b) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (ibeta(mid, a, b) < q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- 不良率の区間推定 ----
  // n 個検査して x 個不良。conf は信頼度（0.95 など）
  function clopperPearson(x, n, conf) {
    const a = 1 - conf;
    const lower2 = x === 0 ? 0 : ibetaInv(a / 2, x, n - x + 1);
    const upper2 = x === n ? 1 : ibetaInv(1 - a / 2, x + 1, n - x);
    const upper1 = x === n ? 1 : ibetaInv(conf, x + 1, n - x);
    return { point: x / n, lower2, upper2, upper1 };
  }

  // 有限母集団（ロット N 個）での不良数 D の片側上限
  // P(X <= x | D) >= 1 - conf を満たす最大の D
  function lotUpperDefects(x, n, N, conf) {
    const a = 1 - conf;
    let lo = x, hi = N - (n - x);
    // P(X<=x|D) は D に対して単調減少
    if (hypergeomCdf(x, N, hi, n) >= a) return hi;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (hypergeomCdf(x, N, mid, n) >= a) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  const api = {
    lgamma, lchoose, binomCdf, hypergeomCdf, poissonCdf, hypergeomPmf, binomPmf, lotJudge, pAccept, autoDist,
    aoq, ati, pAtPa, curve, designPlan, zeroAcceptN, ibeta, ibetaInv,
    clopperPearson, lotUpperDefects
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SampStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
