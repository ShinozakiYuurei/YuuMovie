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

/**
 * 从 s[start] 起扫描一个 JSON 值的文本边界（不含尾随空白）
 *
 * 为什么要自己扫而不是用长度：见 buildRecordMap 的注释。
 */
function scanJsonValue(s, start) {
  const ch = s[start];
  if (ch === '"') {
    let k = start + 1;
    while (k < s.length) {
      if (s[k] === '\\') {
        k += 2;
        continue;
      }
      if (s[k] === '"') return k + 1;
      k++;
    }
    return -1;
  }
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    let d = 0;
    let k = start;
    let inStr = false;
    while (k < s.length) {
      const c = s[k];
      if (inStr) {
        if (c === '\\') {
          k += 2;
          continue;
        }
        if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === ch) d++;
      else if (c === close) {
        d--;
        if (d === 0) return k + 1;
      }
      k++;
    }
    return -1;
  }
  let k = start;
  while (k < s.length && !',]}'.includes(s[k])) k++;
  return k;
}

/**
 * 建立 React Flight 文本记录表：id → 值的原始文本
 *
 * ★ 为什么需要它（2026-09-22 修复「即将上映简介是英文/为空」时发现）：
 *   Next.js App Router 的 RSC 载荷里，长字符串会被抽成独立「记录」，
 *   字段位置只留一个引用：
 *       ..."description_lang":"$37"...
 *       37:T83e,{"en":"…","zh_hk":"…"}      ← 真值在这里
 *   直接读字段只能拿到字面量 "$37"。
 *
 * ⚠️ 不能按 `T` 后面的十六进制长度切片 —— 那是**字节数**，
 *   而简介几乎全是中文（UTF-8 下 3 字节/字），按长度切必然切多，
 *   JSON.parse 报「Unexpected non-whitespace character」。
 *   所以改用 scanJsonValue 按 JSON 结构定边界。
 *
 * ⚠️ id 前必须是行首或非数字字母，否则 `"createTime":"…37:52.688Z"`
 *   这类时间戳会被当成 id=37 命中（踩过）。
 */
export function buildRecordMap(rsc) {
  const map = new Map();
  const re = /(?:^|[^0-9A-Za-z_])(\d+):T[0-9a-f]+,/g;
  let m;
  while ((m = re.exec(rsc)) !== null) {
    const id = Number(m[1]);
    if (map.has(id)) continue;
    const start = m.index + m[0].length;
    const end = scanJsonValue(rsc, start);
    if (end < 0) continue;
    map.set(id, rsc.slice(start, end));
  }
  return map;
}

/** 反复解 JSON 直到得到对象/数组（Flight 记录的值是双层编码的） */
function deepParse(v) {
  let cur = v;
  for (let i = 0; i < 3; i++) {
    if (typeof cur !== 'string') break;
    const t = cur.trim();
    if (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('"')) break;
    try {
      const next = JSON.parse(t);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

/**
 * 读一个 `*_lang` 字段 → 对象
 *
 * 兼容四种形态（各页面混用，实测都出现过）：
 *   1. 内联对象            { zh_hk: '…' }
 *   2. JSON 字符串         '{"zh_hk":"…"}'
 *   3. Flight 引用         '$37'（配 records）
 *   4. 双层编码            '"{\\"zh_hk\\":…}"'（记录值外层还裹着引号）
 */
export function langField(records, v) {
  let raw = v;
  if (typeof raw === 'string') {
    const ref = /^\$(\d+)$/.exec(raw);
    if (ref) raw = records.get(Number(ref[1])) ?? null;
  }
  const out = deepParse(raw);
  return out && typeof out === 'object' ? out : {};
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
  // Flight 文本记录表：movies 数组里的 `*_lang` 也可能是 "$N" 引用
  const records = buildRecordMap(rsc);

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
    })), movies, records };
}

// ---------- 即将上映 ----------
//
// ★ 2026-09-22 修复：「即将上映」页面简介要么没有、要么是英文。
//
//   根因：本函数原先只读顶层 `description`，而百老匯**列表载荷里
//   顶层 description 是英文原文**，中文在 `description_lang.zh_hk`。
//   实测 140 条待映片里 123 条本来就带中文简介，全被丢掉了；
//   剩下 17 条里还有 12 条能从详情页补上。
//
//   注意同页的 showing 侧（scrapeMovieDetail）早就读的是 description_lang，
//   所以「现正上映」一直正常 —— 两个函数的取字段口径不一致才是 bug 源头。
//
//   description_lang 的值有三种形态，且长文本会被抽成 Flight 引用（"$37"），
//   所以必须先用 buildRecordMap 建表，再交给 langField 解析。
async function scrapeUpcoming() {
  const html = await getHtml('/hk/movie/upcoming');
  return parseUpcomingHtml(html);
}

/**
 * 解析「即将上映」页面 → 影片数组（纯函数，便于离线回归测试）
 *
 * 抽出来的理由：线上站点偶发 ECONNRESET，而这段取字段逻辑
 * （尤其是中文优先与 `$ref` 还原）正是 bug 发生地，
 * 必须能拿存下来的 HTML 反复验证。
 */
export function parseUpcomingHtml(html) {
  const rsc = extractRsc(html);
  const raw = sliceArray(rsc, 'upcomingList');
  if (!raw) throw new Error('未找到 upcomingList 数组');
  const list = JSON.parse(raw);
  // Flight 文本记录表：`"$37"` 这类引用要靠它还原
  const records = buildRecordMap(rsc);

  return list.map((m) => {
    const lang = langField(records, m.name_lang);
    const zh = lang.zh_hk || '';
    const en = lang.en || m.name || '';
    const desc = langField(records, m.description_lang);
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
      genres: (m.movieTypes || []).map((t) => {
        const gl = langField(records, t.name_lang);
        return gl.zh_hk || t.name;
      }),
      // 导演/演员同样有 `*_lang.zh_hk`，英文名只在中文缺失时回落
      director: langField(records, m.director_lang).zh_hk || m.director || null,
      cast: langField(records, m.cast_lang).zh_hk || m.cast || null,
      // ★ 中文优先：description_lang.zh_hk 才是中文简介，
      //   顶层 description 是英文原文（仅在中文缺失时用）
      description: stripHtml(desc.zh_hk || desc.en || m.description || ''),
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

  const recs = buildRecordMap(rsc);
  const lang = langField(recs, movie.name_lang);
  const dl = langField(recs, movie.description_lang);
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
    genres: (movie.movieTypes || []).map((t) => langField(recs, t.name_lang).zh_hk || t.name),
    director: langField(recs, movie.director_lang).zh_hk || movie.director || null,
    cast: langField(recs, movie.cast_lang).zh_hk || movie.cast || null,
    description: stripHtml(dl.zh_hk || dl.en || movie.description || ''),
    poster: movie.images?.[0] ? `https://media.grabticks.com/${movie.images[0]}` : null,
    trailer: movie.trailer || null,
    detailUrl: `${BASE}/hk/movie/${id}`,
    status: 'showing',
    source: SOURCE,
  };
}

/**
 * 即将上映：给缺中文简介的条目从详情页回填
 *
 * 为什么不直接用英文兜底：本站是繁體站，列表顶层 `description` 是英文原文，
 * 直接展示就是「简介是英文」这个 bug 本身。详情页的 `description_lang.zh_hk`
 * 才是院线自己写的繁体文案。
 *
 * 回填失败的（上游真的没中文）保持原样 —— 宁可暂时显示英文，
 * 也不编造或拿别的片的中文顶上。
 *
 * @param {object[]} list scrapeUpcoming() 的结果
 * @param {{concurrency?: number}} opts
 */
export async function backfillUpcomingDesc(list, { concurrency = 3 } = {}) {
  const hasCJK = (s) => /[\u3400-\u9fff]/.test(s || '');
  const need = list.filter((m) => !hasCJK(m.description));
  if (!need.length) return list;

  console.log(`  即將上映：${need.length} 部缺中文簡介，查詳情頁回填`);
  const patched = new Map();
  for (let i = 0; i < need.length; i += concurrency) {
    const batch = need.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((m) =>
        scrapeMovieDetail(String(m.id).replace(`${SOURCE}-`, ''))
          .then((d) => ({ id: m.id, d }))
          .catch(() => ({ id: m.id, d: null }))
      )
    );
    for (const { id, d } of results) {
      if (d && hasCJK(d.description)) patched.set(id, d.description);
    }
  }

  console.log(`  回填成功 ${patched.size}/${need.length}`);
  return list.map((m) => (patched.has(m.id) ? { ...m, description: patched.get(m.id) } : m));
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
  const [ticketing, upcomingRaw, cinemas] = await Promise.all([
    scrapeTicketing(),
    scrapeUpcoming(),
    scrapeCinemas(),
  ]);

  // ★ 即将上映：列表里缺中文简介的，去详情页补
  //
  //   实测（2026-09-22）140 条待映片：123 条列表本身就带中文，
  //   剩下 17 条里 12 条能在详情页拿到中文（舞台剧/歌剧/KINO 专题等
  //   列表页只存了英文摘要），5 条确实上游无中文（《復仇者聯盟5》尚未宣发）。
  //   这 12 条不补的话，页面上就是一眼可见的英文简介。
  //
  //   只在中文缺失时才多打一次请求，且并发受限 —— 平时增量几乎为 0。
  const upcoming = await backfillUpcomingDesc(upcomingRaw, { concurrency });

  const { shows, movies: rawMovies, records: ticketingRecords } = ticketing;

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
          nameZh: langField(ticketingRecords, m?.name_lang).zh_hk || detail.nameZh,
          nameEn: langField(ticketingRecords, m?.name_lang).en || detail.nameEn,
          openingDate: hktDate(m?.openingDate) || detail.openingDate,
        };
      }
      // 详情抓取失败或该影片不在 movies 数组里：用最小信息
      const lang = langField(ticketingRecords, m?.name_lang);
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
        genres: (m?.movieTypes || []).map((t) => langField(ticketingRecords, t.name_lang).zh_hk || t.name),
        director: langField(ticketingRecords, m?.director_lang).zh_hk || m?.director || null,
        cast: langField(ticketingRecords, m?.cast_lang).zh_hk || m?.cast || null,
        description: stripHtml(langField(ticketingRecords, m?.description_lang).zh_hk || m?.description || ''),
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
      const lang = langField(ticketingRecords, m?.name_lang);
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
        genres: (m?.movieTypes || []).map((t) => langField(ticketingRecords, t.name_lang).zh_hk || t.name),
        director: langField(ticketingRecords, m?.director_lang).zh_hk || m?.director || null,
        cast: langField(ticketingRecords, m?.cast_lang).zh_hk || m?.cast || null,
        description: stripHtml(langField(ticketingRecords, m?.description_lang).zh_hk || m?.description || ''),
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
