/*!
 * 关卡固化脚本：把引擎现场生成的 300 关写成 src/levels.js
 *
 * 为什么要在构建期固化？
 *   运行时现场搜索 300 关需要分析 1820 个组合（约 2~4 秒），
 *   固化后 iPad 打开即玩、零等待，而且跨设备题目完全一致。
 *
 * 用法：node tools/gen-levels.cjs
 */
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

const t0 = Date.now();
const packed = E.exportLevels();

if (packed.length !== E.TOTAL_LEVELS) {
  console.error('✗ 关卡数量不对: ' + packed.length + ' ≠ ' + E.TOTAL_LEVELS);
  process.exit(1);
}

// 逐关复验：可解 + 编码可还原
const seen = new Set();
for (let i = 0; i < packed.length; i++) {
  const nums = E.unpackLevel(packed[i]);
  if (nums.length !== 4) { console.error('✗ 第 ' + (i + 1) + ' 关解码失败'); process.exit(1); }
  if (nums.some(v => v < 1 || v > 13)) { console.error('✗ 第 ' + (i + 1) + ' 关数值越界'); process.exit(1); }
  if (!E.solveAll(nums, 2000).length) { console.error('✗ 第 ' + (i + 1) + ' 关无解: ' + nums.join(',')); process.exit(1); }
  const k = nums.slice().sort((a, b) => a - b).join(',');
  if (seen.has(k)) { console.error('✗ 第 ' + (i + 1) + ' 关与前面重复: ' + k); process.exit(1); }
  seen.add(k);
}

const lines = [];
lines.push('/*!');
lines.push(' * 算24点 · 关卡数据（由 tools/gen-levels.cjs 自动生成，请勿手改）');
lines.push(' *');
lines.push(' * 共 ' + packed.length + ' 关 = ' + E.TOTAL_TIERS + ' 章 × ' + E.LEVELS_PER_TIER + ' 关。');
lines.push(' * 每关 4 个字符，字符 A~M 分别代表数字 1~13（例如 "ABCE" = 1,2,3,5）。');
lines.push(' * 难度已由引擎排好序：越靠后越难，最后 16 关必须使用分数。');
lines.push(' * 生成时间 ' + new Date().toISOString() + '，耗时 ' + (Date.now() - t0) + 'ms。');
lines.push(' */');
lines.push('var P24_LEVELS = [');

for (let t = 0; t < E.TOTAL_TIERS; t++) {
  const chunk = packed.slice(t * E.LEVELS_PER_TIER, (t + 1) * E.LEVELS_PER_TIER);
  const nums = chunk.map(c => E.unpackLevel(c).join(','));
  lines.push('  // 第 ' + (t + 1) + ' 章 ' + E.TIERS[t].name);
  for (let i = 0; i < chunk.length; i++) {
    const tail = (t === E.TOTAL_TIERS - 1 && i === chunk.length - 1) ? '' : ',';
    lines.push("  '" + chunk[i] + "'" + tail + "  // " + (t * E.LEVELS_PER_TIER + i + 1) + ': ' + nums[i]);
  }
}
lines.push('];');
lines.push('');
lines.push('if (typeof module === "object" && module.exports) module.exports = P24_LEVELS;');
lines.push('if (typeof window !== "undefined") window.P24_LEVELS = P24_LEVELS;');
lines.push('');

const out = path.join(__dirname, '..', 'src', 'levels.js');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('✓ 已生成 ' + out);
console.log('  ' + packed.length + ' 关，全部复验通过（可解 / 不重复 / 编码可逆）');
console.log('  文件大小 ' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB，耗时 ' + (Date.now() - t0) + 'ms');
