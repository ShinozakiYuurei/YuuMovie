// Write the Node plan as JSON so it can be diffed against the Go one.
import { enrichKey } from '../lib/enrich-key.js';
import fs from 'node:fs';

const movies = JSON.parse(fs.readFileSync('data/movies.json', 'utf8'));
const yearOf = (d) => {
  const m = /^(\d{4})/.exec(d || '');
  return m ? Number(m[1]) : null;
};

const plan = new Map();
for (const m of movies) {
  const nameZh = m.nameZh || '';
  const nameEn = m.nameEn || '';
  const key = enrichKey(nameZh || nameEn);
  if (!key) continue;
  const cur = plan.get(key);
  const year = yearOf(m.openingDate);
  if (!cur) {
    plan.set(key, {
      key,
      year,
      nameZh,
      nameEn,
      queries: [nameEn, nameZh].filter(Boolean),
      ids: [m.id],
    });
  } else {
    cur.ids.push(m.id);
    if (!cur.year && year) cur.year = year;
    if (!cur.nameZh && nameZh) cur.nameZh = nameZh;
    if (!cur.nameEn && nameEn) cur.nameEn = nameEn;
    for (const n of [nameEn, nameZh]) if (n && !cur.queries.includes(n)) cur.queries.push(n);
  }
}

const out = [...plan.values()].map((p) => ({ ...p, year: p.year || 0 }));
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
console.log('wrote ' + process.argv[2] + ' (' + out.length + ' items)');