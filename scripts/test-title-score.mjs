#!/usr/bin/env node
/**
 * 标题匹配打分单测
 *
 * 为什么要写死这批用例：这段逻辑是「页面上挂错评分」的唯一防线，
 * 而它全靠边界取舍（差几个词、丢的是停用词还是专名）。
 * 之前三轮都靠线上跑一遍再人眼看，既慢又漏 —— 尤其**误配比漏配更严重**，
 * 漏了只是不显示分数，误了就是把 8.4 挂到别的片上。所以负例是重点。
 *
 * 跑法：node scripts/test-title-score.mjs
 *
 * ★ 用例里存的是**归一后**的形态（norm 会把标点转空格），
 *   所以写 “Fall 2 Deadpoint” 而不是 “Fall 2: Deadpoint”。
 */
import { titleScore, normTitle } from '../scrapers/imdb.js';

// ★ 参数方向：titleScore(n, q) 的 n = 候选（IMDb 标题），q = 查询（院线标题）。
//   这里按人的习惯写 (查询, 候选)，转一下再调。
const s = (query, cand) => titleScore(normTitle(cand), normTitle(query));

/**
 * [查询词, 候选标题, 期望是否达标(≥76), 备注]
 *
 * 达标线取 76：62 那档（子串包含）只用于院线标题被 IMDb 标题完整包住的场景，
 * 风险高，这里统一按「能不能算同一部」判。
 */
const PASS = [
  // 完全一致 / 标点差异
  ['SAKAMOTO DAYS', 'Sakamoto Days', '大小写'],
  ['IMAX Avengers: Endgame Encore', 'IMAX Avengers Endgame Encore', '标点'],
  // 候选包含查询（IMDb 常带系列前缀 / 续集后缀）
  ['The End of Evangelion', 'Neon Genesis Evangelion The End of Evangelion', '后缀：EoE 真名带系列前缀'],
  ['Avengers Endgame', 'Avengers Endgame Encore', '候选多 encore'],
  ['Look Back', 'Look Back 驀然回首', '候选多中文副名'],
  // 格式标记可丢（两个方向）
  ['Avengers Endgame', 'IMAX Avengers Endgame', '候选多 imax'],
  ['IMAX Avengers Endgame', 'Avengers Endgame', '查询多 imax（重映场景）'],
  // token 子集：只丢停用词/格式词
  ['Evangelion Death True Rebirth', 'Neon Genesis Evangelion Death Rebirth', '丢 true，长串多 neon/genesis'],
  // 单词标题只允许全等
  ['TAXI', 'Taxi', '单词全等'],
  ['Hope', 'Hope', '单词全等'],
];

const FAIL = [
  // 核心专名丢失 —— 这类最危险，历史上真误配过
  ['The End of Evangelion', 'The End of Oak Street', 'evangelion 丢失，只靠 the/end/of 相同'],
  ['Evangelion 1.11 You Are Not Alone', 'You Are Not Alone', 'evangelion 与版本号丢失（曾得 94 分）'],
  // 续集序号不能吞
  ['Rocky 3', 'Rocky 4', '只差一个数字但那是区分位'],
  ['Rocky 3', 'Rocky 5', '同上'],
  ['Evangelion 1.0 You Are Not Alone', 'Evangelion 3.0 1.0 Thrice Upon a Time', '版本号+副标题都不同'],
  // 单词标题不得做包含
  ['M', 'M the Movie of the Century', '单词查询不该乱配'],
  ['Fall', 'Fall 2 Deadpoint', 'Fall 与 Fall 2 是两部片'],
  ['Fall', 'Fall Guys The Ultimate Showdown', '同上'],
  ['Hope', 'Hopeless', '单词不得当子串前缀'],
];

/**
 * [已知取舍] 结构上无法与“IMDb 带系列前缀”区分的情况
 *
 * 查询 “You Are Not Alone” 会被候选 “Evangelion: 1.11 You Are (Not) Alone” 完全包含。
 * 但 “The End of Evangelion” 同样被 “Neon Genesis Evangelion: The End of Evangelion”
 * 包含，而后者是**我们数据里真实存在**的片子（EVA 复修系列）。
 * 两者结构完全同形（都是“系列前缀 + 本查询”），没有不改坏后者的规则能挡住前者。
 * 取“能正确显示 EoE”这一边；风险面很窄：需要院线把片名登成恰好是某部大片名的子串。
 */
const KNOWN = [
  ['You Are Not Alone', 'Evangelion 1.11 You Are Not Alone', '与 EoE 同形，只能二选一'],
];

let bad = 0;
console.log('=== 应达标（≥76）===');
for (const [q, c, why] of PASS) {
  const v = s(q, c);
  const ok = v >= 76;
  if (!ok) bad++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${String(v).padStart(3)}  ${q.slice(0, 34).padEnd(36)} vs ${c.slice(0, 40).padEnd(42)} ${why}`);
}
console.log('\n=== 应拒绝（<76）===');
for (const [q, c, why] of FAIL) {
  const v = s(q, c);
  const ok = v < 76;
  if (!ok) bad++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${String(v).padStart(3)}  ${q.slice(0, 34).padEnd(36)} vs ${c.slice(0, 40).padEnd(42)} ${why}`);
}
console.log('\n=== 已知取舍（不计失败）===');
for (const [q, c, why] of KNOWN) {
  console.log(`  ~ ${String(s(q, c)).padStart(3)}  ${q.slice(0, 34).padEnd(36)} vs ${c.slice(0, 40).padEnd(42)} ${why}`);
}
console.log(bad ? `\n✖ ${bad} 个用例不符` : '\n✅ 全部通过');
process.exit(bad ? 1 : 0);
