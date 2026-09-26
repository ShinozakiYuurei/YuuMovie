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

/** Preconnect only when a map is about to be used, not on every page visit. */
function warmTileConnections(): void {
  for (let host = 1; host <= 4; host++) {
    const href = `https://wprd0${host}.is.autonavi.com`;
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    document.head.appendChild(link);
  }
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
