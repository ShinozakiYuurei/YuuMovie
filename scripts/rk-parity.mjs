// Print rankImdbCandidates for the ordering case, so the Go expectation matches.
import { rankImdbCandidates } from '../scrapers/imdb.js';

const cands = [
  { id: 'tt-b', title: 'Some Film', year: 2025, qid: 'movie' },
  { id: 'tt-a', title: 'Some Film', year: 1997, qid: 'movie' },
];
console.log('strict  ' + JSON.stringify(rankImdbCandidates(cands, 'Some Film', 2026)));
console.log('reissue ' + JSON.stringify(rankImdbCandidates(cands, 'Some Film', 2026, { reissue: true })));
console.log('1931    ' + JSON.stringify(rankImdbCandidates([{ id: 'tt-m', title: 'M', year: 1931, qid: 'movie' }], 'M', 2026, { reissue: true })));
console.log('sf94    ' + JSON.stringify(rankImdbCandidates([{ id: 'tt-sf', title: 'Street Fighter', year: 1994, qid: 'movie' }], 'Street Fighter', 2026, { reissue: true })));
console.log('name    ' + JSON.stringify(rankImdbCandidates([{ id: 'nm1', title: 'Some Person', year: 2026, qid: 'name' }], 'Some Person Here', 2026)));