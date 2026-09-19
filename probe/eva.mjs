import { enrichKey } from '../lib/enrich-key.js';
import { imdbSuggest, pickImdbId } from '../scrapers/imdb.js';
import fs from 'node:fs';
const movies = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const j = JSON.parse(fs.readFileSync('data/enrich.json', 'utf8'));
const eva = movies.filter((m) => /福音|Evangelion/i.test((m.nameZh || '') + (m.nameEn || '')));
for (const m of eva) console.log('条目:', m.id, '|', m.nameZh, '|', m.nameEn, '|', m.openingDate, '| key=', enrichKey(m.nameZh || m.nameEn));
console.log('\n--- enrich 记录 ---');
for (const m of eva) {
  const k = enrichKey(m.nameZh || m.nameEn);
  const e = j.entries[k];
  if (e) console.log(k, '→', JSON.stringify(e.imdb));
}
console.log('\n--- IMDb 候选（逐个查询词）---');
for (const q of ['新世紀福音戰士劇場版:死與新生', 'Evangelion: Death (True)² & Rebirth', 'Evangelion: Death & Rebirth', 'Evangelion: Death (True)', '新世纪福音战士剧场版 死与新生']) {
  const c = await imdbSuggest(q);
  console.log(`\n[${q}] ${c.length} 个候选`);
  for (const x of c.slice(0, 6)) console.log('   ', x.id, x.qid, x.yr, JSON.stringify(x.lx), (x.s || []).slice(0, 2).join(' '));
  console.log('    pickImdbId(2026) →', JSON.stringify(pickImdbId(c, q, 2026)), ' pickImdbId(reissue) →', JSON.stringify(pickImdbId(c, q, 2026, { reissue: true })));
  await new Promise((s) => setTimeout(s, 400));
}
