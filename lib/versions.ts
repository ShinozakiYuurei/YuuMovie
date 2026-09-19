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
      // 场次修饰词（含前面的活动主题名）
      .replace(SCREENING_PREFIX_RE, ' ')
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
  // 长短写法去重（'35mm' 与 '菲林版' 同命中时只留 '菲林版'）
  return [...new Set(dedupeOverlaps([...found]))];
}

/** 是否为「原版」（无格式标记） */
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
