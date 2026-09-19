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
    // 这不代表放弃图片优化：数据层 lib/data.ts 的 slimPoster() 已经给
    //   每张海报拼上 CDN 的 x-oss-process 参数（resize,w_400/format,webp），
    //   实测 736KB → 22KB。真正的压缩由 CDN 完成，与是否走优化器无关。
    unoptimized: true,

    // 保留 remotePatterns 以便日后切回服务端渲染时无需改代码
    remotePatterns: [
      { protocol: 'https', hostname: 'media.grabticks.com' },
      { protocol: 'https', hostname: 'cdn.icirena.ai' },
      { protocol: 'https', hostname: 'www.mclcinema.com' },
    ],
  },
};

export default nextConfig;
