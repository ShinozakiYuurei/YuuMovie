'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * 电影海报（带骨架淡入）
 *
 * 为什么单独抽成客户端组件：
 *   卡片本身是服务端渲染的，若整张卡标记为 'use client'，
 *   全部卡片都会被推进客户端 bundle，首屏 JS 明显变大。
 *   这里只把「需要 onLoad 的这一层」变成客户端，其余保持服务端渲染。
 *
 * 动效说明：
 *   加载中显示 shimmer 骨架，图片 onLoad 后骨架淡出、图片淡入。
 *   全部为 CSS 动画（见 globals.css），未引入 framer-motion 等运行时库。
 *
 * ★ 2026-09-19 修复「首屏图片全被 lazy 拖慢」：
 *
 *   实测线上首页 16 张海报**全部**是 loading="lazy"（0 张 eager），
 *   包括首屏第一行那几张。lazy 的含义是「等浏览器完成布局、
 *   判断该图是否接近视口后才发起请求」—— 对首屏可见的图，这等于
 *   凭空多出一个「布局 → 判定 → 才发请求」的串行等待，
 *   直接推后 LCP（最大内容绘制）。
 *
 *   修复：新增 priority 属性，由调用方对首屏图片传 true。
 *   next/image 在 priority=true 时会渲染 loading="eager" +
 *   fetchpriority="high"，并把图片加入预加载，让请求尽早发出。
 *
 *   注意不要滥用：priority 过多会让浏览器同时抢占带宽，
 *   反而拖慢真正的 LCP 元素。首页只对第一行（4 张）启用。
 */
export function PosterImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  /** 首屏可见的海报传 true：立即加载并提高抓取优先级 */
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {/* 骨架层：加载完成后淡出 */}
      {!loaded && (
        <div
          className="hkm-skeleton absolute inset-0 z-10"
          aria-hidden
        />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className={className}
        // priority=true 时 next/image 会自动用 loading=eager
        priority={priority}
        // ★ fetchPriority 必须显式传：next/image 只是透传这个 prop，
        //   并不会因为 priority 就自动加上。缺了它浏览器仍会按默认优先级
        //   抓取首屏海报，等于 priority 只做了一半。
        fetchPriority={priority ? 'high' : undefined}
        // 统一异步解码。
        //   曾考虑首屏用 sync 让绘制更早，但首页有 8 张 priority 图，
        //   同步解码会连续阻塞主线程，风险大于收益 —— 真正影响 LCP 的
        //   是「何时开始下载」（由 priority + fetchPriority 控制），
        //   而不是解码时机。
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
