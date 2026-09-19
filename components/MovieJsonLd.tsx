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
}) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.nameZh,
    alternateName: movie.nameEn || undefined,
    image: image || movie.poster || undefined,
    duration: movie.duration ? `PT${movie.duration}M` : undefined,
    contentRating: movie.category || undefined,
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
