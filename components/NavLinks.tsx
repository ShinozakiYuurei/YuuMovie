'use client';

import Link from 'next/link';
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
 * href 写 "/showing" 而不是 "/showing/"：项目开了 trailingSlash，
 * 导出时自动补斜杠，源码里带上反而容易在别处（如 usePathname 比较）对不上。
 */
const LINKS = [
  { href: '/showing', label: '現正上映' },
  { href: '/upcoming', label: '即將上映' },
  { href: '/cinema', label: '戲院' },
] as const;

/** 去掉尾部斜杠再比，避免 "/showing" 与 "/showing/" 判成两个路由 */
function norm(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function NavLinks() {
  const pathname = norm(usePathname() || '/');

  return (
    <nav className="flex gap-1 text-sm">
      {LINKS.map(({ href, label }) => {
        // 详情页 /movie/xxx 也算「現正上映」的一部分：面包屑已经归到该分类，
        // 顶栏不该在此时一个都不亮。
        const active =
          pathname === href || (href === '/showing' && pathname.startsWith('/movie'));

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-full bg-veil-strong px-3 py-1.5 font-medium text-fg'
                : 'rounded-full px-3 py-1.5 text-fg-muted transition hover:bg-veil-strong hover:text-fg'
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
