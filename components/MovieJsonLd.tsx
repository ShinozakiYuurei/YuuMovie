import type { Movie } from '@/lib/types';

/** 详情页资料卡算出的额外结构化字段（评分/类型），由页面传入 */
export interface JsonLdExtra {
  aggregateRating?: Record<string, unknown>;
  genre?: string[];
}

/** 影片详情页 JSON-LD 结构化数据 */
export function MovieJsonLd({ movie, extra }: { movie: Movie; extra?: JsonLdExtra }) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.nameZh,
    alternateName: movie.nameEn || undefined,
    image: movie.poster || undefined,
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
