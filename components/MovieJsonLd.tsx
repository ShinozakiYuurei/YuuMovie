import type { Movie } from '@/lib/types';

/** 影片详情页 JSON-LD 结构化数据 */
export function MovieJsonLd({ movie }: { movie: Movie }) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.nameZh,
    alternateName: movie.nameEn || undefined,
    image: movie.poster || undefined,
    duration: movie.duration ? `PT${movie.duration}M` : undefined,
    contentRating: movie.category || undefined,
    description: movie.description ? movie.description.slice(0, 300) : undefined,
    genre: movie.genres?.length ? movie.genres : undefined,
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
