/* 校准脚本：统计 1..13 全部 1820 个 4 数组合的解数分布，用于设定各章阈值 */
const E = require('../src/engine.js');

const rows = [];
for (let a = 1; a <= 13; a++)
  for (let b = a; b <= 13; b++)
    for (let c = b; c <= 13; c++)
      for (let d = c; d <= 13; d++) {
        const nums = [a, b, c, d];
        const cnt = E.solveAll(nums, 4000).length;
        if (!cnt) continue;
        rows.push({ nums, cnt, frac: !E.solveIntOnly(nums) });
      }

console.log('可解组合: ' + rows.length);
const hist = {};
for (const r of rows) hist[r.cnt] = (hist[r.cnt] || 0) + 1;
const keys = Object.keys(hist).map(Number).sort((x, y) => x - y);
console.log('\n解数分布 (解数:组合数):');
let cum = 0;
for (const k of keys) { cum += hist[k]; console.log('  ' + String(k).padStart(3) + ' : ' + String(hist[k]).padStart(4) + '   累计 ' + cum); }

const fracRows = rows.filter(r => r.frac);
console.log('\n必须用分数的组合数: ' + fracRows.length);

console.log('\n各章候选数量（范围 + 解数区间 + 分数要求）:');
const TIERS = E.TIERS;
for (let t = 0; t < TIERS.length; t++) {
  const cfg = TIERS[t];
  const inRange = rows.filter(r => r.nums[0] >= cfg.min && r.nums[3] <= cfg.max
    && r.nums.every(v => v >= cfg.min && v <= cfg.max));
  const pass = inRange.filter(r => r.cnt >= cfg.minSol
    && (!cfg.maxSol || r.cnt <= cfg.maxSol)
    && (cfg.frac !== 'require' || r.frac)
    && (cfg.frac !== 'forbid' || !r.frac));
  console.log('  第' + String(t + 1).padStart(2) + '章 ' + cfg.name.padEnd(6, ' ')
    + ' 范围' + cfg.min + '-' + cfg.max
    + ' 解数[' + cfg.minSol + (cfg.maxSol ? ',' + cfg.maxSol : ',∞') + ']'
    + ' ' + cfg.frac.padEnd(7)
    + ' → 范围内 ' + String(inRange.length).padStart(4) + ' 个, 通过筛选 ' + String(pass.length).padStart(4) + ' 个'
    + (pass.length < 20 ? '   ←← 不足 20！' : ''));
}

console.log('\n分数题在各解数上的分布:');
const fh = {};
for (const r of fracRows) fh[r.cnt] = (fh[r.cnt] || 0) + 1;
const fk = Object.keys(fh).map(Number).sort((x, y) => x - y);
console.log('  ' + fk.map(k => k + ':' + fh[k]).join('  '));
