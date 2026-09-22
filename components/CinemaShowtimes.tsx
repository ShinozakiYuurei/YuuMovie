'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo } from 'react';
import { formatDate, formatTime } from '@/lib/format';
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
 * ===== 版面與原先完全一致 =====
 *
 * 本組件只搬邏輯不改樣式：日期標題 → 影片卡片（縮圖 + 片名 + 場次數）→ 場次膠囊。
 * 唯一新增的是「整個日期/影片分組在過濾後為空時整段不渲染」——
 * 這是實時剔除的必然結果（今晚散場後「今天」那一節就該整段消失）。
 */
export function CinemaShowtimes({ days }: { days: CinemaShowtimeDay[] }) {
  const now = useLiveNow();

  /**
   * 按當前時間過濾 + 丟掉被清空的分組
   *
   * 三層都要清：
   *   1. 場次：已開映的剔除
   *   2. 影片：過濾後一場不剩的整張卡片不渲染（否則會出現「片名 + 0 場」）
   *   3. 日期：整個日期下所有影片都空了，那一節連標題一起消失
   *      （否則晚上會看到一排空的「9月22日（週二）」標題）
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

  // 全部場次都已開映：給一句明確的說明，而不是留一片空白
  if (liveDays.length === 0) {
    return <p className="py-16 text-center text-fg-dim">暫無場次資料</p>;
  }

  return (
    <>
      {liveDays.map(({ date, movies }) => (
        <section key={date} className="mb-9">
          <h2 className="mb-3.5 flex items-baseline gap-2 border-b border-hairline pb-2.5 text-lg font-semibold tracking-tight">
            {formatDate(date)}
          </h2>
          <div className="space-y-3.5">
            {movies.map((m) => (
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
        </section>
      ))}
    </>
  );
}
