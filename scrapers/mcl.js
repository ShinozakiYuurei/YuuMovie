/**
 * MCL 院线抓取器
 *
 * 数据源：https://www.mclcinema.com/MCLWebAPI2/
 *  - GetNowShowingGrid.aspx?l=zh-TW  → 影片清单（id / 片名 / 海报）
 *  - GetNowShowingList.aspx?l=zh-TW  → 场次（影院 / 版本 / 时间 / 余座）
 *  - GetMovieDetails.aspx?l=zh-TW&t=s&id=<数字ID>&r=beim → 院线官方资料
 *
 * 购票深链：MCLSelectSeat.aspx?visLang=zh-TW&ci={影院码}&si={场次ID}
 *
 * ⚠️ MCL 在中国大陆网络不可达（TCP 超时），需香港出口 IP。
 *    通过 MCL_PROXY 环境变量传入代理，例如 http://127.0.0.1:10010
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// https-proxy-agent 按需加载：香港 VPS 直连 MCL 时无需该依赖，
// 缺失也不影响（避免部署环境依赖不全导致启动失败）。
let _HttpsProxyAgent = null;
async function getProxyAgent(proxy) {
  if (!proxy) return undefined;
  if (!_HttpsProxyAgent) {
    try {
      ({ HttpsProxyAgent: _HttpsProxyAgent } = await import('https-proxy-agent'));
    } catch (e) {
      throw new Error(
        '指定了 MCL_PROXY 但缺少 https-proxy-agent 依赖。' +
          '本机若可直连 MCL，请勿设置 MCL_PROXY。'
      );
    }
  }
  return new _HttpsProxyAgent(proxy);
}

const BASE = 'https://www.mclcinema.com';
const API = `${BASE}/MCLWebAPI2`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LANG = 'zh-TW';
const DETAIL_CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mcl-details.json');
const DETAIL_TTL_MS = 86400_000; // 完整资料每天刷新一次
const INCOMPLETE_DETAIL_TTL_MS = 2 * 3600_000; // 缺级别/片长等时下轮排片重查
const HK_CATEGORIES = new Set(['I', 'IIA', 'IIB', 'III']);

/** 与 scrape.js 的 ASCII slug 算法一致，但 MCL 固定从中文原片名生成。
 *  新补英文名不应改掉已经发布的 /movie/movie-mcl-14743 等旧链接。 */
function mclSlug(title, id) {
  const base = (title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-mcl-${id}` : `movie-mcl-${id}`;
}

/** MCL 不给英文片名。只对已逐一核对 MCL 导演/演员/剧情与 TMDB 的两部补英文名。 */
const VERIFIED_ENGLISH_TITLES = new Map([
  ['14743|以你的名字呼喚我 (特別放映)', 'Call Me by Your Name'], // TMDB movie/398818
  ['14855|《情書》30周年修復版 (「相約在The One」特別放映)', 'Love Letter'], // TMDB movie/47002
]);

/** MCL 的简介/演员是 HTML；先转纯文字，不把院线返回的标记带入资料卡。 */
function plainText(value) {
  if (typeof value !== 'string') return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value
    .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
      const hex = entity[1]?.toLowerCase() === 'x';
      const n = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n) : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 只接纳与列表 ID、标题均一致的官方详情。新数据/缓存均走这道校验，
 * 防止 MCL 复用数字 ID 或详情接口返回其他电影时误填整张资料卡。
 */
export function parseMclMovieDetails(raw, id, title) {
  const info = Array.isArray(raw) && raw.length === 1 ? raw[0] : null;
  if (!info || !/^\d+$/.test(String(id)) || Number(info.id) !== Number(id) ||
      typeof info.mn !== 'string' || info.mn.normalize('NFKC').trim() !== title.normalize('NFKC').trim()) return null;

  const b = info.b || {};
  const e = info.e || {};
  const durationText = plainText(b.mrt);
  const durationMatch = /^(\d{1,3})(?:\s*(?:分鐘|分|minutes?|mins?))?$/i.exec(durationText);
  const duration = durationMatch && Number(durationMatch[1]) > 0 && Number(durationMatch[1]) <= 400
    ? Number(durationMatch[1]) : null;
  const category = plainText(b.mc).toUpperCase();
  const genreText = plainText(b.mg).replace(/\s*[（(]特備節目[）)]\s*/g, '');
  return {
    nameEn: VERIFIED_ENGLISH_TITLES.get(`${id}|${info.mn}`) || '',
    duration,
    category: HK_CATEGORIES.has(category) ? category : null,
    dialect: plainText(b.ml) || null,
    subtitle: plainText(b.ms) || null,
    genres: genreText.split(/[、/,，;；]/).map((s) => s.trim()).filter(Boolean),
    director: plainText(e.md) || null,
    cast: plainText(e.mc) || null,
    description: plainText(info.i),
  };
}

function readDetailCache(file) {
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch { return {}; }
}

async function movieDetails(movies, proxy, request, cacheFile, detailBudgetMs) {
  const cache = readDetailCache(cacheFile);
  const result = new Map();
  let next = 0;
  let changed = false;
  const deadline = Date.now() + detailBudgetMs;
  // 小并发 + 总时间上限：详情端点不能拖垮排片抓取；预算耗尽后仍遍历全部旧缓存。
  // 首轮缺缓存的电影下次抓取会排到前面（前面已抓的优先命中缓存）。
  async function worker() {
    while (next < movies.length) {
      const movie = movies[next++];
      const id = String(movie.id);
      const title = movie.name || '';
      const saved = cache[id];
      const old = saved && parseMclMovieDetails(saved.raw, id, title);
      const ttl = old && old.duration && old.category && old.director && old.cast && old.description
        ? DETAIL_TTL_MS : INCOMPLETE_DETAIL_TTL_MS;
      if (old && Date.now() - Date.parse(saved.at) < ttl &&
          process.env.MCL_DETAILS_FORCE_REFRESH !== '1') {
        result.set(id, old);
        continue;
      }
      if (Date.now() >= deadline) {
        if (old) result.set(id, old);
        continue;
      }
      try {
        const raw = await request(`GetMovieDetails.aspx?l=${LANG}&t=s&id=${id}&r=beim`, {
          proxy, timeoutMs: 8000,
        });
        const detail = parseMclMovieDetails(raw, id, title);
        if (!detail) throw new Error('ID 或片名与列表不符');
        result.set(id, detail);
        // 只缓存资料字段，丢弃预告片/剧照等大对象；缓存仍逐次校验 ID+片名。
        const { id: movieId, mn, b, e, i } = raw[0];
        cache[id] = { at: new Date().toISOString(), raw: [{ id: movieId, mn, b, e, i }] };
        changed = true;
      } catch (err) {
        if (old) result.set(id, old);
        else console.warn(`[mcl] ${id} 详情缺失（保留排片）: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, movies.length) }, () => worker()));
  if (changed) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, cacheFile);
    } catch (err) {
      console.warn(`[mcl] 无法缓存详情: ${err.message}`);
    }
  }
  return result;
}

/**
 * 发请求取 JSON。
 * 注意：Node 内置 fetch 不读 http_proxy，且 undici 的 ProxyAgent 与内置 dispatcher 版本
 * 不兼容（invalid onRequestStart method），故这里用 node:https + https-proxy-agent。
 */
async function getJson(path, { proxy, timeoutMs = 30000 } = {}) {
  const url = `${API}/${path}`;
  const agent = await getProxyAgent(proxy);

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent,
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`${path} → HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`${path} → JSON 解析失败: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`${path} → 超时`)));
    req.on('error', reject);
  });
}

/**
 * 解析 MCL 的场次描述字符串。
 * 格式：`星期四, 9月24日, 02:10 PM, IMAX/12院 $210`
 * 注意：**不含年份**，需按当前时间推断（处理 12 月 → 1 月跨年）。
 */
export function parseShowDesc(desc) {
  if (!desc) return null;
  const m = desc.match(
    /^(星期[一二三四五六日]),\s*(\d{1,2})月(\d{1,2})日,\s*(\d{1,2}):(\d{2})\s*(AM|PM),\s*(.*?)\s*\$?(\d+)?$/
  );
  if (!m) return null;

  const [, , monthStr, dayStr, hourStr, minStr, ampm, houseRaw, priceStr] = m;
  const month = Number(monthStr);
  const day = Number(dayStr);
  let hour = Number(hourStr) % 12;
  if (ampm === 'PM') hour += 12;

  // 推断年份：以香港时间为准，若月份已过则视为下一年
  const nowHkt = new Date(Date.now() + 8 * 3600_000);
  let year = nowHkt.getUTCFullYear();
  const nowMonth = nowHkt.getUTCMonth() + 1;
  if (month < nowMonth - 1) year += 1;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minStr).padStart(2, '0')}:00+08:00`;

  // 影厅名与价格：`IMAX/12院 $210`
  const priceM = houseRaw.match(/\$(\d+)/);
  const price = priceStr ? Number(priceStr) : priceM ? Number(priceM[1]) : null;
  const houseName = houseRaw.replace(/\s*\$?\d+\s*$/, '').trim();

  return { iso, date: iso.slice(0, 10), price, houseName };
}

/** 抓取 MCL 全部数据 */
export async function scrapeMcl({ proxy, request = getJson, detailCacheFile = DETAIL_CACHE_FILE, detailBudgetMs = 30_000 } = {}) {
  const [grid, list, cinemaDetails] = await Promise.all([
    request(`GetNowShowingGrid.aspx?l=${LANG}`, { proxy }),
    request(`GetNowShowingList.aspx?l=${LANG}`, { proxy }),
    // 影院地址 / 地图，独立端点
    request(`GetCinemaDetails.aspx?l=${LANG}`, { proxy }).catch(() => []),
  ]);

  // 影院地址映射
  const cinemaInfo = new Map();
  for (const c of Array.isArray(cinemaDetails) ? cinemaDetails : []) {
    cinemaInfo.set(String(c.id), { address: c.a || '', mapUrl: c.m || '' });
  }

  // 影片元数据（片名 + 海报）
  const meta = new Map();
  for (const m of grid.movies || []) {
    const posterPath = m.n || `${grid.ba}${grid.dba}${grid.dp}${m.id}${grid.ta}`;
    meta.set(String(m.id), {
      name: m.mn || '',
      poster: `${BASE}/${posterPath}`,
    });
  }

  // List 的 mv 只有数字 ID / 排片；片名在 Grid。先按 ID 关联，详情校验才有依据。
  const details = await movieDetails(
    (list.movies || []).map((mv) => ({ id: mv.id, name: meta.get(String(mv.id))?.name || '' })),
    proxy, request, detailCacheFile, detailBudgetMs
  );
  const movies = [];
  const cinemas = new Map();
  const shows = [];

  for (const mv of list.movies || []) {
    const id = `mcl-${mv.id}`;
    const info = meta.get(String(mv.id)) || { name: '', poster: null };
    const detail = details.get(String(mv.id));
    // 详情接口有时不填对白语言；若本片所有放映版本语言一致，可从官方场次补上。
    // 多语言版本并存时留空，避免把某一版本语言错标成全片语言。
    const languages = new Set((mv.vst || []).map((v) => v.l?.trim()).filter(Boolean));
    const singleLanguage = languages.size === 1 ? [...languages][0] : null;

    movies.push({
      id,
      slug: mclSlug(info.name, mv.id),
      nameZh: info.name,
      nameEn: detail?.nameEn || '',
      poster: info.poster,
      duration: detail?.duration ?? null,
      category: detail?.category ?? null,
      dialect: detail?.dialect || singleLanguage,
      subtitle: detail?.subtitle ?? null,
      genres: detail?.genres ?? [],
      director: detail?.director ?? null,
      cast: detail?.cast ?? null,
      description: detail?.description ?? '',
      trailer: null,
      // MovieSet 接受纯数字 ID，不接受本站的 mcl- 前缀。
      detailUrl: `${BASE}/MovieSet.aspx?id=${mv.id}`,
      status: 'showing',
      source: 'mcl',
    });

    for (const ver of mv.vst || []) {
      for (const c of ver.c || []) {
        const cinemaId = String(c.ci);
        if (!cinemas.has(cinemaId)) {
          const info = cinemaInfo.get(cinemaId) || { address: '', mapUrl: '' };
          cinemas.set(cinemaId, {
            id: `mcl-${cinemaId}`,
            code: cinemaId,
            nameZh: c.cn || '',
            address: info.address,
            mapUrl: info.mapUrl,
            detailUrl: `${BASE}/NowShowingByHouse.aspx?ci=${cinemaId}`,
            source: 'mcl',
          });
        }

        for (const s of c.s || []) {
          if (!s.si || s.si < 0) continue; // si = -1 是分隔行
          const parsed = parseShowDesc(s.sn);
          if (!parsed) continue;

          shows.push({
            id: `mcl-${s.si}`,
            movieId: id,
            cinemaId: `mcl-${cinemaId}`,
            houseName: parsed.houseName,
            startAt: parsed.iso,
            date: parsed.date,
            price: parsed.price,
            // ★ MCL 的 r 是「剩余座位百分比」（0–100），**不是已售率**
            //
            //   已用 hkmovie6 的 attendance（入座率）交叉验证 49 个场次：
            //     corr(r, attendance) = -0.986
            //     假设 r=剩余率 → 误差均值 0.009 / 标准差 0.041（几乎完美）
            //     假设 r=已售率 → 误差均值 0.443 / 标准差 0.468（完全不吻合）
            //
            //   ⚠️ 注意：MCL 官网自己会把 r 反算成「已售」来画进度条宽度
            //   （custom-mcl-select-seat.js: SessionRemain = 100 - SessionRemain），
            //   容易被误读成已售率。以实测交叉验证为准。
            //
            //   MCL 不提供影厅总座位数，故 seats 置 null（不猜测）。
            seats: null,
            remainRate:
              typeof s.r === 'number'
                ? Math.min(1, Math.max(0, s.r / 100))
                : null,
            soldOut: typeof s.r === 'number' ? s.r <= 0 : undefined,
            version: ver.vn || ver.v || null,
            language: ver.l || null,
            tags: [],
            // ★ 购票深链
            bookingUrl: `${BASE}/MCLSelectSeat.aspx?visLang=${LANG}&ci=${cinemaId}&si=${s.si}`,
            source: 'mcl',
          });
        }
      }
    }
  }

  return { movies, cinemas: [...cinemas.values()], shows };
}
