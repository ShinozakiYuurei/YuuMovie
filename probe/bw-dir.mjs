import { BASE, extractRsc } from '../scrapers/broadway.js';
const h = await fetch(BASE + '/hk/movie/1270', { headers: { 'user-agent': 'Mozilla/5.0' } }).then((r) => r.text());
const rsc = extractRsc(h);
for (const k of ['director_lang', '"director"', 'cast_lang', '"cast"', '"actor']) {
  let i = rsc.indexOf(k), n = 0;
  while (i >= 0 && n < 2) {
    console.log('[' + k + ']', JSON.stringify(rsc.slice(i - 40, i + 240)));
    i = rsc.indexOf(k, i + 1); n++;
  }
  if (!n) console.log('[' + k + '] NOT FOUND');
}
