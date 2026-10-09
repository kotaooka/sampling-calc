// Node で照合テストを実行する（node tests/test.js）。不一致が1件でもあれば終了コード 1
// ブラウザで結果を一覧したいときは tests/test.html を開く（照合ロジックは check.js で共通）
const S = require('../js/stats.js');
const T = require('../js/aql-table.js');
const REFERENCE = require('./reference.js');
const ORIG = require('./mil105e-legible.js');
const runChecks = require('./check.js');

const rows = runChecks(S, T, REFERENCE, ORIG);
const fails = rows.filter(r => !r[4]);
for (const [kind, cond, got, exp] of fails) {
  console.log(`NG  ${kind}  ${cond}\n    計算値 ${got}\n    参照値 ${exp}`);
}
// 種類ごとの件数
const count = {};
for (const r of rows) count[r[0]] = (count[r[0]] || 0) + 1;
console.log(Object.entries(count).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(fails.length ? `${fails.length} 件不一致 / ${rows.length} 件` : `全 ${rows.length} 件一致`);
process.exitCode = fails.length ? 1 : 0;
