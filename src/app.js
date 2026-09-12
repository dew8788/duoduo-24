/*!
 * 算24点 · 界面与游戏逻辑 (app.js)
 * ------------------------------------------------------------------
 * 交互模型完全照 4399 原版：
 *   4 张牌固定在 2×2 的四个格位上 → 点第一张牌 → 点运算符 → 点第二张牌
 *   → 结果写回第二张牌的格位，第一张牌的格位清空（原版是 calc1Card 飞过去淡出）
 *
 * 三种模式：
 *   level    闯关：300 关，+ − × ÷
 *   kid      儿童：只用 + 和 −，目标固定 24
 *   practice 自由练习：随机题目
 */
(function () {
  'use strict';

  var E = window.P24Engine;
  if (!E) { alert('引擎加载失败'); return; }
  if (window.P24_LEVELS) E.setLevelData(window.P24_LEVELS);

  /* ============================ 小工具 ============================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function starHTML(n, total) {
    var out = '';
    for (var i = 0; i < (total || 3); i++) out += i < n ? '★' : '<span class="off">★</span>';
    return out;
  }
  function plainStars(n, total) {
    var out = '';
    for (var i = 0; i < (total || 3); i++) out += i < n ? '★' : '<span class="off">★</span>';
    return out;
  }

  /* ============================ 存档 ============================ */

  var STORE_KEY = 'p24.save.v2';
  var store = {
    unlocked: 1,
    stars: {},
    best: {},
    settings: { sound: true, vibrate: true, unlockAll: false }
  };

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY) || localStorage.getItem('p24.save.v1');
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.unlocked === 'number') store.unlocked = Math.min(E.TOTAL_LEVELS, Math.max(1, o.unlocked));
        if (o.stars && typeof o.stars === 'object') store.stars = o.stars;
        if (o.best && typeof o.best === 'object') store.best = o.best;
        if (o.settings) {
          if (typeof o.settings.sound === 'boolean') store.settings.sound = o.settings.sound;
          if (typeof o.settings.vibrate === 'boolean') store.settings.vibrate = o.settings.vibrate;
          if (typeof o.settings.unlockAll === 'boolean') store.settings.unlockAll = o.settings.unlockAll;
        }
      }
    } catch (e) { /* 存档损坏就当新档 */ }
  }

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function isUnlocked(n) { return store.settings.unlockAll || n <= store.unlocked; }
  function starsOf(n) { return store.stars[n] || 0; }
  function totalStars() {
    var s = 0;
    for (var k in store.stars) if (store.stars.hasOwnProperty(k)) s += store.stars[k];
    return s;
  }
  function clearedCount() {
    var c = 0;
    for (var k in store.stars) if (store.stars.hasOwnProperty(k) && store.stars[k] > 0) c++;
    return c;
  }

  /* ============================ 音效 ============================ */

  var Sfx = {
    ctx: null,
    ensure: function () {
      if (!store.settings.sound) return null;
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return this.ctx;
    },
    tone: function (freq, dur, type, vol, delay) {
      var ctx = this.ensure();
      if (!ctx) return;
      try {
        var t0 = ctx.currentTime + (delay || 0);
        var osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(vol == null ? 0.07 : vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.03);
      } catch (e) {}
    },
    tap: function () { this.tone(700, 0.05, 'sine', 0.035); },
    pick: function () { this.tone(540, 0.07, 'triangle', 0.05); },
    merge: function () { this.tone(430, 0.09, 'triangle', 0.055); this.tone(660, 0.1, 'sine', 0.04, 0.05); },
    win: function () { var s = [523, 659, 784, 1047]; for (var i = 0; i < s.length; i++) this.tone(s[i], 0.3, 'sine', 0.06, i * 0.09); },
    lose: function () { this.tone(220, 0.2, 'sawtooth', 0.045); this.tone(160, 0.28, 'sawtooth', 0.035, 0.11); },
    err: function () { this.tone(170, 0.13, 'square', 0.03); }
  };

  function buzz(ms) {
    if (!store.settings.vibrate) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} }
  }

  /* ============================ 状态 ============================ */

  var uid = 1;

  var S = {
    screen: 'home',
    chapter: 0,
    mode: 'level',
    target: 24,
    ops: E.ALL_OPS.slice(),
    original: [],
    cards: [],        // 长度固定 4，元素为 card 对象或 null（该格已被合并掉）
    sel: null,
    op: null,
    history: [],
    level: 0,
    hints: 0,
    usedAnswer: false,
    solved: false,
    dead: false,
    t0: 0
  };

  function alive() { return S.cards.filter(function (c) { return !!c; }); }
  function aliveCount() { var n = 0; for (var i = 0; i < S.cards.length; i++) if (S.cards[i]) n++; return n; }
  function indexOfId(id) {
    for (var i = 0; i < S.cards.length; i++) if (S.cards[i] && S.cards[i].id === id) return i;
    return -1;
  }
  function findCard(id) {
    var i = indexOfId(id);
    return i < 0 ? null : S.cards[i];
  }

  /* ============================ 屏幕切换 ============================ */

  function show(name) {
    S.screen = name;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    if (name === 'chapters') renderChapters();
    if (name === 'levels') renderLevels();
    if (name === 'home') renderHome();
  }

  function renderHome() {
    var lv = Math.min(E.TOTAL_LEVELS, store.unlocked);
    var t = totalStars(), max = E.TOTAL_LEVELS * 3;
    $('#home-progress').textContent = '已通关 ' + clearedCount() + ' / ' + E.TOTAL_LEVELS
      + ' 关 · ★ ' + t + ' / ' + max + ' · 下一关 第 ' + lv + ' 关';
  }

  /* ============================ 卡片 ============================ */

  function atomCard(v) {
    return { id: ++uid, v: E.frac(v, 1), expr: String(v), p: E.ATOM_P };
  }

  function valueHTML(v) {
    if (v.d === 1) {
      return '<span class="value">' + (v.n < 0 ? '−' + Math.abs(v.n) : String(v.n)) + '</span>';
    }
    return '<span class="value">' + (v.n < 0 ? '−' : '') +
      '<span class="frac"><span>' + Math.abs(v.n) + '</span><span class="bar"></span><span>' + v.d + '</span></span>' +
      '</span>';
  }

  function pickCardByValue(v, excludeId) {
    for (var i = 0; i < S.cards.length; i++) {
      var c = S.cards[i];
      if (!c || c.id === excludeId) continue;
      if (E.eqF(c.v, v)) return c;
    }
    return null;
  }

  function renderCards() {
    var box = $('#cards');
    box.innerHTML = '';
    S.cards.forEach(function (c) {
      var node = el('div', 'card' + (c ? '' : ' empty'));
      if (!c) { box.appendChild(node); return; }
      node.dataset.id = String(c.id);
      var html = valueHTML(c.v);
      if (c.p !== E.ATOM_P) html += '<span class="sub">' + esc(c.expr) + '</span>';
      node.innerHTML = html;
      if (S.sel === c.id) node.classList.add('sel');
      if (S.dead) node.classList.add('dead');
      node.addEventListener('click', function () { onCardTap(c.id); });
      box.appendChild(node);
    });
  }

  function renderOps() {
    var box = $('#ops');
    box.innerHTML = '';
    S.ops.forEach(function (sym) {
      var b = el('button', 'op-btn' + (S.op === sym ? ' on' : ''));
      b.type = 'button';
      b.textContent = sym;
      b.dataset.op = sym;
      b.addEventListener('click', function () { onOpTap(sym); });
      box.appendChild(b);
    });
  }

  function modeTip() {
    if (S.mode === 'kid') return '只用 ＋ 和 −，凑成 24';
    return '点一张牌 → 点运算符 → 点另一张牌';
  }

  function renderExprLine() {
    var box = $('#expr-line');
    if (S.solved) { box.innerHTML = ''; return; }
    if (S.dead && aliveCount() === 1) {
      box.innerHTML = '<span class="bad">要得到 24 哦</span>' +
        '<span class="hint">点「撤销」或右上角 ↻ 重来</span>';
      return;
    }
    var sel = findCard(S.sel);
    if (sel && S.op) {
      box.innerHTML = '<span class="pending">' + esc(sel.expr) + ' ' + S.op +
        ' ?</span><span class="hint">再点一张牌完成运算</span>';
    } else if (sel) {
      box.innerHTML = '<span class="pending">已选 ' + esc(sel.expr) +
        '</span><span class="hint">点一个运算符</span>';
    } else if (S.op) {
      box.innerHTML = '<span class="pending">运算符 ' + S.op + '</span><span class="hint">点两张牌</span>';
    } else {
      box.innerHTML = '<span class="hint">' + esc(modeTip()) + '</span>';
    }
  }

  function shakeCard(id) {
    var node = $('.card[data-id="' + id + '"]');
    if (!node) return;
    node.classList.remove('shake');
    void node.offsetWidth;
    node.classList.add('shake');
    setTimeout(function () { node.classList.remove('shake'); }, 400);
  }

  /* ============================ 交互 ============================ */

  function onCardTap(id) {
    if (S.solved) return;
    var card = findCard(id);
    if (!card) return;

    if (S.sel === null) { S.sel = id; Sfx.pick(); renderCards(); renderExprLine(); return; }
    if (S.sel === id) { S.sel = null; Sfx.tap(); renderCards(); renderExprLine(); return; }
    if (!S.op) { S.sel = id; Sfx.pick(); renderCards(); renderExprLine(); return; }
    doMerge(S.sel, id, S.op);
  }

  function onOpTap(sym) {
    if (S.solved) return;
    if (S.ops.indexOf(sym) < 0) return;
    S.op = (S.op === sym) ? null : sym;
    Sfx.tap();
    renderOps();
    renderExprLine();
  }

  function doMerge(aId, bId, sym) {
    var ia = indexOfId(aId), ib = indexOfId(bId);
    if (ia < 0 || ib < 0 || ia === ib) return;
    var A = S.cards[ia], B = S.cards[ib];
    var node = E.combine({ v: A.v, e: A.expr, p: A.p }, { v: B.v, e: B.expr, p: B.p }, sym);
    if (!node) {
      Sfx.err(); shakeCard(aId); shakeCard(bId);
      toast('不能除以 0 哦');
      return;
    }

    S.history.push({
      cards: S.cards.map(function (c) { return c ? { id: c.id, v: c.v, expr: c.expr, p: c.p } : null; }),
      sel: S.sel,
      op: S.op
    });
    if (S.history.length > 60) S.history.shift();

    // 结果写回「第二张牌」的格位，第一张的格位清空（与原版一致）
    var merged = { id: ++uid, v: node.v, expr: node.e, p: node.p };
    S.cards[ia] = null;
    S.cards[ib] = merged;
    // ★ 手感关键：合并结果自动保持选中，运算符清空（对应原版的
    //   onCalc1Select(e) + resetOperators()），这样下一轮只要
    //   「点运算符 → 点下一张牌」，不必再点一次结果牌。
    S.sel = merged.id;
    S.op = null;

    Sfx.merge(); buzz(12);
    renderCards(); renderOps(); renderExprLine();

    var nodeEl = $('.card[data-id="' + merged.id + '"]');
    if (nodeEl) {
      nodeEl.classList.add('newcard');
      setTimeout(function () { nodeEl.classList.remove('newcard'); }, 280);
    }
    checkEnd();
  }

  function checkEnd() {
    if (aliveCount() !== 1) { S.dead = false; return; }
    S.sel = null;                       // 只剩一张，不必再保持选中
    var only = alive()[0];
    if (E.eqNum(only.v, S.target)) { S.dead = false; onWin(); }
    else {
      S.dead = true;
      Sfx.lose();
      renderCards();
      renderExprLine();
    }
  }

  function onUndo() {
    if (S.solved) return;
    if (!S.history.length) { toast('还没有可以撤销的步骤'); Sfx.err(); return; }
    var h = S.history.pop();
    S.cards = h.cards;
    S.sel = h.sel;
    S.op = h.op;
    S.dead = false;
    Sfx.tap();
    renderCards(); renderOps(); renderExprLine();
  }

  function resetBoard() {
    S.cards = S.original.map(function (v) { return atomCard(v); });
    S.sel = null; S.op = null; S.dead = false;
    renderCards(); renderOps(); renderExprLine();
  }

  function onReset() {
    if (S.solved) return;
    S.history = [];
    Sfx.tap();
    resetBoard();
  }

  function onHint() {
    if (S.solved) return;
    var r = E.solveBoth(alive().map(function (c) { return { v: c.v, e: c.expr, p: c.p }; }), S.ops, S.target);
    if (!r || !r.first) {
      Sfx.err();
      toast('现在的牌面已经凑不出 24 了，重来试试');
      return;
    }
    var A = pickCardByValue(r.first.a, null);
    var B = A ? pickCardByValue(r.first.b, A.id) : null;
    S.hints++;
    Sfx.pick();
    $$('.card').forEach(function (n) { n.classList.remove('pulse'); });
    [A, B].forEach(function (c) {
      if (!c) return;
      var node = $('.card[data-id="' + c.id + '"]');
      if (node) node.classList.add('pulse');
    });
    var opBtn = $('.op-btn[data-op="' + r.first.op + '"]');
    if (opBtn) {
      opBtn.classList.add('flash');
      setTimeout(function () { opBtn.classList.remove('flash'); }, 1500);
    }
    $('#expr-line').innerHTML = '<span class="good">用「' + esc(r.first.op) + '」运算这两张牌</span>' +
      '<span class="hint">一种解法：' + esc(r.expr) + '</span>';
    setTimeout(function () { $$('.card').forEach(function (n) { n.classList.remove('pulse'); }); }, 1700);
  }

  function onAnswer() {
    if (S.solved) return;
    var sol = E.solveExpr(S.original.map(function (v) { return E.frac(v, 1); }), S.ops, S.target);
    S.usedAnswer = true;
    if (!sol) { toast('这关没有解法'); return; }
    openModal(
      '<h2>参考答案</h2>' +
      '<p>' + S.original.join(' 、 ') + ' 凑 ' + S.target + '：</p>' +
      '<div class="expr">' + esc(sol) + '</div>' +
      '<p>这一关只记 1 颗星，先自己再想想～</p>' +
      '<div class="row"><button class="btn btn-grey" data-action="close">知道了</button>' +
      '<button class="btn btn-green" data-action="close-reset">重来一次</button></div>'
    );
  }

  /* ============================ 开局 ============================ */

  function updateTopbar(title, sub) {
    $('#game-title').textContent = title;
    $('#game-sub').textContent = sub;
  }

  function setTools(mode) {
    var isLevel = mode === 'level';
    $('#btn-answer').style.display = (mode === 'kid') ? 'none' : '';
    $('#btn-next-puzzle').style.display = isLevel ? 'none' : '';
  }

  function startLevel(n) {
    var lv = E.getLevel(n);
    S.mode = 'level';
    S.level = n;
    S.target = 24;
    S.ops = E.ALL_OPS.slice();
    S.original = lv.nums.slice(0, 4);
    S.history = [];
    S.sel = null; S.op = null; S.dead = false; S.solved = false;
    S.hints = 0; S.usedAnswer = false;
    S.t0 = Date.now();
    resetBoard();

    updateTopbar(lv.tierName + ' · 第 ' + n + ' 关',
      '用 ＋ − × ÷ 凑成 24 · 本题 ' + lv.solutionCount + ' 种解法' + (lv.needsFraction ? ' · 要用到分数' : ''));
    setTools('level');
    show('game');
  }

  function startPractice() {
    var h = E.randomHand(-1);
    S.mode = 'practice';
    S.level = 0;
    S.target = 24;
    S.ops = E.ALL_OPS.slice();
    S.original = h.nums.slice(0, 4);
    S.history = [];
    S.sel = null; S.op = null; S.dead = false; S.solved = false;
    S.hints = 0; S.usedAnswer = false;
    S.t0 = Date.now();
    resetBoard();

    updateTopbar('自由练习', '随机出题 · 用 ＋ − × ÷ 凑成 24');
    setTools('practice');
    show('game');
  }

  var kidRecent = [];

  function startKid() {
    S.mode = 'kid';
    S.level = 0;
    kidRecent = [];
    newKidPuzzle();
    show('game');
  }

  function newKidPuzzle() {
    var hand = null, key = '';
    for (var i = 0; i < 40; i++) {
      var h = E.randomKidHand(24, 10);
      key = h.nums.slice().sort(function (a, b) { return a - b; }).join(',');
      if (kidRecent.indexOf(key) < 0) { hand = h; break; }
    }
    if (!hand) hand = E.randomKidHand(24, 10);
    kidRecent.push(key);
    if (kidRecent.length > 16) kidRecent.shift();

    S.target = 24;
    S.ops = E.KID_OPS.slice();
    S.original = hand.nums.slice(0, 4);
    S.history = [];
    S.sel = null; S.op = null; S.dead = false; S.solved = false;
    S.hints = 0; S.usedAnswer = false;
    S.t0 = Date.now();
    resetBoard();

    updateTopbar('儿童模式', '只用 ＋ 和 −，把 4 张牌凑成 24');
    setTools('kid');
  }

  /* ============================ 结算 ============================ */

  function onWin() {
    S.solved = true;
    var sec = Math.floor((Date.now() - S.t0) / 1000);
    var expr = alive()[0].expr;
    renderExprLine();

    if (S.mode === 'level') {
      var stars = S.usedAnswer ? 1 : (S.hints > 0 ? 2 : 3);
      var n = S.level;
      store.stars[n] = Math.max(starsOf(n), stars);
      if (!store.best[n] || sec < store.best[n]) store.best[n] = sec;
      store.unlocked = Math.max(store.unlocked, Math.min(E.TOTAL_LEVELS, n + 1));
      saveStore();
      Sfx.win(); confetti();
      var lv = E.getLevel(n);
      openModal(
        '<h2>' + pick(['厉害了！', '太棒了！', '你真聪明！', '完美！']) + '</h2>' +
        '<div class="big-stars">' + starHTML(stars) + '</div>' +
        '<div class="expr">' + esc(expr) + ' = 24</div>' +
        '<p>第 ' + n + ' 关通过 · 用时 ' + fmtTime(sec) +
        (store.best[n] ? ' · 最好 ' + fmtTime(store.best[n]) : '') + '</p>' +
        '<div class="row">' +
        '<button class="btn btn-grey" data-action="replay">重玩</button>' +
        (n < E.TOTAL_LEVELS
          ? '<button class="btn btn-green" data-action="next-level">下一关</button>'
          : '<button class="btn btn-green" data-action="goto-levels">全部通关！</button>') +
        '</div>',
        true
      );
    } else if (S.mode === 'kid') {
      // 儿童模式不评分：没有星星，也没有连对计数，只给庆祝
      Sfx.win(); confetti();
      openModal(
        partyHTML() +
        '<h2>' + pick(['太棒了！', '真厉害！', '答对啦！', '你真聪明！']) + '</h2>' +
        '<div class="expr">' + esc(expr) + ' = 24</div>' +
        '<p>只用加减就凑出 24 啦</p>' +
        '<div class="row">' +
        '<button class="btn btn-grey" data-action="goto-home">休息一下</button>' +
        '<button class="btn btn-green" data-action="new-kid">再来一题</button>' +
        '</div>',
        true
      );
    } else {
      Sfx.win(); confetti();
      openModal(
        '<h2>答对了！</h2>' +
        '<div class="expr">' + esc(expr) + ' = 24</div>' +
        '<p>用时 ' + fmtTime(sec) + '</p>' +
        '<div class="row">' +
        '<button class="btn btn-grey" data-action="goto-home">返回首页</button>' +
        '<button class="btn btn-green" data-action="new-practice">再来一题</button>' +
        '</div>',
        true
      );
    }
  }

  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* ---------------- 儿童模式：小女孩庆祝动画（纯 SVG + CSS） ---------------- */

  var GIRL_SVG =
    '<svg class="girl" viewBox="0 0 120 152" aria-hidden="true">' +
    '<circle cx="25" cy="50" r="14" fill="#5a463c"/>' +
    '<circle cx="95" cy="50" r="14" fill="#5a463c"/>' +
    '<rect x="47" y="104" width="10" height="26" rx="5" fill="#fbd6c4"/>' +
    '<rect x="63" y="104" width="10" height="26" rx="5" fill="#fbd6c4"/>' +
    '<rect x="41" y="126" width="19" height="11" rx="5.5" fill="#f0692e"/>' +
    '<rect x="60" y="126" width="19" height="11" rx="5.5" fill="#f0692e"/>' +
    '<path d="M60 58 L92 110 Q60 121 28 110 Z" fill="#f0692e"/>' +
    '<path d="M60 58 L92 110 Q76 115 60 115 Z" fill="#d8511c" opacity=".32"/>' +
    '<path class="arm-l" d="M46 70 L23 38" stroke="#fbd6c4" stroke-width="12" stroke-linecap="round" fill="none"/>' +
    '<path class="arm-r" d="M74 70 L97 38" stroke="#fbd6c4" stroke-width="12" stroke-linecap="round" fill="none"/>' +
    '<circle cx="60" cy="40" r="27" fill="#fbd6c4"/>' +
    '<path d="M33 38 Q33 6 60 6 Q87 6 87 38 Q80 21 60 21 Q40 21 33 38 Z" fill="#5a463c"/>' +
    '<circle cx="48" cy="13" r="6" fill="#ffc93c"/>' +
    '<circle cx="72" cy="13" r="6" fill="#ffc93c"/>' +
    '<circle cx="50" cy="42" r="3.6" fill="#3a2b26"/>' +
    '<circle cx="70" cy="42" r="3.6" fill="#3a2b26"/>' +
    '<circle cx="42" cy="50" r="4.6" fill="#f79b9b" opacity=".72"/>' +
    '<circle cx="78" cy="50" r="4.6" fill="#f79b9b" opacity=".72"/>' +
    '<path d="M54 51 Q60 58 66 51" stroke="#c8664f" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  var HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M12 21S3.6 15.4 3.6 9.7A4.9 4.9 0 0 1 12 6.1a4.9 4.9 0 0 1 8.4 3.6C20.4 15.4 12 21 12 21z" fill="currentColor"/></svg>';
  var STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/></svg>';

  var SPARKS = [
    { x: -64, y: -80, d: 0.00, c: '#f0692e', h: true },
    { x: 60, y: -94, d: 0.24, c: '#4cc97c', h: false },
    { x: -42, y: -112, d: 0.46, c: '#ffc93c', h: true },
    { x: 48, y: -62, d: 0.68, c: '#3fb4e6', h: false },
    { x: -16, y: -124, d: 0.90, c: '#ff8fb1', h: true },
    { x: 22, y: -44, d: 1.12, c: '#e0a324', h: false }
  ];

  /** 小女孩举手欢呼 + 飘爱心/星星 */
  function partyHTML(cheer) {
    var sparks = SPARKS.map(function (sp) {
      return '<span class="spark" style="--tx:' + sp.x + 'px;--ty:' + sp.y + 'px;--d:' + sp.d +
        's;color:' + sp.c + '">' + (sp.h ? HEART_SVG : STAR_SVG) + '</span>';
    }).join('');
    return '<div class="party">' +
      (cheer ? '<div class="cheer">' + esc(cheer) + '</div>' : '') +
      sparks + GIRL_SVG + '</div>';
  }

  /* 与原版一样的白色挂锁图标（用 emoji 会变成金色，和原版不一致） */
  var LOCK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round"/>' +
    '<rect x="4.6" y="10.2" width="14.8" height="11.2" rx="3.2" fill="currentColor"/>' +
    '</svg>';

  /* ============================ 章节 / 选关 ============================ */

  function renderChapters() {
    $('#chapters-title').textContent = '选择关卡';
    $('#chapters-sub').textContent = '你已经通关 ' + clearedCount() + ' / ' + E.TOTAL_LEVELS + ' 关';

    var box = $('#chapter-grid');
    box.innerHTML = '';
    for (var t = 0; t < E.TOTAL_TIERS; t++) {
      var done = 0, first = t * E.LEVELS_PER_TIER + 1;
      for (var i = 0; i < E.LEVELS_PER_TIER; i++) if (starsOf(first + i) > 0) done++;
      var unlocked = isUnlocked(first);
      var btn = el('button', 'chapter' + (unlocked ? ' on' : ''));
      btn.type = 'button';
      if (!unlocked) btn.style.opacity = '.5';
      btn.innerHTML =
        '<div class="c-no">第 ' + (t + 1) + ' 章</div>' +
        '<div class="c-name">' + esc(E.TIERS[t].name) + '</div>' +
        '<div class="c-meta">' + done + ' / ' + E.LEVELS_PER_TIER + ' 关 · ★ ' + starsOfTier(t) + ' / ' + (E.LEVELS_PER_TIER * 3) + '</div>' +
        '<div class="c-bar"><i style="width:' + (done / E.LEVELS_PER_TIER * 100).toFixed(0) + '%"></i></div>';
      (function (idx) {
        btn.addEventListener('click', function () {
          if (!isUnlocked(idx * E.LEVELS_PER_TIER + 1)) { toast('先通关前面的章节才能解锁哦'); return; }
          S.chapter = idx;
          show('levels');
        });
      })(t);
      box.appendChild(btn);
    }
  }

  function starsOfTier(t) {
    var s = 0, first = t * E.LEVELS_PER_TIER + 1;
    for (var i = 0; i < E.LEVELS_PER_TIER; i++) s += starsOf(first + i);
    return s;
  }

  function renderLevels() {
    var t = S.chapter;
    var first = t * E.LEVELS_PER_TIER + 1;
    var done = 0;
    for (var i = 0; i < E.LEVELS_PER_TIER; i++) if (starsOf(first + i) > 0) done++;

    $('#levels-title').textContent = E.TIERS[t].name;
    $('#levels-sub').textContent = '你当前的等级是：' + E.TIERS[t].name + ' · 已完成 ' + done + '/' + E.LEVELS_PER_TIER;

    var box = $('#level-grid');
    box.innerHTML = '';
    for (var k = 0; k < E.LEVELS_PER_TIER; k++) {
      var n = first + k;
      var s = starsOf(n);
      var unlocked = isUnlocked(n);
      var isCurrent = !store.settings.unlockAll && n === store.unlocked;
      var isExam = (k === E.LEVELS_PER_TIER - 1);

      var cls = 'lv';
      if (!unlocked) cls += ' locked';
      else if (isCurrent) cls += ' cur';
      else if (s > 0) cls += ' done';
      if (isExam) cls += ' exam';   // 考试关即使是锁着的也显示名称（与原版一致）

      var b = el('button', cls);
      b.type = 'button';
      if (isExam) {
        b.innerHTML = '<span class="num">考试</span>';
      } else if (!unlocked) {
        b.innerHTML = '<span class="lock">' + LOCK_SVG + '</span>';
      } else {
        b.innerHTML = '<span class="num">' + (k + 1) + '</span>' +
          (s > 0 ? '<span class="stars">' + plainStars(s) + '</span>' : '');
      }
      (function (num, ok) {
        b.addEventListener('click', function () {
          if (!ok) { toast('这一关还没解锁'); Sfx.err(); return; }
          startLevel(num);
        });
      })(n, unlocked);
      box.appendChild(b);
    }

    var dots = $('#level-dots');
    dots.innerHTML = '';
    for (var d = 0; d < E.TOTAL_TIERS; d++) {
      var dot = el('i', d === t ? 'on' : '');
      dots.appendChild(dot);
    }
  }

  function gotoTarget() {
    for (var n = 1; n <= E.TOTAL_LEVELS; n++) if (!starsOf(n)) { startLevel(n); return; }
    startLevel(E.TOTAL_LEVELS);
  }

  /* ============================ 弹窗 ============================ */

  function openModal(html, lockOutside) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal">' + html + '</div>';
    root.dataset.lock = lockOutside ? '1' : '';
    root.classList.add('show');
    $$('[data-action]', root).forEach(function (b) {
      b.addEventListener('click', function () { handleAction(b.dataset.action, b.dataset.value); });
    });
  }

  function closeModal() {
    var root = $('#modal-root');
    root.classList.remove('show');
    root.innerHTML = '';
  }

  function handleAction(action, value) {
    switch (action) {
      case 'close': closeModal(); break;
      case 'close-reset': closeModal(); S.history = []; resetBoard(); break;
      case 'replay': closeModal(); startLevel(S.level); break;
      case 'next-level': closeModal(); startLevel(Math.min(E.TOTAL_LEVELS, S.level + 1)); break;
      case 'goto-levels':
        closeModal();
        S.chapter = Math.floor((S.level - 1) / E.LEVELS_PER_TIER);
        show('levels');
        break;
      case 'goto-home': closeModal(); show('home'); break;
      case 'new-kid': closeModal(); newKidPuzzle(); break;
      case 'new-practice': closeModal(); startPractice(); break;
      case 'toggle-sound': store.settings.sound = !store.settings.sound; saveStore(); openSettings(); break;
      case 'toggle-vibrate': store.settings.vibrate = !store.settings.vibrate; saveStore(); openSettings(); break;
      case 'toggle-unlock':
        store.settings.unlockAll = !store.settings.unlockAll;
        saveStore();
        openSettings();
        break;
      case 'reset-progress':
        openModal(
          '<h2>确定要清空进度吗？</h2>' +
          '<p>已通关记录、星星、最好成绩都会删除，且无法恢复。</p>' +
          '<div class="row"><button class="btn btn-grey" data-action="close">取消</button>' +
          '<button class="btn btn-orange" data-action="reset-progress-ok">确定清空</button></div>'
        );
        break;
      case 'reset-progress-ok':
        store.unlocked = 1; store.stars = {}; store.best = {};
        saveStore();
        closeModal();
        toast('进度已清空');
        show('home');
        break;
      default: closeModal();
    }
  }

  function openSettings() {
    var s = store.settings;
    openModal(
      '<h2>设置</h2>' +
      '<div class="setting"><span>音效</span>' +
      '<button class="switch' + (s.sound ? ' on' : '') + '" data-action="toggle-sound"></button></div>' +
      '<div class="setting"><span>震动反馈<small>部分设备支持</small></span>' +
      '<button class="switch' + (s.vibrate ? ' on' : '') + '" data-action="toggle-vibrate"></button></div>' +
      '<div class="setting"><span>解锁全部关卡<small>打开后可随意跳关</small></span>' +
      '<button class="switch' + (s.unlockAll ? ' on' : '') + '" data-action="toggle-unlock"></button></div>' +
      '<div class="setting"><span>清空游戏进度</span>' +
      '<button class="btn btn-grey" style="padding:1.4vmin 3vmin;letter-spacing:.05em" data-action="reset-progress">清空</button></div>' +
      '<p style="margin-top:2.4vmin">算24点 · iPad 版 · 纯本地运行，不联网、无广告</p>' +
      '<div class="row"><button class="btn btn-grey" data-action="close">关闭</button></div>'
    );
  }

  /* ============================ 提示条 / 撒花 ============================ */

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 1900);
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var box = el('div', 'confetti');
    var colors = ['#f0692e', '#4cc97c', '#8fdcc6', '#6ba8d0', '#ffc93c', '#2e5aa8'];
    for (var i = 0; i < 60; i++) {
      var p = el('i');
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[(Math.random() * colors.length) | 0];
      p.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.opacity = String(0.7 + Math.random() * 0.3);
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3600);
  }

  /* ============================ 事件绑定 ============================ */

  function bind() {
    $('#btn-continue').addEventListener('click', gotoTarget);
    $('#btn-chapters').addEventListener('click', function () { show('chapters'); });
    $('#btn-kid').addEventListener('click', startKid);
    $('#btn-practice').addEventListener('click', startPractice);
    $('#btn-settings-1').addEventListener('click', openSettings);

    $$('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.back); });
    });

    $('#btn-levels-back').addEventListener('click', function () { show('chapters'); });
    $('#btn-chapter-next').addEventListener('click', function () {
      S.chapter = Math.min(E.TOTAL_TIERS - 1, S.chapter + 1);
      renderLevels();
    });

    $('#btn-game-back').addEventListener('click', function () {
      if (S.mode === 'level') { S.chapter = Math.floor((S.level - 1) / E.LEVELS_PER_TIER); show('levels'); }
      else show('home');
    });

    $('#btn-undo').addEventListener('click', onUndo);
    $('#btn-reset').addEventListener('click', onReset);
    $('#btn-hint').addEventListener('click', onHint);
    $('#btn-answer').addEventListener('click', onAnswer);
    $('#btn-next-puzzle').addEventListener('click', function () {
      if (S.mode === 'kid') newKidPuzzle(); else startPractice();
    });

    $('#modal-root').addEventListener('click', function (e) {
      if (e.target === this && this.dataset.lock !== '1') closeModal();
    });

    var unlock = function () {
      Sfx.ensure();
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('mousedown', unlock);
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('mousedown', unlock, { passive: true });

    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

    window.addEventListener('resize', function () { if (S.screen === 'game') renderCards(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { if (S.screen === 'game') renderCards(); }, 260);
    });
  }

  /* ============================ 调试接口 ============================ */

  function exposeDebug() {
    window.__P24__ = {
      state: function () {
        return {
          screen: S.screen, mode: S.mode, level: S.level, target: S.target,
          ops: S.ops.slice(), solved: S.solved, dead: S.dead,
          cards: S.cards.map(function (c) {
            return c ? { id: c.id, v: c.v, expr: c.expr, p: c.p } : null;
          })
        };
      },
      solve: function () {
        var r = E.solveBoth(alive().map(function (c) { return { v: c.v, e: c.expr, p: c.p }; }), S.ops, S.target);
        return r ? { steps: r.steps, expr: r.expr } : null;
      },
      clickCard: function (id) { onCardTap(id); },
      clickOp: function (sym) { onOpTap(sym); },
      undo: onUndo, reset: onReset, hint: onHint, answer: onAnswer,
      startLevel: startLevel, startKid: startKid, startPractice: startPractice,
      newKidPuzzle: newKidPuzzle,
      getLevel: E.getLevel,
      store: store
    };
  }

  /* ============================ 启动 ============================ */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    var go = function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失败不影响游戏 */ });
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
  }

  function init() {
    loadStore();
    bind();
    renderHome();
    show('home');
    if (/[?&]debug\b/.test(location.search)) exposeDebug();
    registerSW();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
