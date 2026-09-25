#!/usr/bin/env node
/**
 * 香港电影聚合站 · 抓取主流程
 *
 * 数据源（13 条院线）：
 *  - 百老汇     cinema.com.hk      纯 fetch（Next.js RSC）
 *  - MCL        mclcinema.com      纯 fetch（ASP.NET JSON API）
 *  - 英皇       emperorcinemas.com 纯 fetch（icirena 平台，签名已离线复现）
 *  - Cinema City cinemacity.com.hk 纯 fetch（icirena 平台）
 *  - 星達       bestarfilm.hk      纯 fetch（icirena 平台）
 *  - CGV / 影藝 / 華懋 / 高先 / Lumen / Lux / 新寶 / 新光
 *
 * 2026-09-18：icirena 系从 Playwright 浏览器改为纯 HTTP。
 *   签名算法已从 webpack 模块提取（详见 scrapers/icirena-http.js），
 *   抓取耗时 400s → 15s，内存 740MB → 数十 MB，
 *   656MB 的 Chromium 依赖已完全移除。
 *
 * 2026-09-19：修好 icirena 场次的「静默空结果」。
 *   filmschedule.list 漏传 showDate 时会返回 bizCode=0 + 空数组，
 *   导致三家院线长期 0 场次。改为按「影片 × 日期」矩阵拉取后，
 *   总场次 4194 → 6498（+2304）。详见 scrapers/icirena-http.js。
 *
 * 用法：
 *   node scrape.js                       # 全部院线
 *   ONLY=broadway,mcl node scrape.js     # 指定院线
 *   NO_SCHEDULE=1 node scrape.js         # 跳过场次（快速模式）
 *
 * 环境变量：
 *   MCL_PROXY      大陆网络需香港出口（香港 VPS 留空）
 *   ONLY           只抓指定院线（逗号分隔）
 *   NO_SCHEDULE=1  跳过 icirena 系院线的场次抓取
 *   MAX_MOVIES=N   限制每院线影片数（调试）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scrapeBroadway } from './scrapers/broadway.js';
import { scrapeMcl } from './scrapers/mcl.js';
import { scrapeIcirena, CHANNELS } from './scrapers/icirena-http.js';
import { normalizeIcirena } from './scrapers/icirena.js';
import { scrapeCgv, scrapeCineArt } from './scrapers/grabticks.js';
import { scrapeChinachem, scrapeGoldenScene, scrapeLumen, scrapeLuxDirectory, scrapeNewport, scrapeSunbeam } from './scrapers/other-circuits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data');

const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const NO_SCHEDULE = process.env.NO_SCHEDULE === '1';
const MAX_MOVIES = Number(process.env.MAX_MOVIES || 0);

const want = (name) => ONLY.length === 0 || ONLY.includes(name);

/** 统一 slug 生成 */
/**
 * 统一 slug 生成（**只输出 ASCII**）
 *
 * ⚠️ 为什么不能用中文 slug：
 *   MCL 院线没有英文名（nameEn 为空），slugify 会退回中文片名，
 *   生成如「生化危機-mcl-14789」的 slug。
 *   实测这类中文 slug 在 Next.js 动态路由 /movie/[slug] 下**全部 404**
 *   （线上曾有 13/25 的首页卡片指向 404 —— 即用户反馈的
 *    「点进去没有排片只有介绍」的真实来源之一）。
 *
 *   故这里只保留 [a-z0-9]，中文部分被剔除；若结果为空则用 movie-{id} 兜底，
 *   id 本身含院线前缀与数字，天然唯一且全 ASCII。
 */
function slugify(nameZh, nameEn, id) {
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
 * 汇总多源数据（**不做影片合并**）
 *
 * 为什么不在这里合并：
 *   分组逻辑属于「展示层」职责，由 lib/data.ts 的 getMovieGroups 完成。
 *   抓取层只负责如实收集各院线的原始条目——包括同一院线的多个放映格式
 *   （IMAX / 4DX / 全景声…），这些版本信息必须保留，
 *   否则详情页的「版本及场次」分类就没了。
 *
 *   数据层会按「归一化片名」分组为电影，再按「放映格式」分组为版本，
 *   并把各院线同格式的场次合并到一起。
 */
function collectAll(sources) {
  const movies = [];
  const cinemas = [];
  const shows = [];
  const seenMovie = new Set();
  const seenCinema = new Set();

  for (const [, data] of Object.entries(sources)) {
    for (const m of data.movies || []) {
      if (!m?.id || seenMovie.has(m.id)) continue;
      seenMovie.add(m.id);
      // 补 slug（详情页路由用）
      if (!m.slug) m.slug = slugify(m.nameZh, m.nameEn, m.id);
      movies.push(m);
    }
    for (const c of data.cinemas || []) {
      if (!c?.id || seenCinema.has(c.id)) continue;
      seenCinema.add(c.id);
      cinemas.push(c);
    }
    for (const s of data.shows || []) {
      shows.push(s);
    }
  }

  return { movies, cinemas, shows };
}

// 全部已知院线（用于合并时补齐本次未运行的源）
const KNOWN_SOURCES = ['broadway', 'mcl', 'emperor', 'cinemacity', 'bestar', 'cgv', 'chinachem', 'cineart', 'goldenscene', 'lumen', 'lux', 'newport', 'sunbeam'];

// ---------- 增量落盘 ----------
//
// 背景（线上事故）：抓取是「先跑完全部院线，最后统一写文件」。
// 一旦某个院线卡住把整个进程拖到被 systemd SIGKILL，
// 前面已经抓到的百老汇(1396 场) / MCL(1685 场) 全部丢失，
// 站点只剩上一次的残留数据 —— 这就是「页面只有英皇系影院」的真正原因。
//
// 改法：每个院线抓完立刻写一份快照 data/sources/<name>.json。
// 下次运行时，本次失败的院线自动沿用上次快照，
// 保证任何一次崩溃都不会让数据倒退。
const SRC_DIR = path.join(OUT, 'sources');

function saveSource(name, data) {
  try {
    fs.mkdirSync(SRC_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SRC_DIR, `${name}.json`),
      JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 1)
    );
  } catch (e) {
    console.warn(`  ⚠️ 保存 ${name} 快照失败: ${e.message}`);
  }
}

function loadSource(name, maxAgeMs) {
  try {
    const p = path.join(SRC_DIR, `${name}.json`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const age = Date.now() - new Date(j.savedAt || 0).getTime();
    if (!Number.isFinite(age) || age > maxAgeMs) return null;
    return j;
  } catch {
    return null;
  }
}

// ---------- 主流程 ----------
async function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });

  const errors = [];
  const sources = {};

  const log = (s) => console.log(s);

  // 上次快照的兜底有效期：24 小时（超过就宁可不展示，避免展示过期场次）
  const STALE_MS = 24 * 3600_000;

  // ---------- 1. 百老汇 ----------
  if (want('broadway')) {
    log('▶ 百老匯 ...');
    try {
      // concurrency 从 5 降到 2：2C2G 机器上并发过高会与其他服务抢 CPU
      const d = await scrapeBroadway({ withDetails: true, concurrency: 2 });
      sources.broadway = { movies: d.movies, cinemas: d.cinemas, shows: d.shows };
      saveSource('broadway', sources.broadway);
      log(`  影片 ${d.movies.length} | 影院 ${d.cinemas.length} | 場次 ${d.shows.length}`);
    } catch (e) {
      log(`  ⚠️ 失敗: ${e.message}`);
      errors.push({ source: 'broadway', error: e.message });
      const fb = loadSource('broadway', STALE_MS);
      if (fb) {
        sources.broadway = fb;
        log(`  ↩ 沿用上次快照（${fb.savedAt}）`);
      }
    }
  }

  // ---------- 2. MCL ----------
  if (want('mcl')) {
    const proxy = process.env.MCL_PROXY;
    log(`▶ MCL ${proxy ? `(proxy=${proxy})` : '（直連）'} ...`);
    try {
      const d = await scrapeMcl({ proxy });
      sources.mcl = d;
      saveSource('mcl', d);
      log(`  影片 ${d.movies.length} | 影院 ${d.cinemas.length} | 場次 ${d.shows.length}`);
    } catch (e) {
      log(`  ⚠️ 失敗: ${e.message}`);
      errors.push({ source: 'mcl', error: e.message });
      const fb = loadSource('mcl', STALE_MS);
      if (!fb) {
        const directory = loadSource('mcl', Number.POSITIVE_INFINITY);
        if (directory) {
          sources.mcl = { movies: [], cinemas: directory.cinemas || [], shows: [] };
          log('  ↩ 保留 MCL 戲院卡，略過過期場次（' + directory.savedAt + '）');
        }
      }
      if (fb) {
        sources.mcl = fb;
        log(`  ↩ 沿用上次快照（${fb.savedAt}）`);
      }
    }
  }

  // ---------- 3. icirena 系（英皇 / Cinema City / 星達）----------
  const proxy = process.env.MCL_PROXY; // 同一代理即可（香港出口）
  for (const ch of ['emperor', 'cinemacity', 'bestar']) {
    if (!want(ch)) continue;
    const cfg = CHANNELS[ch];
    log(`▶ ${cfg.name}（icirena）...`);
    try {
      const raw = await scrapeIcirena({
        channel: ch,
        proxy,
        withSchedule: !NO_SCHEDULE,
        maxMovies: MAX_MOVIES,
        onProgress: (m) => log(`  ${m}`),
      });
      const n = normalizeIcirena(raw);

      // ★ 场次为 0 视为「不完整」。
      //
      //   历史上有两个成因：
      //     1) 浏览器抓取被资源限制拖垮，只拿到影片列表（已改为纯 HTTP）
      //     2) icirena 的 filmschedule.list 漏传 showDate → 静默返回空数组
      //        （2026-09-19 修复，详见 scrapers/icirena-http.js）
      //
      //   无论如何，直接覆盖会让站点出现「点进电影只有简介没有排片」，
      //   故保留这道兜底：场次为 0 时沿用上次快照。
      if (n.shows.length === 0 && n.movies.length > 0) {
        log(`  ⚠️ 場次為 0，視為不完整`);
        const fb = loadSource(ch, STALE_MS);
        if (fb && (fb.shows || []).length > 0) {
          sources[ch] = fb;
          log(`  ↩ 沿用上次快照（${fb.savedAt}），避免排片被清空`);
        } else {
          sources[ch] = n;
        }
        errors.push({ source: ch, error: 'schedules empty (partial)' });
      } else {
        sources[ch] = n;
        saveSource(ch, n);
      }
      log(`  影片 ${n.movies.length} | 影院 ${n.cinemas.length} | 場次 ${n.shows.length}`);
    } catch (e) {
      log(`  ⚠️ 失敗: ${e.message}`);
      errors.push({ source: ch, error: e.message });
      const fb = loadSource(ch, STALE_MS);
      if (fb) {
        sources[ch] = fb;
        log(`  ↩ 沿用上次快照（${fb.savedAt}）`);
      }
    }
  }

  const extraScrapers = [
    ['cgv', () => scrapeCgv({ maxMovies: MAX_MOVIES })],
    ['chinachem', scrapeChinachem],
    ['cineart', scrapeCineArt],
    ['goldenscene', () => scrapeGoldenScene({ maxMovies: MAX_MOVIES })],
    ['lumen', scrapeLumen],
    ['lux', scrapeLuxDirectory],
    ['newport', scrapeNewport],
    ['sunbeam', scrapeSunbeam],
  ];
  for (const [name, scrape] of extraScrapers) {
    if (!want(name)) continue;
    log('▶ ' + name + ' ...');
    try {
      const data = await scrape();
      if (!data.cinemas.length || !data.shows.length) throw new Error('incomplete cinema/show data');
      sources[name] = data;
      saveSource(name, data);
      log('  影片 ' + data.movies.length + ' | 影院 ' + data.cinemas.length + ' | 場次 ' + data.shows.length);
    } catch (error) {
      log('  ⚠️ 失敗: ' + error.message);
      errors.push({ source: name, error: error.message });
      const fallback = loadSource(name, STALE_MS);
      if (fallback) {
        sources[name] = fallback;
        log('  ↩ 沿用上次快照（' + fallback.savedAt + '）');
      }
    }
  }

  // ---------- 合并 ----------
  //
  // ★ 关键：把本次没跑的院线也合并进来（读它们的快照）
  //
  // 背景：抓取已拆成 light(百老汇/MCL) 与 heavy(icirena) 两次独立运行。
  // 若只合并本次跑到的源，后跑的那次会把先跑的结果覆盖掉 ——
  // 表现为「站点院线数量来回跳」。
  // 因此这里扫描 sources/ 下全部快照，本次未运行的源一并纳入合并。
  for (const name of KNOWN_SOURCES) {
    if (sources[name]) continue; // 本次已抓到（含失败回退），优先用它
    const snap = loadSource(name, STALE_MS);
    if (snap && ((snap.shows || []).length > 0 || (snap.cinemas || []).length > 0)) {
      sources[name] = snap;
      log(`  ＋ 并入快照 ${name}（${snap.savedAt}）`);
    }
  }

  const { movies, cinemas, shows } = collectAll(sources);

  log(`\n▶ 合併：影片 ${movies.length} | 影院 ${cinemas.length} | 場次 ${shows.length}`);

  const meta = {
    lastUpdated: new Date().toISOString(),
    sources: Object.keys(sources),
    counts: {
      movies: movies.length,
      showing: movies.filter((m) => m.status === 'showing').length,
      upcoming: movies.filter((m) => m.status === 'upcoming').length,
      cinemas: cinemas.length,
      shows: shows.length,
    },
    errors,
    durationMs: Date.now() - t0,
  };

  // ---------- 降级保护 ----------
  if (movies.length === 0 || shows.length === 0) {
    console.error('✖ 抓取結果為空，拒絕寫入（保留上次資料）');
    process.exit(1);
  }

  // ---------- 完整性自检 ----------
  const movieIds = new Set(movies.map((m) => m.id));
  const cinemaIds = new Set(cinemas.map((c) => c.id));
  const orphanShows = shows.filter((s) => !movieIds.has(s.movieId) || !cinemaIds.has(s.cinemaId));
  const noBooking = shows.filter((s) => !s.bookingUrl);

  meta.integrity = {
    orphanShows: orphanShows.length,
    showsWithoutBookingUrl: noBooking.length,
    moviesWithoutPoster: movies.filter((m) => !m.poster).length,
    cinemasWithoutAddress: cinemas.filter((c) => !c.address).length,
  };

  if (orphanShows.length > 0) {
    console.warn(`  ⚠️ 懸空場次 ${orphanShows.length} 條`);
    errors.push({ source: 'merge', error: `orphan shows: ${orphanShows.length}` });
  }
  if (noBooking.length > 0) {
    console.warn(`  ⚠️ 缺購票連結 ${noBooking.length} 條`);
  }

  // ---------- 写入 ----------
  fs.writeFileSync(path.join(OUT, 'movies.json'), JSON.stringify(movies, null, 1));
  fs.writeFileSync(path.join(OUT, 'shows.json'), JSON.stringify(shows, null, 1));
  fs.writeFileSync(path.join(OUT, 'cinemas.json'), JSON.stringify(cinemas, null, 1));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

  log(`\n✅ 完成，耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log('  ' + JSON.stringify(meta.counts));
  log('  完整性: ' + JSON.stringify(meta.integrity));
  if (errors.length) log(`  錯誤 ${errors.length} 項`);

  // 按院线统计
  const bySource = {};
  for (const s of shows) {
    bySource[s.source] = (bySource[s.source] || 0) + 1;
  }
  log('  場次分布: ' + JSON.stringify(bySource));
}

main().catch((e) => {
  console.error('✖ 抓取失敗:', e.message);
  process.exit(1);
});
