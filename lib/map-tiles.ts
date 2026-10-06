export interface TileCoords {
  x: number;
  y: number;
  z: number;
}

export type TileDone = (error: Error | null, tile: HTMLElement) => void;

export const TILE_TIMEOUT_MS = 6000;
export const HEDGE_AFTER_MS = 2500;

const MAX_ATTEMPTS = 3;

/**
 * 瓦片节点
 *
 * ★ 为什么这里只有一个域名，而不是「两个节点轮着用」：
 *   2026-09-30 实测（大陆直连 + 香港 VPS 各一遍）：
 *     server.arcgisonline.com    → 大陆 192~577ms / VPS 200；两处都通
 *     services.arcgisonline.com  → VPS 与 server 同一 IP（23.215.188.38），
 *                                  大陆 DNS 却解析到 Facebook 段（31.13.68.169）
 *                                  → 12s 连不上
 *     cache1/cache2.arcgisonline.com → 两处都没有 DNS 记录，等于死路
 *
 *   舊寫法是兩個域名按 (x+y+attempt) 輪流取 —— 以旺角一帶的座標為例，
 *   attempt 0 直接落在 services.（死路），要等 2.5s 的對沖請求才出圖；
 *   大陸用戶首屏有一半瓦片是這樣來的。對沖的意義是「換條路再試」，
 *   把解析不到的名字也算進嘗試次數，只是白燒一次。
 *
 * ★ 重試怎麼「換路」：帶上遞增的 retry 參數。
 *   這是一次真正的新請求（URL 不同 → 繞過瀏覽器與 CDN 快取；
 *   實測 retry=1 返回 200 同一張瓦片），走哪個邊緣節點交給 CDN 自己挑 ——
 *   比在客戶端硬編一組域名可靠：至少每個請求都真的發得出去。
 */
const TILE_HOST = 'server.arcgisonline.com';

/** 同一次瓦片請求的第 n 次嘗試：第 0 次不帶參數，之後帶 retry 繞開快取 */
function attemptQuery(attempt: number): string {
  return attempt === 0 ? '' : '?retry=' + attempt;
}

/**
 * 服務路徑：街道圖與深色底圖
 *
 * ★ 為什麼深色不直接用 Esri 的 Canvas/World_Dark_Gray_Base：
 *   2026-09-30 實測，該服務在香港 z17 以上**沒有資料**，
 *   回傳的是一張 2521 bytes 的「Map data not yet available」佔位圖
 *   （旺角／中環／沙田／荃灣四個點、z17 與 z18 全數如此）。
 *   而戲院地圖預設 zoom 16、使用者會拉到 18 —— 用深色底圖會直接
 *   看到一格格灰色佔位圖，比亮色更糟。
 *   所以深色改用「街道圖 + CSS 濾鏡」，語言與街道細節都不變。
 */
export type MapTileStyle = 'street' | 'dark';

/** 兩種樣式共用同一個服務：深色是同一份街道圖加濾鏡（理由見上） */
const SERVICE_PATH = 'World_Street_Map';

export function mapTileUrl(coords: TileCoords, attempt = 0): string {
  return 'https://' + TILE_HOST + '/ArcGIS/rest/services/' + SERVICE_PATH + '/MapServer/tile/'
    + coords.z + '/' + coords.y + '/' + coords.x + attemptQuery(attempt);
}

/**
 * 深色主題的瓦片濾鏡
 *
 * ★ 為什麼是這組參數（2026-09-30 以旺角 z16 九宮格實拍比對 A/B/C/D 四組）：
 *   invert(1) hue-rotate(180deg) 是通用「亮色地圖 → 深色地圖」手法：
 *   色相反轉兩次回到原色相（米白底 → 近黑、街道線 → 亮線），
 *   再把亮度與飽和度壓一點，避免反轉後的白字刺眼、綠地變螢光。
 *   純 invert 的對照組（A）飽和度過高、水體過藍，B 這組最接近
 *   Esri 官方深色底圖的觀感，且文字（中文標註）仍清晰可讀。
 *
 * ★ 為什麼放在瓦片層而不是整個地圖容器：
 *   標記（circleMarker）與縮放控件是 SVG/HTML，跟瓦片同一個 pane 之下；
 *   濾鏡若掛在容器上會把品牌色標記一起反色（紫 → 黃綠）。
 *   掛在每張 tile 上則只有底圖被轉換，標記保持原色。
 */
export const DARK_TILE_FILTER =
  'brightness(0.42) saturate(0.58) contrast(1.08)';

export function createMapTile(coords: TileCoords, done: TileDone, style: MapTileStyle = 'street'): {
  tile: HTMLDivElement;
  cancel: () => void;
} {
  const tile = document.createElement('div');
  if (style === 'dark') tile.style.filter = DARK_TILE_FILTER;
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

  const failIfExhausted = () => {
    if (!settled && started >= MAX_ATTEMPTS && inFlight.size === 0) {
      finish(new Error('Esri map tile failed to load'));
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
    const settle = () => {
      live = false;
      if (timeout !== undefined) clearTimeout(timeout);
      if (hedge !== undefined) clearTimeout(hedge);
      image.onload = null;
      image.onerror = null;
      inFlight.delete(attempt);
    };
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
      spawn();
      failIfExhausted();
    };

    inFlight.add(attempt);
    image.src = mapTileUrl(coords, index);

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
