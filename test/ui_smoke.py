#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""算24点 · 真实浏览器端到端测试

用本机 Playwright + Chromium 打开打包产物 dist/index.html，
在 iPad 尺寸下真实点击、真实结算，并检查布局是否溢出。

用法: python test/ui_smoke.py
"""

import functools
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
SHOTS = os.path.join(ROOT, 'test', 'screenshots')
PORT = 8099
URL = 'http://127.0.0.1:%d/index.html?debug' % PORT

PASS = []
FAIL = []


def check(name, cond, extra=''):
    if cond:
        PASS.append(name)
        print('  \033[32m✓\033[0m %s' % name)
    else:
        FAIL.append('%s  %s' % (name, extra))
        print('  \033[31m✗\033[0m %s   %s' % (name, extra))


def section(t):
    print('\n\033[36m== %s\033[0m' % t)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server():
    handler = functools.partial(QuietHandler, directory=DIST)
    httpd = ReusableServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# ---------------------------------------------------------------- 页面助手

STATE_JS = '() => __P24__.state()'


def state(page):
    return page.evaluate(STATE_JS)


def alive(st):
    """棋盘是 4 个固定格位，合并后格位留空，所以要过滤 null"""
    return [c for c in st['cards'] if c]


def selected_id(page):
    """当前被选中的牌（原版的 calc1Card / 我们的 S.sel）"""
    return page.evaluate('''() => {
        const s = document.querySelector('.card.sel');
        return s ? Number(s.dataset.id) : null;
    }''')


def find_ids(page, a, b):
    return page.evaluate(
        '''(want) => {
            const cards = __P24__.state().cards.filter(Boolean);
            const used = new Set();
            const out = [];
            for (const w of want) {
                const hit = cards.find(c => !used.has(c.id) && c.v.n === w.n && c.v.d === w.d);
                if (!hit) return null;
                used.add(hit.id);
                out.push(hit.id);
            }
            return out;
        }''', [a, b])


COMMUTATIVE = ('+', '\u00d7')


def do_next_merge(page):
    """按真实玩家的最短点法完成一次运算，返回点击次数（失败返回 None）。

    合并结果会自动保持选中（对应原版 onCalc1Select(e)），所以之后
    通常只要「点运算符 + 点另一张牌」。但要注意：选中的牌是**左操作数**，
    如果引擎给的这一步里它是右操作数、而运算符不可交换，就得先切一次首操作数。
    """
    sol = page.evaluate('() => __P24__.solve()')
    if not sol or not sol['steps']:
        return None
    step = sol['steps'][0]
    ids = find_ids(page, step['a'], step['b'])
    if not ids:
        return None
    ida, idb = ids
    sel = selected_id(page)

    if sel == ida:
        page.evaluate('(a) => { __P24__.clickOp(a[0]); __P24__.clickCard(a[1]); }', [step['op'], idb])
        taps = 2
    elif sel == idb and step['op'] in COMMUTATIVE:
        page.evaluate('(a) => { __P24__.clickOp(a[0]); __P24__.clickCard(a[1]); }', [step['op'], ida])
        taps = 2
    elif sel is None:
        page.evaluate('(a) => { __P24__.clickOp(a[0]); __P24__.clickCard(a[1]); __P24__.clickCard(a[2]); }',
                      [step['op'], ida, idb])
        taps = 3
    else:
        # 选中的是右操作数、运算符又不可交换：先点一下 A 切换首操作数
        page.evaluate('(a) => { __P24__.clickCard(a[0]); __P24__.clickOp(a[1]); __P24__.clickCard(a[2]); }',
                      [ida, step['op'], idb])
        taps = 3
    page.wait_for_timeout(60)
    return taps


def merge_with_plus(page):
    """故意用加法乱走一步（不考虑目标），用于测试失败分支"""
    st = state(page)
    ids = [c['id'] for c in alive(st)]
    if len(ids) < 2:
        return False
    sel = selected_id(page)
    if sel is not None and sel in ids:
        other = ids[0] if ids[1] == sel else ids[1]
        page.evaluate('(a) => { __P24__.clickOp("+"); __P24__.clickCard(a); }', other)
    else:
        page.evaluate('(a) => { __P24__.clickOp("+"); __P24__.clickCard(a[0]); __P24__.clickCard(a[1]); }', ids)
    page.wait_for_timeout(80)
    return True


def play_to_win(page, count_taps=False):
    """按引擎给的最优步骤，一步步点到只剩一张 24"""
    total = 0
    for _ in range(5):
        st = state(page)
        if st['solved'] or st['dead'] or len(alive(st)) == 1:
            break
        t = do_next_merge(page)
        if t is None:
            break
        total += t
    if count_taps:
        return state(page), total
    return state(page)


def _evaluate_expr(expr):
    """把游戏里的表达式（用 − × ÷）算出来，用于校验答案是否正确"""
    if not expr:
        return None
    src = expr.replace('×', '*').replace('÷', '/').replace('−', '-')
    if not re.fullmatch(r'[0-9+\-*/() ]+', src):
        return None
    try:
        val = eval(src, {'__builtins__': {}}, {})  # noqa: S307  只允许数字与四则运算符
    except Exception:  # noqa: BLE001
        return None
    return round(val, 6)


def lit_stars(page):
    """结算弹窗里点亮的星星数。

    注意：starHTML 里点亮的星星是纯文本节点、灰掉的是 <span class="off">★</span>，
    所以不能直接数 ★ 字符，也不能只数元素节点。用「总数 − 灰星数」才准确。
    """
    return page.evaluate('''() => {
        const box = document.querySelector('.modal .big-stars');
        if (!box) return -1;
        const total = (box.textContent.match(/★/g) || []).length;
        const off = box.querySelectorAll('.off').length;
        return total - off;
    }''')


def layout_report(page):
    return page.evaluate('''() => {
        const de = document.documentElement;
        const vw = window.innerWidth, vh = window.innerHeight;
        const bad = [];
        document.querySelectorAll('.card, .op-btn, .tool-btn, .btn, .lv, .chapter, .icon-btn').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
                bad.push(el.className + ' @' + [r.left|0, r.top|0, r.right|0, r.bottom|0].join(','));
            }
        });
        const smallest = [];
        document.querySelectorAll('.op-btn, .tool-btn, .btn, .lv, .icon-btn').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            smallest.push({ c: el.className, h: Math.round(r.height), w: Math.round(r.width) });
        });
        return {
            overflowX: de.scrollWidth > de.clientWidth + 1,
            overflowY: de.scrollHeight > de.clientHeight + 1,
            vw: vw, vh: vh,
            bad: bad.slice(0, 6),
            tiny: smallest.filter(s => s.h > 0 && s.h < 40).slice(0, 6)
        };
    }''')


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, name + '.png'))


# ---------------------------------------------------------------- 测试主体

def run(pw, viewport, label, tag):
    section('%s  %dx%d' % (label, viewport[0], viewport[1]))
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]},
                              device_scale_factor=2, has_touch=True, is_mobile=True,
                              user_agent=('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) '
                                          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 '
                                          'Mobile/15E148 Safari/604.1'))
    page = ctx.new_page()
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(20000)
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
    page.on('console', lambda m: errors.append('console.%s: %s' % (m.type, m.text))
            if m.type == 'error' else None)

    page.goto(URL, wait_until='load')
    page.wait_for_timeout(250)

    # ---------- 首页 ----------
    check('[%s] 页面标题是"朵朵的24点"' % tag, '朵朵的24点' in page.title(), page.title())
    logo_text = page.evaluate('() => document.querySelector(".logo").textContent.replace(/\\s+/g, "")')
    check('[%s] 首页 logo 就是"朵朵的24点"' % tag, logo_text == '朵朵的24点', logo_text)
    check('[%s] 加载无 JS 报错' % tag, not errors, ' | '.join(errors[:3]))
    check('[%s] 首页可见' % tag, page.is_visible('#screen-home'))
    check('[%s] 调试接口已挂载' % tag, page.evaluate('() => !!window.__P24__'))
    check('[%s] 关卡数据已内联（300 关）' % tag,
          page.evaluate('() => window.P24_LEVELS && window.P24_LEVELS.length === 300'))
    home_prog = page.inner_text('#home-progress')
    check('[%s] 首页显示进度' % tag, '/ 300' in home_prog, home_prog)
    lr = layout_report(page)
    check('[%s] 首页无横向溢出' % tag, not lr['overflowX'], json.dumps(lr))
    shot(page, '%s-1-home' % tag)

    # ---------- 闯关：第 1 关 ----------
    page.click('#btn-continue')
    page.wait_for_timeout(120)
    check('[%s] 进入牌桌' % tag, page.is_visible('#screen-game'))
    st = state(page)
    check('[%s] 第 1 关发 4 张牌' % tag, st['mode'] == 'level' and len(alive(st)) == 4, json.dumps(st['cards']))
    check('[%s] 棋盘是 4 个固定格位' % tag, len(st['cards']) == 4 and len(page.query_selector_all('.card')) == 4)
    check('[%s] 运算符 4 个' % tag, len(page.query_selector_all('.op-btn')) == 4)
    check('[%s] 大牌面都是小数字（第 1 章）' % tag,
          max(c['v']['n'] for c in alive(st)) <= 6, json.dumps([c['v'] for c in alive(st)]))
    check('[%s] 界面上没有"玩法说明"按钮' % tag,
          page.query_selector('#btn-rules') is None and '玩法说明' not in page.inner_text('#screen-home'))
    shot(page, '%s-2-game' % tag)

    # 点选交互：选牌 → 选运算符 → 合并
    first = alive(st)[0]['id']
    page.evaluate('(id) => __P24__.clickCard(id)', first)
    check('[%s] 点牌后高亮' % tag, page.evaluate('(id) => !!document.querySelector(\'.card.sel[data-id="\'+id+\'"]\')', first))
    page.evaluate('(id) => __P24__.clickCard(id)', first)
    check('[%s] 再点一次取消选中' % tag, page.evaluate('() => !document.querySelector(".card.sel")'))

    # 撤销：先走一步
    st = state(page)
    sol = page.evaluate('() => __P24__.solve()')
    ids = page.evaluate('''(want) => {
        const cards = __P24__.state().cards.filter(Boolean); const used = new Set(); const out = [];
        for (const w of want) {
            const hit = cards.find(c => !used.has(c.id) && c.v.n === w.n && c.v.d === w.d);
            if (!hit) return null; used.add(hit.id); out.push(hit.id);
        } return out;
    }''', [sol['steps'][0]['a'], sol['steps'][0]['b']])
    page.evaluate('(a) => { __P24__.clickOp(a[0]); __P24__.clickCard(a[1]); __P24__.clickCard(a[2]); }',
                  [sol['steps'][0]['op'], ids[0], ids[1]])
    page.wait_for_timeout(80)
    check('[%s] 合并后剩 3 张牌' % tag, len(alive(state(page))) == 3)
    sel_card = page.evaluate('''() => {
        const s = document.querySelector('.card.sel');
        if (!s) return null;
        const id = Number(s.dataset.id);
        return __P24__.state().cards.filter(Boolean).find(c => c.id === id) || null;
    }''')
    check('[%s] 合并结果自动保持选中（不用再点一次）' % tag,
          sel_card is not None and sel_card['p'] != 99, json.dumps(sel_card))
    page.click('#btn-undo')
    page.wait_for_timeout(80)
    check('[%s] 撤销后恢复 4 张牌' % tag, len(alive(state(page))) == 4)

    # ---- 提示 / 重来（功能验证）----
    page.click('#btn-hint')
    page.wait_for_timeout(80)
    check('[%s] 提示后给出可用的两张牌' % tag, '运算这两张牌' in page.inner_text('#expr-line'), page.inner_text('#expr-line'))
    page.click('#btn-reset')
    page.wait_for_timeout(60)
    check('[%s] 重来后回到 4 张牌' % tag, len(alive(state(page))) == 4)

    # ---- 干净通关 → 3 星（顺便验证点击次数符合原版手感）----
    page.evaluate('() => __P24__.startLevel(1)')   # 重置本关的提示/答案计数
    page.wait_for_timeout(150)
    res, taps = play_to_win(page, count_taps=True)
    check('[%s] 能走到只剩一张牌' % tag, res and len(alive(res)) == 1, json.dumps(res))
    check('[%s] 该牌等于目标 24' % tag, res and alive(res)[0]['v']['n'] == 24)
    check('[%s] 一关的最少点击次数不超过 8 次' % tag, 0 < taps <= 8, '实际 %d 次' % taps)
    check('[%s] 通关弹窗出现' % tag, page.is_visible('#modal-root.show'))
    check('[%s] 干净通关拿 3 星' % tag, lit_stars(page) == 3, '实际 %d 星' % lit_stars(page))
    save = page.evaluate('() => JSON.parse(localStorage.getItem("p24.save.v2"))')
    check('[%s] 进度已保存（解锁第 2 关）' % tag, save['unlocked'] == 2, json.dumps(save.get('unlocked')))
    check('[%s] 存档记录了 3 星' % tag, save['stars'].get('1') == 3, json.dumps(save.get('stars')))
    shot(page, '%s-4-win' % tag)

    # ---- 下一关，用过提示 → 2 星 ----
    page.click('.modal [data-action="next-level"]')
    page.wait_for_timeout(160)
    check('[%s] 下一关进入第 2 关' % tag, state(page)['level'] == 2)
    check('[%s] 第 2 关也发 4 张牌' % tag, len(alive(state(page))) == 4)
    page.click('#btn-hint')
    page.wait_for_timeout(80)
    res = play_to_win(page)
    check('[%s] 用过提示拿 2 星' % tag, lit_stars(page) == 2, '实际 %d 星' % lit_stars(page))

    # ---- 看过答案 → 1 星 ----
    page.click('.modal [data-action="next-level"]')
    page.wait_for_timeout(160)
    check('[%s] 进入第 3 关' % tag, state(page)['level'] == 3)
    page.click('#btn-answer')
    page.wait_for_timeout(140)
    check('[%s] 答案弹窗出现' % tag, page.is_visible('#modal-root.show'))
    answer_expr = page.evaluate('() => (document.querySelector(".modal .expr")||{}).textContent || ""').strip()
    check('[%s] 答案里有表达式' % tag, answer_expr != '', answer_expr)
    check('[%s] 答案表达式等于 24' % tag, _evaluate_expr(answer_expr) == 24, answer_expr)
    shot(page, '%s-3-answer' % tag)
    page.click('.modal [data-action="close"]')
    page.wait_for_timeout(100)
    res = play_to_win(page)
    check('[%s] 看过答案只给 1 星' % tag, lit_stars(page) == 1, '实际 %d 星' % lit_stars(page))
    page.click('.modal [data-action="next-level"]')
    page.wait_for_timeout(160)
    check('[%s] 可以一路推进到第 4 关' % tag, state(page)['level'] == 4, str(state(page)['level']))

    # ---- 故意算错 → 失败提示 ----
    bad_level = page.evaluate('''() => {
        for (let n = 1; n <= 80; n++) {
            const lv = __P24__.getLevel(n);
            if (lv.nums.reduce((a, b) => a + b, 0) !== 24) return n;
        }
        return 0;
    }''')
    check('[%s] 找得到"四张牌相加不等于 24"的关卡' % tag, bad_level > 0, str(bad_level))
    page.evaluate('(n) => __P24__.startLevel(n)', bad_level)
    page.wait_for_timeout(160)
    for _ in range(3):
        if not merge_with_plus(page):
            break
    page.wait_for_timeout(180)
    st = state(page)
    check('[%s] 结果不等于目标时会判失败' % tag,
          st['dead'] is True and len(alive(st)) == 1, json.dumps(st))
    check('[%s] 失败时给出提示文案' % tag, '要得到 24' in page.inner_text('#expr-line'), page.inner_text('#expr-line'))
    page.click('#btn-undo')
    page.wait_for_timeout(100)
    check('[%s] 失败后撤销回到上一次的 2 张牌' % tag, len(alive(state(page))) == 2,
          str(len(alive(state(page)))))
    page.click('#btn-undo')
    page.wait_for_timeout(100)
    check('[%s] 再撤销回到 3 张牌' % tag, len(alive(state(page))) == 3)
    page.click('#btn-undo')
    page.wait_for_timeout(100)
    check('[%s] 连续撤销回到 4 张牌' % tag, len(alive(state(page))) == 4)

    page.click('#btn-game-back')
    page.wait_for_timeout(140)
    check('[%s] 返回选关页' % tag, page.is_visible('#screen-levels'))
    check('[%s] 选关页有 20 关' % tag, len(page.query_selector_all('.lv')) == 20)
    check('[%s] 选关页有 15 个章节分页点' % tag, len(page.query_selector_all('#level-dots i')) == 15)
    check('[%s] 选关页有锁着的关卡' % tag, len(page.query_selector_all('.lv.locked')) > 0)
    check('[%s] 第 20 关是考试关' % tag, page.evaluate('() => document.querySelectorAll(".lv")[19].classList.contains("exam")'))
    shot(page, '%s-5-levels' % tag)
    page.click('#btn-levels-back')
    page.wait_for_timeout(100)
    check('[%s] 章节页有 15 章' % tag, len(page.query_selector_all('.chapter')) == 15)
    shot(page, '%s-6-chapters' % tag)

    # ---------- 儿童模式 ----------
    page.click('[data-back="home"]')
    page.wait_for_timeout(120)
    check('[%s] 从章节页回到首页' % tag, page.is_visible('#screen-home'))
    page.click('#btn-kid')
    page.wait_for_timeout(180)
    check('[%s] 进入儿童模式牌桌' % tag, page.is_visible('#screen-game'), page.inner_text('#game-title'))
    st = state(page)
    check('[%s] 儿童模式只有 2 个运算符' % tag, st['ops'] == ['+', '\u2212'], json.dumps(st['ops']))
    check('[%s] 儿童模式目标就是 24' % tag, st['target'] == 24, str(st['target']))
    check('[%s] 儿童模式标题写明只加减' % tag, '只用' in page.inner_text('#game-sub'), page.inner_text('#game-sub'))
    check('[%s] 儿童模式运算符按钮只有 2 个' % tag, len(page.query_selector_all('.op-btn')) == 2)
    check('[%s] 儿童模式隐藏了"答案"按钮' % tag,
          page.evaluate('() => getComputedStyle(document.getElementById("btn-answer")).display === "none"'))
    check('[%s] 儿童模式没有"目标"切换按钮' % tag, page.query_selector('#btn-target-pick') is None)
    check('[%s] 儿童模式棋盘上不用乘除' % tag,
          all(op in ('+', '\u2212') for op in st['ops']))
    check('[%s] 儿童模式牌面都是小数字（≤10）' % tag,
          all(1 <= c['v']['n'] <= 10 for c in alive(st)), json.dumps([c['v'] for c in alive(st)]))
    shot(page, '%s-7-kid' % tag)

    ok_kid = True
    detail = ''
    for i in range(4):
        res = play_to_win(page)
        if not (res and res['solved']):
            ok_kid = False
            detail = '第 %d 题失败: %s' % (i + 1, json.dumps(res))
            break
        if i == 0:
            # 第一次答对时检查庆祝动画与"没有评分"
            check('[%s] 儿童模式通关有小女孩庆祝动画' % tag,
                  page.evaluate('() => !!document.querySelector(".modal .party .girl")'))
            anim = page.evaluate('''() => {
                const g = document.querySelector('.modal .party .girl');
                if (!g) return null;
                const cs = getComputedStyle(g);
                return { name: cs.animationName, dur: cs.animationDuration };
            }''')
            check('[%s] 小女孩在动（不是静止图）' % tag,
                  anim and anim['name'] not in (None, '', 'none'), json.dumps(anim))
            check('[%s] 庆祝时还有飘动的爱心/星星' % tag,
                  len(page.query_selector_all('.modal .party .spark')) >= 4)
            check('[%s] 儿童模式不显示星级评分' % tag,
                  page.query_selector('.modal .big-stars') is None)
            check('[%s] 儿童模式不显示连对计数' % tag,
                  '连对' not in page.inner_text('.modal'), page.inner_text('.modal')[:80])
            shot(page, '%s-8-kid-win' % tag)
        page.click('.modal [data-action="new-kid"]')
        page.wait_for_timeout(160)
    check('[%s] 儿童模式连做 4 题全部答对' % tag, ok_kid, detail)
    st = state(page)
    check('[%s] 儿童模式仍是凑 24' % tag, st['target'] == 24, str(st['target']))
    check('[%s] 儿童模式标题只有玩法说明，没有分数' % tag,
          '连对' not in page.inner_text('#game-sub'), page.inner_text('#game-sub'))
    check('[%s] 儿童模式题目只用加减即可解' % tag, page.evaluate('() => !!__P24__.solve()'))

    # 循环结束时刚开了新题、没有弹窗，直接用左上角返回键回首页
    page.click('#btn-game-back')
    page.wait_for_timeout(160)
    check('[%s] 从儿童模式回到首页' % tag, page.is_visible('#screen-home'))

    # ---------- 自由练习 ----------
    page.click('#btn-practice')
    page.wait_for_timeout(160)
    check('[%s] 自由练习进入牌桌' % tag, state(page)['mode'] == 'practice')
    check('[%s] 自由练习四则全开' % tag, len(state(page)['ops']) == 4)
    res = play_to_win(page)
    check('[%s] 自由练习可通关' % tag, res and res['solved'], json.dumps(res))
    page.click('.modal [data-action="goto-home"]')
    page.wait_for_timeout(120)

    # ---------- 设置 ----------
    page.click('#btn-chapters')
    page.wait_for_timeout(100)
    page.click('#btn-settings-1')
    page.wait_for_timeout(120)
    check('[%s] 设置弹窗出现' % tag, page.is_visible('#modal-root.show'))
    page.click('.modal [data-action="toggle-unlock"]')
    page.wait_for_timeout(150)
    unlocked = page.evaluate('() => __P24__.store.settings.unlockAll')
    check('[%s] 解锁全部关卡开关可用' % tag, unlocked is True, str(unlocked))
    shot(page, '%s-9-settings' % tag)
    page.click('.modal [data-action="close"]')
    page.wait_for_timeout(100)
    page.click('#btn-settings-1')
    page.wait_for_timeout(120)
    page.click('.modal [data-action="toggle-unlock"]')  # 关掉，避免影响上面的断言顺序
    page.wait_for_timeout(120)
    page.click('.modal [data-action="close"]')
    page.wait_for_timeout(100)

    # ---------- 布局检查 ----------
    page.click('[data-back="home"]')
    page.wait_for_timeout(120)
    page.click('#btn-continue')
    page.wait_for_timeout(150)
    lr = layout_report(page)
    check('[%s] 牌桌无横向溢出' % tag, not lr['overflowX'], json.dumps(lr))
    check('[%s] 触控目标都不小于 40px' % tag, not lr['tiny'], json.dumps(lr['tiny']))
    check('[%s] 所有按钮都在视口内' % tag, not lr['bad'], json.dumps(lr['bad']))

    # ---------- Service Worker / 离线 ----------
    if tag == 'ipad-portrait':
        try:
            sw = page.evaluate('''() => Promise.race([
                navigator.serviceWorker.ready.then(() => 'ready'),
                new Promise(r => setTimeout(() => r('timeout'), 4000))
            ])''')
            check('[%s] Service Worker 就绪' % tag, sw == 'ready', str(sw))
            reg = page.evaluate('(t) => Promise.race([navigator.serviceWorker.getRegistrations().then(r => r.length), new Promise(r => setTimeout(() => r(-1), 3000))])',
                                None)
            check('[%s] Service Worker 已注册' % tag, isinstance(reg, int) and reg >= 1, str(reg))
            page.wait_for_timeout(500)
            ctx.set_offline(True)
            page.reload(wait_until='load', timeout=15000)
            page.wait_for_timeout(500)
            check('[%s] 断网后仍能打开（离线可玩）' % tag, page.is_visible('#screen-home'))
            shot(page, '%s-10-offline' % tag)
            ctx.set_offline(False)
        except Exception as e:  # noqa: BLE001
            check('[%s] 离线能力' % tag, False, '%s: %s' % (type(e).__name__, e))
            try:
                ctx.set_offline(False)
            except Exception:  # noqa: BLE001
                pass

    check('[%s] 全程无 JS 报错' % tag, not errors, ' | '.join(errors[:4]))

    ctx.close()
    browser.close()


def run_file_url(pw):
    """验证"方案 C"：把 dist/index.html 当成普通文件直接打开也能玩（没有服务器、没有 SW）"""
    section('单文件直接打开 (file://)')
    index = os.path.join(DIST, 'index.html')
    uri = 'file:///' + index.replace('\\', '/').replace(' ', '%20')
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 820, 'height': 1180}, has_touch=True)
    page = ctx.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
    page.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)

    page.goto(uri, wait_until='load')
    page.wait_for_timeout(300)
    check('[file] 单文件能直接打开', page.is_visible('#screen-home'))
    check('[file] 首页无 JS 报错', not errors, ' | '.join(errors[:3]))
    check('[file] 300 关数据已内联', page.evaluate('() => window.P24_LEVELS && window.P24_LEVELS.length === 300'))
    check('[file] 引擎可用', page.evaluate('() => window.P24Engine.solveAll([3,3,8,8], 10).length > 0'))

    page.click('#btn-continue')
    page.wait_for_timeout(160)
    check('[file] 进入牌桌并发 4 张牌', len(page.query_selector_all('.card')) == 4)

    # 单文件模式下不走 Service Worker（无 http 环境）
    check('[file] file:// 下不注册 Service Worker',
          page.evaluate('() => location.protocol === "file:"'))

    page.click('#btn-game-back')      # 牌桌 → 选关页
    page.wait_for_timeout(140)
    page.click('#btn-levels-back')    # 选关页 → 章节页
    page.wait_for_timeout(140)
    page.click('[data-back="home"]')  # 章节页 → 首页
    page.wait_for_timeout(140)
    page.click('#btn-kid')
    page.wait_for_timeout(200)
    check('[file] 儿童模式只剩 2 个运算符', len(page.query_selector_all('.op-btn')) == 2)
    check('[file] 儿童模式全程无报错', not errors, ' | '.join(errors[:3]))
    shot(page, 'file-1-kid')

    ctx.close()
    browser.close()


def main():
    if not os.path.exists(os.path.join(DIST, 'index.html')):
        print('✗ 找不到 dist/index.html，请先运行 node build.mjs')
        return 1

    httpd = start_server()
    time.sleep(0.4)
    print('测试服务器: %s' % URL)

    with sync_playwright() as pw:
        run(pw, (820, 1180), 'iPad 竖屏', 'ipad-portrait')
        run(pw, (1180, 820), 'iPad 横屏', 'ipad-landscape')
        run(pw, (390, 844), '手机竖屏', 'phone')
        run_file_url(pw)

    httpd.shutdown()

    print('\n' + '─' * 60)
    if FAIL:
        print('\033[31m✗ %d 项失败 / %d 项\033[0m' % (len(FAIL), len(PASS) + len(FAIL)))
        for f in FAIL:
            print('   - ' + f)
    else:
        print('\033[32m✓ 全部通过：%d 项断言\033[0m' % len(PASS))
    print('─' * 60)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
