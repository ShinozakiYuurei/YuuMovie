#!/usr/bin/env node
/**
 * 中文 Web 字体分片生成器（Noto Sans HK）
 *
 * ===== 为什么需要它 =====
 *
 * 原先 CJK 字体走 next/font/local：5.2MB 的可变字体被整包输出成
 * 一个 woff2，并在每个页面里 <link rel="preload">。实测首页字体下载
 * 5.68MB / 首页总下载 6.03MB —— 光这一项就占 94%。
 *
 * 中文站点没必要在首屏拉整套 CJK 字形。本脚本把字体按**站内实际用字**
 * 切成若干片，每片一个 woff2 + 一段带 unicode-range 的 @font-face：
 * 浏览器只下载「本页文字真正落在的片」，其余不请求。
 *
 * ===== 分片策略 =====
 *
 * 语料 = out/**\/*.html（页面真实渲染出的文字）
 *      + data/**\/*.json（内容源；含尚未渲染的新片资料，防新片上线即缺字）
 *
 * 按语料词频降序切成 4 片：
 *   T1 高频 500 字   —— 覆盖正文约 94% 的出现次数，每页必用，最先到
 *   T2 500-1000      —— 累计约 97.5%
 *   T3 1000-2000     —— 累计约 99.6%
 *   T4 2000+         —— 长尾（人名/地名/生僻字），全站 ~3300 字全覆盖
 *
 * ★ 为什么不做「只留高频、其余回退系统字体」：
 *   回退字符会混在片名/戏院名/演员名里（如「紅磡」「氹仔」「蕪」），
 *   同一行出现两种字体比多下几百 KB 更刺眼。全站用字仅 3300 字，
 *   分片后每页实际下载 ~0.9MB（对比原来的 5.2MB），且可永久缓存。
 *
 * ===== 重新生成 =====
 *
 *   npm run slice-fonts
 *
 * 生成物（public/fonts/noto-sans-hk/*.woff2 + app/fonts/noto-sans-hk.css）
 * 要提交进仓库：服务器构建只做静态拷贝，不依赖本脚本与 Python/字体工具链。
 * 页面新增大量新用字（新院线、大批新片）后重跑一次即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FONT = path.join(ROOT, 'app/fonts/NotoSansHK-Variable.woff2');
const OUT_DIR = path.join(ROOT, 'public/fonts/noto-sans-hk');
const CSS_FILE = path.join(ROOT, 'app/fonts/noto-sans-hk.css');
const PAGES_DIR = path.join(ROOT, 'out');
const DATA_DIR = path.join(ROOT, 'data');

const FAMILY = 'Noto Sans HK';
/** 各片的上界（按词频降序的第 N 个字之后切一刀），最后一片自动收尾。 */
const TIER_BOUNDS = [500, 1000, 2000];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 去掉标签/脚本/样式与 HTML 实体，只留可见文字。 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

function collectCorpus() {
  if (!fs.existsSync(PAGES_DIR)) {
    console.error('✖ 找不到 out/ —— 先跑一次 npm run build 再生成字体分片。');
    process.exit(1);
  }
  const freq = new Map();
  const add = (text) => {
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20) freq.set(cp, (freq.get(cp) || 0) + 1);
    }
  };
  const pages = walk(PAGES_DIR).filter((f) => f.endsWith('.html'));
  for (const f of pages) add(visibleText(fs.readFileSync(f, 'utf8')));
  const dataFiles = fs.existsSync(DATA_DIR)
    ? walk(DATA_DIR).filter((f) => f.endsWith('.json'))
    : [];
  for (const f of dataFiles) add(fs.readFileSync(f, 'utf8'));
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  return { ranked, pages: pages.length, dataFiles: dataFiles.length };
}

/** 把码点集合压成 unicode-range 字符串（连续段合并）。 */
function toUnicodeRange(codePoints) {
  const sorted = [...codePoints].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    ranges.push([start, prev]);
    start = prev = sorted[i];
  }
  ranges.push([start, prev]);
  const hex = (n) => n.toString(16).toUpperCase();
  return ranges
    .map(([a, b]) => (a === b ? 'U+' + hex(a) : 'U+' + hex(a) + '-' + hex(b)))
    .join(',');
}

async function main() {
  const { ranked, pages, dataFiles } = collectCorpus();
  console.log('▶ 语料：' + pages + ' 个页面 + ' + dataFiles + ' 个数据文件，' + ranked.length + ' 个不同字符');

  const ttf = Buffer.from(
    await wawoff2.decompress(fs.readFileSync(SRC_FONT)),
  );
  console.log('▶ 源字体解压：' + (ttf.length / 1048576).toFixed(2) + 'MB（woff2 为 ' + (fs.statSync(SRC_FONT).size / 1048576).toFixed(2) + 'MB）');

  const bounds = [...TIER_BOUNDS, ranked.length];
  const tiers = [];
  let from = 0;
  for (const to of bounds) {
    const codePoints = ranked.slice(from, Math.min(to, ranked.length));
    if (!codePoints.length) break;
    const woff2 = await subsetFont(ttf, String.fromCodePoint(...codePoints), {
      targetFormat: 'woff2',
    });
    const hash = crypto.createHash('sha1').update(woff2).digest('hex').slice(0, 8);
    const file = 't' + (tiers.length + 1) + '.' + hash + '.woff2';
    tiers.push({ file, codePoints, woff2, bytes: woff2.length });
    from = to;
  }

  // 输出目录全量重建：旧分片（改过切法后）不留残骸
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const tier of tiers) {
    fs.writeFileSync(path.join(OUT_DIR, tier.file), tier.woff2 ?? Buffer.alloc(0));
  }

  const css = [
    '/* 自动生成，勿手改 —— 见 scripts/slice-cjk-font.mjs（npm run slice-fonts）*/',
    ...tiers.map(
      (tier) =>
        '@font-face{font-family:"' + FAMILY + '";' +
        'src:url("/fonts/noto-sans-hk/' + tier.file + '")format("woff2");' +
        'font-style:normal;font-weight:100 900;font-display:swap;' +
        'unicode-range:' + toUnicodeRange(tier.codePoints) + ';}',
    ),
    '',
  ].join('\n');
  fs.writeFileSync(CSS_FILE, css);

  let total = 0;
  tiers.forEach((tier, i) => {
    total += tier.bytes;
    const from_ = i === 0 ? 0 : bounds[i - 1];
    console.log(
      '  T' + (i + 1) + ' 第 ' + from_ + '-' + (from_ + tier.codePoints.length - 1) + ' 字：' +
      tier.codePoints.length + ' 字 → ' + (tier.bytes / 1024).toFixed(1) + 'KB（' + tier.file + '）',
    );
  });
  console.log('▶ 合计 ' + (total / 1024).toFixed(0) + 'KB（原单文件 5.2MB）；CSS ' + (css.length / 1024).toFixed(1) + 'KB');
  console.log('▶ 产物：public/fonts/noto-sans-hk/ 与 app/fonts/noto-sans-hk.css');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
