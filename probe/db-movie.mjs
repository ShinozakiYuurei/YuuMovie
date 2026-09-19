const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', referer: 'https://movie.douban.com/' };
const r = await fetch('https://movie.douban.com/robots.txt', { headers: UA, signal: AbortSignal.timeout(15000) });
console.log('=== movie.douban.com/robots.txt 全文 ===');
console.log((await r.text()).trim());

console.log('\n=== 端点探测 ===');
const eps = [
  ['movie/j/search_suggest', 'https://movie.douban.com/j/search_suggest?q=%E6%AD%BB%E8%88%87%E6%96%B0%E7%94%9F&tag=movie'],
  ['movie/j/subject_suggest', 'https://movie.douban.com/j/subject_suggest?q=%E6%AD%BB%E8%88%87%E6%96%B0%E7%94%9F'],
  ['movie/j/subject/1455442/json', 'https://movie.douban.com/j/subject/1455442/json'],
  ['movie/subject/1455442/json', 'https://movie.douban.com/subject/1455442/json'],
  ['app api v2', 'https://api.douban.com/v2/movie/subject/1455442'],
];
for (const [name, url] of eps) {
  try {
    const t0 = Date.now();
    const res = await fetch(url, { headers: UA, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const b = await res.text();
    console.log(`\n[${res.status}] ${b.length}B ${Date.now() - t0}ms  ${name}`);
    console.log('   ', b.slice(0, 300).replace(/\s+/g, ' '));
    if (res.status >= 300 && res.status < 400) console.log('    → Location:', res.headers.get('location'));
  } catch (e) { console.log(`\nERR ${name}: ${e.message}`); }
  await new Promise((s) => setTimeout(s, 600));
}
