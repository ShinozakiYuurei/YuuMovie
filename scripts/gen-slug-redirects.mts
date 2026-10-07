#!/usr/bin/env node
/**
 * 生成 /movie/ 旧 slug → 新 slug 的 301 重定向表（nginx map）。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 * 详情页是静态导出（`dynamicParams = false`），每个 slug 对应一个
 * 预生成的目录。而 slug 来自 `primary.slug`，primary 是**按场次最多选出来的
 * 条目** —— 同一部片在不同院线的条目各有一个 slug，分组一变
 * （合并了原本分裂的组、某条目下画、场次此消彼长）代表条目就会换人，
 * 于是**旧网址直接 404**。
 *
 * 2026-10-04 实测：修好「括号内冠词 / 场次前缀吃片名」两个分组 bug 后，
 * `avengers-doomsday-special-screening-1418` 与
 * `tchaikovsky-s-eugene-onegin-the-met-2026-emperor-9df03b6b28de`
 * 当场变 404 —— 而这两个地址在此之前是**线上真实可访问**的。
 *
 * ── 为什么能纯推导、不需要历史快照 ─────────────────────────────
 * ★ 关键事实：这些旧 slug **不是随机生成后又丢弃的**，它们是
 *   **组内某个条目自己的 slug**，而条目 slug 的构造是稳定的：
 *     条目 slug = slugify(nameEn || nameZh) + '-' + <院线 id>
 *   院线 id 稳定（mcl-14671 / broadway-1418 / emperor-9df03b6b28de…），
 *   片名清洗规则稳定 → **条目 slug 跨构建不变**。
 *   变的只有「哪个条目当代表（canonical）」，所以：
 *     条目 slug ≠ 组 canonical  ⟹  该条目 slug 是一个应当重定向的旧地址。
 *   这条映射每次构建都能从当前数据重新算出来，不需要保存历史。
 *
 * ── 覆盖范围的实测（2026-10-04，线上 nginx 全部访问日志）────────
 * 528 个历史上被真实访问过的 /movie/ slug：
 *   253 现在仍是有效页 ｜ 94 可 301 ｜ 181 无法恢复
 * 那 181 个里 154 个是**影片已下画**（条目早已从数据里消失，
 * 改动前就是 404，与本次无关）；其余是早期抓取器写出的脏 slug
 * （`mcl`、`hope-`、`look-back-` 这类空尾巴），同样在改动前就 404。
 *
 * ── 输出 ──────────────────────────────────────────────────────
 *   deploy/nginx-slug-redirects.conf —— nginx `map` 块（**生成物，不进仓库**）。
 *   服务器上由 rebuild-static.sh 在每次重建时重新生成到 nginx 的
 *   include 目录（数据变了表就跟着变），再由站点 conf include 进去。
 *
 * 用法：
 *   node --import tsx scripts/gen-slug-redirects.mts            # 写到默认位置
 *   node --import tsx scripts/gen-slug-redirects.mts --check     # 只校验不写
 *   node --import tsx scripts/gen-slug-redirects.mts --print     # 打到 stdout
 *
 * ★ 输出位置：默认 deploy/nginx-slug-redirects.conf（本机看一眼用），
 *   服务器上由 rebuild-static.sh 用 REDIRECT_OUT 写进 nginx 的 include 目录
 *   —— **不写回仓库**，否则服务器侧工作树被改脏、下一次 git pull 直接冲突。
 *
 * ★ 为什么要考虑「写失败」：站点 conf 里的 include 是**精确路径**，
 *   文件缺失时 nginx 连启动都起不来（实测 `[emerg] open() failed`）——
 *   而这个容器同时服务 komari / jpstage / imgmove，写错会连带把别人全搞死。
 *   所以写入是「同目录临时文件 + rename」的原子替换，绝不留半截文件；
 *   目录由 deploy/setup-slug-redirects.sh 建一次并交给 hkmovie 写。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMovieGroups, getAllMovies } from '../lib/data.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = process.env.REDIRECT_OUT
  ? path.resolve(process.env.REDIRECT_OUT)
  : path.join(__dirname, '..', 'deploy', 'nginx-slug-redirects.conf');

/** 只接受 ASCII slug：中文 slug 在 /movie/[slug] 下必然 404（历史坑，见 scrape.js 注释） */
const ASCII_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 生成器只用到这两个字段，收窄参数类型后测试可传纯 fixture */
export interface SlugSource {
  id: string;
  slug: string;
}
export interface GroupSource {
  slug: string;
  versions: { movieIds: string[] }[];
}

export interface RedirectEntry {
  /** 旧地址（组内某条目自己的 slug） */
  from: string;
  /** 该条目现在所属组的 canonical slug */
  to: string;
  /** 产生这条映射的条目 id，便于排查 */
  id: string;
}

/**
 * 计算「条目 slug → 组 canonical slug」的全部重定向。
 *
 * 纯函数（不读 data/、不碰 fs），便于用 fixture 钉死规则。
 *
 * 四道过滤，都是「宁可不重定向、也不要把人送到错误的页面」：
 *   1. from === to 的跳过（本来就是有效页）。
 *   2. from 恰好是**别的组**的 canonical 时跳过 —— 那条 URL 是活的，
 *      重定向它会把一个真实页面劫走。（当前数据下 0 条，但规则要在。）
 *   3. 非 ASCII 或格式不对的跳过（历史上抓取器留下的脏 slug）。
 *   4. 同一 from 指向不同 to 时整条丢弃（歧义宁缺毋滥）。
 */
export function computeRedirects(movies: SlugSource[], groups: GroupSource[]): RedirectEntry[] {
  const canonicalSlugs = new Set(groups.map((g) => g.slug));
  const canonicalOf = new Map<string, string>();
  for (const g of groups) {
    for (const v of g.versions) for (const id of v.movieIds) canonicalOf.set(id, g.slug);
  }

  const seen = new Map<string, RedirectEntry>();
  const ambiguous = new Set<string>();
  for (const m of movies) {
    const to = canonicalOf.get(m.id);
    const from = m.slug;
    if (!to || !from || from === to) continue;
    if (!ASCII_SLUG_RE.test(from)) continue;
    if (canonicalSlugs.has(from)) continue;
    const prev = seen.get(from);
    if (prev && prev.to !== to) {
      ambiguous.add(from);
      seen.delete(from);
      continue;
    }
    if (!prev && !ambiguous.has(from)) seen.set(from, { from, to, id: m.id });
  }

  return [...seen.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * 改名遗留的旧地址（手动维护；每次因改名丢弃旧 slug 时补一行）。
 *
 * 为什么必须手写：条目 slug = slugify(nameEn || nameZh) + '-' + id，而
 * computeRedirects 只覆盖「当前数据里仍然存在的条目 slug」。片名一旦被修正
 * （例：影碟编号 1.11 → 官方 1.0），旧 slug 就从数据里彻底消失、推导不出来
 * —— 但它此前是线上真实可访问的地址，不该直接 404。
 *
 * anchorId 是旧 slug 原本所属的条目：生成时按它的**当前** canonical 解析目标，
 * 代表条目换人时目标自动跟着走，不用改这张表；条目下画（不在任何组）时跳过。
 */
export const RENAMED_SLUGS: { from: string; anchorId: string; note: string }[] = [
  { from: 'evangelion-1-11-you-are-not-alone-1290', anchorId: 'broadway-1290', note: '新劇場版 序 1.11 → 1.0' },
  { from: 'evangelion-2-22-you-can-not-advance-1291', anchorId: 'broadway-1291', note: '新劇場版 破 2.22 → 2.0' },
  { from: 'evangelion-3-33-you-can-not-redo-1292', anchorId: 'broadway-1292', note: '新劇場版 Q 3.33 → 3.0' },
  { from: 'evangelion-3-0-1-01-thrice-upon-a-time-1293', anchorId: 'broadway-1293', note: '新劇場版 終 3.0+1.01 → 3.0+1.0' },
];

/** 解析 RENAMED_SLUGS：目标取 anchor 条目当前所属组的 canonical slug。 */
export function renamedRedirects(groups: GroupSource[]): RedirectEntry[] {
  const canonicalSlugs = new Set(groups.map((g) => g.slug));
  const canonicalOf = new Map<string, string>();
  for (const g of groups) {
    for (const v of g.versions) for (const id of v.movieIds) canonicalOf.set(id, g.slug);
  }
  const out: RedirectEntry[] = [];
  for (const r of RENAMED_SLUGS) {
    const to = canonicalOf.get(r.anchorId);
    if (!to || r.from === to) continue;
    if (!ASCII_SLUG_RE.test(r.from)) continue;
    if (canonicalSlugs.has(r.from)) continue;
    out.push({ from: r.from, to, id: r.anchorId });
  }
  return out;
}

/** 用当前真实数据算（跑脚本时用）：派生表 + 改名遗留地址。 */
export function buildRedirects(): RedirectEntry[] {
  const movies = getAllMovies() as SlugSource[];
  const groups = getMovieGroups() as unknown as GroupSource[];
  const merged = new Map<string, RedirectEntry>();
  for (const e of computeRedirects(movies, groups)) merged.set(e.from, e);
  for (const e of renamedRedirects(groups)) if (!merged.has(e.from)) merged.set(e.from, e);
  return [...merged.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * nginx 侧 map_hash_bucket_size 的设定值（见 deploy/nginx-static.conf）。
 *
 * ★ 为什么生成器要知道它：这张表是**每次重建都重新生成**的，
 *   而站点 conf 里 include 的是固定路径 —— 一旦写出一个 nginx 装不下的表，
 *   磁盘上的配置就坏了。当下不会立刻发作（nginx 还在用内存里的旧配置跑），
 *   但**容器下一次重启就会起不来**，而且这个 nginx 还带着另外三个站。
 *   所以宁可「本次不更新表」（沿用旧表，旧 slug 可能 404）也不写出坏文件。
 *
 * 实测（2026-10-04，530 条真实数据）：最长 key/value 均 108 字符。
 * 上限按 bucket_size 算，再留 8 字符余量给将来。
 */
const NGINX_BUCKET_SIZE = 128;
const MAX_KEY_LEN = NGINX_BUCKET_SIZE - 8;

/** 渲染成 nginx map 块 */
export function renderMap(entries: RedirectEntry[], stamp: string): string {
  const lines = [
    '# /movie/ 旧 slug → 新 slug 的 301 重定向表',
    '#',
    '# ★ 本文件由 scripts/gen-slug-redirects.mts 自动生成，请勿手改。',
    '#   每次 rebuild-static.sh 重建时会重新生成（数据变了表就跟着变）。',
    '#',
    '# 为什么要它：详情页 slug 是「组内场次最多的条目」的 slug，',
    '#   条目场次此消彼长或分组规则修正后，代表条目会换人 → 旧网址 404。',
    '#   表里每一条都是**当前数据里仍然存在、只是不再当代表**的条目 slug，',
    '#   因此能安全地 301 到它所属组的当前地址。',
    '#',
    '# 用法（站点 conf 内）：',
    '#   if ($hkm_redirect_to) { return 301 $hkm_redirect_to; }',
    '#   —— 放在 location / 里、try_files 之前。',
    '#',
    `# 生成时间：${stamp}`,
    `# 条目数：${entries.length}`,
    '',
    '# ★ map 必须写在 http 块里：本文件被站点 conf 顶层 include，',
    '#   而站点 conf 由 nginx.conf 的 http 块 include 进来，位置正确。',
    'map $uri $hkm_redirect_to {',
    '    default "";',
    '',
    '    # $uri 带尾斜杠（trailingSlash: true），两种写法都收',
  ];

  for (const e of entries) {
    lines.push(`    /movie/${e.from}/   /movie/${e.to}/;`);
    lines.push(`    /movie/${e.from}    /movie/${e.to}/;`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const printOnly = process.argv.includes('--print');

  const entries = buildRedirects();
  const stamp = new Date().toISOString();
  const text = renderMap(entries, stamp);

  if (printOnly) {
    process.stdout.write(text);
    return;
  }

  if (checkOnly) {
    const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    // 只比条目行：时间戳每次都不同，不该算作不一致
    const strip = (s: string) =>
      s.split('\n').filter((l) => l.trim().startsWith('/movie/')).sort().join('\n');
    if (strip(current) !== strip(text)) {
      console.error('✗ deploy/nginx-slug-redirects.conf 与当前数据不一致，请重新生成');
      process.exitCode = 1;
      return;
    }
    console.log(`✓ 重定向表与数据一致（${entries.length} 条）`);
    return;
  }

  // 原子替换：先写同目录临时文件再 rename。
  // 为什么不直接 writeFileSync 到目标：nginx 随时可能 reload，
  // 读到半截的 map 文件会直接起不来（这个容器还带着另外三个站）。
  //
  // ★ 先自检长度再落盘：宁可沿用旧表，也不写出 nginx 装不下的配置。
  const tooLong = entries
    .flatMap((e) => [`/movie/${e.from}/`, `/movie/${e.from}`, `/movie/${e.to}/`])
    .filter((s) => s.length > MAX_KEY_LEN);
  if (tooLong.length) {
    console.error(
      `✖ 有 ${tooLong.length} 个 slug 超过 ${MAX_KEY_LEN} 字符，超出 nginx map_hash_bucket_size ` +
        `(${NGINX_BUCKET_SIZE}) 的安全范围 —— 拒绝写出，沿用上一版表。`
    );
    for (const s of tooLong.slice(0, 5)) console.error(`    ${s.length} 字符：${s}`);
    console.error(
      `  处理：提高 deploy/nginx-static.conf 的 map_hash_bucket_size（同步记得走 sync-nginx-conf.sh）`
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, OUT_FILE);
  console.log(`✓ 已生成 ${OUT_FILE}（${entries.length} 条）`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/gen-slug-redirects.mts')) {
  main();
}
