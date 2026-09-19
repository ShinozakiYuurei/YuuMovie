/**
 * 语言 / 字幕的中文表述
 *
 * 为什么需要：院线数据里语言字段是**英文**（broadway.dialect = "Cantonese,Mandarin"、
 * subtitle = "Chinese,English"），而整站界面是中文 —— 直接展示会出现
 * 「語言：Cantonese,Mandarin（Chinese,English）」这种中英夹杂。
 * 去掉豆瓣评分后，中文「語言」就没有别的来源了，只能自己映射。
 *
 * 映射表按 broadway 实际出现过的语种整理（见 data/movies.json 的 dialect 取值），
 * 未收录的**原样返回** —— 宁可看到英文，也不要显示空白或猜错。
 */

const LANG_ZH: Record<string, string> = {
  english: '英語',
  japanese: '日語',
  cantonese: '粵語',
  mandarin: '普通話',
  korean: '韓語',
  german: '德語',
  french: '法語',
  spanish: '西班牙語',
  italian: '意大利語',
  russian: '俄語',
  portuguese: '葡萄牙語',
  hindi: '印地語',
  thai: '泰語',
  vietnamese: '越南語',
  malay: '馬來語',
  indonesian: '印尼語',
  tagalog: '他加祿語',
  persian: '波斯語',
  farsi: '波斯語',
  arabic: '阿拉伯語',
  hebrew: '希伯來語',
  turkish: '土耳其語',
  romanian: '羅馬尼亞語',
  latvian: '拉脫維亞語',
  danish: '丹麥語',
  faroese: '法羅語',
  dutch: '荷蘭語',
  polish: '波蘭語',
  swedish: '瑞典語',
  norwegian: '挪威語',
  finnish: '芬蘭語',
  czech: '捷克語',
  greek: '希臘語',
  hungarian: '匈牙利語',
  ukranian: '烏克蘭語',
  bengali: '孟加拉語',
  tamil: '泰米爾語',
  punjabi: '旁遮普語',
  urdu: '烏爾都語',
  swahili: '斯瓦希里語',
  afrikaans: '南非荷蘭語',
  icelandic: '冰島語',
  irish: '愛爾蘭語',
  basque: '巴斯克語',
  catalan: '加泰羅尼亞語',
  // 中国方言/其它写法（broadway 用 "Shanghai" 指吳語、"Teochew" 指潮州話）
  shanghai: '吳語',
  teochew: '潮州話',
  hokkien: '閩南語',
  taiwanese: '閩南語',
  zh: '中文',
  en: '英語',
  yue: '粵語',
  cmn: '普通話',
};

const SUBTITLE_ZH: Record<string, string> = {
  chinese: '中文',
  english: '英文',
  cantonese: '粵語',
  traditional: '繁體',
  simplified: '簡體',
  none: '無',
  'no subtitle': '無字幕',
};

const norm = (s: string) => s.trim().toLowerCase();

/** 「Cantonese,Mandarin」→「粵語 / 普通話」；未收录的原样保留 */
export function zhLanguages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,、;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => LANG_ZH[norm(s)] || s);
}

/** 字幕：同样映射，并剔除「无字幕」这类无信息值 */
export function zhSubtitles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = norm(raw);
  if (t === 'no subtitle' || t === 'none' || t === '無字幕') return [];
  return raw
    .split(/[,、;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => SUBTITLE_ZH[norm(s)] || zhLanguages(s)[0] || s);
}
