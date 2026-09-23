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
import { MovieShowtimes } from '@/components/MovieShowtimes';
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

  /*
   * 本片屬於哪一類（現正上映 / 即將上映）
   *
   * ★ 2026-09-23 修復：先前這裡的麵包屑**寫死**「現正上映 → /showing」，
   *   於是即將上映的片（用戶回報的《BLUE LOCK 藍色監獄》，開畫日 2026-09-30，
   *   列在 /upcoming）點進來，麵包屑卻寫著現正上映，與來源列表自相矛盾。
   *
   *   現在兩處（麵包屑、頂欄高亮）都只由 group.status 推導，不再硬編碼：
   *   - 麵包屑直接用下面的 crumb
   *   - 頂欄高亮靠 <article data-page-nav>，由 globals.css 的 body:has() 讀取
   *     （詳見該處說明：layout 對所有頁面共用，拿不到本頁狀態，
   *      而本頁也無法把狀態回傳給 layout）
   *
   *   ★ 屬性名叫 data-page-nav（「本頁屬於哪一類」）而不是 data-movie-nav：
   *     戲院詳情頁 /cinema/<id> 有**完全相同**的毛病（頂欄「戲院」從不點亮），
   *     那是同一個機制在管，共用一個屬性名才能一並修好，
   *     也讓 globals.css 只需一組選擇器。
   */
  const crumb =
    group.status === 'upcoming'
      ? ({ nav: 'upcoming', href: '/upcoming', label: '即將上映' } as const)
      : ({ nav: 'showing', href: '/showing', label: '現正上映' } as const);

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
    <article data-page-nav={crumb.nav}>
      <MovieJsonLd
        movie={group.primary}
        image={group.displayPoster}
        /* 英文片名与页面上那行副标题同源（group.displayNameEn）。
         * 不传的话这里读 group.primary.nameEn —— 而 primary 按场次最多选，
         * MCL 条目压根没有英文名，于是页面上显示英文、结构化数据里没有。 */
        alternateName={a.subtitle}
        /* 分级与页面上那枚徽章同源（buildIntro）：否则同一页里
         * 徽章写「IIB」、结构化数据写 emperor 的「8.0」媒体评分。
         * 未定级传 null → 结构化数据里整项省略（TBC 不是有效评级）。 */
        contentRating={a.category}
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

      <nav className="mb-4 text-xs text-fg-dim" data-crumb>
        {/* 麵包屑與頂欄同一落點：都指向本片真正所屬的列表（見上方 crumb）
         *
         * data-crumb：穩定的識別鈎子，供 probe/check-nav-category.mjs 掃產物時
         *   定位這一塊。不用 class 當鈎子 —— class 是會變的樣式細節，
         *   換個 class 就讓守卫靜默失效（或假報「找不到麵包屑」）。
         */}
        <Link href={crumb.href} className="hover:text-fg">
          {crumb.label}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-fg-muted">{a.title}</span>
      </nav>

      <MovieIntro group={group} />

      {/*
       * 場次：多維篩選 + 多鍵排序 + 餘座顏色標記
       *
       * ★ 2026-09-22：整區（含「共 N 場」標題與 section#versions）搬進
       *   components/MovieShowtimes.tsx（客戶端）。
       *
       *   原因：本站是 SSG，HTML 在構建時定稿 —— 原先這裡的 totalShows 與
       *   場次列表都是構建時算的，構建後才開映的場次會一直留在頁面上，
       *   直到下一次定時重建（每 3 小時）。用戶回報的「電影到時間上映後
       *   不剔除場次」正是這個。
       *
       *   現在由該組件用瀏覽器時鐘實時剔除，且標題數字與列表同源
       *   （見該文件關於「為什麼要有這一層」的說明）。
       */}
      {totalShows > 0 && (
        <MovieShowtimes
          compact={compact}
          facets={facets}
          durationText={a.duration ? formatDuration(a.duration) : null}
        />
      )}
    </article>
  );
}
