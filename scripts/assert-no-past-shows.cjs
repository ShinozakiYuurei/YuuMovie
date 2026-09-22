// 直接驗收用戶的原始抱怨：「電影到時間上映後，你不會剔除場次」
//
// 這是**最直接**的斷言：把線上頁面上所有場次抓下來，
// 逐個檢查有沒有「開映時刻已經過去」的 —— 有的話就是 bug 還在。
//
// 前面幾個測試用的是假時鐘（證明機制有效），這一個用**真實時鐘**
// 檢查線上當下的實際輸出 —— 用戶看到的就是這份。
//
// 用法：node scripts/assert-no-past-shows.cjs [baseUrl]
const { chromium } = require('../probe/node_modules/playwright');

const BASE = process.argv[2] || 'https://hkmovie.yuurei.de';
// 抽查幾個不同規模的頁面：熱門片（場次多）、戲院頁、上映中列表
const PATHS = [
  ['/movie/movie-mcl-14858/', '詳情頁（熱門片）'],
  ['/cinema/mcl-021/', '戲院頁（場次最多）'],
  ['/movie/movie-mcl-14789/', '詳情頁（另一部）'],
];

/** 抓出頁面上每個場次的 { label, at }（epoch） */
const readShows = (page) => page.evaluate(() => {
  const out = [];
  // 詳情頁：aria-label="9月23日（週三） · 09:50 · …"（年份由頁面語境決定，用 2026）
  for (const a of document.querySelectorAll('a[aria-label]')) {
    const l = a.getAttribute('aria-label') || '';
    const m = l.match(/(\d+)月(\d+)日（[^）]*） · (\d\d:\d\d) · /);
    if (!m) continue;
    out.push({
      label: l,
      at: Date.parse(`2026-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}T${m[3]}:00+08:00`),
    });
  }
  // 戲院頁：場次膠囊 <a title="2院 $60">，日期在所在 section 的 h2
  for (const sec of document.querySelectorAll('section')) {
    const h2 = sec.querySelector('h2');
    const dm = h2 && h2.textContent.match(/(\d+)月(\d+)日/);
    if (!dm) continue;
    for (const a of sec.querySelectorAll('a[title]')) {
      const t = a.querySelector('span')?.textContent?.trim();
      if (!/^\d\d:\d\d$/.test(t || '')) continue;
      out.push({
        label: `${+dm[1]}月${+dm[2]}日 · ${t} · ${a.getAttribute('title')}`,
        at: Date.parse(`2026-${String(+dm[1]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}T${t}:00+08:00`),
      });
    }
  }
  return out;
});

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const now = Date.now();
  console.log(`=== 真實時鐘驗收（${new Date(now).toISOString()}）===`);

  for (const [p, label] of PATHS) {
    const page = await browser.newPage();
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // 等客戶端 effect tick 完

    const shows = await readShows(page);
    const past = shows.filter((s) => s.at < now);
    const ok = past.length === 0;
    console.log(
      `${ok ? '  ✓' : '  ✗'} ${label} ${p} — 共 ${shows.length} 場，其中已開映 ${past.length} 場`
    );
    if (!ok) {
      for (const s of past.slice(0, 8)) {
        const mins = Math.round((now - s.at) / 60000);
        console.log(`      已開映 ${mins} 分鐘：${s.label}`);
      }
      if (past.length > 8) console.log(`      …還有 ${past.length - 8} 場`);
      fails.push(`${label}(${past.length} 場過期)`);
    }
    await page.close();
  }

  await browser.close();
  console.log(
    fails.length
      ? `\n❌ 仍有已開映場次殘留：${fails.join('、')}`
      : '\n✅ 線上所有抽查頁面都沒有已開映的場次'
  );
  process.exit(fails.length ? 1 : 0);
})();
