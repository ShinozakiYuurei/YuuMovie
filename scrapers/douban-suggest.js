/**
 * 豆瓣评分（走 search_suggest，不需要过 PoW 盾）
 *
 * ★ 为什么这个能成而上次的 HTML 抓取不能成
 *   上次卡在 sec.douban.com 的 SHA-512 PoW：subject 页面会被反复弹回挑战页，
 *   同一个函数在探针里能过、在流水线里就过不了，排查无果。
 *   但 movie.douban.com/j/* 这一族 **JSON 接口不挂那道盾**（实测 200、~300ms、
 *   连打 60 次无限流），而 search_suggest 返回的 card_subtitle 里
 *   直接含「评分 / 年份 / 地区 / 类型 / 导演 / 演员」——正是页面要的那几项。
 *
 *   接口：https://www.douban.com/j/search_suggest?q=X&tag=movie
 *   返回：{ cards: [{ title, url, year, card_subtitle, cover_url, type }] }
 *
 * ★ 合规说明（用户 2026-09-19 明确批准）
 *   www.douban.com/robots.txt 有 `Disallow: /j/`，本接口在该路径下。
 *   用户判断：robots.txt 约束的是搜索引擎爬虫，接受此风险并要求接入。
 *   因此这里刻意做三件减轻负担的事：单次运行只查增量、请求间隔 250ms 以上、
 *   结果长期缓存（默认 30 天不重查），不做并发。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SUGGEST = 'https://www.douban.com/j/search_suggest';
const REXAR = 'https://m.douban.com/rexxar/api/v2/movie/';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * 只接受豆瓣「电影」条目（按 URL 域过滤）
 *
 * search_suggest 是全站搜索：同一串字可能返回书（book.douban.com）或
 * 音乐（music.douban.com）条目。它们在电影语境下都是错配 —— 实测
 * 《天鵝湖》拿回音乐专辑 9.5 分、《巴黎聖母院》拿回小说 9.0 分，
 * 页面显示分数、链接却只能回退到搜索（两处口径打架）。
 */
const MOVIE_SUBJECT_PREFIX = 'https://movie.douban.com/subject/';
const DIGITS_RE = /^[0-9]+/;

export function isMovieSubjectUrl(url) {
  return Boolean(url) && url.indexOf(MOVIE_SUBJECT_PREFIX) === 0 && DIGITS_RE.test(url.slice(MOVIE_SUBJECT_PREFIX.length));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 按豆瓣条目 ID 直接取分（移动端 rexxar 接口）
 *
 * ★ 为什么单独开这条通道（2026-10-08）
 *   网页端 search_suggest 与移动端 rexxar 是**两套独立的限流桶**，
 *   实测网页端被限流时 rexxar 仍可用（反之亦然）。已识别的条目
 *   （有 doubanId）根本不需要重新搜索片名 —— 每小时全量重搜是
 *   限流的根因。按 ID 取分把「上百部有 ID 条目」的搜索量降到 0。
 *
 *   robots 口径：m.douban.com/robots.txt 只禁 notification_chart 与
 *   market 两个端点，本接口不在禁止列表内（与 www 的 /j/ 不同）。
 *
 * @returns {Promise<{rating:number|null, count:number|null, title:string|null, year:string|null}|null>}
 *   null = 请求失败或被限流（调用方不应据此落盘）
 */
export async function doubanSubjectById(id, opt = {}) {
  if (!id) return null;
  const res = await fetch(REXAR + encodeURIComponent(id), {
    headers: {
      'user-agent': UA_MOBILE,
      referer: 'https://m.douban.com/',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(opt.timeoutMs || 12000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j) return null;
  // 限流/未登录响应带 code + msg（subject_ip_rate_limit / need_login），无 title
  if (j.code || !j.title) return null;
  const r = j.rating || null;
  const count = r && r.count != null ? Number(r.count) : 0;
  // 未上映条目回传 rating:0 / count:0，不能当 0 分写入（会显示 0.0）
  const value = r && r.value != null ? Number(r.value) : null;
  return {
    rating: count > 0 && value != null && value > 0 ? value : null,
    count,
    title: j.title || null,
    year: j.year || null,
  };
}

/**
 * 搜索建议
 * @returns {Promise<Array<{title:string,year:string,sub:string,id:string|null}>>}
 */
export async function doubanSuggest(q, opt = {}) {
  if (!q) return [];
  const url = `${SUGGEST}?q=${encodeURIComponent(q)}&tag=movie`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer: 'https://www.douban.com/',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(opt.timeoutMs || 12000),
  }).catch(() => null);
  // 请求失败返回 null（区别于「确实没有结果」的 []）：调用方据此避免把
  // 限流/超时误记成「这部片在豆瓣不存在」，否则要等 7 天冷却才会重查。
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || !Array.isArray(j.cards)) return null;
  const cards = j.cards;
  return cards
    .filter((c) => c && c.title && isMovieSubjectUrl((c.url || '').split('?')[0]))
    .map((c) => ({
      title: String(c.title).trim(),
      year: c.year ? String(c.year).trim() : null,
      sub: String(c.card_subtitle || '').trim(),
      id: /subject\/(\d+)/.exec(c.url || '')?.[1] || null,
      url: (c.url || '').replace(/\?.*$/, ''),
    }));
}

/**
 * 解析 card_subtitle
 *
 * 形如「8.3分 / 2023 / 中国大陆 / 科幻 冒险 灾难 / 郭帆 / 吴京 刘德华」，
 * 未出分时首段是「暂无评分」，未上映时是「尚未上映」——
 * 两者都要区分：前者是「有这部但没分数」，后者连分数都还不该有。
 *
 * 段数不固定（有的卡片没有导演/演员），所以按位置宽松取。
 */
export function parseDoubanCard(card) {
  const parts = (card.sub || '').split('/').map((s) => s.trim()).filter(Boolean);
  const out = {
    doubanId: card.id || null,
    doubanUrl: card.url || null,
    doubanTitle: card.title || null,
    doubanYear: card.year ? Number(card.year) || null : null,
    rating: null,
    ratingState: null, // 'rated' | 'pending'（有分但还没出） | 'unreleased'
    country: null,
    genres: [],
    director: null,
    cast: null,
  };

  let i = 0;
  const m = /^([\d.]+)分$/.exec(parts[0] || '');
  if (m) {
    out.rating = Number(m[1]);
    out.ratingState = 'rated';
    i = 1;
  } else if (parts[0] === '暂无评分') {
    out.ratingState = 'pending';
    i = 1;
  } else if (parts[0] === '尚未上映') {
    out.ratingState = 'unreleased';
    i = 1;
  }
  if (/^\d{4}$/.test(parts[i] || '')) {
    out.doubanYear = out.doubanYear || Number(parts[i]);
    i++;
  }
  if (parts[i] && !out.country) {
    out.country = parts[i];
    i++;
  }
  if (parts[i] && !out.genres.length) {
    out.genres = parts[i].split(/\s+/).filter(Boolean);
    i++;
  }
  if (parts[i] && !out.director) {
    out.director = parts[i];
    i++;
  }
  if (parts[i] && !out.cast) out.cast = parts[i];
  return out;
}

/**
 * 括号类装饰（院线自己加的场次/版本/特典说明）
 *
 * ★ 《》不在其中（2026-10-08）：书名号包住的往往就是真片名，
 *   「《這個殺手不太冷》(4K導演版)」连片名一起删会洗成空串，
 *   douban 搜索直接废掉。书名号交给 cleanTitle 末尾的 replace 拆成空格。
 */
const PAREN_RE = /[（(〔[【{「『][^）)〕\]】}」』]*[）)〕\]】}」』]/g;

/**
 * 尾部噪声：特典名、场次说明、上映年份区间
 *
 * 这些不带括号，跟在片名后面，得单独剔。
 * 例：「…人魚島的秘密 Hi Bye Meet & Greet 見面場」剔掉尾部后才是真片名。
 */
const TAIL_NOISE_RE =
  /(?:\s+(?:Hi\s+Bye|Meet\s*&?\s*Greet|見面場|特典場|特典|加碼|加場|優先場|優先|場次|見面會|安可|重映|encore|screener|fandub|dubbed|subbed|導演映後分享場|映後分享場|映後分享|電影分享會|分享會|應援場|應援|謝票|畫冊|杯墊|千秋樂|馬拉松|連映|限定|特別放映|特別加映|現場直播|紀念放映|開畫日|加碼|優先購票|優先場|首映場))+|\s+\d{4}\s*[–—-]\s*\d{2,4}\b|\s+(?:NT\s*Live|The\s*Met|Royal\s*Ballet|GFF|HKIFF)\b.*$/gi;

/** 放映格式品牌词（搜索查询专用）
 *
 *  院线会把规格冠名直接写进片名：4DX / CGS / SCREENX / Infinity Vision…
 *  带去 IMDb / 豆瓣搜索根本找不到正主（《復仇者聯盟4》重映实测踩过）。
 *  只服务**搜索候选**，不碰 enrichKey 的 FORMAT_WORDS —— 改那份词表会让
 *  已有缓存键整体漂移，风险大得多。
 *  刻意只收品牌整词与固定短语：Infinity / Vision 单独出现可能是真片名
 *  （Infinity Pool），只允许「Infinity Vision」成对剥。
 */
const FORMAT_BRAND_PHRASES = ['infinity vision', 'imax with laser'];
const FORMAT_BRAND_WORDS = [
  'imax',
  '4dx',
  'screenx',
  'cgs',
  'luxe',
  'mx4d',
  'dolby',
  'atmos',
  'cinity',
  'dubox',
  'dbox',
];

/** 剥掉片名里的放映格式品牌词（展示侧清洗走各自词表，不要用这个） */
export function stripFormatBrands(s) {
  let out = s || '';
  for (const phrase of FORMAT_BRAND_PHRASES) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), ' ');
  }
  for (const word of FORMAT_BRAND_WORDS) {
    out = out.replace(new RegExp(`(^|[^a-z0-9])${word}(?![a-z0-9])`, 'gi'), '$1 ');
  }
  // 品牌词剥掉后可能留下「SCREENX - 片名」的孤儿连字符，搜索查询顺手收掉
  // 空括号与首尾孤儿分隔符一并收掉（「(IMAX)」剥成「( )」很难看）
  return out
    .replace(/\(\s*\)|（\s*）/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|·•\-–—]+|[\s|·•\-–—]+$/g, '')
    .trim();
}

/**
 * 取「《…》」里的片名（院线把真片名放进书名号时用）
 *
 * 例：「《空槍》T-Shirt特典場」→「空槍」；「《我阿爹想旅行》行得㗎啦見面場」
 * →「我阿爹想旅行」。整体名带装饰时 douban 搜不到，剥干净又可能把
 * 片名一起剥没，所以单独备一份候选。
 */
export function bracketTitle(s) {
  const m = /《([^》]+)》/.exec(s || '');
  return m ? m[1].trim() : '';
}

/** 去掉院线片名里的装饰：括号标记、【】、书名号、尾部噪声、多余空白 */
export function cleanTitle(s) {
  let out = (s || '').replace(PAREN_RE, ' ');
  // 括号可能嵌套/连续，清两遍才能清干净
  out = out.replace(PAREN_RE, ' ');
  out = out.replace(TAIL_NOISE_RE, ' ');
  return out
    .replace(/[《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—]+$/, '')
    .trim();
}

/**
 * 挑出与本片对应的卡片
 *
 * ★ 为什么不能像 IMDb 那样严格比标题：豆瓣主标题是**简体**，
 *   我们存的是**繁体**（「超風」vs「超风」），字符串比对必然不等。
 *   而 search_suggest 本身已按输入做过相关性排序，首位就是它认为的匹配项。
 *   所以这里只做**年份闸门**（挡住同名电视剧/旧版），并把原卡片存下来便于人工核对。
 *
 * 年份闸门口径：豆瓣的年份是**原作首映年**，重映片会比我们的港映年早很多
 * （EVA 1997 → 港映 2026），所以允许往前 45 年，但不允许往后。
 */
export function pickDoubanCard(cards, year) {
  if (!cards.length) return null;
  const y = Number(year);
  if (!y) return cards[0];
  const ok = cards.filter((c) => {
    const cy = c.year ? Number(c.year) : NaN;
    if (!cy) return true; // 卡片没年份时不因此否决
    return cy <= y + 1 && y - cy <= 45;
  });
  return ok[0] || null;
}

/**
 * 片名 → 豆瓣卡片
 *
 * 查询顺序：原中文名 → 清洗中文名 → 原英文名 → 清洗英文名。
 * 中文优先且原名在前，是实测口径（60 部抽样：原名+清洗兼用命中 49，
 * 只用原名为 33）。豆瓣主标题是中文，英文名命中率明显低。
 *
 * ★ 清洗后太短的查询词**直接不用**（不是降权、不是加标题比对）。
 *   search_suggest 不比标题，只给相关性排序；而豆瓣主标题是简体（「超风」）、
 *   我们存繁体（「超風」），字符串根本对不上，也没法在本地验匹得对不对。
 *   所以“M (GFF)”洗成“M”会拿回一堆不相干的《M》——宁可不显示评分。
 *   错配比缺数据严：挂错分用户会当真，缺分只是少一个字段。
 *   匹得对不对靠 alternatives 存下来供人工核对（写进 enrich-manual.json 修正）。
 */
export async function resolveDouban(movie, opt = {}) {
  const zh = (movie.zh || '').trim();
  const en = (movie.en || '').trim();
  const zhClean = stripFormatBrands(cleanTitle(zh));
  const enClean = stripFormatBrands(cleanTitle(en));
  // “够长”的粗略判定：CJK 按字算（≥ 3 字），拉丁按词算（≥ 2 词）
  const longEnough = (s) => {
    if (!s) return false;
    const cjk = (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
    if (cjk) return cjk >= 3;
    return s.split(/\s+/).filter(Boolean).length >= 2;
  };

  // 《》里的片名单独作候选：2 个汉字（「空槍」）就够，比通用清洗更宽，
  // 但仍挡住单字（「M (GFF)」洗出「M」会拿回一堆不相干条目）。
  const zhBracket = bracketTitle(zh);
  const bracketOk = (t) => {
    const cjk = (t.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
    if (cjk) return cjk >= 2;
    return t.split(/\s+/).filter(Boolean).length >= 2;
  };
  const cand = [
    { q: zh, needLong: false },
    { q: zhBracket, needLong: false, shortOk: true },
    { q: zhClean === zh ? '' : zhClean, needLong: true },
    { q: en, needLong: true },
    { q: enClean === en ? '' : enClean, needLong: true },
  ];
  const queries = [];
  for (const x of cand) {
    if (!x.q) continue;
    if (x.needLong && !longEnough(x.q)) continue;
    if (x.shortOk && !bracketOk(x.q)) continue;
    if (queries.includes(x.q)) continue;
    queries.push(x.q);
  }

  let sawFailure = false;
  // ★ 逐段缩短回退（2026-10-08）
  //   豆瓣 search_suggest 要求**每个词都命中**：
  //   「復仇者聯盟4：終局之戰 加碼」能命中，加上「重映」就返回空。
  //   事件词表再全也堵不住长尾，所以对每个查询再备「去掉最后 N 个词元」
  //   的写法，从长到短依次尝试。只对空白分词生效，纯 CJK 单串不动。
  const shrinkQueries = (q) => {
    const parts = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (let n = parts.length - 1; n >= 1; n--) {
      const cand = parts.slice(0, n).join(' ');
      // 至少保留一个「够长」的片名主体，避免退化成单字查询
      if (cand && longEnough(cand)) out.push(cand);
    }
    return out;
  };
  // 上限 12 条：缩短候选是「救急」，不能让单个片名的请求量失控
  // （缩短只影响查询数量，命中即返回，正常片名第一条就命中）。
  const expanded = [];
  outer: for (const q of queries) {
    if (!expanded.includes(q)) expanded.push(q);
    for (const alt of shrinkQueries(q)) {
      if (!expanded.includes(alt)) expanded.push(alt);
      if (expanded.length >= 12) break outer;
    }
  }
  queries.length = 0;
  queries.push(...expanded);

  for (const q of queries) {
    const cards = await doubanSuggest(q, opt);
    if (cards === null) {
      sawFailure = true;
      await sleep(opt.delayMs ?? 250);
      continue;
    }
    if (cards.length) {
      const card = pickDoubanCard(cards, movie.year);
      if (card) {
        return {
          card,
          queriedWith: q,
          alternatives: cards.slice(0, 3).map((c) => `${c.title}(${c.year ?? '?'})`),
        };
      }
    }
    await sleep(opt.delayMs ?? 250);
  }
  // 全部查询都没拿到有效响应时抛出，让 enrich.js 走告警分支：
  // 不写 notFound，下一次刷新自然重试。
  if (sawFailure) throw new Error('douban suggest request failed');
  return null;
}
