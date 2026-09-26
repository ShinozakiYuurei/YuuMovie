import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HEDGE_AFTER_MS, TILE_TIMEOUT_MS, amapTileUrl, createAMapTile } from '../lib/amap-tiles.ts';

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

test('initial requests use all four AMap nodes and keep the blue-water style', () => {
  const urls = [0, 1, 2, 3].map((dx) => amapTileUrl({ ...coords, x: coords.x + dx }));
  assert.equal(new Set(urls.map(hostOf)).size, 4);
  for (const url of urls) assert.equal(new URL(url).searchParams.get('style'), '7');
});

test('success completes exactly once and inserts the tile image', () => {
  const images = fakeDocument();
  const results = [];
  const { tile, cancel } = createAMapTile(coords, (...result) => results.push(result));
  const onload = images[0].onload;
  onload(); onload();
  assert.deepEqual(results, [[null, tile]]);
  assert.deepEqual(tile.children, [images[0]]);
  // ★ 回歸：成功的那張不能被 removeAttribute('src') —— 那會連點陣圖一起清掉
  //   （實測 naturalWidth 變回 0），瓦片就變成一片空白。
  assert.ok(images[0].src);
  cancel();
  assert.ok(images[0].src);
});

test('an error retries another node before notifying Leaflet; late events are ignored', () => {
  const images = fakeDocument();
  const results = [];
  const { cancel } = createAMapTile(coords, (...result) => results.push(result));
  const oldLoad = images[0].onload;
  const firstUrl = images[0].src;
  images[0].onerror();
  assert.equal(results.length, 0);
  assert.equal(images.length, 2);
  assert.notEqual(hostOf(firstUrl), hostOf(images[1].src));
  oldLoad();
  assert.equal(results.length, 0);
  images[1].onload();
  assert.equal(results.length, 1);
  assert.equal(results[0][0], null);
  cancel();
});

// 這條釘住 2026-09-26 的線上事故：舊行為是「3 秒逾時 → removeAttribute('src')」，
// 把已經下載到一半的請求 abort 掉再換節點，於是慢節點永遠贏不了。
// 新行為必須是「舊的留著跑，並行再開一條」。
test('a hanging attempt is not aborted; a parallel attempt is hedged in', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createAMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 2);
  assert.notEqual(hostOf(images[0].src), hostOf(images[1].src));
  // 第一條的 src 還在（沒被砍掉），這正是與舊行為的分界
  assert.ok(images[0].src);
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
});

test('a slow-but-alive attempt still wins if it finishes first', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  const { tile, cancel } = createAMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 2);
  const hedgedLoad = images[1].onload;
  images[0].onload();
  assert.deepEqual(results, [[null, tile]]);
  assert.deepEqual(tile.children, [images[0]]);
  assert.ok(images[0].src);
  // 對沖那條晚到也不能再改結果
  hedgedLoad();
  assert.equal(results.length, 1);
  assert.deepEqual(tile.children, [images[0]]);
  cancel();
});

test('retries are bounded and only exhausted attempts report an error', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createAMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(HEDGE_AFTER_MS);
  t.mock.timers.tick(HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
  // 第一條逾時了、另外兩條還在跑 → 不能報錯
  t.mock.timers.tick(TILE_TIMEOUT_MS - HEDGE_AFTER_MS);
  assert.equal(images.length, 3);
  assert.equal(results.length, 0);
  // 全部逾時後才報一次錯，且不再新增嘗試
  t.mock.timers.tick(TILE_TIMEOUT_MS);
  assert.equal(images.length, 3);
  assert.equal(results.length, 1);
  assert.ok(results[0][0] instanceof Error);
});

test('unloading cancels pending work and does not notify Leaflet', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  const { cancel } = createAMapTile(coords, (...result) => results.push(result));
  const oldLoad = images[0].onload;
  cancel(); oldLoad();
  t.mock.timers.tick(TILE_TIMEOUT_MS * 4);
  assert.equal(images.length, 1);
  assert.deepEqual(results, []);
});
