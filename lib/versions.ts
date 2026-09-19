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
  // 场次类型
  '特典應援場',
  '特典場',
  '特典场',
  '優先場',
  '應援場',
  '中秋特典場',
  // 版本修饰
  '導演剪輯版',
  '导演剪辑版',
  '4K修復版',
  '4K 修復版',
  '2K無字幕版',
  '日語版',
  '英語版',
  '粵語版',
  '國語版',
  '原聲版',
  '加長版',
  '特別版',
  // 放映格式：emperor 会写成「(2D) 片名」，未识别时会单独成组
  '2D',
  '3D',
  // 放映轮次：属于「版本」而非不同电影（broadway 常写「…(ENCORE)」，MCL/英皇不带）
  'Encore',
  '重映',
  '加碼重映',
  'Live Viewing',
];
/** 这些只是活动标签，不作为「版本」展示给用户 */
const ACTIVITY_TAGS = new Set([
  'Infinity Vision',
  'bcSunday',
  'bc30',
  'APAAA',
  'Diamond Hill',
]);

/** 版本别名归一 */
const FORMAT_ALIAS: Record<string, string> = {
  全景声: '全景聲',
  'IMAX with Laser': 'IMAX',
  'IMAX Laser': 'IMAX',
  'Dolby Atmos': 'Dolby',
  'Dolby Cinema': 'Dolby',
  CINITY: 'Cinity',
  '特典场': '特典場',
};

/** 去掉各种括号包裹 */
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
  return s.replace(/\b(?:19|20)\d{2}\b/g, ' ');
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
  let s = stripYear(normalizeText(stripBrackets(name)));

  // 反复剥离，直到稳定（处理 "IMAX 4DX xxx" 这类叠加）
  let prev;
  let guard = 0;
  do {
    prev = s;
    for (const token of FORMAT_TOKENS) {
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

  // 去掉首尾孤立的单字母（剥离残留）
  s = s.replace(/^[a-z]\s+|\s+[a-z]$/g, '').trim();

  return s;
}

/**
 * 从片名中剥离格式标记，保留原始大小写与标点（用于展示）。
 * 与 normalizeTitle 的区别：后者用于比较（全小写、去标点）。
 */
export function stripFormats(name: string | null | undefined): string {
  if (!name) return '';
  // 与 normalizeTitle 保持一致：文字正规化 + 去掉年份（展示名也不该带 (2026)）
  let s = stripYear(normalizeText(stripBrackets(name)));

  let prev;
  let guard = 0;
  do {
    prev = s;
    for (const token of FORMAT_TOKENS) {
      const isAscii = /^[\x00-\x7F]+$/.test(token);
      if (isAscii) {
        s = s.replace(tokenRegex(token), (m, p1) => p1 + ' ');
      } else {
        s = s.replace(tokenRegex(token), ' ');
      }
    }
  } while (s !== prev && ++guard < 10);

  return s
    .replace(/\s+[xX×]\s+/g, ' ')
    .replace(/\s*[：:]\s*$/g, '')
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

  for (const token of FORMAT_TOKENS) {
    if (ACTIVITY_TAGS.has(token)) continue;
    if (tokenRegex(token).test(name)) {
      found.add(FORMAT_ALIAS[token] || token);
    }
  }
  return [...found];
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
  '導演剪輯版',
  '4K修復版',
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
  };
  return map[fmt] || fmt;
}
