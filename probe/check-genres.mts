#!/usr/bin/env node
/**
 * 类型标签的回归测试（部署自检会跑）
 *
 * 为什么要钉死：类型标签错了页面照样 200、照样好看，
 *   只是多出「驚悚 / 驚險(恐怖)片 / 恐怖片」这种一眼看去像重复的标签，
 *   或者半简半繁。2026-09-21 用户就是这么发现的。
 *
 * 三类问题各有来源：
 *   1. 简繁并存 —— 豆瓣 enrich 给的是**简体**（「科幻」「惊悚」），
 *      院线给的是繁体，合流后同一行出现两种字形。
 *   2. 同义不同写 —— emperor/cinemacity 的「驚悚」漏「片」字，
 *      与百老匯译出的「驚悚片」对不上；星達的「驚險(恐怖)片」括号里
 *      就是「恐怖」，与百老匯的「恐怖片」是同一件事。
 *   3. 父子并列 —— 百老匯给 Music →「音樂」，英皇给「演唱會」，
 *      两个院线各贡献一半，合并后「音樂 + 演唱會」并列。
 *
 * 只依赖仓库内代码，不读 data/、不联网，服务器上也能跑。
 *
 * 跑法：node_modules/.bin/tsx probe/check-genres.mts
 */
import { zhGenres, dropParents } from '../lib/genre-zh.ts';

type Case = { input: string[]; want: string[]; why: string };

const cases: Case[] = [
  // ---------- 豆瓣简体 ----------
  {
    input: ['科幻', '惊悚', '恐怖'],
    want: ['科幻片', '驚悚片', '恐怖片'],
    why: '豆瓣 enrich 的原始值就是简体（实测 生化危機），必须全部转繁并补「片」',
  },
  {
    input: ['剧情', '动作', '科幻', '奇幻', '冒险'],
    want: ['劇情片', '動作片', '科幻片', '奇幻片', '冒險片'],
    why: '復仇者聯盟4 的豆瓣类型',
  },
  {
    input: ['纪录片', '音乐', '传记'],
    want: ['紀錄片', '音樂', '傳記片'],
    why: 'Always Lalisa 的豆瓣类型（音乐不补「片」）',
  },
  // ---------- 院线英文 ----------
  {
    input: ['Horror', 'Action'],
    want: ['恐怖片', '動作片'],
    why: '百老匯只给英文（占 195/385 条）',
  },
  // ---------- 同义归并 ----------
  {
    input: ['驚悚'],
    want: ['驚悚片'],
    why: 'emperor/cinemacity 漏「片」字，要能与百老匯的 Thriller 对上',
  },
  {
    input: ['驚險(恐怖)片'],
    want: ['恐怖片'],
    why: '星達：括号里就是「恐怖」，与百老匯的 Horror 是同一件事',
  },
  {
    input: ['情感/喜劇片'],
    want: ['劇情片', '喜劇片'],
    why: '星達的「情感」是剧情向写法，不归并会与「劇情片」并列',
  },
  // ---------- 父子标签 ----------
  {
    input: ['音樂', '演唱會'],
    want: ['演唱會'],
    why: '有更具体的「演唱會」时去掉「音樂」（保留信息量大的那个）',
  },
  {
    input: ['歌劇', '音樂'],
    want: ['歌劇'],
    why: '同上，歌劇比音樂具体',
  },
  {
    input: ['音樂'],
    want: ['音樂'],
    why: '没有子类时保留「音樂」，不能误删',
  },
  {
    input: ['音樂/演唱會'],
    want: ['演唱會'],
    why: '同一院线内部就给父子并列（星達），也要去掉大类',
  },
  // ---------- 组合 ----------
  {
    input: ['動作/喜劇片'],
    want: ['動作片', '喜劇片'],
    why: '斜杠组合要拆开再各自归一',
  },
  {
    input: ['動畫/喜劇/冒險'],
    want: ['動畫片', '喜劇片', '冒險片'],
    why: '斜杠组合且无「片」后缀',
  },
];

let bad = 0;
for (const c of cases) {
  const got = zhGenres(c.input);
  if (JSON.stringify(got) !== JSON.stringify(c.want)) {
    console.log(`✗ ${JSON.stringify(c.input)}\n    期望 ${JSON.stringify(c.want)}，实际 ${JSON.stringify(got)}\n    理由：${c.why}`);
    bad++;
  }
}

/**
 * 跨院线合并后的去重（pickDisplayGenres 走的就是这条路）。
 *
 * ★ 单独测这一步：父子标签常常来自**不同院线**，
 *   而 zhGenres 一次只看一个院线的 genres，在它内部看不到另一半。
 */
const mergeCases: { input: string[]; want: string[]; why: string }[] = [
  {
    input: [...zhGenres(['Music']), ...zhGenres(['演唱會'])],
    want: ['演唱會'],
    why: '百老匯 Music + 英皇「演唱會」→ 合并后只能剩「演唱會」',
  },
  {
    input: [...zhGenres(['Horror', 'Action']), ...zhGenres(['驚悚']), ...zhGenres(['驚險(恐怖)片'])],
    want: ['恐怖片', '動作片', '驚悚片'],
    why: '生化危機 的四个院线合流：不能出现「驚險(恐怖)片」与「恐怖片」并列',
  },
  {
    input: [...zhGenres(['Comedy', 'Drama']), ...zhGenres(['情感/喜劇片'])],
    want: ['喜劇片', '劇情片'],
    why: '我阿爹想旅行：星達的「情感」要并进「劇情片」，不能并列',
  },
];
for (const c of mergeCases) {
  const got = dropParents([...new Set(c.input)]);
  if (JSON.stringify(got) !== JSON.stringify(c.want)) {
    console.log(`✗ 合并 ${JSON.stringify(c.input)}\n    期望 ${JSON.stringify(c.want)}，实际 ${JSON.stringify(got)}\n    理由：${c.why}`);
    bad++;
  }
}

/**
 * 全量守卫：任何输入都不得产出
 *   - 含简体专有字的标签
 *   - 同一结果里同时出现「恐怖片」与「驚險(恐怖)片」这类同义项
 */
const SIMP_ONLY = new Set('剧动爱惊战纪悬灾乐运艺节极亲说话术个与后里发门无风飞龙马鸟鱼车东见认过还这进远连问间闻单头义习乡云亚产');
const poison = [
  ['科幻', '惊悚', '恐怖'],
  ['剧情', '动作', '动画', '喜剧', '冒险', '爱情', '犯罪', '战争', '纪录片', '悬疑', '灾难', '音乐', '歌舞', '奇幻', '家庭', '历史', '传记', '同性', '古装', '戏曲', '运动', '教育'],
  ['Horror', 'Action', 'Drama', 'Comedy', 'Animation', 'Music', 'War', 'Sport', 'Romance', 'Sci-Fi', 'Crime', 'Fantasy', 'Adventure', 'Family', 'Documentary', 'Superhero'],
  ['驚悚', '驚險(恐怖)片', '情感/喜劇片', '音樂/演唱會', '動作/劇情片'],
];
const all = zhGenres(poison.flat());
const drop = dropParents(all);
for (const t of drop) {
  for (const ch of t) {
    if (SIMP_ONLY.has(ch)) {
      console.log(`✗ 归一后仍含简体字：「${t}」（字「${ch}」）`);
      bad++;
    }
  }
}
const dupes: [string, string][] = [['恐怖片', '驚險(恐怖)片'], ['劇情片', '情感'], ['音樂', '演唱會'], ['驚悚片', '驚悚']];
for (const [a, b] of dupes) {
  if (drop.includes(a) && drop.includes(b)) {
    console.log(`✗ 归一后仍同义并列：「${a}」与「${b}」`);
    bad++;
  }
}

console.log(
  bad === 0
    ? `✓ 类型规则 ${cases.length} 例 + 合并 ${mergeCases.length} 例 + 全量守卫通过（归一后 ${drop.length} 个标签：${drop.join('/')}）`
    : `${bad} 条不通过`
);
process.exit(bad === 0 ? 0 : 1);
