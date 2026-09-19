import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getGroupBySlug,
  getMovieGroups,
  getShowRowsForGroup,
  getFacets,
  toCompact,
} from '@/lib/data';
import { buildIntro } from '@/lib/intro';
import { MovieJsonLd } from '@/components/MovieJsonLd';
import { MovieIntro } from '@/components/MovieIntro';
import { ShowtimeExplorer } from '@/components/ShowtimeExplorer';
import { formatDuration } from '@/lib/format';

// 静态导出：预先列出所有电影 slug。
// 只导出「组」的代表 slug（每个版本自己的 slug 由组内跳转，不需要单独页面）。
export function generateStaticParams() {
  const slugs = new Set<string>();
  for (const g of getMovieGroups()) slugs.add(g.slug);
  return [...slugs].map((slug) => ({ slug }));
}

export const dynamicParams = false;

/**
 * SEO 元信息
 *
 * 用 buildIntro 而不是直接读 primary：页面标题与描述要显示的是
 * 「聚合 + 中文优先」后的字段（级别/片长/评分），
 * 与用户实际看到的内容保持一致，否则搜索摘要会和页面对不上。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const group = getGroupBySlug(slug);
  if (!group) return { title: '找不到電影' };

  const a = buildIntro(group);
  // ★ SEO 摘要只用 IMDb：Google 对 IMDb 评分有识别，豆瓣分对它无意义。
  const rated = a.ratings.find((r) => r.source === 'imdb' && r.value != null);
  const bits = [
    a.openingDate ? `${a.openingDate} 上映` : null,
    a.duration ? `片長 ${a.duration} 分鐘` : null,
    a.category ? `級別 ${a.category}` : null,
    rated ? `${rated.label} ${rated.value!.toFixed(1)} 分` : null,
  ].filter(Boolean);

  return {
    title: `${a.title}｜場次及購票`,
    description: `${a.title}${a.subtitle ? `（${a.subtitle}）` : ''}。${bits.join('，')}。查看全港戲院場次、票價及官方購票連結。`,
    openGraph: {
      title: a.title,
      description: a.summary?.slice(0, 150),
      images: group.displayPoster ? [group.displayPoster] : undefined,
    },
    alternates: { canonical: `/movie/${group.slug}` },
  };
}

export default async function MoviePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const group = getGroupBySlug(slug);
  if (!group) notFound();

  const a = buildIntro(group);

  // ★ 场次展平 + 筛选候选项
  //
  // 原先按「版本 → 日期 → 影院」三层嵌套服务端渲染，
  // 热门片 HTML 达 746KB，且无法交互式筛选（静态导出无服务端可回请求）。
  // 展平为 ShowRow[] 后交给客户端组件实时筛选/排序（见 ShowtimeExplorer）。
  const rows = getShowRowsForGroup(group);
  const facets = getFacets(rows);
  const totalShows = rows.length;
  // 紧凑字典化：单行 619 → 114 字节（详见 lib/data.ts 的 CompactRows 注释）
  const compact = toCompact(rows);

  return (
    <article>
      <MovieJsonLd
        movie={group.primary}
        image={group.displayPoster}
        extra={{
          // 外部评分：只有拿到分数才写进结构化数据，
          // aggregateRating 缺数时宁可省略（写 0 会误导搜索摘要）。
          aggregateRating: (() => {
            const r = a.ratings.find((x) => x.source === 'imdb' && x.value != null);
            if (!r) return undefined;
            return {
              '@type': 'AggregateRating' as const,
              ratingValue: r.value,
              bestRating: 10,
              worstRating: 0,
              ratingCount: r.votes ?? undefined,
            };
          })(),
          genre: a.genres.length ? a.genres : undefined,
        }}
      />

      <nav className="mb-4 text-xs text-gray-500">
        <Link href="/" className="hover:text-white">
          現正上映
        </Link>
        <span className="mx-1">/</span>
        <span className="text-gray-400">{a.title}</span>
      </nav>

      <MovieIntro group={group} />

      {/*
       * 場次：多維篩選 + 多鍵排序 + 餘座顏色標記
       *
       * scroll-mt：锚点跳转时给顶栏留出空间。
       *   ★ 2026-09-19 改为引用变量：原先写死 scroll-mt-20（80px），
       *     而顶栏实际高度是 56px —— 两者无关联，改任一边都会错位。
       *     现用 calc(var(--hkm-header-h) + 1rem)：顶栏高度 + 1rem 呼吸间距。
       *     calc 写在内联 style 里而不是 Tailwind 类，因为 Tailwind 的
       *     scroll-mt-* 不支持 CSS 变量运算。
       */}
      {totalShows > 0 && (
        <section
          id="versions"
          className="mt-8"
          style={{ scrollMarginTop: 'calc(var(--hkm-header-h) + 1rem)' }}
        >
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold tracking-tight">場次及購票</h2>
            <span className="hkm-chip">
              共 {totalShows} 場
            </span>
            {a.duration && <span className="hkm-chip">片長 {formatDuration(a.duration)}</span>}
          </div>

          <ShowtimeExplorer compact={compact} facets={facets} />

          <p className="mt-3 text-[11px] text-gray-600">
            點擊場次將前往院線官方購票頁面（另開新視窗）。場次及票價以院線官方公佈為準。
          </p>
        </section>
      )}
    </article>
  );
}
