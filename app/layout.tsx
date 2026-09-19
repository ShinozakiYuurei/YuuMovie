import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getMeta, SOURCE_LABEL } from '@/lib/data';
import type { Source } from '@/lib/types';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: '香港電影場次 · 上映及即將上映',
    template: '%s · 香港電影場次',
  },
  description:
    '香港上映及即將上映電影資訊，整合百老匯、MCL 等院線場次、票價及官方購票連結。',
  openGraph: {
    type: 'website',
    locale: 'zh_HK',
    siteName: '香港電影場次',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  const updated = meta.lastUpdated.slice(0, 16).replace('T', ' ');
  return (
    <html lang="zh-HK" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen">
        {/* 环境光层：固定定位，不参与滚动 */}
        <div className="hkm-aurora" aria-hidden />

        {/* 顶栏：真毛玻璃（固定元素，模糊开销可控） */}
        <header className="hkm-glass-bar sticky top-0 z-50">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              香港電影<span className="text-accent">場次</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link
                href="/"
                className="rounded-full px-3 py-1.5 text-gray-300 transition hover:bg-white/8 hover:text-white"
              >
                現正上映
              </Link>
              <Link
                href="/upcoming"
                className="rounded-full px-3 py-1.5 text-gray-300 transition hover:bg-white/8 hover:text-white"
              >
                即將上映
              </Link>
              <Link
                href="/cinema"
                className="rounded-full px-3 py-1.5 text-gray-300 transition hover:bg-white/8 hover:text-white"
              >
                戲院
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mt-16 border-t border-white/6 px-4 py-8 text-xs leading-relaxed text-gray-500">
          <div className="mx-auto max-w-6xl space-y-2">
            <p>
              本網站僅提供電影資訊聚合服務，所有場次及票價資料來自各院線官方網站，僅供參考。
              實際放映時間及票價以院線官方公佈為準，購票請前往院線官方網站。
            </p>
            <p>本站與各院線無隸屬關係。如權利人認為內容不當，請聯絡我們移除。</p>
            <p className="pt-2 text-gray-600">
              資料來源：
              {meta.sources
                .map((s) => SOURCE_LABEL[s as Source] ?? s)
                .join('、')}{' '}
              · 最後更新 {updated} · 共 {meta.counts.movies} 部電影 /{' '}
              {meta.counts.cinemas} 間戲院 / {meta.counts.shows} 場次
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
