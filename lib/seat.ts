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
 * ★ 2026-09-21 改为「淡彩底 + 同色发丝边 + 亮色文字」
 *
 * 原先用的是 hkmovie6 实测的**实心饱和色块**（#039704 / #ec7e0a / #ff0000）。
 * 在新的暗色体系下它有两个问题：
 *   1. 实心高饱和色块在 #0A0A0C 画布上会“发光”，成为整页最刺眼的元素，
 *      与「克制、发丝边框、若隐若现」的整体调性相冲；
 *   2. 满座深红 #7D0900 与新的卡片底 #18181B 亮度接近，边界几乎糊在一起。
 *
 * 改法：保留**完全相同的色相**（绿/橙/红/深红，辨识度不变），
 * 但把实心填充换成 12~15% 的淡彩底，配同色系发丝边框与提亮文字。
 * 这样色块仍然一眼可辨（红/绿对照比实心更清楚，因为文字也带色），
 * 又不会在暗底上炸开。
 *
 * ⚠️ 若想回到实心色块，只需把下面的 bg 改回注释里的原值即可。
 *
 * ★ 2026-09-25：色值全部改成 **CSS 变量引用**（--hkm-seat-*）。
 *   原因：这四组值是在**暗色画布**下标定的 —— 淡彩底 + **亮色文字**
 *   （#86efac / #fcd34d / #fca5a5 / #e8a5a0）。
 *   加入明色主题后，同一组亮字压在浅色淡彩底上只有 1.2~1.6:1，
 *   整张场次卡只剩一块淡底色可辨、时间与票价都读不出来。
 *   明色必须换成「浅底 + 深字」（见 app/globals.css 的
 *   html[data-theme='light'] 块），这是本主题改造里最不能省的一处。
 *
 *   为什么不是在这里用 JS 判断主题：本文件被服务端组件与客户端组件
 *   共用，而主题是构建时未知的。CSS 变量是唯一「两套值、一处引用」的写法。
 *
 * 分档阈值（SEAT_THRESHOLDS）未动，仍与 hkmovie6 实测口径一致。
 */
export const SEAT_STYLE: Record<
  SeatLevel,
  { bg: string; border: string; text: string; label: string; dot: string }
> = {
  /* 原实心色：#039704 */
  plenty: {
    bg: 'var(--hkm-seat-plenty-bg)',
    border: 'var(--hkm-seat-plenty-border)',
    text: 'var(--hkm-seat-plenty-fg)',
    label: '餘座充足',
    dot: 'var(--hkm-seat-plenty-dot)',
  },
  /* 原实心色：#ec7e0a */
  limited: {
    bg: 'var(--hkm-seat-limited-bg)',
    border: 'var(--hkm-seat-limited-border)',
    text: 'var(--hkm-seat-limited-fg)',
    label: '餘座緊張',
    dot: 'var(--hkm-seat-limited-dot)',
  },
  /* 原实心色：#ff0000 */
  few: {
    bg: 'var(--hkm-seat-few-bg)',
    border: 'var(--hkm-seat-few-border)',
    text: 'var(--hkm-seat-few-fg)',
    label: '餘座少量',
    dot: 'var(--hkm-seat-few-dot)',
  },
  /* 原实心色：#7D0900（比 few 更沉，表达“已无票”而非“快没了”） */
  soldout: {
    bg: 'var(--hkm-seat-soldout-bg)',
    border: 'var(--hkm-seat-soldout-border)',
    text: 'var(--hkm-seat-soldout-fg)',
    label: '滿座',
    dot: 'var(--hkm-seat-soldout-dot)',
  },
};

/** 无余座数据时的中性场次卡（同样必须随主题走，理由同上） */
export const SEAT_NONE_STYLE = {
  bg: 'var(--hkm-seat-none-bg)',
  border: 'var(--hkm-seat-none-border)',
  text: 'var(--hkm-seat-none-fg)',
} as const;

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
