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

/**
 * 瓦片源：德國 OSM 官方鏡像
 *
 * ===== 為什麽不是 CARTO（曾經用過，已棄）=====
 *
 * CARTO 的暗色瓦片原本是最優選：實測 0.21s（全場最快）且配色與本站一致。
 * 但 2026-09-21 實測發現**它已經要求 API key** —— 瓦片能下載（HTTP 200），
 * 圖上却印著滿屏「API KEY REQUIRED / carto.com/basemaps/apikey」水印，
 * 用戶看到的是一張被水印蓋住的地圖。這類「200 但內容不對」的失敗最陰險，
 * 不會報錯，只能靠截圖才看得出。
 *
 * ===== 為什麽是 tile.openstreetmap.de =====
 *
 * 大陸直連實測（各項均為真實延遲，非推測）：
 *   tile.openstreetmap.de       1.03s  ✅ 德國 OSM 官方，無 key、無水印
 *   a.tile.openstreetmap.fr     1.13s  ✅ 法國 OSM 鏡像，備選
 *   tile.openstreetmap.org      ✖ 8s 逾時（主站在大陸不可達）
 *   stadiamaps / jawg / arcgis  ✖ 逾時或需 key
 *
 * 它比 CARTO 慢約 5 倍，但在「免 key + 大陸可達 + 官方可信」三項上都更優。
 * 地圖是次要功能（用戶多數只想知道地址），多等 0.8s 可以接受；
 * 而水印或需注冊 key 的方案不可接受。
 *
 * 標準樣式是亮色的，與本站暗色體系不同 —— 這是刻意的取捨：
 * 用 CSS filter 把亮色瓦片反色可以湊出暗色，但地名會變得難讀，
 * 且 filter 會額外吃合成層效能。地圖彈層是獨立覆蓋層，
 * 亮色底反而不易與背後的暗色內容混淆。
 */
const TILE_SOURCES = [
  {
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者',
  },
  {
    url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者， Humanitarian OSM Team',
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

        // 瓦片：德國 OSM 官方鏡像（無 key、無水印）。
        // 不自動切換到備選源：切換會丟掉已載入的瓦片快取，反而更慢；
        // 若該源不可用，用戶仍可用底部「在 OSM 開啟」外鏈。
        L.tileLayer(TILE_SOURCES[0].url, {
          subdomains: TILE_SOURCES[0].subdomains,
          maxZoom: TILE_SOURCES[0].maxZoom,
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

        {/*
         * 地圖本體
         *
         * ★ 容器高度必須是**具體值**，不能用 h-full / flex-1（2026-09-21 踩坑）
         *
         *   起初寫成：
         *     外層 flex-1 + style={minHeight:'min(60vh,460px)'}
         *     內層 <div ref={boxRef} className="h-full w-full" />
         *   結果 .leaflet-container 量到的高度是 **0** —— 瓦片其實都下載成功了
         *   （4 張 200），卻全被壓進 0 高度的容器裡，用戶看到一片純黑。
         *
         *   兩個坑疊在一起：
         *     1. h-full = height:100%，百分比高度要求父元素有**確定**高度；
         *        flex-1 只給 flex-basis，min-height 也不算確定高度。
         *     2. 就算給外層寫了 style height，**flex-1 依然會把它壓掉** ——
         *        作為 flex 子項，其主軸尺寸由 flex-basis/flex-grow 決定，
         *        height 被覆蓋（實測：外層 style 寫了 height 仍量到 0）。
         *
         *   修法：外層不用 flex-1，改 flexShrink-0 + 明確 height；
         *   內層用絕對定位撐滿（絕對定位的百分比相對這個高度確定的父層，
         *   不再依賴 flex 的高度傳遞）。
         */}
        <div
          className="relative shrink-0"
          style={{ height: 'min(60vh, 460px)' }}
        >
          <div ref={boxRef} className="absolute inset-0" />

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
            地圖資料 © OpenStreetMap 貢獻者（ODbL）。
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 備用瓦片源：a.tile.openstreetmap.fr（法國 OSM 鏡像，大陸 1.13s）。
 * 若 tile.openstreetmap.de 失效，把上面 TILE_SOURCES[0] 換成 TILE_SOURCES[1] 即可。
 */
