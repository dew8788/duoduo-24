/*!
 * 算24点 · 核心引擎 (engine.js)
 * ------------------------------------------------------------------
 * 1) 精确分数运算：避免 8/(3-8/3)=24 这类题目的浮点误差
 * 2) 全解枚举求解器：递归归约法，天然覆盖全部 5 种括号结构
 *    支持「限定运算符」——儿童模式只用 + 和 −
 * 3) 提示求解器 solveSteps：返回「可用的一步」，与玩家当前盘面无关
 * 4) 确定性关卡生成：300 关 = 15 章 × 20 关，种子固定，跨设备一致
 * 5) 儿童模式出题：构造法，保证仅用加减必有一解
 *
 * 同时可在浏览器 (window.P24Engine) 与 Node (require) 中使用。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P24Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TARGET = 24;
  var ALL_OPS = ['+', '−', '×', '÷'];
  var KID_OPS = ['+', '−'];

  /* ============================ 精确分数 ============================ */

  function gcd(a, b) {
    a = a < 0 ? -a : a;
    b = b < 0 ? -b : b;
    while (b) { var t = a % b; a = b; b = t; }
    return a || 1;
  }

  /** 构造既约分数 {n, d}，d > 0 */
  function frac(n, d) {
    d = (d === undefined) ? 1 : d;
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d);
    return { n: n / g, d: d / g };
  }

  var ONE = frac(1, 1);

  function isInt(a) { return a.d === 1; }
  function eqF(a, b) { return a.n === b.n && a.d === b.d; }
  function eqTarget(a) { return a.d === 1 && a.n === TARGET; }
  function eqNum(a, k) { return a.d === 1 && a.n === k; }
  function fnums(a) { return a.d === 1 ? String(a.n) : a.n + '/' + a.d; }
  function fval(a) { return a.n / a.d; }

  /* ============================ 四则运算 ============================ */

  var OPS = [
    { s: '+', p: 1, c: true,  f: function (a, b) { return frac(a.n * b.d + b.n * a.d, a.d * b.d); } },
    { s: '−', p: 1, c: false, f: function (a, b) { return frac(a.n * b.d - b.n * a.d, a.d * b.d); } },
    { s: '×', p: 2, c: true,  f: function (a, b) { return frac(a.n * b.n, a.d * b.d); } },
    { s: '÷', p: 2, c: false, f: function (a, b) { return b.n === 0 ? null : frac(a.n * b.d, a.d * b.n); } }
  ];

  var OP_BY_SYM = {};
  for (var oi = 0; oi < OPS.length; oi++) OP_BY_SYM[OPS[oi].s] = OPS[oi];

  var ATOM_P = 99; // 原子节点优先级，恒不触发括号

  /** 取允许使用的运算符表；allowed 为空表示四则全开 */
  function opsOf(allowed) {
    if (!allowed || !allowed.length) return OPS;
    var out = [];
    for (var i = 0; i < OPS.length; i++) if (allowed.indexOf(OPS[i].s) >= 0) out.push(OPS[i]);
    return out.length ? out : OPS;
  }

  /**
   * 合并两个表达式节点。节点形如 { v: 分数, e: 表达式串, p: 顶层运算符优先级 }
   * 加法/乘法自动按字符串规范化操作数顺序，便于后续去重。
   */
  function combine(A, B, opSym) {
    var op = OP_BY_SYM[opSym];
    if (!op) return null;
    var a = A, b = B;
    if (op.c && a.e > b.e) { var t = a; a = b; b = t; }
    var r = op.f(a.v, b.v);
    if (!r) return null; // 除以零
    var wrapL = a.p < op.p;
    var wrapR = (b.p < op.p) || (b.p === op.p && !op.c);
    return {
      v: r,
      e: (wrapL ? '(' + a.e + ')' : a.e) + op.s + (wrapR ? '(' + b.e + ')' : b.e),
      p: op.p
    };
  }

  /* ============================ 全解枚举 ============================ */

  /**
   * 递归归约法求全部解。每次任取两张牌用任一允许的运算符合并，直到只剩一张；
   * 等价于遍历所有括号结构（5 种结构 × 4! 排列 × 4^3 运算符）。
   * @param {number[]} nums
   * @param {number} [limit] 最多收集多少条表达式
   * @param {string[]} [allowed] 允许的运算符，如 ['+','−']
   * @returns {string[]} 去重后的表达式字符串数组
   */
  function solveAll(nums, limit, allowed) {
    limit = limit || 2000;
    var ops = opsOf(allowed);
    var found = Object.create(null);
    var out = [];
    var items = [];
    for (var i = 0; i < nums.length; i++) items.push({ v: frac(nums[i], 1), e: String(nums[i]), p: ATOM_P });

    (function rec(arr) {
      if (out.length >= limit) return;
      if (arr.length === 1) {
        if (eqTarget(arr[0].v) && !found[arr[0].e]) { found[arr[0].e] = 1; out.push(arr[0].e); }
        return;
      }
      var n = arr.length;
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var rest = [];
          for (var k = 0; k < n; k++) if (k !== i && k !== j) rest.push(arr[k]);
          for (var t = 0; t < ops.length; t++) {
            var op = ops[t];
            // 非交换运算需同时尝试 (A op B) 与 (B op A)
            var pairs = op.c ? [[arr[i], arr[j]]] : [[arr[i], arr[j]], [arr[j], arr[i]]];
            for (var q = 0; q < pairs.length; q++) {
              var node = combine(
                { v: pairs[q][0].v, e: pairs[q][0].e, p: pairs[q][0].p },
                { v: pairs[q][1].v, e: pairs[q][1].e, p: pairs[q][1].p },
                op.s
              );
              if (!node) continue;
              rest.push(node);
              rec(rest);
              rest.pop();
            }
          }
          if (out.length >= limit) return;
        }
      }
    })(items);

    return out;
  }

  /** 是否存在「全程整数」的解法（用于判定该题是否必须使用分数） */
  function solveIntOnly(nums, allowed) {
    var ops = opsOf(allowed);
    var use = function (s) { for (var i = 0; i < ops.length; i++) if (ops[i].s === s) return true; return false; };
    var ok = false;
    (function rec(a) {
      if (ok) return;
      if (a.length === 1) { if (a[0] === TARGET) ok = true; return; }
      for (var i = 0; i < a.length; i++) {
        for (var j = i + 1; j < a.length; j++) {
          var x = a[i], y = a[j], rest = [];
          for (var k = 0; k < a.length; k++) if (k !== i && k !== j) rest.push(a[k]);
          var cands = [];
          if (use('+')) cands.push(x + y);
          if (use('−')) { cands.push(x - y); cands.push(y - x); }
          if (use('×')) cands.push(x * y);
          if (use('÷')) {
            if (y !== 0 && x % y === 0) cands.push(x / y);
            if (x !== 0 && y % x === 0) cands.push(y / x);
          }
          for (var c = 0; c < cands.length; c++) {
            rest.push(cands[c]);
            rec(rest);
            rest.pop();
            if (ok) return;
          }
        }
      }
    })(nums.slice());
    return ok;
  }

  /**
   * 求解「下一步该怎么走」——直接作用于当前盘面，因此天然支持提示功能。
   * @param {Array<{n:number,d:number}>} vals 当前存活牌的分数值
   * @param {string[]} [allowed] 允许的运算符
   * @param {number} [target] 目标值，默认 24
   * @returns {Array<{a:object,b:object,op:string,r:object}>|null}
   */
  /** 把「分数 / 数字 / 表达式节点」统一成表达式节点 */
  function toNodes(vals) {
    var out = [];
    for (var i = 0; i < vals.length; i++) {
      var x = vals[i];
      if (x && x.v) { out.push({ v: x.v, e: x.e, p: x.p }); continue; }
      var f = (x && typeof x === 'object' && x.n !== undefined) ? x : frac(x, 1);
      out.push({ v: f, e: fnums(f), p: ATOM_P });
    }
    return out;
  }

  /**
   * 求解核心：在递归过程中直接携带表达式节点。
   * 这样产出的表达式无歧义——不会把中间结果误当成原始牌。
   * @returns {{steps:Array, expr:string}|null}
   */
  function solveDetailed(vals, allowed, target) {
    var ops = opsOf(allowed);
    var tgt = (target === undefined || target === null) ? TARGET : target;
    var memo = Object.create(null);
    function key(a) {
      var s = [];
      for (var i = 0; i < a.length; i++) s.push(fnums(a[i].v));
      s.sort();
      return s.join('|');
    }
    function rec(a) {
      if (a.length === 1) return eqNum(a[0].v, tgt) ? { steps: [], expr: a[0].e } : null;
      var k = key(a);
      if (memo[k]) return null;
      for (var i = 0; i < a.length; i++) {
        for (var j = i + 1; j < a.length; j++) {
          var rest = [];
          for (var m = 0; m < a.length; m++) if (m !== i && m !== j) rest.push(a[m]);
          for (var t = 0; t < ops.length; t++) {
            var op = ops[t];
            // 非交换运算需同时尝试 (A op B) 与 (B op A)
            var pairs = op.c ? [[i, j]] : [[i, j], [j, i]];
            for (var q = 0; q < pairs.length; q++) {
              var A = a[pairs[q][0]], B = a[pairs[q][1]];
              var node = combine(A, B, op.s);
              if (!node) continue;                       // 除以零
              var sub = rec(rest.concat([node]));
              if (sub) {
                return {
                  steps: [{ a: A.v, b: B.v, op: op.s, r: node.v }].concat(sub.steps),
                  expr: sub.expr
                };
              }
            }
          }
        }
      }
      memo[k] = 1;   // 只缓存"无解"，因为可解性只取决于数值多重集
      return null;
    }
    return rec(toNodes(vals));
  }

  /**
   * 求解「下一步该怎么走」——直接作用于当前盘面，因此天然支持提示功能。
   * @param {Array} vals 当前存活牌的分数值（或带表达式的节点）
   * @param {string[]} [allowed] 允许的运算符
   * @param {number} [target] 目标值，默认 24
   * @returns {Array<{a:object,b:object,op:string,r:object}>|null}
   */
  function solveSteps(vals, allowed, target) {
    var r = solveDetailed(vals, allowed, target);
    return r ? r.steps : null;
  }

  /**
   * 直接给出完整解法表达式（形如 "8÷(3−8÷3)"），UI 的"看答案"用它。
   * @returns {string|null}
   */
  function solveExpr(vals, allowed, target) {
    var r = solveDetailed(vals, allowed, target);
    return r ? r.expr : null;
  }

  /** 返回第一个可行步骤与完整表达式（提示 + 答案一次拿全） */
  function solveBoth(vals, allowed, target) {
    var r = solveDetailed(vals, allowed, target);
    if (!r) return null;
    return { steps: r.steps, expr: r.expr, first: r.steps.length ? r.steps[0] : null };
  }

  /* ============================ 关卡生成 ============================ */

  var LEVELS_PER_TIER = 20;

  /*
   * 难度曲线说明（数据来自 tools/probe.cjs 对 1~13 全部 1820 个组合的统计）：
   *   · 1~13 共 1362 个组合可解；其中「必须用分数」的只有 16 个
   *   · 300 关不是按牌面范围机械划分，而是从一条全局难度曲线上均匀取样，
   *     因此章与章之间、章内关卡之间的难度都是单调递增的
   *   · 最后 20 关收齐全部 16 道分数经典题 + 4 道最难题，作为终极章节
   */
  var TIER_NAMES = [
    '幼儿园', '小学生', '初中生', '高中生', '大学生',
    '研究生', '博士生', '副教授', '教授', '数学专家',
    '阿基米德', '祖冲之', '高斯', '图灵', '数学之王'
  ];

  var TIERS = TIER_NAMES.map(function (name) { return { name: name }; });

  var TOTAL_TIERS = TIERS.length;
  var TOTAL_LEVELS = TOTAL_TIERS * LEVELS_PER_TIER;

  /** 确定性伪随机数发生器，保证同一关卡在任何设备上题目一致 */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var analyzeCache = Object.create(null);

  function handKey(nums) { return nums.slice().sort(function (a, b) { return a - b; }).join(','); }

  /** 分析一手牌：解数 + 是否必须用分数。按牌面多重集全局缓存，避免重复计算 */
  function analyze(nums, allowed) {
    var k = handKey(nums) + '@' + (allowed && allowed.length ? allowed.join('') : '*');
    var hit = analyzeCache[k];
    if (hit) return hit;
    var sols = solveAll(nums, 2000, allowed);
    var r = {
      count: sols.length,
      first: sols.length ? sols[0] : null,
      needsFraction: sols.length > 0 && !solveIntOnly(nums, allowed)
    };
    analyzeCache[k] = r;
    return r;
  }

  /** 某个牌面范围内全部「不计顺序」的四数组合（1~13 共 1820 个） */
  function allMultisets(min, max) {
    var out = [];
    for (var a = min; a <= max; a++)
      for (var b = a; b <= max; b++)
        for (var c = b; c <= max; c++)
          for (var d = c; d <= max; d++) out.push([a, b, c, d]);
    return out;
  }

  /**
   * 在已按难度排好序的池子里均匀取 count 个。
   * 索引严格递增，因此取出的序列难度单调，章内不会出现难度倒挂。
   */
  function pickSpread(pool, count) {
    var n = pool.length;
    if (n <= count) return pool.slice();
    if (count <= 1) return [pool[n - 1]];
    var step = (n - 1) / (count - 1);
    var out = [];
    for (var i = 0; i < count; i++) {
      var idx = Math.round(i * step);
      if (idx > n - 1) idx = n - 1;
      out.push(pool[idx]);
    }
    return out;
  }

  /**
   * 难度分（供关卡排序与 UI 提示使用）。
   * 光看"解数"并不能反映人类感受：1,4,8,12 有 69 个解，但对新手远难于 1,2,3,4。
   * 因此以「最大牌面」为主导，「数字总和」次之，「解数多少」再次之，
   * 必须用分数的题目直接判为最难。这样第 1 章必然全是小数字。
   */
  function difficultyOf(nums, count, needsFraction) {
    var sum = 0, maxNum = 0;
    for (var i = 0; i < nums.length; i++) {
      sum += nums[i];
      if (nums[i] > maxNum) maxNum = nums[i];
    }
    return (maxNum - 1) * 4
      + (sum - 4) / 48 * 2
      + (1 - Math.min(count, 40) / 40) * 1.5
      + (needsFraction ? 60 : 0);   // 必须用分数的题一律排到最后，独成一章
  }

  var allLevelsCache = null;

  /**
   * 生成全部 300 关（15 章 × 20 关）。
   *
   * 做法：先把 1~13 范围内所有可解牌面算出一个难度分并升序排列，再从这条
   * 全局难度曲线上均匀取 280 关切成前 14 章；最后 20 关由「最难的 4 道普通题
   * + 全部 16 道必须使用分数的经典题」组成，作为终极章节。
   * 保证：300 关互不重复、难度严格单调、且不浪费任何一道经典分数题。
   */
  function buildAllLevels() {
    if (allLevelsCache) return allLevelsCache;
    var ms = allMultisets(1, 13);
    var normal = [], frac = [];
    for (var i = 0; i < ms.length; i++) {
      var n = ms[i];
      if (n[0] === n[3]) continue;              // 四张全同，太无趣
      var a = analyze(n);
      if (!a.count) continue;                   // 无解
      var item = { nums: n, count: a.count, needsFraction: a.needsFraction };
      item.diff = difficultyOf(n, a.count, a.needsFraction);
      (a.needsFraction ? frac : normal).push(item);
    }
    var byDiff = function (x, y) { return x.diff - y.diff; };
    normal.sort(byDiff);
    frac.sort(byDiff);

    var hardTop = normal.slice(-4);            // 最难的 4 道普通题交给第 15 章
    var rest = normal.slice(0, -4);
    var main = pickSpread(rest, TOTAL_LEVELS - LEVELS_PER_TIER);

    allLevelsCache = [];
    for (var t = 0; t < TOTAL_TIERS - 1; t++) {
      allLevelsCache.push(main.slice(t * LEVELS_PER_TIER, (t + 1) * LEVELS_PER_TIER));
    }
    var last = hardTop.concat(frac);
    last.sort(byDiff);
    while (last.length < LEVELS_PER_TIER) last.push(hardTop[0]);
    allLevelsCache.push(last.slice(0, LEVELS_PER_TIER));
    return allLevelsCache;
  }

  /** 生成某一章（0 基）的 20 道题，由易到难排列 */
  function genTier(tier) {
    var t = Math.max(0, Math.min(TOTAL_TIERS - 1, tier | 0));
    return buildAllLevels()[t];
  }

  function packLevel(nums) {
    var s = '';
    for (var i = 0; i < nums.length; i++) s += String.fromCharCode(64 + nums[i]);
    return s;
  }
  function unpackLevel(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) - 64);
    return out;
  }

  /** 生成全部 300 关的紧凑编码（形如 ['ABCE', ...]），供离线打包固化使用 */
  function exportLevels() {
    var out = [];
    for (var t = 0; t < TOTAL_TIERS; t++) {
      var pool = genTier(t);
      for (var i = 0; i < pool.length; i++) out.push(packLevel(pool[i].nums));
    }
    return out;
  }

  var levelData = null;
  /** 注入打包好的 300 关，运行时即可瞬间出题（不必现场搜索） */
  function setLevelData(list) { levelData = (list && list.length) ? list : null; }

  /** 关卡号 1..300 → 完整关卡信息（优先使用注入的固化关卡表） */
  function getLevel(n) {
    var idx = Math.max(1, Math.min(TOTAL_LEVELS, n | 0)) - 1;
    var tier = Math.floor(idx / LEVELS_PER_TIER);
    var inTier = idx % LEVELS_PER_TIER;
    var nums, cnt, needFrac;

    if (levelData && levelData[idx]) {
      nums = unpackLevel(levelData[idx]);
      var a = analyze(nums);
      cnt = a.count;
      needFrac = a.needsFraction;
    } else {
      var pool = genTier(tier);
      var lv = pool[inTier] || { nums: [1, 2, 3, 4], count: 0, needsFraction: false };
      nums = lv.nums.slice();
      cnt = lv.count;
      needFrac = lv.needsFraction;
    }
    return {
      n: idx + 1,
      tier: tier,
      tierName: TIERS[tier].name,
      indexInTier: inTier,
      nums: nums,
      solutionCount: cnt,
      needsFraction: needFrac
    };
  }

  /** 自由练习：按章节范围随机出题 */
  function randomHand(tierIndex) {
    if (tierIndex === undefined || tierIndex === null || tierIndex < 0) {
      tierIndex = Math.floor(Math.random() * TOTAL_TIERS);
    }
    var rnd = mulberry32((Math.random() * 0xFFFFFFFF) >>> 0);
    var cfg = TIERS[tierIndex];
    for (var i = 0; i < 20000; i++) {
      var span = cfg.max - cfg.min + 1;
      var nums = [
        cfg.min + Math.floor(rnd() * span),
        cfg.min + Math.floor(rnd() * span),
        cfg.min + Math.floor(rnd() * span),
        cfg.min + Math.floor(rnd() * span)
      ];
      if (nums[0] === nums[1] && nums[1] === nums[2] && nums[2] === nums[3]) continue;
      var a = analyze(nums);
      if (a.count > 0) return { nums: nums, tier: tierIndex, solutionCount: a.count, needsFraction: a.needsFraction };
    }
    return { nums: [4, 6, 2, 3], tier: 0, solutionCount: 1, needsFraction: false };
  }

  /* ========================== 儿童模式出题 ========================== */
  /* 只用 + 和 − 时，四张牌的可达值恰好是 ±a±b±c±d。
     因此用构造法反向出题：先定"加数/减数"的分组，再拆分成四张牌，
     保证一定只用加减就有解。                                        */

  var KID_TARGETS = [10, 12, 15, 18, 24];

  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  /** 把 total 随机拆成 count 个 [1, maxN] 的整数；无解返回 null */
  function randomComposition(rng, total, count, maxN) {
    if (count <= 0) return total === 0 ? [] : null;
    if (total < count || total > count * maxN) return null;
    var parts = [];
    var remain = total;
    for (var i = 0; i < count; i++) {
      var slots = count - i - 1;
      var lo = Math.max(1, remain - slots * maxN);
      var hi = Math.min(maxN, remain - slots);
      if (lo > hi) return null;
      var v = randInt(rng, lo, hi);
      parts.push(v);
      remain -= v;
    }
    return remain === 0 ? parts : null;
  }

  function shuffle(rng, arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 某目标值下全部「仅用加减可解」的牌面（去重、不计顺序）。
   * 只用 + 和 − 时四张牌的可达值恰好是 ±a±b±c±d，
   * 因此这里直接枚举 16 种符号组合来判定，结论严格且不依赖乘除。
   */
  var kidPoolCache = Object.create(null);

  function kidSignHit(nums, target) {
    for (var m = 0; m < 16; m++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += ((m >> k) & 1) ? nums[k] : -nums[k];
      if (s === target) return true;
    }
    return false;
  }

  function kidPool(target, maxN) {
    var key = target + '/' + maxN;
    if (kidPoolCache[key]) return kidPoolCache[key];
    var out = [];
    var list = allMultisets(1, maxN);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n[0] === n[3]) continue;                 // 四张全同太单调
      if (!kidSignHit(n, target)) continue;
      var distinct = 1;
      for (var k = 1; k < 4; k++) if (n[k] !== n[k - 1]) distinct++;
      out.push({ nums: n, distinct: distinct });
    }
    kidPoolCache[key] = out;
    return out;
  }

  /** 某个目标值在指定牌面范围内可用的题型（全加 / 含减法）描述 */
  function kidShapeOf(nums, target) {
    return nums.reduce(function (a, b) { return a + b; }, 0) === target ? '++++' : '+++-';
  }

  /**
   * 生成一道「只用加减」的题。
   * @param {number} target 目标值（10/12/15/18/24）
   * @param {number} maxN   牌面最大值（若该范围内可用题目太少会自动放宽）
   * @param {function} [rng]
   */
  function randomKidHand(target, maxN, rng) {
    target = target || 10;
    maxN = maxN || 9;
    rng = rng || Math.random;

    // 牌面范围太小会导致题目极少（例如目标 24 且最大 6 时只有 6 6 6 6），自动放宽
    var tries = [maxN, 9, 13];
    var pool = null, usedMaxN = maxN;
    for (var t = 0; t < tries.length; t++) {
      if (tries[t] < maxN) continue;
      pool = kidPool(target, tries[t]);
      usedMaxN = tries[t];
      if (pool.length >= 8) break;
    }

    if (!pool || !pool.length) {
      return { nums: [3, 4, 5, 2], target: target, maxN: usedMaxN, shape: '+++-',
               ops: KID_OPS.slice(), solutionCount: 1, example: '3+4+5−2' };
    }

    // 优先挑「数字种类多」的题（更有意思），但不过度排斥重复数字
    var pick = null;
    for (var i = 0; i < 12; i++) {
      var cand = pool[Math.floor(rng() * pool.length)];
      if (!pick || cand.distinct > pick.distinct) pick = cand;
      if (rng() < 0.35) break;
    }
    if (!pick) pick = pool[Math.floor(rng() * pool.length)];

    var hand = shuffle(rng, pick.nums.slice());
    var expr = solveExpr(hand.map(function (v) { return frac(v, 1); }), KID_OPS, target);
    return {
      nums: hand,
      target: target,
      maxN: usedMaxN,
      shape: kidShapeOf(hand, target),
      ops: KID_OPS.slice(),
      solutionCount: pool.length,
      example: expr || ''
    };
  }

  /** 儿童模式可解性判定（给测试与 UI 用） */
  function kidSolvable(nums, target) {
    var e = solveExpr(nums.map(function (v) { return frac(v, 1); }), KID_OPS, target);
    return e ? [e] : [];
  }

  return {
    TARGET: TARGET,
    ALL_OPS: ALL_OPS,
    KID_OPS: KID_OPS,
    KID_TARGETS: KID_TARGETS,
    OPS: OPS,
    ATOM_P: ATOM_P,
    TIERS: TIERS,
    TOTAL_TIERS: TOTAL_TIERS,
    TOTAL_LEVELS: TOTAL_LEVELS,
    LEVELS_PER_TIER: LEVELS_PER_TIER,
    frac: frac,
    isInt: isInt,
    eqF: eqF,
    eqTarget: eqTarget,
    eqNum: eqNum,
    fnums: fnums,
    fval: fval,
    ONE: ONE,
    opsOf: opsOf,
    combine: combine,
    solveAll: solveAll,
    solveIntOnly: solveIntOnly,
    solveSteps: solveSteps,
    solveExpr: solveExpr,
    solveBoth: solveBoth,
    solveDetailed: solveDetailed,
    analyze: analyze,
    difficultyOf: difficultyOf,
    handKey: handKey,
    allMultisets: allMultisets,
    genTier: genTier,
    exportLevels: exportLevels,
    setLevelData: setLevelData,
    packLevel: packLevel,
    unpackLevel: unpackLevel,
    getLevel: getLevel,
    randomHand: randomHand,
    randomKidHand: randomKidHand,
    kidPool: kidPool,
    kidSignHit: kidSignHit,
    randomComposition: randomComposition,
    kidSolvable: kidSolvable,
    mulberry32: mulberry32
  };
});
