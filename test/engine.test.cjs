/*!
 * 算24点 · 引擎验证测试 (node test/engine.test.cjs)
 * 核心原则：用「另一套独立实现」交叉验证，而不是自己验自己。
 */
const E = require('../src/engine.js');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n\x1b[36m== ' + t + '\x1b[0m'); }

/* ------------------------------------------------------------------ *
 * 独立实现 A：分数算术 + 5 种括号模板穷举（与引擎的"递归归约法"完全不同）
 * ------------------------------------------------------------------ */
function R(n, d) {
  if (d === 0) return null;
  if (d < 0) { n = -n; d = -d; }
  let a = Math.abs(n), b = Math.abs(d);
  while (b) { const t = a % b; a = b; b = t; }
  const g = a || 1;
  return [n / g, d / g];
}
const RA = (x, y) => R(x[0] * y[1] + y[0] * x[1], x[1] * y[1]);
const RS = (x, y) => R(x[0] * y[1] - y[0] * x[1], x[1] * y[1]);
const RM = (x, y) => R(x[0] * y[0], x[1] * y[1]);
const RD = (x, y) => (y[0] === 0 ? null : R(x[0] * y[1], x[1] * y[0]));
const ROP = [RA, RS, RM, RD];
const is24 = (x) => x && x[1] === 1 && x[0] === 24;

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i]].concat(p));
  }
  return out;
}

/** 独立求解器：模板穷举 */
function bruteSolvable(nums) {
  for (const [a, b, c, d] of permutations(nums)) {
    const A = R(a, 1), B = R(b, 1), C = R(c, 1), D = R(d, 1);
    for (const o1 of ROP) for (const o2 of ROP) for (const o3 of ROP) {
      let t;
      t = o1(A, B); if (t) { t = o2(t, C); if (t) { t = o3(t, D); if (is24(t)) return true; } }
      t = o2(B, C); if (t) { const u = o1(A, t); if (u) { const v = o3(u, D); if (is24(v)) return true; } }
      const AB = o1(A, B), CD = o3(C, D);
      if (AB && CD) { const v = o2(AB, CD); if (is24(v)) return true; }
      t = o2(B, C); if (t) { t = o3(t, D); if (t) { const v = o1(A, t); if (is24(v)) return true; } }
      t = o3(C, D); if (t) { t = o2(B, t); if (t) { const v = o1(A, t); if (is24(v)) return true; } }
    }
  }
  return false;
}

/* ================================================================== */
section('1. 分数算术精确性');
{
  const f = E.frac;
  ok('frac 约分', f(4, 8).n === 1 && f(4, 8).d === 2);
  ok('frac 负分母归一', f(1, -2).n === -1 && f(1, -2).d === 2);
  ok('frac 零', f(0, 5).n === 0 && f(0, 5).d === 1);
  const a = f(1, 3), b = f(1, 6);
  const s = E.OPS[0].f(a, b);
  ok('1/3 + 1/6 = 1/2', s.n === 1 && s.d === 2, E.fnums(s));
  const d = E.OPS[3].f(f(1, 1), f(3, 1));
  ok('1 ÷ 3 = 1/3', d.n === 1 && d.d === 3);
  ok('除以零返回 null', E.OPS[3].f(f(1, 1), f(0, 1)) === null);
  ok('(8/3) 不产生浮点误差', E.OPS[3].f(f(8, 1), f(3, 1)).n === 8);
}

section('2. 已知题目 - 求解器正确性');
{
  const cases = [
    { nums: [3, 3, 8, 8], want: true, note: '经典分数题 8/(3-8/3)' },
    { nums: [1, 1, 1, 1], want: false, note: '无解' },
    { nums: [1, 1, 1, 2], want: false, note: '无解' },
    { nums: [4, 6, 2, 3], want: true, note: '常规解' },
    { nums: [1, 3, 4, 6], want: true, note: '经典分数题 6/(1-3/4)' },
    { nums: [5, 5, 5, 1], want: true, note: '经典分数题 5*(5-1/5)' },
    { nums: [1, 5, 5, 5], want: true, note: '同上换序' },
    { nums: [13, 13, 13, 13], want: false, note: '四张 K 无解' },
    { nums: [7, 7, 7, 7], want: false, note: '四张 7 无解' },
    { nums: [6, 6, 6, 6], want: true, note: '6+6+6+6' },
    { nums: [12, 12, 12, 12], want: true, note: '12+12+12-12' }
  ];
  for (const c of cases) {
    const got = E.solveAll(c.nums, 2000).length > 0;
    ok('solveAll ' + JSON.stringify(c.nums) + ' (' + c.note + ')', got === c.want, 'got=' + got);
    const bf = bruteSolvable(c.nums);
    ok('独立实现同意 ' + JSON.stringify(c.nums), bf === c.want, 'brute=' + bf);
  }
}

section('3. 全空间交叉验证（1..13 全部 1820 个 4 数组合）');
{
  let checked = 0, mismatch = 0, solvable = 0;
  const mismatchList = [];
  for (let a = 1; a <= 13; a++)
    for (let b = a; b <= 13; b++)
      for (let c = b; c <= 13; c++)
        for (let d = c; d <= 13; d++) {
          const nums = [a, b, c, d];
          const mine = E.solveAll(nums, 2000).length > 0;
          const theirs = bruteSolvable(nums);
          checked++;
          if (mine) solvable++;
          if (mine !== theirs) { mismatch++; if (mismatchList.length < 8) mismatchList.push(nums.join(',')); }
        }
  ok('检查数量 = 1820', checked === 1820, String(checked));
  ok('两套独立实现完全一致', mismatch === 0, '不一致: ' + mismatchList.join(' | '));
  console.log('   可解组合数: ' + solvable + ' / ' + checked);
}

section('4. 分数判定准确性');
{
  for (let a = 1; a <= 13; a++)
    for (let b = a; b <= 13; b++)
      for (let c = b; c <= 13; c++)
        for (let d = c; d <= 13; d++) {
          const nums = [a, b, c, d];
          const sols = E.solveAll(nums, 2000);
          if (!sols.length) continue;
          const needsFrac = !E.solveIntOnly(nums);
          // 独立判定：用独立实现只跑整数路径
          let intOnly = false;
          (function search(arr) {
            if (intOnly) return;
            if (arr.length === 1) { if (arr[0] === 24) intOnly = true; return; }
            for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
              const x = arr[i], y = arr[j], rest = arr.filter((_, k) => k !== i && k !== j);
              const cs = [x + y, x - y, y - x, x * y];
              if (y !== 0 && x % y === 0) cs.push(x / y);
              if (x !== 0 && y % x === 0) cs.push(y / x);
              for (const r of cs) search(rest.concat([r]));
            }
          })(nums);
          if (intOnly === needsFrac) {  // intOnly 为 true 时 needsFrac 应为 false
            ok('needsFraction 判定 ' + nums.join(','), false, 'needsFrac=' + needsFrac + ' intOnly=' + intOnly);
            return;
          }
        }
  ok('needsFraction 与独立整数穷举完全一致', true);
  const frac4 = E.solveAll([3, 3, 8, 8], 2000);
  ok('[3,3,8,8] 必须用分数', !E.solveIntOnly([3, 3, 8, 8]));
  ok('[3,3,8,8] 解字符串可读', frac4.every(s => /[+\-−×÷]/.test(s)), frac4[0]);
}

section('5. 提示求解器 solveSteps —— 模拟真实对局');
{
  function evalExpr(expr) {
    const src = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    return Function('"use strict";return (' + src + ')')();
  }
  // 用 1..13 全部可解组合做端到端模拟：按步骤走必须真的能到 24
  let tested = 0, bad = 0, exprBad = 0;
  const badList = [], exprBadList = [];
  for (let a = 1; a <= 13; a++)
    for (let b = a; b <= 13; b++)
      for (let c = b; c <= 13; c++)
        for (let d = c; d <= 13; d++) {
          const nums = [a, b, c, d];
          if (!E.solveAll(nums, 2000).length) continue;
          tested++;
          const steps = E.solveSteps(nums.map(v => E.frac(v, 1)));
          if (!steps) { bad++; if (badList.length < 5) badList.push(nums.join(',') + ':无步骤'); continue; }
          // 模拟：按步骤逐张合并
          let cards = nums.map(v => E.frac(v, 1));
          let broken = false;
          for (const st of steps) {
            const ia = cards.findIndex(v => E.eqF(v, st.a));
            if (ia < 0) { broken = true; break; }
            const left = cards.filter((_, k) => k !== ia);
            const ib = left.findIndex(v => E.eqF(v, st.b));
            if (ib < 0) { broken = true; break; }
            cards = left.filter((_, k) => k !== ib).concat([st.r]);
          }
          if (broken || cards.length !== 1 || !E.eqTarget(cards[0])) {
            bad++;
            if (badList.length < 5) badList.push(nums.join(','));
          }
          // solveExpr 还原出的表达式必须：等于 24，且恰好用掉这四张牌
          const expr = E.solveExpr(nums.map(v => E.frac(v, 1))) || '';
          const used = (expr.match(/\d+/g) || []).map(Number).sort((x, y) => x - y);
          const v = expr ? evalExpr(expr) : NaN;
          if (Math.abs(v - 24) > 1e-9 || used.join(',') !== nums.slice().sort((x, y) => x - y).join(',')) {
            exprBad++;
            if (exprBadList.length < 5) exprBadList.push(nums.join(',') + ' → ' + expr + ' = ' + v);
          }
        }
  ok('全部 ' + tested + ' 个可解题目，提示步骤均能走到 24', bad === 0, '失败 ' + bad + ' 例: ' + badList.join(' | '));
  ok('solveExpr 还原的表达式均等于 24 且恰好用完四张牌', exprBad === 0,    '失败 ' + exprBad + ' 例: ' + exprBadList.join(' | '));
  const st = E.solveSteps([E.frac(3, 1), E.frac(3, 1), E.frac(8, 1), E.frac(8, 1)]);
  ok('[3,3,8,8] 提示步骤长度为 3', !!st && st.length === 3);
  const e3388 = E.solveExpr([E.frac(3, 1), E.frac(3, 1), E.frac(8, 1), E.frac(8, 1)]);
  ok('[3,3,8,8] 表达式等于 24', Math.abs(evalExpr(e3388) - 24) < 1e-9, e3388);
  ok('[3,3,8,8] 表达式只用到 3 和 8',
    (e3388.match(/\d+/g) || []).map(Number).sort((x, y) => x - y).join(',') === '3,3,8,8', e3388);
  console.log('   [3,3,8,8] 的提示解法: ' + e3388);
  const kidExpr = E.solveExpr([E.frac(2, 1), E.frac(7, 1), E.frac(5, 1), E.frac(4, 1)], E.KID_OPS, 10);
  ok('儿童模式表达式只用原牌且等于目标值',
    Math.abs(evalExpr(kidExpr) - 10) < 1e-9 &&
    (kidExpr.match(/\d+/g) || []).map(Number).sort((x, y) => x - y).join(',') === '2,4,5,7',
    kidExpr);
  console.log('   2 7 5 4 凑 10 的解法: ' + kidExpr);
}

section('6. 300 关关卡生成');
{
  const all = [];
  let tierProblems = [];
  for (let t = 0; t < E.TOTAL_TIERS; t++) {
    const pool = E.genTier(t);
    if (pool.length !== 20) tierProblems.push('第' + (t + 1) + '章只有 ' + pool.length + ' 关');
    for (const p of pool) all.push(p);
  }
  ok('共 300 关', all.length === 300, String(all.length));
  ok('每章都是 20 关', tierProblems.length === 0, tierProblems.join('; '));

  const keys = new Set(all.map(p => p.nums.slice().sort((a, b) => a - b).join(',')));
  ok('300 关题目互不重复', keys.size === 300, '去重后 ' + keys.size);

  let unsolvable = 0, outOfRange = [];
  for (let t = 0; t < E.TOTAL_TIERS; t++) {
    const cfg = E.TIERS[t];
    for (const p of E.genTier(t)) {
      if (!E.solveAll(p.nums, 2000).length) unsolvable++;
      for (const v of p.nums) if (v < 1 || v > 13) outOfRange.push(t + ':' + p.nums.join(','));
    }
  }
  ok('300 关全部有解', unsolvable === 0, '无解 ' + unsolvable);
  ok('牌面均在 1~13', outOfRange.length === 0, outOfRange.slice(0, 5).join(' | '));

  const allFracHands = new Set();
  for (const n of E.allMultisets(1, 13)) {
    if (n[0] === n[3]) continue;
    if (E.solveAll(n, 2000).length && !E.solveIntOnly(n)) allFracHands.add(n.join(','));
  }
  const ch15 = new Set(E.genTier(14).map(p => p.nums.slice().sort((a, b) => a - b).join(',')));
  let fracInEarly = 0;
  for (let t = 0; t < 14; t++) {
    for (const p of E.genTier(t)) if (!E.solveIntOnly(p.nums)) fracInEarly++;
  }
  ok('分数经典题不在前 14 章出现', fracInEarly === 0, String(fracInEarly));
  ok('全部 ' + allFracHands.size + ' 道"必须用分数"的经典题都收进第 15 章',
    [...allFracHands].every(k => ch15.has(k)), allFracHands.size + ' → 命中 ' + [...allFracHands].filter(k => ch15.has(k)).length);
  ok('第 15 章后 16 关全部是"必须用分数"的经典题',
    E.genTier(14).slice(-16).every(p => p.needsFraction),
    E.genTier(14).map(p => p.count).join(','));
  console.log('   "必须用分数"的经典题共 ' + allFracHands.size + ' 道，例如: ' +
    [...allFracHands].slice(0, 6).join('  '));

  const lv1 = E.getLevel(1), lv300 = E.getLevel(300);
  ok('getLevel(1) 合法', lv1.n === 1 && lv1.nums.length === 4);
  ok('getLevel(300) 合法', lv300.n === 300 && lv300.nums.length === 4);
  ok('getLevel 越界钳制', E.getLevel(999).n === 300 && E.getLevel(-5).n === 1);
  ok('关卡生成确定性（两次调用一致）', JSON.stringify(E.getLevel(137).nums) === JSON.stringify(E.getLevel(137).nums));

  const cnts = [];
  for (let t = 0; t < 15; t++) cnts.push(E.genTier(t).map(p => p.count));
  const maxOf = g => Math.max(...g.flatMap(p => p.nums));
  const avgEarlyMax = [0, 1, 2, 3, 4].reduce((s, t) => s + maxOf(E.genTier(t)), 0) / 5;
  const avgLateMax = [10, 11, 12].reduce((s, t) => s + maxOf(E.genTier(t)), 0) / 3;
  ok('难度确实递增（后期牌面明显更大）', avgLateMax > avgEarlyMax + 3,
    '前期最大牌面均值=' + avgEarlyMax.toFixed(1) + ' 后期=' + avgLateMax.toFixed(1));
  console.log('   各章最大牌面: ' + cnts.map((_, t) => maxOf(E.genTier(t))).join(' | '));
  console.log('   各章平均解数: ' + cnts.map(c => (c.reduce((a, b) => a + b, 0) / 20).toFixed(1)).join(' | '));

  let badOrder = 0;
  for (let t = 0; t < 15; t++) {
    const c = E.genTier(t).map(p => p.diff);
    for (let i = 1; i < c.length; i++) if (c[i] < c[i - 1] - 1e-9) badOrder++;
  }
  ok('章内难度平滑（难度分单调不减）', badOrder === 0, '逆序 ' + badOrder + ' 处');

  const all300 = [];
  for (let t = 0; t < E.TOTAL_TIERS; t++) for (const p of E.genTier(t)) all300.push(p);
  let globalBad = 0, firstBad = -1;
  for (let i = 1; i < 300; i++) {
    if (all300[i].diff < all300[i - 1].diff - 1e-9) { globalBad++; if (firstBad < 0) firstBad = i; }
  }
  ok('300 关全局难度单调不减', globalBad === 0,
    '逆序 ' + globalBad + ' 处，首个位置 ' + (firstBad + 1) + ' (' +
    (firstBad > 0 ? all300[firstBad - 1].diff.toFixed(2) + '→' + all300[firstBad].diff.toFixed(2) : '') + ')');
  const ch1max = maxOf(E.genTier(0));
  ok('第 1 章全是小数字（最大牌面 ≤ 6）', ch1max <= 6, '最大牌面 ' + ch1max);
  ok('第 1 关确实简单', all300[0].count >= 3 && Math.max(...all300[0].nums) <= 6,
    all300[0].nums.join(',') + ' 解数 ' + all300[0].count);
  ok('第 300 关是全场最难的题之一', all300[299].count === 1 && all300[299].needsFraction,
    '解数 ' + all300[299].count);
  console.log('   第1关 ' + all300[0].nums.join(',') + '（' + all300[0].count + ' 解）  →  '
    + '第300关 ' + all300[299].nums.join(',') + '（' + all300[299].count + ' 解, '
    + (all300[299].needsFraction ? '必须用分数' : '整数解') + '）');
}

section('7. 表达式渲染正确性');
{
  const t = E.solveAll([3, 3, 8, 8], 2000);
  const withParen = t.filter(s => s.indexOf('(') >= 0);
  ok('[3,3,8,8] 解中包含括号形式', withParen.length > 0, t.slice(0, 5).join(' ; '));
  // 所有解字符串都能被安全求值回 24
  function evalExpr(expr) {
    const src = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    return Function('"use strict";return (' + src + ')')();
  }
  let bad = [];
  for (const nums of [[3, 3, 8, 8], [1, 3, 4, 6], [5, 5, 5, 1], [4, 6, 2, 3]]) {
    for (const s of E.solveAll(nums, 2000)) {
      const v = evalExpr(s);
      if (Math.abs(v - 24) > 1e-9) { bad.push(s + '=' + v); break; }
    }
  }
  ok('所有解的字符串求值均等于 24', bad.length === 0, bad.slice(0, 5).join(' | '));
}

section('8. 儿童模式（仅加减）');
{
  // 独立判定：只用 + − 时可达值恰好是全部 ±a±b±c±d
  function signComboHits(nums, target) {
    for (let mask = 0; mask < 16; mask++) {
      let s = 0;
      for (let i = 0; i < 4; i++) s += (mask >> i & 1) ? nums[i] : -nums[i];
      if (s === target) return true;
    }
    return false;
  }

  // 随机拆分函数
  let compBad = 0;
  const rng = E.mulberry32(12345);
  for (let i = 0; i < 5000; i++) {
    const total = 4 + Math.floor(rng() * 30);
    const n = 2 + Math.floor(rng() * 3);
    const maxN = 5 + Math.floor(rng() * 5);
    const parts = E.randomComposition(rng, total, n, maxN);
    if (parts === null) {
      if (total >= n && total <= n * maxN) compBad++;
      continue;
    }
    if (parts.length !== n) compBad++;
    else if (parts.reduce((a, b) => a + b, 0) !== total) compBad++;
    else if (parts.some(v => v < 1 || v > maxN)) compBad++;
  }
  ok('randomComposition 拆分正确', compBad === 0, String(compBad));

  // 各目标 × 各牌面范围，大规模抽样
  let total8 = 0, unsolvable = 0, outOfRange = 0, allSame = 0, mismatch = 0;
  const seenHands = new Set();
  const combos = [];
  for (const target of E.KID_TARGETS) {
    for (const maxN of [6, 9]) combos.push([target, maxN]);
  }
  for (const [target, maxN] of combos) {
    const r = E.mulberry32(target * 1000 + maxN);
    for (let i = 0; i < 800; i++) {
      const h = E.randomKidHand(target, maxN, r);
      total8++;
      seenHands.add(target + ':' + h.nums.slice().sort((a, b) => a - b).join(','));
      if (h.nums.some(v => v < 1 || v > h.maxN)) outOfRange++;   // 以实际生效范围为准
      if (new Set(h.nums).size === 1) allSame++;
      if (!signComboHits(h.nums, target)) unsolvable++;              // 独立判定
      const mine = E.solveSteps(h.nums.map(v => E.frac(v, 1)), E.KID_OPS, target); // 引擎判定
      if (!!mine !== signComboHits(h.nums, target)) mismatch++;      // 两者必须一致
      if (!mine) unsolvable++;
      if (h.example && E.solveSteps(h.nums.map(v => E.frac(v, 1)), E.KID_OPS, target) === null) unsolvable++;
    }
  }
  ok('抽样 ' + total8 + ' 道儿童题：全部仅用加减可解', unsolvable === 0, String(unsolvable));
  ok('牌面均在生效范围内', outOfRange === 0, String(outOfRange));
  ok('不出现四张全同', allSame === 0, String(allSame));
  ok('引擎判定与独立符号组合判定一致', mismatch === 0, String(mismatch));
  ok('题目足够多样（去重后 > 400）', seenHands.size > 400, String(seenHands.size));
  ok('每个组合的可用题库都不少于 8 道',
    combos.every(([t2, m2]) => E.kidPool(t2, E.randomKidHand(t2, m2, E.mulberry32(1)).maxN).length >= 8),
    combos.map(([t2, m2]) => t2 + '/' + m2 + '=' + E.kidPool(t2, E.randomKidHand(t2, m2, E.mulberry32(1)).maxN).length).join(' '));

  // 题目按目标值收敛：不能用乘除
  let crossed = 0;
  for (const [target, maxN] of combos) {
    const r = E.mulberry32(target * 7 + maxN);
    for (let i = 0; i < 100; i++) {
      const h = E.randomKidHand(target, maxN, r);
      const steps = E.solveSteps(h.nums.map(v => E.frac(v, 1)), E.KID_OPS, target);
      if (steps && steps.some(s => s.op !== '+' && s.op !== '−')) crossed++;
    }
  }
  ok('提示步骤中不出现乘除', crossed === 0, String(crossed));

  // 每个目标值 × 每个牌面范围都能出题
  const infeasible = [];
  for (const [target, maxN] of combos) {
    let bad = 0;
    const r = E.mulberry32(target + maxN);
    for (let i = 0; i < 200; i++) {
      const h = E.randomKidHand(target, maxN, r);
      if (!signComboHits(h.nums, target)) bad++;
    }
    if (bad) infeasible.push(target + '/max' + maxN + ':' + bad);
  }
  ok('所有「目标值 × 牌面范围」组合均可持续出题', infeasible.length === 0, infeasible.join(' | '));

  // 目标 10 的样例展示
  const demo = [];
  const r2 = E.mulberry32(2024);
  for (let i = 0; i < 5; i++) {
    const h = E.randomKidHand(10, 9, r2);
    demo.push(h.nums.join(' ') + ' → ' + h.example);
  }
  console.log('   目标10 样题: ' + demo.join('  |  '));
}

section('9. 儿童模式边界与兼容性');
{
  ok('旧调用方式仍然可用（不传 allowed 表示四则全开）',
    E.solveAll([3, 3, 8, 8], 2000).length > 0);
  ok('solveSteps 不传 allowed 时按 24 求解',
    !!E.solveSteps([E.frac(4, 1), E.frac(6, 1), E.frac(2, 1), E.frac(3, 1)]));
  ok('限定运算符后 [3,3,8,8] 无解（因为必须用除法）',
    E.solveAll([3, 3, 8, 8], 100, E.KID_OPS).length === 0);
  ok('9 9 9 3 用加减可解', E.solveAll([9, 9, 9, 3], 100, E.KID_OPS).length > 0,
    E.solveAll([9, 9, 9, 3], 100, E.KID_OPS)[0]);
  ok('solveSteps 支持自定义目标值',
    E.solveSteps([E.frac(3, 1), E.frac(4, 1), E.frac(5, 1), E.frac(2, 1)], E.KID_OPS, 10) !== null);
  ok('opsOf 回退：非法符号仍返回全部', E.opsOf(['@']).length === 4);
  ok('KID_TARGETS 合法', E.KID_TARGETS.every(t => t >= 4 && t <= 24));
}

/* ================================================================== */
console.log('\n' + '─'.repeat(60));
if (fail === 0) {
  console.log('\x1b[32m✓ 全部通过：' + pass + ' 项断言\x1b[0m');
} else {
  console.log('\x1b[31m✗ ' + fail + ' 项失败 / ' + (pass + fail) + ' 项\x1b[0m');
  failures.slice(0, 30).forEach(f => console.log('   - ' + f));
}
console.log('─'.repeat(60));
process.exit(fail === 0 ? 0 : 1);
