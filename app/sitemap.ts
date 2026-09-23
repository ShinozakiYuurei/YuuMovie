import type { MetadataRoute } from 'next';
import {
  getAllCinemas,
  getMovieGroups,
} from '@/lib/data';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// sitemap 每次请求重新生成（数据量小，开销可忽略）
// 静态导出：要求显式声明 force-static（不能只用 revalidate）
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/showing`, lastModified: now, changeFrequency: 'daily', priority: 0.95 },
    { url: `${SITE}/upcoming`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/cinema`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    // 與 /movie/[slug] 的 generateStaticParams 同源：所有已生成的電影組詳情頁。
    // getShowingGroups() 會剔除暫無未開映場次的電影，不能拿它作 sitemap，
    // 否則有效的靜態詳情頁會漏收錄；getAllMovies() 則含非入口的版本 slug。
    ...[...new Set(getMovieGroups().map((g) => g.slug))]
      .map((slug) => ({
        url: `${SITE}/movie/${slug}`,
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
