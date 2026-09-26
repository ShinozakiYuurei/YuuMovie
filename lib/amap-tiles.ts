/** High-level tile loading stays in Leaflet; this handles one tile's network lifecycle. */
export interface TileCoords {
  x: number;
  y: number;
  z: number;
}

export type TileDone = (error: Error | null, tile: HTMLElement) => void;

export const TILE_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 3;

/** Distribute initial requests, then retry on a different AMap node (same map/style). */
export function amapTileUrl(coords: TileCoords, attempt = 0): string {
  const host = (Math.abs(coords.x + coords.y) + attempt) % 4 + 1;
  return `https://wprd0${host}.is.autonavi.com/appmaptile?x=${coords.x}&y=${coords.y}&z=${coords.z}&lang=zh_cn&size=1&scl=1&style=7`;
}

/**
 * Only the final result reaches Leaflet's done callback. Intermediate errors must not
 * mark a tile as finished, and unloaded tiles must never complete a newer request.
 * Use GridLayer + a stable div so each attempt can have its own image and handlers.
 */
export function createAMapTile(coords: TileCoords, done: TileDone): {
  tile: HTMLDivElement;
  cancel: () => void;
} {
  const tile = document.createElement('div');
  let attempt = 0;
  let settled = false;
  let stopAttempt = () => {};

  const start = () => {
    const image = document.createElement('img');
    image.alt = '';
    image.setAttribute('role', 'presentation');
    image.draggable = false;
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.maxWidth = 'none';
    let active = true;

    const timer = setTimeout(() => failed(), TILE_TIMEOUT_MS);
    const cleanup = () => {
      active = false;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };
    stopAttempt = () => {
      cleanup();
      image.removeAttribute('src');
    };

    const failed = () => {
      if (!active || settled) return;
      stopAttempt();
      attempt += 1;
      if (attempt < MAX_ATTEMPTS) {
        start();
      } else {
        settled = true;
        done(new Error('高德圖磚載入失敗'), tile);
      }
    };

    image.onload = () => {
      if (!active || settled) return;
      cleanup();
      settled = true;
      tile.replaceChildren(image);
      done(null, tile);
    };
    image.onerror = failed;
    image.src = amapTileUrl(coords, attempt);
  };

  start();
  return {
    tile,
    cancel: () => {
      settled = true;
      stopAttempt();
    },
  };
}
