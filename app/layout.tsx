import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
// ★ 中文字体不走 next/font/local：那会把 5.2MB 的 CJK 可变字体整包输出成
//   一个 woff2 并在每页 preload（实测占首页下载 94%）。改用预切分片：
//   scripts/slice-cjk-font.mjs 按站内用字切成 4 片，带 unicode-range，
//   浏览器只下载本页文字真正用到的片。规则文件：app/fonts/noto-sans-hk.css
import './fonts/noto-sans-hk.css';
import { getMeta, getShowingGroups, getUpcomingGroups, SOURCE_LABEL } from '@/lib/data';
import type { Source } from '@/lib/types';
import { NavLinks } from '@/components/NavLinks';
import { ThemeToggle } from '@/components/ThemeToggle';
import localFont from 'next/font/local';
import { cn } from "@/lib/utils";

const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '100 900',
  variable: '--font-inter',
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
 * 本站使用深色與淡粉色兩種主題並記住手動選擇。同步內聯腳本
 * 可在首次繪製前套用主題，無需額外 Provider、依賴或客戶端包體積。
 *
 * ===== 為什麼用 try/catch 包住 localStorage =====
 *
 * Safari 隱私模式 / 部分企業策略下訪問 localStorage 會直接**拋錯**，
 * 而不是返回 null。不包住的話整個腳本中斷，data-theme 永遠不會被設置。
 * 那時雖然還有 CSS 的 prefers-color-scheme 兜底，但從此無法手動切換。
 *
 * ===== 預設跟隨系統 =====
 *
 * 首次訪問跟隨系統 prefers-color-scheme（淡粉色或深色），之後可在兩種主題間
 * 循環並記住手動選擇。只有 localStorage 裡沒有有效值時才讀系統偏好。
 */
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('hkm-theme');
if(t==='light')t='pink';
if(t!=='dark'&&t!=='pink'){
t=window.matchMedia('(prefers-color-scheme: light)').matches?'pink':'dark';
}
document.documentElement.dataset.theme=t;
if(t==='dark')document.documentElement.classList.add('dark');
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',t==='dark'?'#111113':'#fff0f6');
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
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  const movieCount = getShowingGroups().length + getUpcomingGroups().length;
  const updated = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(meta.lastUpdated));
  const year = new Date().getFullYear();
  return (
    <html
      lang="zh-HK"
      className={cn('font-sans', inter.variable)}
      suppressHydrationWarning
    >
      <head>
        {/*
         * 主題啟動腳本：必須在 <head> 中盡早同步執行，且不帶 defer / async。
         * 前面的 theme-color meta 會由它立刻更新，避免網址列顏色不匹配。
         * 放在 <head> 而不是 <body> 開頭：<body> 開頭已經要等
         * <head> 全部解析完（包括 CSS 鏈接），那時樣式已可應用，
         * 但瀏覽器可能已開始繪製 —— 早一點終究更穩。
         *
         * 內容與理由見上方 THEME_SCRIPT 的註釋。
         */}
        {/* 行動端瀏覽器網址列顏色；緊接著由同步啟動腳本按主題更新。 */}
        <meta name="theme-color" content="#111113" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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

        {/*
         * 页脚（2026-09-28 按用户给的参考样式改版）
         *
         * 参考样式的三段结构照搬：
         *   1) 三列：品牌 + 说明（左，最宽）｜ 瀏覽（中）｜ 資料（右）
         *   2) 一条发丝分隔线
         *   3) 底栏：左版权，右「服务状态圆点 + 免责说明」
         *
         * ★ 为什么「資料」列不做成链接：
         *   站内只有 /showing、/upcoming、/cinema 三个落地页（见 NavLinks.tsx），
         *   資料 / 免責没有独立页面。硬做成 <a> 会得到点了没反应的假链接，
         *   不如老实做成纯文本行 —— 视觉上与链接同款，但不骗人。
         *
         * ★ 为什么保留 border-t 而不加底色：
         *   参考图的页脚底色比上方略深，但本站明暗两套主题的「更深/更浅」
         *   方向相反（暗色 veil 是变亮、明色 veil 是变暗），用同一个 veil
         *   会有一套主题走向不对。发丝线足以分隔，也更贴合本站克制的观感。
         *
         * ★ 版权年份用构建期时间：
         *   本站是静态导出（next.config.ts），页面每 2–6 小时随抓取重建，
         *   年份在构建时定格即可，不需要为此引入客户端 JS。
         */}
        <footer className="mt-16 border-t border-hairline">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
            {/*
             * 三列栅格
             * ★ 左列在手机上独占一行（sm:col-span-2）：说明文字是成段的，
             *   与导航项并排会被挤成窄条，读起来更费劲。
             * ★ lg 下 1.7fr / 1fr / 1fr：与参考图一致，左列明显更宽。
             */}
            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.7fr_1fr_1fr] lg:gap-8">
              {/* 列 1：品牌 + 免责说明 */}
              <div className="max-w-md sm:col-span-2 lg:col-span-1">
                <Link href="/" className="text-lg font-bold tracking-tight">
                  Yuu<span className="text-accent">Movie</span>
                </Link>
                <p className="mt-4 text-xs leading-relaxed text-fg-dim">
                  本網站僅提供電影資訊聚合服務，所有場次及票價資料來自各院線官方網站，僅供參考。
                  實際放映時間及票價以院線官方公佈為準，購票請前往院線官方網站。
                </p>
                <p className="mt-3 text-xs leading-relaxed text-fg-dim">
                  本站與各院線無隸屬關係。如權利人認為內容不當，請聯絡我們移除。
                </p>
              </div>

              {/* 列 2：瀏覽（站内三个落地页，与顶栏一致） */}
              <nav aria-label="頁腳導覽">
                <h2 className="text-sm font-semibold text-fg">瀏覽</h2>
                <ul className="mt-4 space-y-2.5 text-xs">
                  {[
                    { href: '/showing', label: '現正上映' },
                    { href: '/upcoming', label: '即將上映' },
                    { href: '/cinema', label: '戲院' },
                  ].map(({ href, label }) => (
                    <li key={href}>
                      <Link href={href} className="text-fg-muted transition hover:text-fg">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* 列 3：資料（纯文本，不做假链接，理由见上方注释） */}
              <div>
                <h2 className="text-sm font-semibold text-fg">資料</h2>
                <ul className="mt-4 space-y-2.5 text-xs text-fg-muted">
                  {/*
                   * 每個來源單獨包一層 whitespace-nowrap：
                   * 中文沒有「詞」的概念，瀏覽器會在任何兩字之間斷行，
                   * 於是在窄欄裡「星達」會被拆成「星」/「達」兩行。
                   * 分隔符「、」跟在名稱**同一個** span 內，避免行首只剩一個頓號。
                   */}
                  <li>
                    資料來源：
                    {meta.sources.map((s, i) => (
                      <span key={s} className="whitespace-nowrap">
                        {SOURCE_LABEL[s as Source] ?? s}
                        {i < meta.sources.length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </li>
                  <li>
                    收錄：{movieCount} 部電影 · {meta.counts.cinemas} 間戲院 ·{' '}
                    {meta.counts.shows} 場次
                  </li>
                  <li>最後更新：{updated}</li>
                </ul>
              </div>
            </div>

            {/*
             * 底栏
             * ★ 左侧版权 + 右侧「三个状态点 + 免责说明」，与参考图同构。
             * ★ 状态点用 bg-status-ok（见 globals.css 的 --hkm-status-ok）：
             *   它是**服务状态**指示（场次/票价/链接三条数据链），不是余座档位，
             *   故不复用 --hkm-seat-plenty-dot。
             * ★ 最后一句不带圆点：它只是说明，不是状态。
             */}
            <div className="mt-10 flex flex-col gap-4 border-t border-hairline pt-6 text-xs text-fg-dim sm:mt-12 sm:flex-row sm:items-center sm:justify-between">
              <p>© {year} YuuMovie</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {['場次同步', '票價', '官方購票連結'].map((label) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-ok"
                      aria-hidden
                    />
                    {label}
                  </span>
                ))}
                <span>場次與票價以院線官方為準</span>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
