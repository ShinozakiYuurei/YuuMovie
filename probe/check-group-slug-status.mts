import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkmovie-group-status-'));
const movies = [
  {
    id: 'broadway-1274', slug: 'avengers-doomsday-1274',
    nameZh: '復仇者聯盟5：末日降臨', nameEn: 'Avengers: Doomsday',
    openingDate: '2026-12-16', duration: null, category: null, dialect: null, subtitle: null,
    genres: [], director: null, cast: null, description: '', poster: null, trailer: null,
    detailUrl: 'https://cinema.com.hk/1274', status: 'upcoming', source: 'broadway',
  },
  {
    id: 'broadway-1321', slug: '4dx-avengers-doomsday-1321',
    nameZh: '4DX復仇者聯盟5：末日降臨 Infinity Vision', nameEn: '4DX Avengers: Doomsday Infinity Vision',
    openingDate: '2026-12-16', duration: null, category: null, dialect: null, subtitle: null,
    genres: [], director: null, cast: null, description: '', poster: null, trailer: null,
    detailUrl: 'https://cinema.com.hk/1321', status: 'showing', source: 'broadway',
  },
  {
    id: 'broadway-1322', slug: 'cgs-avengers-doomsday-1322',
    nameZh: 'CGS復仇者聯盟5：末日降臨 Infinity Vision', nameEn: 'CGS Avengers: Doomsday Infinity Vision',
    openingDate: '2026-12-16', duration: null, category: null, dialect: null, subtitle: null,
    genres: [], director: null, cast: null, description: '', poster: null, trailer: null,
    detailUrl: 'https://cinema.com.hk/1322', status: 'upcoming', source: 'broadway',
  },
];

try {
  fs.writeFileSync(path.join(dir, 'movies.json'), JSON.stringify(movies));
  fs.writeFileSync(path.join(dir, 'shows.json'), '[]');
  fs.writeFileSync(path.join(dir, 'cinemas.json'), '[]');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    lastUpdated: '2026-09-23T00:00:00Z', sources: ['broadway'],
    counts: { movies: movies.length, showing: 1, upcoming: 2, cinemas: 0, shows: 0 },
    errors: [], durationMs: 0,
  }));
  process.env.DATA_DIR = dir;
  process.env.DATA_CACHE_TTL_MS = '0';
  const { getGroupBySlug, getMovieGroups } = await import('../lib/data.ts');
  const canonical = getMovieGroups().find((g) => g.slug === 'avengers-doomsday-1274');
  const showingSubset = getMovieGroups('showing').find((g) => g.slug === 'avengers-doomsday-1274');
  assert.equal(canonical?.status, 'showing', 'any showing version makes the whole movie showing');
  assert.equal(showingSubset?.status, 'showing');
  assert.equal(getMovieGroups('upcoming').some((g) => g.versions.some((v) => v.movieIds.includes('broadway-1274'))), false,
    'upcoming-only subset must not duplicate a movie that has a showing version');
  assert.equal(getGroupBySlug('avengers-doomsday-1274')?.status, 'showing', 'detail status matches the movie group');
  console.log('✓ movie with showing and upcoming versions appears only in showing');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
