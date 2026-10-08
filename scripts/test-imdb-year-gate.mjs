#!/usr/bin/env node
/**
 * IMDb 年份闸门单测
 *
 * 这道闸门是 2026-10-09 全站审计的产物：豆瓣侧有年份闸门，IMDb 侧没有，
 * 于是「标题子串够像 + 年份差很远」的条目被直接当成正主挂上去。
 *
 * 用例分四类，每类都有实测依据：
 *   1. 正解必须放行 —— 改紧了会把对的改错
 *   2. 实测错配必须否决 —— 这道闸门存在的理由
 *   3. 剧场录制 —— IMDb 记录制年、豆瓣记原作年，天然差十年以上
 *   4. 缺数据必须放行 —— 没有第二轴时不该凭空否决
 *
 * 跑法：node scripts/test-imdb-year-gate.mjs
 */
import { imdbYearGateOk, IMDB_DOUBAN_YEAR_MAX_GAP } from '../scrapers/imdb.js';
import { crossYearOk } from '../scrapers/douban-suggest.js';

const ok = (imdbYear, doubanYear, title, hasRating = true, opt) =>
  imdbYearGateOk(imdbYear, doubanYear, hasRating, title, opt);
// 剧院/舞团放映：院线名带这些标记，且候选年应贴着港映年
const venue = (hkYear) => ({ venueName: 'NT Live', hkYear });

let bad = 0;
const check = (label, got, want) => {
  const pass = got === want;
  if (!pass) bad++;
  console.log('  ' + (pass ? 'OK  ' : 'FAIL') + ' ' + label);
};

console.log('闸门上限 = ' + IMDB_DOUBAN_YEAR_MAX_GAP + ' 年（剧院录制另行放宽）');

console.log('--- 1. 必须放行：实测正解 ---');
check('同年 街霸 2026', ok(2026, 2026, 'Street Fighter'), true);
check('重映原版 追擊8月15 2004/2004', ok(2004, 2004, 'Hidden Heroes'), true);
check('差2年 Look Back 2026/2024', ok(2026, 2024, 'Look Back'), true);
check('差1年 海灣 2026/2027', ok(2026, 2027, 'Haiwaan'), true);
check('差3年 边界内', ok(2026, 2023, 'Some Film'), true);
check('重映 EVA 1997/1997', ok(1997, 1997, 'Neon Genesis Evangelion'), true);

console.log('--- 2. 必须否决：2026-10-09 实测错配 ---');
check('跟蹤 Following2024/豆瓣2007', ok(2024, 2007, 'Following'), false);
check('玩謝麥高維治 2025/1999', ok(2025, 1999, 'Being Related to John Malkovich'), false);
check('危險人物 2024/1999', ok(2024, 1999, 'Stealing Pulp Fiction'), false);
check('街霸 1994动画/豆瓣2026', ok(1994, 2026, 'Street Fighter'), false);
check('凶榜 The Imp 1996/豆瓣1981', ok(1996, 1981, 'The Imp'), false);
check('小鞋子 2026重映条目/豆瓣1997', ok(2026, 1997, 'Children of Heaven'), false);
check('胡桃夾子 1991/豆瓣2018', ok(1991, 2018, 'The Nutcracker'), false);
check('十個拆彈的少年 2024/豆瓣2015', ok(2024, 2015, 'This Land of Mine'), false);
check('逆權司機 2017/豆瓣2013', ok(2017, 2013, 'A Taxi Driver'), false);
check('羅沙尋媽路漫漫 2013/豆瓣2007', ok(2013, 2007, 'Two Mothers'), false);

console.log('--- 3. 剧院录制：IMDb 记录制年，豆瓣记原作年 ---');
check('恨世者 标题带 NT 标记 2026/2017（差9）', ok(2026, 2017, 'National Theatre Live: The Misanthrope'), true);
check('不可兒戲 2025/2015（差10）', ok(2025, 2015, 'National Theatre Live: The Importance of Being Earnest'), true);
check('孽戀焚情 2026/1988（差38）', ok(2026, 1988, 'National Theatre Live: Les Liaisons Dangereuses'), true);
check('吾子吾弟 标题无标记，但年=港映年 2026', ok(2026, 2019, 'All My Sons', true, venue(2026)), true);
check('覲見英女皇 同上形态但年=2020 离港映6年', ok(2020, 2013, 'The Audience', true, venue(2026)), false);
check('同形态但非剧院名（无放宽依据）', ok(2026, 2019, 'All My Sons'), false);

console.log('--- 4. 缺数据时放行 ---');
check('豆瓣没匹到（无 doubanYear）', ok(2024, null, 'Following'), true);
check('IMDb 条目无年份', ok(null, 2007, 'Children of Heaven'), true);
check('首选无分（重映新条目，交给回退逻辑）', ok(2026, 1997, 'Children of Heaven', false), true);

console.log('--- 5. 豆瓣同源名年份闸门（crossYearOk）---');
// ★ 两个调用点传进来的形状不同，只认一个会让闸门静默失效。
//   搜索路径传原始 card（字段 year），enrich 判缓存过期传 enrich 行
//   （字段 doubanYear）。2026-10-09 实测踩过：只认 year 时
//   queen budapest 的缓存行永远判不出脏，错分一直挂着。
check('搜索卡片形状 {year}', crossYearOk({ year: 1986 }, 2026), false);
check('enrich 行形状 {doubanYear}', crossYearOk({ doubanYear: 1986 }, 2026), false);
check('enrich 行在容差内', crossYearOk({ doubanYear: 2026 }, 2026), true);
check('enrich 行差 3 年（边界内）', crossYearOk({ doubanYear: 2023 }, 2026), true);
check('两边都缺年份时放行', crossYearOk({}, 2026), true);

const tail = bad ? bad + " 个用例不符" : "全部通过";
console.log(tail);
process.exit(bad ? 1 : 0);
