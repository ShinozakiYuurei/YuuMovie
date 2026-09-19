import { imdbSuggest } from '../scrapers/imdb.js';
for (const q of ['The End of Evangelion', 'Evangelion: 1.11 You Are (Not) Alone', '新世紀福音戰士劇場版：Air/真心為你', 'Evangelion 1.11']) {
  const c = await imdbSuggest(q);
  console.log(`\n[${q}] ${c.length} 个`);
  for (const x of c.slice(0, 8)) console.log('   ', x.id, x.qid.padEnd(7), String(x.year).padEnd(5), JSON.stringify(x.title));
  await new Promise((s) => setTimeout(s, 350));
}
