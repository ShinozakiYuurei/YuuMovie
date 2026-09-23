#!/usr/bin/env node
/** 离线回归：MCL 官方详情只在 ID+完整片名匹配时进入电影组/资料卡。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMclMovieDetails, scrapeMcl } from '../scrapers/mcl.js';
import { normalizeTitle } from '../lib/versions.ts';

const fixtures = [
  {
    id: 14743, title: '以你的名字呼喚我 (特別放映)', english: 'Call Me by Your Name',
    minutes: 132, category: 'III', director: '魯卡加達連奴',
    cast: '添麥菲查洛美、艾米漢默',
    raw: [{ id: 14743, mn: '以你的名字呼喚我 (特別放映)',
      b: { mg: '劇情、愛情 (特備節目)', mrt: '132', mc: 'III', ml: '', ms: '' },
      e: { md: '魯卡加達連奴', mc: '<p>添麥菲查洛美、艾米漢默</p>' },
      i: '<p>艾利奧與奧利華在意大利相識，譜寫出一段夏日戀曲。</p>' }],
  },
  {
    id: 14855, title: '《情書》30周年修復版 (「相約在The One」特別放映)', english: 'Love Letter',
    minutes: 117, category: 'I', director: '岩井俊二',
    cast: '中山美穗、豐川悅司、酒井美紀、柏原崇',
    raw: [{ id: 14855, mn: '《情書》30周年修復版 (「相約在The One」特別放映)',
      b: { mg: '劇情、愛情 (特備節目)', mrt: '117', mc: 'I', ml: '', ms: '' },
      e: { md: '岩井俊二', mc: '<p>中山美穗、豐川悅司、酒井美紀、柏原崇</p>' },
      i: '<p>渡邊博子寄出一封信，竟收到同名女子的回覆……</p>' }],
  },
];

assert.equal(normalizeTitle(fixtures[0].title), normalizeTitle('以你的名字呼喚我'));
assert.equal(normalizeTitle(fixtures[1].title), normalizeTitle('情書'));
assert.notEqual(normalizeTitle(fixtures[1].title), normalizeTitle('情書未寄出的一封信'));
for (const f of fixtures) {
  const parsed = parseMclMovieDetails(f.raw, String(f.id), f.title);
  assert.ok(parsed);
  assert.equal(parsed.nameEn, f.english);
  assert.equal(parsed.duration, f.minutes);
  assert.equal(parsed.category, f.category);
  assert.equal(parsed.director, f.director);
  assert.equal(parsed.cast, f.cast);
  assert.deepEqual(parsed.genres, ['劇情', '愛情']);
  assert.ok(parsed.description && !parsed.description.includes('<p>'));
  assert.equal(parseMclMovieDetails(f.raw, String(f.id + 1), f.title), null, '拒绝错误 ID');
  assert.equal(parseMclMovieDetails(f.raw, String(f.id), `${f.title} (另一部電影)`), null, '拒绝错误片名');
  assert.equal(parseMclMovieDetails([], String(f.id), f.title), null, '拒绝缺失资料');
}
assert.equal(parseMclMovieDetails([{ ...fixtures[0].raw[0], b: { mrt: 'TBC', mc: '8.0' } }], '14743', fixtures[0].title)?.duration, null);
assert.equal(parseMclMovieDetails([{ ...fixtures[0].raw[0], b: { mrt: 'TBC', mc: '8.0' } }], '14743', fixtures[0].title)?.category, null);

// 模拟三端点 + 缓存：证明抓取会用数字 ID 取详情，并且详情故障不丢场次。
const requests: string[] = [];
const grid = { movies: fixtures.map((f) => ({ id: String(f.id), mn: f.title })),
  ba: '', dba: '', dp: 'Images/Movies/V-', ta: '.jpg' };
const list = { movies: fixtures.map((f, i) => ({ id: f.id, vst: [{
  v: '2D', l: i ? '日語' : '英語', vn: '2D', c: [{ ci: '017', cn: 'K11', o: 1,
    s: [{ si: 9000 + i, sn: '星期六, 9月26日, 02:10 PM, 1院 $120', r: 60 }] }],
}] })) };
const tmpScraper = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-mcl-scraper-'));
try {
  const cacheFile = path.join(tmpScraper, 'mcl-details.json');
  const request = async (url: string) => {
    requests.push(url);
    if (url.startsWith('GetNowShowingGrid')) return grid;
    if (url.startsWith('GetNowShowingList')) return list;
    if (url.startsWith('GetCinemaDetails')) return [];
    const id = /&id=(\d+)&/.exec(url)?.[1];
    const fixture = fixtures.find((f) => String(f.id) === id);
    if (fixture) return fixture.raw;
    throw new Error('unexpected URL: ' + url);
  };
  const scraped = await scrapeMcl({ request, detailCacheFile: cacheFile });
  assert.equal(scraped.movies.length, 2);
  assert.equal(scraped.shows.length, 2);
  assert.equal(scraped.movies[1].detailUrl, 'https://www.mclcinema.com/MovieSet.aspx?id=14855');
  assert.equal(scraped.movies[0].slug, 'movie-mcl-14743', '补英文名不能改变既有链接');
  assert.equal(scraped.movies[1].slug, '30-the-one-mcl-14855', '保留含活动名的既有 slug');
  assert.deepEqual(scraped.movies.map((m) => m.duration), [132, 117]);
  assert.deepEqual(scraped.movies.map((m) => m.category), ['III', 'I']);
  assert.deepEqual(scraped.movies.map((m) => m.dialect), ['英語', '日語']);
  assert.ok(requests.some((url) => url.includes('&id=14855&r=beim')));
  assert.ok(!requests.some((url) => url.includes('id=mcl-')));
  assert.ok(fs.existsSync(cacheFile));
  const cached = await scrapeMcl({ request: async (url: string) => {
    if (url.startsWith('GetMovieDetails')) throw new Error('cache should be reused');
    return request(url);
  }, detailCacheFile: cacheFile });
  assert.equal(cached.movies[0].duration, 132);
  process.env.MCL_DETAILS_FORCE_REFRESH = '1';
  try {
    const failed = await scrapeMcl({ request: async (url: string) => {
      if (url.startsWith('GetMovieDetails')) throw new Error('detail endpoint unavailable');
      return request(url);
    }, detailCacheFile: cacheFile });
    assert.equal(failed.shows.length, 2);
    assert.equal(failed.movies[1].duration, 117, '详情故障回退校验过的缓存');
  } finally { delete process.env.MCL_DETAILS_FORCE_REFRESH; }
  const budgeted = await scrapeMcl({ request: async (url: string) => {
    if (url.startsWith('GetMovieDetails')) throw new Error('budget exhausted');
    return request(url);
  }, detailCacheFile: cacheFile, detailBudgetMs: 0 });
  assert.equal(budgeted.movies[0].duration, 132, '预算耗尽仍须遍历旧缓存');
  assert.equal(budgeted.movies[1].duration, 117);
  assert.equal(budgeted.shows.length, 2);
  const changedTitle = { ...grid, movies: grid.movies.map((m, i) => i ? { ...m, mn: '另一部電影' } : m) };
  const reusedId = await scrapeMcl({ request: async (url: string) => {
    if (url.startsWith('GetNowShowingGrid')) return changedTitle;
    if (url.startsWith('GetMovieDetails')) throw new Error('detail endpoint unavailable');
    return request(url);
  }, detailCacheFile: cacheFile, detailBudgetMs: 0 });
  assert.equal(reusedId.movies[1].duration, null, '数字 ID 重用、片名变化时不得套用旧资料');
  assert.equal(reusedId.shows.length, 2);
} finally { fs.rmSync(tmpScraper, { recursive: true, force: true }); }

// 静态导出读取层的真实合成路径：MCL 为唯一院线时也必须填上香港分级等组级字段。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-mcl-probe-'));
try {
  fs.writeFileSync(path.join(tmp, 'movies.json'), JSON.stringify(fixtures.map((f) => ({
    id: `mcl-${f.id}`, source: 'mcl', status: 'showing', slug: `movie-mcl-${f.id}`,
    nameZh: f.title, poster: null, ...parseMclMovieDetails(f.raw, String(f.id), f.title),
    openingDate: null, trailer: null, detailUrl: `https://www.mclcinema.com/MovieSet.aspx?id=${f.id}`,
  }))));
  for (const file of ['shows.json', 'cinemas.json']) fs.writeFileSync(path.join(tmp, file), '[]');
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({
    lastUpdated: '2026-09-26T00:00:00Z', sources: ['mcl'],
    counts: { movies: 2, showing: 2, upcoming: 0, cinemas: 0, shows: 0 },
    errors: [], durationMs: 0,
  }));
  process.env.DATA_DIR = tmp;
  const { getMovieGroups } = await import('../lib/data.ts');
  const { buildIntro } = await import('../lib/intro.ts');
  const groups = getMovieGroups();
  assert.equal(groups.length, 2, '两部不同电影不能误合并');
  for (const f of fixtures) {
    const group = groups.find((g) => g.primary.id === `mcl-${f.id}`);
    assert.ok(group);
    assert.equal(group.displayCategory, f.category);
    assert.equal(group.displayDuration, f.minutes);
    if (f.id === 14855) assert.deepEqual(group.versions[0].formats, ['30周年修復版']);
    assert.equal(group.displayNameEn, f.english);
    assert.equal(group.displayDirector, f.director);
    assert.deepEqual(group.displayGenres, ['劇情片', '愛情片']);
    assert.ok(group.displayDescription);
    const intro = buildIntro(group);
    assert.equal(intro.category, f.category);
    assert.equal(intro.duration, f.minutes);
    assert.equal(intro.subtitle, f.english);
    assert.ok(intro.summary);
    assert.ok(intro.cast.length >= 2);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('✓ MCL 详情校验、特殊放映归一、资料卡合成均通过');
