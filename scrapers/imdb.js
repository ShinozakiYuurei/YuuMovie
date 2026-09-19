/**
 * IMDb 侧取数
 *
 * 两段式（都不需要 key、不撞墙）：
 *   1. 片名 → tt id：官方 suggestion 端点 v3.sg.media-imdb.com
 *   2. tt id → 评分：api.agregarr.org（imdb-ratings-api，抓 IMDb 公开评分页）
 *
 * ⚠️ IMDb 直接抓 title 页会 202/封；公共 GraphQL 会 403 且服务条款禁止
 *    公开/商业用途，所以不走那条路。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SUGGEST = 'https://v3.sg.media-imdb.com/suggestion/x';
const RATINGS = 'https://api.agregarr.org/api/ratings';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 片名 → 候选条目
 * @returns {Promise<Array<{id:string,title:string,year:number|null,qid:string}>>}
 */
export async function imdbSuggest(title, opt = {}) {
  const u = `${SUGGEST}/${encodeURIComponent(title)}.json?includeVideos=0`;
  const res = await fetch(u, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(opt.timeoutMs || 15000),
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const j = await res.json().catch(() => null);
  if (!j || !Array.isArray(j.d)) return [];
  return j.d
    .filter((x) => x && /^tt\d+$/.test(x.id || ''))
    .map((x) => ({ id: x.id, title: x.l || '', year: x.y || null, qid: x.qid || '' }));
}

/** tt id → 评分 */
export async function imdbRatings(imdbId, opt = {}) {
  const res = await fetch(`${RATINGS}?id=${encodeURIComponent(imdbId)}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(opt.timeoutMs || 15000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  const row = Array.isArray(j) ? j[0] : j;
  if (!row || row.rating == null) return null;
  return { rating: Number(row.rating), votes: row.votes != null ? Number(row.votes) : null };
}

/** 重映往前追几年：标题弱匹配（只靠子串兼容）时不敢追太远 */
const REISSUE_MAX_YEARS = 12;
/** 标题强匹配时允许的重映间隔上限 —— 经典复修常超 20 年（EVA 1997 → 港映 2026 差 29 年） */
const REISSUE_MAX_YEARS_STRONG = 45;
/** 达到这个分算「标题可信」，可用较宽的重映窗口 */
const STRONG_TITLE = 76;

/** 归一：小写、非字目字符转空格（保留 CJK 与日文假名） */
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 允许在子集匹配时丢掉的词：只放**无区分度**的词
 *
 * 故意不含数字与 part/one/two 这类：它们恰好是续集与版本的区分位。
 * 版本号差异（1.11 vs 1.0）走下面单独的“核心词 ≥ 3”通道。
 */
const STOP_TOKENS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'le', 'la', 'les', 'el', 'un', 'une',
  'der', 'die', 'das', 'il', 'movie', 'film', 'version', 'true', 'final',
]);

/**
 * 放映格式 / 影展 / 版本标记：院线片名里拼上去的，不是片名本身
 *
 * 与 STOP_TOKENS 分开是因为它们不是语言虚词而是**业务前缀**：
 * “IMAX Avengers Endgame Encore” 与 “Avengers Endgame” 是同一部，
 * 差的就是这两个词。括号类的已由 enrich.js 的 cleanTitle 剔掉，
 * 这里兼顾不在括号里的写法。
 */
const FORMAT_TOKENS = new Set([
  'imax', 'encore', '2d', '3d', 'dolby', 'atmos', 'screenx', '4dx', 'mx4d', 'dbox',
  'omni', 'pulselx', 'supernx', 'miramax', 'reissue', 'restored', 'remastered',
  'cineport', 'gff', 'hkiff', 'hkLGFF'.toLowerCase(), 'bc30', 'apaaa', 'bcsunday',
]);

/**
 * 标题相似度得分（0 = 不算匹配）
 *
 * ★ 关键设计：**包含方向**。n = 候选（IMDb），q = 查询（院线）。
 *  - 候选包含查询全部词 → 82。IMDb 习惯带系列全名（“Neon Genesis Evangelion: The End of
 *    Evangelion”），查询只给副标题，这方向是安全的。
 *  - 查询包含候选全部词 → 只能给 76，且**要求多出的词全是格式/停用词**。
 *    否则 “Evangelion: 1.11 You Are (Not) Alone” 会配到不相干的 “You Are Not Alone”
 *    （丢掉的正好是最有区分度的 evangelion；实测已发生）。
 *  - 单词标题不做包含判断：“Fall” 能当前缀套住 “Fall 2: Deadpoint”（续集），
 *    “M” 能套住任何东西。宁可不显示评分。
 *  - 续集序号不能吞：“Rocky 3” vs “Rocky 4” 只差一个数字，但那是区分位。
 */
function titleScore(n, q) {
  if (!n || !q) return 0;
  if (n === q) return 100;

  const tn = n.split(' ');
  const tq = q.split(' ');
  const isFiller = (t) => STOP_TOKENS.has(t) || FORMAT_TOKENS.has(t);
  const isDigits = (t) => /^\d+$/.test(t);

  // 单词标题（“M”、“Fall”、“Hope”）：只能全等。
  // 一个词的短标题会当前缀套住任何东西（“M” 能套住 “M the Movie of the Century”），
  // 而“Fall”与“Fall 2: Deadpoint”根本是两部片。
  if (tq.length === 1 || tn.length === 1) return 0;

  const nOnly = tn.filter((t) => !tq.includes(t)); // 候选独有
  const qOnly = tq.filter((t) => !tn.includes(t)); // 查询独有
  const matched = tq.length - qOnly.length;

  // 候选 ⊇ 查询：IMDb 标题带额外的系列前缀/后缀
  if (!qOnly.length) return 82;
  // 查询 ⊇ 候选：候选少了几个词，只有缺的全是格式/虚词才算同一部
  if (!nOnly.length && qOnly.every(isFiller)) return 76;
  // 两边各有独有词：查询多的必须全是格式/虚词，候选多的不超 2 个，且实词至少对上 3 个。
  // 实测必需：“Evangelion: Death (True)² & Rebirth” vs 1997 原版
  //   “Neon Genesis Evangelion: Death & Rebirth”（查询多 true，候选多 neon/genesis）。
  if (qOnly.every(isFiller) && nOnly.length <= 2 && matched >= 3) return 76;
  // 版本号写法差异（1.11 vs 1.0）：只允许可数字差异，且核心实词 ≥ 4 全匹配
  const core = tq.filter((x) => tn.includes(x) && !isFiller(x) && !/^\d+$/.test(x)).length;
  if (nOnly.every(isDigits) && qOnly.every(isDigits) && core >= 4) return 76;

  // 子串包含：要求重叠占较长串大部分，否则 “Evangelion 1.11 You Are (Not) Alone”
  // 会包住 “You Are Not Alone”
  if (n.includes(q) || q.includes(n)) {
    return Math.min(n.length, q.length) / Math.max(n.length, q.length) >= 0.6 ? 62 : 0;
  }
  return 0;
}

/** 导出供单测（见 scripts/test-title-score.mjs）：纯函数，不发请求 */
export { titleScore, norm as normTitle };

/**
 * 从候选里挑最像的一部（取最优）
 *
 * @param {Array} candidates
 * @param {string} query
 * @param {number|null} year
 * @param {{reissue?: boolean}} [opt] reissue：放宽年份（重映/影展/直播剧场）
 */
export function pickImdbId(candidates, query, year, opt = {}) {
  const list = rankImdbCandidates(candidates, query, year, opt);
  return list.length ? list[0].c : null;
}

/**
 * 片名 → 候选 tt id（按可信度排序，可能多个）
 *
 * 为什么要返回一排而不是一个：重映片在 IMDb 常有**两个条目** ——
 * 1997 原版（有评分）与 2025 为重映新开的条目（无人评分）。
 * 首选新条目会显示「暫無評分」，所以调用方需要能在首选无分时
 * 回退到原版（产品要求：重映按最初上映版本的评分算）。
 *
 * 两轮搜索：第一轮严格要求年份贴近；第二轮放宽年份（上限 REISSUE_MAX_YEARS），
 * 因为 enrich 拿到的年份是**香港开画年**，重映/影展/直播剧场的 IMDb 年份都比它早很多。
 * 两轮都**不放宽标题**，避免同名旧片误配。
 *
 * @param {string[]} queries 已按优先级排好的候选查询词
 * @param {number|null} year
 * @param {number} [limit] 最多返回几个候选
 */
export async function resolveImdbIds(queries, year, limit = 5) {
  const found = [];
  const seen = new Set();
  for (const pass of [false, true]) {
    for (const q of queries) {
      if (!q) continue;
      const cands = await imdbSuggest(q);
      await sleep(120);
      for (const c of rankImdbCandidates(cands, q, year, { reissue: pass })) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        found.push({ ...c, query: q, relaxedYear: pass });
      }
    }
    if (found.length >= limit) break;
  }
  return found.slice(0, limit);
}

/**
 * 给候选打分并排序（只返达标的）
 *
 * 排序口径：先标题可信度，再**年份更早优先** ——
 * 同分的情况下原版（年份早）排前，止住「拿重映新条目去展示」。
 */
export function rankImdbCandidates(candidates, query, year, opt = {}) {
  const scored = [];
  for (const c of candidates || []) {
    const one = scoreImdbCandidate(c, query, year, opt);
    if (one) scored.push(one);
  }
  scored.sort((a, b) => b.s - a.s || (a.year || 9999) - (b.year || 9999));
  return scored;
}

/** 单个候选得分（不达标返 null） */
function scoreImdbCandidate(c, query, year, opt = {}) {
  const q = norm(query);
  if (!q || !c || !c.id) return null;
  if (c.qid && c.qid !== 'movie') return null;
  const n = norm(c.title);
  if (!n) return null;

  const base = titleScore(n, q);
  if (!base) return null;
  let s = base;

  if (year && c.year) {
    const d = c.year - year;
    if (d === 0) s += 20;
    else if (Math.abs(d) <= 3) s += d < 0 ? 12 : 6;
    // 重映放宽：窗口按标题可信度分档。
    // 统一用 ±12 会把经典复修误杀（EVA 1997 → 港映 2026，差 29 年）；
    // 完全不设上限则「M (GFF) 2026」会匹到 1931 年弗里茨·朗的《M》。
    else if (d < 0 && opt.reissue) {
      const cap = base >= STRONG_TITLE ? REISSUE_MAX_YEARS_STRONG : REISSUE_MAX_YEARS;
      if (-d > cap) return null;
      s += 4;
    } else return null;
  } else if (year && !c.year) {
    s -= 10; // 无年份的条目不能用来验年份，降权但保留
  }
  return { c, s, id: c.id, title: c.title, year: c.year || null };
}

/** 兼容旧调用：取最优一个 */
export async function resolveImdbId(queries, year) {
  const list = await resolveImdbIds(queries, year, 1);
  return list.length ? { hit: list[0], pass: list[0].relaxedYear, query: list[0].query } : null;
}

/** 拼 IMDb 条目网址（供页面外链） */
export const imdbUrl = (id) => (id ? `https://www.imdb.com/title/${id}/` : null);
