const CDNS = [
  'https://cdn.staticfile.org/leaflet/1.9.4/',
  'https://lib.baomitu.com/leaflet/1.9.4/',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/',
];
const ASSET_TIMEOUT_MS = 3000;
let leafletPromise: Promise<void> | null = null;

function loadAsset(url: string, kind: 'css' | 'js'): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = kind === 'css'
      ? document.createElement('link')
      : document.createElement('script');
    const timer = setTimeout(() => finish(new Error(`Leaflet ${kind} 載入逾時`)), ASSET_TIMEOUT_MS);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      element.onload = null;
      element.onerror = null;
      if (error) {
        element.remove();
        reject(error);
      } else {
        resolve();
      }
    };
    element.onload = () => finish();
    element.onerror = () => finish(new Error(`Leaflet ${kind} 載入失敗`));
    if (element instanceof HTMLLinkElement) {
      element.rel = 'stylesheet';
      element.href = url;
    } else {
      element.async = true;
      element.src = url;
    }
    document.head.appendChild(element);
  });
}

/**
 * 瓦片來源的預連線：只在即將打開地圖時做，不是每次造訪都做。
 *
 * ★ 2026-09-30 由高德四個子域（wprd01~04.is.autonavi.com）改為 Esri。
 *   底圖已切到 Esri World Street Map（繁體標註，見 lib/map-tiles.ts），
 *   還去預連高德的域名等於白開四條連線 —— 既沒用到，又佔用行動網路的
 *   並發名額（瀏覽器對同一來源的連線數有限，開著的地圖反而排隊）。
 *
 * ★ 為什麼只留一個：Esri 側只有一個對外域名（見 map-tiles.ts 的實測）。
 *   預連線的價值在「提前完成 DNS + TLS 握手」，多寫幾個用不到的域名
 *   只會把首屏瓦片的握手往後擠。
 */
function warmTileConnections(): void {
  const href = 'https://server.arcgisonline.com';
  if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = href;
  document.head.appendChild(link);
}

export function loadLeaflet(): Promise<void> {
  warmTileConnections();
  if (leafletPromise) return leafletPromise;
  leafletPromise = (async () => {
    for (const base of CDNS) {
      // Start CSS and JS together; a stalled mirror must not block the next one forever.
      // If JS succeeded but CSS failed, keep L and retry just the stylesheet.
      const assets = await Promise.allSettled([
        loadAsset(`${base}leaflet.css`, 'css'),
        (window as unknown as { L?: unknown }).L
          ? Promise.resolve()
          : loadAsset(`${base}leaflet.js`, 'js'),
      ]);
      if (assets.every((result) => result.status === 'fulfilled')
        && (window as unknown as { L?: unknown }).L) return;
    }
    throw new Error('Leaflet 載入失敗，請重試或使用下方地圖連結');
  })();
  leafletPromise.catch(() => { leafletPromise = null; });
  return leafletPromise;
}

export function preloadLeaflet(): void {
  void loadLeaflet().catch(() => {});
}
