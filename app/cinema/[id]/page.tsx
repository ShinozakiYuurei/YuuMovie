import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getCinemaById,
  getShowsByCinema,
  getMovieById,
  getGroupForMovieId,
  posterThumbPath,
  SOURCE_LABEL,
} from '@/lib/data';
import { getCinemas } from '@/lib/data';
import { FeeLine } from '@/components/FeeLine';
import { CinemaMapButton } from '@/components/CinemaMapButton';
import { bookingFeeOf } from '@/lib/booking-fee';
import { cinemaCoord } from '@/lib/cinema-geo';
import { formatDate, formatTime } from '@/lib/format';

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

  const shows = getShowsByCinema(cinema.id);
  // 網上手續費（每張票）；規則與出處見 lib/booking-fee.ts
  const fee = bookingFeeOf(cinema.id, cinema.source);

  // 按日期 → 影片分组
  const byDate = new Map<string, Map<string, typeof shows>>();
  for (const s of shows) {
    if (!s.movieId) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const byMovie = byDate.get(s.date)!;
    if (!byMovie.has(s.movieId)) byMovie.set(s.movieId, []);
    byMovie.get(s.movieId)!.push(s);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <>
      <nav className="mb-4 text-xs text-fg-dim">
        <Link href="/cinema" className="hover:text-fg">
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
         * 手續費行（原為戲院地址）
         *
         * ★ 用戶 2026-09-21 指定：本行地址改為手續費。
         *   與場次頁/戲院列表頁同一規則與同一視覺語言（免則標 $0）。
         *   ★ 同日再修：地址不再只存於 hover —— 已放回戲院名右側（上方 header），
         *   手續費獨立成行，兩者互不頂替。
         *
         * ★ 同日再修：整行改為 text-fg。原先「$10」用 text-fg、「手續費」
         *   用 text-fg-muted，用戶要求「手續費的字體顏色和前面的金額一致」。
         *
         * ★ 同日三修：「（已含）」→「（已含於票價）」—— 三個頁面同一文案。
         *
         * ★ 同日四修：外加的也補上後綴（結帳另加），三處統一。
         *
         * ★ 同日五修（用戶最終定稿）：「算了，還是換成"$xx 手續費"這樣子，
         *   然後統一下長度，個位數的 8 元和兩位數的 10 元，最後的長度一樣」
         *   —— 後綴全部去掉；長度靠 .hkm-num 對齊。
         *   這一行改由 components/FeeLine.tsx 統一渲染。
         */}
        <FeeLine amount={fee.amount} note={fee.note} className="mt-2 text-sm text-fg" />
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

      {dates.length === 0 && <p className="py-16 text-center text-fg-dim">暫無場次資料</p>}

      {dates.map((date) => {
        const byMovie = byDate.get(date)!;
        return (
          <section key={date} className="mb-9">
            <h2 className="mb-3.5 flex items-baseline gap-2 border-b border-hairline pb-2.5 text-lg font-semibold tracking-tight">
              {formatDate(date)}
            </h2>
            <div className="space-y-3.5">
              {[...byMovie.entries()].map(([movieId, list]) => {
                const movie = getMovieById(movieId);
                // ★ 必须链到「电影组」的 slug，不能用 movie.slug：
                //   详情页只按组生成（dynamicParams = false），同一部片在多家院线的
                //   非代表条目 slug 根本没页面，链过去就是 404（修复前占影院页链接的 57%）。
                //   片名也取组的 displayName（已去 IMAX / 特典場 等格式后缀）。
                const group = getGroupForMovieId(movieId);
                const label =
                  group?.displayName?.trim() ||
                  movie?.nameZh?.trim() ||
                  movie?.nameEn?.trim() ||
                  `影片 #${movieId}`;
                return (
                  <div key={movieId} className="hkm-panel rounded-2xl p-3.5">
                    <div className="mb-2.5 flex items-center gap-2.5">
                      {(group?.displayPoster || movie?.poster) && (
                        /*
                         * ★ 用 64w 缩略图，不用主图。
                         *
                         * 这里只渲染 32×48px，却曾引用主图：
                         * 实测单页 52 张 × 28KB ≈ 1.43MB，缩略图只要 ~1KB。
                         * posterThumbPath 在构建期已确认文件存在，
                         * 缺失时原样返回主图路径，不会 404。
                         */
                        <Image
                          src={posterThumbPath(group?.displayPoster || movie!.poster!)!}
                          alt=""
                          width={32}
                          height={48}
                          className="h-12 w-8 rounded-md object-cover"
                        />
                      )}
                      {group ? (
                        <Link
                          href={`/movie/${group.slug}`}
                          className="text-sm font-semibold text-fg transition hover:text-accent"
                        >
                          {label}
                        </Link>
                      ) : (
                        // 无可归属的组（院线未回片名的脏条目）：给纯文本，不链 404
                        <span className="text-sm font-semibold text-fg-muted">{label}</span>
                      )}
                      <span className="ml-auto text-[11px] text-fg-dim">{list.length} 場</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((s) => (
                        <a
                          key={s.id}
                          href={s.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          title={`${s.houseName} $${s.price ?? '?'}${s.seats != null ? ` · 餘 ${s.seats}` : ''}`}
                          className="rounded-xl border border-hairline bg-veil px-2.5 py-1 text-center transition hover:border-accent/60 hover:bg-accent/12"
                        >
                          <span className="text-sm font-bold text-fg">
                            {formatTime(s.startAt)}
                          </span>
                          <span className="ml-2 text-[10px] text-fg-muted">
                            {s.houseName || '—'} · ${s.price ?? '—'}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
