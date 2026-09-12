#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""离线验证：iPad 上加过主屏幕之后，电脑关掉还能不能玩？

用真实 Chromium 跑三步：
  1. 正常联网打开一次，等 Service Worker 装好
  2. 关掉服务器（相当于电脑关机）再打开一次
  3. 换成「接受连接但永不响应」的服务器（相当于电脑卡死 / 网络超时）再打开一次
第 3 步是关键：如果实现是"先等网络"，这里就会卡住好几秒；如果是"先给缓存"，就秒开。

用法: python test/offline_test.py
"""

import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
PORT = 8096
URL = 'http://127.0.0.1:%d/index.html' % PORT

PASS, FAIL = [], []


def check(name, cond, extra=''):
    if cond:
        PASS.append(name)
        print('  \033[32m✓\033[0m %s' % name)
    else:
        FAIL.append('%s  %s' % (name, extra))
        print('  \033[31m✗\033[0m %s   %s' % (name, extra))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server():
    httpd = Server(('127.0.0.1', PORT), functools.partial(Quiet, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def start_blackhole(stop_evt):
    """接受 TCP 连接但永远不回数据 —— 模拟电脑卡住 / 局域网超时"""
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', PORT))
    s.listen(16)
    s.settimeout(0.4)
    conns = []

    def run():
        while not stop_evt.is_set():
            try:
                c, _ = s.accept()
                conns.append(c)
            except socket.timeout:
                continue
            except OSError:
                break
        for c in conns:
            try:
                c.close()
            except OSError:
                pass
        s.close()

    threading.Thread(target=run, daemon=True).start()


def timed_reload(page):
    t0 = time.time()
    page.reload(wait_until='domcontentloaded', timeout=30000)
    page.wait_for_selector('#screen-home.active', timeout=15000)
    return (time.time() - t0) * 1000


def main():
    if not os.path.exists(os.path.join(DIST, 'index.html')):
        print('✗ 找不到 dist/index.html，先运行 node build.mjs')
        return 1

    httpd = start_server()
    time.sleep(0.3)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 820, 'height': 1180},
                                  has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.set_default_timeout(15000)

        print('\n=== 第 1 步：联网打开一次，装好 Service Worker ===')
        page.goto(URL, wait_until='load')
        page.wait_for_timeout(400)
        check('首次联网能打开', page.is_visible('#screen-home'))
        sw = page.evaluate('''() => Promise.race([
            navigator.serviceWorker.ready.then(() => 'ready'),
            new Promise(r => setTimeout(() => r('timeout'), 8000))
        ])''')
        check('Service Worker 已就绪', sw == 'ready', str(sw))
        page.wait_for_timeout(800)   # 等 install 里的 addAll 预缓存完成
        cached = page.evaluate('''() => caches.keys().then(async (ks) => {
            let n = 0;
            for (const k of ks) { const c = await caches.open(k); n += (await c.keys()).length; }
            return n;
        })''')
        check('应用外壳已被缓存到 iPad 本地', isinstance(cached, int) and cached >= 5, '缓存条目 %s' % cached)

        print('\n=== 第 2 步：关掉服务器（= 电脑关机）再打开 ===')
        httpd.shutdown()
        httpd.server_close()
        time.sleep(0.5)
        try:
            ms = timed_reload(page)
            check('电脑关机能打开', page.is_visible('#screen-home'))
            check('而且是秒开（< 1500ms）', ms < 1500, '实际 %.0f ms' % ms)
            print('     打开耗时 %.0f ms' % ms)
        except Exception as e:  # noqa: BLE001
            check('电脑关机能打开', False, '%s: %s' % (type(e).__name__, e))

        print('\n=== 第 3 步：服务器卡住不响应（局域网超时）再打开 ===')
        stop = threading.Event()
        start_blackhole(stop)
        time.sleep(0.4)
        try:
            ms2 = timed_reload(page)
            check('网络超时时也能打开（不会一直转圈等网络）',
                  page.is_visible('#screen-home'))
            check('等待时间不受网络拖累（< 1500ms）', ms2 < 1500, '实际 %.0f ms' % ms2)
            print('     打开耗时 %.0f ms（若实现是"先等网络"，这里会是 5~30 秒）' % ms2)
        except Exception as e:  # noqa: BLE001
            check('网络超时时也能打开', False, '%s: %s' % (type(e).__name__, e))
        stop.set()
        time.sleep(0.5)

        print('\n=== 第 4 步：恢复服务器后，新版本还能推送过来 ===')
        httpd2 = start_server()
        time.sleep(0.4)
        try:
            page.reload(wait_until='load')
            page.wait_for_timeout(1500)
            # 「先给缓存、后台更新」：第一次刷新拿到旧的，后台已更新缓存
            page.reload(wait_until='load')
            page.wait_for_timeout(600)
            check('恢复联网后仍能正常打开', page.is_visible('#screen-home'))
            ver = page.evaluate('''() => caches.keys().then(async (ks) => {
                for (const k of ks) {
                    const c = await caches.open(k);
                    const r = await c.match('./index.html');
                    if (r) { const t = await r.text(); return t.indexOf('朵朵的24点') >= 0 ? 'new' : 'old'; }
                }
                return 'missing';
            })''')
            check('缓存里是最新版（能收到后续更新）', ver == 'new', str(ver))
        except Exception as e:  # noqa: BLE001
            check('恢复联网后仍能正常打开', False, '%s: %s' % (type(e).__name__, e))
        httpd2.shutdown()
        httpd2.server_close()

        ctx.close()
        browser.close()

    print('\n' + '─' * 58)
    if FAIL:
        print('\033[31m✗ %d 项失败 / %d 项\033[0m' % (len(FAIL), len(PASS) + len(FAIL)))
        for f in FAIL:
            print('   - ' + f)
    else:
        print('\033[32m✓ 全部通过：%d 项断言\033[0m' % len(PASS))
    print('─' * 58)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
