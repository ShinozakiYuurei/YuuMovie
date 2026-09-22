'use client';

import { useMemo } from 'react';
import { fromCompact } from '@/lib/compact';
import { isLiveShow } from '@/lib/live';
import { useLiveNow } from '@/lib/use-live-now';
import { ShowtimeExplorer } from './ShowtimeExplorer';
import type { CompactRows } from '@/lib/compact';
import type { Facets } from '@/lib/data';

/**
 * 電影詳情頁的「場次及購票」區塊（客戶端）
 *
 * ===== 為什麼要這一層（2026-09-22）=====
 *
 * 用戶回報：「電影到時間上映後，你不會剔除場次」。
 *
 * 本站是 SSG（output: 'export'），HTML 在構建那一刻定稿。lib/data.ts 的
 * load() 會按當前時間過濾，但那是**構建時間**；定時重建每 3 小時一次，
 * 期間開映的場次會一直留在頁面上（實測 22:19 仍顯示當天 20:50 的場次）。
 *
 * 真正的實時剔除由 ShowtimeExplorer 做（它拿得到完整數據）。
 * 但標題上的「共 N 場」chip 原先在頁面組件裡 —— 它若不同步，
 * 就會出現「標題說 131 場、下面列表只剩 130 場」的矛盾。
 *
 * 所以把「當前時間」提到這一層算**一次**，同時餵給標題與列表：
 *   - 標題 chip 與列表數字必然一致（同一次 render、同一個 now）
 *   - 只有一個定時器，不會出現兩個相位不同的 tick
 *
 * 若各自維護一份 useLiveNow()，兩者的 60 秒定時器相位不同，
 * 最多會有整整一分鐘對不上 —— 那正是用戶以前專門要求修過的問題。
 *
 * ===== 為什麼連 section 一起搬過來 =====
 *
 * 區塊帶著 id="versions"（MovieIntro 的「場次」按鈕指過來）。
 * 若把 section 留在服務端、只搬內部內容，那麼「所有場次都已開映」時
 * 會留下一個**空的 section**：用戶點「場次」跳到一片空白，比沒跳更困惑。
 * 一起搬過來後，空的情況由本組件自己渲染「暫無場次資料」，
 * 錨點永遠有落點。
 *
 * ===== hydration 安全 =====
 *
 * useLiveNow() 首次回傳 null → 全部保留 → 與構建產物逐字一致，
 * 不會有 hydration mismatch；掛載後才寫入真實時間。見 lib/use-live-now.ts。
 */
export function MovieShowtimes({
  compact,
  facets,
  /** 片長 chip 的文案（如「2小時20分」）；null 則不顯示 */ 
  durationText,
}: {
  compact: CompactRows;
  facets: Facets;
  durationText: string | null;
}) {
  const now = useLiveNow();

  /**
   * 未開映場次數（與列表用同一份規則與同一個 now）
   *
   * 這裡只做「解壓 + 過濾 + 取長度」，不解壓成完整 ShowRow[] 之外的東西 ——
   * 列表由 ShowtimeExplorer 內部自行解壓（它需要那些欄位）。
   * 代價是解壓兩次（純數組映射，微秒級），換來標題與列表的數字絕對一致。
   */
  const liveCount = useMemo(
    () => fromCompact(compact).filter((r) => isLiveShow(r.startAt, now)).length,
    [compact, now]
  );

  return (
    <section
      id="versions"
      className="mt-8"
      style={{ scrollMarginTop: 'calc(var(--hkm-header-h) + 1rem)' }}
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-bold tracking-tight">場次及購票</h2>
        {liveCount > 0 && <span className="hkm-chip">共 {liveCount} 場</span>}
        {durationText && <span className="hkm-chip">片長 {durationText}</span>}
      </div>

      {liveCount === 0 ? (
        // 全部場次都已開映（原先這裡會是「共 0 場」＋空列表，看不出發生了什麼）
        <p className="hkm-panel rounded-2xl py-16 text-center text-base text-fg-soft">
          暫無場次資料
        </p>
      ) : (
        <>
          <ShowtimeExplorer compact={compact} facets={facets} now={now} />

          <p className="mt-3 text-[11px] text-fg-dim">
            點擊場次將前往院線官方購票頁面（另開新視窗）。場次及票價以院線官方公佈為準。
          </p>
        </>
      )}
    </section>
  );
}
