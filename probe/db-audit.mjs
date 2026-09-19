/**
 * 豆瓣匹配审计（纯本地）
 *
 * search_suggest 只给相关性排序，不给「匹得对不对」的依据；
 * 而豆瓣主标题是简体、本站是繁体，字符串也比对不了。
 * 所以把「本站片名 | 豆瓣片名 | 年 | 分 | 查询词」并列打出来人工核。
 * 重点看：年份差得远的、和豆瓣片名完全不像的。
 */
import fs from 'node:fs';
const base = process.argv[2] || '.';
const j = JSON.parse(fs.readFileSync(`${base}/data/enrich.json`, 'utf8')).entries;
const rows = Object.values(j).filter((v) => v.douban && !v.douban.notFound && v.douban.rating != null);
console.log(`有豆瓣分：${rows.length} 部\n`);
for (const v of rows)
  console.log(
    `${String(v.douban.rating).padEnd(4)} ${String(v.douban.doubanYear ?? '-').padEnd(5)} (港${v.year ?? '-'}) | ${v.nameZh}  ⟶  ${v.douban.doubanTitle}`
  );
const pend = Object.values(j).filter((v) => v.douban && !v.douban.notFound && v.douban.rating == null);
console.log(`\n匹到但暂无分/未上映：${pend.length} 部`);
const miss = Object.values(j).filter((v) => !v.douban || v.douban.notFound);
console.log(`未命中：${miss.length} 部`);
