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
 * @param {string | null | undefined} name
 * @returns {string} 归一化后的键；空名返回 ''
 */
export function synopsisKey(name) {
  if (!name) return '';
  return enrichKey(String(name).replace(WRAPPERS, ' '));
}
