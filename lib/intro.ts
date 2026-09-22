/**
 * 电影详情页「资料卡」的字段合成
 *
 * 输入是聚合好的 MovieGroup，输出一组可直接渲染的字段。
 * 抽成独立模块有两个原因：
 *
 *  1. 优先级规则要讲清楚 —— 上映/级别/片长以院线为权威（购票要用），
 *     评分只有外部源有，中文人名优先各源里的中文表述，
 *     这些顺序得写成代码里的显式规则，而不是散在 JSX 的三元里。
 *  2. 静态导出下这段逻辑在 build 时跑（generateStaticParams 预渲染全部页面），
 *     放进 lib 便于单独测，页面组件保持纯排版。
 */
import type { EnrichEntry } from './types';
// MovieGroup 是聚合结果类型，定义在 lib/data.ts（纯类型导入，构建后擦除）
import type { MovieGroup } from './data';
import { formatDuration } from './format';

/** 香港官方分级（与 lib/data.ts 的 HK_RATINGS 同步） */
const HK_RATINGS = new Set(['I', 'IIA', 'IIB', 'III']);

export interface IntroRating {
  /** 来源标识，用于配色与外链 */
  source: 'douban' | 'imdb';
  label: string;
  value: number | null;
  votes: number | null;
  url: string | null;
}

export interface MovieIntro {
  title: string;
  subtitle: string | null;
  poster: string | null;

  openingDate: string | null;
  duration: number | null;
  durationText: string;
  /** 香港官方分级（I / IIA / IIB / III） */
  category: string | null;
  /** 对白语言（已映射为中文，如「粵語 / 英語」） */
  language: string | null;
  /** 字幕语言（已映射为中文） */
  subtitleLang: string | null;
  genres: string[];
  director: string | null;
  cast: string[];
  /** 剧情简介 */
  summary: string | null;

  ratings: IntroRating[];
}

/**
 * 合成资料卡
 *
 * @param group 聚合后的电影组（含 enrich）
 */
export function buildIntro(group: MovieGroup): MovieIntro {
  const e: EnrichEntry | null = group.enrich || null;
  const i = e?.imdb && !e.imdb.notFound ? e.imdb : null;
  const man = e?.manual || null;
  // ---------- 评分 ----------
  // ★ 2026-09-22 用户要求：两张评分卡始终同时显示，保持布局一致。
  //   没有分时显示「— 暫無評分」，而不是整块不渲染。
  //   顺序：IMDb 在前、豆瓣在后。
  const ratings: IntroRating[] = [];

  const rating = man?.rating ?? i?.rating ?? null;
  // IMDb 卡始终显示（有分显分数，无分显「— 暫無評分」）
  ratings.push({
    source: 'imdb',
    label: 'IMDb',
    value: rating,
    votes: man?.votes ?? i?.votes ?? null,
    url: i?.imdbUrl || (i?.imdbId ? `https://www.imdb.com/title/${i.imdbId}/` : null),
  });

  const d = e?.douban && !e.douban.notFound ? e.douban : null;
  // 豆瓣卡始终显示（有分显分数，无分显「— 暫無評分」）
  // 页面侧也不渲染人数（IMDb 卡片同样只留分数，两张卡视觉对齐）。
  ratings.push({
    source: 'douban',
    label: '豆瓣',
    value: d && d.ratingState !== 'unreleased' ? (d.rating ?? null) : null,
    votes: null,
    url: d?.doubanUrl || null,
  });

  // ---------- 级别 ----------
  // 只认港英分级；emperor 的 8.0 之类是媒体评分，不是分级（见 data.ts 注释）。
  const category = HK_RATINGS.has(group.displayCategory || '') ? group.displayCategory : null;

  return {
    title: group.displayName,
    subtitle: group.primary.nameEn && group.primary.nameEn !== group.displayName ? group.primary.nameEn : null,
    poster: group.displayPoster,
    openingDate: group.displayOpeningDate,
    duration: group.displayDuration,
    durationText: formatDuration(group.displayDuration),
    category,
    language: group.displayLanguageDetail.spoken,
    subtitleLang: group.displayLanguageDetail.subtitle,
    genres: group.displayGenres,
    director: group.displayDirector,
    cast: group.displayCast,
    summary: group.displayDescription,
    ratings,
  };
}
