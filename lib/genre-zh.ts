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
  return out;
}

/** 单个原子标签 → 统一中文写法（未命中词表则原样保留） */
function canon(atom: string): string {
  if (!atom) return atom;
  // 已含中文：只做写法归一（「動作」→「動作片」）；
  // 「驚險(恐怖)片」这类不在表里的原样保留，不拆括号（括号里是补充说明）。
  if (/[\u4e00-\u9fff]/.test(atom)) return CJK_CANON[atom] || atom;
  return GENRE_ZH[atom.toLowerCase().trim()] || atom;
}

function push(list: string[], v: string) {
  if (v && !list.includes(v)) list.push(v);
}
