import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  getGroupBySlug,
  getMovieGroups,
  getShowsByMovie,
  getShowsByVersion,
  getCinemaById,
  formatLabel,
  SOURCE_LABEL,
} from '@/lib/data';
import type { Show, Source } from '@/lib/types';
import { MovieJsonLd } from '@/components/MovieJsonLd';
import { formatDate, formatDuration, formatTime, relativeDay } from '@/lib/format';

// 静态导出：预先列出所有电影 slug。
// 只导出「组」的代表 slug（每个版本自己的 slug 由组内跳转，不需要单独页面）。
export function generateStaticParams() {
  const slugs = new Set<string>();
  for (const g of getMovieGroups()) slugs.add(g.slug);
  return [...slugs].map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const group = getGroupBySlug(slug);
  if (!group) return { title: '找不到電影' };

  const m = group.primary;
  const bits = [
    m.openingDate ? `${m.openingDate} 上映` : null,
    m.duration ? `片長 ${m.duration} 分鐘` : null,
    m.category ? `級別 ${m.category}` : null,
    group.versions.length > 1 ? `${group.versions.length} 個版本` : null,
  ].filter(Boolean);

  return {
    title: `${group.displayName}｜場次及購票`,
    description: `${group.displayName}${m.nameEn ? `（${m.nameEn}）` : ''}。${bits.join('，')}。查看全港戲院場次、票價及官方購票連結。`,
    openGraph: {
      title: group.displayName,
      description: m.description?.slice(0, 150),
      images: m.poster ? [m.poster] : undefined,
    },
    alternates: { canonical: `/movie/${group.slug}` },
  };
}

/** 一个版本区块 */
function VersionSection({
  sources,
  shows,
  versionLabel,
  isBase,
}: {
  sources: Source[];
  shows: Show[];
  versionLabel: string;
  isBase: boolean;
}) {
  // 按日期 → 影院 两级分组
  //
  // 为什么要按日期分组：热门片单页可超过 200 场（如《生化危機》235 場），
  // 全部铺开会让详情页 HTML 达到 747KB，在 2C2G 机器上首屏很慢。
  // 按日期折叠后，默认只渲染最近一天的场次，体积与渲染成本大幅下降；
  // 用原生 <details> 折叠，不需要任何客户端 JS。
  const byDate = new Map<string, Map<string, Show[]>>();
  for (const s of shows) {
    const d = s.date || '';
    if (!byDate.has(d)) byDate.set(d, new Map());
    const byCinema0 = byDate.get(d)!;
    const cid = s.cinemaId || '';
    if (!byCinema0.has(cid)) byCinema0.set(cid, []);
    byCinema0.get(cid)!.push(s);
  }

  const dates = [...byDate.keys()].sort();
  const prices = shows.map((s) => s.price).filter((p) => p != null) as number[];
  const minPrice = prices.length ? Math.min(...prices) : null;

  // 影院名缓存：避免同一影院在多日期下重复查表
  const cinemaCache = new Map<string, ReturnType<typeof getCinemaById>>();
  const cinemaOf = (id: string) => {
    if (!cinemaCache.has(id)) cinemaCache.set(id, getCinemaById(id));
    return cinemaCache.get(id);
  };

  return (
    <section className="hkm-panel overflow-hidden rounded-2xl">
      {/* 版本标题 */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/7 px-4 py-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
            isBase
              ? 'border border-white/12 bg-white/8 text-gray-200'
              : 'bg-gradient-to-r from-[#8b7cff] to-[#6d5cf0] text-white shadow-[0_6px_18px_-8px_rgba(124,108,255,0.9)]'
          }`}
        >
          {versionLabel}
        </span>
        <span className="text-xs text-gray-400">
          {shows.length} 場 · {dates.length} 個放映日
          {minPrice != null ? ` · $${minPrice} 起` : ''}
        </span>
        <span className="ml-auto text-[10px] text-gray-500">
          {sources.map((s) => SOURCE_LABEL[s]).join(" + ")}
        </span>
      </header>

      {/* 场次：按日期 → 影院。默认展开最近一天，其余折叠（原生 details，零 JS） */}
      <div className="divide-y divide-white/6">
        {dates.map((date, di) => {
          const byCinema = byDate.get(date)!;
          const dayShows = [...byCinema.values()].flat();
          const open = di === 0;

          return (
            <details key={date} open={open} className="px-4 py-3">
              <summary className="mb-2 flex cursor-pointer list-none items-baseline gap-2">
                <h4 className="text-sm font-semibold text-white">{formatDate(date)}</h4>
                <span className="text-[11px] text-gray-500">{dayShows.length} 場</span>
                <span className="ml-auto text-[11px] text-gray-600">{open ? '收起 ▲' : '展開 ▼'}</span>
              </summary>

              {[...byCinema.entries()]
                .map(([cinemaId, list]) => ({ cinemaId, cinema: cinemaOf(cinemaId), shows: list }))
                .sort((a, b) =>
                  (a.cinema?.nameZh || '').localeCompare(b.cinema?.nameZh || '')
                )
                .map(({ cinemaId, cinema, shows: list }) => (
                  <div key={cinemaId} className="mb-3">
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <h5 className="text-xs font-semibold text-gray-300">
                        {cinema?.nameZh || `戲院 #${cinemaId}`}
                      </h5>
                      {cinema?.address && (
                        <span className="hidden truncate text-[10px] text-gray-600 sm:inline">
                          {cinema.address}
                        </span>
                      )}
                      {cinema?.mapUrl && (
                        <a
                          href={cinema.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto shrink-0 text-[10px] text-gray-600 hover:text-white"
                        >
                          地圖 ↗
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {list.map((s) => (
                        <a
                          key={s.id}
                          href={s.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          title={`${formatDate(s.date)} ${formatTime(s.startAt)} ${s.houseName} $${s.price ?? '?'}`}
                          className="group flex flex-col rounded-xl border border-white/8 bg-white/4 px-2.5 py-1.5 text-center transition hover:border-accent/60 hover:bg-accent/12"
                        >
                          <span className="text-sm font-bold text-white">
                            {formatTime(s.startAt)}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {s.houseName || '—'} · ${s.price ?? '—'}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
            </details>
          );
        })}
      </div>
    </section>
  );
}

export default async function MoviePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const group = getGroupBySlug(slug);
  if (!group) notFound();

  const m = group.primary;
  const allShows = group.versions.flatMap((v) => getShowsByVersion(v));
  const totalShows = allShows.length;

  // 版本 → 场次
  const versionSections = group.versions
    .map((v) => {
      const shows = getShowsByVersion(v);
      const label = v.formats.length ? v.formats.map(formatLabel).join(' + ') : '原版';
      return { version: v, shows, label, isBase: v.formats.length === 0 };
    })
    .filter((x) => x.shows.length > 0);


  return (
    <article>
      <MovieJsonLd movie={m} />

      <nav className="mb-4 text-xs text-gray-500">
        <Link href="/" className="hover:text-white">
          現正上映
        </Link>
        <span className="mx-1">/</span>
        <span className="text-gray-400">{group.displayName}</span>
      </nav>

      <header className="flex flex-col gap-6 sm:flex-row">
        <div className="w-40 shrink-0 sm:w-48">
          {m.poster ? (
            <Image
              src={m.poster}
              alt={group.displayName}
              width={192}
              height={288}
              priority
              sizes="(max-width: 640px) 160px, 192px"
              className="w-full rounded-2xl border border-white/10 object-cover shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]"
            />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center rounded-2xl border border-white/10 bg-white/4 text-xs text-gray-500">
              無海報
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">
            {group.displayName}
          </h1>
          {m.nameEn && m.nameEn !== group.displayName && (
            <p className="mt-1.5 text-sm text-gray-400">{m.nameEn}</p>
          )}

          {/* 版本标签总览 */}
          {group.allFormats.length > 0 && (
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {group.allFormats.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-accent/35 bg-accent/12 px-2.5 py-0.5 text-[11px] font-semibold text-accent"
                >
                  {formatLabel(f)}
                </span>
              ))}
            </div>
          )}

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {m.openingDate && (
              <>
                <dt className="text-gray-500">上映日期</dt>
                <dd className="text-gray-200">
                  {m.openingDate}
                  <span className="ml-2 text-xs text-accent">{relativeDay(m.openingDate)}</span>
                </dd>
              </>
            )}
            <dt className="text-gray-500">片長</dt>
            <dd className="text-gray-200">{formatDuration(m.duration)}</dd>
            {m.category && (
              <>
                <dt className="text-gray-500">級別</dt>
                <dd className="text-gray-200">{m.category}</dd>
              </>
            )}
            {m.dialect && (
              <>
                <dt className="text-gray-500">語言</dt>
                <dd className="text-gray-200">
                  {m.dialect}
                  {m.subtitle ? `（${m.subtitle}字幕）` : ''}
                </dd>
              </>
            )}
            {m.genres?.length > 0 && (
              <>
                <dt className="text-gray-500">類型</dt>
                <dd className="text-gray-200">{m.genres.join('、')}</dd>
              </>
            )}
            {m.director && (
              <>
                <dt className="text-gray-500">導演</dt>
                <dd className="text-gray-200">{m.director}</dd>
              </>
            )}
            {m.cast && (
              <>
                <dt className="text-gray-500">演員</dt>
                <dd className="text-gray-200">{m.cast}</dd>
              </>
            )}
            <dt className="text-gray-500">版本</dt>
            <dd className="text-gray-200">
              {group.versions.length} 個
              {group.sources.length > 1 && (
                <span className="ml-2 text-xs text-gray-500">
                  （{group.sources.map((s) => SOURCE_LABEL[s]).join(' + ')}）
                </span>
              )}
            </dd>
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {totalShows > 0 && (
              <a
                href="#versions"
                className="hkm-btn-primary rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                查看 {totalShows} 個場次
              </a>
            )}
            {m.trailer && (
              <a
                href={m.trailer}
                target="_blank"
                rel="noopener noreferrer"
                className="hkm-btn-ghost rounded-full px-5 py-2.5 text-sm"
              >
                ▶ 預告片
              </a>
            )}
            <a
              href={m.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hkm-btn-ghost rounded-full px-5 py-2.5 text-sm"
            >
              院線原始頁面
            </a>
          </div>
        </div>
      </header>

      {/* 場次：按版本分類 */}
      {versionSections.length > 0 && (
        <section id="versions" className="mt-10 scroll-mt-20">
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold tracking-tight">版本及場次</h2>
            <span className="hkm-chip">
              {versionSections.length} 個版本 · 共 {totalShows} 場
            </span>
          </div>

          {/* 版本快速導航 */}
          {versionSections.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {versionSections.map((v, i) => (
                <a
                  key={v.version.key}
                  href={`#v${i}`}
                  className="hkm-btn-ghost rounded-full px-3 py-1 text-[11px]"
                >
                  {v.label}
                  <span className="ml-1 text-gray-500">{v.shows.length}</span>
                </a>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {versionSections.map((v, i) => (
              <div key={v.version.key} id={`v${i}`} className="scroll-mt-20">
                <VersionSection
                  sources={v.version.sources}
                  shows={v.shows}
                  versionLabel={v.label}
                  isBase={v.isBase}
                />
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-gray-600">
            點擊場次將前往院線官方購票頁面（另開新視窗）。場次及票價以院線官方公佈為準。
          </p>
        </section>
      )}

      {m.description && (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold">劇情簡介</h2>
          <div className="prose-custom max-w-3xl text-sm text-gray-300">{m.description}</div>
        </section>
      )}
    </article>
  );
}
