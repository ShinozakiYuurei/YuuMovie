'use client';

import { useEffect, useRef, useState } from 'react';
import { CINEMA_COORD, amapUrl, googleMapsUrl, wgs84ToGcj02 } from '@/lib/cinema-geo';

/**
 * 戲院地圖彈層（高德瓦片）
 *
 * ⚠️ 授權狀態：本站**沒有高德開發者 key**，目前直接引用高德網頁版用的公開瓦片
 *   端點（hotlinking）。這不是正規用法，詳見下方「數據來源與署名」。
 *   待辦：申請高德開放平台 key（免費額度足夠），把未授權引用換成正規調用。
 *
 * ===== 為什麼不用 Google Maps =====
 *
 * 用戶 2026-09-21 指定：改用開源地圖，且**大陸可直接訪問**。
 * 实测（大陆直连）：
 *   maps.google.com / maps.googleapis.com / maps.gstatic.com
 *     / mt0.google.com / www.google.com.hk/maps  → 全部 8–9s 超時
 *   唯一通的 ditu.google.cn 只是個静态落地页（110ms，但 body 只有
 *   「请收藏我们的网址」，指向 google.com.hk/maps 仍然超時）。
 *
 *   Google Maps JS API 现在还强制要 API key + 绑定信用卡，否则地圖會印
 *   「For development purposes only」水印（与 2026-09-21 棄用 CARTO 同一原因）。
 *
 * ===== 為什麼用高德瓦片而不是 OSM =====
 *
 * 实测 z16 香港中环瓦片（首屏 4–16 张）：
 *   tile.openstreetmap.de       1.65s/张  → 首屏 4–6 张，串行 ≈ 4–6s（这是现在慢的根因）
 *   tile.openstreetmap.fr/hot   2.6s/张
 *   CARTO dark                   ❌ 超時
 *   wprd01.is.autonavi.com       **61ms/张** ✅（高德风格 7：路网灰版）
 *   wprd01 style=8              82ms/张（115KB：详盡版，路网+注記+建築色塊，視覺最清晰）
 *   webrd01 style=8              57ms/张
 *
 * 高德瓦片在中国大陆可达，且对香港、澳门有完整覆盖（实测中环 IFC 渲染正常）。
 *
 * 代价：高德/腾讯/百度都用 GCJ-02（火星坐标），我们的 CINEMA_COORD 是 WGS-84。
 * 香港实测偏移约 **595m**（若直接套用原坐标，标记会落在 6 个街口之外）。
 * 修法：在请求瓦片和画标记时都过一遍 `wgs84ToGcj02()`。
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
 * 瓦片源：高德地圖
 *
 * ===== 爲什麼選 wprd01 + style=8 =====
 *
 * 高德公开瓦片端點实测（香港中环 z16）：
 *   webrd01.is.autonavi.com  路由版，57ms/张，21KB（含路网+注記）
 *   wprd01.is.autonavi.com   经纬度版，61ms/张，115KB（最详盡版，含路网+注記+建築色塊）
 *
 * 选 wprd01 + style=8：标记位置可读性最好（建築有底色，街道有名字），且
 * 子域名 wprd01–04 实测都通（46–131ms），可分散连接压力。
 *
 * maxZoom=19：高德实测 z20 返回 179B 空白瓦片，z19 是上限。
 *
 * ===== 數據來源與署名 =====
 *
 * ⚠️ 重要更正（上一版寫錯了）：
 *
 *   上一版註釋與 UI 都寫「高德瓦片基底是 OSM 資料」——那是**我的推測，未經證實，
 *   而且是錯的**。高德的地圖數據來自自家採集與官方測繪授權，與 OSM 是兩套獨立
 *   體系（最直接的證據：高德用 GCJ-02 火星坐標，OSM 用 WGS-84）。
 *   高德瓦片商用需要授權，本站目前**沒有開發者 key**，是直接引用高德網頁版用的
 *   公開瓦片端點（hotlinking）。所以：
 *     - 署名只寫「© 高德地圖」，**不再虛假標註 OpenStreetMap / ODbL**
 *       （ODbL 是有法律約束力的許可證，亂署比不署更糟）
 *     - 底部保留「在高德地圖開啟 ↗」跳官方，作為正規出口
 *     - 待辦：申請高德開放平台 key（免費額度足夠本站用量），把未授權引用換成正規調用
 *
 * ===== 为什么不自动切到备援 =====
 *
 * 若当前源不可用，不切到「传统 OSM」（慢 27 倍），让用户点底部「在高德／Google
 * 地圖開啟」外链就好——弹层本身没有并发/降级需求，保持简单。
 */
const TILE_URL =
  'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8';

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

  /**
   * GCJ-02（火星坐標）版本座標 —— 高德瓦片與高德外鏈都要用它。
   *
   * 香港 WGS-84 → GCJ-02 偏移約 595m：不偏移的話，地圖標記與高德外鏈
   * 都會落在 6 個街口之外。Google 外鏈則用 WGS-84 原值（下方 googleMapsUrl）。
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

    (async () => {
      try {
        await loadLeaflet();
        if (cancelled || !boxRef.current) return;

        const L = (window as unknown as { L: LeafletNS }).L;

        // 标记色跟随当前主题（见下方 circleMarker 的注释）
        const cs = getComputedStyle(document.documentElement);
        const accent = cs.getPropertyValue('--hkm-accent').trim() || '#8b7cff';
        const accentSoft = cs.getPropertyValue('--hkm-accent-soft').trim() || '#a78bfa';

        // 高德瓦片用 GCJ-02（偏移在下方 gcjCoord 統算）。
        const [gcjLat, gcjLon] = gcjCoord;

        const map = L.map(boxRef.current, {
          center: [gcjLat, gcjLon],
          zoom: 16,
          zoomControl: true,
          // 不使用 Leaflet 自带的 attribution 控件（它会拼一个「Leaflet | 」前缀），
          // 右下角角标交给弹层自己的 DOM 渲染（见下方底部署名区），
          // 保证右下角只有「© 高德地圖」这一行，不混入 Leaflet 标识。
          attributionControl: false,
          // 手機上雙指縮放才不會被頁面滾動搶走
          tap: true,
        });
        mapRef.current = map;

        // 瓦片：高德 wprd01–04（大陆 ~61ms/张；style=8 详盡版含路网+注記+建築色塊）。
        const tileUrl = TILE_URL.replace('{s}', '1');
        L.tileLayer(tileUrl, {
          subdomains: '1234',
          maxZoom: 19,
          }).addTo(map);

        // 標記：用圓點而非預設大頭針 —— Leaflet 預設圖示是外部 PNG，
        // 在高德瓦片上偏亮且要多一次請求；圓點是純 SVG，且用主題色。
        L.circleMarker([gcjLat, gcjLon], {
          radius: 8,
          // ★ 颜色从 CSS 变量现读，不写死：标记色应与当前主题的强调色一致
          //   （浅色主题下 #8b7cff 在亮色地图上偏淡）。变量缺失时回退到原紫。
          color: accentSoft,
          weight: 3,
          fillColor: accent,
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
                可改用下方「在高德／Google 地圖開啟」直接前往地圖網站。
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
            &copy; 高德地圖
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 備援方案：
 *   1. 弹层打不开 → 底部「在高德／Google 地圖開啟」外链
 *   2. 高德源宕机 → 在 TILE_URL 换 webrd01.is.autonavi.com (57ms/张，但只 21KB)
 */
