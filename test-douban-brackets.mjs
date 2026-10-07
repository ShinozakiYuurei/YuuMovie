import { resolveDouban } from './scrapers/douban-suggest.js';
const cases = [
  { zh: '《這個殺手不太冷》(4K導演版)', en: '', year: 2026 },
  { zh: '《空槍》T-Shirt特典場', en: '', year: 2026 },
  { zh: '《我阿爹想旅行》行得㗎啦見面場', en: '', year: 2026 },
  { zh: '《Look Back驀然回首》 電影分享會', en: '', year: 2026 },
  { zh: '胭脂扣 (4K修復版) - 導演映後分享場', en: '', year: 2026 },
  { zh: '《誤闖遺忘島》謝票場', en: '', year: 2026 },
  { zh: '《偵戰》', en: 'MASTERMIND', year: 2026 },
  { zh: '《怎麽可能我家的祖先是你家的鬼》', en: 'OH MY GHOST! OH MY GOD!', year: 2026 },
  { zh: '《森之廚房》 bc30 × 香港菜站 × 果邊', en: 'Little Forest (bc30 x Hong Kong Veggie Station x gwobean)', year: 2026 },
];
for (const c of cases) {
  const d = await resolveDouban(c);
  console.log(JSON.stringify(c.zh), '=>', d ? JSON.stringify({ via: d.queriedWith, title: d.card.title, year: d.card.year, id: d.card.id }) : 'NULL');
  await new Promise((r) => setTimeout(r, 500));
}
