// 驗證：相對日期（今天／明天／後天）是否在 hydration 後才由瀏覽器計算
//
// 背景：用戶回報首頁與 /upcoming 的卡片跨天後錯位（「明天上映」其實當天已上映）。
// 本站是 SSG（output: 'export'），HTML 在構建那一刻定稿，而頁面每 2–6 小時才
// 重建一次 —— 相對日期一旦寫進產物，過了香港午夜就必然過期，等下一次重建
// 才自行修正。修法見 components/RelativeDayLabel.tsx 與 lib/format.ts。
//
// 本腳本用 Playwright 假時鐘驗證三件事：
//   1. 靜態 HTML 不含任何相對日期（產物與送出時刻無關，不會過期）
//   2. 掛載後，卡片與場次頁日期條顯示相對日期
//   3. 假時鐘跨過香港午夜後標籤自動更新，不必等下一次重建
//
// 測試不綁定特定日期：卡片場景從構建產物裡挑「最早開畫日」的前一晚當假時鐘，
// 日期條場景從 data/shows.json 挑未來場次最多的電影（與 test-live-filter 同法）。
//
// 用法：node scripts/test-relative-day.cjs
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

const HK = 8 * 3600_000;
/** 'YYYY-MM-DD' 的前一晚 21:00（香港時間）→ epoch ms */
const eveningBefore = (date) => Date.parse(date + 'T21:00:00+08:00') - 86400_000;
/** epoch ms → 香港日期 'YYYY-MM-DD' */
const hkDate = (ms) => new Date(ms + HK).toISOString().slice(0, 10);

/** 卡片上的「X上映 · YYYY-MM-DD」 */
const CARD_RE = /^(今天|明天|後天|\d+ 天後|已過 \d+ 天)上映 · (\d{4}-\d{2}-\d{2})$/;
const readCardLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll('p')].map((p) => p.textContent.trim())
    .filter((t) => /上映 · \d{4}-\d{2}-\d{2}$/.test(t)));
/** 場次頁日期條第三行（第一格是 M/D，第二格是週幾） */
const readStripLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll('button[aria-pressed]')]
    .filter((b) => /^\d+\/\d+$/.test(b.querySelector('span')?.textContent || ''))
    .map((b) => b.querySelectorAll('span')[2]?.textContent ?? null)
    .filter(Boolean));

const labelOn = (list, date) => {
  const hit = list.map((t) => t.match(CARD_RE)).find((m) => m && m[2] === date);
  return hit ? hit[1] : null;
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const fails = [];
  const check = (name, cond, extra = '') => {
    console.log((cond ? '  OK  ' : '  FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
    if (!cond) fails.push(name);
  };

  // ---------- 1. 靜態 HTML 不含相對日期 ----------
  for (const [file, label] of [['index.html', '首頁'], ['upcoming/index.html', '即將上映']]) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const hit = html.match(/(今天|明天|後天|\d+ 天後|已過 \d+ 天)上映/);
    check(label + '靜態 HTML 不含相對日期', !hit, hit ? '命中「' + hit[0] + '」' : '');
  }

  // ---------- 2. 卡片：掛載後顯示，跨香港午夜更新 ----------
  const upcomingHtml = fs.readFileSync(path.join(ROOT, 'upcoming', 'index.html'), 'utf8');
  // HTML 裡 React 會用註解節點分隔相鄰文本：上映 · <!-- -->2026-10-03
  const dates = [...upcomingHtml.matchAll(/上映 · (?:<!-- -->)?(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]).sort();
  if (!dates.length) throw new Error('out/upcoming/index.html 沒有待映卡片，無法測試');
  const firstDate = dates[0];

  const page = await browser.newPage();
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.text()); });
  page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));

  await page.clock.install({ time: new Date(eveningBefore(firstDate)) });
  await page.goto(base + '/upcoming/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const before = await readCardLabels(page);
  check('掛載後卡片全部顯示相對日期', before.length > 0 && before.every((t) => CARD_RE.test(t)), '共 ' + before.length + ' 張');
  check('最早開畫日 ' + firstDate + ' 在前一晚顯示「明天」', labelOn(before, firstDate) === '明天', String(labelOn(before, firstDate)));

  await page.clock.fastForward(3 * 3600_000 + 120_000); // 21:00 → 次日 00:02
  await page.waitForTimeout(400);
  const after = await readCardLabels(page);
  check('跨午夜後同一張卡片更新為「今天」', labelOn(after, firstDate) === '今天', String(labelOn(after, firstDate)));
  check('跨午夜後標籤確實變化', JSON.stringify(before) !== JSON.stringify(after));

  // 首頁用的是同一個 MovieGroupCard
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const home = await readCardLabels(page);
  check('首頁卡片掛載後全部顯示相對日期', home.length > 0 && home.every((t) => CARD_RE.test(t)), '共 ' + home.length + ' 張');

  const bad = msgs.filter((t) => /hydrat|did not match|mismatch|Minified React error/i.test(t));
  check('無 hydration 警告', bad.length === 0, bad.join(' | '));
  await page.close();

  // ---------- 3. 場次頁日期條：掛載後顯示相對日期 ----------
  const shows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'shows.json'), 'utf8'));
  const movies = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'movies.json'), 'utf8'));
  const movieById = new Map(movies.map((m) => [m.id, m]));
  const bySlug = new Map();
  for (const s of shows) {
    const m = movieById.get(s.movieId);
    if (!m || !m.slug || !(Date.parse(s.startAt) > Date.now() + 60_000)) continue;
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, []);
    bySlug.get(m.slug).push(s);
  }
  const top = [...bySlug].sort((a, b) => b[1].length - a[1].length)[0];
  if (top && fs.existsSync(path.join(ROOT, 'movie', top[0], 'index.html'))) {
    const [slug, list] = top;
    const firstShowDate = list.map((s) => hkDate(Date.parse(s.startAt))).sort()[0];
    const p2 = await browser.newPage();
    await p2.clock.install({ time: new Date(eveningBefore(firstShowDate)) });
    await p2.goto(base + '/movie/' + slug + '/', { waitUntil: 'networkidle' });
    await p2.waitForTimeout(300);
    const strip = await readStripLabels(p2);
    check('日期條首格顯示「明天」', strip[0] === '明天', JSON.stringify(strip.slice(0, 8)));
    check('日期條其餘標籤仍是場次數', strip.every((t) => /^(今天|明天|後天|\d+ 場)$/.test(t)));
    await p2.close();
  } else {
    console.log('  （找不到可測的電影詳情頁，跳過日期條）');
  }

  await browser.close();
  server.close();
  console.log(fails.length ? '\n❌ ' + fails.length + ' 項失敗：' + fails.join('、') : '\n✅ 全部通過');
  process.exit(fails.length ? 1 : 0);
})();
