const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
const CHANNELS = { cgv: { base: 'https://cgv.com.hk', route: 'zh' }, cineart: { base: 'https://cinearthouse.com.hk', route: 'hk' } };
async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

function flightText(html) {
  const chunks = [];
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const [, data] of script.matchAll(/self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g)) {
      try { chunks.push(JSON.parse('"' + data + '"')); } catch {}
    }
  }
  return chunks.join('');
}

function jsonValueAfter(text, key) {
  const marker = String.fromCharCode(34) + key + String.fromCharCode(34) + ':';
  const position = text.indexOf(marker);
  if (position < 0) return null;
  let start = position + marker.length;
  while (/\s/.test(text[start] || ' ')) start++;
  const opener = text[start];
  if (opener !== '[' && opener !== '{') return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char.charCodeAt(0) === 34) quoted = false;
    } else if (char.charCodeAt(0) === 34) quoted = true;
    else if (char === opener) depth++;
    else if ((opener === '[' && char === ']') || (opener === '{' && char === '}')) {
      if (--depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  return null;
}

function pageData(html) {
  const flight = flightText(html);
  if (!flight) throw new Error('GrabTicks page has no Flight payload');
  return {
    movies: jsonValueAfter(flight, 'movies') || [],
    shows: jsonValueAfter(flight, 'shows') || [],
    sites: jsonValueAfter(flight, 'showSites') || [],
    siteGroups: jsonValueAfter(flight, 'siteGroups') || [],
    houses: jsonValueAfter(flight, 'houses') || [],
  };
}

function localized(value, lang) {
  if (!value) return '';
  if (typeof value === 'string') {
    try { return localized(JSON.parse(value), lang); } catch { return value; }
  }
  return value[lang || 'zh_hk'] || value.zhHK || value.zh || value.en || value.enGB || '';
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function datePart(value) {
  return String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
}

function hktIso(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + HKT_OFFSET_MS).toISOString().replace('Z', '+08:00') : null;
}

function todayHkt() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function imageUrl(value) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : 'https://media.grabticks.com/' + String(value).replace(/^\//, '');
}

function normalizeGrabTicks(source, raw, cfg) {
  const movieById = new Map(raw.movies.map((movie) => [String(movie.id), movie]));
  const groupedSites = raw.siteGroups.flatMap((group) => group.items || []).map((item) => item.site).filter(Boolean);
  const sites = groupedSites.length ? groupedSites : raw.sites;
  const houses = new Map(raw.houses.map((house) => [String(house.id), house]));
  for (const site of sites) for (const house of site.houses || []) houses.set(String(house.id), house);

  const movies = [...movieById.values()].map((movie) => {
    const openingDate = datePart(movie.openingDate);
    return {
      id: source + '-' + movie.id,
      slug: '',
      nameZh: localized(movie.name_lang || movie.title_lang || movie.name) || movie.title || movie.name || '',
      nameEn: localized(movie.name_lang || movie.title_lang || movie.name, 'en') || movie.title || movie.name || '',
      openingDate,
      duration: Number(movie.duration) || null,
      category: movie.category || null,
      dialect: localized(movie.dialect_lang || movie.dialect) || null,
      subtitle: localized(movie.subtitle_lang || movie.subtitle) || null,
      genres: (movie.movieTypes || []).map((item) => localized(item.name_lang || item.name)).filter(Boolean),
      director: localized(movie.director_lang || movie.director) || null,
      cast: localized(movie.cast_lang || movie.cast) || null,
      description: plainText(localized(movie.description_lang || movie.description)),
      poster: imageUrl((movie.images || [])[0]),
      trailer: movie.trailer || null,
      detailUrl: cfg.base + '/' + cfg.route + '/movie/' + movie.id,
      status: openingDate && openingDate > todayHkt() ? 'upcoming' : 'showing',
      source,
    };
  });

  const cinemas = [...new Map(sites.map((site) => [String(site.id), site])).values()].map((site) => {
    const name = localized(site.name_lang || site.name) || site.shortName || site.name || '';
    const rawAddress = localized(site.address_lang || site.address) || site.address || '';
    const address = rawAddress === '.' && source === 'cineart' && String(site.id) === '23'
      ? 'L2, Phase 4, MOSTown, 18 On Luk Street, Ma On Shan, N.T.'
      : rawAddress === '.' ? '' : plainText(rawAddress);
    const query = encodeURIComponent([name, address].filter(Boolean).join(' '));
    return {
      id: source + '-' + site.id,
      code: String(site.code || site.id),
      nameZh: name,
      address,
      mapUrl: site.googleMapUrl || 'https://www.google.com/maps/search/?api=1&query=' + query,
      detailUrl: cfg.base + '/' + cfg.route,
      source,
    };
  });

  const shows = [];
  const seen = new Set();
  for (const show of raw.shows) {
    const id = String(show.id);
    const movieId = String(show.movie?.id || '');
    const siteId = String(show.site?.id || '');
    const startAt = hktIso(show.time);
    const date = datePart(show.date);
    if (!id || !movieId || !siteId || !date || !startAt || seen.has(id)) continue;
    seen.add(id);
    const movie = movieById.get(movieId) || show.movie || {};
    const house = houses.get(String(show.house?.id));
    const version = [movie.attr1, movie.attr2, movie.attr3, movie.attr4, movie.attr5]
      .map((attr) => localized(attr?.name_lang || attr?.name)).filter(Boolean).join(' ') || null;
    const seats = Number(show.seats) || null;
    const available = Number(show.avaliable);
    shows.push({
      id: source + '-' + id,
      movieId: source + '-' + movieId,
      cinemaId: source + '-' + siteId,
      houseName: localized(house?.name_lang || house?.name) || String(show.house?.id || ''),
      startAt,
      date,
      price: Number.isFinite(Number(show.price)) ? Number(show.price) : null,
      seats,
      remainRate: seats && Number.isFinite(available) ? Math.max(0, Math.min(1, available / seats)) : null,
      soldOut: Number.isFinite(available) ? available <= 0 : false,
      tags: [...(show.tags || []), ...(show.manualTags || [])].filter((tag) => typeof tag === 'string'),
      category: movie.category || null,
      version,
      language: localized(movie.dialect_lang || movie.dialect) || null,
      bookingUrl: cfg.base + '/' + cfg.route + '/show/' + id,
      source,
    });
  }
  return { movies, cinemas, shows };
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

export async function scrapeCineArt() {
  const cfg = CHANNELS.cineart;
  const result = normalizeGrabTicks('cineart', pageData(await fetchText(cfg.base + '/' + cfg.route)), cfg);
  if (!result.cinemas.length || !result.shows.length) throw new Error('CineArt returned incomplete show data');
  return result;
}

export async function scrapeCgv({ maxMovies = 0 } = {}) {
  const cfg = CHANNELS.cgv;
  const listing = await fetchText(cfg.base + '/' + cfg.route + '/movie');
  const ids = [...new Set([...listing.matchAll(/href=["']\/zh\/movie\/(\d+)/g)].map((match) => match[1]))];
  const selected = maxMovies > 0 ? ids.slice(0, maxMovies) : ids;
  if (!selected.length) throw new Error('CGV movie listing returned no movie links');

  const pages = await mapLimit(selected, 3, async (id) => {
    try { return pageData(await fetchText(cfg.base + '/' + cfg.route + '/movie/' + id)); }
    catch (error) { console.warn('[cgv] movie ' + id + ': ' + error.message); return null; }
  });
  const merged = { movies: [], shows: [], sites: [], siteGroups: [], houses: [] };
  for (const page of pages.filter(Boolean)) {
    merged.movies.push(...page.movies);
    merged.shows.push(...page.shows);
    merged.sites.push(...page.sites);
    merged.siteGroups.push(...page.siteGroups);
    merged.houses.push(...page.houses);
  }
  const result = normalizeGrabTicks('cgv', merged, cfg);
  if (!result.cinemas.length || !result.shows.length) throw new Error('CGV returned incomplete show data');
  return result;
}
