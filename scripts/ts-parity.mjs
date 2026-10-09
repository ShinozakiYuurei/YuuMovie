// Print titleScore for the same pairs the Go test uses, so the two can be
// compared value by value rather than only pass/fail.
import { titleScore, normTitle } from '../scrapers/imdb.js';

const s = (query, cand) => titleScore(normTitle(cand), normTitle(query));

const cases = [
  ['Sakamoto Days', 'Sakamoto Days'],
  ['IMAX Avengers Endgame Encore', 'IMAX Avengers Endgame Encore'],
  ['The End of Evangelion', 'Neon Genesis Evangelion The End of Evangelion'],
  ['Avengers Endgame', 'Avengers Endgame Encore'],
  ['Look Back', 'Look Back 駁死回歸'],
  ['Avengers Endgame', 'IMAX Avengers Endgame'],
  ['IMAX Avengers Endgame', 'Avengers Endgame'],
  ['Evangelion Death True Rebirth', 'Neon Genesis Evangelion Death Rebirth'],
  ['Taxi', 'Taxi'],
  ['Hope', 'Hope'],
  ['The End of Evangelion', 'The End of Oak Street'],
  ['Evangelion 1.11 You Are Not Alone', 'You Are Not Alone'],
  ['Rocky 3', 'Rocky 4'],
  ['Rocky 3', 'Rocky 5'],
  ['Evangelion 1.0 You Are Not Alone', 'Evangelion 3.0 1.0 Thrice Upon a Time'],
  ['M', 'M the Movie of the Century'],
  ['Fall', 'Fall 2 Deadpoint'],
  ['Fall', 'Fall Guys The Ultimate Showdown'],
  ['Hope', 'Hopeless'],
  ['You Are Not Alone', 'Evangelion 1.11 You Are Not Alone'],
];

const out = {};
for (const [q, c] of cases) out[q + ' | ' + c] = s(q, c);
console.log(JSON.stringify(out, null, 1));