const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', referer: 'https://movie.douban.com/' };
const cases = [
  ['subject_suggest 中文', 'https://movie.douban.com/j/subject_suggest?q=%E6%96%B0%E4%B8%96%E7%BA%AA%E7%A6%8F%E9%9F%B3%E6%88%B0%E5%A3%AB'],
  ['subject_suggest EVA', 'https://movie.douban.com/j/subject_suggest?q=Evangelion'],
  ['search_suggest', 'https://www.douban.com/j/search_suggest?q=%E8%B6%85%E9%A2%A8&tag=movie'],
  ['search_subjects', 'https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%A7%91%E5%B9%BB&sort=recommend&page_limit=3&page_start=0'],
  ['chart top_list', 'https://movie.douban.com/j/chart/top_list?type=11&interval_id=100%3A90&action=&start=0&limit=2'],
  ['new_search', 'https://movie.douban.com/j/new_search_subjects?tags=%E7%94%B5%E5%BD%B1&genres=%E7%A7%91%E5%B9%BB&sort=T&range=0%2C10&start=0'],
  ['subject HTML', 'https://movie.douban.com/subject/35204766/'],
];
for (const [name, url] of cases) {
  try {
    const t0 = Date.now();
    const r = await fetch(url, { headers: UA, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const b = await r.text();
    console.log(`\n### ${name}  [${r.status}] ${b.length}B ${Date.now() - t0}ms  final=${r.url.slice(0, 60)}`);
    console.log(b.slice(0, 320).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`\n### ${name}  ERR ${e.message}`);
  }
  await new Promise((s) => setTimeout(s, 700));
}
