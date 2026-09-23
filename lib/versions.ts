/**
 * 电影版本归一化
 *
 * 问题：同一部电影因放映格式不同，在院线数据里是多个独立条目。
 * 例如《復仇者聯盟4》有 11 个条目（IMAX / 4DX / CGS / 全景聲 / LUXE / MX4D / 特典場…）
 *
 * 目标：把它们归为一个「电影组」，首页只显示一张卡片，
 *      详情页再按版本分类展示场次。
 *
 * 设计原则：
 *  - 只剥离**明确的格式标记**，不猜测片名相似度（避免误合并《生化危機》与《生化壽屍》）
 *  - 保守优先：宁可漏合并，不可错合并
 */

/** 放映格式标记（会从片名中剥离，并作为版本标签展示） */
const FORMAT_TOKENS = [
  'IMAX with Laser',
  'IMAX Laser',
  'IMAX',
  'MX4D',
  '4DX',
  'CGS',
  'LUXE',
  'Dolby Cinema',
  'Dolby Atmos',
  'Dolby',
  'Onyx',
  'ScreenX',
  'RealD',
  'D-BOX',
  'THX',
  'ATMOS',
  'CINITY',
  'Cinity',
  '全景聲',
  '全景声',
  '杜比',
  '巨幕',
  '動感影院',
  // 活动/系列标签（剥离但不当版本标签展示）
  'Infinity Vision',
  'bcSunday',
  'bc30',
  'APAAA',
  'Diamond Hill',
  // 场次类型（院线写法五花八门，长 token 必须先于短 token 剥离，见 SORTED_FORMAT_TOKENS）
  '特典應援場',
  '特典場',
  '特典场',
  '特別放映',
  '特别放映',
  '特別上映',
  '特别上映',
  '優先場',
  '應援場',
  '中秋特典場',
  '椅套特典場',
  '椅套',
  '見面場',
  'Hi Bye Meet & Greet',
  '期間限定',
  'LIMITED',
  // 版本修饰
  '導演剪輯版',
  '导演剪辑版',
  '4K修復版',
  '4K 修復版',
  '2K無字幕版',
  // 胶片放映格式（broadway 会写成独立条目「35mm 菲林版 奧德賽」）
  '35mm 菲林版',
  '35mm菲林版',
  '菲林版',
  '菲林',
  '35mm',
  '70mm',
  '16mm',
  '膠片版',
  '日語版',
  '英語版',
  '粵語版',
  '國語版',
  '原聲版',
  '加長版',
  '特別版',
  // 英皇的英文缩写写法：「(Jap. Version) 片名」，其他院线写「(日語版)」
  'Jap. Version',
  'Can. Version',
  'Cant. Version',
  'Eng. Version',
  // 放映格式：emperor 会写成「(2D) 片名」，未识别时会单独成组
  '2D',
  '3D',
  // bestar 写「(2D版)」，剥掉 2D 后会残留孤字「版」，直接整体剥
  '2D版',
  '3D版',
  // 影展 / 节目单元标签：同一部片会在不同影展各开一条目（broadway 常见）
  'HKLGFF',
  'GFF',
  'KINO',
  'InDPanda',
  'anifest動画藝術祭',
  'New Wave',
  // 放映轮次：属于「版本」而非不同电影（broadway 常写「…(ENCORE)」，MCL/英皇不带）
  'Encore',
  '重映',
  '加碼重映',
  // mcl 写「限定重映」不带「場」字，与「限定重映應援場」必须归一
  '限定重映',
  'Live Viewing',
];
/** 这些只是活动标签，不作为「版本」展示给用户 */
const ACTIVITY_TAGS = new Set([
  'Infinity Vision',
  'bcSunday',
  'bc30',
  'APAAA',
  'Diamond Hill',
  'Hi Bye Meet & Greet',
  '期間限定',
  'LIMITED',
  '椅套',
  '特別放映', '特别放映', '特別上映', '特别上映',
  // 2D / 3D 在港片市场是默认规格，单独拿它当「版本」没信息量
  //（且只有 bestar 会写「(2D版)」，会凭多出一堆「2D版」标签）
  '2D',
  '3D',
  '2D版',
  '3D版',
  // 影展名归入影片元数据，不占版本标签位
  'HKLGFF',
  'GFF',
  'KINO',
  'InDPanda',
  'anifest動画藝術祭',
  'New Wave',
]);

/**
 * 同一件事的长短写法（'35mm' / '菲林版' / '35mm 菲林版'）只保留最长命中项。
 * 不去重会得到 vKey "35mm|菲林版"，与另一家的 "菲林版" 对不上。
 */
function dedupeOverlaps(tokens: string[]): string[] {
  const lower = tokens.map((t) => t.toLowerCase());
  return tokens.filter((a, i) =>
    !tokens.some((b, j) => j !== i && lower[j].includes(lower[i]) && lower[j] !== lower[i])
  );
}

/**
 * ★ 剥离顺序必须「长的在前」。
 * 反例：FORMAT_TOKENS 里 '特典場' 排在 '中秋特典場' 之前，
 *       「《我阿爹想旅行》中秋特典場」会先被剥成「中秋」，
 *       与另一院的「我阿爹想旅行」对不上，首页出现两张卡片。
 */
const SORTED_FORMAT_TOKENS = [...FORMAT_TOKENS].sort((a, b) => b.length - a.length);

/** 版本别名归一 */
const FORMAT_ALIAS: Record<string, string> = {
  全景声: '全景聲',
  'IMAX with Laser': 'IMAX',
  'IMAX Laser': 'IMAX',
  'Dolby Atmos': 'Dolby',
  'Dolby Cinema': 'Dolby',
  CINITY: 'Cinity',
  '特典场': '特典場',
  '中秋特典場': '特典場',
  '椅套特典場': '特典場',
  '35mm 菲林版': '菲林版',  '35mm菲林版': '菲林版',
  菲林: '菲林版',
  '35mm': '菲林版',
  '70mm': '菲林版',
  '16mm': '菲林版',
  膠片版: '菲林版',
};

/**
 * 括号包裹字符 → 空格。
 * 注：括号**内部**的原子写法（(日) / (IV)）已在 preprocessTitle 里先行剔掉，
 * 因为拆括号后它们会与片名粘连而认不出来。
 */
function stripBrackets(s: string): string {
  return s.replace(/[【】《》（）()「」\[\]]/g, ' ');
}

/**
 * 文字正规化（用于片名比对与展示）
 *
 * 两步：
 *  1. NFKC：全角→半角、康熙部首/兼容字符→正字
 *     实测案例：MCL 写成「魔方⼩姐」(⼩ = U+2F29 康熙部首)，
 *     其他院线写「魔方小姐」(小 = U+5C0F)。不做 NFKC 会被当成两部电影。
 *  2. NFD + 去组合音标：SÃO → SAO
 *     不同院线的重音编码可能不一致（组合字符 vs 预组合字符）。
 *
 * 汉字本身不受 NFD 影响，安全。
 */
function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * 去掉年份（如 2026 / (2026)）
 *
 * 同一部电影在不同院线的片名里，有的带年份有的不带
 * （例：broadway 写「…LIVE VIEWING (2026)」，MCL/英皇写「…LIVE VIEWING」），
 * 不处理会分裂成多个分组。
 */
function stripYear(s: string): string {
  return s
    // 演出季区间「2026-27」「2026 - 2027」：NT Live / Royal Ballet 常用。
    // 不整体剔掉会残留孤儿「-27」，把同一部片拆成两组。
    .replace(/\b(?:19|20)\d{2}\s*[-–—]\s*(?:\d{2}|\d{4})\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ');
}

/**
 * 场次修饰词前缀（与紧贴的「…場」一起剔掉）
 *
 * 院线会在特典場前拼一个活动主题名：
 *   broadway「《廚師發辦》心跳回憶特典場」、bestar「我阿爹想旅行 中秋特典場」
 * 只剥掉「特典場」会残留「心跳回憶」「中秋」，与其他院线的裸片名对不上，
 * 首页就会多出一张卡片。
 *
 * 保守限定：必须是**紧贴**（无空白）的 ≤ 6 个汉字，且后面跟着完整的「X場」词。
 * 括号已先一步换成空格，所以「《的士司機》特典場」「「王家欣」特典場」
 * 这种片名本体不会被误删。
 */
const SCREENING_PREFIX_RE =
  /[一-鿿]{0,6}(?:特典|優先|應援|見面|嘉賓|首映|紀念|神秘|節日|場次)場/g;

/**
 * 特別放映條目有時在括號內附帶活動主題：
 * `《情書》30周年修復版 (「相約在The One」特別放映)`。
 * 必須在拆括號前移除整塊；否則只剝「特別放映」會留下「相約在The One」，
 * 既污染標題又阻止與同片的普通場次合併。
 */
const SPECIAL_SCREENING_ANNOTATION_RE =
  /[（(【\[]\s*(?:[「『][^」』]{1,40}[」』]\s*)?(?:特別放映|特别放映|特別上映|特别上映)\s*[）)】\]]/g;

/** 只剝明確的「數字周年 + 修復版」發行標記；不能碰「30周年修復版日記」這類片名。 */
const ANNIVERSARY_RESTORATION_RE =
  /(?<!\d)\d{1,3}\s*(?:周年|週年)\s*(?:4K\s*)?修[復复]版(?=$|[\s（(【\[])/g;

/**
 * 片名预处理：normalizeTitle 与 stripFormats 共用，
 * 保证「比较用的名字」与「显示用的名字」不会出现一个剔了、一个没剔。
 *
 * 顺序关键：先剔括号内的原子写法（(日) / (IV) / (2D版)），
 * 再拆括号。拆完括号这些写法已与片名粘连，认不出来了。
 */
function preprocessTitle(raw: string): string {
  return stripYear(
    normalizeText(raw)
      // 括号内只包方言缩写：「(日)」「(粵語)」「(日本語)」
      .replace(/[（(【\[]\s*[日粵國英韓台美陸法](?:語|語版|片)?\s*[)）】\]]/g, ' ')
      // 括号内只包罗马序号：英皇用「(IV)」标系列第四部
      .replace(/[（(【\[]\s*(?:[IVX]{1,4}|\d{1,2})\s*[)）】\]](?=\s)/g, ' ')
      // 先移掉帶活動主題的整塊括號，避免留下活動名當成片名。
      .replace(SPECIAL_SCREENING_ANNOTATION_RE, ' ')
      // 場次修飾詞（含前面的活動主題名）
      .replace(SCREENING_PREFIX_RE, ' ')
      .replace(ANNIVERSARY_RESTORATION_RE, ' ')
      .replace(/[【】《》（）()「」\[\]]/g, ' '),
  );
}

/**
 * 归一化的兜底：当 normalizeTitle 把片名剔成空串时用它。
 *
 * 为什么需要：data.ts 靠 normalizeTitle 的返回值当分组 key，
 * 空串会被当成「无名条目」直接 continue，**整部电影仍会从页面上消失**。
 * 现实片名可能全是标点 / 全被 token 覆盖（如片名就叫「IMAX」），
 * 错合并的代价比静默丢弃低。
 *
 * 与 normalizeTitle 的区别：只做正规化 + 去标点，**不剔格式 token**。
 */
export function fallbackTitle(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeText(name)
    .replace(/[：:·・—–\-_,，。、!！?？'"“”‘’【】《》（）()「」\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 构建匹配正则：ASCII token 用词边界，中文直接匹配 */
function tokenRegex(token: string, flags = 'gi'): RegExp {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isAscii = /^[\x00-\x7F]+$/.test(token);
  if (isAscii) {
    // 前后不能是字母数字，避免 "4DX" 匹配 "24DX"
    return new RegExp(`(^|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`, flags);
  }
  // 新增的「特別放映／上映」只认独立的前缀/后缀；不能把真正片名
  // 「特別放映日記」或「日記特別放映」删短后误合并到《日記》。
  if (/^特[別别](?:放映|上映)$/.test(token)) {
    return new RegExp(`(^|[\\s（(【\\[])${esc}(?=$|[\\s）)】\\]，,。、])`, flags);
  }
  return new RegExp(esc, flags);
}

/**
 * 归一化片名，用于分组比对。仅用于**比较**，不用于显示。
 */
export function normalizeTitle(name: string | null | undefined): string {
  if (!name) return '';

  // ★ 先归一化重音符号（SÃO → sao），再去掉年份，
  //   否则不同院线的同一部电影会被判成不同片名（详见函数上方注释）
  let s = preprocessTitle(name);
  // ★ 用 SORTED_FORMAT_TOKENS：长 token 先剥，否则「中秋特典場」会被先剥成「中秋」
  let prev;
  let guard = 0;
  do {
    prev = s;
    for (const token of SORTED_FORMAT_TOKENS) {
      const isAscii = /^[\x00-\x7F]+$/.test(token);
      if (isAscii) {
        // 保留边界字符，仅移除 token 本身
        s = s.replace(tokenRegex(token), (m, p1) => p1 + ' ');
      } else {
        // 中文：直接删除，不涉及捕获组
        s = s.replace(tokenRegex(token), ' ');
      }
    }
  } while (s !== prev && ++guard < 10);

  s = s
    // 清理 "bc30 x APAAA" 剥离后残留的孤立连接词
    .replace(/\s+[xX×]\s+/g, ' ')
    // 统一标点
    .replace(/[：:·・—–\-_,，。、!！?？'"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // 去掉首尾孤立的单字母 / 单字「版」（剥离残留）
  s = s.replace(/^[a-z]\s+|\s+[a-z]$/g, '').replace(/\s+版$/g, '').trim();

  return s;
}

/**
 * 从片名中剥离格式标记，保留原始大小写（用于展示）。
 * 与 normalizeTitle 的区别：后者用于比较（全小写、去标点）。
 * 两者共用 preprocessTitle + SORTED_FORMAT_TOKENS，不会出现一个剔了、一个没剔。
 */
export function stripFormats(name: string | null | undefined): string {
  if (!name) return '';
  let s = preprocessTitle(name);

  let prev;
  let guard = 0;
  do {
    prev = s;
    for (const token of SORTED_FORMAT_TOKENS) {
      const isAscii = /^[\x00-\x7F]+$/.test(token);
      if (isAscii) {
        s = s.replace(tokenRegex(token), (_m, p1) => p1 + ' ');
      } else {
        s = s.replace(tokenRegex(token), ' ');
      }
    }
  } while (s !== prev && ++guard < 10);

  return s
    .replace(/\s+[xX×]\s+/g, ' ')
    .replace(/\s*[：:]\s*$/g, '')
    .replace(/\s+版$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 英文片名里要剥掉的「版本 / 活动 / 影展」噪声词。
 *
 * ★ 为什么中文侧有一整套（FORMAT_TOKENS）而英文侧要另写一份：
 *   院线的中文名与英文名**各剥各的**，两边词表并不对应。
 *   例：中文写「(全景聲)」而英文写「(Atmos)」；中文写「加碼重映」
 *   而英文写「Encore」；中文写「(特典場)」而英文写「Special Screening」。
 *   只剥中文的话，英文标题会带着「Avengers: Endgame Encore」这种
 *   在中文侧已经去掉的尾巴，同一行中英不对称。
 *
 * ★ 与 FORMAT_TOKENS 的一处**故意不同**：这里多出影展/节目单元词
 *   （KINO / HKLGFF / NT Live / The Met …）。
 *   中文侧把这些写在**片名尾部**（「故鄉異客 (KINO)」），英文侧同样
 *   （「Trial of Hein (KINO)」），不剥就与中文行对不上。
 */
const EN_TITLE_NOISE_BRACKETS = [
  // 场次类型
  'Seat Cover Special Screening', 'Special Screening', 'Hi Bye Meet & Greet',
  // 语言版本（院线写法：Version 全拼 / Jap. 缩写 / bestar 的 (日))
  'Japanese Version', 'Cantonese Version', 'English Version', 'Mandarin Version', 'Korean Version',
  'Jap. Version', 'Can. Version', 'Cant. Version', 'Eng. Version',
  'Jap Version', 'Can Version', 'Cant Version', 'Eng Version',
  'Jap', 'Can', 'Cant', 'Eng', 'Chi', 'Mand',
  // 放映规格
  'IMAX with Laser', 'IMAX Laser', 'IMAX', 'MX4D', '4DX', 'CGS', 'LUXE',
  'Dolby Atmos', 'Dolby Cinema', 'Dolby', 'Atmos', 'ScreenX', 'Onyx', 'D-BOX',
  'RealD', 'THX', 'CINITY', 'Cinity',
  '2D', '3D', '35mm Film', '35mm', '70mm', '16mm',
  // 版本修饰 / 放映轮次
  '4K Restoration', '4K Restored Version', 'Restoration', 'Restored Version',
  'LIMITED', 'Limited', 'Live Viewing',
  //
  // ★ 这里**故意没有** Encore / 加碼重映。
  //   中文侧把「加碼重映」当版本标记剥掉（stripFormats），是因为
  //   中文片名读作「復仇者聯盟4：終局之戰 加碼重映」会把主标题撑得很长；
  //   但英文侧「Avengers: Endgame Encore」是这次重映的**官方英文名**，
  //   剥成「Avengers: Endgame」反而与院线物料/搜索结果对不上 ——
  //   用户给的参考图里写的正是「Avengers: Endgame Encore」。
  //   故英文侧保留 Encore（用户 2026-09-25 的截图即口径）。
  // 活动 / 影展 / 节目单元
  'Infinity Vision', 'bcSunday', 'bc30', 'APAAA', 'Diamond Hill',
  'KINO', 'GFF', 'HKLGFF', 'InDPanda', 'anifest', 'New Wave',
  'NT Live', 'The Met', 'The Royal Ballet', 'Paris Opera Ballet',
];

/**
 * 允许**裸词**（不在括号里）剥离的噪声词。
 *
 * ★ 为什么不能直接用上面那张表：里面有一批「本身就是常用词」的缩写 ——
 *   Can / Cant / Eng / Jap / Chi / Mand / 2D / 3D / Limited。
 *   它们在括号里是语言标记（「(Can)」= 粵語版），但裸着出现就是片名的一部分：
 *     「Can You Ever Forgive Me?」若把开头的 Can 剥掉，片名直接残缺。
 *   实测这些缩写在数据里**全部**出现在括号内（bestar 的「(日)/(粵)」、
 *   emperor 的「(Can. Version)」），所以裸词表把它们排除掉，功能不减、风险归零。
 */
const EN_TITLE_NOISE_BARE = [
  'Seat Cover Special Screening', 'Special Screening', 'Hi Bye Meet & Greet',
  'Japanese Version', 'Cantonese Version', 'English Version', 'Mandarin Version', 'Korean Version',
  'Jap. Version', 'Can. Version', 'Cant. Version', 'Eng. Version',
  'IMAX with Laser', 'IMAX Laser', 'IMAX', 'MX4D', '4DX', 'CGS', 'LUXE',
  'Dolby Atmos', 'Dolby Cinema', 'ScreenX', 'D-BOX', 'RealD', 'CINITY', 'Cinity',
  '35mm Film', '35mm', '70mm', '16mm',
  '4K Restoration', '4K Restored Version', 'Live Viewing',
  'Infinity Vision',
  // 同上：Encore 是官方英文名的一部分，保留（见括号词表里的说明）
];

const EN_NOISE_BRACKET_SORTED = [...EN_TITLE_NOISE_BRACKETS].sort((a, b) => b.length - a.length);
const EN_NOISE_BARE_SORTED = [...EN_TITLE_NOISE_BARE].sort((a, b) => b.length - a.length);
const EN_NOISE_BRACKET_SET = new Set(EN_TITLE_NOISE_BRACKETS);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 括号内容是不是纯噪声（版本 / 活动 / 影展 / 年份 / 罗马序号）
 *
 * 用**前缀**匹配而不是全等：院线会在同一个括号里再带年份或场次
 * （「(HKLGFF 2026)」「(NT Live 2026-27)」「(The Royal Ballet 2026 – 2027)」
 * 「(bc30 x APAAA)」），全等匹配会全部漏掉。
 *
 * 但**保留**片名自带的括号："Evangelion: Death (True)² & Rebirth" 的
 * (True)、"You Can (Not) Redo" 的 (Not) 都不是元数据 ——
 * 它们不在词表里，前缀也匹配不上，自然留下。
 */
function isEnglishNoiseToken(inner: string): boolean {
  const t = inner.trim().replace(/[.。·]+$/, '').trim();
  if (!t) return true;
  if (EN_NOISE_BRACKET_SET.has(t)) return true;
  // 年份 / 演出季区间（「(2026)」「(2026-27)」）
  if (/^\d{4}(\s*[-–—]\s*(\d{2}|\d{4}))?$/.test(t)) return true;
  // 罗马序号（英皇用「(IV)」标系列第四部）/ 纯数字（「(2)」）
  if (/^[IVX]{1,4}$/.test(t)) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  return EN_NOISE_BRACKET_SORTED.some((n) => new RegExp('^' + escapeRe(n) + '\\b', 'i').test(t));
}

/**
 * 英文片名的**展示用**清洗（保留原始大小写与括号，只去元数据）。
 *
 * ★ 与 stripFormats 的分工：
 *   stripFormats 处理中文片名，认的是中文词表（IMAX / 加碼重映 / 特典場…）。
 *   英文片名走这里 —— 两边词表不同（见 EN_TITLE_NOISE_BRACKETS 说明），
 *   拿 stripFormats 洗英文会漏掉 Encore / Special Screening / (KINO)。
 *
 * ★ 为什么不复用 normalizeTitle：那是**比较**用的（全小写、去标点、去重音），
 *   洗出来不能给人看（「Evangelion: Death (True)²」会变成
 *   「evangelion death true 2 rebirth」）。这里要的是给人看的标题。
 *
 * 用法上它是「组级展示名」的一半：
 *   详情页标题下方的英文副标题（components/MovieIntro.tsx）
 *   与 SEO 摘要（app/movie/[slug]/page.tsx）都读这个结果。
 */
export function stripEnglishTitleNoise(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  for (let i = 0; i < 6; i++) {
    const before = s;
    // 1) 整块剔掉纯噪声的括号（含括号本身）
    s = s.replace(/[（(\[【]\s*([^)）\]】]*)\s*[)）\]】]/g, (m, inner: string) =>
      isEnglishNoiseToken(inner) ? ' ' : m
    );
    // 2) 剔掉裸着的噪声词（「IMAX The Odyssey」这种前缀写法）
    for (const n of EN_NOISE_BARE_SORTED) {
      s = s.replace(new RegExp('(^|\\s)' + escapeRe(n) + '(?=\\s|$)', 'gi'), ' ');
    }
    s = s.replace(/\s{2,}/g, ' ').trim();
    if (s === before) break;
  }
  return (
    s
      // 全角标点归一（院线英文名里混着全角冒号/逗号）
      .replace(/：/g, ':')
      .replace(/，/g, ',')
      // 冒号两侧留一个空格：「Paw Patrol :The Dino Movie」→「Paw Patrol: The Dino Movie」
      .replace(/\s*:\s*/g, ': ')
      // 首尾残留的分隔符：只剩「 - 」的尾巴要收掉，但
      // 「…The Movie -Rebellion-」这种连字符是片名自带的，不能动
      .replace(/\s+[-–—]+$/, '')
      .replace(/^[-–—]+\s+/, '')
      .replace(/^[\s:·,;]+|[\s:·,;]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/**
 * 从片名中提取版本标签（用于展示）。
 * 返回去重、归一后的标签数组，如 ['IMAX', '4DX']
 */
export function extractFormats(name: string | null | undefined): string[] {
  if (!name) return [];
  const found = new Set<string>();

  for (const token of SORTED_FORMAT_TOKENS) {
    if (ACTIVITY_TAGS.has(token)) continue;
    if (tokenRegex(token).test(name)) {
      found.add(FORMAT_ALIAS[token] || token);
    }
  }
  // 标题归一时剥去周年修復標記，但放映版本仍须与普通版区分。
  for (const marker of normalizeText(name).match(ANNIVERSARY_RESTORATION_RE) || []) {
    found.add(marker.replace(/\s+/g, ''));
  }
  // 长短写法去重（'35mm' 与 '菲林版' 同命中时只留 '菲林版'）
  return [...new Set(dedupeOverlaps([...found]))];
}

/**
 * 括号里的方言缩写：「(日)」「(粵語)」「(日本語)」
 * 与 preprocessTitle 里那条剥除规则同源（那边是全局 replace，这边只做判定）。
 */
const DIALECT_SHORTHAND_RE = /[（(【\[]\s*[日粵國英韓台美陸法](?:語|語版|片)?\s*[)）】\]]/;

/**
 * 这些标记**不改变海报画面**，因此判定「原版海报」时要忽略它们。
 *
 * 分类依据是「会不会换图 / 压角标」，不是「算不算版本」：
 *   - 活动标签（Infinity Vision / bcSunday / 影展名…）：只是场次归类，物料同一套
 *   - 放映轮次（Encore / 重映 / 加碼重映 / Live Viewing）：同一套宣传物料
 *   - 场次类型（特典場 / 優先場 / 應援場 / 見面場）：同上
 *   - 2D / 3D：香港默认规格，没有专属物料
 *
 * ★ 为什么必须分开（实测案例，2026-09-21）：
 *   《復仇者聯盟4 加碼重映》整组**没有一条**不带标记的条目，
 *   若把「加碼重映」当成会换图的标记，整个原版档就空了，
 *   于是会跳到 IMAX 档 —— 而那张 IMAX 图是英文的
 *   「REASSEMBLE THE TEAM IN IMAX / ENDGAME ENCORE」通用物料；
 *   而「復仇者聯盟4 終局之戰 加碼重映」那张（MCU 神級英雄集結…9.24 見證傳奇）
 *   才是这次重映的香港官方海报。两者一对比，该选后者。
 *
 * 反例（必须算「非原版」）：IMAX / 4DX / 全景聲 / 菲林版 / 日語版 / 4K修復版…
 *   —— 这些会换图或压角标（实测：生化危機 IMAX 整张换成「FILMED FOR IMAX」
 *   街头奔跑图；CHIIKAWA 4DX 在画面上压了巨大的黄色 4DX 字）。
 */
const NON_ART_TOKENS = new Set<string>([
  ...ACTIVITY_TAGS,
  // 放映轮次
  'Encore', '重映', '加碼重映', '限定重映', 'Live Viewing',
  // 场次类型
  '特典應援場', '特典場', '特典场', '特別放映', '特别放映', '特別上映', '特别上映',
  '優先場', '應援場', '中秋特典場', '椅套特典場',
  '椅套', '見面場', 'Hi Bye Meet & Greet', '期間限定', 'LIMITED',
  // 影展 / 节目单元
  'HKLGFF', 'GFF', 'KINO', 'InDPanda', 'anifest動画藝術祭', 'New Wave',
]);

/** 不改变画面的格式标记（从 SORTED_FORMAT_TOKENS 里刨掉 NON_ART_TOKENS） */
const ART_FORMAT_TOKENS = SORTED_FORMAT_TOKENS.filter((t) => !NON_ART_TOKENS.has(t));

/**
 * 片名里是否带着**会改变海报画面**的版本 / 语言标记。
 *
 * ★ 与 isBaseVersion 的区别（2026-09-21 选海报时发现的坑）：
 *
 *   isBaseVersion 的口径是「先剥离，再看剩下什么」，而 preprocessTitle
 *   会顺手剥掉括号里的方言缩写与场次主题词 —— 于是 bestar 的
 *   「劇場版 CHIIKAWA 人魚島的秘密 (日)」被判成「原版」
 *   （extractFormats 返回空数组），可那张图上明明印着
 *   「日語版 JAPANESE VERSION」大横幅，和 broadway 的「(日語版)」是同一套物料。
 *
 *   分组必须保持宽松（(日) 与 (日語版) 要能合并，见 probe/check-danger.mts
 *   的 must 列表），所以 isBaseVersion 不能改；
 *   但「挑一张最像官方原版的封面」需要严格：带标记的条目直接出局。
 *
 * 与 hasFormatMarker 的区别：本函数是宽松口径（先剥离再判定），
 *   专供分组使用；选海报请用 hasFormatMarker。
 *
 * 判定的是**原始片名**（只做 NFKC 正规化），不经过任何剥离。
 */
export function hasFormatMarker(name: string | null | undefined): boolean {
  if (!name) return false;
  const raw = normalizeText(name);
  if (DIALECT_SHORTHAND_RE.test(raw) || raw.match(ANNIVERSARY_RESTORATION_RE)) return true;
  // 注意传 'i' 而不是默认的 'gi'：带 g 的正则 test() 会记 lastIndex，
  // 同一个 token 第二次判定就会漏。
  return ART_FORMAT_TOKENS.some((t) => tokenRegex(t, 'i').test(raw));
}

/**
 * 是否为「原版」（无格式标记）
 *
 * ★ 口径是「先剥离，再看剩下什么」，因此**偏宽松**：
 *   「劇場版 CHIIKAWA 人魚島的秘密 (日)」也会返回 true。
 *   这是分组需要的（(日) 必须与 (日語版) 归一），不要为了选海报收紧它 ——
 *   需要严格判定时用 hasFormatMarker。
 */
export function isBaseVersion(name: string | null | undefined): boolean {
  return extractFormats(name).length === 0;
}

/** 版本标签的展示顺序（越靠前越"高级"） */
const FORMAT_ORDER = [
  'IMAX',
  'Dolby',
  'Cinity',
  'LUXE',
  'MX4D',
  '4DX',
  'ScreenX',
  'Onyx',
  'D-BOX',
  'CGS',
  'RealD',
  'THX',
  'ATMOS',
  '全景聲',
  '杜比',
  '巨幕',
  '動感影院',
  '特典場',
  '優先場',
  '應援場',
  '中秋特典場',
  '見面場',
  '導演剪輯版',
  '4K修復版',
  '菲林版',
  '日語版',
  '英語版',
  '粵語版',
  '國語版',
  '原聲版',
  '加長版',
  '特別版',
];

export function sortFormats(formats: string[]): string[] {
  return [...formats].sort((a: string, b: string) => {
    const ia = FORMAT_ORDER.indexOf(a);
    const ib = FORMAT_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

/**
 * 语言版本标记 → 展示用语言名
 *
 * 与 NON_ART_TOKENS 不同：这些标记**确实是「版本」的一部分**
 * （日語版 / 粵語版 是不同场次），只是展示时要换写成语言名。
 */
const LANGUAGE_TOKENS: Record<string, string> = {
  日語版: '日語',
  英語版: '英語',
  粵語版: '粵語',
  國語版: '國語',
  原聲版: '原聲',
};

/**
 * 放映规格标签：从版本标签里挑出**真正描述「怎么放」**的那些。
 *
 * 排除两类：
 *   - 活动标记（重映 / 特典場 / 應援場 / 影展名…）：只是场次归类，不是放映规格
 *   - 语言标记（日語版 / 粵語版…）：语言单独展示在中行的「·语言」位置
 */
export function projectionFormats(formats: string[]): string[] {
  return formats.filter((f) => !NON_ART_TOKENS.has(f) && !(f in LANGUAGE_TOKENS));
}

/** 版本标签里的语言（日語版 → 日語）；没有则返回 null */
export function versionLanguage(formats: string[]): string | null {
  for (const f of formats) if (LANGUAGE_TOKENS[f]) return LANGUAGE_TOKENS[f];
  return null;
}

/**
 * 场次卡片中行的「影片版本·语言」文案（用户 2026-09-21 指定）。
 *
 * 取代原先的影厅名 —— 影厅名（「1院」「House 1」）对选场次几乎没帮助，
 * 而「这场是 IMAX 还是原版、什么语言」才是用户真正要看的。
 *
 * 语言取值优先级（用户确认）：
 *   1. 版本自带的语言标记（日語版 → 日語）—— 它比影片整体语言更准确
 *   2. 影片本身的对白语言（buildIntro 的 spoken）
 *
 * 四种组合的实测结果：
 *   IMAX + 影片英語        → "IMAX·英語"
 *   4DX + 日語版           → "4DX·日語"
 *   粵語版（无放映规格）      → "粵語版"（语言已在版本里，不再重复后缀）
 *   原版 + 影片英語        → "原版·英語"
 *
 * 「加碼重映」「特典場」这类活动标记会被丢掉 —— 它们不影响「怎么放」。
 */
export function formatVersionText(
  formats: string[],
  filmLanguage: string | null
): string {
  const proj = projectionFormats(formats).map(formatLabel);
  const fromMarker = versionLanguage(formats);
  const lang = fromMarker ?? filmLanguage;

  if (proj.length) return lang ? `${proj.join(' + ')}·${lang}` : proj.join(' + ');
  // 无放映规格：语言标记本身就是版本（「粵語版」），不再缀语言
  if (fromMarker) return `${fromMarker}版`;
  return lang ? `原版·${lang}` : '原版';
}

/** 版本标签的显示名（补上"版"字更自然） */
export function formatLabel(fmt: string): string {
  const map: Record<string, string> = {
    IMAX: 'IMAX',
    '4DX': '4DX',
    MX4D: 'MX4D',
    LUXE: 'LUXE',
    Dolby: '杜比全景聲',
    全景聲: '全景聲',
    CGS: 'CGS',
    RealD: 'RealD 3D',
    THX: 'THX',
    Onyx: 'Onyx LED',
    ScreenX: 'ScreenX',
    'D-BOX': 'D-BOX',
    特典場: '特典場',
    優先場: '優先場',
    應援場: '應援場',
    '4K修復版': '4K 修復版',
    菲林版: '35mm 菲林版',
  };
  return map[fmt] || fmt;
}
