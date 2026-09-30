import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DARK_TILE_FILTER,
  HEDGE_AFTER_MS,
  TILE_TIMEOUT_MS,
  createMapTile,
  mapTileUrl,
} from '../lib/map-tiles.ts';

const coords = { x: 53562, y: 28599, z: 16 };
const originalDocument = globalThis.document;
afterEach(() => { globalThis.document = originalDocument; });

function fakeDocument() {
  const images = [];
  globalThis.document = {
    createElement(tag) {
      const element = {
        style: {}, children: [], onload: null, onerror: null,
        setAttribute() {},
        removeAttribute(name) { delete this[name]; },
        replaceChildren(...children) { this.children = children; },
      };
      if (tag === 'img') images.push(element);
      return element;
    },
  };
  return images;
}

const hostOf = (url) => new URL(url).hostname;
const searchOf = (url) => new URL(url).search;

/*
 * 節點選擇（2026-09-30）
 *
 * 為什麼要釘死：第一版寫成兩個域名按 (x+y+attempt) 輪流取，其中
 * services.arcgisonline.com 在大陸解析到 Facebook 段 IP、12s 連不上 ——
 * 以旺角一帶座標算，attempt 0 直接落在死路上，要等 2.5s 的對沖請求才出圖。
 * 這種錯不會報錯、頁面照樣 200，只是地圖慢或半張空白。
 */
test('Esri URLs use the WGS-84 XYZ tile path on the reachable host', () => {
  const first = mapTileUrl(coords, 0);
  const parsed = new URL(first);
  assert.equal(parsed.pathname, '/ArcGIS/rest/services/World_Street_Map/MapServer/tile/16/28599/53562');
  assert.equal(hostOf(first), 'server.arcgisonline.com');
  // 第一次嘗試不帶參數：讓 CDN 走預設節點，也讓它可被快取
  assert.equal(searchOf(first), '');
});

test('retries stay on the same reachable host and only vary the cache-busting retry param', () => {
  const urls = [mapTileUrl(coords, 0), mapTileUrl(coords, 1), mapTileUrl(coords, 2)];
  assert.deepEqual(new Set(urls.map(hostOf)), new Set(['server.arcgisonline.com']));
  assert.deepEqual(urls.map(searchOf), ['', '?retry=1', '?retry=2']);
  // 路徑必須一致，否則重試拿到的是另一張瓦片
  assert.deepEqual(new Set(urls.map((u) => new URL(u).pathname)).size, 1);
});

test('success completes exactly once and inserts the tile image', () => {
  const images = fakeDocument();
  const results = [];
  const { tile, cancel } = createMapTile(coords, (...result) => results.push(result));
  const onload = images[0].onload;
  onload(); onload();
  assert.deepEqual(results, [[null, tile]]);
  assert.deepEqual(tile.children, [images[0]]);
  assert.ok(images[0].src);
  cancel();
  assert.ok(images[0].src);
});

test('an error retries before notifying Leaflet; late events are ignored', () => {
  const images = fakeDocument();
  const results = [];
  const { cancel } = createMapTile(coords, (...result) => results.push(result));
  const oldLoad = images[0].onload;
  const firstUrl = images[0].src;
  images[0].onerror();
  assert.equal(results.length, 0);
  assert.equal(images.length, 2);
  // 重試是同域名換 URL（retry 參數），路徑必須完全相同 —— 否則拿到的是另一張瓦片
  assert.equal(hostOf(images[1].src), hostOf(firstUrl));
  assert.equal(new URL(images[1].src).pathname, new URL(firstUrl).pathname);
  assert.equal(searchOf(images[1].src), '?retry=1');
  oldLoad();
  assert.equal(results.length, 0);
  images[1].onload();
  assert.equal(results.length, 1);
  assert.equal(results[0][0], null);
  cancel();
});

test('a hanging attempt is not aborted; a parallel attempt is hedged in', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 2);
  // 對沖的第二條請求同樣只換 retry 參數（見上方節點選擇的註釋）
  assert.equal(searchOf(images[1].src), '?retry=1');
  assert.ok(images[0].src);
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
});

test('a slow-but-alive attempt still wins if it finishes first', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  const { tile, cancel } = createMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 2);
  const hedgedLoad = images[1].onload;
  images[0].onload();
  assert.deepEqual(results, [[null, tile]]);
  assert.deepEqual(tile.children, [images[0]]);
  assert.ok(images[0].src);
  hedgedLoad();
  assert.equal(results.length, 1);
  assert.deepEqual(tile.children, [images[0]]);
  cancel();
});

test('retries are bounded and only exhausted attempts report an error', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
  t.mock.timers.tick(TILE_TIMEOUT_MS - HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
  assert.equal(results.length, 0);
  t.mock.timers.tick(TILE_TIMEOUT_MS);
  assert.equal(images.length, 3);
  assert.equal(results.length, 1);
  assert.ok(results[0][0] instanceof Error);
});

test('unloading cancels pending work and does not notify Leaflet', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  const { cancel } = createMapTile(coords, (...result) => results.push(result));
  const oldLoad = images[0].onload;
  cancel(); oldLoad();
  t.mock.timers.tick(TILE_TIMEOUT_MS * 4);
  assert.equal(images.length, 1);
  assert.deepEqual(results, []);
});

/*
 * 深色主題（2026-09-30 用戶要求）
 *
 * 為什麼要釘死：
 *   深色不是換一個 Esri 服務（那個服務在香港 z17 以上只有
 *   「Map data not yet available」佔位圖，見 lib/map-tiles.ts），
 *   而是同一張街道圖加 CSS 濾鏡。濾鏡若哪天被漏掉或寫錯，
 *   深色頁面上會彈出一塊亮白地圖 —— 頁面照樣 200，只有肉眼看得出。
 *
 *   ★ 還有一條容易踩的：濾鏡必須掛在**每張瓦片**上，不能掛在容器上。
 *     掛容器會連 SVG 標記一起反色（品牌紫 → 黃綠）。這裡斷言的是
 *     瓦片 div 的 style.filter，等於把「只作用於底圖」這件事釘住。
 */
test('dark tiles carry the invert filter; street tiles stay untouched', () => {
  fakeDocument();
  const street = createMapTile(coords, () => {}, 'street');
  assert.equal(street.tile.style.filter, undefined);
  street.cancel();

  const dark = createMapTile(coords, () => {}, 'dark');
  assert.equal(dark.tile.style.filter, DARK_TILE_FILTER);
  dark.cancel();
});

test('dark tiles still request the same tile and keep the retry behaviour', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createMapTile(coords, (...result) => results.push(result), 'dark');
  // 深色不換服務：拿到的仍是 World_Street_Map 的那張瓦片
  assert.match(images[0].src, /World_Street_Map\/MapServer\/tile\/16\/28599\/53562$/);
  images[0].onerror();
  assert.equal(images.length, 2);
  assert.equal(searchOf(images[1].src), '?retry=1');
  images[1].onload();
  assert.equal(results.length, 1);
});
