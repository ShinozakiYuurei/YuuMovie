#!/usr/bin/env node
/**
 * 组级评分回退守卫（部署自检会跑）
 *
 * 为什么要钉死：详情页评分错了不报错 —— 页面照样 200，
 * 只是评分卡凭空消失。2026-10-04《復仇者聯盟4：終局之戰 加碼重映》实测：
 * 组里 4DX / CGS Infinity Vision 冠名条目的 enrich 记录是 notFound，
 * findEnrich 首中即返，整组评分就被这条空记录挡没了。
 *
 * 两层守卫：
 *   1. 纯函数单元例：notFound 条目在前、有分条目在后，必须回退取分；
 *      全组都没分时仍返回首条记录（页面照常显示暂无评分）。
 *   2. 真数据全站扫描：任何组「展示的 enrich 无分、但组内某条目有分」即失败；
 *      或「展示条目没有 ID、组内却有带 ID 的记录」（详情链接会退化成搜索）。
 *      扫描端按 load() 同款规则并入人工覆盖，保证与页面取数一致。
 *
 * 跑法：node_modules/.bin/tsx probe/check-rating-fallback.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { enrichKey } from '../lib/enrich-key.js';
import { enrichHasRating, findEnrich, getMovieById, getMovieGroups } from '../lib/data.ts';
import type { EnrichEntry, Movie } from '../lib/types.ts';

// ---------- 1. findEnrich 回退规则单元例 ----------
function fakeMovie(nameZh: string, nameEn: string): Movie {
  return {
    id: nameZh,
    slug: nameZh,
    nameZh,
    nameEn,
    openingDate: '2026-09-24',
    duration: null,
    category: null,
    dialect: null,
    subtitle: null,
    genres: [],
    director: null,
    cast: null,
    description: '',
    poster: null,
    trailer: null,
    detailUrl: '',
    status: 'showing',
    source: 'broadway',
  } as Movie;
}

const notFoundImdb: NonNullable<EnrichEntry['imdb']> = { notFound: true };
const notFoundDouban: NonNullable<EnrichEntry['douban']> = {
  notFound: true,
  at: '2026-09-19T00:00:00.000Z',
};
const ratedImdb: NonNullable<EnrichEntry['imdb']> = {
  imdbId: 'tt4154796',
  imdbUrl: 'https://www.imdb.com/title/tt4154796/',
  imdbTitle: 'Avengers: Endgame',
  imdbYear: 2019,
  rating: 8.4,
  votes: 1400000,
  queriedWith: 'probe',
};
const ratedDouban: NonNullable<EnrichEntry['douban']> = {
  doubanId: '26100958',
  doubanUrl: 'https://movie.douban.com/subject/26100958/',
  doubanTitle: 'probe',
  doubanYear: 2019,
  rating: 8.5,
  ratingState: 'rated',
};

const orphanKey = enrichKey('4DX Avengers: Endgame Encore Infinity Vision');
const ratedKey = enrichKey('Avengers: Endgame Encore');
const pool: Record<string, EnrichEntry> = {
  [orphanKey]: { key: orphanKey, imdb: notFoundImdb, douban: notFoundDouban },
  [ratedKey]: { key: ratedKey, imdb: ratedImdb, douban: ratedDouban },
};

const picked = findEnrich(
  [
    fakeMovie('4DX 復仇者聯盟4：終局之戰 加碼重映 Infinity Vision', '4DX Avengers: Endgame Encore Infinity Vision'),
    fakeMovie('復仇者聯盟4：終局之戰 加碼重映', 'Avengers: Endgame Encore'),
  ],
  pool,
);
assert.ok(picked && enrichHasRating(picked), 'notFound 冠名条目在前时必须回退到有分的条目');
assert.equal(picked?.imdb?.rating, 8.4);

const ratedFirst = findEnrich(
  [
    fakeMovie('復仇者聯盟4：終局之戰 加碼重映', 'Avengers: Endgame Encore'),
    fakeMovie('4DX 復仇者聯盟4：終局之戰 加碼重映 Infinity Vision', '4DX Avengers: Endgame Encore Infinity Vision'),
  ],
  pool,
);
assert.ok(ratedFirst && enrichHasRating(ratedFirst), '有分条目在前时直接取用');

const nonePool: Record<string, EnrichEntry> = {
  [orphanKey]: { key: orphanKey, imdb: notFoundImdb },
};
const pickedNone = findEnrich(
  [fakeMovie('4DX 復仇者聯盟4：終局之戰 加碼重映 Infinity Vision', '4DX Avengers: Endgame Encore Infinity Vision')],
  nonePool,
);
assert.ok(pickedNone && !enrichHasRating(pickedNone), '全组没分时保留首条记录，不返 null');
console.log('✓ findEnrich 回退规则单元例通过');

// ---------- 1b. 没分但有 ID 的记录优先于纯 notFound（2026-10-08） ----------
const missKey = enrichKey('Avengers: Doomsday Special Screening');
const idOnlyKey = enrichKey('Avengers: Doomsday');
const idOnlyPool: Record<string, EnrichEntry> = {
  [missKey]: { key: missKey, imdb: notFoundImdb, douban: notFoundDouban },
  [idOnlyKey]: {
    key: idOnlyKey,
    imdb: { imdbId: 'tt21357150', imdbUrl: 'https://www.imdb.com/title/tt21357150/', rating: null },
    douban: { doubanId: '36011202', doubanUrl: 'https://movie.douban.com/subject/36011202/', rating: null },
  },
};
const pickedIdOnly = findEnrich(
  [
    fakeMovie('復仇者聯盟5：末日降臨開畫日特典首場', 'Avengers: Doomsday Special Screening'),
    fakeMovie('復仇者聯盟5：末日降臨', 'Avengers: Doomsday'),
  ],
  idOnlyPool,
);
assert.equal(
  pickedIdOnly?.imdb?.imdbId,
  'tt21357150',
  'notFound 记录在前时，必须优先取带 ID 的记录（详情链接不能退化成搜索）',
);
console.log('✓ findEnrich 带 ID 回退单元例通过');

// ---------- 2. 真数据全站扫描 ----------
const dataBase = process.env.DATA_DIR || 'data';
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const enrichRaw = readJson<{ entries?: Record<string, EnrichEntry> }>(`${dataBase}/enrich.json`, {});
const enrich: Record<string, EnrichEntry> = { ...(enrichRaw.entries ?? {}) };
const manual = readJson<Record<string, NonNullable<EnrichEntry['manual']>>>(`${dataBase}/enrich-manual.json`, {});
for (const [k, v] of Object.entries(manual)) {
  if (!v) continue;
  const row = enrich[k] || (enrich[k] = { key: k });
  row.manual = { ...row.manual, ...v };
}
for (const row of Object.values(enrich)) {
  const mm = row?.manual;
  if (!mm) continue;
  if (mm.rating != null && row.imdb?.rating == null) {
    row.imdb = { ...(row.imdb || {}), imdbId: mm.imdbId || null, rating: mm.rating, votes: mm.votes ?? null };
  }
}

let checked = 0;
let recovered = 0;
let broken = 0;
for (const g of getMovieGroups()) {
  checked++;
  const members = new Map<string, Movie>();
  for (const v of g.versions) {
    for (const id of v.movieIds) {
      const m = getMovieById(id);
      if (m) members.set(id, m);
    }
  }
  const hits: EnrichEntry[] = [];
  for (const m of members.values()) {
    for (const n of [m.nameZh, m.nameEn]) {
      if (!n) continue;
      const hit = enrich[enrichKey(n)];
      if (hit && !hits.includes(hit)) hits.push(hit);
    }
  }
  const anyRated = hits.some((h) => enrichHasRating(h));
  const shown = findEnrich([...members.values()], enrich);
  if (shown && !enrichHasRating(shown) && anyRated) {
    broken++;
    console.log(`  ✗ ${g.displayName}：组内 ${hits.filter((h) => enrichHasRating(h)).length} 条有分，展示条目却无分`);
    continue;
  }
  const shownHasId = Boolean(shown?.imdb?.imdbId || shown?.douban?.doubanId);
  const anyHasId = hits.some((h) => Boolean(h.imdb?.imdbId || h.douban?.doubanId));
  if (shown && !shownHasId && anyHasId) {
    broken++;
    console.log('  ✗ ' + g.displayName + '：组内有条目带 ID，展示条目却没有（详情链接会退化成搜索）');
    continue;
  }
  const firstHit = hits[0] ?? null;
  if (firstHit && !enrichHasRating(firstHit) && shown && enrichHasRating(shown)) recovered++;
}
console.log(`组级评分回退：检查 ${checked} 组 ｜ 回退修好 ${recovered} 组 ｜ 仍异常 ${broken} 组`);
if (broken) process.exit(1);
console.log('✓ 全站无「组内有分但展示无分」的组');
