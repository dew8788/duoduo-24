# 直接打开原版游戏本体，把各个界面截下来
import os
import sys

from playwright.sync_api import sync_playwright

OUT = r'D:\新建文件夹\24game\docs\ref'
GAME = 'https://szhong.4399.com/4399swf/upload_swf/ftp23/csya/20171121/3/index.html'
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 390, 'height': 760},
                                  user_agent=UA, has_touch=True, is_mobile=True,
                                  extra_http_headers={
                                      'Referer': 'https://www.4399.com/flash/193616_2.htm',
                                      'Accept-Language': 'zh-CN,zh;q=0.9',
                                  })
        page = ctx.new_page()
        page.on('pageerror', lambda e: print('  pageerror:', str(e)[:120]))
        print('打开游戏本体', GAME)
        page.goto(GAME, wait_until='load', timeout=90000)
        page.wait_for_timeout(15000)
        page.screenshot(path=os.path.join(OUT, 'orig-1-title.png'))
        print('  已截 title')

        print('  画布尺寸:', page.evaluate('''() => {
            const c = document.querySelector('canvas');
            return c ? [c.width, c.height, c.style.width, c.style.height] : null;
        }'''))

        def scene(name, tag, wait=7000):
            try:
                page.evaluate('(n) => cc.director.loadScene(n)', name)
                page.wait_for_timeout(wait)
                page.screenshot(path=os.path.join(OUT, 'orig-%s.png' % tag))
                print('  已截', tag)
            except Exception as e:
                print('  切场景失败', name, str(e)[:120])

        scene('LevelScene', '2-levels')
        scene('GameScene', '3-game')
        scene('LevelUpScene', '4-levelup')

        # 回到主菜单
        scene('MainScene', '5-main', wait=5000)

        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
