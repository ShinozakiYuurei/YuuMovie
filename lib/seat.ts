/**
 * 座位余量 → 颜色标记
 *
 * ===== 分档依据（实测 hkmovie6，非猜测）=====
 *
 * hkmovie6 的时间卡片用内联 background-color 标记余座，
 * 其内部字段 `attendance` 是**入座率**（已售占比）。
 * 我们抓取 211 部电影的 SSR 载荷，把 `attendance` 与渲染出的颜色
 * 逐一配对（189 个有效样本），得到的分档边界：
 *
 *   attendance ≤ 0.30  → #039704（绿）   剩余 ≥ 70%   样本 80
 *   0.31 – 0.79        → #ec7e0a（橙）   剩余 21–69%  样本 87
 *   ≥ 0.81             → #ff0000（红）   剩余 ≤ 19%   样本 22
 *   滿座               → #7D0900（深红）              样本 18
 *
 * 边界非常干净，无歧义：
 *   0.30 → 绿 / 0.31 → 橙      （0.305 附近无样本）
 *   0.79 → 橙 / 0.81 → 红      （0.80 整未出现过）
 *
 * 换算成「剩余可选率」（本项目用的口径）：
 *   绿 ≥ 0.70、橙 0.21–0.69、红 ≤ 0.19、满座独立深红
 *
 * ===== 为什么用剩余率而不是入座率 =====
 * 用户关心的是「还有多少位置可选」，而不是「卖了多少」。
 * 两者互补（remain = 1 - attendance），阈值已按上式换算。
 */

/** 余座档位 */
export type SeatLevel = 'plenty' | 'limited' | 'few' | 'soldout';

/**
 * 档位阈值（按「剩余可选率」）
 *
 * ⚠️ 采用用户指定的阈值，而非 hkmovie6 实测值：
 *   用户要求：绿 ≥ 50%、黄 20%~30%、红 < 20%
 *   实测 hkmovie6：绿 ≥ 70%、橙 21%~69%、红 ≤ 19%
 *
 * 用户描述的「黄 20%~30%」留下 30%~50% 的空档，
 * 这里把黄色上界扩展到 50% 以覆盖全部区间（避免出现无颜色场次）：
 *
 *   绿：剩余 ≥ 50%
 *   黄：剩余 20% ~ 50%
 *   红：剩余 < 20%
 *
 * 色值仍沿用 hkmovie6 实测（#039704 / #ec7e0a / #ff0000），
 * 其中的橙色 #ec7e0a 即用户所说的「黄」档。
 */
export const SEAT_THRESHOLDS = {
  /** 剩余率 ≥ 此值 → 绿 */
  plenty: 0.5,
  /** 剩余率 ≥ 此值（且 < plenty）→ 黄/橙；低于此值 → 红 */
  limited: 0.2,
} as const;

/**
 * 档位 → 样式
 *
 * 色值直接取自 hkmovie6 实测的十六进制，
 * 保证与用户参照的站点视觉一致。
 */
export const SEAT_STYLE: Record<
  SeatLevel,
  { bg: string; border: string; text: string; label: string; dot: string }
> = {
  plenty: {
    bg: '#039704',
    border: '#039704',
    text: '#ffffff',
    label: '餘座充足',
    dot: '#039704',
  },
  limited: {
    bg: '#ec7e0a',
    border: '#ec7e0a',
    text: '#ffffff',
    label: '餘座緊張',
    dot: '#ec7e0a',
  },
  few: {
    bg: '#ff0000',
    border: '#ff0000',
    text: '#ffffff',
    label: '餘座少量',
    dot: '#ff0000',
  },
  soldout: {
    bg: '#7D0900',
    border: '#7D0900',
    text: '#ffffff',
    label: '滿座',
    dot: '#7D0900',
  },
};

/**
 * 计算余座档位
 *
 * @param remainRate 剩余可选率（0–1）；null / undefined 表示无数据
 * @param soldOut    是否为满座（部分源直接给出「滿座」标记）
 */
export function seatLevel(
  remainRate: number | null | undefined,
  soldOut?: boolean
): SeatLevel | null {
  if (soldOut) return 'soldout';
  if (remainRate == null || !Number.isFinite(remainRate)) return null;
  if (remainRate <= 0) return 'soldout';
  if (remainRate >= SEAT_THRESHOLDS.plenty) return 'plenty';
  if (remainRate >= SEAT_THRESHOLDS.limited) return 'limited';
  return 'few';
}

/** 剩余率的展示文本（百分比取整） */
export function remainLabel(remainRate: number | null | undefined): string | null {
  if (remainRate == null || !Number.isFinite(remainRate)) return null;
  return `${Math.round(remainRate * 100)}%`;
}
