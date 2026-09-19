/**
 * 戲院大區 / 十八區推斷
 *
 * ===== 为什么在读取层而不是抓取层做 =====
 *
 * hkmovie6 的戲院页与場次页支持三级地理筛选：
 *   地區（香港 / 九龍 / 新界 / 澳門）→ 區域（十八區）
 *
 * 我们的抓取源**都没有**这两个字段：
 *   - icirena 有 cityName，但只在 filmschedule.list 里，且值不稳定
 *   - broadway / MCL 的 cinemas 数据完全不含地理分区
 *
 * 推断逻辑是「戲院名 + 地址 → 地理归属」的**纯函数**，
 * 结果只取决于戏院本身，与抓取时点无关。
 * 因此放在读取层（lib/）而非抓取层：
 *   - 不必改抓取器，也不必为它重抓数据
 *   - 映射表改动后重启即生效，无需重跑抓取
 *
 * ===== 推断策略 =====
 *   1. **地址前缀**最可靠 —— 香港地址习惯以「香港 / 九龍 / 新界」开头，
 *      实测 41 間戲院中 37 間可直接命中
 *   2. 剩下 4 間（旺角、柴灣、荃灣、西九龍）用人工表补齐
 *   3. 十八區用「戲院名 → 區域」的人工映射（戲院总数少且稳定，41 条足够）
 *
 * 为什么不用关键词匹配地址里的地名：
 *   「香港九龍旺角太子道西」这类地址同时含「香港」和「九龍」，
 *   关键词匹配会误判。前缀法 + 人工表最稳。
 */

import type { Region } from './types';

/** 十八區（与 hkmovie6「所有區域」下拉一致） */
export const DISTRICTS = [
  '中西區',
  '東區',
  '南區',
  '灣仔區',
  '九龍城區',
  '觀塘區',
  '深水埗區',
  '黃大仙區',
  '油尖旺區',
  '離島區',
  '葵青區',
  '北區',
  '西貢區',
  '沙田區',
  '大埔區',
  '荃灣區',
  '屯門區',
  '元朗區',
] as const;

export type District = (typeof DISTRICTS)[number];

/** 大區展示顺序 */
export const REGION_ORDER: Region[] = ['香港', '九龍', '新界', '澳門'];

/**
 * 人工兜底：地址不以「香港/九龍/新界/澳門」开头，或前缀法会误判的戲院
 * 键为戲院名（与 data/cinemas.json 的 nameZh 完全一致）
 */
const CINEMA_OVERRIDE: Record<string, Region> = {
  'GALA CINEMA (朗豪坊)': '九龍', // 地址以「旺角」开头
  '柴灣,永利中心 Chai Wan, Winner Centre': '香港', // 地址以「柴灣」开头
  '荃灣, 愉景新城 Tsuen Wan, Candy Park': '新界', // 地址以「荃灣」开头
  'the sky': '九龍', // 地址以「西九龍」开头
  澳門葡京人: '澳門',
};

/**
 * 戲院名 → 十八區
 *
 * 为什么按「戲院名」而不是「戲院 id」：
 *   id 含院线前缀，各院线命名规则不同；戲院名跨源唯一且可读，
 *   出问题时一眼能看出错在哪。澳门不在十八區内，故不在此表。
 */
const CINEMA_DISTRICT: Record<string, string> = {
  // ---------- 百老匯 ----------
  'MOViE MOViE Pacific Place (金鐘)': '中西區',
  'MOViE MOViE Cityplaza (太古城)': '東區',
  'PALACE ifc': '中西區',
  'GALA CINEMA (朗豪坊)': '油尖旺區',
  'PREMIERE ELEMENTS': '油尖旺區',
  'B+ cinema MOKO (旺角東)': '油尖旺區',
  'B+ cinema apm (觀塘)': '觀塘區',
  電影中心: '油尖旺區',
  旺角: '油尖旺區',
  'MY CINEMA YOHO MALL': '元朗區',
  葵芳: '葵青區',
  荃灣: '荃灣區',
  嘉湖: '元朗區',

  // ---------- MCL ----------
  'K11 ART HOUSE (尖東站)': '油尖旺區',
  'MCL AIRSIDE 戲院 (啟德)': '九龍城區',
  'MCL 數碼港戲院': '南區',
  'MOVIE TOWN (新城市廣場)': '沙田區',
  'MCL 德福戲院': '觀塘區',
  'MCL 東薈城戲院': '離島區',
  'FESTIVAL GRAND CINEMA (又一城)': '深水埗區',
  'MCL THE ONE 戲院': '油尖旺區',
  皇室戲院: '灣仔區',
  'STAR CINEMA (將軍澳站)': '西貢區',
  'MCL 新都城戲院(寶琳站)': '西貢區',
  'MCL 粉嶺戲院 (逸峯廣場)': '北區',
  'MCL 長沙灣戲院': '深水埗區',
  'MCL 淘大戲院': '觀塘區',

  // ---------- 英皇 ----------
  銅鑼灣時代廣場: '灣仔區',
  中環娛樂行: '中西區',
  '黃竹坑 THE SOUTHSIDE': '南區',
  尖沙咀iSQUARE: '油尖旺區',
  大圍圍方: '沙田區',
  荃灣荃新天地: '荃灣區',
  將軍澳康城: '西貢區',
  屯門新都商場: '屯門區',

  // ---------- Cinema City ----------
  '柴灣,永利中心 Chai Wan, Winner Centre': '東區',
  '荃灣, 愉景新城 Tsuen Wan, Candy Park': '荃灣區',

  // ---------- 星達 ----------
  'the sky': '油尖旺區',
  StagE: '屯門區',
  'GH TaiPo': '大埔區',
};

/** 由地址前缀推断大區（香港地址惯例） */
function regionFromAddress(address: string): Region | null {
  const a = (address || '').trim();
  if (!a) return null;
  if (a.startsWith('香港')) return '香港';
  if (a.startsWith('九龍') || a.startsWith('九龙')) return '九龍';
  if (a.startsWith('新界')) return '新界';
  if (a.startsWith('澳門') || a.startsWith('澳门')) return '澳門';
  return null;
}

/**
 * 推断戲院的地理归属
 * 优先级：人工兜底表 > 地址前缀
 */
export function inferGeo(
  nameZh: string,
  address: string
): { region: Region | null; district: string | null } {
  // 戲院名可能带首尾空白 / 换行（MCL 的「MCL THE ONE 戲院\n」实测如此），
  // 不规范化会导致查表失败
  const name = (nameZh || '').trim();
  const region = CINEMA_OVERRIDE[name] ?? regionFromAddress(address);
  const district = CINEMA_DISTRICT[name] ?? null;
  return { region, district };
}

/** 十八區展示顺序（按 DISTRICTS 定义序） */
export function districtOrder(district: string): number {
  const i = (DISTRICTS as readonly string[]).indexOf(district);
  return i < 0 ? 999 : i;
}
