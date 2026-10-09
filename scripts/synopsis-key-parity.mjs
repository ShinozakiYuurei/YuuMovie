// Print the synopsis key for a set of titles, so the Go port can be compared value
// for value. The key is the cache key for a synopsis and the join key across
// venues, so a change here would orphan the cache and re-attach synopses.
import { synopsisKey } from '../lib/synopsis-key.js';

const names = [
  '《社交清算》',
  '社交清算',
  '《空槍》',
  '空槍',
  '空槍2',
  '劇場版《魔法少女小圓》',
  '魔法少女小圓',
  '超風_金剛',
  '超風·金剛',
  'IMAX 生化危機',
  'Avengers Endgame',
  'Some Film (2026)',
  '',
];
const out = {};
for (const n of names) out[n] = synopsisKey(n);
console.log(JSON.stringify(out, null, 1));