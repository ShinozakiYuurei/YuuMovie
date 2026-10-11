import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getCinemaById,
  getCinemaShowtimeDays,
  cinemaPhotoPath,
  SOURCE_LABEL,
} from '@/lib/data';
import { getCinemas } from '@/lib/data';
import { FeeLine } from '@/components/FeeLine';
import { CinemaMapButton } from '@/components/CinemaMapButton';
import { CinemaShowtimes } from '@/components/CinemaShowtimes';
import { bookingFeeOf } from '@/lib/booking-fee';
import { cinemaCoord } from '@/lib/cinema-geo';
import { socialCard, cardFileName } from '@/lib/og';

// 静态导出：预先列出所有戏院 id，让每间戏院的详情页都被生成出来。
// 不写这个的话，out/ 里只会有 /cinema 列表页，详情页全部 404。
export function generateStaticParams() {
  return getCinemas().map((c) => ({ id: c.id }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cinema = getCinemaById(id);
  if (!cinema) return { title: '找不到戲院' };
  return {
    title: `${cinema.nameZh}｜場次`,
    description: `${cinema.nameZh}${cinema.address ? `（${cinema.address}）` : ''}今日及近期電影場次、票價及購票連結。`,
    // 分享卡片：构建期生成的戏院专属卡（名称 + 地址 + 影厅规格 + 正在放的片）
    ...socialCard({
      key: `cinema-${cardFileName(cinema.id)}`,
      title: `${cinema.nameZh}｜場次`,
      description: `${cinema.nameZh}${cinema.address ? `（${cinema.address}）` : ''}今日及近期電影場次、票價及購票連結。`,
    }),
  };
}

/**
 * 戲院頭部：場館照 + 名稱 + 地址 + 手續費 + 地圖按鈕
 *
 * ===== 為什麼要這塊（2026-10-11 用戶要求）=====
 *
 * 用戶：「優化電影院點進去的頁面，像圖二一樣添加影院的圖片」——
 * 圖二是 hkmovie6 的戲院頁：一張橫幅場館照打底，名字與資訊壓在上面。
 *
 * 此前這裡是純文字頭部（標題 + 地址 + 手續費 + 地圖按鈕），
 * 十幾個院線源都不給場館照，所以一直沒有圖。照片現由
 * goscraper/cmd/cinemaphotos 從 hkmovie6 抓取、轉成 1600×900 同源圖，
 * 清單見 lib/data.ts 的 cinemaPhotoPath。
 *
 * ===== 沒有照片時必須完全回退 =====
 *
 * 不是每家都拿得到（新光黃埔在 hkmovie6 上沒有橫幅圖、英皇戲院總部是
 * 辦公地址、抓取也可能失敗）。沒有照片時渲染的就是**原先那份純文字頭部**，
 * 而不是一個空的黑框 —— 空框比沒有框更糟，它讓頁面看起來是壞的。
 *
 * ===== 為什麼是 <img> 而不是 next/image =====
 *
 * 橫幅是「填滿容器、按容器比例裁切」的背景式圖片（object-fit: cover），
 * 而 next/image 在 unoptimized: true（靜態導出的必須設定，見 next.config.ts）
 * 下不做任何優化，只是一個包裝層 —— 卻要為此在 <head> 塞進它的
 * 尺寸推導與 loading 策略。這裡直接用 <img> 並顯式寫寬高，
 * 瀏覽器能立刻算出長寬比、不會有佈局抖動。
 *
 * ★ priority 的等價物：這張圖是 LCP 元素，加 fetchPriority="high"
 *   讓它與首屏其餘資源並行抓取，而不是排在後面。
 */
export default async function CinemaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cinema = getCinemaById(id);
  if (!cinema) notFound();

  /*
   * 場次按「日期 → 影片」分組後交給客戶端組件渲染
   *
   * ★ 2026-09-22：原本這裡是**純服務端渲染**，直接 map 出日期與場次膠囊。
   *   但本站是 SSG（output: 'export'），HTML 在構建時定稿 ——
   *   構建後才開映的場次會一直留在頁面上，直到下一次定時重建（每 3 小時）。
   *   用戶回報的「電影到時間上映後不剔除場次」正是這個（實測 22:19 仍顯示
   *   當天 20:50 的場次）。現改由 components/CinemaShowtimes.tsx 按瀏覽器
   *   時鐘實時剔除，詳細取捨見該文件與 lib/live.ts。
   *
   *   取數、分組、海報縮圖解析仍在服務端完成（讀檔案系統的事客戶端做不了）。
   */
  const days = getCinemaShowtimeDays(cinema.id);
  // 網上手續費（每張票）；規則與出處見 lib/booking-fee.ts
  const fee = bookingFeeOf(cinema.id, cinema.source);
  // 場館照；沒有時為 null，頭部回退成純文字（見上方註釋）
  const photo = cinemaPhotoPath(cinema.id);
  const hasCoord = Boolean(cinemaCoord(cinema.id));
  /*
   * 左下角地址行补地区前缀（2026-10-12）：
   *
   *   街道名本身看不出区位 —— 「告士打道 77 號」在港島、九龍、新界都有同名的街，
   *   單靠地址讀者要先自己在腦內對照十八區地圖才能知道去港島還是新界。
   *   地區由 lib/region.ts 從地址推斷，讀取層已算好（cinema.region），
   *   澳門戲院沒有地區值，就退回只顯示地址。
   */
  const addressLine =
    cinema.region && cinema.address
      ? `${cinema.region} · ${cinema.address}`
      : cinema.address;

  return (
    <>
      {/*
       * data-page-nav="cinema"：告訴頂欄「本頁屬於戲院這一類」。
       *
       * ★ 為什麼需要（2026-09-23 發現）：頂欄的「戲院」在 /cinema/<id> 上
       *   從不點亮 —— 它只認 pathname === '/cinema' 的精確匹配，而詳情頁的
       *   路徑是 /cinema/<id>。這與用戶回報的「待映片詳情頁被標成現正上映」
       *   是**同一個機制問題**：詳情頁的子路徑與列表路徑不同，
       *   而頂欄在 layout 裡拿不到子頁面的歸屬。
       *   詳見 components/NavLinks.tsx 與 globals.css 的說明。
       */}
      <nav className="mb-4 text-xs text-fg-dim" data-crumb data-page-nav="cinema">
        <Link href="/cinema" className="text-fg-dim hover:text-fg">
          戲院
        </Link>
        <span className="mx-1">/</span>
        <span className="text-fg-muted">{cinema.nameZh}</span>
      </nav>

      {photo ? (
        /*
         * 有照片：整塊頭部就是那張橫幅（與圖二同構）——
         * 圖打底、上方壓一層由下往上的暗色漸變，資訊疊在底部。
         *
         * ★ 漸變不是裝飾：照片明暗不一（實測從昏暗的戲院大堂到
         *   全白的日間外牆都有），白字直接壓上去時亮圖上完全讀不出。
         *   由下往上的深色漸變保證文字區永遠有足夠的對比，
         *   同時讓照片上半部保持原樣。
         *
         * ★ 比例固定 16:9（照片就是按這個比例裁的，見 cmd/cinemaphotos）：
         *   不固定的話每家的頭部高度都不一樣，跨頁瀏覽時版面會跳。
         */
        <header className="mb-7">
          <div className="relative isolate overflow-hidden rounded-2xl">
            {/* 用原生 <img>：靜態導出下 next/image 不做優化，只多一層包裝（理由見上） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt={`${cinema.nameZh} 場館照`}
              width={1600}
              height={900}
              fetchPriority="high"
              decoding="async"
              className="aspect-video w-full object-cover"
            />
            {/* 漸變遮罩：保證底部文字區的對比度（理由見上） */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/75 via-40% to-transparent"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 via-50% to-transparent"
            />
            <div className="hkm-on-photo absolute inset-x-0 bottom-0 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
                  {cinema.nameZh}
                </h1>
                <span className="hkm-chip">{SOURCE_LABEL[cinema.source]}</span>
              </div>
              {addressLine && (
                <p className="mt-2 text-sm font-medium text-white/95 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                  {addressLine}
                </p>
              )}
              {/*
               * 手續費與地圖按鈕都壓在照片上：兩者的顏色由 .hkm-on-photo
               * 作用域接管（見 globals.css）—— 它們自帶的類優先級高於
               * Tailwind 工具類，逐個加 text-white 是不生效的。
               */}
              <div className="mt-3 flex flex-wrap items-center gap-2.5 sm:gap-3">
                <FeeLine
                  amount={fee.amount}
                  note={fee.note}
                  variant="onPhoto"
                />
                {hasCoord && (
                  <CinemaMapButton
                    cinemaId={cinema.id}
                    name={cinema.nameZh}
                    address={cinema.address}
                    variant="onPhoto"
                  />
                )}
              </div>
            </div>
          </div>
        </header>
      ) : (
        /*
         * 沒有照片：原先那份純文字頭部，一行不改。
         *
         * ★ 為什麼不保留「空照片框」：那會讓頁面看起來是壞的。
         *   沒有圖就老老實實用文字排版 —— 這與海報缺失時卡片
         *   不渲染縮圖是同一套取捨（見 CinemaShowtimes）。
         */
        <header className="mb-7">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-fg">{cinema.nameZh}</h1>
            <span className="hkm-chip">{SOURCE_LABEL[cinema.source]}</span>
            {/*
             * 完整地址（★ 2026-09-21 用戶：「把戲院後面的地區區域補充為完整地址」）
             *
             * 戲院名右邊原本什麼都沒有（地址那行被手續費佔了，
             * 地址只剩地圖按鈕的 hover）。現把完整地址放回戲院名旁邊，
             * 手續費仍獨立成行 —— 兩者都是選戲院要看的資訊，不互相頂替。
             */}
            {addressLine && (
              <span className="text-sm text-fg-muted">{addressLine}</span>
            )}
          </div>
          {/* 手續費獨立一行，以一般次要文字顯示，不套用玻璃或標籤樣式。 */}
          <FeeLine amount={fee.amount} note={fee.note} className="mt-2" />
          {/*
           * 地圖按鈕（改開彈層，不再外鏈 Google Maps）
           *
           * ★ 用戶 2026-09-21：改用開源地圖，且大陸可直接訪問。
           * ★ 2026-09-30 起底圖為 Esri World Street Map（繁體標註），
           *   深色主題下以濾鏡轉深色。選型與實測見 components/CinemaMapDialog.tsx。
           *
           * 按鈕文案去掉了「↗」——它不再開新視窗（本來的箭頭會誤導），
           * 彈層內的高德／Google 連結才是真正的外鏈。
           *
           * 只在有座標時渲染：英皇戲院總部是辦公地址、不放映，
           * 座標表裡沒有它（見 lib/cinema-geo.ts 的已知缺項說明）。
           */}
          {hasCoord && (
            <CinemaMapButton
              cinemaId={cinema.id}
              name={cinema.nameZh}
              address={cinema.address}
            />
          )}
        </header>
      )}

      <CinemaShowtimes days={days} />
    </>
  );
}