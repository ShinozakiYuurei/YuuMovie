'use client';

import { useEffect, useRef, useState } from 'react';
import { CINEMA_COORD, osmUrl } from '@/lib/cinema-geo';

/**
 * 戲院地圖彈層（OpenStreetMap 資料）
 *
 * ===== 為什麼不用 Google Maps =====
 *
 * 用戶 2026-09-21 指定：改用開源地圖，且**大陸可直接訪問**。
 * 實測（大陸直連，非香港代理）：
 *   maps.google.com / maps.app.goo.gl  → 不可達
 *   www.openstreetmap.org（OSM 主站）   → 8s 逾時
 *   tile.openstreetmap.org（OSM 官方瓦片）→ 8s 逾時
 *   basemaps.cartocdn.com（OSM 資料）   → **0.21s** ✅
 *   tile.openstreetmap.de（德國官方鏡像）→ 1.2s  ✅
 *
 * 所以：**資料用 OSM，瓦片走 Carto**（它渲染的就是 OSM 資料，
 * 署名也照 OSM 的 ODbL 要求寫在右下角）。Carto 還有暗色主題，
 * 正好與本站的 #0A0A0C 暗色體系一致 —— 不會在暗色頁面裡閃出一塊亮白地圖。
 *
 * ===== 為什麼 Leaflet 走國內 CDN 而不是打包進 bundle =====
 *
 * 用戶問過「為什麼不依賴 CDN，走 VPS 的頻寬嗎？」—— 實測後結論是**該用 CDN**：
 *
 *   本站同源 JS（Cloudflare → 西雅圖 SEA，10/10 次都是 SEA）
 *     冷連接 2360ms / 熱連接 775ms，TLS 握手就要 330ms
 *   lib.baomitu.com（中國 CDN）  平均 204ms，TLS 僅 80ms
 *   cdn.staticfile.org           平均 187ms，TLS 僅 65ms
 *
 * 把 41.7KB(gzip) 的 Leaflet 塞進同源 bundle，等於讓它陪著一起走
 * 西雅圖那條 0.8–2.4 秒的鏈路；走國內 CDN 反而快 4 倍。
 *
 * 安全：兩個鏡像的 leaflet.js / leaflet.css 都與 npm 包 **sha256 完全一致**
 * （實測比對通過），故可放心用。
 *
 * ===== 為什麼用動態 <script> 而不是 import =====
 *
 * 地圖是次要功能（用戶多數只想知道地址），不該讓全部訪客都下載 Leaflet。
 * 用動態注入 → 只有真的點開地圖的人付這 41.7KB。
 * 也因此不裝 leaflet 的 npm 型別（只在需要時載入全域 L）。
 */

const CDNS = [
  // 依序嘗試：staticfile 實測最快（187ms），baomitu 次之（204ms）
  'https://cdn.staticfile.org/leaflet/1.9.4/',
  'https://lib.baomitu.com/leaflet/1.9.4/',
  // 兜底：jsdelivr（864ms，但全球可用性最好）
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/',
];

/** 瓦片源：Carto 暗色（OSM 資料）→ 德國 OSM 官方鏡像兜底 */
const TILE_SOURCES = [
  {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者 &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者',
  },
];

/** 已載入的 Promise 快取（多個地圖彈層共用，不重複注入） */
let leafletPromise: Promise<void> | null = null;

/** 依序嘗試各 CDN，全部失敗才 reject */
function loadLeaflet(): Promise<void> {
  if (leafletPromise) return leafletPromise;

  leafletPromise = (async () => {
    const w = window as unknown as { L?: unknown };
    if (w.L) return; // 已經有了（例如使用者開過兩個地圖）

    for (const base of CDNS) {
      try {
        await injectCss(`${base}leaflet.css`);
        await injectScript(`${base}leaflet.js`);
        if ((window as unknown as { L?: unknown }).L) return;
      } catch {
        /* 換下一個 CDN */
      }
    }
    throw new Error('Leaflet 載入失敗（所有 CDN 均不可用）');
  })();

  // 失敗後清掉快取，讓使用者再點一次能重試（例如網路剛好斷了）
  leafletPromise.catch(() => {
    leafletPromise = null;
  });

  return leafletPromise;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`script 載入失敗: ${src}`));
    document.head.appendChild(el);
  });
}

function injectCss(href: string): Promise<void> {
  return new Promise((resolve) => {
    // CSS 失敗不阻塞地圖（只是樣式醜一點），故不 reject
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    el.onload = () => resolve();
    el.onerror = () => resolve();
    document.head.appendChild(el);
  });
}

/** Leaflet 的最小型別（只用到這幾個成員，不為它裝 300KB 的 @types） */
interface LeafletMap {
  remove(): void;
  invalidateSize(): void;
  setView(center: [number, number], zoom: number): void;
}
interface LeafletNS {
  map(el: HTMLElement, opts?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, opts?: Record<string, unknown>): { addTo(m: LeafletMap): void };
  circleMarker(center: [number, number], opts?: Record<string, unknown>): { addTo(m: LeafletMap): void };
  control: { attribution(opts: Record<string, unknown>): { addTo(m: LeafletMap): void } };
}

export function CinemaMapDialog({
  cinemaId,
  name,
  address,
  onClose,
}: {
  cinemaId: string;
  name: string;
  address: string;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  const coord = CINEMA_COORD[cinemaId] ?? null;

  // Esc 關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 開啟期間鎖住頁面滾動（避免背景跟著滑）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!coord) {
      setState('error');
      setErrMsg('這間戲院暫無座標資料');
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        await loadLeaflet();
        if (cancelled || !boxRef.current) return;

        const L = (window as unknown as { L: LeafletNS }).L;
        const [lat, lon] = coord;

        const map = L.map(boxRef.current, {
          center: [lat, lon],
          zoom: 16,
          zoomControl: true,
          // 手機上雙指縮放才不會被頁面滾動搶走
          tap: true,
        });
        mapRef.current = map;

        // 瓦片：Carto 暗色（OSM 資料）。若該源不可用，使用者仍可用
        // 底部「在 OSM 開啟」外鏈 —— 不做自動切換，因為切換會丟掉
        // 已載入的瓦片快取，反而更慢。
        L.tileLayer(TILE_SOURCES[0].url, {
          subdomains: TILE_SOURCES[0].subdomains,
          maxZoom: 19,
          attribution: TILE_SOURCES[0].attribution,
        }).addTo(map);

        // 標記：用圓點而非預設大頭針 —— Leaflet 預設圖示是外部 PNG，
        // 在暗色地圖上偏亮且要多一次請求；圓點是純 SVG，且用主題色。
        L.circleMarker([lat, lon], {
          radius: 8,
          color: '#a78bfa',
          weight: 3,
          fillColor: '#8b7cff',
          fillOpacity: 0.9,
        }).addTo(map);

        // 容器在彈層動畫中尺寸可能未定，強制量一次
        requestAnimationFrame(() => map.invalidateSize());
        setTimeout(() => map.invalidateSize(), 220);

        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled) {
          setState('error');
          setErrMsg(e instanceof Error ? e.message : '地圖載入失敗');
        }
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [coord]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 地圖`}
      onClick={onClose}
    >
      <div
        className="hkm-panel flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標題列 */}
        <div className="flex items-start gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-fg">{name}</h3>
            <p className="mt-0.5 truncate text-xs text-fg-muted">{address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="shrink-0 rounded-full border border-hairline-strong px-2.5 py-1 text-xs text-fg-soft transition hover:border-accent/50 hover:text-fg"
          >
            關閉
          </button>
        </div>

        {/* 地圖本體 */}
        <div className="relative flex-1 bg-canvas" style={{ minHeight: 'min(60vh, 460px)' }}>
          <div ref={boxRef} className="h-full w-full" />

          {state === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">
              地圖載入中…
            </div>
          )}
          {state === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-fg-soft">{errMsg}</p>
              <p className="text-xs text-fg-dim">
                可改用下方「在 OSM 開啟」直接前往地圖網站。
              </p>
            </div>
          )}
        </div>

        {/* 底部：外鏈 + 署名說明 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-4 py-2.5">
          {coord && (
            <a
              href={osmUrl(coord[0], coord[1])}
              target="_blank"
              rel="noopener noreferrer"
              className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
            >
              在 OSM 開啟 ↗
            </a>
          )}
          <span className="text-[11px] leading-relaxed text-fg-dim">
            地圖資料 © OpenStreetMap 貢獻者（ODbL），瓦片由 CARTO 提供。
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 地圖資料 © OpenStreetMap 貢獻者（ODbL），瓦片由 CARTO 提供。
 *
 * 備用瓦片源：tile.openstreetmap.de（德國 OSM 官方鏡像，大陸 1.2s 可達）。
 * 目前不用它作首選，是因為 Carto 實測快 6 倍（0.21s）且為暗色主題；
 * 但若日後 Carto 在大陸失效，把上面 TILE_SOURCES[0] 換成它就即可。
 */
