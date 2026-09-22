// 驗證：客戶端是否真的會按瀏覽器時鐘剔除已開映場次
//
// 背景：用戶回報「電影到時間上映後，你不會剔除場次」。
// 本站是 SSG（output: 'export'），構建時的過濾管不到「構建之後才開映」的場次，
// 故加了客戶端過濾。本腳本用 Playwright 的假時鐘驗證它真的有效。
//
// ===== 測試前提的兩個坑（都踩過，記在這裡）=====
//
// 1. **期望值不能直接從 data/shows.json 取全集**。
//    構建時已經剔除過一次，9/19 的場次不會出現在產物裡 ——
//    若拿數據全集當期望，會把「構建時已剔除」誤判成「客戶端過濾失效」。
//    正確做法：以**產物在極早時刻的可見集合**為基準（= 構建留下的集合），
//    再斷言「晚於 T 的那些仍在、早於 T 的那些已消失」。
//
// 2. **fastForward 的字串格式不可靠**。
//    實測 fastForward('36:00:00') 並沒有快進 36 小時（場次一個都沒少）。
//    改用**數字毫秒**，語義無歧義。
//
// 用法：node scripts/test-live-filter.cjs
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

/**
 * 抓出頁面上每個場次的 { date: 'M/D', time: 'HH:mm', at: epochMs }
 *
 * 兩種頁面的標記不同：
 *   戲院頁 —— 場次膠囊是 <a title="2院 $60">，日期在同一個 <section> 的 <h2> 裡
 *   詳情頁 —— 場次 <a aria-label="9月23日（週三） · 09:50 · …">，日期就在標籤裡
 * 統一換算成 epoch，這樣比對與時區、年份都無關。
 */
const readShows = (page, kind) => page.evaluate((k) => {
  const out = [];
  if (k === 'cinema') {
    for (const sec of document.querySelectorAll('section')) {
      const h2 = sec.querySelector('h2');
      const dm = h2 && h2.textContent.match(/(\d+)月(\d+)日/);
      if (!dm) continue;
      for (const a of sec.querySelectorAll('a[title]')) {
        const t = a.querySelector('span')?.textContent?.trim();
        if (!/^\d\d:\d\d$/.test(t || '')) continue;
        out.push({ date: `${+dm[1]}/${+dm[2]}`, time: t });
      }
    }
  } else {
    for (const a of document.querySelectorAll('a[aria-label]')) {
      const l = a.getAttribute('aria-label') || '';
      const m = l.match(/(\d+)月(\d+)日（[^）]*） · (\d\d:\d\d) · /);
      if (!m) continue;
      out.push({ date: `${+m[1]}/${+m[2]}`, time: m[3] });
    }
  }
  return out;
}, kind);

const readChip = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.hkm-chip')].map((e) => e.textContent.trim()).find((t) => t.includes('場')));

/** 'M/D HH:mm' → epoch（資料都是 2026 年；香港時區顯式寫入，與測試機時區無關） */
const epochOf = ({ date, time }) => {
  const [mo, d] = date.split('/').map(Number);
  return Date.parse(
    `2026-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${time}:00+08:00`
  );
};

const keyOf = (s) => `${s.date} ${s.time}`;

(async () => {
  await new Promise((r) => server.listen(4321, r));
  const browser = await chromium.launch();
  const fails = [];
  const check = (name, cond, extra = '') => {
    console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) fails.push(name);
  };

  const shows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'shows.json'), 'utf8'));
  const cinemaId = 'mcl-021';
  const movieId = 'mcl-14858';

  const cases = [
    { kind: 'cinema', url: `http://127.0.0.1:4321/cinema/${cinemaId}/`, label: `戲院頁 /cinema/${cinemaId}`, list: shows.filter((s) => s.cinemaId === cinemaId) },
    { kind: 'movie', url: `http://127.0.0.1:4321/movie/movie-${movieId}/`, label: `詳情頁 /movie/movie-${movieId}`, list: shows.filter((s) => s.movieId === movieId) },
  ];

  for (const { kind, url, label, list } of cases) {
    console.log(`\n=== ${label} ===`);

    // 數據中該實體的最後一場（用來算「全部開映」的時刻）
    const lastAt = Math.max(...list.map((s) => Date.parse(s.startAt)));
    // 基準時刻：2026-09-19 00:00 —— 產物裡留下的場次全都還沒開映
    const T0 = Date.parse('2026-09-19T00:00:00+08:00');

    // ---------- 1. 基準：極早時刻，頁面應等於構建留下的集合 ----------
    const p1 = await browser.newPage();
    await p1.clock.install({ time: new Date(T0) });
    await p1.goto(url, { waitUntil: 'networkidle' });
    await p1.waitForTimeout(400); // 等 useEffect 的第一次 tick
    const base = await readShows(p1, kind);
    check('基準時刻：場次非空', base.length > 0, `${base.length} 場`);

    if (kind === 'movie') {
      const chip = await readChip(p1);
      check('標題「共 N 場」與列表數字一致', chip === `共 ${base.length} 場`, `chip=${chip} 列表=${base.length}`);
    }

    // ---------- 2. 快進：驗證定時器會自動剔除（不需重新載入）----------
    //
    // ★ 快進量必須**從數據算**，不能寫死「36 小時」。
    //   產物裡最早的場次是 9/23，從 9/19 起算 36 小時才到 9/20 ——
    //   一個場次都不該消失，第一版就因此把正常的頁面報成失敗。
    //   這裡改為「最早一場開映後 1 毫秒」，保證恰好剔除最早那批。
    const baseAt = base.map((s) => ({ ...s, at: epochOf(s) }));
    const firstAt = Math.min(...baseAt.map((s) => s.at));
    const T1 = firstAt + 1;

    await p1.clock.fastForward(T1 - T0); // ★ 用毫秒，fastForward 的字串格式實測不可靠
    await p1.waitForTimeout(600);
    const after = await readShows(p1, kind);

    // 期望值：基準中「開映時刻 >= T1」的那些（按多重集合比對 ——
    // 不同戲院/影片可以有完全相同的日期+時刻，用 Set 會誤判）
    const want = baseAt.filter((s) => s.at >= T1).map(keyOf).sort();
    const got = after.map(keyOf).sort();
    const eq = want.length === got.length && want.every((k, i) => k === got[i]);

    check('快進到首場開映後：場次減少（定時器生效）', after.length < base.length, `${base.length} → ${after.length}`);
    check('快進後：留下的恰好是「未開映」的那些', eq, `頁面 ${got.length} / 期望 ${want.length}`);
    check('快進後：未誤殺（仍有未開映場次）', after.length > 0, `${after.length} 場`);

    if (kind === 'movie') {
      const chip = await readChip(p1);
      check('剔除後標題數字同步更新', chip === `共 ${after.length} 場`, `chip=${chip} 列表=${after.length}`);
    }
    await p1.close();

    // ---------- 3. 全部開映後：顯示「暫無場次資料」----------
    const p2 = await browser.newPage();
    await p2.clock.install({ time: new Date(lastAt + 3600_000) });
    await p2.goto(url, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(400);
    const emptyText = await p2.evaluate(() => document.body.innerText.includes('暫無場次資料'));
    check('全部開映後：顯示「暫無場次資料」', emptyText);
    await p2.close();
  }

  await browser.close();
  server.close();
  console.log(fails.length ? `\n❌ ${fails.length} 項失敗：${fails.join('、')}` : '\n✅ 全部通過');
  process.exit(fails.length ? 1 : 0);
})();
