import type { Movie } from '@/lib/types';

/** 详情页资料卡算出的额外结构化字段（评分/类型），由页面传入 */
export interface JsonLdExtra {
  aggregateRating?: Record<string, unknown>;
  genre?: string[];
}

/** 影片详情页 JSON-LD 结构化数据 */
export function MovieJsonLd({
  movie,
  extra,
  image,
  contentRating,
}: {
  movie: Movie;
  extra?: JsonLdExtra;
  /**
   * 覆盖结构化数据的配图。
   *
   * ★ 为什么需要：movie 传的是 group.primary，而 primary 可能来自
   *   MCL（海报仅 290×390），组内其他院线有 800×1125 的同一张图。
   *   搜索摘要里的配图没有「模糊也无所谓」这回事，这里用组内最清晰的那张
   *   （group.displayPoster）。不传则退回 movie.poster，行为不变。
   */
  image?: string | null;
  /**
   * 覆盖结构化数据的分级（详情页传 buildIntro 的结果，null = 未定级）。
   *
   * ★ 2026-09-25：原来这里读 movie.category —— 那是 group.primary 这一条的
   *   原始值，**没经过「只认港英分级」与跨源聚合**，于是同一部片
   *   页面徽章写 IIB、JSON-LD 里却写 8.0（emperor 的媒体评分）。
   *   实测量到 40 个页面存在这种页内矛盾（详情页 191 页里 21%）。
   *   现在由页面显式传 buildIntro 算出的值，页面显示什么、结构化数据就写什么。
   *
   * ★ 传 null（未定级）时**整项省略**，不写「TBC」：
   *   contentRating 在 schema.org 里要的是一个评级值，而 TBC 不是评级 ——
   *   写进去等于给搜索引擎一个无效值。页面上的徽章照旧显示 TBC（那是给人看的
   *   「送审未评级」结论，见 components/MovieIntro.tsx）。
   *   也**不能**退回 movie.category：那正是上面那个 bug。
   */
  contentRating?: string | null;
}) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.nameZh,
    alternateName: movie.nameEn || undefined,
    image: image || movie.poster || undefined,
    duration: movie.duration ? `PT${movie.duration}M` : undefined,
    contentRating: contentRating || undefined,
    description: movie.description ? movie.description.slice(0, 300) : undefined,
    genre: extra?.genre ?? (movie.genres?.length ? movie.genres : undefined),
    ...(extra?.aggregateRating ? { aggregateRating: extra.aggregateRating } : {}),
    director: movie.director
      ? movie.director.split(/[,、]/).map((n) => ({ '@type': 'Person', name: n.trim() }))
      : undefined,
    actor: movie.cast
      ? movie.cast
          .replace(/^[^:：]*[:：]/, '')
          .split(/[,、]/)
          .slice(0, 10)
          .map((n) => ({ '@type': 'Person', name: n.trim() }))
          .filter((p) => p.name)
      : undefined,
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
