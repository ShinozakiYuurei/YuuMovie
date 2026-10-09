// Print the Douban query list for a set of tricky titles, so the Go port can be
// compared value for value rather than only pass/fail.
//
// The expansion is what decides whether Douban is asked at all, and a dropped or
// reordered query silently changes which entry comes back.
import { resolveDouban } from '../scrapers/douban-suggest.js';

// doubanSuggest calls the global fetch, so the recording has to replace that.
const seen = [];
globalThis.fetch = async (url) => {
  seen.push(url);
  return { ok: true, json: async () => ({ cards: [] }) };
};

const titles = [
  ['M (GFF)', ''],
  ['《這個殺手不太冷》(4K導演版)', ''],
  ['《空槍》T-Shirt特典場', ''],
  ['我阿爹想旅行 行得㗎啦見面場', ''],
  ['復仇者聯盟4：終局之戰 加碼', 'Avengers Endgame'],
  ['復仇者聯盟4：終局之戰 重映', 'Avengers Endgame'],
  ['末日降臨開畫日特典首場', ''],
  ['重映開畫日特典首場', ''],
  ['天鵝湖 (The', ''],
  ['GIANT – The Play', ''],
  ['Fallen Angels by Noel Coward', ''],
  ['日麗', ''],
  ['日語版', ''],
  ['開畫日特典首場', ''],
  ['Queen Budapest', 'Queen Budapest'],
  ['超風', 'Super Typhoon'],
  ['愛', ''],
  ['2D 龍珠', ''],
];

const out = {};
for (const [zh, en] of titles) {
  seen.length = 0;
  try {
    await resolveDouban({ zh, en, year: null }, { delayMs: 0 });
  } catch (e) {
    out[zh + ' | ' + en] = 'ERR ' + e.message;
    continue;
  }
  out[zh + ' | ' + en] = seen.map((u) => decodeURIComponent(u.split('q=')[1].split('&')[0]));
}
console.log(JSON.stringify(out, null, 1));