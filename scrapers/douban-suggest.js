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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!res || !res.ok) return [];
  const j = await res.json().catch(() => null);
  const cards = Array.isArray(j?.cards) ? j.cards : [];
  return cards
    .filter((c) => c && c.title)
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

/** 括号类装饰（院线自己加的场次/版本/特典说明） */
const PAREN_RE = /[（(〔[【{「『《][^）)〕\]】}」』》]*[）)〕\]】}」』》]/g;

/**
 * 尾部噪声：特典名、场次说明、上映年份区间
 *
 * 这些不带括号，跟在片名后面，得单独剔。
 * 例：「…人魚島的秘密 Hi Bye Meet & Greet 見面場」剔掉尾部后才是真片名。
 */
const TAIL_NOISE_RE =
  /(?:\s+(?:Hi\s+Bye|Meet\s*&?\s*Greet|見面場|特典場|特典|加碼|加場|優先場|優先|場次|見面會|安可|重映|encore|screener|fandub|dubbed|subbed))+|\s+\d{4}\s*[–—-]\s*\d{2,4}\b|\s+(?:NT\s*Live|The\s*Met|Royal\s*Ballet|GFF|HKIFF)\b.*$/gi;

/** 去掉院线片名里的装饰：括号标记、【】、书名号、尾部噪声、多余空白 */
export function cleanTitle(s) {
  let out = (s || '').replace(PAREN_RE, ' ');
  // 括号可能嵌套/连续，清两遍才能清干净
  out = out.replace(PAREN_RE, ' ');
  out = out.replace(TAIL_NOISE_RE, ' ');
  return out.replace(/[《》]/g, ' ').replace(/\s+/g, ' ').trim();
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
  const zhClean = cleanTitle(zh);
  const enClean = cleanTitle(en);
  // “够长”的粗略判定：CJK 按字算（≥ 3 字），拉丁按词算（≥ 2 词）
  const longEnough = (s) => {
    if (!s) return false;
    const cjk = (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
    if (cjk) return cjk >= 3;
    return s.split(/\s+/).filter(Boolean).length >= 2;
  };

  const cand = [
    { q: zh, needLong: false },
    { q: zhClean === zh ? '' : zhClean, needLong: true },
    { q: en, needLong: true },
    { q: enClean === en ? '' : enClean, needLong: true },
  ];
  const queries = [];
  for (const x of cand) {
    if (!x.q) continue;
    if (x.needLong && !longEnough(x.q)) continue;
    if (queries.includes(x.q)) continue;
    queries.push(x.q);
  }

  for (const q of queries) {
    const cards = await doubanSuggest(q, opt);
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
  return null;
}
