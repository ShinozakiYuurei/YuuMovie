const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', referer: 'https://www.douban.com/', accept: 'application/json' };
const fs = await import('node:fs');
const movies = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const { enrichKey } = await import('../lib/enrich-key.js');
const keys = [...new Set(movies.map((m) => enrichKey(m.nameZh || m.nameEn)).filter(Boolean))];
const names = [];
const seen = new Set();
for (const m of movies) { const k = enrichKey(m.nameZh || m.nameEn); if (k && !seen.has(k)) { seen.add(k); names.push({ k, zh: m.nameZh || '', en: m.nameEn || '' }); } }
let ok = 0, empty = 0, err = 0, rated = 0; const t0 = Date.now(); const bad = [];
for (let i = 0; i < 60; i++) {
  const n = names[i];
  try {
    const r = await fetch(`https://www.douban.com/j/search_suggest?q=${encodeURIComponent(n.zh || n.en)}&tag=movie`, { headers: UA, signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => null);
    const cards = j?.cards || [];
    if (!r.ok || !j) { err++; bad.push(`${r.status} ${n.zh}`); }
    else if (!cards.length) { empty++; bad.push('空 ' + n.zh); }
    else { ok++; if (/[\d.]+分/.test(cards[0].card_subtitle || '')) rated++; }
  } catch (e) { err++; bad.push('ERR ' + n.zh + ' ' + e.message); }
  await new Promise((s) => setTimeout(s, 250));
}
console.log(`60 次：命中 ${ok}（有分 ${rated}）| 空 ${empty} | 失败 ${err} | 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('异常样例:', bad.slice(0, 12).join(' ; '));
