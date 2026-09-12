/*!
 * 打包脚本：把 src/ 下的源码内联成 dist/ 里可直接双击打开的单文件游戏
 *
 * 用法：
 *   node tools/gen-levels.cjs   # 先固化关卡（改动引擎后需要重跑）
 *   node build.mjs              # 再打包
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

function read(p) {
  const f = path.join(SRC, p);
  if (!existsSync(f)) {
    console.error('✗ 缺少源文件: ' + f);
    if (p === 'levels.js') console.error('  提示：先运行 node tools/gen-levels.cjs');
    process.exit(1);
  }
  return readFileSync(f, 'utf8');
}

mkdirSync(DIST, { recursive: true });

const css = read('style.css');
const levels = read('levels.js');
const engine = read('engine.js');
const app = read('app.js');
let html = read('index.template.html');

function inline(tpl, marker, code, label) {
  const token = '/*{{' + marker + '}}*/';
  if (tpl.indexOf(token) < 0) {
    console.error('✗ 模板里找不到占位符 ' + token);
    process.exit(1);
  }
  console.log('  内联 ' + label.padEnd(8) + (code.length / 1024).toFixed(1).padStart(7) + ' KB');
  return tpl.replace(token, () => code);
}

console.log('打包 朵朵的24点 → dist/');
html = inline(html, 'CSS', css, 'style');
html = inline(html, 'LEVELS', levels, 'levels');
html = inline(html, 'ENGINE', engine, 'engine');
html = inline(html, 'APP', app, 'app');

if (/\{\{[A-Z]+\}\}/.test(html)) {
  console.error('✗ 仍有未替换的占位符');
  process.exit(1);
}

const outFile = path.join(DIST, 'index.html');
writeFileSync(outFile, html, 'utf8');

// 图标：由 tools/make-icons.ps1（Windows）预先生成并提交在 assets/ 里，
// 打包时复制进 dist/。这样 CI（Linux）上不跑 PowerShell 也能产出完整站点。
const ASSETS_DIR = path.join(__dirname, 'assets');
let iconCount = 0;
if (existsSync(ASSETS_DIR)) {
  for (const f of readdirSync(ASSETS_DIR)) {
    if (!/\.(png|ico|svg)$/i.test(f)) continue;
    copyFileSync(path.join(ASSETS_DIR, f), path.join(DIST, f));
    iconCount++;
  }
}
if (!iconCount) {
  console.error('✗ assets/ 里没有图标，请先运行 powershell -File tools/make-icons.ps1');
  process.exit(1);
}

// Service Worker 与 PWA 清单：仅在使用 http(s) 访问（局域网/托管）时生效，
// 直接用文件方式打开 index.html 也能玩，只是没有离线缓存与"添加到主屏幕"。
const sw = `/* 朵朵的24点 · Service Worker：离线缓存应用外壳 */
const CACHE = 'p24-v5';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  // 逐个缓存并各自容错：某个文件缺失也不会让整个安装失败（否则会失去离线能力）
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDoc(req) {
  const accept = req.headers.get('accept') || '';
  return req.mode === 'navigate' || accept.indexOf('text/html') >= 0;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const req = e.request;

  if (isDoc(req)) {
    // 页面：先给缓存（电脑关机也能秒开），同时后台更新
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) {
        fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        // 关键兜底：网址可能带参数（?debug 等），缓存键对不上时用首页顶上
        const fb = (await cache.match('./index.html')) || (await cache.match('./'));
        if (fb) return fb;
        throw err;
      }
    })());
    return;
  }

  // 图标、清单等静态资源：缓存优先
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  })());
});
`;
writeFileSync(path.join(DIST, 'sw.js'), sw, 'utf8');

const manifest = {
  name: '朵朵的24点',
  short_name: '朵朵的24点',
  description: '朵朵的24点：300 关闯关 + 儿童加减模式，纯本地运行、离线可玩、无广告。',
  lang: 'zh-CN',
  start_url: './index.html',
  scope: './',
  display: 'standalone',
  display_override: ['standalone', 'fullscreen'],
  orientation: 'any',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  categories: ['games', 'education'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};
writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const size = statSync(outFile).size;
const hash = createHash('sha256').update(readFileSync(outFile)).digest('hex').slice(0, 12);
console.log('\n✓ dist/index.html  ' + (size / 1024).toFixed(1) + ' KB  sha256:' + hash);
console.log('✓ dist/sw.js / manifest.webmanifest / ' + iconCount + ' 个图标');
console.log('\n本机预览：node tools/serve.mjs（或双击 启动服务器.cmd）');
console.log('发布到 GitHub Pages：推到 main 分支后由 .github/workflows/pages.yml 自动部署');
