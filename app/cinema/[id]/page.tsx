import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCinemaById, getCinemaShowtimeDays, SOURCE_LABEL } from '@/lib/data';
import { getCinemas } from '@/lib/data';
import { FeeLine } from '@/components/FeeLine';
import { CinemaMapButton } from '@/components/CinemaMapButton';
import { CinemaShowtimes } from '@/components/CinemaShowtimes';
import { bookingFeeOf } from '@/lib/booking-fee';
import { cinemaCoord } from '@/lib/cinema-geo';

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
  };
}

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
          {cinema.address && (
            <span className="text-sm text-fg-muted">{cinema.address}</span>
          )}
        </div>
        {/*
         * 手續費藥丸（原為戲院地址，再早是裸的一行文字）
         *
         * ★ 用戶 2026-09-21 指定：本行地址改為手續費。
         *   ★ 同日再修：地址不再只存於 hover —— 已放回戲院名右側（上方 header），
         *   手續費獨立成行，兩者互不頂替。
         *
         * ★ 2026-09-26 用戶：「手續費的文字和佈局現在看著突兀不協調」。
         *   這裡原本是一行裸文字（「$10 手續費」/「— 手續費未確認」），
         *   四周沒有容器、跟頁面上其餘藥丸標籤不是同一種東西。
         *   現改為藥丸（.hkm-fee），字號與顏色由該 class 統一給，
         *   因此這裡只傳外距 mt-2，不再傳 text-sm / text-fg。
         *
         *   文案與狀態（含「待確認」的虛線樣式）統一由 components/FeeLine.tsx 決定。
         */}
        <FeeLine amount={fee.amount} note={fee.note} className="mt-2" />
        {/*
         * 地圖按鈕（改開彈層，不再外鏈 Google Maps）
         *
         * ★ 用戶 2026-09-21：改用開源地圖，且大陸可直接訪問。
         *   選型與實測數據見 components/CinemaMapDialog.tsx。
         *
         * 按鈕文案去掉了「↗」——它不再開新視窗（本來的箭頭會誤導），
         * 彈層內有「在 OSM 開啟 ↗」才是真正的外鏈。
         *
         * 只在有座標時渲染：英皇戲院總部是辦公地址、不放映，
         * 座標表裡沒有它（見 lib/cinema-geo.ts 的已知缺項說明）。
         */}
        {cinemaCoord(cinema.id) && (
          <CinemaMapButton
            cinemaId={cinema.id}
            name={cinema.nameZh}
            address={cinema.address}
          />
        )}
      </header>

      <CinemaShowtimes days={days} />
    </>
  );
}
