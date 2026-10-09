/**
 * 社交分享卡片（Open Graph / X Card）的元信息
 *
 * ===== 为什么需要它（用户 2026-10-09 提出）=====
 *
 * 把站点链接贴到 X 上时，预览卡片要么没有图、要么被裁得不成样子：
 *
 *   1. 首页 / /showing / /upcoming / /cinema / 影院详情页**根本没有图** ——
 *      metadata 里没有 images，X 只能显示一行干巴巴的文字。
 *   2. 电影详情页虽然有 og:image，但那是**竖版海报**（2:3）。
 *      X 的大图卡片是 1.91:1，竖图塞进去会被裁掉上下两端 ——
 *      海报上的片名与主视觉恰好都在被裁掉的位置。
 *
 * 解法：构建期由 goscraper/cmd/ogcardgen 按页生成 1200×630 的横版卡片
 * （见 goscraper/internal/ogcard 的注释），这里只负责把它们接进 metadata。
 *
 * ===== 为什么必须显式声明 twitter =====
 *
 * Next.js 的 metadata 合并是**整块替换**而不是深合并：页面里写了
 * openGraph，layout 的 openGraph 就被整个丢掉（连 og:site_name 一起）。
 * twitter 倒是会从 openGraph 自动补齐，但前提是页面没写 twitter ——
 * 一旦某页写了 twitter（哪怕只写 card），自动补齐就整个失效。
 *
 * 所以这里的做法是：每页都用本模块产出一对完整的
 * { openGraph, twitter }，两个都显式给全，不依赖任何自动补齐。
 * 少给一个字段的代价是「分享出去缺一块」，只有真正贴链接才会发现。
 */
import type { Metadata } from 'next';

/** 卡片尺寸：与 goscraper/internal/ogcard 的 Width/Height 必须一致 */
const CARD_W = 1200;
const CARD_H = 630;

/**
 * 卡片目录。
 *
 * 放 /og/ 而不是根目录：卡片要按需清理（电影下画后它的卡片就该消失），
 * 单独一个目录便于整体重建（见 deploy/rebuild-static.sh 的第 1.8 步）。
 */
const CARD_DIR = '/og';

/**
 * 生成一对完整的 openGraph / twitter 元信息。
 *
 * @param key    卡片文件名（不含扩展名），如 'home' / 'movie-xxx' / 'cinema-yyy'
 * @param title  卡片与分享标题
 * @param desc   分享描述
 * @param alt    图片替代文字（无障碍；X 与部分阅读器会读它）
 */
export function socialCard(opts: {
  key: string;
  title: string;
  description: string;
  alt?: string;
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const url = `${CARD_DIR}/${opts.key}.jpg`;
  const alt = opts.alt || opts.title;

  return {
    openGraph: {
      // ★ 这三个必须写全：Next.js 的 openGraph 是**整块替换**而不是深合并，
      //   本函数返回的 openGraph 会把 layout 里那份整个顶掉。
      //   2026-10-10 实测踩到：只给 title/description/images 时，
      //   og:site_name / og:locale / og:type 在成品 HTML 里全部消失
      //   （分享出去站点名变成域名、Facebook 也不知道这是 website）。
      //   凡是 layout 里声明过的 openGraph 字段，这里都要重复一遍。
      type: 'website',
      locale: 'zh_HK',
      siteName: 'YuuMovie',
      title: opts.title,
      description: opts.description,
      // 尺寸必须显式给：X 拿到宽高才能按 1.91:1 排版，
      // 不给的话它会先按比例猜一次、猜错就退回小图卡片。
      images: [{ url, width: CARD_W, height: CARD_H, alt }],
    },
    twitter: {
      // summary_large_image = 大图卡片（图占满宽度，标题在下方）。
      // 本站的卡片就是为这个比例画的，不能让它退回 summary 的小方块图。
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [{ url, alt }],
    },
  };
}

/**
 * 把组 slug / 影院 id 收敛成与 Go 侧一致的文件名。
 *
 * ★ 必须与 goscraper/cmd/ogcardgen 的 safeName 保持**逐字一致** ——
 *   两边算法只要有一点不同，页面引用的文件名就会与磁盘上的对不上，
 *   而失效方式是「分享卡片变成空白」，本地构建不报错、类型也不报错。
 *   （测试：probe/check-og-cards.mts 用真实数据比对两边产物。）
 */
export function cardFileName(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (/[a-zA-Z0-9._-]/.test(ch)) out += ch;
    else out += '-';
  }
  out = out.replace(/^[-.]+|[-.]+$/g, '');
  return out || 'x';
}
