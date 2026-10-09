// Write each index's key list, sorted, so the Go port can be compared key by key
// rather than by count.
//
// A count assertion would hide which key differs, and the interesting difference
// here was one key too many.
import fs from 'node:fs';
import { parseWmoovIndex, parseKinohkIndex, parseHkmovie6Index } from '../scrapers/synopsis.js';

const TMP = 'C:/Users/Yuurei/hkmovie-lab/tmp';
const OUT = 'C:/Users/Yuurei/hkmovie-lab/goscraper/testdata';

const read = (name) => fs.readFileSync(TMP + '/' + name, 'utf8');

const targets = [
  ['syn-wmoov-showing.html', 'syn-wmoov-keys.json', parseWmoovIndex],
  ['syn-wmoov-upcoming.html', null, parseWmoovIndex],
  ['syn-hkmovie6-home.html', 'syn-hkmovie6-keys.json', parseHkmovie6Index],
  ['syn-kinohk-coming.html', 'syn-kinohk-coming-keys.json', parseKinohkIndex],
  ['syn-kinohk-now.html', null, parseKinohkIndex],
];

for (const [fixture, outName, parse] of targets) {
  const keys = [...parse(read(fixture)).keys()].sort();
  console.log(fixture + ': ' + keys.length + ' keys');
  if (outName) {
    fs.writeFileSync(OUT + '/' + outName, JSON.stringify(keys, null, 1) + '\n');
    console.log('  wrote ' + outName);
  }
}