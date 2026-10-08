#!/usr/bin/env node
/**
 * 豆瓣匹配守卫（部署自检会跑）
 *
 * ★ 为什么这道闸门必须存在
 *   豆瓣评分错了**不报错**：页面照样 200，只是挂着一个看起来很正常的分数。
 *   2026-10-09 全站审计查出 214 条里 40 条「豆瓣标题与中文片名毫无共同汉字」，
 *   交叉核对英文名后确认一批是彻底错配——月黑高飛挂《肖申克的救赎》是对的
 *   （港译名），但 queen budapest 挂《匈牙利狂想曲》(1986) 9.3 分是错的。
 *   根因：search_suggest 查不到真主时会拿相关性排序凑数，旧代码直接取首位。
 *
 * 两道可机械判定的闸门：
 *   1) **非电影条目不得出分**：tag=movie 并不保证返回电影，
 *      「次第花開」照样返回 book.douban.com 的同名书籍（实测 8.3 分）。
 *      书籍/音乐/剧集条目一旦显示，用户点进去看到的是一本书。
 *   2) **同源名必须过年份闸门**：中英双列写同一个词的条目没有交叉轴
 *      （自己对自己必然一致），只能靠年份兜底。
 *
 * 另有 informational 统计：低相似度条目数。这类里大部分是正确港译名，
 * 不能当失败条件，但要让部署者看见数量异动。
 *
 * 跑法：node_modules/.bin/tsx probe/check-douban-match.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isMovieSubjectUrl, pickDoubanCard } from '../scrapers/douban-suggest.js';
import type { EnrichEntry } from '../lib/types.ts';

// ---------- 1. 纯函数单元例：域名闸门 ----------
const MOVIE_CARD = {
  title: '测试影片',
  year: '2026',
  sub: '7.5分 / 2026 / 中国大陆 / 剧情',
  id: '123',
  url: 'https://movie.douban.com/subject/123/',
};
const BOOK_CARD = {
  title: '测试书名',
  year: '2017',
  sub: '8.3分 / 某作者 / 2017 / 某出版社',
  id: '456',
  url: 'https://book.douban.com/subject/456/',
};
assert.equal(isMovieSubjectUrl(MOVIE_CARD.url), true, 'movie.douban.com 应判为电影条目');
assert.equal(isMovieSubjectUrl(BOOK_CARD.url), false, 'book.douban.com 不得判为电影条目');
assert.equal(isMovieSubjectUrl('https://music.douban.com/subject/789/'), false);
assert.equal(isMovieSubjectUrl(null), false);
assert.equal(isMovieSubjectUrl(undefined), false);

// 域过滤在 doubanSuggest 那一层做（上游 2026-10-08 落的），
// pickDoubanCard 只管年份闸门 —— 这里按同样口径喂已过滤的卡片，
// 免得本测试与上游的分层假设各说各话。
assert.equal(pickDoubanCard([MOVIE_CARD], 2026)?.id, '123');
assert.equal(pickDoubanCard([], 2026), null);
assert.equal(pickDoubanCard([], 2026), null);
console.log('✓ 豆瓣域名闸门单元例通过');

// ---------- 2. 真数据扫描 ----------
const dataBase = process.env.DATA_DIR || 'data';
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
const enrich = readJson<Record<string, EnrichEntry>>(`${dataBase}/enrich.json`, {});
// enrich.json 顶层是 {version, updatedAt, entries, counts}，条目在 entries 下。
// 读错层级会扫到 0 条然后「通过」——比不跑更糟，所以显式取并断言非空。
const pool = (enrich as unknown as { entries?: Record<string, EnrichEntry> }).entries ?? enrich;
const entryList = Object.entries(pool);
if (!entryList.length) {
  console.error(`✗ ${dataBase}/enrich.json 里一条记录都没有 —— 守卫会假通过，拒绝放行`);
  process.exit(1);
}

const MOJI = (s: string | null | undefined) =>
  new Set((s || '').match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []);
/** 中文片名与豆瓣标题的共同汉字占比（只作统计，不作判据） */
function hanOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const B = MOJI(b);
  if (!B.size) return 1;
  const A = MOJI(a);
  let inter = 0;
  for (const c of B) if (A.has(c)) inter++;
  return inter / B.size;
}

let checked = 0;
let wrongDomain = 0;
let lowSim = 0;
const bad: string[] = [];

for (const [key, e] of entryList) {
  const d = e?.douban;
  if (!d || d.notFound) continue;
  checked++;

  if (d.rating != null && d.ratingState !== 'unreleased' && !isMovieSubjectUrl(d.doubanUrl)) {
    wrongDomain++;
    bad.push(
      `✗ ${key}：${d.rating} 分挂在非电影条目 ${d.doubanUrl}（${d.doubanTitle}）`,
    );
    continue;
  }
  // 有英文名 + 中英文名同源 → 交叉轴失效，年份是唯一兜底
  if (d.rating != null && d.doubanYear && e.year) {
    const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]/g, '');
    const sameSource = norm(e.nameEn) === norm(e.nameZh) && !!e.nameEn;
    if (sameSource && Math.abs(d.doubanYear - e.year) > 10) {
      wrongDomain++;
      bad.push(
        `✗ ${key}：同名条目年份不符（港映 ${e.year} vs 豆瓣 ${d.doubanYear}）` +
          `却挂了 ${d.rating} 分《${d.doubanTitle}》`,
      );
      continue;
    }
  }
  if (hanOverlap(e.nameZh, d.doubanTitle) < 0.34) lowSim++;
}

for (const b of bad) console.log(`  ${b}`);
console.log(
  `豆瓣匹配：检查 ${checked} 条带条目的记录 ｜ 域名/年份闸门违规 ${wrongDomain} ｜ ` +
    `标题低相似 ${lowSim}（多为正确港译名，仅供观察）`,
);
if (wrongDomain) {
  console.error('✗ 豆瓣匹配存在可机械判定的错配，拒绝放行');
  process.exit(1);
}
console.log('✓ 无「非电影条目出分」与「同名年份不符出分」');
