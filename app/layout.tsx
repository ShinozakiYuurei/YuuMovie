import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getMeta, SOURCE_LABEL } from '@/lib/data';
import type { Source } from '@/lib/types';
import { NavLinks } from '@/components/NavLinks';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'YuuMovie · 上映及即將上映',
    template: '%s · YuuMovie',
  },
  description:
    '香港上映及即將上映電影資訊，整合百老匯、MCL 等院線場次、票價及官方購票連結。',
  openGraph: {
    type: 'website',
    locale: 'zh_HK',
    siteName: 'YuuMovie',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  const updated = meta.lastUpdated.slice(0, 16).replace('T', ' ');
  return (
    <html lang="zh-HK" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen">
        {/* 环境光层：固定定位，不参与滚动。
         *
         * ★ 2026-09-23 从「两个伪元素」改为「三个真实元素」：
         *   卡片改成液态玻璃后，身后必须有**可折射的光源**，
         *   否则 blur() 采样到的是一片纯色，玻璃看上去就是普通色块。
         *   三团光分别服务：顶栏（a1）、右侧补光（a2）、
         *   第二屏以后的卡片（a3）。伪元素只有两个名额，故改用真实元素。 */}
        <div className="hkm-aurora" aria-hidden>
          <i className="a1" />
          <i className="a2" />
          <i className="a3" />
        </div>

        {/* 顶栏：真毛玻璃（固定元素，模糊开销可控）
         *
         * ★ 2026-09-19 改为固定高度：
         *   原先用 py-3 撑出高度，实际值随字号/行高变动，页面里其他
         *   「需要避开顶栏」的地方（内容区 padding-top、锚点 scroll-margin）
         *   只能拍一个数字，对不上就出现内容顶进顶栏下面的叠压。
         *   现统一为 var(--hkm-header-h)（定义在 globals.css），
         *   内层用 h-full + items-center 垂直居中，不再靠 padding 撑。
         */}
        <header
          className="hkm-glass-bar sticky top-0 z-50 h-[var(--hkm-header-h)]"
        >
          <div className="mx-auto flex h-full max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Yuu<span className="text-accent">Movie</span>
            </Link>
            {/*
             * 主导航：文案与落点见 components/NavLinks.tsx
             * ★ 「現正上映」指向 /showing（全部上映中列表），不是首页 /。
             *   首页是只有 8 张海报的导流页，把导航项指过去等于让用户
             *   多点一次才能看到完整清单。
             */}
            <NavLinks />
          </div>
        </header>

        {/*
         * 内容区：padding-top 与顶栏高度对齐。
         *
         * ★ 为什么不需要「顶栏高度 + 额外间距」：顶栏是 sticky 而非 fixed，
         *   它本来就占据文档流的第一屏位置（不像 fixed 会脱离文档流），
         *   所以内容区的 py-6 是它与顶栏之间的正常视觉间距，
         *   不需要再把顶栏高度加进去（加了反而多出一截空白）。
         *   真正需要对齐顶栏的是**锚点跳转**（见 scroll-mt 相关注释）。
         */}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mt-16 border-t border-hairline px-4 py-8 text-xs leading-relaxed text-fg-dim">
          <div className="mx-auto max-w-6xl space-y-2">
            <p>
              本網站僅提供電影資訊聚合服務，所有場次及票價資料來自各院線官方網站，僅供參考。
              實際放映時間及票價以院線官方公佈為準，購票請前往院線官方網站。
            </p>
            <p>本站與各院線無隸屬關係。如權利人認為內容不當，請聯絡我們移除。</p>
            <p className="pt-2 text-fg-dim">
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
