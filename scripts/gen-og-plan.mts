#!/usr/bin/env node
/**
 * 生成分享卡片（OG / X Card）的「数据计划」。
 *
 * ── 为什么要有这一步 ────────────────────────────────────────────
 *
 * 卡片图本身由 Go 画（goscraper/cmd/ogcardgen，见 goscraper/internal/ogcard）——
 * 但「哪部片是一组、组用哪个 slug、卡片上写什么字」这些**页面语义**
 * 已经全部在 lib/data.ts 里实现并测过了（片名归并、组级字段挑选、
 * 英文名清洗、slug 生成…都是踩过坑的规则）。
 *
 * 在 Go 里重写一遍等于把那些坑再踩一次，而且必然与页面慢慢分叉 ——
 * 卡片上的片名和页面上的片名不一致，是最难被发现的一类错。
 *
 * 所以分工是：**本脚本（TS）负责说「写什么」，Go 负责画「长什么样」。**
 * 这与 scripts/gen-slug-redirects.mts 是同一个套路（TS 算规则、产物给下游用）。
 *
 * ── 输出 ──────────────────────────────────────────────────────
 *   data/og-plan.json   卡片渲染计划（不进仓库，data/ 已在 .gitignore）
 *
 * 用法：
 *   node --import tsx scripts/gen-og-plan.mts
 *   node --import tsx scripts/gen-og-plan.mts --print   # 打到 stdout 看一眼
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getMovieGroups,
  getCinemaRows,
  getMeta,
  getShowsByCinema,
  SOURCE_LABEL,
} from '../lib/data.ts';
import { buildIntro } from '../lib/intro.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'og-plan.json');

/**
 * 从已本地化的海报路径里取出文件名。
 *
 * displayPoster 可能是三种形态（见 lib/data.ts 的 posterUrl）：
 *   1. /posters/xxx.webp                        （同源）
 *   2. https://imgmove.yuurei.de/posters/xxx.webp（图片子域）
 *   3. 远端原始 URL（未本地化成功时的回退）
 * 只有前两种能落到磁盘上，第 3 种返回 null —— 卡片改为不带图，
 * 而不是引用一张取不到的远端图（X 抓不到图就是一张灰卡）。
 */
function posterFileName(poster: string | null): string | null {
  if (!poster) return null;
  const i = poster.indexOf('/posters/');
  if (i === -1) return null;
  const name = poster.slice(i + '/posters/'.length);
  if (!name || name.includes('/') || name.includes('?')) return null;
  return name;
}

/** 主色表：文件名 → #rrggbb（scripts/poster-colors.mjs 生成） */
function loadPosterColors(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poster-colors.json'), 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  const colors = loadPosterColors();
  const meta = getMeta();
  const showing = getMovieGroups('showing');
  const upcoming = getMovieGroups('upcoming');

  const accentOf = (poster: string | null): string => {
    const name = posterFileName(poster);
    if (!name) return '';
    return colors[name] || '';
  };

  // ---------- 电影卡片 ----------
  //
  // 文案与详情页的 SEO 描述同源（都走 buildIntro），
  // 这样卡片上看到的与页面标题/描述是一致的。
  const movies = [...showing, ...upcoming].map((g) => {
    const a = buildIntro(g);
    const bits = [
      a.openingDate ? `${a.openingDate} 上映` : null,
      a.duration ? `${a.duration} 分鐘` : null,
      a.category ? `級別 ${a.category}` : null,
      a.language || null,
    ].filter(Boolean) as string[];

    // 评分只取 IMDb：豆瓣分对站外读者没有认知度（与详情页 SEO 摘要同一取舍）
    const rated = a.ratings.find((r) => r.source === 'imdb' && r.value != null);
    const rating = rated ? `IMDb ${rated.value!.toFixed(1)}` : '';

    // 「N 場 · M 間院線」：卡片上最有说服力的一行 ——
    // 它说明这张卡背后是实时的全港场次数据，而不是一份静态片单。
    const cinemaCount = new Set(
      g.versions.flatMap((v) => v.movieIds).length ? [] : [],
    ).size;
    void cinemaCount;
    const extra = g.totalShows > 0
      ? `${g.totalShows} 場 · ${g.sources.length} 間院線`
      : `${g.sources.length} 間院線`;

    return {
      slug: g.slug,
      title: a.title,
      subtitle: a.subtitle || '',
      meta: bits.join(' · '),
      rating,
      extra,
      poster: posterFileName(a.poster),
      accent: accentOf(a.poster),
    };
  });

  // ---------- 戏院卡片 ----------
  const cinemas = getCinemaRows().map((c) => {
    const shows = getShowsByCinema(c.id);
    const movieIds = new Set(shows.map((s) => s.movieId));
    const pills: string[] = [
      ...c.specs.map((s) => s.label),
      SOURCE_LABEL[c.source] || '',
      `${shows.length} 場 · ${movieIds.size} 部影片`,
    ].filter(Boolean);

    // 影院卡底部书架放这家戏院今天在放的片（按场次多寡取前几部）
    const countByMovie = new Map<string, number>();
    for (const s of shows) countByMovie.set(s.movieId, (countByMovie.get(s.movieId) || 0) + 1);
    const groupByMovie = new Map<string, string>();
    for (const g of [...showing, ...upcoming]) {
      for (const v of g.versions) for (const id of v.movieIds) groupByMovie.set(id, g.slug);
    }
    const posterByName = new Map<string, string>();
    for (const g of [...showing, ...upcoming]) {
      const f = posterFileName(g.displayPoster);
      if (f) posterByName.set(g.slug, f);
    }
    const posters = [...countByMovie.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => groupByMovie.get(id))
      .filter((slug): slug is string => !!slug)
      .map((slug) => posterByName.get(slug))
      .filter((f): f is string => !!f)
      .slice(0, 5);

    return {
      id: c.id,
      name: c.nameZh,
      address: c.address,
      pills,
      posters,
    };
  });

  // ---------- 固定页面的书架海报 ----------
  // 首页取场次最多的几部（= 观众最可能正在找的），待映页取即将上映的前几部
  const shelf = (groups: typeof showing, n: number) =>
    groups
      .map((g) => posterFileName(g.displayPoster))
      .filter((f): f is string => !!f)
      .slice(0, n);

  const plan = {
    generatedAt: new Date().toISOString(),
    counts: {
      showing: showing.length,
      upcoming: upcoming.length,
      cinemas: cinemas.length,
      shows: meta.counts.shows,
      sources: new Set(getCinemaRows().map((c) => c.source)).size,
    },
    homePosters: shelf(showing, 5),
    showingPosters: shelf(showing, 5),
    upcomingPosters: shelf(upcoming, 5),
    cinemaPosters: shelf(showing, 5),
    movies,
    cinemas,
  };

  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(plan, null, 2).slice(0, 4000));
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(plan));
  console.log(
    `✔ 卡片计划：${movies.length} 部电影 + ${cinemas.length} 间戏院 + 4 个固定页面 → ${path.relative(ROOT, OUT)}`,
  );
}

main();
