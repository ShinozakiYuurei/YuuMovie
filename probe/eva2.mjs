import { resolveImdbIds } from '../scrapers/imdb.js';
import { imdbRatings } from '../scrapers/imdb.js';
const cases = [
  [['Evangelion: Death (True)² & Rebirth', '新世紀福音戰士劇場版：死與新生'], 2026],
  [['Evangelion: 1.11 You Are (Not) Alone', '新世紀福音戰士新劇場版：序'], 2026],
  [['IMAX Avengers: Endgame Encore', '復仇者聯盟4：終局之戰'], 2026],
  [['The End of Evangelion', '新世紀福音戰士劇場版：Air/真心為你'], 2026],
];
for (const [qs, y] of cases) {
  const cands = await resolveImdbIds(qs, y);
  console.log('\n【' + qs[0] + '】候选 ' + cands.length);
  for (const c of cands) {
    const r = await imdbRatings(c.id);
    console.log('   ', c.id, 's=' + c.s, String(c.year).padEnd(6), JSON.stringify(c.title).padEnd(46), '→', r ? r.rating + ' (' + r.votes + ')' : 'null');
    await new Promise((s) => setTimeout(s, 350));
  }
}
