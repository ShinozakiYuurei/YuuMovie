import { imdbSuggest, pickImdbId, resolveImdbIds, rankImdbCandidates } from '../scrapers/imdb.js';
const q = 'IMAX Avengers: Endgame Encore';
const cands = await imdbSuggest(q);
console.log('原始候选', cands.length);
for (const c of cands.slice(0, 6)) console.log('   ', JSON.stringify(c));
console.log('rank(pass=false)', rankImdbCandidates(cands, q, 2026, { reissue: false }).map(x => x.id + ':' + x.s));
console.log('rank(pass=true )', rankImdbCandidates(cands, q, 2026, { reissue: true }).map(x => x.id + ':' + x.s));
console.log('resolveImdbIds', await resolveImdbIds([q, 'Avengers: Endgame Encore'], 2026).then(l => l.map(x => x.id + ':' + x.s + ':relaxed=' + x.relaxedYear)));
