import type { MetadataRoute } from 'next';

// 静态导出：route handler 必须显式声明 force-static
export const dynamic = 'force-static';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
