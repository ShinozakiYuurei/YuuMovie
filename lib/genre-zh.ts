/**
 * 英文类型名 → 中文（繁體）
 *
 * 为什么需要：五家院线里 emperor / cinemacity / bestar 给的是中文类型
 * （「劇情片」「動畫片」），但 **broadway 与 mcl 只给英文**（"Drama/Action"），
 * 而 Broadway 占了 195/385 条 —— 去掉豆瓣评分后就没有别的中文来源了，
 * 只能在读取层自己翻。
 *
 * 译名按香港电影金像奖 / 院线常用写法，不用大陆译法。
 * 未命中词表的一律原样保留，不猜、不空 —— 宁可露一个英文词，
 * 也不要把「Film Noir」翻成不相干的东西（而且能直接从页面上看出词表缺口）。
 */

/** 单词映射（小写比对）
 *
 * 选词跟 emperor / cinemacity / bestar 已有的中文写法对齐
 * （它們给的是「劇情片」「動畫片」带「片」后缀），
 * 否则同为剧情片，Broadway 的页显示「劇情」、其他院线显示「劇情片」。
 * Horror 与 Thriller 不能都译「驚悚」，按港片常用分开：恐怖 / 驚悚。
 */
const GENRE_ZH: Record<string, string> = {
  action: '動作片',
  adventure: '冒險片',
  animation: '動畫片',
  anime: '動畫片',
  biography: '傳記片',
  comedy: '喜劇片',
  crime: '犯罪片',
  documentary: '紀錄片',
  drama: '劇情片',
  family: '家庭片',
  fantasy: '奇幻片',
  filmnoir: '黑色電影',
  'film noir': '黑色電影',
  history: '歷史片',
  holiday: '節日',
  horror: '恐怖片',
  kids: '兒童',
  music: '音樂',
  musical: '歌舞片',
  mystery: '懸疑片',
  news: '新聞',
  thriller: '驚悚片',
  romance: '愛情片',
  'romantic comedy': '愛情喜劇',
  'sci-fi': '科幻片',
  scifi: '科幻片',
  sciencefiction: '科幻片',
  'science fiction': '科幻片',
  short: '短片',
  sport: '運動',
  sports: '運動',
  superhero: '超級英雄',
  survival: '求生',
  talk: '脫口Show',
  war: '戰爭片',
  western: '西部片',
  wuxia: '武俠片',
};

/** 已中文的原子类型 → 统一写法（带「片」后缀）
 *
 * 不统一的话，「愛情/喜劇片」拆开会变成「愛情」+「喜劇片」两种粒度混排。
 */
const CJK_CANON: Record<string, string> = {
  動作: '動作片',
  冒险: '冒險片',
  冒險: '冒險片',
  剧情: '劇情片',
  劇情: '劇情片',
  喜劇: '喜劇片',
  喜剧: '喜劇片',
  动画: '動畫片',
  動畫: '動畫片',
  恐怖: '恐怖片',
  懸疑: '懸疑片',
  悬疑: '懸疑片',
  犯罪: '犯罪片',
  科幻: '科幻片',
  战争: '戰爭片',
  戰爭: '戰爭片',
  爱情: '愛情片',
  愛情: '愛情片',
  奇幻: '奇幻片',
  家庭: '家庭片',
  傳記: '傳記片',
  歷史: '歷史片',
  歌舞: '歌舞片',
};

/** 常见组合的整体译法（先于逐词匹配，避免拆碎成「劇情/愛情」） */
const PHRASE_ZH: Record<string, string> = {
  'action & adventure': '動作/冒險',
  'action and adventure': '動作/冒險',
  'kids & family': '兒童/家庭',
};

/**
 * 豆瓣给的是**简体**类型名（「科幻」「惊悚」「恐怖」），院线给的是繁体。
 *
 * ★ 2026-09-21 用户报「类型出现简中繁中并存」：
 *   data/enrich.json 的 douban.genres 实测是 `["科幻","惊悚","恐怖"]`，
 *   而 movies.json 里各院线一律繁体。两边一旦合流，同一行就会出现
 *   「科幻 / 驚悚」这种半简半繁。
 *
 * 只按**已知类型词**逐个归一，不做通用简繁转换 ——
 * 后者会把片名、演职员名里的字一起换掉（「皇后大道中」的「后」等）。
 */
const SIMP_GENRE: Record<string, string> = {
  惊悚: '驚悚',
  剧情: '劇情',
  动作: '動作',
  喜剧: '喜劇',
  冒险: '冒險',
  爱情: '愛情',
  动画: '動畫',
  犯罪: '犯罪',
  战争: '戰爭',
  纪录片: '紀錄片',
  纪录: '紀錄片',
  悬疑: '懸疑',
  灾难: '災難片',
  音乐: '音樂',
  歌舞: '歌舞',
  奇幻: '奇幻',
  家庭: '家庭',
  历史: '歷史',
  传记: '傳記',
  同性: '同性',
  古装: '古裝',
  戏曲: '戲曲',
  情色: '情色',
  运动: '運動',
  教育: '教育',
  恐怖: '恐怖',
  科幻: '科幻',
};

/**
 * 豆瓣 genres 里混进的**非类型值**，一律丢弃。
 *
 * ★ 实测（data/enrich.json，2026-09-21）：豆瓣条目匹配到「书」或
 *   版本页时，genres 字段里会是年份或人名，例如：
 *     「新世紀福音戰士新劇場版 破」→ ["2024"]
 *     「SAKAMOTO DAYS 坂本日常」→ ["2022"]
 *     「奇愛博士」→ ["肖恩·福利"]（那是导演名）
 *     「我阿爹想旅行」→ ["黄绮琳","黄锎"]（那是编剧名）
 *   不丢掉就会在「類型」行里出现一个年份或人名。
 *
 * 只过滤**纯数字**（年份/册号）：人名无法与真类型区分
 *   （「華格納」「Matthew」「Bourne」这类同样是垃圾，但
 *   无法在不知道词表的情况下判死，而误删真类型的代价更大）。
 */
const NON_GENRE_RE = /^\s*\d{1,4}\s*$/;

/**
 * 同义归并：不同院线对**同一个类型**的不同写法，合成一个标签。
 *
 * ★ 2026-09-21 用户报「类型有重复」：
 *   《生化危機》原来显示「驚悚 / 劇情片 / 驚險(恐怖)片 / 恐怖片 / 動作片」——
 *   其中「驚險(恐怖)片」（星達）括号里就是「恐怖」，与百老匯的「恐怖片」
 *   是同一件事；emperor / cinemacity 的「驚悚」又漏了「片」字，
 *   与百老匯译出的「驚悚片」对不上，于是两个写法并列出现。
 *
 * ⚠ 「驚悚片」与「恐怖片」**不合并** —— 那是两个类型（Thriller ≠ Horror）。
 *   实测星達同一部片会同时给「驚險(恐怖)片」与「驚悚」，说明它自己也区分。
 */
const GENRE_MERGE: Record<string, string> = {
  '驚險(恐怖)片': '恐怖片',
  驚險片: '恐怖片',
  驚悚: '驚悚片',
  // 星達用「情感」表示剧情向（它给的是「情感/喜劇片」），与「劇情片」重复
  情感: '劇情片',
};

/**
 * 上位标签：key 存在时，把 value 里的标签去掉。
 *
 * 院线会同时给「大类 + 子类」（星達给「音樂/演唱會」），
 * 直接合并会出现「音樂 + 演唱會」这种父子并列 —— 用户看到的就是重复。
 * 保留更具体的那个（演唱會 / 歌劇 / 音樂劇 都比「音樂」信息量大）。
 */
const GENRE_PARENT: Record<string, string[]> = {
  演唱會: ['音樂'],
  歌劇: ['音樂'],
  音樂劇: ['音樂'],
};

/**
 * 把一个类型标签译成中文
 *
 * 先拆成**原子标签**再逐个映射。两个原因：
 *  1. broadway 会给 "Drama/Sci-Fi" 这种斜杠组合，不拆就出现「Drama/科幻」半中半英；
 *  2. 跨院线合并时，MCL 的「動作/喜劇片」与 Broadway 译出的「動作片+喜劇片」
 *     会被当成三个不同标签排在一起（实测 SAKAMOTO DAYS 就这副样子），
 *     拆平之后才能靠 canon() 去重。
 */
export function zhGenres(genres: string[] | null | undefined): string[] {
  if (!genres?.length) return [];
  const out: string[] = [];
  for (const raw of genres) {
    const g = (raw || '').trim();
    if (!g) continue;
    // 豆瓣匹配到「书」/版本页时 genres 会是年份（"2024"），丢掉
    if (NON_GENRE_RE.test(g)) continue;
    const key = g.toLowerCase();
    if (PHRASE_ZH[key]) {
      for (const p of PHRASE_ZH[key].split('/')) push(out, canon(p));
      continue;
    }
    // 括号内是补充说明（「驚險(恐怖)片」），不能当分隔符拆
    const atoms = g
      .split(/[/|,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const a of atoms) push(out, canon(a));
  }
  return dropParents(out);
}

/**
 * 去掉被更具体标签涵盖的大类（有「演唱會」则去「音樂」）。
 *
 * ★ 必须导出、由调用方在**跨院线合并后**再跑一次：
 *   父子标签常常来自不同院线（百老匯给 `Music` → 音樂，
 *   英皇给「演唱會」），而 zhGenres 一次只处理一个院线的 genres，
 *   在函数内部去重看不到另一半，于是「音樂 + 演唱會」依旧并列出现。
 */
export function dropParents(list: string[]): string[] {
  const drop = new Set<string>();
  for (const [child, parents] of Object.entries(GENRE_PARENT)) {
    if (list.includes(child)) for (const p of parents) drop.add(p);
  }
  return drop.size ? list.filter((x) => !drop.has(x)) : list;
}

/** 单个原子标签 → 统一中文写法（未命中词表则原样保留） */
function canon(atom: string): string {
  if (!atom) return atom;
  const t = atom.trim();
  // 简体（豆瓣 genres）→ 繁体，再走同一套表，避免「簡繁並存」
  const s = SIMP_GENRE[t] ?? t;
  // 已含中文：先同义归并（驚悚→驚悚片），再做写法归一（動作→動作片）；
  // 「驚險(恐怖)片」这类不在表里的原样保留，不拆括号（括号里是补充说明）。
  if (/[\u4e00-\u9fff]/.test(s)) {
    const merged = GENRE_MERGE[s] ?? s;
    return CJK_CANON[merged] || merged;
  }
  return GENRE_ZH[s.toLowerCase()] || s;
}

function push(list: string[], v: string) {
  if (v && !list.includes(v)) list.push(v);
}
