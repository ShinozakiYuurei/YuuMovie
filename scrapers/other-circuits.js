import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

async function fetchText(url, { fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function text(value) {
  return decode(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function blocksByClass(html, className, tag = 'div') {
  const opening = new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + className + '\\b[^"]*")[^>]*>', 'gi');
  const token = new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi');
  const blocks = [];
  for (const match of html.matchAll(opening)) {
    token.lastIndex = match.index + match[0].length;
    let depth = 1;
    let end = token.lastIndex;
    let item;
    while ((item = token.exec(html))) {
      if (item[0].startsWith('</')) depth--;
      else if (!item[0].endsWith('/>')) depth++;
      if (depth === 0) { end = token.lastIndex; break; }
    }
    if (depth === 0) blocks.push(html.slice(match.index, end));
  }
  return blocks;
}

function firstText(html, tag, className) {
  const pattern = new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + className + '\\b[^"]*")[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  return text(html.match(pattern)?.[1] || '');
}

function attr(tag, name) {
  const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
  return decode(match?.[1] ?? match?.[2] ?? '');
}

function digest(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 14);
}

function todayHkt() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function epochDate(seconds) {
  return new Date(Number(seconds) * 1000 + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

function epochHkt(seconds) {
  return new Date(Number(seconds) * 1000 + HKT_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

function mapSearch(name, address) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' ' + address);
}

function dateFromDmy(day, month, year) {
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function absoluteUrl(base, href) {
  try { return new URL(decode(href), base).href; } catch { return base; }
}

function scrapeDateTabs(html) {
  const out = new Map();
  const year = Number(todayHkt().slice(0, 4));
  for (const [, day, label] of html.matchAll(/<a[^>]*href="#day-(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const parsed = text(label).match(/([A-Za-z]{3})\s*(\d{1,2})/);
    if (!parsed) continue;
    const month = new Map(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => [m.toLowerCase(), i + 1])).get(parsed[1].toLowerCase());
    if (month) out.set(day, dateFromDmy(parsed[2], month, year));
  }
  return out;
}

function posterTitleKey(title) {
  return String(title || '')
    .normalize('NFKC')
    .replace(/怎麽可能我家的祖先是你家的鬼/g, '怎麼可能我家的祖先是你家的鬼')
    .toLowerCase()
    .replace(/[（(【\[]\s*(?:preview|chi|sp|meet\s*&\s*greet|優先|优先)\s*[)）】\]](?:\s*sp\b)?/gi, ' ')
    .replace(/\s*(?:優先|优先)\s*$/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

export function parseChinachemPosters(html, base = 'https://www.cel-cinemas.com') {
  const posters = new Map();
  for (const slide of blocksByClass(html, 'slide')) {
    const title = text(slide.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '');
    const image = slide.match(/<img\b[^>]*>/i)?.[0] || '';
    const src = attr(image, 'src') || attr(image, 'data-src');
    const key = posterTitleKey(title);
    if (key && src && !/poster-spacer/i.test(src)) posters.set(key, absoluteUrl(base, src));
  }
  return posters;
}

export async function scrapeChinachem() {
  const base = 'https://www.cel-cinemas.com';
  const html = await fetchText(base + '/en/home');
  const posterByTitle = parseChinachemPosters(html, base);
  const tabs = scrapeDateTabs(html);
  const daySections = [...html.matchAll(/<div id="day-(\d+)"[^>]*class="time-wrap"[^>]*>/gi)];
  const movieMap = new Map();
  const shows = [];
  const seenShows = new Set();
  for (let dayIndex = 0; dayIndex < daySections.length; dayIndex++) {
    const section = daySections[dayIndex];
    const end = daySections[dayIndex + 1]?.index ?? html.length;
    const date = tabs.get(section[1]);
    if (!date) continue;
    for (const movieBlock of blocksByClass(html.slice(section.index, end), 'each-movie-wrap')) {
      const title = text(movieBlock.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '');
      if (!title) continue;
      const movieId = 'chinachem-' + digest(title.toLowerCase());
      const image = movieBlock.match(/<img\b[^>]*>/i)?.[0] || '';
      const imageSrc = image ? attr(image, 'src') || attr(image, 'data-src') : '';
      const poster = posterByTitle.get(posterTitleKey(title)) || (imageSrc && !/poster-spacer/i.test(imageSrc) ? absoluteUrl(base, imageSrc) : null);
      const existingMovie = movieMap.get(movieId);
      if (!existingMovie) movieMap.set(movieId, { id: movieId, slug: '', nameZh: '', nameEn: title, openingDate: null, duration: null, category: null, dialect: null, subtitle: null, genres: [], director: null, cast: null, description: '', poster, trailer: null, detailUrl: base + '/en/home', status: 'showing', source: 'chinachem' });
      else if (!existingMovie.poster && poster) existingMovie.poster = poster;
      for (const sessionGroup of blocksByClass(movieBlock, 'session-type')) {
        const typeText = text(sessionGroup.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
        const version = typeText.match(/^(2D|3D|IMAX|4DX|ScreenX)\b/i)?.[1] || null;
        const dialect = typeText.replace(/^(2D|3D|IMAX|4DX|ScreenX)\s*/i, '').split('(')[0].trim() || null;
        const subtitle = typeText.match(/\(([^)]*)\)/)?.[1] || null;
        for (const [, anchor] of sessionGroup.matchAll(/(<a\b[^>]*class="[^"]*\bsession\b[^"]*"[^>]*>[\s\S]*?<\/a>)/gi)) {
          const opening = anchor.match(/^<a\b[^>]*>/i)?.[0] || '';
          const bookingUrl = absoluteUrl(base, attr(opening, 'href'));
          const id = bookingUrl.split('/').pop();
          if (!id || seenShows.has(id)) continue;
          seenShows.add(id);
          const houseName = firstText(anchor, 'p', 'schedule_housename');
          const time = firstText(anchor, 'p', 'time');
          const price = Number(firstText(anchor, 'p', 'price'));
          shows.push({ id: 'chinachem-' + id, movieId, cinemaId: 'chinachem-plnym', houseName, startAt: date + 'T' + time + ':00+08:00', date, price: Number.isFinite(price) ? price : null, seats: null, remainRate: null, soldOut: false, tags: [], version, language: dialect, bookingUrl, source: 'chinachem' });
        }
      }
    }
  }
  if (!shows.length) throw new Error('Chinachem returned no showtimes');
  return { movies: [...movieMap.values()], cinemas: [{ id: 'chinachem-plnym', code: 'PLNYM', nameZh: '巴黎倫敦紐約米蘭戲院', address: 'G/F Hong Lai Garden, Ho Pong Street, Tuen Mun, N.T.', mapUrl: mapSearch('Paris London New York Milano Cinema', 'Hong Lai Garden, Tuen Mun'), detailUrl: base + '/en/home', source: 'chinachem' }], shows };
}

export function parseLumenPoster(_html, filmId, base = 'https://www.lumencinema.com.hk') {
  const id = String(filmId || '').replace(/^f-/i, '');
  if (!id) return null;
  return absoluteUrl(base, `/CDN/media/entity/get/FilmPosterGraphic/f-${id}?width=800&height=1200&referenceScheme=Global&allowPlaceHolder=true`);
}

export async function scrapeLumen() {
  const base = 'https://www.lumencinema.com.hk';
  const routes = [['NowShowing', 'showing'], ['ComingSoon', 'upcoming']];
  const details = new Map();
  for (const [route, status] of routes) {
    const page = await fetchText(base + '/Browsing/Movies/' + route);
    for (const [, href] of page.matchAll(/href="([^\"]*\/Browsing\/Movies\/Details\/[^\"]+)"/gi)) details.set(absoluteUrl(base, href), status);
  }
  const movies = [];
  const shows = [];
  const seenSessions = new Set();
  for (const [url, status] of details) {
    const html = await fetchText(url);
    const filmId = url.match(/Details\/(f-[^/?]+)/i)?.[1] || digest(url);
    const name = firstText(html, 'h3', 'boxout-title') || firstText(html, 'h2', 'film-title');
    if (!name) continue;
    const runtime = Number(html.match(/Run Time:\s*<\/label>\s*<span>(\d+)/i)?.[1]) || null;
    const poster = parseLumenPoster(html, filmId, base);
    const blurb = firstText(html, 'p', 'boxout-blurb');
    const movieId = 'lumen-' + filmId.replace(/^f-/i, '');
    movies.push({ id: movieId, slug: '', nameZh: '', nameEn: name, openingDate: null, duration: runtime, category: null, dialect: null, subtitle: null, genres: [], director: null, cast: null, description: blurb, poster, trailer: null, detailUrl: url, status, source: 'lumen' });
    for (const [, anchor] of html.matchAll(/(<a\b[^>]*class="[^"]*\bsession-time\b[^"]*"[^>]*>[\s\S]*?<\/a>)/gi)) {
      const opening = anchor.match(/^<a\b[^>]*>/i)?.[0] || '';
      const href = attr(opening, 'href');
      const datetime = anchor.match(/<time[^>]+datetime="([^"]+)"/i)?.[1];
      const sessionId = new URL(absoluteUrl(base, href)).searchParams.get('txtSessionId');
      if (!sessionId || !datetime || seenSessions.has(sessionId)) continue;
      seenSessions.add(sessionId);
      const startAt = /(?:Z|[+-]\d\d:\d\d)$/.test(datetime) ? new Date(Date.parse(datetime) + HKT_OFFSET_MS).toISOString().replace('Z', '+08:00') : datetime + '+08:00';
      shows.push({ id: 'lumen-' + sessionId, movieId, cinemaId: 'lumen-1001', houseName: '', startAt, date: datetime.slice(0, 10), price: null, seats: null, remainRate: null, soldOut: false, tags: [], version: anchor.match(/alt="([^"]+)"/i)?.[1] || null, language: null, bookingUrl: absoluteUrl(base, href), source: 'lumen' });
    }
  }
  const cinemaUrl = base + '/Browsing/Cinemas/Details/1001';
  const cinemaPage = await fetchText(cinemaUrl);
  const map = cinemaPage.match(/maps\.google\.com\/maps\?[^"']+/i)?.[0] || '';
  const address = '1-25 Ta Chuen Ping Street, Kwai Chung, N.T.';
  return { movies, shows, cinemas: [{ id: 'lumen-1001', code: '1001', nameZh: 'Lumen Cinema', address, mapUrl: map ? 'https://' + map.replace(/^\/\//, '') : mapSearch('Lumen Cinema', address), detailUrl: cinemaUrl, source: 'lumen' }] };
}

function stripScripts(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
}

export function parseNewportPoster(block, base = 'https://www.theatre.com.hk') {
  const images = [...block.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => tag);
  const posterImage = images.find((tag) => /\bclass\s*=\s*(?:"[^"]*\bmovieImageImg\b[^"]*"|'[^']*\bmovieImageImg\b[^']*')/i.test(tag)) || images[0] || '';
  const src = attr(posterImage, 'src') || attr(posterImage, 'data-src');
  return src ? absoluteUrl(base, src) : null;
}

function dmyDate(day, month) {
  let year = Number(todayHkt().slice(0, 4));
  const currentMonth = Number(todayHkt().slice(5, 7));
  if (currentMonth === 12 && Number(month) === 1) year++;
  if (currentMonth === 1 && Number(month) === 12) year--;
  return dateFromDmy(day, month, year);
}

function time12ToHkt(date, hour, minute, meridiem) {
  let h = Number(hour) % 12;
  if (String(meridiem).toUpperCase() === 'PM') h += 12;
  return date + 'T' + String(h).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00+08:00';
}

export async function scrapeNewport() {
  const base = 'https://www.theatre.com.hk';
  const english = await fetchText(base + '/en/movie/nowshowing?view=list');
  const chinese = await fetchText(base + '/tc/movie/nowshowing?view=list');
  const chineseNames = new Map();
  for (const block of blocksByClass(stripScripts(chinese), 'whiteDiv')) {
    const href = block.match(/data-movie-id="(\d+)"/)?.[1] || block.match(/href="\/tc\/movie\/(\d+)/)?.[1];
    if (href) chineseNames.set(href, firstText(block, 'label', 'movieTopic'));
  }
  const movies = [];
  const shows = [];
  const seenMovies = new Set();
  const seenShows = new Set();
  for (const block of blocksByClass(stripScripts(english), 'whiteDiv')) {
    const movieId = block.match(/data-movie-id="(\d+)"/)?.[1] || block.match(/href="\/en\/movie\/(\d+)/)?.[1];
    if (!movieId) continue;
    const title = firstText(block, 'label', 'movieTopic') || firstText(block, 'a', 'movieTopic');
    if (!title) continue;
    const movieUrl = base + '/en/movie/' + movieId;
    const info = text(block);
    const release = info.match(/Release Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    const openingDate = release ? dateFromDmy(release[1], release[2], release[3]) : null;
    const duration = Number(info.match(/Duration:\s*(\d+)\s*mins/i)?.[1]) || null;
    const category = info.match(/Category:\s*([^\s]+)/i)?.[1] || null;
    const language = info.match(/Language:\s*(.*?)(?:\s+Hyland\s+\(TM\)|\s+\d{1,2}\/\d{2}|$)/i)?.[1]?.trim() || null;
    const dialect = language ? language.replace(/\s*\([^)]*\)/, '').trim() : null;
    const subtitle = language?.match(/\(([^)]*)\)/)?.[1] || null;
    const poster = parseNewportPoster(block, base);
    if (!seenMovies.has(movieId)) {
      seenMovies.add(movieId);
      movies.push({ id: 'newport-' + movieId, slug: '', nameZh: chineseNames.get(movieId) || '', nameEn: title, openingDate, duration, category, dialect, subtitle, genres: [], director: null, cast: null, description: '', poster, trailer: null, detailUrl: movieUrl, status: openingDate && openingDate > todayHkt() ? 'upcoming' : 'showing', source: 'newport' });
    }
    for (const [, sessionId, li] of block.matchAll(/<li\b[^>]*data-index=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/li>/gi)) {
      const label = text(li);
      const row = label.match(/(\d{1,2})\/(\d{1,2}).*?(\d{1,2}):(\d{2})\s*(AM|PM)\s*House\s*([^ ]+)\s*HK\$([\d.]+)/i);
      if (!row || seenShows.has(sessionId)) continue;
      seenShows.add(sessionId);
      const date = dmyDate(row[1], row[2]);
      shows.push({ id: 'newport-' + sessionId, movieId: 'newport-' + movieId, cinemaId: 'newport-hyland', houseName: 'House ' + row[6], startAt: time12ToHkt(date, row[3], row[4], row[5]), date, price: Number(row[7]), seats: null, remainRate: null, soldOut: false, tags: [], category, version: null, language: dialect, bookingUrl: base + '/en/ticketing/seatplan/' + sessionId, source: 'newport' });
    }
  }
  if (!shows.length) throw new Error('Newport returned no showtimes');
  const address = '136 Heung Sze Wui Road, Tuen Mun, N.T.';
  return { movies, shows, cinemas: [{ id: 'newport-hyland', code: 'HYLAND', nameZh: '凱都戲院（屯門）', address, mapUrl: mapSearch('Hyland Theatre', address), detailUrl: base + '/en/cinema/hyland_theatre?page=cinemaSchedule', source: 'newport' }] };
}

async function scrapeSunbeamTable() {
  const base = 'https://www.sunbeamwhampoa.com';
  const html = stripScripts(await fetchText(base + '/'));
  const movies = new Map();
  const shows = [];
  const seenShows = new Set();
  const wrappers = blocksByClass(html, 'rounded-lg').filter((block) => block.includes('電影播放場次') && block.includes('<table'));
  for (const wrapper of wrappers) {
    const dayMatch = wrapper.match(/電影播放場次\s*(\d{1,2})\/(\d{1,2})/);
    if (!dayMatch) continue;
    const date = dmyDate(dayMatch[1], dayMatch[2]);
    const table = wrapper.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
    let hall = '';
    for (const [, rowHtml] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (!cells.length || cells[0].includes('<th')) continue;
      let offset = 0;
      if (cells.length >= 7) { hall = text(cells[0]).replace(/\s+/g, ''); offset = 1; }
      if (cells.length - offset < 6) continue;
      const time = text(cells[offset]);
      const titleHtml = cells[offset + 1];
      const titleZh = text(titleHtml.replace(/<span\b[\s\S]*$/i, ''));
      const titleEn = text(titleHtml.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
      if (!time || !titleZh) continue;
      const key = titleEn || titleZh;
      const movieId = 'sunbeam-' + digest(key.toLowerCase());
      const duration = Number(text(cells[offset + 2])) || null;
      const language = text(cells[offset + 3]) || null;
      const subtitle = text(cells[offset + 4]) || null;
      const category = text(cells[offset + 5]) || null;
      if (!movies.has(movieId)) movies.set(movieId, { id: movieId, slug: '', nameZh: titleZh, nameEn: titleEn, openingDate: null, duration, category, dialect: language, subtitle, genres: [], director: null, cast: null, description: '', poster: null, trailer: null, detailUrl: base + '/schedule', status: 'showing', source: 'sunbeam' });
      const id = date + '-' + hall + '-' + time + '-' + movieId;
      if (seenShows.has(id)) continue;
      seenShows.add(id);
      shows.push({ id: 'sunbeam-' + digest(id), movieId, cinemaId: 'sunbeam-1', houseName: hall, startAt: date + 'T' + time + ':00+08:00', date, price: null, seats: null, remainRate: null, soldOut: false, tags: [], category, version: null, language, bookingUrl: base + '/schedule', source: 'sunbeam' });
    }
  }
  if (!shows.length) throw new Error('Sunbeam returned no showtimes');
  const address = '九龍紅磡德安街7號黃埔天地螢幕圈（第八期）2樓';
  return { movies: [...movies.values()], shows, cinemas: [{ id: 'sunbeam-1', code: 'WHAMPOA', nameZh: '新光黃埔影藝城', address, mapUrl: mapSearch('Sunbeam Whampoa', address), detailUrl: base + '/', source: 'sunbeam' }] };
}

function decodeJsString(value) {
  const normalized = String(value).replace(/\\x([\da-f]{2})/gi, '\\u00$1');
  try { return JSON.parse(String.fromCharCode(34) + normalized + String.fromCharCode(34)); } catch { return normalized; }
}

export function parseSunbeamPoster(eventBody, base = 'https://cdn.sunbeamwhampoa.com') {
  const raw = eventBody.match(/coverUrl:"((?:\\.|[^"\\])*)"/)?.[1];
  if (!raw) return null;
  const coverUrl = decodeJsString(raw);
  return coverUrl ? absoluteUrl(base, coverUrl) : null;
}

export async function scrapeSunbeam() {
  const base = 'https://www.sunbeamwhampoa.com';
  const html = await fetchText(base + '/');
  const events = [...html.matchAll(/event:\$R\[\d+\]=\{id:(\d+),eventId:(?:null|\d+),filmId:"([^"]*)",objectId:"([^"]*)",eventNameTc:"((?:\\.|[^"\\])*)",eventNameEn:"((?:\\.|[^"\\])*)"/g)];
  const movies = new Map();
  const shows = new Map();
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex];
    const end = events[eventIndex + 1]?.index ?? html.length;
    const body = html.slice(event.index, end);
    const eventId = event[1];
    const movieId = 'sunbeam-' + eventId;
    const nameZh = decodeJsString(event[4]);
    const nameEn = decodeJsString(event[5]);
    const poster = parseSunbeamPoster(body);
    movies.set(movieId, { id: movieId, slug: '', nameZh, nameEn, openingDate: null, duration: null, category: null, dialect: null, subtitle: null, genres: [], director: null, cast: null, description: '', poster, trailer: null, detailUrl: base + '/schedule', status: 'showing', source: 'sunbeam' });
    for (const match of body.matchAll(/id:(\d+),eventId:(\d+),objectId:"([^"]*)",startDate:"(\d{4}-\d{2}-\d{2})",endDate:"[^"]+",startTime:"(\d{2}:\d{2})",startTimestamp:\d+,endTimestamp:\d+,venue:"([^"]+)",status:(!0|!1),ticketPrice:"([^"]*)"/g)) {
      const showId = match[1];
      const date = match[4];
      const startTime = match[5];
      const venue = match[6];
      if (match[7] !== '!0' || shows.has(showId)) continue;
      const price = Number(String(match[8]).split('/')[0]);
      shows.set(showId, { id: 'sunbeam-' + showId, movieId, cinemaId: 'sunbeam-1', houseName: venue + '院', startAt: date + 'T' + startTime + ':00+08:00', date, price: Number.isFinite(price) ? price : null, seats: null, remainRate: null, soldOut: false, tags: [], category: null, version: null, language: null, bookingUrl: base + '/schedule', source: 'sunbeam' });
    }
  }
  if (!shows.size) throw new Error('Sunbeam returned no showtimes');
  const address = '九龍紅磡德安街7號黃埔天地螢幕圈（第八期）2樓';
  return { movies: [...movies.values()], shows: [...shows.values()], cinemas: [{ id: 'sunbeam-1', code: 'WHAMPOA', nameZh: '新光黃埔影藝城', address, mapUrl: mapSearch('Sunbeam Whampoa', address), detailUrl: base + '/', source: 'sunbeam' }] };
}

function nuxtState(html, source = 'Golden Scene') {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const script = scripts.find((value) => value.includes('window.__NUXT__='));
  if (!script) throw new Error(source + ' page has no Nuxt payload');
  const sandbox = { window: {} };
  runInNewContext(script, sandbox, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  return sandbox.window.__NUXT__?.data?.[0] || {};
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }));
  return out;
}

async function scrapeGoldenSceneLegacy({ maxMovies = 0 } = {}) {
  const base = 'https://goldenscene.com';
  const urls = new Set();
  for (const route of ['/?movieList=SHOWING', '/?movieList=UPCOMING', '/?movieList=SPECIAL']) {
    const html = await fetchText(base + route);
    for (const [, href] of html.matchAll(/href="(\/movie\/[^"#]+)"/gi)) urls.add(absoluteUrl(base, href));
  }
  const selected = [...urls].slice(0, maxMovies > 0 ? maxMovies : 60);
  const pages = await mapLimit(selected, 4, async (url) => {
    try { return { url, data: nuxtState(await fetchText(url)) }; } catch (error) {
      console.warn('[goldenscene] ' + error.message);
      return null;
    }
  });
  const movies = new Map();
  const shows = new Map();
  for (const page of pages.filter(Boolean)) {
    const movie = page.data.movie;
    if (!movie?.uuid) continue;
    const id = 'goldenscene-' + movie.uuid;
    const openingDate = movie.releaseAt ? epochDate(movie.releaseAt) : null;
    movies.set(id, {
      id,
      slug: '',
      nameZh: movie.name?.zhHK || '',
      nameEn: movie.name?.enGB || '',
      openingDate,
      duration: Number(movie.duration) || null,
      category: movie.category?.zhHK || null,
      dialect: movie.language?.zhHK || null,
      subtitle: movie.subtitle?.zhHK || null,
      genres: (movie.genres || []).map((genre) => genre.zhHK || genre.enGB || genre).filter(Boolean),
      director: (movie.directors || []).map((person) => person.zhHK || person.enGB || person).filter(Boolean).join(', ') || null,
      cast: (movie.casts || []).map((person) => person.zhHK || person.enGB || person).filter(Boolean).join(', ') || null,
      description: movie.synopsis?.zhHK || movie.synopsis?.enGB || '',
      poster: movie.posterUrl || null,
      trailer: (movie.trailerUrls || [])[0] || null,
      detailUrl: page.url,
      status: openingDate && openingDate > todayHkt() ? 'upcoming' : 'showing',
      source: 'goldenscene',
    });
    for (const day of page.data.schedule || []) {
      const date = epochDate(day.date);
      for (const item of day.shows || []) {
        const show = item.show || {};
        if (!show.uuid || show.status === 0) continue;
        const house = item.house || {};
        const showId = 'goldenscene-' + show.uuid;
        const occupancy = Number(item.occupancyRate);
        const houseName = house.name?.zhHK || house.name?.enGB || '';
        shows.set(showId, {
          id: showId,
          movieId: id,
          cinemaId: 'goldenscene-1',
          houseName: houseName ? houseName + '號院' : '',
          startAt: epochHkt(show.startTime),
          date,
          price: Number.isFinite(Number(show.price)) ? Number(show.price) : null,
          seats: Number(house.seats) || null,
          remainRate: Number.isFinite(occupancy) ? Math.max(0, Math.min(1, 1 - occupancy / 100)) : null,
          soldOut: show.status !== 1 || occupancy >= 100,
          tags: [],
          category: movie.category?.zhHK || null,
          version: (item.versionTags || []).map((tag) => tag.name?.zhHK || tag.name?.enGB || '').filter(Boolean).join(' '),
          language: movie.language?.zhHK || null,
          bookingUrl: page.url,
          source: 'goldenscene',
        });
      }
    }
  }
  if (!shows.size) throw new Error('Golden Scene returned no showtimes');
  const address = '堅尼地城吉席街2號';
  return { movies: [...movies.values()], shows: [...shows.values()], cinemas: [{ id: 'goldenscene-1', code: 'GSC', nameZh: '高先電影院', address, mapUrl: mapSearch('高先電影院', address), detailUrl: base + '/cinema', source: 'goldenscene' }] };
}

const LUX_CINEMA_ID = '0ab2c645-1ba1-4b43-94ce-da1d2cf78077';
const LUX_CINEMA_URL = 'https://hkmovie6.com/cinema/' + LUX_CINEMA_ID + '/寶石戲院';
const LUX_API = 'https://m6-api.movie6.com';
const LUX_HEADERS = {
  'content-type': 'application/grpc-web+proto',
  'x-grpc-web': '1',
  Type: 'application/grpc',
  language: 'zhHK',
  origin: 'https://hkmovie6.com',
  referer: 'https://hkmovie6.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
};

function protobufVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n > 127n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function protobufField(field, wire, payload) {
  return Buffer.concat([protobufVarint((field << 3) | wire), payload]);
}

function protobufString(field, value) {
  const bytes = Buffer.from(String(value), 'utf8');
  return Buffer.concat([protobufVarint((field << 3) | 2), protobufVarint(bytes.length), bytes]);
}

function protobufInt(field, value) {
  return protobufField(field, 0, protobufVarint(value));
}

function protobufFrame(payload) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function readVarint(bytes, state) {
  let value = 0n;
  let shift = 0n;
  while (state.index < bytes.length) {
    const byte = bytes[state.index++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7n;
    if (shift > 70n) break;
  }
  throw new Error('Invalid/truncated protobuf varint');
}

function protobufFields(bytes) {
  const fields = [];
  const state = { index: 0 };
  while (state.index < bytes.length) {
    const tag = Number(readVarint(bytes, state));
    const number = tag >>> 3;
    const wire = tag & 7;
    if (!number) throw new Error('Invalid protobuf field number');
    if (wire === 0) {
      let value = readVarint(bytes, state);
      if (value >= 0x8000000000000000n) value -= 0x10000000000000000n;
      fields.push({ number, wire, value: Number(value) });
    } else if (wire === 1) {
      if (state.index + 8 > bytes.length) throw new Error('Truncated protobuf fixed64');
      fields.push({ number, wire, value: bytes.readDoubleLE(state.index), bytes: bytes.subarray(state.index, state.index + 8) });
      state.index += 8;
    } else if (wire === 2) {
      const length = Number(readVarint(bytes, state));
      if (state.index + length > bytes.length) throw new Error('Truncated protobuf bytes');
      fields.push({ number, wire, bytes: bytes.subarray(state.index, state.index + length) });
      state.index += length;
    } else if (wire === 5) {
      if (state.index + 4 > bytes.length) throw new Error('Truncated protobuf fixed32');
      fields.push({ number, wire, value: bytes.readFloatLE(state.index) });
      state.index += 4;
    } else {
      throw new Error('Unsupported protobuf wire type ' + wire);
    }
  }
  return fields;
}

function protobufText(field) {
  return field?.bytes?.toString('utf8') || '';
}

function grpcWebMessages(body) {
  const messages = [];
  let status = null;
  let index = 0;
  while (index < body.length) {
    if (index + 5 > body.length) throw new Error('Truncated gRPC-Web frame');
    const flags = body[index];
    const length = body.readUInt32BE(index + 1);
    index += 5;
    if (index + length > body.length) throw new Error('Truncated gRPC-Web payload');
    const payload = body.subarray(index, index + length);
    index += length;
    if (flags === 0) messages.push(payload);
    else if (flags === 0x80) {
      const trailers = payload.toString('utf8');
      status = Number(trailers.match(/(?:^|\r?\n)grpc-status:\s*(\d+)/i)?.[1]);
      if (status !== 0) {
        const message = trailers.match(/(?:^|\r?\n)grpc-message:\s*([^\r\n]*)/i)?.[1] || 'unknown gRPC error';
        throw new Error('HK Movie 6 gRPC status ' + (Number.isFinite(status) ? status : 'missing') + ': ' + message);
      }
    } else {
      throw new Error('Unsupported gRPC-Web frame flags ' + flags);
    }
  }
  if (status !== 0) throw new Error('HK Movie 6 gRPC response has no successful status trailer');
  return messages;
}

async function luxGrpc(method, payload, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(LUX_API + '/showpb.ShowAPI/' + method, {
    method: 'POST',
    headers: { ...LUX_HEADERS, authorization: token },
    body: protobufFrame(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('HK Movie 6 ' + method + ' → HTTP ' + response.status);
  const messages = grpcWebMessages(Buffer.from(await response.arrayBuffer()));
  if (messages.length !== 1) throw new Error('HK Movie 6 ' + method + ' returned ' + messages.length + ' protobuf messages');
  return messages[0];
}

async function luxAnonymousToken(fetchImpl) {
  const response = await fetchImpl(LUX_API + '/userpb.API/Anonymous', {
    method: 'POST',
    headers: LUX_HEADERS,
    body: protobufFrame(Buffer.alloc(0)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('HK Movie 6 anonymous access → HTTP ' + response.status);
  const messages = grpcWebMessages(Buffer.from(await response.arrayBuffer()));
  const token = messages.map((message) => message.toString('latin1').match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]).find(Boolean);
  if (!token) throw new Error('HK Movie 6 anonymous access returned no access token');
  return token;
}

function luxDateFromEpoch(seconds) {
  return epochDate(seconds);
}

function movieFromLuxFields(bytes) {
  const fields = protobufFields(bytes);
  const value = (number) => fields.find((field) => field.number === number);
  const id = protobufText(value(1));
  const nameZh = protobufText(value(2));
  if (!id || !nameZh) return null;
  const openingEpoch = value(3)?.value;
  const openingDate = openingEpoch ? luxDateFromEpoch(openingEpoch) : null;
  return {
    id: 'lux-' + id,
    slug: '',
    nameZh,
    nameEn: '',
    openingDate,
    duration: Number(value(9)?.value) || null,
    category: null,
    dialect: null,
    subtitle: null,
    genres: [],
    director: null,
    cast: null,
    description: protobufText(value(14)),
    poster: protobufText(value(4)) || null,
    trailer: null,
    detailUrl: 'https://hkmovie6.com/movie/' + id,
    status: openingDate && openingDate > todayHkt() ? 'upcoming' : 'showing',
    source: 'lux',
  };
}

function showFromLuxFields(bytes, movieId, version, scheduleDate) {
  const fields = protobufFields(bytes);
  const value = (number) => fields.find((field) => field.number === number);
  const startEpoch = Number(value(2)?.value || 0);
  const id = protobufText(value(5));
  if (!id || !startEpoch) return null;
  const attendanceField = value(12);
  const attendance = attendanceField?.bytes ? Number(attendanceField.bytes.readBigInt64LE()) : attendanceField?.value;
  const time = epochHkt(startEpoch);
  // HK Movie 6 omits purchasableurl for 宝石戏院 (purchasable=false).
  const sourceBookingUrl = protobufText(value(13));
  return {
    id: 'lux-' + id,
    movieId,
    cinemaId: 'lux-1',
    houseName: protobufText(value(1)),
    startAt: time,
    date: luxDateFromEpoch(startEpoch) || scheduleDate,
    price: Number(value(3)?.value) || null,
    seats: null,
    remainRate: null,
    soldOut: attendance === 1,
    tags: [],
    category: null,
    version: version || null,
    language: null,
    bookingUrl: sourceBookingUrl ? absoluteUrl('https://hkmovie6.com', sourceBookingUrl) : LUX_CINEMA_URL,
    source: 'lux',
  };
}

export function parseLuxCinemaPage(html) {
  const page = nuxtState(html, 'HK Movie 6');
  if (page.cinema?.uuid !== LUX_CINEMA_ID) throw new Error('HK Movie 6 page is not the 宝石戏院 cinema');
  const dates = [...new Set((page.showDates || []).map(Number).filter((date) => Number.isFinite(date) && date > 0))];
  if (!dates.length) throw new Error('HK Movie 6 returned no cinema schedule dates');
  return { page, dates };
}

export function normalizeLuxSchedules(page, scheduleResponses) {
  const movies = new Map();
  const shows = new Map();
  for (const [scheduleDate, response] of scheduleResponses) {
    for (const row of protobufFields(response).filter((field) => field.number === 1 && field.wire === 2)) {
      const localized = protobufFields(row.bytes);
      const movieField = localized.find((field) => field.number === 1 && field.wire === 2);
      if (!movieField) continue;
      const movie = movieFromLuxFields(movieField.bytes);
      if (!movie) continue;
      movies.set(movie.id, movie);
      const version = protobufText(localized.find((field) => field.number === 2 && field.wire === 2));
      for (const showField of localized.filter((field) => field.number === 3 && field.wire === 2)) {
        const show = showFromLuxFields(showField.bytes, movie.id, version, luxDateFromEpoch(scheduleDate));
        if (show) shows.set(show.id, show);
      }
    }
  }

  const cinema = page.cinema || {};
  const address = cinema.address || '九龍紅磡寶其利街2J號';
  return {
    movies: [...movies.values()],
    shows: [...shows.values()],
    cinemas: [{
      id: 'lux-1',
      code: 'LUX',
      nameZh: cinema.name || '寶石戲院',
      address,
      mapUrl: cinema.mapUrl || mapSearch('Lux Theatre', address),
      detailUrl: LUX_CINEMA_URL,
      source: 'lux',
    }],
  };
}

export async function scrapeLuxDirectory({ fetchImpl = fetch } = {}) {
  const html = await fetchText(LUX_CINEMA_URL, { fetchImpl });
  const { page, dates } = parseLuxCinemaPage(html);
  const token = await luxAnonymousToken(fetchImpl);
  const responses = await mapLimit(dates, 3, async (date) => {
    const payload = Buffer.concat([protobufString(1, LUX_CINEMA_ID), protobufInt(2, date)]);
    return [date, await luxGrpc('ListByCinemaAndDate', payload, { token, fetchImpl })];
  });
  const result = normalizeLuxSchedules(page, responses);
  if (!result.shows.length) throw new Error('Lux returned no showtimes');
  return result;
}

export async function scrapeGoldenScene({ maxMovies = 0 } = {}) {
  const base = 'https://goldenscene.com';
  const movieUrls = new Set();
  for (const route of ['/?movieList=SHOWING', '/?movieList=UPCOMING', '/?movieList=SPECIAL']) {
    const html = await fetchText(base + route);
    for (const [, href] of html.matchAll(/href="(\/movie\/[^"#]+)"/gi)) movieUrls.add(absoluteUrl(base, href));
  }
  const selected = [...movieUrls].slice(0, maxMovies > 0 ? maxMovies : 60);
  const rows = await mapLimit(selected, 4, async (url) => {
    try { return { url, data: nuxtState(await fetchText(url)) }; }
    catch (error) { console.warn('[goldenscene] ' + error.message); return null; }
  });
  const movies = new Map();
  const shows = new Map();
  for (const row of rows.filter(Boolean)) {
    const movie = row.data.movie;
    if (!movie?.uuid) continue;
    const movieId = 'goldenscene-' + movie.uuid;
    const openingDate = movie.releaseAt ? epochDate(movie.releaseAt) : null;
    movies.set(movieId, { id: movieId, slug: '', nameZh: movie.name?.zhHK || '', nameEn: movie.name?.enGB || '', openingDate, duration: Number(movie.duration) || null, category: movie.category?.zhHK || null, dialect: movie.language?.zhHK || null, subtitle: movie.subtitle?.zhHK || null, genres: (movie.genres || []).map((item) => item.zhHK || item.enGB || item).filter(Boolean), director: (movie.directors || []).map((item) => item.zhHK || item.enGB || item).filter(Boolean).join(', ') || null, cast: (movie.casts || []).map((item) => item.zhHK || item.enGB || item).filter(Boolean).join(', ') || null, description: movie.synopsis?.zhHK || movie.synopsis?.enGB || '', poster: movie.posterUrl || null, trailer: (movie.trailerUrls || [])[0] || null, detailUrl: row.url, status: openingDate && openingDate > todayHkt() ? 'upcoming' : 'showing', source: 'goldenscene' });
    for (const day of row.data.schedule || []) for (const item of day.shows || []) {
      const show = item.show || {};
      if (!show.uuid || show.status === 0) continue;
      const house = item.house || {};
      const occupancy = Number(item.occupancyRate);
      const showId = 'goldenscene-' + show.uuid;
      shows.set(showId, { id: showId, movieId, cinemaId: 'goldenscene-1', houseName: (house.name?.zhHK || house.name?.enGB || '') + '號院', startAt: epochHkt(show.startTime), date: epochDate(day.date), price: Number.isFinite(Number(show.price)) ? Number(show.price) : null, seats: Number(house.seats) || null, remainRate: Number.isFinite(occupancy) ? Math.max(0, Math.min(1, 1 - occupancy / 100)) : null, soldOut: show.status !== 1 || occupancy >= 100, tags: [], category: movie.category?.zhHK || null, version: (item.versionTags || []).map((tag) => tag.name?.zhHK || tag.name?.enGB || '').filter(Boolean).join(' '), language: movie.language?.zhHK || null, bookingUrl: row.url, source: 'goldenscene' });
    }
  }
  if (!shows.size) throw new Error('Golden Scene returned no showtimes');
  const address = '堅尼地城吉席街2號';
  return { movies: [...movies.values()], shows: [...shows.values()], cinemas: [{ id: 'goldenscene-1', code: 'GSC', nameZh: '高先電影院', address, mapUrl: mapSearch('高先電影院', address), detailUrl: base + '/cinema', source: 'goldenscene' }] };
}
