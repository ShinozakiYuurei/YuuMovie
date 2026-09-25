#!/usr/bin/env node
/**
 * 补充数据抓取：IMDb / 豆瓣评分
 *
 * 院线结构化数据不提供外部评分；此脚本独立抓取并缓存 IMDb 与豆瓣评分。
 *
 * 评分通过独立缓存 data/enrich.json 保存，定时任务可单独刷新评分，不必重抓院线数据。
 * 发行商在院线数据、豆瓣、IMDb 三处都没有可靠来源，未做。
 *
 * ★ 为什么单独存 data/enrich.json 而不写进 movies.json：
 *   movies.json 每 2–6 小时被 scrape.js 整体重写，评分混进去会被冲掉；
 *   而且外部源字段不该混进「院线原始数据」这一层 ——
 *   分开存，谁重跑都不影响对方，出问题能单独回滚。
 *
 * 链路：片名 → v3.sg.media-imdb.com/suggestion → tt id → api.agregarr.org 评分
 *
 * 用法（在 VPS 上跑）：
 *   node scrapers/enrich.js                 # 增量补全
 *   LIMIT=20 node scrapers/enrich.js        # 只跑前 20 部
 *   ONLY=坂本,超風 node scrapers/enrich.js  # 只跑片名含这些词的
 *   REFRESH_DAYS=0 node scrapers/enrich.js  # 全部重抓（刷新评分）
 *   DUBAN_ONLY=1 只跑豆瓣不动 IMDb         NO_DUBAN=1 关掉豆瓣
 *   FORCE_REFRESH=1 node scrapers/enrich.js # 忽略缓存新鲜度，强制刷新评分
 *   DRY=1 node scrapers/enrich.js           # 不发请求，只看计划
 *
 * 节流：查询逐片串行，定时强制刷新时豆瓣请求间隔 0.25–0.45s。
 * 中断安全：每部首写盘一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enrichKey } from '../lib/enrich-key.js';
import { parseDoubanCard, resolveDouban } from './douban-suggest.js';
import { imdbRatings, imdbUrl, isReissueEvidence, matchesDoubanYear, resolveImdbIds } from './imdb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data');
const CACHE_FILE = path.join(OUT, 'enrich.json');
const MANUAL_FILE = path.join(OUT, 'enrich-manual.json');

const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = process.env.DRY === '1';
/** 定时评分刷新时强制更新缓存里已有 ID 的评分，避免重复标题搜索。 */
const FORCE_REFRESH = process.env.FORCE_REFRESH === '1';
/** 评分会变动，默认 3 天刷新一次（比数据刷新慢，比重映一年一次快） */
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS ?? 3);
/**
 * 豆瓣刷新周期（天）
 *
 * 比 IMDb 长：豆瓣接口在 robots.txt 的 Disallow: /j/ 下（用户已批准使用），
 * 拉长周期是少敲门。新片的分从「暂无」变成有分，靠这个周期而不是实时。
 */
const DUBAN_REFRESH_DAYS = Number(process.env.DUBAN_REFRESH_DAYS ?? 14);
/** 关掉豆瓣（合规顾虑或接口挂时用） */
const NO_DUBAN = process.env.NO_DUBAN === '1';
/** 只跑豆瓣、不动 IMDb（首轮补数据用，省一半请求） */
const DUBAN_ONLY = process.env.DUBAN_ONLY === '1';

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 原子写：避免定时器与人工同时跑时写出半个文件 */
function writeJson(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

const yearOf = (d) => {
  const m = /^(\d{4})/.exec(d || '');
  return m ? Number(m[1]) : null;
};

/** 去掉片名里的院线附加标记，例如「M (GFF)」「恨世者(NT Live 2026-27)」 */
const cleanTitle = (s) =>
  (s || '')
    .replace(/[（(〔[【{「『][^）)〕\]】}」』]*[）)〕\]】}」』]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 是否需要（重）抓
 *
 * notFound 也要缓存：否则一部确实没上 IMDb 的冷门片每轮都会白查两次。
 * 但给更短的重试周期（7 天），因为新片可能随后才登记。
 *
 * 豆瓣单独判：它是新接的源，旧缓存里**没有 douban 字段**，
 * 不能因为 IMDb 新鲜就跳过豆瓣，否则老数据永远补不上评分。
 */
function needsWork(row, now) {
  if (!row) return true;
  // 先查全量刷新开关：notFound 的短路必须放在后面，
  // 否则 REFRESH_DAYS=0（强制重抓）会被 7 天重试期顶掉，一都部不跑。
  if (REFRESH_DAYS === 0) return true;
  const at = row.updatedAt ? Date.parse(row.updatedAt) : 0;
  const fresh = row.imdb && !row.imdb.notFound && now - at <= REFRESH_DAYS * 864e5;
  if (NO_DUBAN) return !fresh;
  if (!row.douban) return true; // 豆瓣还没跑过
  const dAt = row.douban.at ? Date.parse(row.douban.at) : 0;
  const dFresh = now - dAt <= DUBAN_REFRESH_DAYS * 864e5;
  if (row.douban.notFound) return !(fresh && now - dAt <= 7 * 864e5); // 查过但没有，一周后重试
  return !(fresh && dFresh);
}

/**
 * 组装 IMDb 结果对象（首选 / 回退共用）
 */
function shapeImdb(pick, rating, cands, extra = {}) {
  return {
    imdbId: pick.id,
    imdbUrl: imdbUrl(pick.id),
    imdbTitle: pick.title || null,
    imdbYear: pick.year || null,
    // rating 为 null 是合法状态：条目存在但人数不足，尚未出分
    rating: rating ? rating.rating : null,
    votes: rating ? rating.votes : null,
    queriedWith: pick.query,
    relaxedYear: pick.relaxedYear || undefined,
    // 实际展示的不是首选条目（发生了重映回退），记下来源便于事后查错
    fallbackFrom: pick.id === cands[0].id ? undefined : cands[0].id,
    candidates: cands.map((c) => `${c.id}:${c.year ?? '?'}:${c.s}`).slice(0, 4),
    ...extra,
  };
}

async function fetchImdb(names, year, opt = {}) {
  // 括号里往往是院线自己的标记（(GFF) / (IMAX) / (The Royal Ballet 2026 – 2027)），
  // 带上去 IMDb 根本搜不到，所以额外备一份去掉括号的写法。
  const queries = [...new Set(names.flatMap((n) => (n ? [n, cleanTitle(n)] : [])).filter(Boolean))];
  const cands = await resolveImdbIds(queries, year);
  if (!cands.length) return null;

  // 首选候选：先看它自己有没有分。
  // 开销考虑：拿到分就不再查后面的候选，否则 212 部×最多 5 个候选会把评分接口打爆。
  const first = cands[0];
  const firstRating = await imdbRatings(first.id);
  await sleep(jitter(180, 420));
  if (firstRating && firstRating.rating != null) {
    return shapeImdb(first, firstRating, cands);
  }

  // ★ 首选无分。只有拿到「真重映」的正面证据才回退到更早的原版。
  //
  // 没有证据就保留首选条目（页面显示「暫無評分」），
  // 不冒把同名旧片分数挂到新片上的风险 —— 实测 11 个回退里 7 个是这么错的。
  // 证据来自豆瓣年份，所以调用方必须**先跑豆瓣再跑 IMDb**（见 main 循环）。
  const allow = isReissueEvidence(opt.doubanYear, year);
  let best = null;
  if (allow) {
    for (let idx = 1; idx < cands.length; idx++) {
      const c = cands[idx];
      // 第二道闸门：这条候选的年份得跟豆瓣原作年对得上，
      // 否则只是「另一部同名老片」（恨世者/天鵝湖 实测踩过）。
      if (!matchesDoubanYear(c.year, opt.doubanYear)) continue;
      const r = await imdbRatings(c.id);
      await sleep(jitter(180, 420));
      if (r && r.rating != null) { best = { c, r }; break; }
    }
  }
  return best
    ? shapeImdb(best.c, best.r, cands)
    : shapeImdb(first, null, cands, { reissueEvidence: allow });
}

/**
 * 已知 tt id 时直接取分（人工指定用）
 *
 * 片名自动匹配偶尔会撞到同名旧片（尤其短片/电视电影），
 * 这时候不必跟算法绕，data/enrich-manual.json 里写死 imdbId 即可。
 */
async function fetchImdbById(imdbId, previous = null) {
  const r = await imdbRatings(imdbId);
  await sleep(jitter(250, 600));
  return {
    ...previous,
    imdbId,
    imdbUrl: previous?.imdbUrl || imdbUrl(imdbId),
    imdbTitle: previous?.imdbTitle || null,
    imdbYear: previous?.imdbYear || null,
    rating: r ? r.rating : null,
    votes: r ? r.votes : null,
    queriedWith: previous?.queriedWith || 'manual',
  };
}

async function main() {
  const movies = readJson(path.join(OUT, 'movies.json'), []);
  if (!movies.length) {
    console.error('✖ data/movies.json 为空，先跑 node scrape.js');
    process.exit(1);
  }
  const manual = readJson(MANUAL_FILE, {});
  const cache = readJson(CACHE_FILE, { version: 2, updatedAt: null, entries: {} });
  const entries = cache.entries || {};

  // ---------- 按 enrichment key 去重 ----------
  // 同一部电影在多家院线各有一条，但评分只需查一次。
  const plan = new Map();
  for (const m of movies) {
    const nameZh = m.nameZh || '';
    const nameEn = m.nameEn || '';
    const key = enrichKey(nameZh || nameEn);
    if (!key) continue;
    const cur = plan.get(key);
    const year = yearOf(m.openingDate);
    if (!cur) {
      plan.set(key, {
        key,
        nameZh,
        nameEn,
        year,
        // IMDb 匹配用英文名命中率最高，中文名为辅
        queries: [nameEn, nameZh].filter(Boolean),
        ids: [m.id],
      });
    } else {
      cur.ids.push(m.id);
      if (!cur.year && year) cur.year = year;
      if (!cur.nameZh && nameZh) cur.nameZh = nameZh;
      if (!cur.nameEn && nameEn) cur.nameEn = nameEn;
      for (const n of [nameEn, nameZh]) if (n && !cur.queries.includes(n)) cur.queries.push(n);
    }
  }

  const now = Date.now();
  let todo = [...plan.values()];
  if (ONLY.length) {
    todo = todo.filter((p) => ONLY.some((s) => p.key.includes(enrichKey(s)) || p.key.includes(s.toLowerCase())));
  }
  let work = FORCE_REFRESH
    ? todo.filter((p) => entries[p.key]?.imdb?.imdbId || entries[p.key]?.douban?.doubanId || manual[p.key]?.imdbId)
    : todo.filter((p) => needsWork(entries[p.key], now));
  // DUBAN_ONLY：IMDb 已经新，不想重跑那 212 次搜索，只补豆瓣
  if (DUBAN_ONLY && !FORCE_REFRESH) {
    work = todo.filter((p) => {
      const row = entries[p.key];
      if (!row?.douban) return true;
      const dAt = row.douban.at ? Date.parse(row.douban.at) : 0;
      return row.douban.notFound ? now - dAt > 7 * 864e5 : now - dAt > DUBAN_REFRESH_DAYS * 864e5;
    });
  }
  const list = LIMIT > 0 ? work.slice(0, LIMIT) : work;

  log(`▶ 补充数据：唯一影片 ${plan.size} | 待抓 ${work.length} | 本次 ${list.length} | 复用 ${todo.length - work.length}`);
  if (DRY) {
    for (const p of list.slice(0, 40)) log(`  · ${p.nameZh || p.nameEn} → key="${p.key}" year=${p.year ?? '-'}`);
    log('▶ DRY=1，未发请求');
    return;
  }

  let done = 0;
  let hits = 0;
  let reused = 0;
  let dbHits = 0;
  const t0 = Date.now();

  function commit(row) {
    entries[row.key] = row;
    cache.entries = entries;
    cache.updatedAt = new Date().toISOString();
    const all = Object.values(entries);
    cache.counts = {
      entries: all.length,
      withRating: all.filter((e) => e.imdb?.rating != null).length,
      notFound: all.filter((e) => e.imdb?.notFound).length,
      doubanRating: all.filter((e) => e.douban?.rating != null).length,
      doubanMissing: all.filter((e) => !e.douban || e.douban.notFound).length,
      manual: Object.keys(manual).length,
    };
    writeJson(CACHE_FILE, cache);
  }

  for (const p of list) {
    const prev = entries[p.key] || {};
    const row = {
      ...prev,
      key: p.key,
      movieIds: p.ids,
      nameZh: p.nameZh || null,
      nameEn: p.nameEn || null,
      year: p.year ?? null,
    };
    const ov = manual[p.key];
    if (ov) row.manual = ov;

    // ---------- 豆瓣 ----------
    // ★ 必须先跑豆瓣再跑 IMDb：IMDb 的「重映回退」要拿豆瓣年份当证据
    //   （见 isReissueEvidence）。豆瓣挂了不影响 IMDb，两个 try 各自独立。
    // 已有 douban 且未过期时不重查（刷新周期比 IMDb 长）。
    if (!NO_DUBAN) {
      const dAt = row.douban?.at ? Date.parse(row.douban.at) : 0;
      const dFresh = row.douban && !row.douban.notFound && now - dAt <= DUBAN_REFRESH_DAYS * 864e5;
      const dRetry = row.douban?.notFound && now - dAt <= 7 * 864e5;
      // 每小时强制刷新只查询已识别的豆瓣条目；无 ID 的影片沿用普通增量周期，
      // 避免反复搜索尚未上映/未匹配的片名。
      if ((FORCE_REFRESH && row.douban?.doubanId) || (!FORCE_REFRESH && !dFresh && !dRetry)) {
        try {
          const previousDouban = row.douban;
          const found = await resolveDouban({ zh: p.nameZh, en: p.nameEn, year: p.year });
          if (found) {
            const parsed = parseDoubanCard(found.card);
            row.douban = {
              ...parsed,
              queriedWith: found.queriedWith,
              alternatives: found.alternatives,
              at: new Date().toISOString(),
            };
            // 相同豆瓣条目偶发回传「暂无评分」时保留已知分数，避免一次异常响应清空评分。
            if (parsed.rating == null && previousDouban?.doubanId === parsed.doubanId && previousDouban.rating != null) {
              row.douban.rating = previousDouban.rating;
              row.douban.ratingState = 'rated';
            }
            if (parsed.rating != null) dbHits++;
          } else if (!row.douban || row.douban.notFound) {
            row.douban = { notFound: true, at: new Date().toISOString() };
          }
        } catch (e) {
          log(`  ⚠️ 豆瓣 ${p.nameZh || p.nameEn}: ${e.message}`);
        } finally {
          // 豆瓣评分每小时刷新时仍逐片节流，避免把所有查询集中成突发请求。
          if (FORCE_REFRESH) await sleep(jitter(250, 450));
        }
      }
    }

    // ---------- IMDb ----------
    // 时间戳在 row 顶层（updatedAt），imdb 子对象里没这个字段。
    const iAt = row.updatedAt ? Date.parse(row.updatedAt) : 0;
    // 没有匹配 ID 的影片不必每小时重新跑标题搜索；沿用一周重试窗口。
    const retryDeferred =
      FORCE_REFRESH && !ov?.imdbId && !row.imdb?.imdbId && Number.isFinite(iAt) && now - iAt <= 7 * 864e5;
    try {
      // IMDb 也要按自己的新鲜度判：needsWork 会因为「豆瓣还没跑过」而放行，
      // 那时 IMDb 往往是刚抓的，不卡就会每轮重跑 212 次搜索。
      const iFresh =
        (FORCE_REFRESH && !row.imdb?.imdbId && !ov?.imdbId) ||
        retryDeferred ||
        (!FORCE_REFRESH &&
          (DUBAN_ONLY ||
            (REFRESH_DAYS !== 0 &&
              !!row.imdb &&
              (row.imdb.notFound ? now - iAt <= 7 * 864e5 : now - iAt <= REFRESH_DAYS * 864e5))));
      if (ov?.imdbId && !DUBAN_ONLY) {
        const refreshed = await fetchImdbById(ov.imdbId, row.imdb);
        const sameId = row.imdb?.imdbId === refreshed.imdbId;
        row.imdb = {
          ...row.imdb,
          ...refreshed,
          rating: refreshed.rating ?? (sameId ? row.imdb?.rating : null) ?? null,
          votes: refreshed.rating != null ? refreshed.votes : sameId ? row.imdb?.votes ?? null : null,
        };
        if (row.imdb.rating != null) hits++;
      } else if (FORCE_REFRESH && row.imdb?.imdbId && !row.imdb.notFound && !DUBAN_ONLY) {
        const refreshed = await fetchImdbById(row.imdb.imdbId, row.imdb);
        row.imdb = {
          ...row.imdb,
          ...refreshed,
          rating: refreshed.rating ?? row.imdb.rating ?? null,
          votes: refreshed.rating != null ? refreshed.votes : row.imdb.votes ?? null,
        };
        if (refreshed.rating != null) hits++;
      } else if (FORCE_REFRESH || DUBAN_ONLY || iFresh) {
        reused++;
      } else {
        const hit = await fetchImdb(p.queries, p.year, {
          doubanYear: row.douban?.doubanYear ?? null,
        });
        row.imdb = hit || { notFound: true };
        if (hit?.rating != null) hits++;
      }
    } catch (e) {
      log(`  ⚠️ IMDb ${p.nameZh || p.nameEn}: ${e.message}`);
    }

    // 未匹配 IMDb ID 的影片若尚在一周重试冷却期，保留原更新时间，避免每小时刷新把冷却永久延长。
    if (!retryDeferred) row.updatedAt = new Date().toISOString();
    commit(row);
    done++;
    if (done % 25 === 0) {
      const per = (Date.now() - t0) / done / 1000;
      log(`  … ${done}/${list.length}（${per.toFixed(1)}s/部，剩余约 ${(((list.length - done) * per) / 60).toFixed(1)} 分）`);
    }
  }

  log(`\n✅ 完成 ${done} 部（IMDb 新拿分 ${hits}，复用 ${reused}；豆瓣新拿分 ${dbHits}），耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  log('  ' + JSON.stringify(cache.counts));
}

main().catch((e) => {
  console.error('✖ 抓取失败:', e.message);
  process.exit(1);
});
