// Print cleanTitle / stripFormatBrands for the same cases the Go test uses.
import { cleanTitle, stripFormatBrands, bracketTitle } from '../scrapers/douban-suggest.js';

const titles = [
  'M (GFF)',
  '《這個殺手不太冷》(4K導演版)',
  '《空槍》T-Shirt特典場',
  '我阿爹想旅行 行得㗎啦見面場',
  '復仇者聯盟4：終局之戰 重映',
  'Some Film 2024-2025',
  'Some Film NT Live',
  'Some Film Royal Ballet',
  'Some Film -',
  '',
];
const out = { clean: {}, brands: {}, bracket: {} };
for (const t of titles) {
  out.clean[t] = cleanTitle(t);
  out.brands[t] = stripFormatBrands(t);
  out.bracket[t] = bracketTitle(t);
}

const brandCases = [
  'IMAX Avengers Endgame',
  'Avengers Endgame 4DX',
  'Infinity Pool',
  'Film Infinity Vision',
  'IMAX2D Film',
  'Film (IMAX)',
  'Film',
  '',
];
out.brandOnly = {};
for (const t of brandCases) out.brandOnly[t] = stripFormatBrands(t);

console.log(JSON.stringify(out, null, 1));