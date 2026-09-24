'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 顶栏主导航
 *
 * 为什么单独抽成客户端组件：需要 usePathname 标记当前分页。
 * 抽出来的代价只是这一小段 JS，layout 仍是服务端组件（footer / 环境光
 * 那些依赖 data 的部分不受影响）。
 *
 * ★ 2026-09-22 修正「現正上映」的落点：
 *   原先它 href="/"，而 / 是首页（只有 8 张海报的导流页），
 *   不是「全部上映中」列表 —— 用户在顶栏点「現正上映」却回到首页，
 *   真正想看的 /showing 只能从首页那张卡片条再点一次。
 *   现在顶栏与卡片条都指向 /showing，语义一致。
 *
 * ★ 2026-09-23 修正詳情頁的高亮歸屬（用戶回報）
 *
 *   用戶原話：「即将上映的电影，点进去子目录显示在現正上映；
 *             而且顶上的色块也标在现正上映上」。
 *
 *   例：《BLUE LOCK 藍色監獄》（開畫日 2026-09-30，status='upcoming'，
 *   列在 /upcoming），點進詳情頁後麵包屑與頂欄色塊卻都標成「現正上映」。
 *
 *   根因：詳情頁的路由是 /movie/<slug>，**同一個前綴裝著兩種歸屬**
 *   （上映中與待映都有詳情頁）。而頂欄在 layout 裡，layout 對所有頁面
 *   共用、拿不到當前子路由的資料；先前那條
 *     href === '/showing' && pathname.startsWith('/movie')
 *   是拿「路徑前綴」硬猜歸屬 —— 於是所有詳情頁一律算作上映中。
 *
 *   修法：把歸屬交給**真正知道答案的那一層** —— 詳情頁自己（它手上有
 *   group.status / cinema.id）在 <article data-page-nav="showing|upcoming">
 *   （戲院詳情頁是 <nav data-page-nav="cinema">）上寫下歸屬，
 *   這裡只負責把它讀出來。三個落點因此共用同一個事實來源，不會分叉：
 *     1. 麵包屑            —— 詳情頁自己用 group.status / cinema 推導
 *     2. 頂欄色塊          —— globals.css 用 body:has([data-page-nav=…])
 *     3. 無障礙 aria-current —— 本文件的 useEffect
 *
 *   ★ 屬性名叫 data-page-nav（「本頁屬於哪一類」）而不是 data-movie-nav：
 *     戲院詳情頁 /cinema/<id> 有**完全相同**的毛病（頂欄「戲院」從不點亮，
 *     因為它只認 pathname === '/cinema'）。兩者共用一個機制、一組選擇器，
 *     比分別寫兩套更不容易漏。
 *
 *   為什麼「色塊」走 CSS 而不是 React state：
 *     state 要等 JS 跑起來才生效，靜態匯出的 HTML 裡會先亮錯（或先不亮），
 *     用戶會看到一次高亮跳動。CSS 的 :has() 在**構建產物裡就寫定了**，
 *     首屏即正確，且禁用 JS 也成立。
 *     （:has() 本站已在用 —— shadcn 的 button 樣式裡就有 has-data-[…]。）
 *
 *   aria-current 只能由 DOM 屬性表達，CSS 改不了，所以單獨用一個 effect
 *   補上。它讀的是同一個 [data-page-nav]，與 CSS 不可能讀出不同結果。
 *
 * ★ 兩個屬性名刻意不同（data-page-nav / data-nav）：
 *   前者是「本頁屬於哪一類」，只出現在詳情頁上；
 *   後者是「這個連結對應哪一類」，每個導航項都有。
 *   若共用一個名字，body:has([data-nav=…]) 會在**每一頁**都命中導航項本身，
 *   首頁也會莫名亮起「現正上映」。
 *
 * href 写 "/showing" 而不是 "/showing/"：项目开了 trailingSlash，
 * 导出时自动补斜杠，源码里带上反而容易在别处（如 usePathname 比较）对不上。
 *
 * ★ 2026-09-25 导航项尺寸随主题切换钮的加入而收紧（见文件底部说明）：
 *   顶栏是 flex-nowrap，390px 下要容纳 logo + 三个导航项 + 切换钮。
 *   这不是「顺手缩小」，而是不加就会溢出顶栏固定高度（实测导航高 32 → 52px）。
 */
const LINKS = [
  { href: '/showing', label: '現正上映', nav: 'showing' },
  { href: '/upcoming', label: '即將上映', nav: 'upcoming' },
  { href: '/cinema', label: '戲院', nav: 'cinema' },
] as const;

/** 去掉尾部斜杠再比，避免 "/showing" 与 "/showing/" 判成两个路由 */
function norm(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function NavLinks() {
  const pathname = norm(usePathname() || '/');

  /*
   * 詳情頁的 aria-current 補寫（視覺色塊由 globals.css 的 :has() 負責）
   *
   * ★ 為什麼要「先算再寫」而不是「先全清再補」：
   *   上一版寫成「先清光所有 aria-current，非詳情頁就直接 return」，
   *   結果 /showing、/upcoming 這些**服務端本來就渲染對了**的頁面，
   *   在 hydrate 之後反而被清成沒有 aria-current（因為 React 只對比
   *   自己渲染過的 props，不會收捨我們 imperative 寫上的屬性 ——
   *   這也是必須用 effect 補寫的根本原因）。
   *   現在改為：無論哪一頁都先算出「應該亮哪一項」，再讓 DOM 對齊它，
   *   幂等且不會把對的答案洗掉。
   *
   * 依賴 pathname：客戶端換頁（詳情頁 ↔ 詳情頁）時要重讀一次 ——
   *   否則從待映片點進上映中片，aria-current 會停在上一次的答案上。
   */
  useEffect(() => {
    // 詳情頁的歸屬不是路徑能推的（同一個 /movie 前綴裝兩種片，
    // /cinema/<id> 也與 /cinema 不同），只能讀頁面自己寫下的
    // [data-page-nav]；其餘頁面用路徑即可。
    const fromPage = document.querySelector<HTMLElement>('[data-page-nav]')?.dataset.pageNav;
    const want =
      fromPage ?? (pathname.startsWith('/movie') ? null : LINKS.find((l) => l.href === pathname)?.nav ?? null);
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-nav]')) {
      if (a.dataset.nav === want) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }, [pathname]);

  return (
    <nav className="flex min-w-0 gap-1 text-sm font-medium">
      {LINKS.map(({ href, label, nav }) => {
        /*
         * ★ 只認**精確匹配**。
         *   詳情頁的歸屬不是路徑能推的（見上方說明），
         *   它由 CSS 的 :has() 與上面的 effect 接管，這裡不再用前綴猜。
         */
        const active = pathname === href;

        return (
          <Link
            key={href}
            href={href}
            data-nav={nav}
            aria-current={active ? 'page' : undefined}
            className={
              /*
               * ★ 手机上收紧（2026-09-25）：
               *   顶栏是 flex-nowrap 的，390px 下要同时容纳
               *   logo + 三个导航项 + 主题切换钮。默认的 px-3 text-sm
               *   会把它挤出顶栏高度（实测导航高 32 → 52px，换行）。
               *   手机上改 text-xs / px-2 / whitespace-nowrap，
               *   sm 以上恢复原来的尺寸。
               *
               *   whitespace-nowrap 必须加：中文标签在窄容器里
               *   会一个字一行地竖着排（「現正上映」变成四行），
               *   那比换行更难读。
               */
              `shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 text-xs transition sm:px-3 sm:text-sm ${
                active
                  ? 'bg-veil-strong font-medium text-fg'
                  : 'text-fg-muted hover:bg-veil-strong hover:text-fg'
              }`
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
