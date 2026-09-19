/**
 * 海报卡片的评分（卡片右下角）
 *
 * 规则（用户 2026-09-20 指定）：
 *   - IMDb 与豆瓣都有分 → 取两者算术平均（(IMDb + 豆瓣) ÷ 2，不加权）
 *   - 只有一方有分      → 直接用那一方的分
 *   - 都没有 / 尚未出分  → 不显示（卡片保持原样，不占位）
 *
 * 数据来自 data/enrich.json（按 enrichment key 叠到电影组上，见 lib/data.ts）。
 * 与详情页的 buildIntro 分开：详情页展示**分源**两张卡，卡片只要一个综合分，
 * 两边口径不同，所以各自算、不互相复用。
 */
import type { EnrichEntry } from './types';

export interface CardRating {
  /** 0.0–10.0，已按一位小数取整 */
  value: number;
  /** 分数来源，用于标签与 tooltip */
  source: 'mixed' | 'imdb' | 'douban';
  /** 徽章下方的小字：綜合 / IMDb / 豆瓣 */
  label: string;
  /** 明细，供 title 提示（「IMDb 8.4 · 豆瓣 8.6 的平均分」） */
  imdb: number | null;
  douban: number | null;
}

/** 一位小数：8.45 → 8.5。评分只到 0.1，避免出现 8.450000000000001 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeCardRating(e: EnrichEntry | null | undefined): CardRating | null {
  if (!e) return null;

  // notFound = 压根没匹到条目；rating 为 null = 匹到了但人数不足还没出分。
  // 两者都当作「无分」，不显示徽章（显示 0 或 — 会误导）。
  const imdb = e.imdb && !e.imdb.notFound ? (e.imdb.rating ?? null) : null;

  // 豆瓣侧多一个 ratingState：unreleased = 条目存在但尚未上映，同样无分。
  // 与详情页 MovieIntro 的判断保持一致。
  const douban =
    e.douban && !e.douban.notFound && e.douban.ratingState !== 'unreleased'
      ? (e.douban.rating ?? null)
      : null;

  if (imdb != null && douban != null) {
    return {
      value: round1((imdb + douban) / 2),
      source: 'mixed',
      label: '綜合',
      imdb: round1(imdb),
      douban: round1(douban),
    };
  }
  if (imdb != null) {
    return { value: round1(imdb), source: 'imdb', label: 'IMDb', imdb: round1(imdb), douban: null };
  }
  if (douban != null) {
    return { value: round1(douban), source: 'douban', label: '豆瓣', imdb: null, douban: round1(douban) };
  }
  return null;
}

/** 徽章的 tooltip：说明这个分是怎么来的 */
export function ratingTitle(r: CardRating): string {
  if (r.source === 'mixed') {
    return `IMDb ${r.imdb?.toFixed(1)} · 豆瓣 ${r.douban?.toFixed(1)} 的平均分`;
  }
  return r.source === 'imdb' ? `IMDb ${r.value.toFixed(1)}` : `豆瓣 ${r.value.toFixed(1)}`;
}
