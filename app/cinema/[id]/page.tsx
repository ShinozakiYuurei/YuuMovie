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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-fg">{cinema.nameZh}</h1>
          <span className="hkm-chip">{SOURCE_LABEL[cinema.source]}</span>
        </div>
        {cinema.address && <p className="mt-2 text-sm text-fg-muted">{cinema.address}</p>}
        {cinema.mapUrl && (
          <a
            href={cinema.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hkm-btn-ghost mt-3 inline-block rounded-full px-3.5 py-1.5 text-xs"
          >
            在地圖開啟 ↗
          </a>
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
