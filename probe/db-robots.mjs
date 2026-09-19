for (const host of ['https://www.douban.com', 'https://movie.douban.com']) {
  const r = await fetch(host + '/robots.txt', { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }).catch((e) => null);
  if (!r) { console.log(host, 'ERR'); continue; }
  const t = await r.text();
  console.log(`\n=== ${host}/robots.txt [${r.status}] ===`);
  console.log(t.split('\n').filter((l) => /^[UuDdSs]/.test(l) || /search_suggest|\/j\//.test(l)).join('\n'));
}
