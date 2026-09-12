from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width':820,'height':1180})
    p = ctx.new_page()
    p.goto('https://dew8788.github.io/duoduo-24/', wait_until='load', timeout=60000)
    p.wait_for_timeout(800)
    n = p.evaluate('() => navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(x => x.length)')
    print('  已注销 SW 数量:', n)
    p.reload(wait_until='load', timeout=60000)
    p.wait_for_timeout(500)
    res = p.evaluate('''() => {
        const one = (u) => { const t0=performance.now();
          return Promise.race([
            fetch(u).then(r=>r.blob()).then(()=> u+'  OK  '+Math.round(performance.now()-t0)+'ms'),
            new Promise(r=>setTimeout(()=>r(u+'  超时(>10000ms)'),10000))
          ]).catch(e=>u+'  ERR  '+e.message);
        };
        return Promise.all(['./','./index.html','./icon-180.png'].map(one));
    }''')
    for r in res: print('  ', r)
    b.close()
