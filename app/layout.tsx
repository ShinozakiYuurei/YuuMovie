import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getMeta, SOURCE_LABEL } from '@/lib/data';
import type { Source } from '@/lib/types';
import { NavLinks } from '@/components/NavLinks';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Inter, Noto_Sans_HK } from 'next/font/google';
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-inter',
});
const notoSansHK = Noto_Sans_HK({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-noto-sans-hk',
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/**
 * 主題啟動腳本（必須內聯、必須阻塞）
 *
 * ===== 為什麼不能寫成元件或外部檔 =====
 *
 * 它必須在**首次繪製之前**跑完，否則用戶會先看到一帧錯誤的主題：
 *   頁面已按暗色繪製 → 腳本讀到用戶選的是淺色 → 整頁刷白。
 * 那一下白閃（FOUC）比「不做主題切換」更難看。
 *
 * 而 React 元件（即使是 'use client'）都是在 hydrate 之後才執行，
 * 那個時候首帧早就畫完了。外部 <script src> 預設 async，同樣不保證時序。
 * 只有**內聯的同步腳本**能保証「解析到這裡就已經執行完」。
 * 這也是 next-themes 等庫的標準做法（它們也是內聯一段 script）。
 *
 * ===== 為什麼自己寫而不裝 next-themes =====
 *
 * 本站只需要「兩態 + 記住選擇」這一點功能。next-themes 會帶來
 * 一個 context Provider、一個 hook 與它的打包體積（含對三態、
 * forcedTheme、多標籤頁同步的支援）—— 而這些在本站都用不上。
 * 這段腳本 12 行，無依賴，靜態導出下也不增加任何客戶端 JS。
 *
 * ===== 為什麼用 try/catch 包住 localStorage =====
 *
 * Safari 隱私模式 / 部分企業策略下訪問 localStorage 會直接**拋錯**，
 * 而不是返回 null。不包住的話整個腳本中斷，data-theme 永遠不會被設置。
 * 那時雖然還有 CSS 的 prefers-color-scheme 兜底，但從此無法手動切換。
 *
 * ===== 預設跟隨系統 =====
 *
 * 用戶 2026-09-25 選擇：「首次訪問跟隨系統 prefers-color-scheme，
 * 之後記住手動選擇」。所以只有 localStorage 裡**沒有**值時才讀系統偏好；
 * 一旦手動切過，系統再怎麼變也不接管（那正是「記住選擇」的含义）。
 */
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('hkm-theme');
if(t!=='light'&&t!=='dark'){
t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
}
document.documentElement.dataset.theme=t;
if(t==='dark')document.documentElement.classList.add('dark');
}catch(e){}})();`;

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
    <html
      lang="zh-HK"
      className={cn('font-sans', inter.variable, notoSansHK.variable)}
      suppressHydrationWarning
    >
      <head>
        {/*
         * 主題啟動腳本：必須是 <head> 裡第一件事，且不帶 defer / async。
         * 放在 <head> 而不是 <body> 開頭：<body> 開頭已經要等
         * <head> 全部解析完（包括 CSS 鏈接），那時樣式已可應用，
         * 但瀏覽器可能已開始繪製 —— 早一點終究更穩。
         *
         * 內容與理由見上方 THEME_SCRIPT 的註釋。
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/*
         * 行動端瀏覽器的網址列／狀態列顏色
         * ★ 只給一份（深色），淺色由 ThemeToggle.applyTheme() 改寫。
         *   為什麼不只靠 JS 寫：首次載入的網址列顏色在腳本跑之前就定了，
         *   不寫進 HTML 會先閃一下瀏覽器預設色。
         */}
        <meta name="theme-color" content="#111113" />
      </head>
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
          {/*
           * ★ 手机上必须 nowrap（2026-09-25 踩到）
           *
           *   加入主题切换钮后，390px 宽的屏幕上这一行放不下：
           *   图标 → 三个导航项 → 切换钮。默认 flex-wrap:wrap 会把
           *   导航挤到第二行，导航自身高度从 32px 涨到 52px ——
           *   而顶栏高度是**写死的 56px**（var(--hkm-header-h)），
           *   于是内容被压住、又没地方溢出，看上去就是挤成一团。
           *
           *   实测（390px 视口）：
           *     改造前 nav 高 32px，改造后 52px（换行）
           *
           *   修法不是加高顶栏（顶栏高度是「单一事实源」，页面里多处
           *   依赖它做锚点偏移），而是让这一行**不换行**：
           *     · gap-6 → gap-2 sm:gap-6（手机收紧间距）
           *     · min-w-0 允许子项收缩而不是被挤下去
           *     · 导航项在手机上缩到 text-xs、px-2（见 NavLinks.tsx）
           *   这样 390px 下 logo + 三个导航项 + 切换钮刚好排得下。
           */}
          <div className="mx-auto flex h-full max-w-6xl flex-nowrap items-center gap-2 px-4 sm:gap-6">
            <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
              Yuu<span className="text-accent">Movie</span>
            </Link>
            {/*
             * 主导航：文案与落点见 components/NavLinks.tsx
             * ★ 「現正上映」指向 /showing（全部上映中列表），不是首页 /。
             *   首页是只有 8 张海报的导流页，把导航项指过去等于让用户
             *   多点一次才能看到完整清单。
             */}
            <NavLinks />
            {/*
             * 明／暗主題切換
             *
             * ★ 放在 NavLinks **之後**、ml-auto 推到最右：
             *   它不屬於「現正上映 / 即將上映 / 戲院」這一組頁面歸屬，
             *   跟在導航項後面會被當成第四個分頁；推到最右端才看得出
             *   它是「工具」而不是「目的地」。
             *
             * ★ ml-auto 不能寫在導航自己身上：
             *   那樣導航會被推成「右對齊」，中間空出一大塊，
             *   而 logo 與導航之間本來應該是緊湊的一組。
             */}
            <div className="ml-auto shrink-0">
              <ThemeToggle />
            </div>
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
