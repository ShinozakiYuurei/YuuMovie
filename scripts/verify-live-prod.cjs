// 對**線上生產環境**驗證實時剔除（不是本地 out/ 產物）
//
// 為什麼要單獨對線上跑一次：本地驗證的是「我構建出來的 HTML」，
// 而真正要修的是「nginx 正在發的那份」。CDN 快取、部署是否真的生效、
// 客戶端 chunk 有沒有正確更新 —— 這些只有打線上才算數。
//
// ===== 兩個踩過的測試前提坑（記在這裡，別再寫回去）=====
//
// 1. **「標題 chip == 列表條數」是錯的斷言**。
//    詳情頁一次只渲染**一天**的場次（見 ShowtimeExplorer 的分層設計），
//    而 chip 是**全部**未開映場次的總數。兩者本來就不該相等。
//    本地之所以「通過」，只是因為構建後只剩 9/23 一天 —— 巧合，不是規律。
//    正確斷言：chip 會隨時間**遞減**，且最終歸零（見下）。
//
// 2. **不能用 A 頁面的最後一場去測 B 頁面**。
//    第一版拿電影頁的最後一場（9/23）去測戲院頁，而 mcl-021 排片到 9/27，
//    於是「應該全空」時還剩 11 場 —— 把正常行為報成了失敗。
//    「全部開映」這種絕對狀態要用**絕對未來時刻**（2027-12-31），
//    不依賴任何單一實體的排片範圍。
//
// 用法：node scripts/verify-live-prod.cjs [baseUrl]
const { chromium } = require('../probe/node_modules/playwright');

const BASE = process.argv[2] || 'https://hkmovie.yuurei.de';
const MOVIE = '/movie/movie-mcl-14858/';
const CINEMA = '/cinema/mcl-021/';

/** 絕對未來：資料裡所有場次都在 2026 年，2027 年底必定全部開映完畢 */
const FAR_FUTURE = new Date('2027-12-31T23:59:00+08:00').getTime();

const readChip = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.hkm-chip')]
    .map((e) => e.textContent.trim())
    .find((t) => t.includes('場')));

const countMovieShows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('a[aria-label]')]
    .map((a) => a.getAttribute('aria-label'))
    .filter((t) => / · \d\d:\d\d · /.test(t || '')).length);

const countCinemaShows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('a[title]')]
    .map((a) => a.querySelector('span')?.textContent?.trim())
    .filter((t) => /^\d\d:\d\d$/.test(t || '')).length);

const hasEmpty = (page) => page.evaluate(() => document.body.innerText.includes('暫無場次資料'));

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const check = (n, c, x = '') => {
    console.log(`${c ? '  ✓' : '  ✗'} ${n}${x ? ' — ' + x : ''}`);
    if (!c) fails.push(n);
  };
  const num = (s) => { const m = (s || '').match(/(\d+)/); return m ? +m[1] : NaN; };

  // ---------- 1. 真實時鐘：頁面正常，且 chip 是個有效數字 ----------
  console.log(`=== 線上 ${BASE} ===`);
  const p1 = await browser.newPage();
  await p1.goto(BASE + MOVIE, { waitUntil: 'networkidle' });
  await p1.waitForTimeout(1500);
  const chipReal = num(await readChip(p1));
  const listReal = await countMovieShows(p1);
  check('真實時鐘：詳情頁有場次', listReal > 0, `當日 ${listReal} 場`);
  check('真實時鐘：chip 是有效場次總數', chipReal > 0, `共 ${chipReal} 場`);
  check('真實時鐘：chip ≥ 當日列表條數（chip 為全量、列表為單日）', chipReal >= listReal,
    `chip ${chipReal} vs 當日 ${listReal}`);
  await p1.close();

  // ---------- 2. 假時鐘快進一天：chip 必須**遞減**（證明實時過濾真的生效）----------
  const p2 = await browser.newPage();
  await p2.clock.install({ time: new Date(Date.now() + 86400_000) });
  await p2.goto(BASE + MOVIE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1500);
  const chipNextDay = num(await readChip(p2));
  check('假時鐘（+1 天）：chip 減少', chipNextDay < chipReal, `${chipReal} → ${chipNextDay}`);
  await p2.close();

  // ---------- 3. 絕對未來：全部開映 → 整區顯示「暫無場次資料」----------
  const p3 = await browser.newPage();
  await p3.clock.install({ time: new Date(FAR_FUTURE) });
  await p3.goto(BASE + MOVIE, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1500);
  check('詳情頁（2027 年底）：場次全部剔除', (await countMovieShows(p3)) === 0);
  check('詳情頁（2027 年底）：顯示「暫無場次資料」', await hasEmpty(p3));
  await p3.close();

  // ---------- 4. 戲院頁同樣驗證 ----------
  const p4 = await browser.newPage();
  await p4.goto(BASE + CINEMA, { waitUntil: 'networkidle' });
  await p4.waitForTimeout(1500);
  const cineReal = await countCinemaShows(p4);
  check('戲院頁 真實時鐘：有場次', cineReal > 0, `${cineReal} 場`);
  await p4.close();

  const p5 = await browser.newPage();
  await p5.clock.install({ time: new Date(FAR_FUTURE) });
  await p5.goto(BASE + CINEMA, { waitUntil: 'networkidle' });
  await p5.waitForTimeout(1500);
  check('戲院頁（2027 年底）：場次全部剔除', (await countCinemaShows(p5)) === 0);
  check('戲院頁（2027 年底）：顯示「暫無場次資料」', await hasEmpty(p5));
  await p5.close();

  await browser.close();
  console.log(fails.length ? `\n❌ ${fails.length} 項失敗：${fails.join('、')}` : '\n✅ 線上驗證全部通過');
  process.exit(fails.length ? 1 : 0);
})();
