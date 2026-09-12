/*!
 * 局域网测试服务器：把 dist/ 发布出来，供 iPad 在同一 WiFi 下访问
 *
 * 用法：node tools/serve.mjs [端口]
 * 然后在 iPad 的 Safari 里打开它打印出来的地址，再「分享 → 添加到主屏幕」。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = parseInt(process.argv[2] || '8080', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('找不到 dist/index.html，请先运行:  node tools/gen-levels.cjs && node build.mjs');
  process.exit(1);
}

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 找不到 ' + rel);
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-cache',
      'service-worker-allowed': '/'
    });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('');
  console.log('  算24点 · 本地服务器已启动');
  console.log('  ─────────────────────────────────────────────');
  console.log('  本机访问:   http://127.0.0.1:' + PORT + '/');
  if (ips.length) {
    for (const ip of ips) {
      console.log('  iPad 访问:  http://' + ip.address + ':' + PORT + '/   (' + ip.name + ')');
    }
    console.log('');
    console.log('  步骤：iPad 连上同一个 WiFi → Safari 打开上面「iPad 访问」的地址');
    console.log('        → 点分享按钮 → 添加到主屏幕。之后断网也能离线玩。');
  } else {
    console.log('  （没有检测到局域网 IP，请确认电脑已连上 WiFi）');
  }
  console.log('  ─────────────────────────────────────────────');
  console.log('  按 Ctrl+C 结束');
  console.log('');
});
