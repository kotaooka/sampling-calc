// 抜取検査計算機の画面処理
(function () {
  'use strict';
  const T = window.AQL_TABLE || AQL_TABLE;
  const S = window.SampStats;
  const $ = id => document.getElementById(id);
  const embedded = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  // ---------- 表示用の書式 ----------
  const fmtInt = v => Number(v).toLocaleString('ja-JP');
  // 有効数字3桁。指数表記は避ける
  function sig3(v) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a < 1e-4) return v.toExponential(2);
    const d = Math.max(0, 2 - Math.floor(Math.log10(a)));
    return Number(v.toFixed(Math.min(d, 8))).toLocaleString('ja-JP', { maximumFractionDigits: Math.min(d, 8) });
  }
  const pct = p => sig3(p * 100) + ' %';
  // 確率の表示。0 % や 100 % に丸めて誤解させないよう、端では桁を増やす
  const prob = p => {
    const v = p * 100;
    if (v > 0 && v < 0.1) return v < 0.001 ? '< 0.001 %' : v.toFixed(3) + ' %';
    if (v > 99.9 && v < 100) return v > 99.999 ? '> 99.999 %' : v.toFixed(3) + ' %';
    return v.toFixed(1) + ' %';
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => `<span class="num">${v}</span>`;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 1800);
  }
  function copyText(text, done) {
    const fallback = () => {
      const ta = $('clip'); ta.value = text; ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      toast(ok ? done : 'コピーできなかった。表示されたテキストを手動でコピーしてほしい');
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    } catch (e) { fallback(); }
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const SERIES = ['--s1', '--s2', '--s3'];

  // ---------- グラフ ----------
  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const s = niceStep(v, 5);
    return Math.ceil(v / s - 1e-9) * s;
  }
  // opts: {series:[{name, pts:[[x,y]], color}], xMax, yMax, xFmt, yFmt, xTitle, yTitle, markers, vlines, tipX, tipY}
  function drawChart(host, opts) {
    const W = Math.round(Math.max(320, Math.min(720, host.clientWidth || 640))), H = W < 500 ? 250 : 300, m = { l: 52, r: 16, t: 16, b: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = x => m.l + (x / opts.xMax) * pw;
    const Y = y => m.t + ph - (y / opts.yMax) * ph;
    const c = { ink: cssVar('--ink'), ink2: cssVar('--ink2'), muted: cssVar('--muted'), grid: cssVar('--grid'), surface: cssVar('--surface'), line: cssVar('--line') };
    const xs = niceStep(opts.xMax, 5), ys = niceStep(opts.yMax, 5);
    let g = '';
    for (let v = 0; v <= opts.yMax + 1e-12; v += ys) {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c.grid}" stroke-width="1"/>`;
      g += `<text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${c.muted}">${opts.yFmt(v)}</text>`;
    }
    for (let v = 0; v <= opts.xMax + 1e-12; v += xs) {
      g += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="${c.line}"/>`;
      g += `<text x="${X(v)}" y="${m.t + ph + 18}" text-anchor="middle" font-size="11" fill="${c.muted}">${opts.xFmt(v)}</text>`;
    }
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${c.line}"/>`;
    g += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="${c.ink2}">${esc(opts.xTitle)}</text>`;
    g += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11.5" fill="${c.ink2}">${esc(opts.yTitle)}</text>`;
    for (const v of opts.vlines || []) {
      if (v.x > opts.xMax) continue;
      g += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${m.t + ph}" stroke="${c.muted}" stroke-dasharray="4 4"/>`;
      g += `<text x="${X(v.x) + 5}" y="${m.t + ph - 6}" font-size="11" fill="${c.ink2}">${esc(v.label)}</text>`;
    }
    opts.series.forEach(s => {
      const col = s.color;
      const d = s.pts.filter(p => p[0] <= opts.xMax + 1e-12).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(2)} ${Y(Math.min(p[1], opts.yMax)).toFixed(2)}`).join('');
      g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    for (const mk of opts.markers || []) {
      if (mk.x > opts.xMax) continue;
      const cx = X(mk.x), cy = Y(mk.y);
      if (mk.cross) {
        g += `<path d="M${cx - 6} ${cy - 6}L${cx + 6} ${cy + 6}M${cx + 6} ${cy - 6}L${cx - 6} ${cy + 6}" stroke="${c.ink}" stroke-width="2"/>`;
      } else {
        g += `<circle cx="${cx}" cy="${cy}" r="5" fill="${mk.color || c.ink}" stroke="${c.surface}" stroke-width="2"/>`;
      }
      const right = cx < m.l + pw * 0.62;
      g += `<text x="${cx + (right ? 10 : -10)}" y="${cy + (mk.dy || -8)}" text-anchor="${right ? 'start' : 'end'}" font-size="11" fill="${c.ink}">${esc(mk.label)}</text>`;
    }
    // ホバー用
    g += `<line class="hx" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="${c.muted}" stroke-width="1" visibility="hidden"/>`;
    opts.series.forEach((s, i) => { g += `<circle class="hd" data-i="${i}" r="4.5" fill="${s.color}" stroke="${c.surface}" stroke-width="2" visibility="hidden"/>`; });
    g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.yTitle)}のグラフ" font-family="${esc(cssVar('--f-ui'))}" style="background:${c.surface}">${g}</svg><div class="tip" hidden></div>`;

    const svg = host.querySelector('svg'), tip = host.querySelector('.tip'), hit = svg.querySelector('.hit');
    const hx = svg.querySelector('.hx'), dots = svg.querySelectorAll('.hd');
    const interp = (pts, x) => {
      if (!pts.length) return NaN;
      let lo = 0, hi = pts.length - 1;
      if (x <= pts[0][0]) return pts[0][1];
      if (x >= pts[hi][0]) return pts[hi][1];
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= x) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[hi];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    };
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * W / r.width;
      const x = Math.max(0, Math.min(opts.xMax, (sx - m.l) / pw * opts.xMax));
      hx.setAttribute('x1', X(x)); hx.setAttribute('x2', X(x)); hx.setAttribute('visibility', 'visible');
      let html = `<div>${esc(opts.tipX(x))}</div>`;
      opts.series.forEach((s, i) => {
        const y = interp(s.pts, x);
        dots[i].setAttribute('cx', X(x)); dots[i].setAttribute('cy', Y(Math.min(y, opts.yMax)));
        dots[i].setAttribute('visibility', isFinite(y) ? 'visible' : 'hidden');
        html += `<div><span class="sw" style="background:${s.color}"></span>${esc(s.name)}: <b class="num">${esc(opts.tipY(y))}</b></div>`;
      });
      tip.innerHTML = html; tip.hidden = false;
      const px = (X(x) / W) * r.width, hr = host.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let left = px + 12;
      if (left + tw > hr.width) left = px - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = '8px';
    };
    const leave = () => { tip.hidden = true; hx.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
    return svg;
  }

  // 棒グラフ（抜取中の不良数の分布、c ごとの必要サンプル数など）
  // opts: {bars:[{label, y, color, tip}], yMax, yFmt, xTitle, yTitle, divider:{after, left, right}, valueFmt, showValues}
  function drawBars(host, opts) {
    const W = Math.round(Math.max(320, Math.min(720, host.clientWidth || 640))), H = W < 500 ? 230 : 270;
    const m = { l: 52, r: 12, t: 26, b: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const c = { ink: cssVar('--ink'), ink2: cssVar('--ink2'), muted: cssVar('--muted'), grid: cssVar('--grid'), surface: cssVar('--surface'), line: cssVar('--line') };
    const k = opts.bars.length, slot = pw / k, bw = Math.max(2, Math.min(44, slot - 2));
    const Y = y => m.t + ph - (y / opts.yMax) * ph;
    const ys = niceStep(opts.yMax, 4);
    let g = '';
    for (let v = 0; v <= opts.yMax + 1e-12; v += ys) {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c.grid}"/>`;
      g += `<text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${c.muted}">${opts.yFmt(v)}</text>`;
    }
    const every = Math.ceil(k / Math.floor(pw / 26));
    opts.bars.forEach((b, i) => {
      const x = m.l + slot * i + (slot - bw) / 2, y = Y(Math.min(b.y, opts.yMax)), base = m.t + ph;
      const h = base - y, r = Math.min(4, bw / 2, h);
      if (h > 0.5) g += `<path d="M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${base}Z" fill="${b.color}"/>`;
      if (i % every === 0) g += `<text x="${x + bw / 2}" y="${base + 16}" text-anchor="middle" font-size="11" fill="${c.muted}">${esc(b.label)}</text>`;
      if (opts.showValues && opts.showValues(b, i)) g += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="10.5" fill="${c.ink2}">${esc(opts.valueFmt(b.y))}</text>`;
    });
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${c.line}"/>`;
    g += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="${c.ink2}">${esc(opts.xTitle)}</text>`;
    g += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11.5" fill="${c.ink2}">${esc(opts.yTitle)}</text>`;
    if (opts.divider && opts.divider.after < k - 1) {
      const dx = m.l + slot * (opts.divider.after + 1);
      g += `<line x1="${dx}" x2="${dx}" y1="${m.t - 16}" y2="${m.t + ph}" stroke="${c.ink2}" stroke-dasharray="4 3"/>`;
      g += `<text x="${dx - 6}" y="${m.t - 8}" text-anchor="end" font-size="11.5" font-weight="700" fill="${cssVar('--ok')}">${esc(opts.divider.left)}</text>`;
      g += `<text x="${dx + 6}" y="${m.t - 8}" font-size="11.5" font-weight="700" fill="${cssVar('--ng')}">${esc(opts.divider.right)}</text>`;
    }
    opts.bars.forEach((b, i) => { g += `<rect class="bh" data-i="${i}" x="${m.l + slot * i}" y="${m.t}" width="${slot}" height="${ph}" fill="transparent"/>`; });
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.yTitle)}の棒グラフ" font-family="${esc(cssVar('--f-ui'))}" style="background:${c.surface}">${g}</svg><div class="tip" hidden></div>`;
    const svg = host.querySelector('svg'), tip = host.querySelector('.tip');
    const show = ev => {
      const t = ev.target.closest('.bh'); if (!t) return;
      const i = +t.dataset.i, b = opts.bars[i];
      tip.innerHTML = b.tip; tip.hidden = false;
      const r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect();
      const px = (m.l + slot * (i + 0.5)) / W * r.width;
      let left = px + 10; if (left + tip.offsetWidth > hr.width) left = px - tip.offsetWidth - 10;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '4px';
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // 範囲チャート（OC曲線の識別範囲、信頼区間）
  // opts: {rows:[{label, lo, hi, mid, color, loText, hiText, midText}], xMax, xFmt, xTitle}
  function drawRanges(host, opts) {
    const W = Math.round(Math.max(320, Math.min(720, host.clientWidth || 640)));
    const m = { l: 16, r: 22, t: 8, b: 40 }, rowH = 58;
    const H = m.t + rowH * opts.rows.length + m.b, pw = W - m.l - m.r;
    const X = x => m.l + Math.min(1, x / opts.xMax) * pw;
    const c = { ink: cssVar('--ink'), ink2: cssVar('--ink2'), muted: cssVar('--muted'), grid: cssVar('--grid'), surface: cssVar('--surface'), line: cssVar('--line') };
    const xs = niceStep(opts.xMax, 5);
    let g = '';
    const axisY = m.t + rowH * opts.rows.length;
    for (let v = 0; v <= opts.xMax + 1e-12; v += xs) {
      g += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${axisY}" stroke="${c.grid}"/>`;
      g += `<text x="${X(v)}" y="${axisY + 16}" text-anchor="middle" font-size="11" fill="${c.muted}">${opts.xFmt(v)}</text>`;
    }
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${axisY}" y2="${axisY}" stroke="${c.line}"/>`;
    g += `<text x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="11.5" fill="${c.ink2}">${esc(opts.xTitle)}</text>`;
    opts.rows.forEach((r, i) => {
      const y0 = m.t + rowH * i, ly = y0 + 16, by = y0 + 34;
      g += `<text x="${m.l}" y="${ly}" font-size="12" fill="${c.ink}">${esc(r.label)}</text>`;
      const x1 = X(r.lo), x2 = X(r.hi);
      g += `<line x1="${x1}" x2="${Math.max(x2, x1 + 1)}" y1="${by}" y2="${by}" stroke="${r.color}" stroke-width="8" stroke-linecap="round"/>`;
      if (r.mid != null) g += `<circle cx="${X(r.mid)}" cy="${by}" r="7" fill="${c.surface}" stroke="${r.color}" stroke-width="3"/>`;
      const t = (x, txt, anchor) => `<text x="${x}" y="${by + 20}" text-anchor="${anchor}" font-size="11" fill="${c.ink2}">${esc(txt)}</text>`;
      if (r.loText) g += t(x1, r.loText, x1 < m.l + 30 ? 'start' : 'middle');
      if (r.hiText) g += t(x2, r.hiText, x2 > W - m.r - 30 ? 'end' : 'middle');
    });
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.xTitle)}の範囲" font-family="${esc(cssVar('--f-ui'))}" style="background:${c.surface}">${g}</svg>`;
  }

  // ---- HTML 部品 ----
  function splitBar(pa, okLabel, ngLabel) {
    const a = Math.max(0, Math.min(1, pa)), b = 1 - a;
    const seg = (cls, f, txt) => f > 0.0005 ? `<div class="${cls}" style="width:${(f * 100).toFixed(2)}%">${f >= 0.2 ? txt : ''}</div>` : '';
    return `<div class="split" role="img" aria-label="${okLabel} ${prob(a)}、${ngLabel} ${prob(b)}">${seg('ok', a, `${okLabel} ${prob(a)}`)}${seg('ng', b, `${ngLabel} ${prob(b)}`)}</div>
      <div class="gauge-scale"><span>${okLabel} ${prob(a)}</span><span>${ngLabel} ${prob(b)}</span></div>`;
  }
  function gauge(frac, color, target) {
    const f = Math.max(0, Math.min(1, frac));
    return `<div class="gauge"><div class="track"><div class="fill" style="width:${(f * 100).toFixed(2)}%;--c:${color}"></div></div>${target != null ? `<div class="tgt" style="left:calc(${(Math.min(1, target) * 100).toFixed(2)}% - 1px)"></div>` : ''}</div>`;
  }
  function lotBar(segs) {
    return `<div class="lotbar">${segs.filter(s => s.n > 0).map(s => `<div class="${s.cls}" style="flex:${s.n} 1 0">${s.text || ''}</div>`).join('')}</div>`;
  }
  function judgeLine(ac, re, unit) {
    let cells = '';
    if (re <= 12) {
      for (let d = 0; d <= re; d++) {
        const cls = d <= ac ? 'ok' : d >= re ? 'ng' : 'warn';
        cells += `<span class="${cls}">${d}${d === re ? '〜' : ''}</span>`;
      }
    } else {
      cells = `<span class="ok" style="flex:2">0〜${ac}</span>` + (re - ac > 1 ? `<span class="warn">${ac + 1}〜${re - 1}</span>` : '') + `<span class="ng" style="flex:1">${re}〜</span>`;
    }
    return `<div class="viz"><div class="viz-title"><span>抜き取った中の${unit}数と判定</span></div><div class="jline">${cells}</div>
      <div class="key"><span style="--c:var(--ok)">合格</span>${re - ac > 1 ? '<span style="--c:var(--warn)">合格・なみ検査へ戻す</span>' : ''}<span style="--c:var(--ng)">不合格</span></div></div>`;
  }
  const tile = (k, v, color) => `<div class="tile" style="--c:${color || 'var(--line)'}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  function seriesFrom(plan, dist, xMax, key) {
    const r = S.curve(plan, dist, xMax, 240);
    return { pts: r.pts.map(q => [q.p, q[key]]), aoql: r.aoql, aoqlP: r.aoqlP };
  }
  function autoXMax(plans, distOf) {
    let mx = 0;
    for (const pl of plans) {
      const d = distOf(pl);
      const lim = d === 'poisson' ? 50 : 1;
      const p = S.pAtPa(0.01, pl, d, lim);
      mx = Math.max(mx, isFinite(p) ? p : lim);
    }
    return Math.min(niceMax(mx * 1.05), 50);
  }
  const distName = { binomial: '二項分布', hypergeometric: '超幾何分布', poisson: 'ポアソン分布' };
  const OK = () => cssVar('--ok'), NG = () => cssVar('--ng');

  // ---------- 状態（URL に保存） ----------
  const TABS = ['lot', 'aql', 'oc', 'design', 'est'];
  const state = {
    tab: 'lot',
    lot: { N: 1000, p: 1, D: 10, mode: 'pct', n: 80, c: 2 },
    aql: { N: 1000, lv: 'II', aql: '1.0', sev: 'normal' },
    oc: { plans: [{ N: 1000, n: 80, c: 2 }, { N: 1000, n: 125, c: 1 }, { N: 1000, n: 50, c: 0 }], dist: 'auto', kind: 'oc', xmax: '' },
    d: { p1: 1, a: 5, p2: 5, b: 10, N: '' },
    e: { n: 300, x: 0, conf: 0.95, N: '' }
  };
  let ocIsExample = true;

  function saveUrl() {
    if (embedded) return;
    try {
      const q = new URLSearchParams();
      q.set('l', [state.lot.N, state.lot.p, state.lot.n, state.lot.c, state.lot.mode, state.lot.D].join('~'));
      q.set('a', [state.aql.N, state.aql.lv, state.aql.aql, state.aql.sev].join('~'));
      q.set('o', state.oc.plans.map(p => [p.N || '', p.n, p.c].join('.')).join('_') + '~' + state.oc.dist + '~' + state.oc.kind + '~' + state.oc.xmax);
      q.set('d', [state.d.p1, state.d.a, state.d.p2, state.d.b, state.d.N].join('~'));
      q.set('e', [state.e.n, state.e.x, state.e.conf, state.e.N].join('~'));
      history.replaceState(null, '', '?' + q.toString() + '#' + state.tab);
    } catch (e) { /* 保存できない環境では何もしない */ }
  }
  function loadUrl() {
    try {
      const h = (location.hash || '').slice(1);
      if (TABS.includes(h)) state.tab = h;
      if (embedded || !location.search) return;
      const q = new URLSearchParams(location.search);
      if (q.get('l')) {
        const [N, p, n, c, mode, D] = q.get('l').split('~');
        Object.assign(state.lot, { N: +N || 1000, p: isFinite(+p) ? +p : 1, n: +n || 80, c: isFinite(+c) ? +c : 2, mode: mode === 'cnt' ? 'cnt' : 'pct', D: D !== undefined && isFinite(+D) ? +D : 10 });
      }
      if (q.get('a')) { const [N, lv, a, sev] = q.get('a').split('~'); Object.assign(state.aql, { N: +N || 1000, lv: T.levels.includes(lv) ? lv : 'II', aql: T.aql.includes(a) ? a : '1.0', sev: ['normal', 'tightened', 'reduced'].includes(sev) ? sev : 'normal' }); }
      if (q.get('o')) {
        const [pl, dist, kind, xmax] = q.get('o').split('~');
        const plans = pl.split('_').map(s => { const [N, n, c] = s.split('.'); return { N: N ? +N : '', n: +n, c: +c }; }).filter(p => p.n > 0 && p.c >= 0).slice(0, 3);
        if (plans.length) { state.oc.plans = plans; ocIsExample = false; }
        if (['auto', 'binomial', 'hypergeometric', 'poisson'].includes(dist)) state.oc.dist = dist;
        if (['oc', 'aoq', 'ati'].includes(kind)) state.oc.kind = kind;
        state.oc.xmax = xmax || '';
      }
      if (q.get('d')) { const [p1, a, p2, b, N] = q.get('d').split('~'); Object.assign(state.d, { p1: +p1, a: +a, p2: +p2, b: +b, N: N || '' }); }
      if (q.get('e')) { const [n, x, conf, N] = q.get('e').split('~'); Object.assign(state.e, { n: +n, x: +x, conf: [0.9, 0.95, 0.99].includes(+conf) ? +conf : 0.95, N: N || '' }); }
    } catch (e) { /* 読めなければ初期値のまま */ }
  }

  // ---------- タブ ----------
  const tabs = document.querySelectorAll('nav.tabs button');
  const panels = { lot: $('p-lot'), aql: $('p-aql'), oc: $('p-oc'), design: $('p-design'), est: $('p-est') };
  function setTab(t) {
    state.tab = t;
    tabs.forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
    for (const k in panels) panels[k].hidden = k !== t;
    render();
  }
  tabs.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function bindSeg(id, get, set) {
    const el = $(id);
    const sync = () => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(get()) ? 'true' : 'false'));
    el.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      set(b.dataset.v); sync(); render();
    });
    sync();
    return sync;
  }
  const errBox = (el, msg) => { el.innerHTML = `<div class="eyebrow">入力エラー</div><div class="big">${msg}</div>`; };

  // ---------- 合格率 ----------
  function renderLot() {
    const st = state.lot;
    const N = st.N, pP = st.p, n = st.n, c = st.c, byCount = st.mode === 'cnt';
    const v = $('l-verdict');
    $('l-p-field').hidden = byCount; $('l-D-field').hidden = !byCount;
    const clear = () => { ['l-lot', 'l-dist', 'l-dist-key', 'l-waffle', 'l-tiles', 'l-oc', 'l-nn'].forEach(id => { $(id).innerHTML = ''; }); $('l-D-hint').textContent = ''; };
    if (!(Number.isInteger(N) && N >= 1)) { clear(); return errBox(v, 'ロットサイズは 1 以上の整数で入力する'); }
    if (byCount) {
      if (!(Number.isInteger(st.D) && st.D >= 0 && st.D <= N)) { clear(); return errBox(v, '不良数は 0 以上、ロットサイズ以下の整数で入力する'); }
    } else if (!(pP >= 0 && pP <= 100)) { clear(); return errBox(v, '不良率は 0〜100 % で入力する'); }
    if (!(Number.isInteger(n) && n >= 1 && n <= N)) { clear(); return errBox(v, '抜き取り数は 1 以上、ロットサイズ以下の整数で入力する'); }
    if (!(Number.isInteger(c) && c >= 0)) { clear(); return errBox(v, 'c は 0 以上の整数で入力する'); }
    let D;
    if (byCount) {
      D = st.D;
      $('l-D-hint').textContent = `不良率に直すと ${pct(D / N)}`;
    } else {
      const exact = pP / 100 * N; D = Math.round(exact);
      $('l-D-hint').textContent = `ロット内の不良 ${fmtInt(D)} 個` + (Math.abs(exact - D) > 1e-9 ? `（${sig3(exact)} 個を四捨五入）` : '');
    }
    const J = S.lotJudge(N, D, n, c);
    const pa = J.pa;

    v.innerHTML = `<div class="eyebrow">このロットが合格する確率</div>
      <div class="big">${num(prob(pa))}</div>
      ${splitBar(pa, '合格', '不合格')}
      <p class="note">不良 ${fmtInt(D)} 個を含む ${fmtInt(N)} 個のロットから ${fmtInt(n)} 個を抜き取り、不良が ${c} 個以下なら合格とする場合。</p>`;

    // ロットと抜き取りの構成
    const badTxt = D / N >= 0.12 ? `不良 ${fmtInt(D)}` : '';
    $('l-lot').innerHTML = `
      <div class="viz-title"><span>ロット ${fmtInt(N)} 個の中身</span><b>不良 ${fmtInt(D)} 個（${pct(D / N)}）</b></div>
      ${lotBar([{ cls: 'bad', n: D, text: badTxt }, { cls: 'good', n: N - D, text: `良品 ${fmtInt(N - D)}` }])}
      <div class="viz-title" style="margin-top:8px"><span>検査する範囲</span><b>${fmtInt(n)} 個（${pct(n / N)}）</b></div>
      ${lotBar([{ cls: 'samp', n, text: n / N >= 0.15 ? `検査 ${fmtInt(n)}` : '' }, { cls: 'rest', n: N - n, text: `検査しない ${fmtInt(N - n)}` }])}
      <div class="key"><span style="--c:var(--ng)">不良</span><span style="--c:var(--accent)">抜き取って検査</span><span style="--c:var(--grid)">良品・検査しない</span></div>`;

    // 抜取中の不良数の分布
    let kMax = 0, cum = 0;
    for (let d = 0; d < J.pmf.length; d++) { cum += J.pmf[d]; kMax = d; if (cum >= 0.9995 && d >= c + 1) break; }
    kMax = Math.min(Math.max(kMax, Math.min(c + 1, J.pmf.length - 1)), 60);
    const bars = [];
    let yMx = 0;
    for (let d = 0; d <= kMax; d++) {
      const y = J.pmf[d] || 0; yMx = Math.max(yMx, y);
      const ok = d <= c;
      bars.push({ label: String(d), y, color: ok ? OK() : NG(), tip: `<div>不良 ${d} 個</div><div><b class="num">${prob(y)}</b>（${ok ? '合格' : '不合格'}）</div>` });
    }
    $('l-dist-title').textContent = `抜き取った ${fmtInt(n)} 個に入る不良の数`;
    drawBars($('l-dist'), {
      bars, yMax: niceMax(yMx * 1.12), yFmt: y => Math.round(y * 100) + '%',
      xTitle: '抜き取った中の不良数 [個]', yTitle: '起こる確率',
      divider: { after: c, left: '合格', right: '不合格' },
      showValues: b => kMax <= 14 && b.y >= 0.005, valueFmt: y => (y * 100).toFixed(y >= 0.1 ? 0 : 1) + '%'
    });
    $('l-dist-key').innerHTML = `<span style="--c:var(--ok)">合格になる（${c} 個以下）</span><span style="--c:var(--ng)">不合格になる（${c + 1} 個以上）</span><span style="--c:transparent">平均 ${sig3(J.mean)} 個</span>`;

    // 100ロット
    const okN = Math.round(pa * 100);
    $('l-waffle').innerHTML = Array.from({ length: 100 }, (_, i) => `<i class="${i < okN ? '' : 'r'}"></i>`).join('');
    $('l-tiles').innerHTML = [
      tile('合格するロット', `${num(sig3(pa * 100))} <small>ロット</small>`, 'var(--ok)'),
      tile('不良を1個以上見つける確率', num(prob(J.pFindAny)), 'var(--accent)'),
      tile('合格ロットに残る不良（1ロット平均）', pa > 0 ? `${num(sig3(J.escapePerLot / pa))} <small>個</small>` : '—', 'var(--ng)'),
      tile('100ロットで流出する不良（合計）', `${num(sig3(J.escapePerLot * 100))} <small>個</small>`, 'var(--ng)')
    ].join('');

    // 不良率を変えたら（OC曲線）
    const plan = { n, c, N };
    const xMax = Math.max(autoXMax([plan], () => 'hypergeometric'), niceMax(Math.max(pP / 100, 0.001) * 1.4));
    drawChart($('l-oc'), {
      series: [{ name: '合格確率', pts: seriesFrom(plan, 'hypergeometric', Math.min(1, xMax), 'pa').pts, color: cssVar('--s1') }],
      xMax: Math.min(1, xMax), yMax: 1, xFmt: x => sig3(x * 100), yFmt: y => Math.round(y * 100) + '%',
      xTitle: 'ロットの不良率 [%]', yTitle: '合格確率', tipX: x => '不良率 ' + pct(x), tipY: y => prob(y),
      markers: [{ x: D / N, y: pa, label: 'このロット', color: cssVar('--ink') }]
    });
    // 抜き取り数を変えたら
    let nMax = Math.max(2 * n, 10);
    if (D > 0) { for (let t = n; t <= N; t = Math.ceil(t * 1.25) + 1) { if (S.hypergeomCdf(c, N, D, t) < 0.02) { nMax = Math.max(nMax, Math.ceil(t * 1.15)); break; } nMax = Math.max(nMax, t); if (t > 20000) break; } }
    nMax = Math.min(N, niceMax(nMax));
    const step = Math.max(1, Math.round(nMax / 160)), pts = [];
    for (let t = 1; t <= nMax; t += step) pts.push([t, S.hypergeomCdf(c, N, D, t)]);
    if (pts[pts.length - 1][0] !== nMax) pts.push([nMax, S.hypergeomCdf(c, N, D, nMax)]);
    drawChart($('l-nn'), {
      series: [{ name: '合格確率', pts, color: cssVar('--s2') }],
      xMax: nMax, yMax: 1, xFmt: x => fmtInt(Math.round(x)), yFmt: y => Math.round(y * 100) + '%',
      xTitle: '抜き取り数 [個]', yTitle: '合格確率', tipX: x => '抜き取り ' + fmtInt(Math.round(x)) + ' 個', tipY: y => prob(y),
      markers: [{ x: n, y: pa, label: `いまの ${fmtInt(n)} 個`, color: cssVar('--ink') }]
    });
  }
  [['l-N', 'N'], ['l-p', 'p'], ['l-D', 'D'], ['l-n', 'n'], ['l-c', 'c']].forEach(([id, k]) => $(id).addEventListener('input', e => { state.lot[k] = e.target.value === '' ? NaN : +e.target.value; render(); }));
  // 入力方式を切り替えるときは、いまの値を換算して引き継ぐ
  const syncMode = bindSeg('l-mode', () => state.lot.mode, v => {
    const st = state.lot;
    if (v === st.mode) return;
    if (v === 'cnt' && st.p >= 0 && st.N >= 1) { st.D = Math.round(st.p / 100 * st.N); $('l-D').value = st.D; }
    if (v === 'pct' && st.D >= 0 && st.N >= 1) { st.p = Number((st.D / st.N * 100).toPrecision(6)); $('l-p').value = st.p; }
    st.mode = v;
  });
  $('l-from-aql').addEventListener('click', () => {
    const st = state.aql, r = lookupAql(Math.floor(st.N), st.lv, st.aql, st.sev);
    if (!r) { toast('AQL方式の入力を確認してほしい'); return; }
    state.lot.N = Math.floor(st.N); state.lot.n = Math.min(r.n, state.lot.N); state.lot.c = r.ac;
    $('l-N').value = state.lot.N; $('l-n').value = state.lot.n; $('l-c').value = state.lot.c;
    render();
    toast(`AQL ${st.aql}・水準 ${st.lv} の方式（n=${r.n}, c=${r.ac}）を入れた`);
  });

  // ---------- AQL方式 ----------
  const aqlSel = $('aql-aql');
  aqlSel.innerHTML = T.aql.map(a => `<option value="${a}">${a}</option>`).join('');

  function lookupAql(N, lv, aql, sev) {
    const ri = T.lotRanges.findIndex(([a, b]) => N >= a && (b === null || N <= b));
    if (ri < 0) return null;
    const L = T.codeLetters[ri][T.levels.indexOf(lv)];
    const r = T.letters.indexOf(L), col = T.aql.indexOf(aql);
    const [n, ac, re] = T.plans[sev][r][col];
    const ns = T.nByLetter[sev];
    let used = L;
    if (n !== ns[r]) {
      if (sev === 'tightened' && n === 3150) used = 'S';
      else {
        const up = n < ns[r];
        let j = r;
        do { j += up ? -1 : 1; } while (j >= 0 && j < 16 && ns[j] !== n);
        used = (j >= 0 && j < 16) ? T.letters[j] : '?';
      }
    }
    return { L, used, n, ac, re, ri };
  }

  function renderAql() {
    const st = state.aql;
    const N = Math.floor(st.N), aqlV = parseFloat(st.aql), perUnit = aqlV > 10;
    $('aql-unit-hint').textContent = perUnit
      ? '10 を超える AQL は「100単位当たりの欠点数」として扱う'
      : '不良率 [%]（100単位当たりの欠点数としても使える）';
    const v = $('aql-verdict'), viz = $('aql-viz');
    if (!(N >= 2)) { errBox(v, 'ロットサイズは 2 以上の整数で入力する'); viz.innerHTML = ''; $('aql-chart').innerHTML = ''; return; }
    const r = lookupAql(N, st.lv, st.aql, st.sev);
    const unit = perUnit ? '欠点' : '不良';
    const full = r.n >= N;
    const sevName = { normal: 'なみ検査', tightened: 'きつい検査', reduced: 'ゆるい検査' }[st.sev];
    if (full) {
      v.innerHTML = `<div class="eyebrow">${sevName}・サンプル文字 ${r.used}</div>
        <div class="big">全数検査</div>
        <div class="rules"><span class="chip warn"><span class="ic">!</span>表のサンプル数 n = ${num(fmtInt(r.n))} がロットサイズ以上</span></div>
        <p class="note">MIL-STD-105E では、サンプル数がロットサイズ以上になる場合は全数検査を行う。</p>`;
    } else {
      let rules = `<span class="chip ok"><span class="ic">✓</span>${unit} ${num(r.ac)} 個以下 → 合格</span>
        <span class="chip ng"><span class="ic">✕</span>${num(r.re)} 個以上 → 不合格</span>`;
      let extra = '';
      if (r.re - r.ac > 1) {
        const a = r.ac + 1, b = r.re - 1;
        rules += `<span class="chip warn"><span class="ic">!</span>${num(a === b ? a : a + '〜' + b)} 個 → 合格だが、なみ検査に戻す</span>`;
        extra = '<p class="note">ゆるい検査で合格判定個数と不合格判定個数の間に差があるのは MIL-STD-105E の規定。JIS Z 9015-1:2006 ではこの差は解消されている。</p>';
      }
      v.innerHTML = `<div class="eyebrow">${sevName}・サンプル文字 ${r.used}${r.used !== r.L ? '（表Iでは ' + r.L + '）' : ''}</div>
        <div class="big">${num(fmtInt(r.n))} 個を抜き取る</div>
        <div class="rules">${rules}</div>${extra}`;
    }
    const nn = Math.min(r.n, N);
    const plan = { n: nn, c: r.ac, N };
    const dist = perUnit ? 'poisson' : S.autoDist(plan);
    const pAql = aqlV / 100;
    const badges = `<div class="badges"><span class="badge">サンプル文字 <b>${r.L}</b></span>${r.used !== r.L ? `<span class="badge">矢印で <b>${r.used}</b> に変更</span>` : ''}${full ? '' : `<span class="badge">${distName[dist]}で計算</span>`}</div>`;
    const lotViz = `<div class="viz"><div class="viz-title"><span>ロット ${fmtInt(N)} 個のうち検査する数</span><b>${fmtInt(nn)} 個（${pct(nn / N)}）</b></div>
      ${lotBar([{ cls: 'samp', n: nn, text: nn / N >= 0.15 ? `検査 ${fmtInt(nn)}` : '' }, { cls: 'rest', n: N - nn, text: N - nn > 0 ? `検査しない ${fmtInt(N - nn)}` : '' }])}</div>`;
    if (full) {
      viz.innerHTML = lotViz + badges;
      $('aql-chart').innerHTML = '<p class="note">全数検査のため OC 曲線はない。</p>';
      renderAql.last = null;
      return;
    }
    const paAql = S.pAccept(pAql, plan, dist);
    const lim = perUnit ? 50 : 1;
    const p95 = S.pAtPa(0.95, plan, dist, lim), p50 = S.pAtPa(0.50, plan, dist, lim), p10 = S.pAtPa(0.10, plan, dist, lim);
    viz.innerHTML = judgeLine(r.ac, r.re, unit) + lotViz +
      `<div class="viz"><div class="viz-title"><span>品質がちょうど AQL のロットが合格する確率</span><b>${prob(paAql)}</b></div>${gauge(paAql, cssVar('--ok'))}<div class="gauge-scale"><span>0 %</span><span>100 %</span></div></div>` +
      badges;
    const xMax = autoXMax([plan], () => dist);
    const s = seriesFrom(plan, dist, xMax, 'pa');
    drawChart($('aql-chart'), {
      series: [{ name: '合格確率', pts: s.pts, color: cssVar('--s1') }],
      xMax, yMax: 1,
      xFmt: x => sig3(x * 100), yFmt: y => Math.round(y * 100) + '%',
      xTitle: perUnit ? 'ロットの品質 [100単位当たり欠点数]' : 'ロットの不良率 [%]',
      yTitle: '合格確率',
      tipX: x => (perUnit ? '欠点数 ' + sig3(x * 100) + ' /100単位' : '不良率 ' + pct(x)),
      tipY: y => prob(y),
      vlines: [{ x: pAql, label: 'AQL' }],
      markers: [
        { x: p95, y: 0.95, label: `95 %（${sig3(p95 * 100)}）`, color: cssVar('--s1'), dy: 18 },
        { x: p50, y: 0.50, label: `50 %（${sig3(p50 * 100)}）`, color: cssVar('--s1'), dy: -8 },
        { x: p10, y: 0.10, label: `10 %（${sig3(p10 * 100)}）`, color: cssVar('--s1'), dy: -10 }
      ]
    });
    renderAql.last = { N, n: r.n, c: r.ac, label: `AQL ${st.aql} ${r.used}` };
  }
  $('aql-N').addEventListener('input', e => { state.aql.N = +e.target.value; render(); });
  $('aql-level').addEventListener('change', e => { state.aql.lv = e.target.value; render(); });
  aqlSel.addEventListener('change', e => { state.aql.aql = e.target.value; render(); });
  const syncSev = bindSeg('aql-sev', () => state.aql.sev, v => { state.aql.sev = v; });
  $('aql-to-oc').addEventListener('click', () => addToOc(renderAql.last));

  function addToOc(p) {
    if (!p) { toast('全数検査の方式は追加できない'); return; }
    const item = { N: p.N || '', n: p.n, c: p.c };
    if (ocIsExample) { state.oc.plans = []; ocIsExample = false; }
    if (state.oc.plans.length >= 3) state.oc.plans.pop();
    state.oc.plans.push(item);
    buildOcRows();
    setTab('oc');
    toast('OC比較に追加した');
  }

  // ---------- OC曲線・比較 ----------
  function buildOcRows() {
    const host = $('oc-plans');
    host.innerHTML = state.oc.plans.map((p, i) => `
      <div class="plan-row" data-i="${i}">
        <span class="sw" style="background:var(${SERIES[i]})"></span>
        <div class="field"><label for="oc-N${i}">N</label><input type="number" id="oc-N${i}" data-k="N" min="1" step="1" value="${p.N}" placeholder="任意"></div>
        <div class="field"><label for="oc-n${i}">n</label><input type="number" id="oc-n${i}" data-k="n" min="1" step="1" value="${p.n}"></div>
        <div class="field"><label for="oc-c${i}">c</label><input type="number" id="oc-c${i}" data-k="c" min="0" step="1" value="${p.c}"></div>
        <button class="btn small" type="button" data-del="${i}" aria-label="方式${i + 1}を削除" style="margin-bottom:2px">削除</button>
      </div>`).join('');
    $('oc-add').disabled = state.oc.plans.length >= 3;
  }
  $('oc-plans').addEventListener('input', ev => {
    const row = ev.target.closest('.plan-row'); if (!row) return;
    const p = state.oc.plans[+row.dataset.i], k = ev.target.dataset.k;
    p[k] = ev.target.value === '' ? '' : +ev.target.value;
    ocIsExample = false;
    render();
  });
  $('oc-plans').addEventListener('click', ev => {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    state.oc.plans.splice(+b.dataset.del, 1);
    ocIsExample = false;
    buildOcRows(); render();
  });
  $('oc-add').addEventListener('click', () => {
    if (state.oc.plans.length >= 3) return;
    const last = state.oc.plans[state.oc.plans.length - 1] || { N: 1000, n: 50, c: 1 };
    state.oc.plans.push({ N: last.N, n: last.n, c: last.c });
    ocIsExample = false;
    buildOcRows(); render();
  });
  $('oc-dist').addEventListener('change', e => { state.oc.dist = e.target.value; render(); });
  $('oc-xmax').addEventListener('input', e => { state.oc.xmax = e.target.value; render(); });
  const syncKind = bindSeg('oc-kind', () => state.oc.kind, v => { state.oc.kind = v; });

  let ocCache = null;
  function validPlans() {
    return state.oc.plans.map((p, i) => ({ ...p, i })).filter(p => p.n >= 1 && p.c >= 0 && Number.isInteger(p.n) && Number.isInteger(p.c) && p.c < p.n && (p.N === '' || (p.N >= p.n && Number.isInteger(p.N))));
  }
  function renderOc() {
    const st = state.oc;
    const notes = [];
    const plans = validPlans().map(p => ({ ...p, N: p.N === '' ? null : p.N }));
    if (plans.length < state.oc.plans.length) notes.push('入力に誤りがある方式は表示していない（c < n ≤ N の整数で入力する）。');
    const distOf = p => {
      if (st.dist === 'auto') return S.autoDist(p);
      if (st.dist === 'hypergeometric' && !p.N) return 'binomial';
      return st.dist;
    };
    if (st.dist === 'hypergeometric' && plans.some(p => !p.N)) notes.push('N が空欄の方式は二項分布で計算している。');
    const kind = st.kind;
    let shown = plans;
    if (kind === 'ati') {
      shown = plans.filter(p => p.N);
      if (shown.length < plans.length) notes.push('ATI はロットサイズ N が必要なので、N が空欄の方式は表示していない。');
    }
    if (kind === 'aoq' && plans.some(p => !p.N)) notes.push('N が空欄の方式の AOQ は Pa × p で近似している。');
    if (kind === 'aoq') notes.push('点は各方式の AOQL（出荷品質の最悪値）。');
    if (ocIsExample) notes.unshift('表示中の3方式は入力例。');
    const isPois = plans.length && plans.every(p => distOf(p) === 'poisson');
    const xMax = parseFloat(st.xmax) > 0 ? parseFloat(st.xmax) / 100 : autoXMax(plans.length ? plans : [{ n: 50, c: 1 }], distOf);
    const series = shown.map(p => {
      const d = distOf(p);
      const s = seriesFrom(p, d, xMax, kind === 'oc' ? 'pa' : kind);
      return { name: `n=${p.n}, c=${p.c}${p.N ? ', N=' + fmtInt(p.N) : ''}`, pts: s.pts, color: cssVar(SERIES[p.i]), plan: p, dist: d };
    });
    const unitX = isPois ? 'ロットの品質 [100単位当たり欠点数]' : 'ロットの不良率 [%]';
    let yMax = 1, yTitle = '合格確率', yFmt = y => Math.round(y * 100) + '%', tipY = y => prob(y);
    if (kind === 'aoq') {
      let mx = 0; series.forEach(s => s.pts.forEach(q => { if (q[1] > mx) mx = q[1]; }));
      yMax = niceMax(mx * 1.1 || 0.01); yTitle = 'AOQ（出荷品質）[%]'; yFmt = y => sig3(y * 100); tipY = y => pct(y);
    }
    if (kind === 'ati') {
      let mx = 0; series.forEach(s => s.pts.forEach(q => { if (q[1] > mx) mx = q[1]; }));
      yMax = niceMax(mx || 1); yTitle = 'ATI（平均検査数）[個]'; yFmt = y => fmtInt(Math.round(y)); tipY = y => fmtInt(Math.round(y)) + ' 個';
    }
    const markers = [];
    if (kind === 'aoq') series.forEach(s => {
      const c = S.curve(s.plan, s.dist, xMax, 240);
      if (s.plan.N) markers.push({ x: c.aoqlP, y: c.aoql, label: '', color: s.color });
    });
    if (series.length) {
      drawChart($('oc-chart'), {
        series, xMax, yMax, xFmt: x => sig3(x * 100), yFmt, xTitle: unitX, yTitle,
        tipX: x => (isPois ? '欠点数 ' + sig3(x * 100) + ' /100単位' : '不良率 ' + pct(x)), tipY, markers
      });
    } else {
      $('oc-chart').innerHTML = '<p class="note">表示できる方式がない。</p>';
    }
    $('oc-legend').innerHTML = series.map(s => `<span style="--c:${s.color}">${esc(s.name)}・${distName[s.dist]}</span>`).join('');
    $('oc-note').textContent = notes.join(' ');
    // 見分けられる品質の範囲
    const fq = (x, d) => isFinite(x) ? (d === 'poisson' ? sig3(x * 100) : pct(x)) : '—';
    const rows = plans.map(p => {
      const d = distOf(p), lim = d === 'poisson' ? 50 : 1;
      const p95 = S.pAtPa(0.95, p, d, lim), p50 = S.pAtPa(0.50, p, d, lim), p10 = S.pAtPa(0.10, p, d, lim);
      const aoql = p.N ? S.curve(p, d, Math.min(lim, Math.max(xMax, p10 * 2)), 400).aoql : NaN;
      return {
        label: `n=${p.n}, c=${p.c}` + (p.N ? `　AOQL ${pct(aoql)}` : ''),
        lo: p95, mid: p50, hi: p10, color: cssVar(SERIES[p.i]),
        loText: fq(p95, d), hiText: fq(p10, d)
      };
    });
    if (rows.length) {
      const rMax = Math.max(xMax, ...rows.map(r => isFinite(r.hi) ? r.hi * 1.05 : 0));
      drawRanges($('oc-range'), { rows, xMax: niceMax(rMax), xFmt: x => sig3(x * 100), xTitle: unitX });
      $('oc-range-key').innerHTML = '<span style="--c:transparent">左端 = 95 % 合格する品質</span><span style="--c:transparent">○ = 50 %</span><span style="--c:transparent">右端 = 10 % しか合格しない品質</span>';
    } else { $('oc-range').innerHTML = ''; $('oc-range-key').innerHTML = ''; }
    ocCache = { plans, distOf, xMax, isPois };
  }
  function ocCsv() {
    if (!ocCache || !ocCache.plans.length) return '';
    const { plans, distOf, xMax } = ocCache;
    const head = ['p'];
    plans.forEach(p => head.push(`Pa(n=${p.n};c=${p.c})`, `AOQ(n=${p.n};c=${p.c})`, `ATI(n=${p.n};c=${p.c})`));
    const curves = plans.map(p => S.curve(p, distOf(p), xMax, 200).pts);
    const lines = [head.join(',')];
    for (let i = 0; i <= 200; i++) {
      const row = [curves[0][i].p.toPrecision(6)];
      curves.forEach(c => row.push(c[i].pa.toPrecision(6), c[i].aoq.toPrecision(6), isFinite(c[i].ati) ? c[i].ati.toPrecision(6) : ''));
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }
  $('oc-copy').addEventListener('click', () => copyText(ocCsv(), 'CSVをコピーした'));
  $('oc-csv').addEventListener('click', () => download('oc-curve.csv', new Blob(['﻿' + ocCsv()], { type: 'text/csv' })));
  $('oc-png').addEventListener('click', () => {
    const svg = $('oc-chart').querySelector('svg'); if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('.hx,.hd,.hit').forEach(e => e.remove());
    const vb = svg.viewBox.baseVal, sc = 2;
    clone.setAttribute('width', vb.width * sc); clone.setAttribute('height', vb.height * sc);
    const data = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = vb.width * sc; cv.height = vb.height * sc;
      const ctx = cv.getContext('2d'); ctx.fillStyle = cssVar('--surface'); ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => download('oc-curve.png', b), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
  });
  if (embedded) document.querySelectorAll('.dl-only').forEach(b => { b.hidden = true; });

  // ---------- 逆設計 ----------
  let dLast = null;
  function riskViz(title, actual, target) {
    const scale = niceMax(Math.max(actual, target) * 1.3);
    const ok = actual <= target + 1e-12;
    return `<div class="viz"><div class="viz-title"><span>${title}</span><b>${prob(actual)}</b></div>
      ${gauge(actual / scale, ok ? cssVar('--ok') : cssVar('--ng'), target / scale)}
      <div class="gauge-scale"><span>0 %</span><span>縦線 = 指定値 ${prob(target)}</span><span>${Math.round(scale * 100)} %</span></div></div>`;
  }
  function renderDesign() {
    const st = state.d;
    const p1 = st.p1 / 100, a = st.a / 100, p2 = st.p2 / 100, b = st.b / 100;
    const N = st.N === '' ? null : Math.floor(+st.N);
    const v = $('d-verdict'), viz = $('d-viz');
    const err = msg => { errBox(v, msg); viz.innerHTML = ''; $('d-chart').innerHTML = ''; $('d-bars').innerHTML = ''; $('d-legend').innerHTML = ''; dLast = null; };
    if (!(p1 >= 0 && p2 > p1 && p2 < 1)) return err('0 ≤ p₁ < p₂ < 100 % で入力する');
    if (!(a > 0 && a < 1 && b > 0 && b < 1)) return err('α と β は 0〜100 % の間で入力する');
    if (N !== null && !(N >= 2)) return err('ロットサイズは 2 以上の整数で入力する');
    const res = S.designPlan(p1, a, p2, b, N, 60);
    const z = S.zeroAcceptN(p2, b, N);
    const dist = res.dist;
    if (!res.plan) {
      v.innerHTML = `<div class="eyebrow">条件を満たす方式なし</div><div class="big">c ≤ 60${N ? '、n ≤ N' : ''} の範囲では見つからない</div><p class="note">p₁ と p₂ が近すぎるか、ロットサイズに対して要求が厳しすぎる。p₂/p₁ を広げるか、α・β を緩める。</p>`;
      viz.innerHTML = ''; $('d-chart').innerHTML = ''; $('d-legend').innerHTML = ''; dLast = null;
    } else {
      const pl = res.plan;
      v.innerHTML = `<div class="eyebrow">条件を満たす最小のサンプル数（${distName[dist]}）</div>
        <div class="big">${num(fmtInt(pl.n))} 個を抜き取る</div>
        <div class="rules"><span class="chip ok"><span class="ic">✓</span>不良 ${num(pl.c)} 個以下 → 合格</span><span class="chip ng"><span class="ic">✕</span>${num(pl.c + 1)} 個以上 → 不合格</span></div>`;
      let html = riskViz(`良いロット（不良率 ${pct(p1)}）を不合格にしてしまう確率`, 1 - pl.pa1, a) +
        riskViz(`悪いロット（不良率 ${pct(p2)}）を合格させてしまう確率`, pl.pa2, b);
      if (z) {
        const zpa1 = S.pAccept(p1, { n: z.n, c: 0, N }, dist);
        const mx = Math.max(pl.n, z.n);
        html += `<div class="viz"><div class="viz-title"><span>必要なサンプル数の比較</span></div>
          <div class="viz-title"><span>この方式（c = ${pl.c}）</span><b>${fmtInt(pl.n)} 個</b></div>${gauge(pl.n / mx, cssVar('--s1'))}
          <div class="viz-title" style="margin-top:4px"><span>c = 0 方式</span><b>${fmtInt(z.n)} 個</b></div>${gauge(z.n / mx, cssVar('--s2'))}
          <div class="note" style="margin-top:4px">c = 0 方式は良いロットを不合格にする確率が ${prob(1 - zpa1)} になる。</div></div>`;
      }
      if (N) html += `<div class="viz"><div class="viz-title"><span>ロット ${fmtInt(N)} 個のうち検査する数</span><b>${pct(pl.n / N)}</b></div>${lotBar([{ cls: 'samp', n: pl.n, text: pl.n / N >= 0.15 ? `検査 ${fmtInt(pl.n)}` : '' }, { cls: 'rest', n: N - pl.n, text: `検査しない ${fmtInt(N - pl.n)}` }])}</div>`;
      viz.innerHTML = html;
      const planA = { n: pl.n, c: pl.c, N };
      const plans = [planA];
      if (z && pl.c !== 0) plans.push({ n: z.n, c: 0, N });
      const xMax = Math.max(autoXMax(plans, () => dist), niceMax(p2 * 1.3));
      const series = plans.map((p, i) => ({ name: `n=${p.n}, c=${p.c}`, pts: seriesFrom(p, dist, xMax, 'pa').pts, color: cssVar(SERIES[i]) }));
      drawChart($('d-chart'), {
        series, xMax, yMax: 1, xFmt: x => sig3(x * 100), yFmt: y => Math.round(y * 100) + '%',
        xTitle: 'ロットの不良率 [%]', yTitle: '合格確率', tipX: x => '不良率 ' + pct(x), tipY: y => prob(y),
        markers: [
          { x: p1, y: 1 - a, label: `p₁, 1−α`, cross: true, dy: 18 },
          { x: p2, y: b, label: `p₂, β`, cross: true, dy: -10 }
        ]
      });
      $('d-legend').innerHTML = series.map(s => `<span style="--c:${s.color}">${esc(s.name)}</span>`).join('') + '<span style="--c:transparent">× は指定した2点</span>';
      dLast = planA;
    }
    const tried = res.tried.slice(0, 40);
    if (tried.length) {
      const mx = Math.max(...tried.map(t => t.n));
      drawBars($('d-bars'), {
        bars: tried.map(t => ({
          label: String(t.c), y: t.n, color: t.ok ? OK() : cssVar('--muted'),
          tip: `<div>c = ${t.c}：n = <b class="num">${fmtInt(t.n)}</b></div><div>良いロットの合格確率 ${prob(t.pa1)}</div><div>悪いロットの合格確率 ${prob(t.pa2)}</div>`
        })),
        yMax: niceMax(mx * 1.15), yFmt: y => fmtInt(Math.round(y)), xTitle: '合格判定個数 c', yTitle: '必要なサンプル数 [個]',
        showValues: () => tried.length <= 12, valueFmt: y => fmtInt(y)
      });
    } else $('d-bars').innerHTML = '';
  }
  [['d-p1', 'p1'], ['d-a', 'a'], ['d-p2', 'p2'], ['d-b', 'b']].forEach(([id, k]) => $(id).addEventListener('input', e => { state.d[k] = e.target.value === '' ? NaN : +e.target.value; render(); }));
  $('d-N').addEventListener('input', e => { state.d.N = e.target.value; render(); });
  $('d-to-oc').addEventListener('click', () => addToOc(dLast));

  // ---------- 不良率推定 ----------
  function renderEst() {
    const st = state.e;
    const n = Math.floor(st.n), x = Math.floor(st.x), conf = st.conf;
    const N = st.N === '' ? null : Math.floor(+st.N);
    const v = $('e-verdict'), lot = $('e-lot');
    const err = msg => { errBox(v, msg); $('e-range').innerHTML = ''; $('e-range-key').innerHTML = ''; lot.hidden = true; };
    if (!(n >= 1) || !(x >= 0) || x > n) return err('0 ≤ 不良数 ≤ 検査数 で入力する');
    if (N !== null && !(N >= n)) return err('ロットサイズは検査数以上で入力する');
    const cp = S.clopperPearson(x, n, conf);
    const cs = Math.round(conf * 100);
    v.innerHTML = `<div class="eyebrow">不良率の上限（信頼度 ${cs} %）</div>
      <div class="big">${num(pct(cp.upper1))} 以下</div>
      <p class="note">${fmtInt(n)} 個中 ${fmtInt(x)} 個が不良のとき、本当の不良率は信頼度 ${cs} % でこの値を超えないといえる。</p>`;
    const xMax = niceMax(Math.max(cp.upper2, cp.upper1) * 1.12);
    drawRanges($('e-range'), {
      rows: [
        { label: `ここまでと言える上限（片側 ${cs} %）`, lo: 0, hi: cp.upper1, mid: null, color: cssVar('--ng'), hiText: pct(cp.upper1) },
        { label: `本当の不良率がありそうな範囲（両側 ${cs} %）`, lo: cp.lower2, hi: cp.upper2, mid: cp.point, color: cssVar('--accent'), loText: pct(cp.lower2), hiText: pct(cp.upper2) }
      ],
      xMax, xFmt: v => sig3(v * 100), xTitle: '不良率 [%]'
    });
    $('e-range-key').innerHTML = `<span style="--c:transparent">○ = 実測の不良率 ${pct(cp.point)}</span>`;
    if (N) {
      const D = S.lotUpperDefects(x, n, N, conf);
      lot.hidden = false;
      lot.innerHTML = `<div class="viz-title"><span>ロット ${fmtInt(N)} 個の内訳</span><b>不良は最大 ${fmtInt(D)} 個（${pct(D / N)}）</b></div>
        ${lotBar([{ cls: 'samp', n, text: n / N >= 0.15 ? `検査済み ${fmtInt(n)}` : '' }, { cls: 'rest', n: N - n, text: N - n > 0 ? `未検査 ${fmtInt(N - n)}` : '' }])}
        <div class="tiles" style="margin-top:8px">
          ${tile('検査で見つかった不良', `${num(fmtInt(x))} <small>個</small>`, 'var(--accent)')}
          ${tile(`未検査の ${fmtInt(N - n)} 個に残りうる不良`, `${num(fmtInt(D - x))} <small>個以下</small>`, 'var(--ng)')}
          ${tile('ロット全体の不良', `${num(fmtInt(D))} <small>個以下（${cs} %）</small>`, 'var(--ng)')}
        </div>
        <div class="key"><span style="--c:var(--accent)">検査済み</span><span style="--c:var(--grid)">未検査</span></div>`;
    } else lot.hidden = true;
  }
  $('e-n').addEventListener('input', e => { state.e.n = +e.target.value; render(); });
  $('e-x').addEventListener('input', e => { state.e.x = +e.target.value; render(); });
  $('e-N').addEventListener('input', e => { state.e.N = e.target.value; render(); });
  const syncConf = bindSeg('e-conf', () => state.e.conf, v => { state.e.conf = +v; });

  // ---------- 全体 ----------
  function render() {
    if (state.tab === 'lot') renderLot();
    if (state.tab === 'aql') renderAql();
    if (state.tab === 'oc') renderOc();
    if (state.tab === 'design') renderDesign();
    if (state.tab === 'est') renderEst();
    saveUrl();
  }
  function fillInputs() {
    $('l-N').value = state.lot.N; $('l-p').value = state.lot.p; $('l-D').value = state.lot.D; $('l-n').value = state.lot.n; $('l-c').value = state.lot.c;
    syncMode();
    $('aql-N').value = state.aql.N; $('aql-level').value = state.aql.lv; aqlSel.value = state.aql.aql;
    $('oc-dist').value = state.oc.dist; $('oc-xmax').value = state.oc.xmax;
    $('d-p1').value = state.d.p1; $('d-a').value = state.d.a; $('d-p2').value = state.d.p2; $('d-b').value = state.d.b; $('d-N').value = state.d.N;
    $('e-n').value = state.e.n; $('e-x').value = state.e.x; $('e-N').value = state.e.N;
    syncSev(); syncKind(); syncConf();
    buildOcRows();
  }
  // テーマ切り替え時にグラフの色を描き直す
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render); } catch (e) { /* 古いブラウザ */ }
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });

  // PWA: Service Worker を登録（HTTPS か localhost のときだけ動く。埋め込み表示では登録しない）
  if (!embedded && 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            // 既存版が動いている状態で新版が入ったときだけ知らせる
            if (w.state === 'installed' && navigator.serviceWorker.controller) toast('新しい版を取り込んだ。開き直すと反映される');
          });
        });
      }).catch(() => { /* 登録できなくても計算には影響しない */ });
    });
  }
  loadUrl();
  fillInputs();
  setTab(state.tab);
})();
