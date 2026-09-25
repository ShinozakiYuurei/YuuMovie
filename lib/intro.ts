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

/**
 * `#rrggbb` → `"r g b"`（CSS 里 rgb(var(--x) / a) 要的通道写法）
 *
 * 容忍 `#rgb` 短写法与大小写；入参不是合法颜色时返回 null ——
 * 宁可让卡片退回中性玻璃，也不要把一个坏值写进 style 属性
 * （写坏了 CSS 变量整条声明会失效，而且是静默的）。
 */
function hexToRgbChannels(hex: string | null | undefined): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

export interface IntroRating {
  /** 来源标识，用于配色与外链 */
  source: 'douban' | 'imdb';
  label: string;
  value: number | null;
  votes: number | null;
  url: string;
}

export interface MovieIntro {
  title: string;
  /**
   * 副标题：影片的**英文片名**（详情页中文标题下方那行）
   *
   * ★ 2026-09-25 改读 group.displayNameEn，不再读 group.primary.nameEn。
   *   原先这里读 primary —— 而 primary 是按场次最多选出来的代表条目，
   *   MCL 只给中文名，于是《歡迎來龍餐館》《復仇者聯盟4》这种
   *   「MCL 场次最多」的片副标题直接不渲染（用户截图里缺的那行）。
   *   英文名现在是**组级**字段（见 lib/data.ts 的 pickDisplayNameEn），
   *   与哪家院线场次多无关。
   */
  subtitle: string | null;
  poster: string | null;
  /**
   * 海报主色（`#rrggbb`），取不到为 null
   *
   * 详情页卡片的背景填充用它（见 components/MovieIntro.tsx）。
   * 为 null 时组件回退到「模糊海报光晕」那层旧背景。
   */
  accent: string | null;
  /**
   * 主色的 **RGB 通道**写法（`"27 46 126"`），供 CSS 逐档控制透明度
   *
   * ★ 为什么要多一个字段而不是让组件自己转：
   *   CSS 里要写 rgb(var(--x) / 0.34) 这种**带 alpha 的主色**，
   *   而 hex 做不到 —— 只能靠 color-mix()，它在旧引擎上没有回退，
   *   一旦不支持整块背景就全丢。
   *   转换放在这里（服务端、每页一次）而不是 CSS 里，
   *   是因为 CSS 无法把 #rrggbb 拆成三个通道值。
   */
  accentRgb: string | null;

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
  const imdbSearchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(
    group.displayNameEn || group.displayName,
  )}`;
  const imdbId = man?.imdbId || i?.imdbId;
  const imdbDetailUrl = imdbId && /^tt\d+$/.test(imdbId)
    ? `https://www.imdb.com/title/${imdbId}/`
    : i?.imdbUrl && /^https:\/\/(www\.)?imdb\.com\/title\/tt\d+\/?$/.test(i.imdbUrl)
      ? i.imdbUrl
      : null;
  // IMDb 卡始终显示（有分显分数，无分显「— 暫無評分」）。没有匹配条目时回退到搜索，
  // 确保整张卡始终可点；人工指定的 ID 优先于自动匹配结果。
  ratings.push({
    source: 'imdb',
    label: 'IMDb',
    value: rating,
    votes: man?.votes ?? i?.votes ?? null,
    url: imdbDetailUrl || imdbSearchUrl,
  });

  const d = e?.douban && !e.douban.notFound ? e.douban : null;
  const doubanSearchUrl = `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(
    group.displayName,
  )}`;
  // 仅接受豆瓣电影条目。搜索建议可能误匹配到书籍或音乐，
  // 这类条目不应作为电影评分卡的跳转目标。
  const doubanUrlId = d?.doubanUrl?.match(
    /^https:\/\/movie\.douban\.com\/subject\/(\d+)(?:\/|$)/,
  )?.[1];
  const doubanId = !d?.doubanUrl || doubanUrlId ? doubanUrlId || d?.doubanId : null;
  const doubanDetailUrl = doubanId && /^\d+$/.test(doubanId)
    ? `https://movie.douban.com/subject/${doubanId}/`
    : null;
  // 豆瓣卡始终显示；没有有效电影条目时回退到豆瓣电影搜索，确保整张卡始终可点。
  // 页面侧不渲染人数（IMDb 卡片同样只留分数，两张卡视觉对齐）。
  ratings.push({
    source: 'douban',
    label: '豆瓣',
    value: d && d.ratingState !== 'unreleased' ? (d.rating ?? null) : null,
    votes: null,
    url: doubanDetailUrl || doubanSearchUrl,
  });

  // ---------- 级别 ----------
  // 只认港英分级；emperor 的 8.0 之类是媒体评分，不是分级（见 data.ts 注释）。
  const category = HK_RATINGS.has(group.displayCategory || '') ? group.displayCategory : null;

  return {
    title: group.displayName,
    // 副标题 = 英文片名。与中文名相同（或本身就是英文名）时留空，
    // 否则会出现「Look Back / Look Back」这种同一行重复两遍。
    subtitle:
      group.displayNameEn && group.displayNameEn !== group.displayName
        ? group.displayNameEn
        : null,
    poster: group.displayPoster,
    accent: group.displayAccent,
    accentRgb: hexToRgbChannels(group.displayAccent),
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
