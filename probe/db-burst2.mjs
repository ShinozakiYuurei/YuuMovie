const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', referer: 'https://www.douban.com/', accept: 'application/json' };
const fs = await import('node:fs');
const movies = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const { enrichKey } = await import('../lib/enrich-key.js');

/** 去掉院线装饰：括号内容、【】、格式词、尾部「加碼重映」等 */
const deco = (s) =>
  (s || '')
    .replace(/[（(〔[【{「『][^）)〕\]】}」』]*[）)〕\]】}」』]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const seen = new Set(); const names = [];
for (const m of movies) { const k = enrichKey(m.nameZh || m.nameEn); if (k && !seen.has(k)) { seen.add(k); names.push({ k, zh: m.nameZh || '', en: m.nameEn || '' }); } }

async function suggest(q) {
  if (!q) return null;
  const r = await fetch(`https://www.douban.com/j/search_suggest?q=${encodeURIComponent(q)}&tag=movie`, { headers: UA, signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.cards?.length ? j.cards : null;
}

let hit = 0, miss = 0, rated = 0; const bad = []; const t0 = Date.now();
for (let i = 0; i < 60; i++) {
  const n = names[i];
  const qs = [...new Set([n.zh, deco(n.zh), n.en, deco(n.en)].map((x) => (x || '').trim()).filter(Boolean))];
  let cards = null, used = '';
  for (const q of qs) { cards = await suggest(q); if (cards) { used = q; break; } await new Promise((s) => setTimeout(s, 180)); }
  if (cards) { hit++; if (/[\d.]+分/.test(cards[0].card_subtitle || '')) rated++; }
  else { miss++; bad.push(n.zh.slice(0, 30)); }
  await new Promise((s) => setTimeout(s, 220));
}
console.log(`清洗后 60 部：命中 ${hit}（有分 ${rated}）| 未命中 ${miss} | 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('仍失败:', bad.slice(0, 14).join(' ; '));
