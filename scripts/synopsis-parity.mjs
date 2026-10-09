// What the three index parsers produce from the real captured pages, and what the
// detail parsers produce from the real detail pages. This is the reference the Go
// port is compared against.
//
// Run after tmp/capture-synopsis.mjs and tmp/capture-synopsis-details.mjs.
import fs from 'node:fs';
import {
  parseWmoovIndex,
  parseWmoovNames,
  parseWmoovSynopsis,
  parseKinohkIndex,
  parseKinohkSynopsis,
  parseHkmovie6Index,
  parseHkmovie6Synopsis,
} from '../scrapers/synopsis.js';

const OUT = 'C:/Users/Yuurei/hkmovie-lab/tmp';
const read = (name) => {
  try {
    return fs.readFileSync(OUT + '/' + name, 'utf8');
  } catch {
    return '';
  }
};

const summary = {};

for (const [name, file, parse] of [
  ['wmoov', 'syn-wmoov-showing.html', parseWmoovIndex],
  ['wmoovUpcoming', 'syn-wmoov-upcoming.html', parseWmoovIndex],
  ['kinohk', 'syn-kinohk-now.html', parseKinohkIndex],
  ['kinohkComing', 'syn-kinohk-coming.html', parseKinohkIndex],
  ['hkmovie6', 'syn-hkmovie6-home.html', parseHkmovie6Index],
]) {
  const index = parse(read(file));
  const keys = [...index.keys()].sort();
  summary[name] = {
    keys: keys.length,
    entries: [...index.values()].reduce((n, list) => n + list.length, 0),
    sample: keys.slice(0, 6).map((k) => [k, index.get(k)]),
  };
}

const detail = {};
const wmoovDetail = read('syn-wmoov-detail.html');
if (wmoovDetail) {
  detail.wmoovNames = parseWmoovNames(wmoovDetail);
  detail.wmoovSynopsis = parseWmoovSynopsis(wmoovDetail).slice(0, 200);
}
const kinohkDetail = read('syn-kinohk-detail.html');
if (kinohkDetail) {
  detail.kinohkSynopsis = parseKinohkSynopsis(kinohkDetail).slice(0, 200);
}
const hkmovie6Detail = read('syn-hkmovie6-detail.html');
if (hkmovie6Detail) {
  detail.hkmovie6Synopsis = parseHkmovie6Synopsis(hkmovie6Detail).slice(0, 200);
}

console.log(JSON.stringify({ summary, detail }, null, 1));