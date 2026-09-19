import { imdbSuggest, rankImdbCandidates } from '../scrapers/imdb.js';
const q = 'The End of Evangelion';
const cands = await imdbSuggest(q);
console.log('候选数', cands.length);
console.log('pass=false:', rankImdbCandidates(cands, q, 2026, { reissue: false }).map((x) => `${x.id}:${x.year}:s=${x.s}`));
console.log('pass=true :', rankImdbCandidates(cands, q, 2026, { reissue: true }).map((x) => `${x.id}:${x.year}:s=${x.s}`));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff ]/g, ' ').replace(/\s+/g, ' ').trim();
for (const c of cands) if (c.qid === 'movie') console.log('  norm:', JSON.stringify(norm(c.title)), '| tokens', norm(c.title).split(' ').length, '| q tokens', norm(q).split(' ').length);
