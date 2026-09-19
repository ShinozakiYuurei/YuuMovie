'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * 电影海报（带骨架淡入）
 *
 * 为什么单独抽成客户端组件：
 *   卡片本身是服务端渲染的（首页 60 张），若整张卡标记为 'use client'，
 *   全部卡片都会被推进客户端 bundle，首屏 JS 明显变大。
 *   这里只把「需要 onLoad 的这一层」变成客户端，其余保持服务端渲染。
 *
 * 动效说明：
 *   加载中显示 shimmer 骨架，图片 onLoad 后骨架淡出、图片淡入。
 *   全部为 CSS 动画（见 globals.css），未引入 framer-motion 等运行时库。
 */
export function PosterImage({
  src,
  alt,
  sizes,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
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
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
