import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ★ 静态导出（output: 'export'）
  //
  // 为什么改：原先是 standalone + Node 常驻进程（约 128MB RSS）。
  // 2C2G 的 VPS 上，这个进程只为「读 JSON 渲染页面」而常驻，
  // 而数据每 2–6 小时才变一次 —— 完全没必要。
  //
  // 改成静态导出后：
  //   - nginx 直接服务 HTML，Node 进程彻底消失（省下全部 128MB）
  //   - 抓取后重建即可（实测 41 秒，完全可接受）
  //   - 零代码重写：页面/组件/样式一律不动
  output: 'export',

  // 静态导出时 next build 输出到 out/ 目录
  distDir: 'out',

  // 详情页路径形如 /movie/xxx → 导出为 /movie/xxx.html
  trailingSlash: true,

  images: {
    // ★ 静态导出下没有 Node 服务端，next/image 的优化器无法运行，
    //   必须关掉（否则图片会 404）。
    //
    // 这不代表放弃图片优化：海报已在**构建前**由 scripts/fetch-posters.mjs
    //   抓取并转为 800w WebP（实测 390KB → 45KB），真正的压缩在构建期完成，
    //   与是否走 next/image 优化器无关。
    unoptimized: true,

    // 保留 remotePatterns 以便日后切回服务端渲染时无需改代码。
    //
    // ★ 图片子域（NEXT_PUBLIC_POSTER_ORIGIN，如 https://img.yuurei.de）
    //   必须一并列入：若将来关掉 unoptimized，未列入的域名会被 next/image
    //   直接拒绝（抛 Invalid src prop）。现在虽然用不上，但列入可避免那时踩坑。
    //   未设置该变量时不追加，保持默认行为。
    remotePatterns: [
      { protocol: 'https', hostname: 'media.grabticks.com' },
      { protocol: 'https', hostname: 'cdn.icirena.ai' },
      { protocol: 'https', hostname: 'www.mclcinema.com' },
      ...(process.env.NEXT_PUBLIC_POSTER_ORIGIN
        ? [{ protocol: 'https' as const, hostname: new URL(process.env.NEXT_PUBLIC_POSTER_ORIGIN).hostname }]
        : []),
    ],
  },
};

export default nextConfig;
