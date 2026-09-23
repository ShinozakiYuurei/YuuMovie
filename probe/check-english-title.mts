#!/usr/bin/env node
/**
 * 英文副标题的回归测试（部署自检会跑）
 *
 * 为什么要钉死：详情页中文标题下面那行英文名**错了不会报错** ——
 *   页面照样 200、照样好看，只是：
 *     - 整行不见了（用户 2026-09-25 截图里《歡迎來龍餐館》就是这种），
 *     - 或者变成「4DX Avengers: Endgame Encore Infinity Vision」，
 *       把放映规格当成片名印在标题下面。
 *
 * 两类问题的根因不同，各钉一组：
 *   1. **来源**：英文名必须是**组级**字段（displayNameEn），
 *      不能继承 group.primary.nameEn —— primary 按场次最多选，
 *      而 MCL 只给中文名，于是「哪家场次多」就决定了副标题有没有。
 *   2. **清洗**：院线会在英文名里缀上版本 / 活动 / 影展标记
 *      （IMAX / (Atmos) / (KINO) / (HKLGFF 2026) / Special Screening…），
 *      必须剥掉；但**片名自带的括号不能剥**
 *      （Evangelion: Death (True)² & Rebirth 的 (True)、
 *       You Can (Not) Redo 的 (Not)）。
 *
 * 只依赖仓库内代码，不读 data/、不联网，服务器上也能跑。
 *
 * 跑法：node_modules/.bin/tsx probe/check-english-title.mts
 */
import { stripEnglishTitleNoise } from '../lib/versions.ts';
import { getMovieGroups } from '../lib/data.ts';
import fs from 'node:fs';

type Case = { input: string; want: string; why: string };

const cases: Case[] = [
  // ---------- 放映规格 ----------
  {
    input: 'IMAX The Odyssey',
    want: 'The Odyssey',
    why: '百老匯把规格写在**前缀**（无括号），必须剥掉，否则副标题变成「IMAX The Odyssey」',
  },
  {
    input: '4DX Avengers: Endgame Encore Infinity Vision',
    want: 'Avengers: Endgame Encore',
    why: '规格 + 活动标签同时出现；Encore 是这次重映的官方英文名，保留',
  },
  {
    input: 'CGS Avengers: Endgame Encore Infinity Vision',
    want: 'Avengers: Endgame Encore',
    why: '同上，CGS 是规格',
  },
  {
    input: 'Avengers: Endgame Encore (Atmos)',
    want: 'Avengers: Endgame Encore',
    why: '全景聲在英文侧写 (Atmos)，中文侧写「(全景聲)」—— 两边词表不同',
  },
  {
    input: '(2D) Avengers: Endgame Encore',
    want: 'Avengers: Endgame Encore',
    why: '英皇把 2D 写在括号前缀',
  },
  {
    input: 'Avengers: Endgame Encore (2D Version)',
    want: 'Avengers: Endgame Encore',
    why: '星達写「(2D版)」的英文对应写法',
  },
  {
    input: '35mm Film The Odyssey',
    want: 'The Odyssey',
    why: '菲林版的英文写法',
  },
  {
    input: 'Oasis (35mm)',
    want: 'Oasis',
    why: '括号里的规格缩写',
  },

  // ---------- 语言版本 ----------
  {
    input: 'Paw Patrol :The Dino Movie (English Version)',
    want: 'Paw Patrol: The Dino Movie',
    why: '语言版本要剥；顺带把「Paw Patrol :The」这种全角冒号粘连归一为「Paw Patrol: The」',
  },
  {
    input: '(Cant. Version) PAW PATROL: THE DINO MOVIE',
    want: 'PAW PATROL: THE DINO MOVIE',
    why: '英皇的缩写写法（前缀）',
  },
  {
    input: 'Chiikawa the Movie: The Secret of Mermaid Island (Jap)',
    want: 'Chiikawa the Movie: The Secret of Mermaid Island',
    why: '星達只写 (日)，英文侧对应 (Jap)',
  },
  {
    input: '(Jap. Version) CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND',
    want: 'CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND',
    why: '英皇的 Jap. Version 写法',
  },

  // ---------- 场次类型 / 活动 / 影展 ----------
  {
    input: 'Good Trip Special Screening',
    want: 'Good Trip',
    why: '特典場的英文写法（裸词，无括号）',
  },
  {
    input: '(Special Screening) Good Trip',
    want: 'Good Trip',
    why: '英皇把特典場写在括号前缀',
  },
  {
    input: '(Seat Cover Special Screening) (Jap. Version) CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND',
    want: 'CHIIKAWA THE MOVIE: THE SECRET OF THE MERMAID ISLAND',
    why: '椅套特典場 + 日語版两个括号，都要剥',
  },
  {
    input: 'Taxi Driver (Special Screening)',
    want: 'Taxi Driver',
    why: '后缀写法的特典場',
  },
  {
    input: 'Trial of Hein (KINO)',
    want: 'Trial of Hein',
    why: '影展名（KINO）跟在片名尾部，不剥就与中文行「故鄉異客 (KINO)」对不上',
  },
  {
    input: 'Gendernauts: A Journey Through Shifting Identities (HKLGFF 2026)',
    want: 'Gendernauts: A Journey Through Shifting Identities',
    why: '影展名 + 年份，前缀匹配才能整块剥掉',
  },
  {
    input: 'The Fifth Step (NT Live 2026-27)',
    want: 'The Fifth Step',
    why: 'NT Live + 演出季区间',
  },
  {
    input: 'SWAN LAKE (The Royal Ballet 2026 – 2027)',
    want: 'SWAN LAKE',
    why: '带空格的连字符演出季，且括号里有多个词',
  },
  {
    input: 'Bio-Zombie (bc30 x APAAA)',
    want: 'Bio-Zombie',
    why: '活动标签组合写法（含 x）',
  },
  {
    input: 'Hidden Heroes (bc30 x APAAA)',
    want: 'Hidden Heroes',
    why: '同上',
  },
  {
    input: '(IV) Avengers: Endgame Encore',
    want: 'Avengers: Endgame Encore',
    why: '英皇用罗马序号标系列第四部',
  },
  {
    input: 'GIANT – The Play (2026)',
    want: 'GIANT – The Play',
    why: '纯年份括号',
  },

  // ---------- 片名自带的括号：一个都不能剥 ----------
  {
    input: 'Evangelion: Death (True)² & Rebirth',
    want: 'Evangelion: Death (True)² & Rebirth',
    why: '★ (True) 是片名的一部分，不在噪声词表里，必须原样保留',
  },
  {
    input: 'Evangelion: 3.33 You Can (Not) Redo',
    want: 'Evangelion: 3.33 You Can (Not) Redo',
    why: '★ (Not) 同上 —— 这是「剥括号」最容易误伤的一条',
  },
  {
    input: 'Evangelion: 1.11 You Are (Not) Alone',
    want: 'Evangelion: 1.11 You Are (Not) Alone',
    why: '同上',
  },
  {
    input: 'Puella Magi Madoka Magica The Movie -Rebellion-',
    want: 'Puella Magi Madoka Magica The Movie -Rebellion-',
    why: '★ 片名自带的首尾连字符，不能被当成「残留分隔符」收掉',
  },

  // ---------- 裸词误伤：Can / Cant / Eng 只在括号里才是语言标记 ----------
  {
    input: 'Can You Ever Forgive Me?',
    want: 'Can You Ever Forgive Me?',
    why: '★ 开头的 Can 是英文单词而非「粵語版」，裸词表故意排除这些缩写',
  },

  // ---------- 无需清洗的普通片名 ----------
  {
    input: 'Once Upon A Time In Middle East',
    want: 'Once Upon A Time In Middle East',
    why: '用户截图里的《歡迎來龍餐館》',
  },
  {
    input: 'Avengers: Endgame Encore',
    want: 'Avengers: Endgame Encore',
    why: '★ 用户截图里的《復仇者聯盟4》—— Encore 必须保留（剥了与院线物料对不上）',
  },
  {
    input: 'V',
    want: 'V',
    why: '单字母片名（《空槍》的官方英文名）',
  },
];

// ---------- 来源：必须是组级字段，不能继承 primary ----------
//
// 上面钉的是「怎么洗」，这一段钉的是「从哪拿」——
// 两者是**独立**的失效点，所以分开测。
//
// 用户 2026-09-25 报的《歡迎來龍餐館》英文行整行不见了，
// 根因就不在清洗，而在来源：读的是 group.primary.nameEn，
// 而 primary 按场次最多选（该片 primary 是 MCL 条目，MCL 不提供英文名）。
// 所以即便清洗规则全对，这一行照样会消失。
//
// 判据两条（都跑真数据，不联网）：
//   1. 组内任一条目洗完还有英文 → displayNameEn 必须非空。
//      这条直接防「改回读 primary」的回归。
//   2. displayNameEn 若存在，就必须是**干净**的（不含版本 / 活动 / 影展残留）。
//
// 不写死具体片名：数据每 2–6 小时重抓，写死会随数据变动而误报。
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const rawMovies = JSON.parse(fs.readFileSync('data/movies.json', 'utf8')) as Array<{
  nameZh: string;
  nameEn?: string;
}>;

/** 按原始中文名粗分组：这里只回答「组里到底有没有英文名」这一件事，宽松即可 */
const enByZh = new Map<string, string[]>();
for (const m of rawMovies) {
  const k = (m.nameZh || '').trim();
  if (!k) continue;
  if (!enByZh.has(k)) enByZh.set(k, []);
  if (m.nameEn) enByZh.get(k)!.push(m.nameEn);
}

/** 洗完仍带这些词的，说明噪声词表漏了词 */
const STILL_DIRTY_RE =
  /Version|Screening|Restor|Atmos|IMAX|4DX|MX4D|CGS|LUXE|KINO|HKLGFF|GFF|InDPanda|NT Live|bcSunday|bc30|anifest|The Met|Royal Ballet/i;

let missing = 0;
let unclean = 0;
let checked = 0;
for (const g of getMovieGroups()) {
  checked++;
  const raw = enByZh.get(g.displayName) || [];
  const usable = raw.some((e) => !CJK_RE.test(e) && stripEnglishTitleNoise(e).length > 0);
  if (usable && !g.displayNameEn) {
    missing++;
    console.log(
      `  ✗ ${g.displayName}：组内有英文名但 displayNameEn 为空（是不是又改回读 primary 了？）`
    );
  }
  if (g.displayNameEn && STILL_DIRTY_RE.test(g.displayNameEn)) {
    unclean++;
    console.log(`  ✗ ${g.displayName}：英文名仍带噪声 → ${JSON.stringify(g.displayNameEn)}`);
  }
}
console.log(`组级英文名：检查 ${checked} 组 ｜ 漏掉 ${missing} ｜ 未洗净 ${unclean}`);
if (missing || unclean) process.exit(1);

let bad = 0;
for (const c of cases) {
  const got = stripEnglishTitleNoise(c.input);
  if (got !== c.want) {
    bad++;
    console.log(`  ✗ ${JSON.stringify(c.input)}`);
    console.log(`      期望 ${JSON.stringify(c.want)}`);
    console.log(`      实得 ${JSON.stringify(got)}`);
    console.log(`      理由 ${c.why}`);
  }
}
console.log(`英文副标题清洗：${cases.length - bad}/${cases.length} 通过`);
if (bad) process.exit(1);
console.log('✓ 英文副标题清洗规则全部符合预期');
