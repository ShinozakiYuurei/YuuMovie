/**
 * 第三方简介（data/synopsis.json）的缓存键
 *
 * ★ 为什么不直接用 enrichKey：
 *   enrichKey 是 data/enrich.json（IMDb / 豆瓣评分）的键，两侧必须逐字一致。
 *   简介匹配还得多剥一层**书名号**（院线片名常写成《社交清算》，资料站只写
 *   社交清算），而改 enrichKey 会让已有评分缓存全部失配、要等下一轮重抓。
 *   简介是新增缓存，自己一层最安全 —— 同样是 .js，抓取侧与 lib/data.ts 共用。
 */
import { enrichKey } from './enrich-key.js';

const WRAPPERS = /[《》〈〉「」『』【】〔〕［］\[\]]/g;

/**
 * 异体字折叠：港台两种写法混用，同一部片会算成两个键。
 *
 * 实测（2026-10-04）：院线写《怎麽可能我家的祖先是你家的鬼》，wmoov 写
 * 「怎麼可能…」，只差 麽/麼 一个字就匹配不上。折叠只可能**合并**键、不会拆开，
 * 且英文片名还要过一道 titleAgrees，所以放大一点点是安全的。
 */
const VARIANTS = [
  [/麽/g, '麼'],
  [/裡/g, '裏'],
  [/．/g, '·'], // 全角间隔号：hkmovie6 写 尤金．奧涅金、MCL 写 尤金·奧涅金
];

/**
 * @param {string | null | undefined} name
 * @returns {string} 归一化后的键；空名返回 ''
 */
export function synopsisKey(name) {
  if (!name) return '';
  let text = String(name).replace(WRAPPERS, ' ');
  for (const [from, to] of VARIANTS) text = text.replace(from, to);
  return enrichKey(text);
}
