const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', referer: 'https://www.douban.com/' };
const qs = ['流浪地球', '哪吒', 'SAKAMOTO DAYS', '新世紀福音戰士劇場版', '死與新生', 'Godzilla Minus One', 'Whalefall', '超風', '坂本', '天鷹戰士'];
for (const q of qs) {
  const url = `https://www.douban.com/j/search_suggest?q=${encodeURIComponent(q)}&tag=movie`;
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => null);
    const cards = (j?.cards || []).slice(0, 3);
    console.log(`\n【${q}】 [${r.status}] ${cards.length} 张`);
    for (const c of cards) console.log('   ', c.title, '|', c.year, '|', c.card_subtitle, '|', /subject\/(\d+)/.exec(c.url)?.[1]);
  } catch (e) { console.log(`\n【${q}】 ERR ${e.message}`); }
  await new Promise((s) => setTimeout(s, 500));
}
