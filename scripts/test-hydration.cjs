// 檢查 hydration 是否乾淨（無 mismatch 警告）
//
// 為什麼要單獨測：本站在 SSG 產物上做客戶端過濾，最容易踩的坑就是
// 「首次渲染與構建產物不一致」→ React 報 hydration mismatch 並整棵樹重渲染。
// 故 useLiveNow() 首次刻意回傳 null（全部保留），掛載後才寫入真實時間。
// 本腳本監聽 console 與 pageerror 確認真的沒有警告。
//
// 用法：node scripts/test-hydration.cjs
const { chromium } = require('../probe/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p);
  try {
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});

const URLS = [
  ['/', '首頁'],
  ['/showing/', '上映中列表'],
  ['/cinema/', '戲院列表'],
];
for (const [section, label] of [['cinema', '戲院詳情'], ['movie', '電影詳情']]) {
  const route = fs.readdirSync(path.join(ROOT, section)).sort().find((name) =>
    fs.existsSync(path.join(ROOT, section, name, 'index.html'))
  );
  if (route) URLS.push([`/${section}/${route}/`, label]);
}

(async () => {
  await new Promise((r) => server.listen(4321, r));
  const browser = await chromium.launch();
  const fails = [];

  for (const [p, label] of URLS) {
    const page = await browser.newPage();
    const msgs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.text()); });
    page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));

    await page.goto('http://127.0.0.1:4321' + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200); // 留時間給 effect 與 React 的警告輸出

    const bad = msgs.filter((t) => /hydrat|did not match|mismatch|Minified React error/i.test(t));
    const ok = bad.length === 0;
    console.log(`${ok ? '  ✓' : '  ✗'} ${label} ${p}${ok ? '' : '\n      ' + bad.join('\n      ')}`);
    if (!ok) fails.push(label);
    if (msgs.length && ok) console.log(`      （其他訊息 ${msgs.length} 條，非 hydration 相關）`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(fails.length ? `\n❌ ${fails.length} 個頁面有 hydration 問題：${fails.join('、')}` : '\n✅ 無 hydration 警告');
  process.exit(fails.length ? 1 : 0);
})();
