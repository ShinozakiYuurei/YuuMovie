import type { MetadataRoute } from 'next';
import {
  getAllCinemas,
  getShowingGroups,
  getUpcomingGroups,
} from '@/lib/data';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// sitemap 每次请求重新生成（数据量小，开销可忽略）
// 静态导出：要求显式声明 force-static（不能只用 revalidate）
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/upcoming`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/cinema`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    // 只输出「电影组」的 slug（primary）。
    // getAllMovies() 含同片不同版本/院线的重复条目，它们的 slug 不是组的入口，
    // 直接放进来会让 sitemap 里出现大量 404。
    ...[...getShowingGroups(), ...getUpcomingGroups()]
      .filter((g, i, arr) => arr.findIndex((x) => x.slug === g.slug) === i)
      .map((g) => ({
        url: `${SITE}/movie/${g.slug}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ...getAllCinemas().map((c) => ({
      url: `${SITE}/cinema/${c.id}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
