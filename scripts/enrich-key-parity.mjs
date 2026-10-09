// Print the enrichment key for a set of titles, so the Go port can be compared
// value for value. The key is the cache key for a film's scores, so a change in
// it would orphan every cached row.
import { enrichKey } from '../lib/enrich-key.js';

const names = [
  'IMAX 生化危機',
  'IMAX Resident Evil',
  'M (GFF)',
  '《空槍》',
  'DORAEMON | 哆啦A夢',
  '超風',
  '龍珠 4K',
  '死侍2 杜比視界',
  'Some Film (2026)',
  '',
];
const out = {};
for (const n of names) out[n] = enrichKey(n);
console.log(JSON.stringify(out, null, 1));