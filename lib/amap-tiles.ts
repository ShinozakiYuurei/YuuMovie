/** High-level tile loading stays in Leaflet; this handles one tile's network lifecycle. */
export interface TileCoords {
  x: number;
  y: number;
  z: number;
}

export type TileDone = (error: Error | null, tile: HTMLElement) => void;

/**
 * 單次嘗試的等待上限；到點只廢掉**這一條**，不影響別的。
 *
 * 為什麼不是「3 秒逾時 → 砍掉 → 換節點重試」（2026-09-26 實測的舊行為）：
 *
 *   大陸到 wprd0X 的冷連接實測 0.16–4.06s（同一組瓦片、curl 直連）。
 *   逾時就 `removeAttribute('src')` 會把**已經下載到一半**的請求 abort 掉，
 *   換節點又要重做一次 TLS 握手 —— 等於親手扔掉最接近成功的那一次。
 *
 *   線上實測（hkmovie.yuurei.de/cinema，首屏 8 張瓦片，2026-09-26）：
 *   最慢的一張前兩次都在 3 秒被 abort，第三次卻 **36ms** 就回來。
 *   用戶看到的結果是兩塊灰底空白 + 「部分地圖未載入」。
 *
 * 所以改成**並行對沖**：先發一條，還沒結果就再發一條到別的節點，
 * 舊的留著繼續跑，誰先 load 誰算數，其餘作廢。慢但活著的請求永遠不會被砍。
 */
export const TILE_TIMEOUT_MS = 6000;

/** 一條嘗試跑了這麼久還沒結果，就並行再開一條（不砍舊的）。 */
export const HEDGE_AFTER_MS = 2500;

const MAX_ATTEMPTS = 3;

/** Distribute initial requests, then hedge on a different AMap node (same map/style). */
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
  let settled = false;
  let started = 0;
  const inFlight = new Set<{ abort: () => void }>();

  const finish = (error: Error | null, image?: HTMLImageElement) => {
    if (settled) return;
    settled = true;
    for (const attempt of [...inFlight]) attempt.abort();
    inFlight.clear();
    if (image) tile.replaceChildren(image);
    done(error, tile);
  };

  // 只有「嘗試次數用盡」且「沒有任一條還在跑」才算真失敗。
  const failIfExhausted = () => {
    if (!settled && started >= MAX_ATTEMPTS && inFlight.size === 0) {
      finish(new Error('高德圖磚載入失敗'));
    }
  };

  const spawn = () => {
    if (settled || started >= MAX_ATTEMPTS) return;
    const index = started++;
    const image = document.createElement('img');
    image.alt = '';
    image.setAttribute('role', 'presentation');
    image.draggable = false;
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.maxWidth = 'none';

    let live = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    /** 不再需要這條了，但**保留已經下載好的圖**。 */
    const settle = () => {
      live = false;
      if (timeout !== undefined) clearTimeout(timeout);
      if (hedge !== undefined) clearTimeout(hedge);
      image.onload = null;
      image.onerror = null;
      inFlight.delete(attempt);
    };
    /** 作廢：連 in-flight 的請求一起砍掉。
     *  ★ 不能拿它當成功路徑 —— `removeAttribute('src')` 會把已載入的點陣圖
     *    一起清掉（實測 naturalWidth 變回 0），瓦片就變成一片空白。
     *    2026-09-26 本地延遲實驗踩到過。 */
    const abort = () => {
      settle();
      image.removeAttribute('src');
    };
    const attempt = { abort };

    timeout = setTimeout(() => {
      if (!live) return;
      abort();
      spawn();
      failIfExhausted();
    }, TILE_TIMEOUT_MS);

    image.onload = () => {
      if (!live || settled) return;
      settle();
      finish(null, image);
    };
    image.onerror = () => {
      if (!live || settled) return;
      abort();
      // 明確失敗就立刻換節點，不必等對沖間隔。
      spawn();
      failIfExhausted();
    };

    inFlight.add(attempt);
    image.src = amapTileUrl(coords, index);

    // 還在跑就先擱著：到點再開一條並行，舊的繼續下載。
    hedge = setTimeout(() => {
      if (live) spawn();
    }, HEDGE_AFTER_MS);
  };

  spawn();

  return {
    tile,
    cancel: () => {
      settled = true;
      for (const attempt of [...inFlight]) attempt.abort();
      inFlight.clear();
    },
  };
}
