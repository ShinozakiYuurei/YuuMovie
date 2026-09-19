#!/usr/bin/env node
/**
 * 「重映回退必须有证据」的回归测试（两道闸门）
 *
 * 为什么要写死这批用例：这两条闸门是「新片挂上同名旧片分数」的唯一防线，
 * 全靠阈值（豆瓣年差 ≥5、IMDb 条目年与豆瓣年差 ≤1）。两类片子结构完全同形，
 * 只能靠阈值分开，所以正例负例都要钉死。
 *
 * 跑法：node scripts/test-reissue-gate.mjs
 */
import {
  isReissueEvidence,
  matchesDoubanYear,
  REISSUE_MIN_DOUBAN_GAP,
  REISSUE_YEAR_TOLERANCE,
} from '../scrapers/imdb.js';

/** 第一道闸门：[豆瓣年份, 港映年, 期望, 备注] */
const GATE1 = [
  // 真重映：豆瓣年份远早于港映 → 允许回退
  [1997, 2026, true, 'EVA 死与新生：1997 原版 2026 重映'],
  [1995, 2026, true, '情留半天（爱在黎明破晓前）'],
  [1990, 2026, true, '阿飛正傳'],
  [1993, 2025, true, '霸王別姬 4K 修復'],
  [1986, 2026, true, 'Queen Budapest'],
  [1985, 2026, true, '女郎漫遊仙境'],
  [2021, 2026, true, '差 5 年：刚好在阈值上'],
  [2020, 2026, true, '差 6 年'],
  // 同名新片：豆瓣年份与港映同年/接近 → 禁止回退（本次修的 bug）
  [2026, 2026, false, '生化危機 2026：新片与 2002 年版同名'],
  [2026, 2026, false, '狂野雄心 2026'],
  [2026, 2026, false, '魔法師的秘密王國 2026'],
  [2026, 2026, false, '挖掘者 2026'],
  [2026, 2026, false, '打劫銀行是咁的 2026'],
  [2027, 2027, false, '冰河世紀6 2027'],
  [2024, 2026, false, '差 2 年：续集/新作，不是重映'],
  [2023, 2026, false, '差 3 年'],
  [2022, 2026, false, '差 4 年：仍在阈值下'],
  // 数据缺失：一律不冒险
  [null, 2026, false, '没有豆瓣年份 → 宁可不显示分数'],
  [2026, null, false, '没有港映年'],
  [null, null, false, '两边都没有'],
  [undefined, 2026, false, 'undefined 豆瓣年'],
  [0, 2026, false, '0 视为缺失'],
  [2026, 0, false, '0 视为缺失（港映年）'],
  [2030, 2026, false, '豆瓣年晚于港映（异常数据）'],
];

/** 第二道闸门：[候选IMDb年, 豆瓣原作年, 期望, 备注] */
const GATE2 = [
  // 真重映：年份对得上（实测真匹配偏差恒为 0，留 1 年余量给影展/公映差）
  [1997, 1997, true, 'EVA 死與新生：完全一致'],
  [2004, 2004, true, '追擊8月15：完全一致'],
  [1995, 1995, true, '情留半天'],
  [1990, 1990, true, '阿飛正傳'],
  [1985, 1985, true, '女郎漫遊仙境'],
  [2001, 2001, true, '麥兜故事'],
  [1997, 1996, true, '差 1 年：刚好在容差上（影展年 vs 公映年）'],
  [null, 1997, true, '候选无年份 → 不否决（IMDb 有缺年份条目）'],
  [undefined, 1997, true, '候选年 undefined → 同上'],
  // 另一部同名老片：年份对不上 → 拒绝
  [2001, 2017, false, '恨世者：豆瓣 2017 却回退到 2001「The Misanthrope」'],
  [2024, 1998, false, '天鵝湖：豆瓣 1998 却回退到 2024「Swan Lake」'],
  [2005, 2026, false, '狂野雄心：豆瓣 2026 却回退到 2005'],
  [1993, 2026, false, '挖掘者：豆瓣 2026 却回退到 1993'],
  [1993, 2026, false, '魔法師的秘密王國：豆瓣 2026 却回退到 1993'],
  [2024, 2026, false, '打劫銀行：豆瓣 2026 却回退到 2024（差 2，超容差）'],
  [2002, 2026, false, '生化危機：豆瓣 2026 却回退到 2002'],
  [1997, 2026, false, '差 29 年'],
  [1998, 1993, false, '差 5 年：超出容差'],
  [2017, 2013, false, '逆權司機：豆瓣 2013「辩护人」vs 2017「A Taxi Driver」，实测最小误配差 4'],
  [2024, 2020, false, '差 4 年：超出容差'],
  // 豆瓣年缺失 → 不构成证据
  [null, null, false, '两边都缺'],
  [2000, null, false, '豆瓣年缺失'],
  [undefined, undefined, false, '豆瓣年 undefined'],
];

let bad = 0;

console.log(`=== 第一道闸门：是否构成「重映」证据（豆瓣年差 ≥ ${REISSUE_MIN_DOUBAN_GAP}）===`);
for (const [dbY, hkY, want, why] of GATE1) {
  const got = isReissueEvidence(dbY, hkY);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${String(got).padEnd(5)} 期望 ${String(want).padEnd(5)} db=${String(dbY ?? '-').padEnd(5)} hk=${String(hkY ?? '-').padEnd(5)} ${why}`);
}

console.log(`\n=== 第二道闸门：回退候选年份是否对得上豆瓣原作年（容差 ±${REISSUE_YEAR_TOLERANCE}）===`);
for (const [candY, dbY, want, why] of GATE2) {
  const got = matchesDoubanYear(candY, dbY);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${String(got).padEnd(5)} 期望 ${String(want).padEnd(5)} cand=${String(candY ?? '-').padEnd(5)} db=${String(dbY ?? '-').padEnd(5)} ${why}`);
}

console.log(bad ? `\n✖ ${bad} 个用例不符` : `\n✅ 全部通过（${GATE1.length + GATE2.length} 例）`);
process.exit(bad ? 1 : 0);
