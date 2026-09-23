/**
 * 戲院「影廳規格」推斷
 *
 * ===== 为什么需要推断，而不是读字段 =====
 *
 * 五个抓取源都没有「这间戲院有哪些规格影厅」这个字段：
 *   - 百老匯 / Cinema City 的影厅名就叫「1院」「2院」，不含任何规格信息
 *   - MCL 把规格写进影厅名（「LUXE」「IMAX/12院」「Onyx Cinema LED」）或场次版本（「2D 全景聲 英語」）
 *   - 英皇 / 星達写进场次版本（「IMAX2D」「ATMOS2D」「DBOX2D」）
 *   - 百老匯的规格只在**片名**里（「IMAX 生化危機」「4DX 沙丘」）
 *
 * 于是规格只能从三处证据合成：影厅名 + 场次版本 + 片名。
 * 这与 lib/region.ts / lib/cinema-names.ts 同一套理由 ——
 * 「戲院 → 规格」是**纯函数**，只取决于戲院本身与它在放的场次，
 * 放在读取层意味着改规则表只需重启，不必重跑抓取。
 *
 * ===== 三处证据的可靠性（实测，2026-09-21） =====
 *
 * 片名证据看似危险（「IMAX 生化危機」在普通厅放也会命中），
 * 但实测不会误判 —— 院线只为**真有该规格的戲院**建格式条目：
 *   4DX  → 只有 GALA CINEMA（朗豪坊）1院 与 B+ cinema apm（觀塘）6院
 *   IMAX → 只有 K11 / YOHO MALL / iSQUARE / MOKO / 澳門葡京人
 * 这些正是香港实际拥有该规格的戲院。反之，若不看片名，
 * 百老匯系的 IMAX / 4DX / 全景聲 就全都识别不出来（它的影厅名只有「5院」）。
 *
 * ===== 为什么把「特色影廳」也列进来 =====
 *
 * the CORONET（英皇）/ MOViEMAXX / MM Plus（百老匯）/ Vivo（星達）/
 * House FX / White Box / Black Box（MCL）都是院线自有的**品牌影厅**，
 * 与 IMAX 一样属于用户会主动去找的规格，因此一并作为筛选项，
 * 只是在面板里用分组标题与「放映格式」区分开。
 */

/** 规格分组：放映格式（通用） / 特色影廳（院线自有品牌厅） */
export type SpecGroup = 'format' | 'premium';

export const SPEC_GROUP_LABEL: Record<SpecGroup, string> = {
  format: '放映格式',
  premium: '特色影廳',
};

interface SpecRule {
  key: string;
  label: string;
  group: SpecGroup;
  /** 命中规则（对三处证据分别测试，大小写不敏感） */
  re: RegExp;
  /**
   * 允许从哪些证据推断。
   *
   * 品牌影厅只认**影厅名**：它们是院线给自家厅起的名字，
   * 绝不会出现在片名或场次版本里，若也去测片名只会平添误判面。
   */
  fields: ('house' | 'version' | 'title')[];
}

/** 展示顺序：先放映格式，再特色影廳；组内按「越硬核越靠前」 */
const SPEC_RULES: SpecRule[] = [
  // ---------- 放映格式 ----------
  { key: 'imax', label: 'IMAX', group: 'format', re: /imax/i, fields: ['house', 'version', 'title'] },
  {
    key: 'atmos',
    label: '杜比全景聲',
    group: 'format',
    // 三源写法：ATMOS2D（英皇/星達）、全景聲（MCL）、杜比（片名）
    re: /atmos|全景聲|全景声|杜比/i,
    fields: ['house', 'version', 'title'],
  },
  { key: '4dx', label: '4DX', group: 'format', re: /4dx/i, fields: ['house', 'version', 'title'] },
  { key: 'mx4d', label: 'MX4D', group: 'format', re: /mx4d/i, fields: ['house', 'version', 'title'] },
  { key: 'luxe', label: 'LUXE', group: 'format', re: /luxe/i, fields: ['house', 'version', 'title'] },
  { key: 'onyx', label: 'Onyx LED', group: 'format', re: /onyx/i, fields: ['house', 'version', 'title'] },
  { key: 'reald', label: 'RealD 3D', group: 'format', re: /reald/i, fields: ['house', 'version', 'title'] },
  { key: 'dbox', label: 'D-BOX', group: 'format', re: /d-?box/i, fields: ['house', 'version', 'title'] },
  { key: 'thx', label: 'THX', group: 'format', re: /\bthx\b/i, fields: ['house', 'version', 'title'] },
  { key: 'cgs', label: 'CGS', group: 'format', re: /\bcgs\b/i, fields: ['house', 'version', 'title'] },
  { key: 'screenx', label: 'ScreenX', group: 'format', re: /screenx/i, fields: ['house', 'version', 'title'] },
  { key: 'cinity', label: 'Cinity', group: 'format', re: /cinity/i, fields: ['house', 'version', 'title'] },
  // Broadway Cinema Centre officially identifies Hall 1 as SR and Halls 2–4 as SRD.
  // These are not included in show metadata, so cinema-level evidence is added in data.ts.
  { key: 'sr', label: 'SR', group: 'format', re: /^sr$/i, fields: ['house'] },
  { key: 'srd', label: 'SRD', group: 'format', re: /^srd$/i, fields: ['house'] },

  // ---------- 特色影廳（只认影厅名） ----------
  { key: 'coronet', label: 'the CORONET', group: 'premium', re: /coronet/i, fields: ['house'] },
  { key: 'moviemaxx', label: 'MOViEMAXX', group: 'premium', re: /moviemaxx/i, fields: ['house'] },
  { key: 'mmplus', label: 'MM Plus', group: 'premium', re: /\bmm plus\b/i, fields: ['house'] },
  { key: 'housefx', label: 'House FX', group: 'premium', re: /house fx/i, fields: ['house'] },
  { key: 'whitebox', label: 'White Box', group: 'premium', re: /white box/i, fields: ['house'] },
  { key: 'blackbox', label: 'Black Box', group: 'premium', re: /black box/i, fields: ['house'] },
  { key: 'familyhouse', label: 'Family House', group: 'premium', re: /family house/i, fields: ['house'] },
  { key: 'festivalsuite', label: 'Festival Suite', group: 'premium', re: /festival suite/i, fields: ['house'] },
  { key: 'vivo', label: 'Vivo', group: 'premium', re: /\bvivo\b/i, fields: ['house'] },
  { key: 'ovaloffice', label: 'The Oval Office', group: 'premium', re: /the oval office/i, fields: ['house'] },
  { key: 'mmmoments', label: 'MM MOMENTS', group: 'premium', re: /\bmm moments\b/i, fields: ['house'] },
];

/** 全部规格（展示顺序） */
export const HALL_SPECS: { key: string; label: string; group: SpecGroup }[] = SPEC_RULES.map(
  ({ key, label, group }) => ({ key, label, group })
);

const SPEC_INDEX = new Map(SPEC_RULES.map((r, i) => [r.key, i]));
const SPEC_LABEL = new Map(SPEC_RULES.map((r) => [r.key, r.label]));
const SPEC_GROUP = new Map(SPEC_RULES.map((r) => [r.key, r.group]));

export function specLabel(key: string): string {
  return SPEC_LABEL.get(key) ?? key;
}

export function specGroup(key: string): SpecGroup | null {
  return SPEC_GROUP.get(key) ?? null;
}

/** 按 SPEC_RULES 的展示顺序排序（未知 key 排最后） */
export function sortSpecs(keys: string[]): string[] {
  return [...keys].sort((a, b) => (SPEC_INDEX.get(a) ?? 999) - (SPEC_INDEX.get(b) ?? 999));
}

/**
 * 从一条场次的三处证据推断所属戲院的规格
 *
 * @param input.houseName 影厅名（如「IMAX/12院」「LUXE」「1院」）
 * @param input.version   场次版本（如「IMAX2D」「2D 全景聲 英語」）
 * @param input.title     影片名（如「IMAX 生化危機」「4DX 沙丘」）
 */
export function hallSpecsOf(input: {
  houseName?: string | null;
  version?: string | null;
  title?: string | null;
}): string[] {
  const hay: Record<'house' | 'version' | 'title', string> = {
    house: input.houseName ?? '',
    version: input.version ?? '',
    title: input.title ?? '',
  };

  const out: string[] = [];
  for (const rule of SPEC_RULES) {
    for (const f of rule.fields) {
      if (hay[f] && rule.re.test(hay[f])) {
        out.push(rule.key);
        break;
      }
    }
  }
  return out;
}
