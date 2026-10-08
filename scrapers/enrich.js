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
import {
  crossYearOk,
  doubanSubjectById,
  isMovieSubjectUrl,
  parseDoubanCard,
  resolveDouban,
  sameSourceTitle,
  stripFormatBrands,
} from './douban-suggest.js';
import {
  imdbRatings,
  imdbUrl,
  imdbYearGateOk,
  isReissueEvidence,
  matchesDoubanYear,
  resolveImdbIds,
} from './imdb.js';

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
    .replace(/[《》]/g, ' ')
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
  // 带上去 IMDb 根本搜不到，所以额外备一份去掉括号的写法；
  // 百老汇还会把 4DX / CGS / Infinity Vision 这类冠名**裸写**在片名里，
  // 再备一份剥掉格式品牌词的写法（《復仇者聯盟4》重映实测踩过）。
  const queries = [
    ...new Set(
      names
        .flatMap((n) => (n ? [n, cleanTitle(n), stripFormatBrands(cleanTitle(n))] : []))
        .filter(Boolean)
    ),
  ];
  const cands = await resolveImdbIds(queries, year);
  if (!cands.length) return null;

  // 首选候选：先看它自己有没有分，再过年份闸门。
  //
  // 闸门顺序是有意的 —— **必须先查分才知道该不该否决**：
  //   imdbYearGateOk 只对「有分」的条目生效（无分条目多半是为这次重映
  //   新开的条目，年份天然对不上豆瓣原作年，否决它反而会误杀）。
  //   不预先取分就分不清这两种情况，所以只能多打这一次评分请求。
  //
  // 开销考虑：拿到分且过年份闸门就不再查后面的候选，
  // 否则 212 部×最多 5 个候选会把评分接口打爆。
  const first = cands[0];
  const firstRating = await imdbRatings(first.id);
  await sleep(jitter(180, 420));
  const firstHasRating = Boolean(firstRating && firstRating.rating != null);
  const firstVetoed =
    firstHasRating &&
    !imdbYearGateOk(first.year, opt.doubanYear, true, first.title, {
      venueName: opt.venueName,
      hkYear: year,
    });
  if (firstHasRating && !firstVetoed) {
    return shapeImdb(first, firstRating, cands);
  }

  // ★ 首选无分。只有拿到「真重映」的正面证据才回退到更早的原版。
  //
  // 没有证据就保留首选条目（页面显示「暫無評分」），
  // 不冒把同名旧片分数挂到新片上的风险 —— 实测 11 个回退里 7 个是这么错的。
  // 证据来自豆瓣年份，所以调用方必须**先跑豆瓣再跑 IMDb**（见 main 循环）。
  // 被年份闸门否决时**无论有没有重映证据都要继续找**：
  // 前者已确定首选是错片，后者只是没分；两种情况都得往下看候选，
  // 否则否决掉首选就直接返回，等于把这部片打成无分。
  const allow = firstVetoed || isReissueEvidence(opt.doubanYear, year);
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
  // FORCE_REFRESH 除了刷已识别的行，还要抓两类：完全没有记录的新上映影片，
  // 以及只有缺席记录且已过 7 天重试冷却的行；每一侧各自按自己的冷却判断，
  // 避免每小时对老缺席片反复搜索。
  let work = FORCE_REFRESH
    ? todo.filter((p) => {
        const row = entries[p.key];
        if (!row) return true;
        if (row.imdb?.imdbId || row.douban?.doubanId || manual[p.key]?.imdbId) return true;
        const imdbCooled =
          row.imdb?.notFound && row.updatedAt && now - Date.parse(row.updatedAt) <= 7 * 864e5;
        const doubanCooled =
          row.douban?.notFound && row.douban.at && now - Date.parse(row.douban.at) <= 7 * 864e5;
        return !imdbCooled || !doubanCooled;
      })
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

  // ★ 豆瓣健康探针（2026-10-08）
  // 接口被限流时会「HTTP 200 但 cards 为空」，单次响应无法与「确实没有
  // 这部片」区分；批量重搜会把整批写成 notFound，再被 7 天冷却锁死。
  // 用一部必然存在的片名先探一次：探针失败则本轮豆瓣整段跳过，
  // 不搜索、不写缺席，等下一轮接口恢复后自然重试。
  let doubanDegraded = false;
  let doubanDone = 0;
  let byIdFails = 0;
  let byIdDegraded = false;
  if (!NO_DUBAN && !DRY) {
    try {
      const probe = await resolveDouban({ zh: '阿凡達', en: 'Avatar', year: null });
      if (!probe) doubanDegraded = true;
    } catch {
      doubanDegraded = true;
    }
    if (doubanDegraded) log('  ⚠️ 豆瓣接口疑似限流（探针无结果），本轮跳过豆瓣搜索与缺席写入');
  }
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
    if (!NO_DUBAN && !doubanDegraded) {
      // ★ 每 30 部重探一次：限流可能在运行中途才开始
      // （实测 18:33 起跑正常、18:37 起整段返回空结果），
      // 只探开头挡不住后半程的假缺席。
      if (doubanDone > 0 && doubanDone % 30 === 0) {
        const ok = await resolveDouban({ zh: '阿凡達', en: 'Avatar', year: null }).catch(() => null);
        if (!ok) {
          doubanDegraded = true;
          log('  ⚠️ 豆瓣接口中途疑似限流，本轮余下条目跳过豆瓣搜索与缺席写入');
        }
      }
      doubanDone++;
    }
   if (!NO_DUBAN) {
     const dAt = row.douban?.at ? Date.parse(row.douban.at) : 0;
     const dFresh = row.douban && !row.douban.notFound && now - dAt <= DUBAN_REFRESH_DAYS * 864e5;
     const dRetry = row.douban?.notFound && now - dAt <= 7 * 864e5;
     // 缓存条目若被判为脏（见下方 staleDouban），dFresh/dRetry 就不再代表
     // 「当前这条缓存」，必须让搜索分支放行。
     let doubanStale = false;
      // 缓存条目已经不合法时，按 ID 刷新救不回来，必须丢回搜索重匹。
      //   两种脏数据：
      //   1) 非电影条目（book/music）。rexxar 是 movie 接口，拿这类
      //      subject id 去问只返回 null，而按 ID 分支拿到 null 只记一次
      //      byIdFails —— 脏数据永远留着，还会攒到 5 次把整条 by-ID 通道
      //      降级，害后面正常条目一起停更。2026-10-09 实测坂本日常、
      //      次第花開、chiikawa 見面場 三条对 rexxar 全返 null。
      //   2) 同源名年份不符。这类条目在 movie 域上看起来完全正常，
      //      by-ID 刷新更救不了（ID 有效，只是匹错了片），只有重新搜索
      //      才可能匹对 —— 而同源名年份闸门恰好只在搜索时生效。
      //      Queen Budapest 港映 2026 挂着《匈牙利狂想曲》1986 就是这一类。
      const staleDouban =
        Boolean(row.douban?.doubanId) &&
        (!isMovieSubjectUrl(row.douban.doubanUrl) ||
          (sameSourceTitle(p.nameZh, p.nameEn) && !crossYearOk(row.douban, p.year)));
      if (staleDouban) {
        row.douban = null;
        // 清理发生在 dFresh/dRetry 算完之后，所以那两个标志描述的仍是**旧条目**，
        //   而旧条目恰好「新鲜且不是 notFound」—— 直接沿用会把搜索分支挡掉，
        //   结果是清理了却没重搜，脏条目原地不动（2026-10-09 实测：
        //   queen budapest 连跑两次 REFRESH_DAYS=0 都仍是 1986 的《匈牙利狂想曲》）。
        //   doubanStale 的意思是「这里没有可信的新鲜度可言，本轮必须重新搜」。
        doubanStale = true;
        log('  ↻ 豆瓣 ' + (p.nameZh || p.nameEn) + ': 缓存条目已不合法，重新搜索匹对');
      }
      // ★ 已识别条目（有 doubanId）：按 ID 轻量刷新，不重新搜索片名。
      //   （走 rexxar 独立桶，即使网页端搜索被限流也照常刷新。）
      //   搜索端点是限流重灾区，而按 ID 走移动端 rexxar 独立限流桶，
      //   把每小时的搜索量从「全部条目」降到「只有未匹配的」。
      if (FORCE_REFRESH && row.douban?.doubanId && !byIdDegraded) {
        try {
          const got = await doubanSubjectById(row.douban.doubanId);
          if (got) {
            byIdFails = 0;
            // 只在拿到分时覆盖；null 保持原状态（分数极少消失，不冒清零风险）
            if (got.rating != null) {
              row.douban.rating = got.rating;
              row.douban.ratingState = 'rated';
              dbHits++;
            }
            row.douban.at = new Date().toISOString();
          } else {
            byIdFails++;
            if (byIdFails >= 5) {
              byIdDegraded = true;
              log('  ⚠️ 豆瓣按 ID 刷新连续失败（疑似限流），本轮余下条目跳过按 ID 刷新');
            }
          }
        } catch (e) {
          log('  ⚠️ 豆瓣按 ID 刷新失败: ' + (p.nameZh || p.nameEn));
        }
        await sleep(jitter(250, 450));
      } else if (
        // 未识别条目：搜索（量小，且受限流探针保护）。
        // ★ 已识别条目（有 doubanId）绝不走这里：by-ID 降级时宁可保持
        //   旧数据，也不能回退到搜索 —— 那正是限流的来源。
        // ★ 探针（网页端）失败只挡搜索：by-ID 走移动端 rexxar，是独立限流桶，
        //   网页端被限时它常常仍可用（2026-10-08 实测）。
        !doubanDegraded &&
          ((FORCE_REFRESH && !row.douban?.doubanId && (!row.douban || !dRetry)) ||
            (!FORCE_REFRESH && (doubanStale || (!dFresh && !dRetry)) && !row.douban?.doubanId))
      ) {
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
          } else if (
            !row.douban ||
            row.douban.notFound ||
            !isMovieSubjectUrl(row.douban.doubanUrl)
          ) {
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
    // ★ 已识别的行也要重跑年份闸门（2026-10-09 审计补）。
    //   by-ID 刷新只按 ID 取分、从不复核「这条 ID 还是不是这部片」，
    //   于是闸门上线前挂上的错配永远留着 —— 实测 跟蹤 港映2026 仍挂着
    //   IMDb《Following》2024（另一部片，差 17 年），而豆瓣侧已经是对的。
    //   判据与搜索侧同款：有分 + 与豆瓣原作年差过大 + 不是剧院录制形态。
    //   命中就当作「未识别」，丢掉 ID 让下面的搜索分支重新匹。
    //
    //   ★ 必须放在 retryDeferred / forceSearch **之前**：那两个条件要看
    //     清空后的状态。放在后面会让三个分支全部落空、直接 reused++，
    //     等于清了却不重搜（豆瓣侧刚踩过同一个顺序坑）。
    if (
      row.imdb?.imdbId &&
      !row.imdb.notFound &&
      row.imdb.rating != null &&
      !imdbYearGateOk(row.imdb.imdbYear, row.douban?.doubanYear, true, row.imdb.imdbTitle, {
        venueName: p.nameEn || p.nameZh,
        hkYear: p.year,
      })
    ) {
      log(
        '  ↻ IMDb ' + (p.nameZh || p.nameEn) + ': ' + row.imdb.imdbId + ' 《' +
          row.imdb.imdbTitle + '》' + row.imdb.imdbYear + ' 过年份闸门（豆瓣 ' +
          row.douban?.doubanYear + '），丢弃 ID 重新搜索',
      );
      row.imdb = null;
    }
    // ★ 豆瓣是后到的：这次 IMDb 尝试发生在豆瓣条目落地之前。
    //   豆瓣年份是 IMDb「重映回退」的**输入**（见 isReissueEvidence），
    //   当初搜索时拿不到它，判据本身就是残缺的；白等一周冷却毫无意义。
    //   实测 2026-10-09：HKJFF 等 13 部新片豆瓣先匹到、IMDb 侧因为没 ID
    //   就一直停在无分，评分卡挂着「暫無評分」直到冷却过期。
    //   这个条件是一次性的：重搜后 updatedAt 会越过 douban.at，
    //   要等豆瓣下一次刷新（14 天）才会再次成立，所以不会每小时重复敲门。
    const doubanLearnedLater =
      !ov?.imdbId &&
      !row.imdb?.imdbId &&
      row.douban?.doubanYear != null &&
      (row.douban.at ? Date.parse(row.douban.at) : 0) > iAt;
    // 没有匹配 ID 的影片不必每小时重新跑标题搜索；沿用一周重试窗口。
    const retryDeferred =
      !doubanLearnedLater &&
      FORCE_REFRESH &&
      !ov?.imdbId &&
      !row.imdb?.imdbId &&
      Number.isFinite(iAt) &&
      now - iAt <= 7 * 864e5;
    // FORCE 下没有已识别 ID 的行：新行或冷却已过的要真正发起搜索，而不是复用空记录。
    const forceSearch =
      FORCE_REFRESH && !DUBAN_ONLY && !ov?.imdbId && !row.imdb?.imdbId && !retryDeferred;
    try {
      // IMDb 也要按自己的新鲜度判：needsWork 会因为「豆瓣还没跑过」而放行，
      // 那时 IMDb 往往是刚抓的，不卡就会每轮重跑 212 次搜索。
      const iFresh =
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
        // ★ by-ID 刷新同样要过年份闸门（2026-10-09 审计补第二轮）。
        //   上面的 imdbIdStale 只在**有分**时丢弃 ID，于是重搜后停在
        //   「ID 留着、分被闸门挡掉」的状态；下一轮 FORCE 从这里按 ID
        //   取分，又把错分装了回去 —— 实测 跟蹤 的 6.5 就是这样复活的。
        //   这里补一道：刷新回来的分若仍与豆瓣原作年冲突，就不许装上。
        //   ID 仍保留（详情页链接还要用），只是不再显示分数。
        if (
          row.imdb.rating != null &&
          !imdbYearGateOk(row.imdb.imdbYear, row.douban?.doubanYear, true, row.imdb.imdbTitle, {
            venueName: p.nameEn || p.nameZh,
            hkYear: p.year,
          })
        ) {
          log(
            '  ⚠️ IMDb ' + (p.nameZh || p.nameEn) + ': ' + row.imdb.imdbId + ' 《' +
              row.imdb.imdbTitle + '》' + row.imdb.imdbYear + ' 仍过年份闸门（豆瓣 ' +
              row.douban?.doubanYear + '），不装回分数',
          );
          row.imdb.rating = null;
          row.imdb.votes = null;
        }
        if (refreshed.rating != null) hits++;
      } else if (forceSearch || (!FORCE_REFRESH && !DUBAN_ONLY && !iFresh)) {
        const hit = await fetchImdb(p.queries, p.year, {
          doubanYear: row.douban?.doubanYear ?? null,
          venueName: p.nameEn || p.nameZh,
        });
        row.imdb = hit || { notFound: true };
        if (hit?.rating != null) hits++;
      } else {
        reused++;
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
