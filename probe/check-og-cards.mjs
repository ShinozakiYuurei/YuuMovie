#!/usr/bin/env node
/**
 * 分享卡片（OG / X Card）自检：核对**产物 HTML 引用的卡片**是否真实存在。
 *
 * ── 为什么必须自检 ─────────────────────────────────────────────
 *
 * 卡片文件名在**两个地方各算一次**：
 *   - lib/og.ts 的 cardFileName()  → 页面 metadata 引用 /og/movie-<slug>.jpg
 *   - cmd/ogcardgen 的 safeName()  → 真正写到 public/og/ 的文件名
 *
 * 两边算法只要差一个字符（哪怕只是「下划线要不要保留」），页面就会引用一个
 * 不存在的文件。失效方式极隐蔽：
 *   - 构建不报错、tsc 不报错、页面照常 200；
 *   - 只有**把链接贴到 X 上**才发现是空卡片；
 *   - 而且 X 侧还会把空卡片缓存一段时间，改完也得等它过期。
 *
 * ── 为什么扫产物 HTML 而不是比对算法 ───────────────────────────
 *
 * 直接读 out/ 里的 HTML、抽出它真正引用的 /og/*.jpg、逐个确认文件在不在。
 * 这样比对的是**最终事实**而不是「两套算法是否一致」——
 * 哪怕将来换了实现方式（比如改用 opengraph-image 约定），这条检查照样成立。
 *
 * 同时在 HTML 里核对三件事，它们都是「少了不影响构建、只有分享出去才发现」：
 *   1. twitter:card 必须是 summary_large_image（否则图被缩成小方块）；
 *   2. og:image:width / height 必须存在且为 1200×630（X 靠它决定排版）；
 *   3. og:image 必须是**绝对 URL**（相对路径 X 抓不到）。
 *
 * 用法：node probe/check-og-cards.mjs [站点目录]
 *       默认 /home/web/html（服务器产物根），本机可传 out/
 * 退出码：0 = 通过；1 = 有问题；2 = 检查本身没跑起来
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.env.SITE_DIR || '/home/web/html';

/** 扫描范围：站点根 + 这些子目录下的所有页面（movie/cinema 是详情页目录） */
const SCAN_DIRS = ['.', 'showing', 'upcoming', 'cinema', 'movie'];

function walkHtml(dir, out, limit = Infinity) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= limit) return out;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // _next 是构建产物，里面的 HTML 与页面无关
      if (e.name === '_next') continue;
      walkHtml(full, out, limit);
    } else if (e.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`✖ 站点目录不存在：${ROOT}`);
    process.exit(2);
  }

  // 抽样：全站 259 页全扫一遍也可以（单页 HTML 百 KB 级，实测 <2s），
  // 但电影页有 214 个且结构完全一致，抽前 40 个足够发现「命名算法分叉」这类
  // 系统性错误 —— 这类错一旦出现就是全站性的，不会只错一页。
  const pages = [];
  for (const d of SCAN_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    if (d === 'movie') {
      const files = walkHtml(dir, []);
      // 按名字排序后取样，避免每次都是同一批
      files.sort();
      const step = Math.max(1, Math.floor(files.length / 40));
      for (let i = 0; i < files.length; i += step) pages.push(files[i]);
    } else {
      walkHtml(dir, pages);
    }
  }

  if (pages.length === 0) {
    console.error(`✖ ${ROOT} 里一个 HTML 都没扫到 —— 检查没真的跑起来，不能算通过`);
    process.exit(2);
  }

  const problems = [];
  let withCard = 0;
  let missingImg = 0;
  const checked = new Set();

  for (const file of pages) {
    const rel = path.relative(ROOT, file);
    const html = fs.readFileSync(file, 'utf8');

    const img = attr(html, /<meta property="og:image" content="([^"]+)"/);
    const card = attr(html, /<meta name="twitter:card" content="([^"]+)"/);
    const twImg = attr(html, /<meta name="twitter:image" content="([^"]+)"/);
    const w = attr(html, /<meta property="og:image:width" content="([^"]+)"/);
    const h = attr(html, /<meta property="og:image:height" content="([^"]+)"/);

    if (!img) {
      missingImg++;
      if (missingImg <= 5) problems.push(`${rel}：没有 og:image（分享出去是纯文字）`);
      continue;
    }
    withCard++;

    // 必须是绝对 URL：X 不解析相对路径
    if (!/^https?:\/\//.test(img)) {
      problems.push(`${rel}：og:image 不是绝对 URL（${img}）`);
      continue;
    }

    // 卡片必须是 summary_large_image，否则图会被缩成小方块
    if (card !== 'summary_large_image') {
      problems.push(`${rel}：twitter:card=${card || '(缺)'}，应为 summary_large_image`);
    }

    // 尺寸必须显式声明且正确
    if (w !== '1200' || h !== '630') {
      problems.push(`${rel}：og:image 尺寸为 ${w || '?'}×${h || '?'}，应为 1200×630`);
    }

    // twitter:image 应与 og:image 一致（少给会让部分客户端取不到图）
    if (twImg !== img) {
      problems.push(`${rel}：twitter:image 与 og:image 不一致`);
    }

    // 图必须真实存在
    const urlPath = img.replace(/^https?:\/\/[^/]+/, '');
    if (checked.has(urlPath)) continue;
    checked.add(urlPath);
    const local = path.join(ROOT, urlPath);
    if (!fs.existsSync(local)) {
      problems.push(`${rel}：引用的卡片不存在 —— ${urlPath}`);
      continue;
    }
    const size = fs.statSync(local).size;
    if (size < 8 * 1024) {
      problems.push(`${rel}：卡片体积异常（${size}B，疑为写坏）—— ${urlPath}`);
    }
  }

  console.log(
    `分享卡片自检：扫描 ${pages.length} 页 | 有卡片 ${withCard} | 无卡片 ${missingImg} | 唯一图片 ${checked.size}`,
  );

  if (withCard === 0) {
    console.error('✖ 一页都没有 og:image —— 卡片功能整体没生效，不能算通过');
    process.exit(2);
  }
  if (problems.length === 0) {
    console.log('✔ 卡片齐全、格式与尺寸正确、引用的文件都存在');
    process.exit(0);
  }
  for (const p of problems.slice(0, 20)) console.error('✖ ' + p);
  if (problems.length > 20) console.error(`  …还有 ${problems.length - 20} 条`);
  process.exit(1);
}

main();
