import fs from 'node:fs';
import path from 'node:path';
import type { Movie, Show, Cinema, Meta, Source } from './types';
import {
  normalizeTitle,
  extractFormats,
  sortFormats,
  formatLabel,
  isBaseVersion,
  stripFormats,
} from './versions';
import { inferGeo, districtOrder, REGION_ORDER } from './region';
import type { Region } from './types';
// 紧凑传输格式的编解码在同目录的 compact.ts（零依赖，客户端组件也要用）
export { toCompact, fromCompact } from './compact';
export type { CompactRows } from './compact';

/**
 * 数据在**运行时**从 data/*.json 读取（而非静态 import）。
 *
 * 为什么这么做：
 *  1. 静态 import 会把数据烧进 bundle，导致 next build 预渲染全部页面
 *     → 构建峰值内存 ~2.3GB，1c1g 的 VPS 会 OOM
 *  2. 抓取更新 JSON 后无需重新构建，重启即生效
 *
 * 数据目录解析顺序：
 *  1. DATA_DIR 环境变量（部署时指向共享数据目录）
 *  2. 项目根目录的 data/
 *  3. standalone 产物内的 data/
 */

/**
 * ASCII slug 兜底：与 scrape.js 的 slugify 保持一致。
 * 仅用于修复存量数据中的中文 slug（详见 getGroupBySlug 处的说明）。
 */
function asciiSlug(nameEn: string | null, nameZh: string | null, id: string): string {
  const tail = String(id).split(':').pop();
  const base = (nameEn || nameZh || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${tail}` : `movie-${tail}`;
}

/**
 * 海报 URL 瘦身（低配 VPS 关键优化）
 *
 * 背景：院线 CDN 的原图高达 0.7–4.9MB/张，首页 50+ 张 ≈ 数十 MB。
 * 若直接把原图交给 next/image 优化器，服务端要用 sharp 逐张转换，
 * 在 2C2G 机器上会长时间占用 CPU —— 反而制造新的负载峰值。
 *
 * 策略：让 CDN 先做一次有损缩放（阿里云 OSS 的 x-oss-process），
 *       把 4.9MB 压到 ~23KB，再由 next/image 生成响应式 srcset。
 *       优化器输入的图小了两个数量级，开销可忽略。
 *
 * 不认识的图片域名（不含 x-oss-process 支持）原样返回，
 * 届时由 next/image 兜底优化，不会更差。
 */
const OSS_HOSTS = new Set(['cdn.icirena.ai', 'media.grabticks.com']);

function slimPoster(url: string | null, width: number): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!OSS_HOSTS.has(u.hostname)) return url;
    // 已带处理参数则不再追加
    if (u.searchParams.has('x-oss-process')) return url;
    u.searchParams.set('x-oss-process', `image/resize,w_${width}/format,webp`);
    return u.toString();
  } catch {
    return url;
  }
}

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const candidates = [
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), '.next', 'standalone', 'data'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'movies.json'))) return dir;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

const DATA_DIR = resolveDataDir();

function readJson<T>(file: string, fallback: T): T {
  try {
    const p = path.join(DATA_DIR, file);
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (e) {
    // 数据缺失时降级为空，避免整站 500
    console.error(`[data] 读取 ${file} 失败:`, (e as Error).message);
    return fallback;
  }
}

// 进程内缓存：避免每次请求都读盘
let _cache: {
  movies: Movie[];
  shows: Show[];
  cinemas: Cinema[];
  meta: Meta;
  at: number;
} | null = null;

// 默认 60 秒。
//
// 取值权衡：
//  - 太长：读取层的「剔除已开映场次」过滤会滞后，用户会看到刚过点的场次
//  - 太短：275+ 部影片的 JSON 要反复解析，2C2G 机器上白烧 CPU
// 60 秒是折中 —— 过期场次最多多留 1 分钟，且每分钟只重解析一次。
// 抓取脚本写完后会重启服务，缓存自然失效。
const CACHE_TTL_MS = Number(process.env.DATA_CACHE_TTL_MS ?? 60_000);

function load() {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache;

  const movies = readJson<Movie[]>('movies.json', []);
  const shows = readJson<Show[]>('shows.json', []);
  const cinemas = readJson<Cinema[]>('cinemas.json', []);

  // ★ 戲院地理归属：读取时推断（见 lib/region.ts 的说明）
  //
  // 为什么放在这里而不是抓取器：推断是「戲院名 + 地址 → 大區/十八區」的纯函数，
  // 结果与抓取时点无关。放在读取层意味着：改映射表只需重启，不必重跑抓取。
  for (const c of cinemas) {
    const geo = inferGeo(c.nameZh, c.address);
    c.region = geo.region;
    c.district = geo.district;
  }

  // 海报瘦身：只在载入时做一次，随后进缓存（不重复解析 URL）
  for (const m of movies) {
    if (m.poster) m.poster = slimPoster(m.poster, 400);
  }

  // slug 兜底规范化：存量数据里可能残留中文 slug（来自无英文名的 MCL 条目），
  // 中文 slug 在 /movie/[slug] 下会 404，这里统一替换为 ASCII 形式，
  // 使旧数据无需重新抓取即可修复。
  for (const m of movies) {
    if (m.slug && !/^[A-Za-z0-9_-]+$/.test(m.slug)) {
      m.slug = asciiSlug(m.nameEn, m.nameZh, m.id);
    }
  }

  const meta = readJson<Meta>('meta.json', {
    lastUpdated: new Date().toISOString(),
    sources: [],
    counts: { movies: 0, showing: 0, upcoming: 0, cinemas: 0, shows: 0 },
    errors: [],
    durationMs: 0,
  });

  // ★ 剔除已开映的场次
  //
  // 背景：抓取每 2–6 小时才跑一次，中间已开映的场次会一直留在页面上，
  // 用户会看到「早上 10 点的场次下午还在」。抓取频率不能解决这个，
  // 必须在**读取时**按当前时间实时过滤。
  //
  // 注意：只过滤场次，不过滤电影 —— 今天已散场的电影仍应出现在列表中，
  // 只是场次归零（首页会自然排到最后）。
  const liveShows = shows.filter((s) => {
    if (!s.startAt) return false;
    const t = Date.parse(s.startAt);
    if (!Number.isFinite(t)) return true; // 时间异常时保留，宁可多显示
    return t >= now;
  });

  _cache = { movies, shows: liveShows, cinemas, meta, at: now };
  return _cache;
}

/**
 * 站点元数据
 *
 * 注意 counts.shows 会被改写为「当前有效（未开映）场次数」。
 * 抓取写入的 meta.counts.shows 是当时抓到的总数，
 * 而页面展示的场次已按当前时间剔除过期项，
 * 不修正的话页脚数字会和实际看到的场次数对不上。
 */
export function getMeta(): Meta {
  const { meta, shows } = load();
  return {
    ...meta,
    counts: { ...meta.counts, shows: shows.length },
  };
}

export const SOURCE_LABEL: Record<Source, string> = {
  broadway: '百老匯',
  mcl: 'MCL',
  emperor: '英皇',
  cinemacity: 'Cinema City',
  bestar: '星達',
};

/** 院线展示顺序（按规模） */
const SOURCE_ORDER: Source[] = ['broadway', 'mcl', 'emperor', 'cinemacity', 'bestar'];

/**
 * 是否含中日韩字符
 * 注意：不能用 /g 标志 —— 带 g 的正则在 .test() 之间会保留 lastIndex，
 * 连续调用会给出错误结果。
 */
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 香港电影官方分级（严格匹配）
 * 卡片左上角只能展示这里枚举里的值，否则会误把 emperor 的 1–10 评分当成分级。
 */
const HK_RATINGS = new Set(['I', 'IIA', 'IIB', 'III']);

/**
 * 选择组的展示分级
 *
 * 各源 category 字段含义不同：
 *   - broadway / cinemacity / bestar：香港官方分级（I / IIA / IIB / III）
 *   - emperor：是 1–10 媒体评分（不是分级）
 *   - mcl：空
 *
 * 这里只接受 HK_RATINGS 里的值；广度优先从「最具分级权威的源」取。
 */
function pickDisplayCategory(list: Movie[]): string | null {
  for (const src of ['broadway', 'cinemacity', 'bestar'] as Source[]) {
    const hit = list.find((m) => m.source === src && m.category && HK_RATINGS.has(m.category));
    if (hit) return hit.category!;
  }
  return null;
}

/**
 * 选择组的展示语言
 *
 * 优先级：broadway.dialect（最完整） > 其他源的 dialect > emperor 的 subtitle（多为「中文」之类）
 * 返回首个非空值，长度截断防超宽。
 */
function pickDisplayLanguage(list: Movie[]): string | null {
  for (const m of list) {
    if (m.dialect && m.dialect.trim()) return m.dialect;
  }
  for (const m of list) {
    if (m.subtitle && m.subtitle.trim() && m.subtitle !== '無字幕') return m.subtitle;
  }
  return null;
}

/**
 * 选择组的展示时长
 *
 * 时长在各源里差异不大（都是分钟数），优先取原版版本（versions 里 __base__ key 的那条），
 * 若没有再取 primary 的 duration。
 */
function pickDisplayDuration(list: Movie[], primary: Movie): number | null {
  // 原版条目优先
  const base = list.find((m) => isBaseVersion(m.nameZh || m.nameEn) && m.duration);
  if (base) return base.duration!;
  const withDur = list.find((m) => m.duration);
  return withDur?.duration ?? primary.duration ?? null;
}

// ============================================================
// 电影组（跨院线 + 跨版本聚合）
// ============================================================

/** 同一部电影的某个放映版本 */
export interface MovieVersion {
  /** 版本 key（格式组合，如 "imax" / "__base__"） */
  key: string;
  /** 版本标签，如 ['IMAX']；空数组表示原版 */
  formats: string[];
  /** 提供该版本的院线 */
  sources: Source[];
  /** 该版本涉及的源条目 id（每院线一条） */
  movieIds: string[];
  /** 场次数 */
  showCount: number;
  /** 最低票价 */
  minPrice: number | null;
  /** 上映日期 */
  openingDate: string | null;
  /** 详情页 slug（取该版本场次最多的条目） */
  slug: string;
}

/** 一部电影（含全部版本与院线） */
export interface MovieGroup {
  key: string;
  /** 代表影片（优先原版、元数据丰富） */
  primary: Movie;
  /** 展示用片名（已去除格式标记） */
  displayName: string;
  /** 全部版本 */
  versions: MovieVersion[];
  /** 总场次数 */
  totalShows: number;
  /** 最低票价 */
  minPrice: number | null;
  /** 涉及院线 */
  sources: Source[];
  /** 全部可用格式标签 */
  allFormats: string[];
  /** 详情页 slug */
  slug: string;
  status: 'showing' | 'upcoming';
  /**
   * 聚合后的香港电影分级（卡片左上角）
   * 优先级：broadway（官方分级） > mcl > 其他
   * emperor 源的 category 是 1–10 评分，不是官方分级，不参与
   */
  displayCategory: string | null;
  /** 聚合后的主语言（卡片右下角） */
  displayLanguage: string | null;
  /** 聚合后的时长（分钟），首选原版版本 */
  displayDuration: number | null;
}

/**
 * 构建电影组：按「归一化片名」聚合为电影，再按「放映格式」聚合为版本。
 *
 * 示例（《复仇者联盟4》）：
 *   电影组
 *     └─ 版本
 *          ├─ 原版    : 百老汇 + MCL + 英皇  → 场次合并
 *          ├─ IMAX    : 百老汇 + MCL
 *          ├─ 4DX     : 百老汇
 *          └─ 全景聲   : 百老汇
 *
 * 关键：同一格式在不同院线是独立条目，需合并为一个版本；
 *       不同格式必须分开，否则详情页的版本分类就没了。
 */
export function getMovieGroups(status?: 'showing' | 'upcoming'): MovieGroup[] {
  const { movies, shows } = load();

  // ---------- 预统计：每个源条目的场次数与最低价 ----------
  const showCount = new Map<string, number>();
  const minPrice = new Map<string, number>();
  for (const s of shows) {
    if (!s.movieId) continue;
    showCount.set(s.movieId, (showCount.get(s.movieId) || 0) + 1);
    if (s.price != null) {
      const cur = minPrice.get(s.movieId);
      if (cur == null || s.price < cur) minPrice.set(s.movieId, s.price);
    }
  }

  // ---------- 第一步：按归一化片名聚合为「电影」 ----------
  const movieGroups = new Map<string, Movie[]>();
  for (const m of movies) {
    if (status && m.status !== status) continue;
    const name = m.nameZh || m.nameEn;
    const key = normalizeTitle(name);
    if (!key) continue;

    const bucket = movieGroups.get(key);
    if (bucket) bucket.push(m);
    else movieGroups.set(key, [m]);
  }

  // ---------- 第一步 b：跨语言合并（中文组 + 纯英文组）----------
  //
  // 背景：部分院线（如 bestar）只提供英文名，nameZh 里存的就是英文；
  // 其他院线用中文名。归一化后 key 不同，同一部电影会分裂成两组，
  // 页面上出现「一个中文标题 + 一个英文标题」的重复卡片。
  //
  // 做法：若某组的英文名与另一组相同，且其中一组是纯英文（无中文名），
  //       就把纯英文组并入含中文的那组。
  //       只在「一组纯英文」时合并，避免把英文名恰好相同的不同电影误并。
  const aliasToKeys = new Map<string, Set<string>>();
  for (const [key, list] of movieGroups) {
    const aliases = new Set<string>();
    for (const m of list) {
      // 英文名（含 nameZh 本身是英文的情况）
      for (const raw of [m.nameEn, m.nameZh]) {
        if (!raw) continue;
        const n = normalizeTitle(raw);
        if (n && !CJK_RE.test(n)) aliases.add(n);
      }
    }
    for (const a of aliases) {
      const set = aliasToKeys.get(a);
      if (set) set.add(key);
      else aliasToKeys.set(a, new Set([key]));
    }
  }

  for (const [, keys] of aliasToKeys) {
    if (keys.size !== 2) continue; // 只处理明确的两组情形，降低误并风险
    const [a, b] = [...keys];
    const aZh = CJK_RE.test(a);
    const bZh = CJK_RE.test(b);
    // 需要恰好一组含中文、另一组为纯英文
    if (aZh === bZh) continue;
    const zhKey = aZh ? a : b;
    const enKey = aZh ? b : a;

    const zhList = movieGroups.get(zhKey);
    const enList = movieGroups.get(enKey);
    if (!zhList || !enList) continue;

    // 并入中文组，保留中文 key 作为展示名
    zhList.push(...enList);
    movieGroups.delete(enKey);
  }

  const result: MovieGroup[] = [];

  for (const [key, list] of movieGroups) {
    // ---------- 第二步：按「放映格式组合」聚合为「版本」 ----------
    const versionMap = new Map<string, Movie[]>();

    for (const m of list) {
      const formats = sortFormats(extractFormats(m.nameZh || m.nameEn));
      const vKey = formats.length ? formats.join('|').toLowerCase() : '__base__';
      const bucket = versionMap.get(vKey);
      if (bucket) bucket.push(m);
      else versionMap.set(vKey, [m]);
    }

    // ---------- 第三步：构建版本列表 ----------
    const versions: MovieVersion[] = [];

    for (const [vKey, items] of versionMap) {
      const formats = sortFormats(extractFormats(items[0].nameZh || items[0].nameEn));
      const totalShows = items.reduce((n, m) => n + (showCount.get(m.id) || 0), 0);
      const prices = items
        .map((m) => minPrice.get(m.id))
        .filter((p): p is number => p != null);

      // 代表条目：场次最多（用于 slug）
      const best = [...items].sort(
        (a, b) => (showCount.get(b.id) || 0) - (showCount.get(a.id) || 0)
      )[0];

      // 上映日期：取最早的非空值
      const dates = items.map((m) => m.openingDate).filter(Boolean).sort();

      versions.push({
        key: vKey,
        formats,
        sources: [...new Set(items.map((m) => m.source))] as Source[],
        movieIds: items.map((m) => m.id),
        showCount: totalShows,
        minPrice: prices.length ? Math.min(...prices) : null,
        openingDate: dates[0] ?? null,
        slug: best.slug,
      });
    }

    // 版本排序：原版在前，再按场次多寡
    versions.sort((a, b) => {
      if (a.formats.length === 0 && b.formats.length > 0) return -1;
      if (b.formats.length === 0 && a.formats.length > 0) return 1;
      if (a.showCount !== b.showCount) return b.showCount - a.showCount;
      return a.formats.join().localeCompare(b.formats.join());
    });

    // ---------- 第四步：选代表影片 ----------
    const primary = [...list].sort((a: Movie, b: Movie) => {
      const aBase = isBaseVersion(a.nameZh || a.nameEn) ? 0 : 1;
      const bBase = isBaseVersion(b.nameZh || b.nameEn) ? 0 : 1;
      if (aBase !== bBase) return aBase - bBase;
      return (showCount.get(b.id) || 0) - (showCount.get(a.id) || 0);
    })[0];

    const totalShows = versions.reduce((n, v) => n + v.showCount, 0);
    const prices = versions.map((v) => v.minPrice).filter((p): p is number => p != null);
    const allFormats = sortFormats([...new Set(versions.flatMap((v) => v.formats))]);
    const sources = [...new Set(versions.flatMap((v) => v.sources))] as Source[];

    result.push({
      key,
      primary,
      displayName: stripFormats(primary.nameZh || primary.nameEn),
      versions,
      totalShows,
      minPrice: prices.length ? Math.min(...prices) : null,
      sources,
      allFormats,
      slug: primary.slug,
      status: primary.status,
      // ★ 卡片显示用的聚合字段（按各源语义优先级选择，详见 helper 注释）
      displayCategory: pickDisplayCategory(list),
      displayLanguage: pickDisplayLanguage(list),
      displayDuration: pickDisplayDuration(list, primary),
    });
  }

  return result;
}

/** 上映中的电影组（按场次排序） */
export function getShowingGroups(): MovieGroup[] {
  return getMovieGroups('showing').sort((a, b) => {
    if (a.totalShows !== b.totalShows) return b.totalShows - a.totalShows;
    return (b.primary.openingDate || '').localeCompare(a.primary.openingDate || '');
  });
}

/** 待映的电影组（按上映日排序） */
export function getUpcomingGroups(): MovieGroup[] {
  return getMovieGroups('upcoming').sort((a, b) =>
    (a.primary.openingDate || '').localeCompare(b.primary.openingDate || '')
  );
}

/** 待映按日期分组 */
export function getUpcomingGroupsByDate(): { date: string; groups: MovieGroup[] }[] {
  const byDate = new Map<string, MovieGroup[]>();
  for (const g of getUpcomingGroups()) {
    const d = g.primary.openingDate || '未定';
    const bucket = byDate.get(d);
    if (bucket) bucket.push(g);
    else byDate.set(d, [g]);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, groups]) => ({ date, groups }));
}

/** 根据 slug 取回电影组（详情页用，支持任一版本的 slug） */
/**
 * 根据 slug 取回电影组（详情页用，支持任一版本的 slug）
 *
 * ⚠️ 必须同时查 showing 与 upcoming 两组：
 *   首页/列表页用的是 getMovieGroups('showing')，其候选集不含 upcoming 条目；
 *   而 getMovieGroups()（无参）会把 upcoming 也纳入。
 *   一部电影若同时有 showing 和 upcoming 条目，两种调用选出的
 *   primary（进而 slug）会不同 —— 结果就是列表页给出的链接点进去 404。
 *   （线上曾因此出现首页 2/3 卡片指向 404）
 */
export function getGroupBySlug(slug: string): MovieGroup | undefined {
  const pools = [getMovieGroups('showing'), getMovieGroups('upcoming')];
  for (const all of pools) {
    const hit = all.find(
      (g: MovieGroup) =>
        g.slug === slug || g.versions.some((v: MovieVersion) => v.slug === slug)
    );
    if (hit) return hit;
  }
  return undefined;
}

// ============================================================
// 基础查询
// ============================================================

export function getAllMovies(): Movie[] {
  return load().movies;
}

export function getMovies(): Movie[] {
  return load().movies;
}

export function getShows(): Show[] {
  return load().shows;
}

export function getShowing(): Movie[] {
  return load()
    .movies.filter((m) => m.status === 'showing')
    .sort((a, b) => (b.openingDate || '').localeCompare(a.openingDate || ''));
}

export function getUpcoming(): Movie[] {
  return load()
    .movies.filter((m) => m.status === 'upcoming')
    .sort((a, b) => (a.openingDate || '').localeCompare(b.openingDate || ''));
}

export function getMovieBySlug(slug: string): Movie | undefined {
  return load().movies.find((m) => m.slug === slug);
}

export function getMovieById(id: string): Movie | undefined {
  return load().movies.find((m) => m.id === id);
}

export function getShowsByMovie(movieId: string): Show[] {
  return load()
    .shows.filter((s) => s.movieId === movieId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** 取某版本全部源条目的场次（跨院线合并） */
export function getShowsByVersion(version: MovieVersion): Show[] {
  const ids = new Set(version.movieIds);
  return load()
    .shows.filter((s) => ids.has(s.movieId))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** 按影院分组场次 */
export function getShowsByMovieGrouped(movieId: string): {
  cinemaId: string;
  cinema: Cinema | undefined;
  shows: Show[];
}[] {
  const { cinemas } = load();
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));

  const byCinema = new Map<string, Show[]>();
  for (const s of getShowsByMovie(movieId)) {
    const cid = s.cinemaId || '';
    if (!byCinema.has(cid)) byCinema.set(cid, []);
    byCinema.get(cid)!.push(s);
  }
  return [...byCinema.entries()]
    .map(([cinemaId, list]) => ({ cinemaId, cinema: cinemaById.get(cinemaId), shows: list }))
    .sort((a, b) => (a.cinema?.nameZh || '').localeCompare(b.cinema?.nameZh || ''));
}

/** 把一组场次按影院分组 */
export function groupShowsByCinema(shows: Show[]): {
  cinemaId: string;
  cinema: Cinema | undefined;
  shows: Show[];
}[] {
  const { cinemas } = load();
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));

  const byCinema = new Map<string, Show[]>();
  for (const s of shows) {
    const cid = s.cinemaId || '';
    if (!byCinema.has(cid)) byCinema.set(cid, []);
    byCinema.get(cid)!.push(s);
  }
  return [...byCinema.entries()]
    .map(([cinemaId, list]) => ({ cinemaId, cinema: cinemaById.get(cinemaId), shows: list }))
    .sort((a, b) => (a.cinema?.nameZh || '').localeCompare(b.cinema?.nameZh || ''));
}

// ============================================================
// 影院
// ============================================================

export function getAllCinemas(): Cinema[] {
  const rank = new Map(SOURCE_ORDER.map((s, i) => [s, i]));
  return [...load().cinemas].sort((a, b) => {
    const ra = rank.get(a.source) ?? 99;
    const rb = rank.get(b.source) ?? 99;
    return ra - rb || a.nameZh.localeCompare(b.nameZh);
  });
}

export function getCinemas(): Cinema[] {
  return load().cinemas;
}

export function getCinemaById(id: string): Cinema | undefined {
  return load().cinemas.find((c) => c.id === id);
}

export function getShowsByCinema(cinemaId: string): Show[] {
  return load()
    .shows.filter((s) => s.cinemaId === cinemaId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** 影院按院线分组 */
export function getCinemasBySource(): { source: Source; label: string; cinemas: Cinema[] }[] {
  const { cinemas } = load(); // 原实现在 map 内反复调用 load()
  return SOURCE_ORDER.map((source) => ({
    source,
    label: SOURCE_LABEL[source],
    cinemas: cinemas
      .filter((c) => c.source === source)
      .sort((a, b) => a.nameZh.localeCompare(b.nameZh)),
  })).filter((g) => g.cinemas.length > 0);
}

export { formatLabel, extractFormats, normalizeTitle, stripFormats };

// ============================================================
// 場次篩選 / 排序（詳情頁用）
// ============================================================

/**
 * 展平后的单条场次（可直接序列化给客户端组件做筛选）
 *
 * 为什么要「展平」：
 *   原先详情页按「版本 → 日期 → 影院」三层嵌套服务端渲染，
 *   所有场次都写死在 HTML 里（热门片实测 746KB），
 *   无法做交互式筛选（静态 HTML 改不了），也拖慢首屏。
 *
 *   展平为「一行一场次」后，可以：
 *     1. 作为紧凑 JSON 交给客户端组件，用 JS 实时筛选/排序
 *     2. HTML 体积大幅下降（不再重复嵌套标签）
 */
export interface ShowRow {
  id: string;
  startAt: string;
  /** 香港时区 HH:mm */
  time: string;
  date: string;
  price: number | null;
  /** 剩余可选率（0–1），颜色标记依据 */
  remainRate: number | null;
  /** 是否已满座 */
  soldOut?: boolean;
  seats: number | null;
  houseName: string;
  bookingUrl: string;
  source: Source;
  sourceLabel: string;
  cinemaId: string;
  cinemaName: string;
  cinemaAddress: string;
  cinemaMapUrl: string;
  region: Region | null;
  district: string | null;
  /** 版本 key（如 'imax' / '__base__'），用于筛选 */
  versionKey: string;
  /** 版本展示名（如 'IMAX' / '原版'） */
  versionLabel: string;
  /** 版本标签数组（用于图标/角标） */
  formats: string[];
}

/**
 * 把一部电影组的所有场次展平为 ShowRow[]
 *
 * 版本来源：从**片名**推断（extractFormats），而不是 show.version 字段。
 * 原因：百老匯的 1479 場 version 全为 null（其 API 不提供该字段），
 *       而片名里其实带了格式标记（「復仇者聯盟4 IMAX with Laser」）。
 *       统一从片名推断，四个源才能用同一套版本维度筛选。
 */
export function getShowRowsForGroup(group: MovieGroup): ShowRow[] {
  const { shows, movies, cinemas } = load();

  const movieById = new Map(movies.map((m) => [m.id, m]));
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));
  const ids = new Set(group.versions.flatMap((v) => v.movieIds));

  const rows: ShowRow[] = [];

  for (const s of shows) {
    if (!ids.has(s.movieId)) continue;

    const movie = movieById.get(s.movieId);
    const formats = sortFormats(extractFormats(movie?.nameZh || movie?.nameEn || ''));
    const cinema = cinemaById.get(s.cinemaId);

    rows.push({
      id: s.id,
      startAt: s.startAt,
      time: s.startAt.slice(11, 16),
      date: s.date,
      price: s.price,
      remainRate: s.remainRate ?? null,
      soldOut: s.soldOut,
      seats: s.seats ?? null,
      houseName: s.houseName || '',
      bookingUrl: s.bookingUrl,
      source: s.source,
      sourceLabel: SOURCE_LABEL[s.source] ?? s.source,
      cinemaId: s.cinemaId,
      cinemaName: cinema?.nameZh || `戲院 #${s.cinemaId}`,
      cinemaAddress: cinema?.address || '',
      cinemaMapUrl: cinema?.mapUrl || '',
      region: cinema?.region ?? null,
      district: cinema?.district ?? null,
      versionKey: formats.length ? formats.join('|').toLowerCase() : '__base__',
      versionLabel: formats.length ? formats.map(formatLabel).join(' + ') : '原版',
      formats,
    });
  }

  rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return rows;
}

/**
 * 为一批场次计算筛选面板的候选项
 *
 * 只返回**实际有场次**的选项，避免出现「选了却没有任何结果」的空选项。
 * 各维度按「场次多寡 / 行政顺序」排序，让常用项排前面。
 */
export interface Facets {
  sources: { value: string; label: string; count: number }[];
  versions: { value: string; label: string; count: number }[];
  regions: { value: string; label: string; count: number }[];
  districts: { value: string; label: string; count: number }[];
}

export function getFacets(rows: ShowRow[]): Facets {
  const count = <T extends string>(get: (r: ShowRow) => T | null) => {
    const m = new Map<T, number>();
    for (const r of rows) {
      const v = get(r);
      if (v == null || v === '') continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };

  const srcCount = count((r) => r.source);
  const verCount = count((r) => r.versionKey);
  const regCount = count((r) => r.region);
  const disCount = count((r) => r.district);

  // 版本展示名：取该 key 下任意一行的 label
  const verLabel = new Map<string, string>();
  for (const r of rows) if (!verLabel.has(r.versionKey)) verLabel.set(r.versionKey, r.versionLabel);

  return {
    sources: SOURCE_ORDER.filter((s) => srcCount.has(s)).map((s) => ({
      value: s,
      label: SOURCE_LABEL[s],
      count: srcCount.get(s)!,
    })),
    // 原版排最前，其余按场次多寡
    versions: [...verCount.entries()]
      .sort((a, b) => {
        if (a[0] === '__base__') return -1;
        if (b[0] === '__base__') return 1;
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      })
      .map(([value, c]) => ({ value, label: verLabel.get(value) ?? value, count: c })),
    regions: REGION_ORDER.filter((r) => regCount.has(r)).map((r) => ({
      value: r,
      label: r,
      count: regCount.get(r)!,
    })),
    districts: [...disCount.entries()]
      .sort((a, b) => districtOrder(a[0]) - districtOrder(b[0]) || a[0].localeCompare(b[0]))
      .map(([value, c]) => ({ value, label: value, count: c })),
  };
}
