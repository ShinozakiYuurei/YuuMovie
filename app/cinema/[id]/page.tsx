import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getCinemaById,
  getShowsByCinema,
  getMovieById,
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
      <nav className="mb-4 text-xs text-gray-500">
        <Link href="/cinema" className="hover:text-white">
          戲院
        </Link>
        <span className="mx-1">/</span>
        <span className="text-gray-400">{cinema.nameZh}</span>
      </nav>

      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">{cinema.nameZh}</h1>
          <span className="hkm-chip">{SOURCE_LABEL[cinema.source]}</span>
        </div>
        {cinema.address && <p className="mt-2 text-sm text-gray-400">{cinema.address}</p>}
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

      {dates.length === 0 && <p className="py-16 text-center text-gray-500">暫無場次資料</p>}

      {dates.map((date) => {
        const byMovie = byDate.get(date)!;
        return (
          <section key={date} className="mb-9">
            <h2 className="mb-3.5 flex items-baseline gap-2 border-b border-white/8 pb-2.5 text-lg font-semibold tracking-tight">
              {formatDate(date)}
            </h2>
            <div className="space-y-3.5">
              {[...byMovie.entries()].map(([movieId, list]) => {
                const movie = getMovieById(movieId);
                return (
                  <div key={movieId} className="hkm-panel rounded-2xl p-3.5">
                    <div className="mb-2.5 flex items-center gap-2.5">
                      {movie?.poster && (
                        <Image
                          src={movie.poster}
                          alt=""
                          width={32}
                          height={48}
                          className="h-12 w-8 rounded-md object-cover"
                        />
                      )}
                      <Link
                        href={movie ? `/movie/${movie.slug}` : '#'}
                        className="text-sm font-semibold text-white transition hover:text-accent"
                      >
                        {movie?.nameZh || `影片 #${movieId}`}
                      </Link>
                      <span className="ml-auto text-[11px] text-gray-500">{list.length} 場</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((s) => (
                        <a
                          key={s.id}
                          href={s.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          title={`${s.houseName} $${s.price ?? '?'}${s.seats != null ? ` · 餘 ${s.seats}` : ''}`}
                          className="rounded-xl border border-white/8 bg-white/4 px-2.5 py-1 text-center transition hover:border-accent/60 hover:bg-accent/12"
                        >
                          <span className="text-sm font-bold text-white">
                            {formatTime(s.startAt)}
                          </span>
                          <span className="ml-2 text-[10px] text-gray-400">
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
