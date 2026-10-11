'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { formatDate, formatDateShort, formatTime, relativeDay, weekdayShort } from '@/lib/format';
import { isLiveShow } from '@/lib/live';
import { useLiveNow } from '@/lib/use-live-now';
import type { CinemaShowtimeDay } from '@/lib/data';

/**
 * 戲院頁的場次列表（客戶端，實時剔除已開映場次）
 *
 * ===== 為什麼搬到客戶端（2026-09-22 用戶回報的 bug）=====
 *
 * 用戶：「電影到時間上映後，你不會剔除場次」。
 *
 * 本站是 SSG（next.config.ts 的 output: 'export'），nginx 直接發構建好的 HTML。
 * 戲院頁原先是純服務端渲染 —— 場次列表在**構建那一刻**就寫死進 HTML 了。
 * 定時重建每 3 小時一次，期間開映的場次會一直留在頁面上。
 *
 * 實測：22:19 訪問 MCL THE ONE 的頁面，仍能看到當天 20:50 的場次（已開映 1.5 小時）。
 *
 * 數據層（lib/data.ts）的過濾只能治構建之前的場次，治不了之後的 ——
 * 場次時間在持續流逝，任何「定時重建」都必然有窗口。唯一能貼著時鐘走的
 * 只有瀏覽器裡的 JS，故把渲染搬過來。
 *
 * ===== hydration 安全 =====
 *
 * useLiveNow() 首次回傳 null → isLiveShow 一律保留 → 與構建產物逐字一致，
 * 不會有 hydration mismatch；掛載後才寫入真實時間，過期場次此時才消失。
 * 詳見 lib/use-live-now.ts。
 *
 * ===== 版面：日期按鈕 + 一次只看一天（2026-10-11 用戶要求）=====
 *
 * 用戶：「排片按圖二一樣有個日期按鈕」（圖二是 hkmovie6 的戲院頁）。
 *
 * 此前是一條長列表：每一天一節標題，下面掛當天的影片卡片，
 * 想看後天要先滾過今天的全部場次。戲院頁的場次可以排到兩個多月後
 * （實測電影中心 72 個放映日），一路滾下去極難定位。
 *
 * 現在改成與場次頁（components/ShowtimeExplorer.tsx）同一套互動：
 * 橫向日期條，點一天看一天，默認落在**最早仍有場次的那天**。
 *
 * ★ 為什麼不抽成共用組件：兩邊的日期條看著像，實際三處不同 ——
 *   場次頁要顯示「共 N 場 / N 間戲院」且日期條 sticky 在篩選面板下，
 *   戲院頁沒有篩選面板、也不需要 sticky（列表短得多）；
 *   強行合併會多出一堆「傳進來才顯示」的分支，比各寫一份更難讀。
 *   兩邊共享的是**規則**（relativeDay 隨 now 算、選中態的樣式），
 *   那些本來就在 lib/format.ts 與 globals.css 裡。
 */
export function CinemaShowtimes({ days }: { days: CinemaShowtimeDay[] }) {
  const now = useLiveNow();

  /**
   * 按當前時間過濾 + 丟掉被清空的分組
   *
   * 三層都要清：
   *   1. 場次：已開映的剔除
   *   2. 影片：過濾後一場不剩的整張卡片不渲染（否則會出現「片名 + 0 場」）
   *   3. 日期：整個日期下所有影片都空了，那一節連按鈕一起消失
   *      （否則晚上會看到一排空的日期按鈕）
   */
  const liveDays = useMemo(() => {
    return days
      .map((d) => ({
        date: d.date,
        movies: d.movies
          .map((m) => ({ ...m, shows: m.shows.filter((s) => isLiveShow(s.startAt, now)) }))
          .filter((m) => m.shows.length > 0),
      }))
      .filter((d) => d.movies.length > 0);
  }, [days, now]);

  /** 用戶點選的日期；null = 尚未選（跟隨第一日） */
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  /**
   * 當前顯示的日期
   *
   * ★ 與場次頁同一套寫法：篩選/剔除讓原選中日期消失時**自動落到第一天**，
   *   而不是寫回 state —— 寫回會多一次渲染，而且用戶下次仍可能點到已消失的那天。
   *   （實時剔除是這裡的「篩選」：午夜過後今天整段消失，選中的就是昨天。）
   */
  const active = liveDays.find((d) => d.date === pickedDate) ?? liveDays[0] ?? null;

  // 全部場次都已開映：給一句明確的說明，而不是留一片空白
  if (!active) {
    return <p className="py-16 text-center text-fg-dim">暫無場次資料</p>;
  }

  const dayShows = active.movies.reduce((n, m) => n + m.shows.length, 0);

  return (
    <>
      {/* 日期按鈕：橫向一條，一次只看一天（不發請求，數據已在客戶端） */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {liveDays.map(({ date, movies }) => {
          const on = date === active.date;
          const n = movies.reduce((sum, m) => sum + m.shows.length, 0);
          /*
           * 相對日期（今天／明天／後天）隨 now 在客戶端算：
           * now 為 null（首屏、尚未掛載）時 relativeDay 回傳 null →
           * 顯示場次數；掛載後才顯示相對日期，跨午夜也隨 now 一起更新。
           *
           * ★ 絕不能在服務端算好寫進 HTML：本站是 SSG，構建時算的
           *   「明天」一過香港午夜就是錯的（見 lib/format.ts 的 relativeDay）。
           */
          const rel = relativeDay(date, now);
          return (
            <button
              key={date}
              type="button"
              aria-pressed={on}
              onClick={() => setPickedDate(date)}
              className={`flex w-[76px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 transition ${
                on
                  ? 'border-fg bg-fg text-canvas shadow-[0_8px_24px_-14px_var(--hkm-active-pill-glow)]'
                  : 'border-hairline-strong bg-veil text-fg-soft hover:border-hairline-strong hover:bg-veil-strong hover:text-fg'
              }`}
            >
              <span className="tabular-nums text-sm font-bold leading-tight">
                {formatDateShort(date)}
              </span>
              <span className={`text-xs leading-tight ${on ? 'opacity-70' : 'text-fg-muted'}`}>
                {weekdayShort(date)}
              </span>
              <span
                className={`mt-0.5 text-[11px] leading-tight ${
                  on ? 'font-medium opacity-70' : 'text-fg-muted'
                }`}
              >
                {rel === '今天' || rel === '明天' || rel === '後天' ? rel : `${n} 場`}
              </span>
            </button>
          );
        })}
      </div>

      {/* 當日標題：寫明是哪一天、共幾場，與場次頁的第二層同構 */}
      <h2 className="mt-5 mb-3.5 flex items-baseline gap-2 border-b border-hairline pb-2.5 text-lg font-semibold tracking-tight">
        {formatDate(active.date)}
        <span className="text-xs font-normal text-fg-dim">{dayShows} 場</span>
      </h2>

      <div className="space-y-3.5">
        {active.movies.map((m) => (
          <div key={m.movieId} className="hkm-panel rounded-2xl p-3.5">
            <div className="mb-2.5 flex items-center gap-2.5">
              {m.poster && (
                /*
                 * 用 64w 縮略圖，不用主圖。
                 *
                 * 這裡只渲染 32×48px，卻曾引用主圖：
                 * 實測單頁 52 張 × 28KB ≈ 1.43MB，縮圖只要 ~1KB。
                 * posterThumbPath 在服務端已確認文件存在（見 getCinemaShowtimeDays），
                 * 缺失時回退主圖，不會 404。
                 */
                <Image
                  src={m.poster}
                  alt=""
                  width={32}
                  height={48}
                  className="h-12 w-8 rounded-md object-cover"
                />
              )}
              {m.slug ? (
                <Link
                  href={`/movie/${m.slug}`}
                  className="text-sm font-semibold text-fg transition hover:text-accent"
                >
                  {m.label}
                </Link>
              ) : (
                // 無可歸屬的組（院線未回片名的髒條目）：給純文字，不鏈 404
                <span className="text-sm font-semibold text-fg-muted">{m.label}</span>
              )}
              <span className="ml-auto text-[11px] text-fg-dim">{m.shows.length} 場</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.shows.map((s) => (
                <a
                  key={s.id}
                  href={s.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  title={`${s.houseName} $${s.price ?? '?'}${s.seats != null ? ` · 餘 ${s.seats}` : ''}`}
                  className="rounded-xl border border-hairline bg-veil px-2.5 py-1 text-center transition hover:border-accent/60 hover:bg-accent/12"
                >
                  <span className="text-sm font-bold text-fg">{formatTime(s.startAt)}</span>
                  <span className="ml-2 text-[10px] text-fg-muted">
                    {s.houseName || '—'} · ${s.price ?? '—'}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}