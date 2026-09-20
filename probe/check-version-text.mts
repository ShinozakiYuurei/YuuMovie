#!/usr/bin/env node
/**
 * 场次卡片「影片版本·语言」的回归测试（部署自检会跑）
 *
 * 为什么要钉死：这行文案是用户 2026-09-21 指定取代影厅名的
 *   （影厅名「1院」「House 1」对「选哪一场」几乎没帮助）。
 *   它由两个正交维度拼出来 —— 放映规格（IMAX/4DX…）与语言 ——
 *   组合多、边界碎，写错了页面照样 200、照样好看，
 *   只是标签变得莫名其妙（例如「IMAX·加碼重映·英語」或「粵語版·英語」）。
 *
 * 用户确认的三条规则：
 *   1. 原版（无放映规格）也要带语言 →「原版·英語」
 *   2. 版本部分只含**放映规格与语言**，丢掉活动标记（加碼重映/特典場/影展名…）
 *   3. 语言优先取版本自带的语言标记（日語版 → 日語），否则用影片对白语言
 *
 * 只依赖仓库内代码，不读 data/、不联网，服务器上也能跑。
 *
 * 跑法：node_modules/.bin/tsx probe/check-version-text.mts
 */
import { formatVersionText, extractFormats } from '../lib/versions.ts';

type Case = { name: string; lang: string | null; want: string; why: string };

const cases: Case[] = [
  // ---------- 放映规格 + 影片语言 ----------
  {
    name: 'IMAX 復仇者聯盟4',
    lang: '英語',
    want: 'IMAX·英語',
    why: 'IMAX 没有语言标记，用影片对白语言兜底（实测只有百老匯条目带 dialect）',
  },
  {
    name: '35mm 菲林版 奧德賽',
    lang: '英語',
    want: '35mm 菲林版·英語',
    why: '菲林版是放映规格（怎么放），要保留；显示名走 formatLabel',
  },
  {
    name: '霸王別姬 (4K修復版)',
    lang: '國語',
    want: '4K 修復版·國語',
    why: '4K 修復版属于规格；formatLabel 会补空格成「4K 修復版」',
  },
  // ---------- 版本自带语言标记 ----------
  {
    name: '4DX 劇場版 CHIIKAWA (日語版)',
    lang: '日語',
    want: '4DX·日語',
    why: '规格 4DX + 语言标记日語版 → 语言取自标记',
  },
  {
    name: '4DX 劇場版 CHIIKAWA (日語版)',
    lang: '英語',
    want: '4DX·日語',
    why: '★ 版本自带的语言优先于影片整体语言（同一部片可能同时有日語版/粵語版）',
  },
  {
    name: '粵語版 汪汪隊',
    lang: '英語',
    want: '粵語版',
    why: '无放映规格时语言标记**本身就是版本**，不再缀「·粵語」重复一遍',
  },
  {
    name: '日語版 蠟筆小新',
    lang: '粵語',
    want: '日語版',
    why: '同上；且不受影片整体语言（粵語）影响',
  },
  // ---------- 原版 ----------
  {
    name: '生化危機',
    lang: '英語',
    want: '原版·英語',
    why: '用户明确要求：原版也要带语言，而不是只写「原版」',
  },
  {
    name: '八仙！',
    lang: null,
    want: '原版',
    why: '影片语言缺失（48 部为 null）时退化成裸「原版」，不留孤立的分隔符',
  },
  {
    name: 'IMAX 奧德賽',
    lang: null,
    want: 'IMAX',
    why: '同上：没有语言就不缀「·」',
  },
  // ---------- 活动标记必须丢掉 ----------
  {
    name: '復仇者聯盟4 加碼重映',
    lang: '英語',
    want: '原版·英語',
    why: '★ 用户确认：版本部分只含放映规格与语言，「加碼重映」是放映轮次不是规格',
  },
  {
    name: '《廚師發辦》心跳回憶特典場',
    lang: '粵語',
    want: '原版·粵語',
    why: '特典場是场次类型，不是放映规格',
  },
  {
    name: 'BTS LIVE VIEWING (2026)',
    lang: '英語',
    want: '原版·英語',
    why: 'Live Viewing 是活动标记，不是规格',
  },
  {
    name: '故鄉異客 (GFF)',
    lang: '粵語',
    want: '原版·粵語',
    why: '影展名是活动标记，不是规格',
  },
  {
    name: '【Infinity Vision】復仇者聯盟4',
    lang: '英語',
    want: '原版·英語',
    why: '活动标签不是规格（与选海报的 NON_ART_TOKENS 同一套口径）',
  },
  {
    name: '復仇者聯盟4 加碼重映 (全景聲)',
    lang: '英語',
    want: '全景聲·英語',
    why: '全景聲是规格要留，加碼重映要丢',
  },
  {
    name: 'IMAX 復仇者聯盟4 加碼重映',
    lang: '英語',
    want: 'IMAX·英語',
    why: '★ 规格与活动标记混写：只留 IMAX',
  },
  // ---------- 多规格 ----------
  {
    name: 'IMAX 4DX 某某片',
    lang: '英語',
    want: 'IMAX + 4DX·英語',
    why: '多个规格用 + 连接（沿用 versionLabel 的既有写法）',
  },
];

let bad = 0;
for (const c of cases) {
  const got = formatVersionText(extractFormats(c.name), c.lang);
  if (got !== c.want) {
    console.log(`✗ ${JSON.stringify(c.name)} lang=${c.lang}\n    期望 ${JSON.stringify(c.want)}，实际 ${JSON.stringify(got)}\n    理由：${c.why}`);
    bad++;
  }
}

/**
 * 全量守卫：任何输入都不得产出这些明显错误的形态。
 *
 * 这几条正是「规则写错」时最容易出现的症状，单独兜一层：
 *   1. 活动标记漏进文案（IMAX·加碼重映·英語）
 *   2. 语言重复（粵語版·粵語）
 *   3. 空语言留下孤立分隔符（IMAX·）
 *   4. 影厅名混进来（1院 / House 1）
 */
const ACTIVITY = ['加碼重映', '重映', '特典場', '應援場', '優先場', 'Encore', 'Live Viewing', 'GFF', 'Infinity Vision'];
const poison: [string, string | null][] = [
  ...cases.map((c) => [c.name, c.lang] as [string, string | null]),
  ['IMAX 生化危機 加碼重映', '英語'],
  ['MX4D 復仇者聯盟4 特典場', '英語'],
  ['《我阿爹想旅行》中秋特典場', '粵語'],
  ['汪汪隊 (粵語版)', '粵語'],
  ['奧德賽 IMAX with Laser', '英語'],
  ['House 5/IMAX* 某某片', '英語'],
];

for (const [name, lang] of poison) {
  const out = formatVersionText(extractFormats(name), lang);
  for (const a of ACTIVITY) {
    if (out.includes(a)) {
      console.log(`✗ 活动标记漏进文案：${JSON.stringify(name)} → ${JSON.stringify(out)}（含「${a}」）`);
      bad++;
    }
  }
  if (/(版)·/.test(out) && out.includes('·')) {
    const [ver, langPart] = out.split('·');
    if (ver.endsWith('版') && langPart && ver.replace('版', '') === langPart) {
      console.log(`✗ 语言重复：${JSON.stringify(name)} → ${JSON.stringify(out)}`);
      bad++;
    }
  }
  if (out.endsWith('·') || out.includes('··')) {
    console.log(`✗ 孤立分隔符：${JSON.stringify(name)} → ${JSON.stringify(out)}`);
    bad++;
  }
  if (/\d+院|House \d/.test(out)) {
    console.log(`✗ 影厅名混入：${JSON.stringify(name)} → ${JSON.stringify(out)}`);
    bad++;
  }
}

console.log(bad === 0 ? `✓ 版本·语言文案 ${cases.length} 例 + 全量守卫 ${poison.length} 例全部通过` : `${bad} 条不通过`);
process.exit(bad === 0 ? 0 : 1);
