'use client';

import { useEffect, useRef, useState } from 'react';
import { CINEMA_COORD, amapUrl, googleMapsUrl, wgs84ToGcj02 } from '@/lib/cinema-geo';
import { createMapTile } from '@/lib/map-tiles';
import type { MapTileStyle, TileCoords, TileDone } from '@/lib/map-tiles';
import { loadLeaflet } from '@/lib/leaflet-loader';
export { preloadLeaflet } from '@/lib/leaflet-loader';

/**
 * 戲院地圖彈層（Esri World Street Map）
 *
 * Esri 瓦片使用 WGS-84 / Web Mercator，與戲院座標相同；地圖標記不需座標偏移。
 * 瓦片網路錯誤時會並行對沖至另一個官方節點，避免慢連線留下空白。
 * Leaflet 只在打開地圖時載入，避免把次要功能加入每位訪客的初始下載。
 *
 * ★ 深色主題（2026-09-30 用戶要求）：
 *   站點是深色 / 淡粉雙主題（見 ThemeToggle.tsx），而地圖原本永遠是亮色 ——
 *   深色頁面上彈出一塊白底地圖，跟整個介面格格不入。
 *
 *   做法是「街道圖 + CSS 濾鏡」而不是換成 Esri 的深色底圖服務：
 *   後者（Canvas/World_Dark_Gray_Base）在香港 z17 以上沒有資料，
 *   回傳的是「Map data not yet available」佔位圖，而地圖預設 zoom 16、
 *   用戶會拉到 18。濾鏡方案語言與街道細節完全不變（仍是繁體），
 *   只把亮度反轉。濾鏡細節見 lib/map-tiles.ts 的 DARK_TILE_FILTER。
 */

/** Leaflet 的最小型別（只用到這幾個成員，不為它裝 300KB 的 @types） */
interface LeafletMap {
  remove(): void;
  invalidateSize(): void;
  setView(center: [number, number], zoom: number): void;
}
interface LeafletTileLayer {
  createTile(coords: TileCoords, done: TileDone): HTMLElement;
  addTo(map: LeafletMap): LeafletTileLayer;
  on(eventName: string, callback: (event: { tile: HTMLElement }) => void): LeafletTileLayer;
  redraw(): void;
}
interface LeafletNS {
  map(el: HTMLElement, opts?: Record<string, unknown>): LeafletMap;
  gridLayer(opts?: Record<string, unknown>): LeafletTileLayer;
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
  const retryTilesRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [missingTileCount, setMissingTileCount] = useState(0);

  const coord = CINEMA_COORD[cinemaId] ?? null;

  /**
   * GCJ-02 座標只用於高德外鏈；Esri 瓦片使用原始 WGS-84 座標。
   *
   * 香港 WGS-84 → GCJ-02 偏移約 595m；高德外鏈需轉換，Esri 標記與 Google 外鏈用原值。
   */
  const gcjCoord: [number, number] | null = coord
    ? wgs84ToGcj02(coord[0], coord[1])
    : null;

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
    if (!coord || !gcjCoord) {
      setState('error');
      setErrMsg('這間戲院暫無座標資料');
      return;
    }
    let cancelled = false;
    let loadingTimer: number | undefined;
    let resizeTimer: number | undefined;
    let resizeFrame: number | undefined;
    const pendingTiles = new Map<HTMLElement, () => void>();
    const missingTiles = new Set<HTMLElement>();
    setMissingTileCount(0);
    setState('loading');
    // Keep the map visible while tiles load, but never leave a loading badge indefinitely.
    loadingTimer = window.setTimeout(() => {
      if (!cancelled) setState('ready');
    }, 5000);

    (async () => {
      try {
        await loadLeaflet();
        if (cancelled || !boxRef.current) return;

        const L = (window as unknown as { L: LeafletNS }).L;

        /*
         * 地圖樣式跟隨當前主題。
         *
         * ★ 為什麼只讀一次就夠：主題切換鈕在頂欄（z-50），而本彈層是
         *   fixed inset-0 z-[60] —— 彈層開著時切換鈕根本點不到，
         *   所以「彈層開著時主題變了」不可能發生，不需要 MutationObserver。
         *   （若日後把彈層 z-index 降到頂欄之下，這裡要改成監聽。）
         *
         * ★ 為什麼讀 data-theme 而不是 .dark 類：兩者在 ThemeToggle 裡
         *   是同步維護的，但 data-theme 是啟動腳本就寫入的**事實來源**
         *   （見 app/layout.tsx 的 THEME_SCRIPT），更早、更可靠。
         */
        const isDark = document.documentElement.dataset.theme !== 'light'
          && document.documentElement.dataset.theme !== 'pink';
        const tileStyle: MapTileStyle = isDark ? 'dark' : 'street';

        const markerBlue = '#4285f4';

        const [mapLat, mapLon] = coord;

        const map = L.map(boxRef.current, {
          center: [mapLat, mapLon],
          zoom: 16,
          zoomControl: true,
          // Attribution is rendered in the dialog footer with the Esri source list.
          attributionControl: false,
          // 手機上雙指縮放才不會被頁面滾動搶走
          tap: true,
        });
        mapRef.current = map;

        // GridLayer lets retries finish before Leaflet marks a tile complete.
        const tiles = L.gridLayer({ maxZoom: 19 });
        tiles.createTile = (coords, done) => {
          const { tile, cancel } = createMapTile(coords, (error, element) => {
            pendingTiles.delete(element);
            if (!cancelled) done(error, element);
          }, tileStyle);
          pendingTiles.set(tile, cancel);
          return tile;
        };
        tiles.on('tileunload', ({ tile }) => {
          pendingTiles.get(tile)?.();
          pendingTiles.delete(tile);
          if (missingTiles.delete(tile) && !cancelled) setMissingTileCount(missingTiles.size);
        });
        tiles.on('tileerror', ({ tile }) => {
          if (cancelled) return;
          missingTiles.add(tile);
          setMissingTileCount(missingTiles.size);
        });
        tiles.on('load', () => {
          if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
          // load includes failed tiles; failures have a separate, non-blocking retry notice.
          if (!cancelled) setState('ready');
        });
        retryTilesRef.current = () => tiles.redraw();
        tiles.addTo(map);

        // Two layers keep the cinema location legible against both light and dark tiles.
        L.circleMarker([mapLat, mapLon], {
          radius: 17,
          className: 'hkm-map-marker-halo',
          color: markerBlue,
          weight: 1.5,
          opacity: 0.72,
          fillColor: markerBlue,
          fillOpacity: 0.2,
        }).addTo(map);
        L.circleMarker([mapLat, mapLon], {
          radius: 7,
          className: 'hkm-map-marker-core',
          color: '#ffffff',
          weight: 2,
          fillColor: markerBlue,
          fillOpacity: 0.98,
        }).addTo(map);

        // 容器在彈層動畫中尺寸可能未定，強制量一次
        resizeFrame = requestAnimationFrame(() => { if (!cancelled) map.invalidateSize(); });
        resizeTimer = window.setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 220);
      } catch (e) {
        if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
        if (!cancelled) {
          setState('error');
          setErrMsg(e instanceof Error ? e.message : '地圖載入失敗');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      for (const cancel of pendingTiles.values()) cancel();
      pendingTiles.clear();
      retryTilesRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [coord]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--hkm-scrim)] p-4 backdrop-blur-sm"
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
          {/*
           * hkm-map-canvas：底色與縮放鈕的深色適配（見 app/globals.css）。
           * Leaflet 會在這個 div 上自己加 .leaflet-container 類，
           * 兩者互不衝突。
           */}
          <div ref={boxRef} className="hkm-map-canvas absolute inset-0" />

          {state === 'loading' && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full border border-hairline bg-[var(--hkm-panel)]/90 px-3 py-1.5 text-sm text-fg-muted shadow-lg backdrop-blur-md">
              地圖載入中…
            </div>
          )}
          {missingTileCount > 0 && (
            <div className="absolute left-1/2 top-3 z-[500] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-[var(--hkm-panel)]/90 px-3 py-1.5 text-xs text-fg-soft shadow-lg backdrop-blur-md" role="status">
              <span>部分地圖未載入</span>
              <button type="button" className="font-semibold text-accent" onClick={() => retryTilesRef.current?.()}>
                重試
              </button>
            </div>
          )}
          {state === 'error' && (
            <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-fg-soft">{errMsg}</p>
              <p className="text-xs text-fg-dim">
                可改用下方地圖連結直接前往地圖網站。
              </p>
            </div>
          )}
        </div>

        {/* 底部：外鏈 + 署名說明 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-4 py-2.5">
          {coord && gcjCoord && (
            <>
              {/*
                高德外鏈必須傳 GCJ-02（URL 帶 coordinate=gaode，高德不做二次偏移），
                傳 WGS-84 原值會讓標記落在 ~595m 外。
              */}
              <a
                href={amapUrl(gcjCoord[0], gcjCoord[1])}
                target="_blank"
                rel="noopener noreferrer"
                className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
              >
                在高德地圖開啟 ↗
              </a>
              {/*
                谷歌外鏈用 WGS-84 原座標（不是 GCJ-02）：
                Google 用 WGS-84，傳偏移後座標會讓標記落在 ~595m 外。
                大陸用戶點了打不開（maps.google.com 8–9s 逾時），
                但香港／海外訪客有用。
              */}
              <a
                href={googleMapsUrl(coord[0], coord[1])}
                target="_blank"
                rel="noopener noreferrer"
                className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
              >
                在 Google 地圖開啟 ↗
              </a>
            </>
          )}
          <span className="text-[11px] leading-relaxed text-fg-dim">
            Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 備援方案：
 *   1. 弹层打不开 → 底部地图外链
 *   2. 瓦片节点异常 → 慢请求并行对冲到另一节点；最终失败时可点「重試」或使用外链。
 */
