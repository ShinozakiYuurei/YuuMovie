import {imdbSuggest,pickImdbId} from '../scrapers/imdb.js';
import {enrichKey} from '../lib/enrich-key.js';
const cases=[
 ['IMAX Avengers: Endgame Encore',2019],
 ['Avengers: Endgame Encore',null],
 ['SWAN LAKE (The Royal Ballet 2026 – 2027)',2026],
 ['The Family Approach (GFF) ',2026],
 ['Hidden Heroes (bc30 x APAAA)',2026],
 ['SAKAMOTO DAYS',2026],
];
const clean=s=>s.replace(/[（(〔[【{「『][^）)〕\]】}」』]*[）)〕\]】}」』]/g,' ').replace(/\s+/g,' ').trim();
for(const [n,y] of cases){
  const variants=[...new Set([n,clean(n),enrichKey(n)])];
  let best=null;
  for(const v of variants){
    const c=await imdbSuggest(v);
    const p=pickImdbId(c,v,y);
    if(p){best={v,id:p.id,t:p.title,y:p.year};break}
    if(!best)best={v,id:'-',n:c.length};
  }
  console.log(JSON.stringify(n).padEnd(46),'→',JSON.stringify(best));
  await new Promise(s=>setTimeout(s,300));
}
