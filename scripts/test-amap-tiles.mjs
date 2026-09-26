import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { amapTileUrl, createAMapTile, TILE_TIMEOUT_MS } from '../lib/amap-tiles.ts';

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

test('initial requests use all four AMap nodes and keep the blue-water style', () => {
  const urls = [0, 1, 2, 3].map((dx) => amapTileUrl({ ...coords, x: coords.x + dx }));
  assert.equal(new Set(urls.map((url) => new URL(url).hostname)).size, 4);
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
  cancel();
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
  assert.notEqual(new URL(firstUrl).hostname, new URL(images[1].src).hostname);
  oldLoad();
  assert.equal(results.length, 0);
  images[1].onload();
  assert.equal(results.length, 1);
  assert.equal(results[0][0], null);
  cancel();
});

test('a hanging request times out and retries; retries are bounded', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = fakeDocument();
  const results = [];
  createAMapTile(coords, (...result) => results.push(result));
  t.mock.timers.tick(TILE_TIMEOUT_MS);
  assert.equal(images.length, 2);
  t.mock.timers.tick(TILE_TIMEOUT_MS);
  assert.equal(images.length, 3);
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
