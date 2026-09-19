/**
 * 百老匯院線抓取器
 *
 * 数据源：https://www.cinema.com.hk
 *  - /hk/movie/ticketing  → 场次（含购票深链）
 *  - /hk/movie/upcoming   → 即将上映
 *  - /hk/movie/{id}       → 影片详情
 *
 * 技术要点：Next.js App Router，数据内嵌在 RSC 载荷里（self.__next_f.push），
 * 纯 fetch 即可解析，无需浏览器。
 *
 * robots.txt 为 Allow: /，合规抓取。
 */

export const BASE = 'https://www.cinema.com.hk';
export const SOURCE = 'broadway';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

// ---------- RSC 解析 ----------
/** 提取 Next.js RSC 流式载荷 */
export function extractRsc(html) {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = '';
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse('"' + m[1] + '"');
    } catch {
      /* 少数片段非字符串载荷 */
    }
  }
  return out;
}

/** 从载荷中切出完整 JSON 数组（按括号配对） */
export function sliceArray(s, key) {
  const i = s.indexOf(`"${key}":[`);
  if (i < 0) return null;
  const start = s.indexOf('[', i);
  let d = 0;
  for (let k = start; k < s.length; k++) {
    if (s[k] === '[') d++;
    else if (s[k] === ']') {
      d--;
      if (d === 0) return s.slice(start, k + 1);
    }
  }
  return null;
}

// ---------- 工具 ----------
function toHktIso(iso) {
  const t = new Date(iso).getTime() + HKT_OFFSET_MS;
  return new Date(t).toISOString().replace('Z', '+08:00');
}

function hktDate(iso) {
  if (!iso) return null;
  return toHktIso(iso).slice(0, 10);
}

/** name_lang 在不同页面可能是对象或字符串化 JSON */
export function parseLang(v) {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v || {};
}

export function slugify(nameZh, nameEn, id) {
  const base = (nameEn || nameZh || String(id))
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `${base}-${id}` : `movie-${id}`;
}

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

let lastReq = 0;
async function getHtml(p, { throttle = 800 } = {}) {
  const wait = throttle - (Date.now() - lastReq);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();

  const res = await fetch(BASE + p, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-HK,zh;q=0.9' },
  });
  if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
  return res.text();
}

// ---------- 场次 ----------
async function scrapeTicketing() {
  const html = await getHtml('/hk/movie/ticketing');
  const rsc = extractRsc(html);

  const showsRaw = sliceArray(rsc, 'shows');
  if (!showsRaw) throw new Error('未找到 shows 数组 — 页面结构可能已变更');
  const shows = JSON.parse(showsRaw);

  // ★ 同页还有一个 movies 数组（含全部格式版本：IMAX/4DX/全景声…）
  //   仅靠 shows 反推影片会漏掉无场次的版本，导致详情页版本分类不全
  const moviesRaw = sliceArray(rsc, 'movies');
  const movies = moviesRaw ? JSON.parse(moviesRaw) : [];

  // ⚠️ `"houses":[` 在各 site 对象内重复出现，sliceArray 只能拿到第一个。
  // 改为全局扫描影厅对象特征（code 形如 "79_HThe Ov"）。
  const houseName = new Map();
  const houseRe =
    /\{"id":(\d+),"active":(?:true|false),"seq":\d+,"code":"\d+_[^"]*","name":"((?:[^"\\]|\\.)*)","name_lang":(\{[^}]*\})/g;
  let hm;
  while ((hm = houseRe.exec(rsc)) !== null) {
    const hid = Number(hm[1]);
    if (houseName.has(hid)) continue;
    houseName.set(hid, parseLang(hm[3]).zh_hk || hm[2]);
  }

  return { shows: shows.filter((s) => s.published)
    .map((s) => ({
      id: `${SOURCE}-${s.id}`,
      movieId: `${SOURCE}-${s.movie?.id ?? ''}`,
      cinemaId: `${SOURCE}-${s.site?.id ?? ''}`,
      houseName: houseName.get(s.house?.id) ?? '',
      // ⚠️ time 是 UTC，香港 UTC+8
      startAt: toHktIso(s.time),
      date: hktDate(s.date),
      price: s.price ?? null,
      // ★ 百老匯：seats 是**影厅总座位数**，avaliable 是剩余可选数
      //   （实测 77 个影厅 seats 全部恒定，证明它是总座位而非剩余）
      //   余座率 = avaliable / seats
      seats: s.seats ?? null,
      remainRate:
        typeof s.avaliable === 'number' && s.seats > 0
          ? Math.min(1, Math.max(0, s.avaliable / s.seats))
          : null,
      soldOut: typeof s.avaliable === 'number' ? s.avaliable <= 0 : undefined,
      tags: s.tags || [],
      version: null,
      language: null,
      bookingUrl: `${BASE}/hk/show/${s.id}`,
      source: SOURCE,
    })), movies };
}

// ---------- 即将上映 ----------
async function scrapeUpcoming() {
  const html = await getHtml('/hk/movie/upcoming');
  const rsc = extractRsc(html);
  const raw = sliceArray(rsc, 'upcomingList');
  if (!raw) throw new Error('未找到 upcomingList 数组');
  const list = JSON.parse(raw);

  return list.map((m) => {
    const lang = parseLang(m.name_lang);
    const zh = lang.zh_hk || '';
    const en = lang.en || m.name || '';
    return {
      id: `${SOURCE}-${m.id}`,
      slug: slugify(zh, en, m.id),
      nameZh: zh,
      nameEn: en,
      openingDate: hktDate(m.openingDate),
      duration: m.duration ?? null,
      category: m.category ?? null,
      dialect: m.dialect ?? null,
      subtitle: m.subtitle ?? null,
      genres: (m.movieTypes || []).map((t) => parseLang(t.name_lang).zh_hk || t.name),
      director: parseLang(m.director_lang).zh_hk || m.director || null,
      cast: parseLang(m.cast_lang).zh_hk || m.cast || null,
      description: stripHtml(m.description || ''),
      poster: m.images?.[0] ? `https://media.grabticks.com/${m.images[0]}` : null,
      trailer: m.trailer || null,
      detailUrl: `${BASE}/hk/movie/${m.id}`,
      status: 'upcoming',
      source: SOURCE,
    };
  });
}

// ---------- 影院 ----------
async function scrapeCinemas() {
  const html = await getHtml('/hk/movie/ticketing');
  const rsc = extractRsc(html);

  const cinemas = [];
  const re = /"hktaName":"([^"]*)","hktaCode":"([^"]*)"/g;
  let m;
  const seen = new Set();

  while ((m = re.exec(rsc)) !== null) {
    const end = m.index;
    const head = rsc.lastIndexOf('{"id":', end);
    const seg = rsc.slice(head, end + 40);
    const idM = seg.match(/^\{"id":(\d+)/);
    if (!idM) continue;
    const id = Number(idM[1]);
    if (seen.has(id)) continue;
    seen.add(id);

    const addrM = seg.match(/"address_lang":\{[^}]*?"zh_hk":"((?:[^"\\]|\\.)*)"/);
    const mapM = seg.match(/"googleMapUrl":"([^"]*)"/);
    const codeM = seg.match(/"code":"([^"]*)"/);
    const nameM = seg.match(/"name_lang":\{[^}]*?"zh_hk":"((?:[^"\\]|\\.)*)"/);

    cinemas.push({
      id: `${SOURCE}-${id}`,
      code: codeM?.[1] ?? '',
      nameZh: nameM?.[1] ?? m[1],
      address: addrM?.[1] ?? '',
      mapUrl: mapM?.[1] ?? '',
      detailUrl: `${BASE}/hk/cinema/${id}`,
      source: SOURCE,
    });
  }
  return cinemas;
}

// ---------- 影片详情 ----------
async function scrapeMovieDetail(id) {
  const html = await getHtml(`/hk/movie/${id}`, { throttle: 1000 });
  const rsc = extractRsc(html);

  const i = rsc.indexOf(`{"id":${id},"openingDate"`);
  if (i < 0) return null;

  let d = 0;
  let k = i;
  for (; k < rsc.length; k++) {
    if (rsc[k] === '{') d++;
    else if (rsc[k] === '}') {
      d--;
      if (d === 0) {
        k++;
        break;
      }
    }
  }

  let movie;
  try {
    movie = JSON.parse(rsc.slice(i, k));
  } catch {
    return null;
  }

  const lang = parseLang(movie.name_lang);
  return {
    id: `${SOURCE}-${id}`,
    slug: slugify(lang.zh_hk, lang.en, id),
    nameZh: lang.zh_hk || '',
    nameEn: lang.en || movie.name || '',
    openingDate: hktDate(movie.openingDate),
    duration: movie.duration ?? null,
    category: movie.category ?? null,
    dialect: movie.dialect ?? null,
    subtitle: movie.subtitle ?? null,
    genres: (movie.movieTypes || []).map((t) => parseLang(t.name_lang).zh_hk || t.name),
    director: parseLang(movie.director_lang).zh_hk || movie.director || null,
    cast: parseLang(movie.cast_lang).zh_hk || movie.cast || null,
    description: stripHtml(parseLang(movie.description_lang).zh_hk || movie.description || ''),
    poster: movie.images?.[0] ? `https://media.grabticks.com/${movie.images[0]}` : null,
    trailer: movie.trailer || null,
    detailUrl: `${BASE}/hk/movie/${id}`,
    status: 'showing',
    source: SOURCE,
  };
}

/**
 * 抓取百老汇全部数据
 *
 * 影片来源（重要）：
 *   ticketing 页有一个 `movies` 数组（约 151 条），包含**全部格式版本**
 *   （IMAX / 4DX / CGS / 全景声 / 特典場…）。
 *   若只用 `shows` 反推影片，会漏掉当前无场次的版本，
 *   导致详情页的「版本及场次」分类不全。
 *
 * @param {object} opts
 * @param {boolean} [opts.withDetails] 是否抓影片详情（每部 1 个请求）
 * @param {number} [opts.concurrency] 详情并发数
 */
export async function scrapeBroadway({ withDetails = true, concurrency = 3 } = {}) {
  const [ticketing, upcoming, cinemas] = await Promise.all([
    scrapeTicketing(),
    scrapeUpcoming(),
    scrapeCinemas(),
  ]);

  const { shows, movies: rawMovies } = ticketing;

  // ★ 关键：两个来源必须合并
  //   - movies 数组：含全部格式版本（IMAX/4DX/全景聲…），但可能不含所有有场次的影片
  //   - shows：含所有有场次的影片，但不含当前无场次的版本
  //   只取其一都会漏数据（曾导致版本分类不全 + 30 条悬空场次）
  const rawIds = new Set(rawMovies.map((m) => m.id));
  const extraIds = [
    ...new Set(
      shows
        .map((s) => Number(String(s.movieId).replace(SOURCE + '-', '')))
        .filter((id) => Number.isFinite(id) && id > 0 && !rawIds.has(id))
    ),
  ];
  const allIds = [...rawMovies.map((m) => m.id), ...extraIds];

  // ---------- 上映中影片 ----------
  let showing = [];

  if (withDetails && rawMovies.length) {
    // 并发抓详情补全元数据（导演/演员/简介等）
    const ids = allIds;
    const details = new Map();

    for (let i = 0; i < ids.length; i += concurrency) {
      const batch = ids.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((id) => scrapeMovieDetail(id).catch(() => null))
      );
      for (const d of results) {
        if (d) details.set(d.id, d);
      }
      if (process.env.VERBOSE && (i % 30 === 0 || i + concurrency >= ids.length)) {
        console.log(`    詳情 ${Math.min(i + concurrency, ids.length)}/${ids.length}`);
      }
    }

    // 以 allIds 为准（保证版本完整 + 不漏有场次的影片），详情数据用于补全
    const rawById = new Map(rawMovies.map((m) => [m.id, m]));
    showing = allIds.map((mid) => {
      const m = rawById.get(mid);
      const detail = details.get(`${SOURCE}-${mid}`);
      if (detail) {
        // 详情更全，但片名以列表为准（列表名含格式标记）
        return {
          ...detail,
          nameZh: parseLang(m?.name_lang).zh_hk || detail.nameZh,
          nameEn: parseLang(m?.name_lang).en || detail.nameEn,
          openingDate: hktDate(m?.openingDate) || detail.openingDate,
        };
      }
      // 详情抓取失败或该影片不在 movies 数组里：用最小信息
      const lang = parseLang(m?.name_lang);
      return {
        id: `${SOURCE}-${mid}`,
        slug: slugify(lang.zh_hk, lang.en, mid),
        nameZh: lang.zh_hk || '',
        nameEn: lang.en || m?.name || '',
        openingDate: hktDate(m?.openingDate),
        duration: m?.duration ?? null,
        category: m?.category ?? null,
        dialect: m?.dialect ?? null,
        subtitle: m?.subtitle ?? null,
        genres: (m?.movieTypes || []).map((t) => parseLang(t.name_lang).zh_hk || t.name),
        director: parseLang(m?.director_lang).zh_hk || m?.director || null,
        cast: parseLang(m?.cast_lang).zh_hk || m?.cast || null,
        description: stripHtml(m?.description || ''),
        poster: m?.images?.[0] ? `https://media.grabticks.com/${m.images[0]}` : null,
        trailer: m?.trailer || null,
        detailUrl: `${BASE}/hk/movie/${mid}`,
        status: 'showing',
        source: SOURCE,
      };
    });
  } else {
    const rawById = new Map(rawMovies.map((m) => [m.id, m]));
    showing = allIds.map((mid) => {
      const m = rawById.get(mid);
      const lang = parseLang(m?.name_lang);
      return {
        id: `${SOURCE}-${mid}`,
        slug: slugify(lang.zh_hk, lang.en, mid),
        nameZh: lang.zh_hk || '',
        nameEn: lang.en || m?.name || '',
        openingDate: hktDate(m?.openingDate),
        duration: m?.duration ?? null,
        category: m?.category ?? null,
        dialect: m?.dialect ?? null,
        subtitle: m?.subtitle ?? null,
        genres: (m?.movieTypes || []).map((t) => parseLang(t.name_lang).zh_hk || t.name),
        director: parseLang(m?.director_lang).zh_hk || m?.director || null,
        cast: parseLang(m?.cast_lang).zh_hk || m?.cast || null,
        description: stripHtml(m?.description || ''),
        poster: m?.images?.[0] ? `https://media.grabticks.com/${m.images[0]}` : null,
        trailer: m?.trailer || null,
        detailUrl: `${BASE}/hk/movie/${mid}`,
        status: 'showing',
        source: SOURCE,
      };
    });
  }

  return { movies: [...showing, ...upcoming], cinemas, shows, upcoming };
}
