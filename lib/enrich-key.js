/**
 * 补充数据（enrichment）的缓存键
 *
 * ★ 为什么单独一个文件、而且是 .js：
 *   抓取侧 scrapers/enrich.js（纯 Node ESM）与读取侧 lib/data.ts（Next 编译）
 *   必须算出**完全相同**的 key，否则豆瓣/IMDb 的缓存就查不到。
 *   tsconfig 已开 allowJs，所以 TS 侧可以直接 import 这个 JS 模块，
 *   不必把逻辑抄两份、也不必引入 tsx/ts-node。
 *
 * 与 lib/versions.ts 的 normalizeTitle 的区别：
 *   normalizeTitle 还要剥年份、做重音折叠，服务于「同一部电影在多家院线的
 *   条目合并」；这里只服务于「跨进程查找一个 JSON 的键」，
 *   所以刻意做得更保守 —— 稳定优先，宁可漏合不可错合。
 */

/** 放映格式标记：片名里出现这些词不代表另一部电影 */
const FORMAT_WORDS = [
  'imax',
  'imax3d',
  '4dx',
  'dbox',
  'mx4d',
  'dolby',
  'dolbyatmos',
  'atmos',
  '3d',
  '2d',
  '4k',
  '2k',
  'cinity',
  'screenx',
  'dubox',
  '激光',
  '巨幕',
  '全景声',
  '杜比',
  '三维',
  '立体',
  '优先场',
  '特别场',
  '午夜场',
  '完整版',
  '加长版',
  '重映',
  '粤语',
  '国语',
  '原声',
  '字幕',
];

/**
 * 生成 enrichment key
 *
 * 步骤都是「去噪」，不做繁简转换、不做翻译 ——
 * 因为两侧输入都来自同一份 data/movies.json 的字符串，
 * 任何跨语言归一反而会引入误合。
 *
 * @param {string | null | undefined} name
 * @returns {string} 归一化后的键；空名返回 ''
 */
export function enrichKey(name) {
  if (!name) return '';
  let s = String(name);

  // 去掉括号及其内容：「阿凡达：火與燼 (IMAX 3D)」→「阿凡达：火與燼」
  s = s.replace(/[（(〔[【{「『＜<][^（()）)〕\][\]}」』＞>]*[）)〕\]】}」』＞>]/g, ' ');
  // 竖线/破折号后的营销尾巴：「XX｜優先場」
  s = s.split(/[|｜]/)[0];

  // 去格式词（带边界，避免误删正片名里的 3D 之类）
  for (const w of FORMAT_WORDS) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ascii = /^[\x00-\x7F]+$/.test(w);
    s = ascii
      ? s.replace(new RegExp(`(^|[^a-z0-9])${esc}(?![a-z0-9])`, 'gi'), '$1 ')
      : s.replace(new RegExp(esc, 'gi'), ' ');
  }

  // 统一标点 + 压缩空白 + 小写
  s = s
    .replace(/[：:·・・—–\-_,，。、!！?？'"“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return s;
}
