import fs from 'node:fs';
import path from 'node:path';
import type { Movie, Show, Cinema, Meta, Source, EnrichEntry } from './types';
import {
  normalizeTitle,
  fallbackTitle,
  extractFormats,
  sortFormats,
  formatLabel,
  formatVersionText,
  hasFormatMarker,
  isBaseVersion,
  projectionFormats,
  stripFormats,
  stripEnglishTitleNoise,
} from './versions';
// key 归一化与 scrapers/enrich.js 共用同一份实现（见该文件头注释）
import { enrichKey } from './enrich-key.js';
import { zhGenres, dropParents } from './genre-zh';
import { zhLanguages, zhSubtitles } from './lang-zh';
import { inferGeo, districtOrder, REGION_ORDER } from './region';
import { hallSpecsOf, sortSpecs, HALL_SPECS, specLabel, SPEC_GROUP_LABEL } from './cinema-specs';
import { bookingFeeOf } from './booking-fee';
import type { BookingFee } from './booking-fee';
// 已開映場次的判定：與客戶端（components/CinemaShowtimes.tsx 等）共用同一份規則
import { isLiveShow } from './live';
import { CINEMA_DISPLAY_NAME } from './cinema-names';
import type { Region } from './types';
// 紧凑传输格式的编解码在同目录的 compact.ts（零依赖，客户端组件也要用）
export { toCompact, fromCompact } from './compact';
export type { CompactRows } from './compact';

/**
 * 数据在**运行时**从 data/*.json 读取（而非静态 import）。
 *
 * 为什么这么做：
 *  1. 静态 import 会把数据烧进 bundle，导致 next build 预渲染全部页面
 *     → 构建峰值内存 ~2.3GB，1c1g 的 VPS 会 OOM
 *  2. 抓取更新 JSON 后无需重新构建，重启即生效
 *
 * 数据目录解析顺序：
 *  1. DATA_DIR 环境变量（部署时指向共享数据目录）
 *  2. 项目根目录的 data/
 *  3. standalone 产物内的 data/
 */

/**
 * ASCII slug 兜底：与 scrape.js 的 slugify 保持一致。
 * 仅用于修复存量数据中的中文 slug（详见 getGroupBySlug 处的说明）。
 */
function asciiSlug(nameEn: string | null, nameZh: string | null, id: string): string {
  const tail = String(id).split(':').pop();
  const base = (nameEn || nameZh || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${tail}` : `movie-${tail}`;
}

/**
 * 海报 URL 瘦身（低配 VPS 关键优化）
 *
 * 背景：院线 CDN 的原图高达 0.7–4.9MB/张，首页 50+ 张 ≈ 数十 MB。
 * 若直接把原图交给 next/image 优化器，服务端要用 sharp 逐张转换，
 * 在 2C2G 机器上会长时间占用 CPU —— 反而制造新的负载峰值。
 *
 * 策略：让 CDN 先做一次有损缩放（阿里云 OSS 的 x-oss-process），
 *       把 4.9MB 压到 ~23KB，再由 next/image 生成响应式 srcset。
 *       优化器输入的图小了两个数量级，开销可忽略。
 *
 * 不认识的图片域名（不含 x-oss-process 支持）原样返回，
 * 届时由 next/image 兜底优化，不会更差。
 */
const OSS_HOSTS = new Set(['cdn.icirena.ai', 'media.grabticks.com']);

/**
 * 本地海报的对外域名（图片专用子域，可选）
 *
 * ★ 为什么需要它（2026-09-19 实测）：
 *
 *   本站的 HTML/JS 走 Cloudflare（橙云）没问题 —— 首页压缩后仅 7KB。
 *   但**海报不能走 CF**：CF 免费版没有大陆节点，把大陆用户导到西雅图。
 *   实测 16 张海报全部加载完（6 并发，即真实浏览器行为）：
 *     经 CF    1.05–1.46s（吞吐 23–75KB/s）
 *     直连香港 0.18–0.47s（157–253KB/s）→ 快 2.3–5.8 倍
 *
 *   对比参照：hkmovie6 的海报秒开，因为它在 Amazon S3 ap-east-1（香港），
 *   走香港节点，不经过 CF。
 *
 * 做法：另开一个**灰云**子域（CF 面板里云朵图标点成灰色 = 仅 DNS，
 *   流量不经 CF），指向香港源站；海报改用它，HTML/JS 仍走主域（保留 CF 防护）。
 *
 * 配置方式：环境变量 NEXT_PUBLIC_POSTER_ORIGIN（如 https://img.yuurei.de）。
 *   未设置时为空字符串 → 海报保持同源 /posters/*.webp（当前行为），
 *   因此本次改动在设置变量前**完全无副作用**，可安全先合并再切换。
 *
 * 为什么用 NEXT_PUBLIC_ 前缀：这是构建期常量（静态导出会烤进 HTML），
 *   与既有的 NEXT_PUBLIC_SITE_URL 一致，见 deploy/rebuild-static.sh。
 */
const POSTER_ORIGIN = (process.env.NEXT_PUBLIC_POSTER_ORIGIN || '').replace(/\/+$/, '');

/** 拼出本地化海报的完整 URL（产物在 /posters/ 下） */
function posterUrl(name: string): string {
  return POSTER_ORIGIN ? `${POSTER_ORIGIN}/posters/${name}` : `/posters/${name}`;
}

/** 是否为本地化海报路径（含图片子域的情况） */
function isLocalPoster(p: string): boolean {
  return POSTER_ORIGIN
    ? p.startsWith(`${POSTER_ORIGIN}/posters/`)
    : p.startsWith('/posters/');
}

/**
 * 本地海报清单：原始 URL → public/posters/ 下的文件名
 *
 * ★ 为什么需要它（2026-09-19 实测，两个硬事实）：
 *
 *   1. www.mclcinema.com 对**用户侧网络完全不可达**：80/443 均超时，
 *      浏览器要挂满 20s 才放弃。而香港服务器 0.2s 就能取到。
 *      首页 60 张海报里有 28 张来自它 —— 即近半数图片不是「慢」，
 *      而是**永远加载不出来**。这是用户报「又慢又卡」的主因。
 *
 *   2. media.grabticks.com 的 x-oss-process **完全无效**
 *      （响应头是 Server: AmazonS3 / Via: cloudfront，不是阿里云 OSS）。
 *      原先下方给它拼的缩放参数是空操作，213 张海报每张 390KB–1.5MB
 *      原样下发，首页白背约 8.9MB。
 *
 * 解法：scripts/fetch-posters.mjs 在构建前把海报抓到服务器、
 *       转成 800w WebP 存进 public/posters/，页面引用同源 /posters/*.webp。
 *       实测 390KB → 45KB（省 88%），且同源静态文件会被 Cloudflare 边缘缓存。
 *
 * ★ 2026-09-20 由 400w 提到 800w：卡片实际渲染 268×401 CSS px，
 *   HiDPI 屏需要 536×802 物理像素，400w 是被放大显示的（必然发糊）。
 *   详见 scripts/fetch-posters.mjs 的 WIDTH 注释与实测 PSNR。
 *
 * 惰性读取（不是模块级常量）：readJson 定义在本文件下方，
 *   模块级求值会踩 TDZ。另外只需在 load() 里查一次表，本就无需提前。
 */
let _posterManifest: Record<string, string> | null = null;

function posterManifest(): Record<string, string> {
  if (_posterManifest) return _posterManifest;
  // quiet：清单可缺失（首次部署尚未跑抓图），属预期情况，不刷错误日志
  _posterManifest = readJson<Record<string, string>>('poster-manifest.json', {}, true);
  return _posterManifest;
}

/**
 * 缩略图路径映射：原始 URL → /posters/xxx-t.webp
 *
 * ★ 为什么需要缩略图：
 *   影院页（app/cinema/[id]/page.tsx）把海报渲染在 32×48px 的位置，
 *   却引用了 800w 主图。实测单页 52 张 × 28KB ≈ 1.43MB，而 64w 缩略图
 *   只要 ~1KB —— 单张浪费约 25 倍，全站 42 个影院页共引用 6094 张。
 *
 * ★ 为什么要在此校验文件存在（而不是直接拼字符串）：
 *   缩略图由 scripts/fetch-posters.mjs 生成，命名规则是主图名插 `-t`。
 *   若某张图的缩略图生成失败而主图成功，直接拼路径会得到 404 ——
 *   页面会显示碎图。这里在**构建期**（load() 只跑一次，不进请求路径）
 *   用 existsSync 确认，缺失则不提供条目，页面自然回退到主图。
 *
 * 目录解析：next 构建时 cwd 就是项目根，public/posters 即产物源。
 *   可用 POSTER_DIR 覆盖（部署环境与本地不一致时）。
 */
let _posterThumbs: Record<string, string> | null = null;
/** 已确认存在的缩略图路径集合，供 posterThumbPath 做 O(1) 判断 */
let _posterThumbSet: Set<string> | null = null;

function posterThumbMap(): Record<string, string> {
  if (_posterThumbs) return _posterThumbs;
  const out: Record<string, string> = {};
  const set = new Set<string>();
  try {
    const dir = process.env.POSTER_DIR || path.join(process.cwd(), 'public', 'posters');
    for (const [url, name] of Object.entries(posterManifest())) {
      const thumb = name.replace(/\.webp$/, '-t.webp');
      if (thumb === name) continue;
      if (fs.existsSync(path.join(dir, thumb))) {
        const p = posterUrl(thumb);
        out[url] = p;
        set.add(p);
      }
    }
  } catch {
    /* 目录不存在（如尚未跑过抓图）→ 全部回退主图，不影响页面 */
  }
  _posterThumbs = out;
  _posterThumbSet = set;
  return out;
}

/**
 * 取海报的**缩略图**路径（列表小图用）。
 *
 * 入参是已本地化的海报路径（/posters/xxx.webp）。
 * 找不到缩略图或入参是远端 URL 时，原样返回 —— 调用方无需分支。
 *
 * 用 Set 做 O(1) 判断而不是扫 map：影院页单页最多 52 张图，
 * 线性扫会退化成 O(n²)（实测该页 202 个 img 标签）。
 */
export function posterThumbPath(poster: string | null | undefined): string | null {
  if (!poster) return null;
  // 本地化海报可能是同源 /posters/... 或图片子域 https://img.../posters/...
  if (!isLocalPoster(poster)) return poster;
  posterThumbMap(); // 确保 _posterThumbSet 已初始化
  const name = poster.replace(/^.*\/posters\//, '');
  const thumbName = name.replace(/\.webp$/, '-t.webp');
  const thumb = posterUrl(thumbName);
  return _posterThumbSet?.has(thumb) ? thumb : poster;
}

/**
 * 海报主色表：本地海报文件名 → #rrggbb
 *
 * ★ 由 scripts/poster-colors.mjs 在构建前生成（见该脚本的注释）。
 *   键是**主图文件名**而不是原始 URL：读取层手里拿到的是已本地化的
 *   /posters/xxx.webp（见 slimPoster），从路径反推文件名是纯字符串操作，
 *   不必再反查一张 URL 表。
 *
 * 惰性读取 + 缺文件降级为空表：主色只是「锦上添花」的视觉信息，
 *   取色脚本没跑过（首次部署）时页面必须照常渲染，
 *   因此这里 quiet 读、缺失即返回 null，由组件决定回退。
 */
let _posterColors: Record<string, string> | null = null;

function posterColors(): Record<string, string> {
  if (_posterColors) return _posterColors;
  _posterColors = readJson<Record<string, string>>('poster-colors.json', {}, true);
  return _posterColors;
}

/**
 * 取本地海报的主色（`#rrggbb`），取不到返回 null。
 *
 * 入参是**已本地化**的海报路径（/posters/xxx.webp 或图片子域的同名路径）。
 * 远端 URL、无主色记录、主色文件缺失一律返回 null —— 调用方
 * （components/MovieIntro.tsx）据此回退到模糊光晕背景，无需自己分支。
 */
export function posterAccent(poster: string | null | undefined): string | null {
  if (!poster || !isLocalPoster(poster)) return null;
  const name = poster.replace(/^.*\/posters\//, '');
  return posterColors()[name] ?? null;
}

function slimPoster(url: string | null, width: number): string | null {
  if (!url) return null;

  // ★ 优先用本地化海报：同源、已转 WebP、体积小一个数量级。
  //   未命中（新片还没跑抓图 / 抓取失败）则回退到下面的远端逻辑，
  //   保证页面不会白图。
  const local = posterManifest()[url];
  if (local) return posterUrl(local);

  try {
    const u = new URL(url);
    if (!OSS_HOSTS.has(u.hostname)) return url;
    // 已带处理参数则不再追加
    if (u.searchParams.has('x-oss-process')) return url;
    u.searchParams.set('x-oss-process', `image/resize,w_${width}/format,webp`);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * 读取本地 WebP 的实际像素宽（只看文件头，不解码整图）。
 *
 * ★ 为什么要读文件头而不是「按文件名推断」：
 *   fetch-posters.mjs 用 `withoutEnlargement` 缩放，文件名里的宽度是
 *   **目标**宽度。源图小于目标时（MCL 只有 290×390）产物仍是 290，
 *   文件名却说 800 —— 按文件名比大小会把 290w 当成 800w，
 *   于是「挑最清晰的海报」完全失效。文件头里的才是真值。
 *
 * 只在构建期跑一次（~300 个文件，每个读 30 字节），不进请求路径。
 */
function readWebpWidth(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(30);
    if (fs.readSync(fd, b, 0, 30, 0) < 30) return null;
    // RIFF....WEBP
    if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return b.readUInt16LE(26) & 0x3fff; // 有损：14 位宽
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21); // 无损：14 位宽 + 14 位高
      return (bits & 0x3fff) + 1;
    }
    if (chunk === 'VP8X') return (b[24] | (b[25] << 8) | (b[26] << 16)) + 1; // 扩展：24 位
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch { /* 忽略 */ }
  }
}

/**
 * 本地海报的真实像素宽：**本地海报路径** → 宽度
 *
 * ★ key 必须是本地路径（posterUrl(name)）而不是原始 URL：
 *   load() 在分组之前就把 m.poster 改写成了本地路径（见 slimPoster），
 *   所以 pickDisplayPoster 拿到的是 /posters/xxx.webp。
 *   若按原始 URL 建表，查找永远 miss，整个「挑最清晰海报」静默失效。
 *
 * 惰性 + memo：load() 只跑一次，但分组函数可能被多次调用。
 */
let _posterWidths: Map<string, number> | null = null;

function posterWidths(): Map<string, number> {
  if (_posterWidths) return _posterWidths;
  const out = new Map<string, number>();
  try {
    const dir = process.env.POSTER_DIR || path.join(process.cwd(), 'public', 'posters');
    for (const name of Object.values(posterManifest())) {
      const w = readWebpWidth(path.join(dir, name));
      if (w) out.set(posterUrl(name), w);
    }
  } catch {
    /* 目录不存在（尚未跑抓图）→ 全部按未知处理，回退到 primary 的海报 */
  }
  _posterWidths = out;
  return out;
}

/**
 * 选组的展示海报：**原版优先，其次 IMAX，最后才轮到其他格式版**。
 *
 * ★ 2026-09-21 用户定的规则（原话）：
 *   「当一部电影有多版本的时候，优先显示原版的海报，没有原版海报就用 IMAX 的
 *     海报。两者都没有才能选择其他版本的海报」
 *   这里的「原版」= 香港官方宣传海报，即院线为**普通场次**挂的那张
 *   （片名不带任何格式/语言/活动标记，见 isBaseVersion）。
 *
 * 为什么原版优先压过「最清晰」（2026-09-20 那版是纯按分辨率挑的）：
 *   同一部片不同版本的宣传物料**画面本身就不一样**，不是同一张图的不同大小。
 *   实测（线上数据，均取自各院线官方条目）：
 *     - 生化危機：原版是「门框倒吊」主视觉；IMAX 版整张换成
 *       「FILMED FOR IMAX」街头奔跑图 + 金色 IMAX 大字，且分辨率并不更高。
 *     - 奧德賽：原版（百老匯）是「森林巨人阵」；IMAX 版是「独眼巨人火海」
 *       —— 后者其实更抓眼，但仍按用户规则让位给原版。
 *     - CHIIKAWA：4DX 版在整张画面上压了巨大的黄色 4DX 字。
 *   也就是说「挑最清晰的那张」会顺带把封面换成带 IMAX / 4DX 角标的另一套物料，
 *   卡片一眼看去像在推特殊制式，而不是在介绍这部电影。
 *
 * 分层（tier 越小越优先）：
 *   0 原版        —— 片名里**完全没有**版本/语言/活动标记的条目
 *   1 IMAX        —— 原版缺失时的兜底（IMAX 物料通常仍是官方主视觉的变体）
 *   2 其他格式版  —— 4DX / MX4D / LUXE / 全景聲 / 菲林版 / 日語版 / 特典場…
 *
 * ★ 判「原版」用的是 hasFormatMarker（看原始片名），不是 isBaseVersion。
 *   后者会把 bestar 的「劇場版 CHIIKAWA 人魚島的秘密 (日)」算作原版 ——
 *   可那张海报上印着「日語版 JAPANESE VERSION」横幅，与 broadway 的
 *   「(日語版)」是同一套物料。详见 lib/versions.ts 里 hasFormatMarker 的注释。
 *
 * 同层内的排序：先比**片名纯净度**，再比清晰度。
 *
 * ★ 为什么纯净度要排在清晰度前面（2026-09-21，用户报「为何这张是 IMAX 的」）：
 *   只看清晰度会在同层里撞上**冠名物料**。实测《復仇者聯盟4》同层全是 800w，
 *   而 emperor 有一条名字叫「(IV) 復仇者聯盟4：終局之戰 加碼重映」——
 *   emperor 的 `(IV)` 是 Infinity Vision 的缩写，那张图顶上压着一条
 *   彩色 Infinity Vision 横带；而「復仇者聯盟4：終局之戰 加碼重映」那张
 *   （MCU 神級英雄集結…9.24 見證傳奇）才是香港官方海报。
 *   两张同宽，只能靠「谁的名字更素」来分：纯净度 = 片名里被剥掉的字符数，
 *   越小越接近裸片名。
 *
 * ★ 同时也修了顺序依赖：原先同档同宽时用 `<=` 保留先到的，
 *   而 `list` 的顺序来自抓取次序 —— 同一份数据换个遍历顺序就换一张封面，
 *   不可复现。现在同档同宽同纯净度时保留先到的（稳定），
 *   但纯净度这一层已经把「冠名版 vs 官方版」分开了，不再看运气。
 *
 * 唯一一处「不照原版优先」的例外：**未本地化的远端 URL**。
 *   海报本地化（scripts/fetch-posters.mjs）存在的唯一原因就是
 *   www.mclcinema.com 对用户侧网络完全不可达 —— 页面直接引用它等于裂图。
 *   所以若某组的原版条目没被本地化（源站 404 / 下载失败），而组里
 *   另有已本地化的 IMAX 或其他格式海报，宁可给一张能打开的 IMAX 图，
 *   也不给一张永远转圈的原版图。
 *   正常情况下抓图跑在构建之前，所有能拿到的海报都是本地路径，
 *   这条例外根本不会触发。
 *
 * 只影响**展示用**海报，不动 primary：primary 还决定 slug 与
 *   displayName，换掉会让线上已有链接失效。
 */
function posterTier(m: Movie): number {
  const name = m.nameZh || m.nameEn;
  if (!hasFormatMarker(name)) return 0;
  return extractFormats(name).includes('IMAX') ? 1 : 2;
}

/**
 * 片名纯净度：被剥掉的字符数（越小越接近裸片名）。
 *
 * 用「剥掉的字符数」而不是「命中了几个 token」：前者能一并盖住
 * emperor 的 `(IV)`（它是 Infinity Vision 缩写，但走的是
 * preprocessTitle 里「括号内罗马序号」那条剥离规则，不在 FORMAT_TOKENS 里，
 * 所以按 token 数根本数不到它）。
 */
function nameNoise(m: Movie): number {
  const name = m.nameZh || m.nameEn || '';
  return Math.max(0, name.length - stripFormats(name).length);
}

// 海报卡约 268 CSS px 宽，2× 屏幕需 536px；留少量余量，把低于 600px 视为偏糊。
const POSTER_SHARP_WIDTH = 600;

/** 同片中、去掉版本/活动标记后的名字，用于跨状态寻找清晰替代海报。 */
function posterTitleKeys(movie: Movie): Set<string> {
  const keys = new Set<string>();
  for (const raw of [movie.nameZh, movie.nameEn]) {
    if (!raw) continue;
    // MCL 偶尔将谢票场作为单独条目，但对应主视觉与电影本身相同。
    const title = raw.normalize('NFKC').replace(/(?:謝票場|谢票场)\s*$/, '').trim();
    const key = normalizeTitle(title) || fallbackTitle(title);
    if (key) keys.add(key);
  }
  return keys;
}

function posterFallbackIndex(movies: Movie[], widths: Map<string, number>): Map<string, Movie[]> {
  const index = new Map<string, Movie[]>();
  for (const movie of movies) {
    const width = movie.poster ? widths.get(movie.poster) : undefined;
    if (!movie.poster || width == null || width < POSTER_SHARP_WIDTH) continue;
    if (projectionFormats(extractFormats(movie.nameZh || movie.nameEn)).length > 0) continue;
    for (const key of posterTitleKeys(movie)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(movie);
      else index.set(key, [movie]);
    }
  }
  return index;
}

/**
 * 首选海报低于清晰度阈值时，尝试用同片高分辨率的原版/纯语言版海报补位。
 * IMAX、4DX 等独立主视觉不作为清晰度替代，避免为了像素数换错宣传图。
 * 纯函数独立导出，部署前探针可覆盖阈值与候选边界。
 */
export function pickPosterWithResolutionFallback(
  list: Movie[],
  fallbackCandidates: Movie[],
  widths: Map<string, number>,
): string | null {
  const preferred = pickPosterByTier(list, widths);
  if (!preferred) return null;
  const preferredWidth = widths.get(preferred);
  if (preferredWidth != null && preferredWidth >= POSTER_SHARP_WIDTH) return preferred;

  const keys = new Set(list.flatMap((movie) => [...posterTitleKeys(movie)]));
  if (!keys.size) return preferred;

  const candidates = new Map<string, { tier: number; width: number; noise: number }>();
  for (const movie of fallbackCandidates) {
    const poster = movie.poster;
    const width = poster ? widths.get(poster) : undefined;
    if (!poster || width == null || width < POSTER_SHARP_WIDTH) continue;
    if (projectionFormats(extractFormats(movie.nameZh || movie.nameEn)).length > 0) continue;
    if (![...posterTitleKeys(movie)].some((key) => keys.has(key))) continue;

    const tier = hasFormatMarker(movie.nameZh || movie.nameEn) ? 1 : 0;
    const noise = nameNoise(movie);
    const old = candidates.get(poster);
    if (!old || tier < old.tier || (tier === old.tier && width > old.width) ||
      (tier === old.tier && width === old.width && noise < old.noise)) {
      candidates.set(poster, { tier, width, noise });
    }
  }

  const clearer = [...candidates.entries()].sort((a, b) =>
    a[1].tier - b[1].tier || b[1].width - a[1].width ||
    a[1].noise - b[1].noise || a[0].localeCompare(b[0])
  )[0];
  return clearer?.[0] ?? preferred;
}

function pickDisplayPoster(
  list: Movie[],
  primary: Movie,
  fallbacks: Map<string, Movie[]>,
  widths: Map<string, number>,
): string | null {
  const candidates = new Map<string, Movie>();
  for (const movie of list) {
    for (const key of posterTitleKeys(movie)) {
      for (const candidate of fallbacks.get(key) ?? []) {
        if (candidate.poster) candidates.set(candidate.poster, candidate);
      }
    }
  }
  return pickPosterWithResolutionFallback(list, [...candidates.values()], widths) ?? primary.poster;
}

/**
 * 选海报的纯函数核心：不读文件系统，宽度表由调用方传入。
 *
 * 拆出来只为了让 probe/check-poster-pick.mts 能在部署自检里钉死这套规则
 * （规则全是取舍，改错了没人看得出来，只会静默换封面）。
 */
export function pickPosterByTier(list: Movie[], widths: Map<string, number>): string | null {
  let best: string | null = null;
  let bestTier = Number.POSITIVE_INFINITY;
  let bestNoise = Number.POSITIVE_INFINITY;
  let bestW = Number.NEGATIVE_INFINITY;
  let bestLocal = false;

  for (const m of list) {
    if (!m.poster) continue;
    const tier = posterTier(m);
    const noise = nameNoise(m);
    const local = widths.has(m.poster);
    const w = local ? widths.get(m.poster)! : -1;

    if (best != null) {
      if (bestLocal !== local) {
        // 未本地化的一律让位（见上方例外说明）
        if (!local) continue;
      } else if (tier !== bestTier) {
        if (tier > bestTier) continue;
      } else if (noise !== bestNoise) {
        if (noise > bestNoise) continue;
      } else if (w <= bestW) {
        continue;
      }
    }

    best = m.poster;
    bestTier = tier;
    bestNoise = noise;
    bestW = w;
    bestLocal = local;
  }

  return best;
}

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const candidates = [
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), '.next', 'standalone', 'data'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'movies.json'))) return dir;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

const DATA_DIR = resolveDataDir();

function readJson<T>(file: string, fallback: T, quiet = false): T {
  try {
    const p = path.join(DATA_DIR, file);
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (e) {
    // 数据缺失时降级为空，避免整站 500
    //
    // quiet：用于**本来就可以不存在**的文件（enrich.json / enrich-manual.json）。
    // 不静默的话，读取层缓存每 60s 刷一次就刷一行错，真正的抓取事故会被埋掉。
    if (!quiet) console.error(`[data] 读取 ${file} 失败:`, (e as Error).message);
    return fallback;
  }
}

// 进程内缓存：避免每次请求都读盘
let _cache: {
  movies: Movie[];
  shows: Show[];
  cinemas: Cinema[];
  meta: Meta;
  enrich: Record<string, EnrichEntry>;
  at: number;
} | null = null;

// 默认 60 秒。
//
// 取值权衡：
//  - 太长：读取层的「剔除已开映场次」过滤会滞后，用户会看到刚过点的场次
//  - 太短：275+ 部影片的 JSON 要反复解析，2C2G 机器上白烧 CPU
// 60 秒是折中 —— 过期场次最多多留 1 分钟，且每分钟只重解析一次。
// 抓取脚本写完后会重启服务，缓存自然失效。
const CACHE_TTL_MS = Number(process.env.DATA_CACHE_TTL_MS ?? 60_000);

function load() {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache;

  const movies = readJson<Movie[]>('movies.json', []);
  const shows = readJson<Show[]>('shows.json', []);
  // 英皇 API 把灣仔總部辦公室（57001）列作「影院」，實際沒有放映廳或場次。
  // 讀取時排除，避免戲院列表及靜態戲院頁把辦公地址誤當無標籤戲院。
  const cinemas = readJson<Cinema[]>('cinemas.json', []).filter((c) => c.id !== 'emperor-57001');

  // ★ 戲院地理归属：读取时推断（见 lib/region.ts 的说明）
  //
  // 为什么放在这里而不是抓取器：推断是「戲院名 + 地址 → 大區/十八區」的纯函数，
  // 结果与抓取时点无关。放在读取层意味着：改映射表只需重启，不必重跑抓取。
  for (const c of cinemas) {
    const geo = inferGeo(c.nameZh, c.address);
    c.region = geo.region;
    c.district = geo.district;

    // ★ 戲院顯示名修正：必须在 inferGeo **之后**（见 lib/cinema-names.ts 的说明）。
    //   region.ts 的两张表仍以原始名索引，先把地理归属算完，再换成展示名，
    //   这样改名不必连 region.ts 的表一起维护。未列出的戲院原样保留。
    const display = CINEMA_DISPLAY_NAME[c.id];
    if (display) c.nameZh = display;
    // 原始名可能带首尾空白 / 换行（MCL「MCL THE ONE 戲院\n」实测如此），
    // 直接渲染会在标题里多出一个空行，统一清掉。
    c.nameZh = c.nameZh.trim();
  }

  // ★ 戲院影廳規格：同样在读取时推断（见 lib/cinema-specs.ts 的说明）
  //
  // 必须等 movies / shows 都读完之后：百老匯系的规格只写在**片名**里
  // （「IMAX 生化危機」），单看戲院与影厅名（「5院」）什么都推不出来。
  // 这里先把 movieId → 片名 建好索引，避免在内层循环里反复 find。
  const movieTitleById = new Map<string, string>();
  for (const m of movies) movieTitleById.set(m.id, m.nameZh || m.nameEn || '');

  const specsByCinema = new Map<string, Set<string>>();
  // 官方戲院資料列明電影中心 1 院採用 SR、2–4 院採用 SRD；此規格不會出現在場次欄位，
  // 以穩定戲院 ID 注入，不能從普通場次名稱或電影名猜測。
  specsByCinema.set('broadway-8', new Set(['sr', 'srd']));
  // PALACE ifc 官方影廳資料列明 H5 採用 DTS:X；其餘影廳為 Dolby 7.1。
  specsByCinema.set('broadway-4', new Set(['dtsx']));
  for (const s of shows) {
    const keys = hallSpecsOf({
      houseName: s.houseName,
      version: s.version,
      title: movieTitleById.get(s.movieId) ?? '',
    });
    if (!keys.length) continue;
    let set = specsByCinema.get(s.cinemaId);
    if (!set) specsByCinema.set(s.cinemaId, (set = new Set()));
    for (const k of keys) set.add(k);
  }
  for (const c of cinemas) c.specs = sortSpecs([...(specsByCinema.get(c.id) ?? [])]);

  // 海报瘦身：只在载入时做一次，随后进缓存（不重复解析 URL）
  // 命中本地清单则改为同源 /posters/*.webp（见 slimPoster 注释）
  for (const m of movies) {
    if (m.poster) m.poster = slimPoster(m.poster, 400);
  }

  // slug 兜底规范化：存量数据里可能残留中文 slug（来自无英文名的 MCL 条目），
  // 中文 slug 在 /movie/[slug] 下会 404，这里统一替换为 ASCII 形式，
  // 使旧数据无需重新抓取即可修复。
  for (const m of movies) {
    if (m.slug && !/^[A-Za-z0-9_-]+$/.test(m.slug)) {
      m.slug = asciiSlug(m.nameEn, m.nameZh, m.id);
    }
  }

  const meta = readJson<Meta>('meta.json', {
    lastUpdated: new Date().toISOString(),
    sources: [],
    counts: { movies: 0, showing: 0, upcoming: 0, cinemas: 0, shows: 0 },
    errors: [],
    durationMs: 0,
  });

  // ★ 外部补充数据（IMDb 评分 + 人工覆盖）
  //
  // 与场次一样进缓存；文件缺失时降级为空对象，
  // enrich 还没跑过（首次部署）时页面依旧正常，只是不显示评分。
  const enrichFile = readJson<{ entries?: Record<string, EnrichEntry> }>('enrich.json', {}, true);
  const enrich = enrichFile.entries || {};
  // 人工覆盖单独一份：不被 enrich.js 重写，改完只需重建
  const manualFile = readJson<Record<string, NonNullable<EnrichEntry['manual']>>>('enrich-manual.json', {}, true);
  for (const [k, v] of Object.entries(manualFile)) {
    if (!v) continue;
    const row = enrich[k] || (enrich[k] = { key: k });
    row.manual = { ...row.manual, ...v };
  }
  // 人工只给了分数时直接当评分用（自动匹配失败时的唯一出路）
  for (const row of Object.values(enrich)) {
    const mm = row?.manual;
    if (!mm) continue;
    if (mm.rating != null && row.imdb?.rating == null) {
      row.imdb = { ...(row.imdb || {}), imdbId: mm.imdbId || null, rating: mm.rating, votes: mm.votes ?? null };
    }
  }

  // ★ 剔除已开映的场次
  //
  // 背景：抓取每 2–6 小时才跑一次，中间已开映的场次会一直留在页面上，
  // 用户会看到「早上 10 点的场次下午还在」。抓取频率不能解决这个，
  // 必须在**读取时**按当前时间实时过滤。
  //
  // 注意：只过滤场次，不过滤电影 —— 今天已散场的电影仍应出现在列表中，
  // 只是场次归零（首页会自然排到最后）。
  //
  // ★ 2026-09-22：規則抽到 lib/live.ts 的 isLiveShow()，與客戶端共用。
  //   這裡仍是**構建時**的過濾（構建後才開映的場次它管不到）——
  //   真正的實時剔除由客戶端組件負責，見 lib/live.ts 的完整說明。
  const liveShows = shows.filter((s) => isLiveShow(s.startAt, now));

  _cache = { movies, shows: liveShows, cinemas, meta, enrich, at: now };
  return _cache;
}

/**
 * 站点元数据
 *
 * counts.cinemas 以已剔除非放映地址的戲院清單為準，避免首頁及頁尾
 * 沿用抓取時包含英皇總部的原始數字。
 * 注意 counts.shows 会被改写为「当前有效（未开映）场次数」。
 * 抓取写入的 meta.counts.shows 是当时抓到的总数，
 * 而页面展示的场次已按当前时间剔除过期项，
 * 不修正的话页脚数字会和实际看到的场次数对不上。
 */
export function getMeta(): Meta {
  const { meta, shows, cinemas } = load();
  return {
    ...meta,
    counts: { ...meta.counts, shows: shows.length, cinemas: cinemas.length },
  };
}

export const SOURCE_LABEL: Record<Source, string> = {
  broadway: '百老匯',
  mcl: 'MCL',
  emperor: '英皇',
  cinemacity: 'Cinema City',
  bestar: '星達',
};

/** 院线展示顺序（按规模） */
const SOURCE_ORDER: Source[] = ['broadway', 'mcl', 'emperor', 'cinemacity', 'bestar'];

/**
 * 是否含中日韩字符
 * 注意：不能用 /g 标志 —— 带 g 的正则在 .test() 之间会保留 lastIndex，
 * 连续调用会给出错误结果。
 */
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 香港电影官方分级（严格匹配）
 * 卡片左上角只能展示这里枚举里的值，否则会误把 emperor 的 1–10 评分当成分级。
 */
const HK_RATINGS = new Set(['I', 'IIA', 'IIB', 'III']);

/**
 * 选择组的展示分级
 *
 * 各源 category 字段含义不同：
 *   - broadway / cinemacity / bestar / mcl：香港官方分级（I / IIA / IIB / III）
 *   - emperor：是 1–10 媒体评分（不是分级）
 *   - MCL 分級來自官方 GetMovieDetails，舊資料可能仍為空
 *
 * 这里只接受 HK_RATINGS 里的值；广度优先从「最具分级权威的源」取。
 */
function pickDisplayCategory(list: Movie[]): string | null {
  for (const src of ['broadway', 'cinemacity', 'bestar', 'mcl'] as Source[]) {
    const hit = list.find((m) => m.source === src && m.category && HK_RATINGS.has(m.category));
    if (hit) return hit.category!;
  }
  return null;
}

/**
 * 选择组的展示语言
 *
 * 优先级：broadway.dialect（最完整） > 其他源的 dialect > emperor 的 subtitle（多为「中文」之类）
 * 返回首个非空值，长度截断防超宽。
 */
function pickDisplayLanguage(list: Movie[]): string | null {
  for (const m of list) {
    if (m.dialect && m.dialect.trim()) return m.dialect;
  }
  for (const m of list) {
    if (m.subtitle && m.subtitle.trim() && m.subtitle !== '無字幕') return m.subtitle;
  }
  return null;
}

/**
 * 选择组的展示英文片名（详情页中文标题下方那行副标题）
 *
 * ★ 2026-09-25 用户要求：「电影详情页的卡片，中文标题下面添加电影英文标题」。
 *
 * 页面本来就有一行副标题，但读的是 buildIntro 里
 *   group.primary.nameEn
 *   而 primary 是**按场次最多**选出来的代表条目 —— 场次最多的往往不是
 *   元数据最全的那家。实测两部片直接踩空：
 *     歡迎來龍餐館     primary = mcl-14858   → MCL 的 nameEn 是空 → 整行不渲染
 *     復仇者聯盟4       primary = mcl-14863   → 同上
 *   即「有没有英文副标题」取决于哪家院线场次多，同一部片换个抓取时点
 *   就可能时有时无（MCL 只给中文名，百老匯/英皇/星達都给英文）。
 *
 * 所以英文名必须像 displayPoster / displayCategory 一样做成**组级**决策：
 * 在组内所有条目里挑一条，而不是继承 primary。
 *
 * 挑选规则（按优先级）：
 *   1. 先洗掉版本 / 活动 / 影展噪声（stripEnglishTitleNoise）——
 *      「4DX Avengers: Endgame Encore Infinity Vision」洗完才是
 *      「Avengers: Endgame Encore」，否则副标题会带上放映规格。
 *   2. 原版条目（无格式标记）优先 —— 与 displayPoster 同一套取舍：
 *      带标记的条目英文名会被院线自己缀上规格词，洗完也可能残留。
 *   3. 按**院线可信度**取（broadway > emperor > cinemacity > bestar > mcl）：
 *      同一部片各家英文写法会差一点（大小写、副标题有无），
 *      实测「狂野雄心」是 Heart of the Beast / HEART OF THE BEAST 两种，
 *      挑权威那家的，不要随机撞上哪条就用哪条。
 *   4. 最后才比长度（短的通常更干净）。
 *
 * 与中文名相同 / 洗后为空 / 本身就是中文（bestar 会把中文塞进 nameEn）
 * 一律返回 null，调用方据此不渲染这一行。
 */
const EN_SOURCE_ORDER: Record<Source, number> = {
  broadway: 0,
  emperor: 1,
  cinemacity: 2,
  bestar: 3,
  mcl: 4,
};

function pickDisplayNameEn(list: Movie[]): string | null {
  const cands = list
    .map((m) => {
      const raw = (m.nameEn || '').trim();
      // ★ 长度下限是 1 而不是 2：单字母英文片名是真实存在的
      //   （《空槍》的官方英文名就是「V」，《M》就是「M」），
      //   门槛设 2 会把它们静默丢掉。而「洗完变空」的噪声条目
      //   （纯「IMAX」之类）自然被下一行的 name.length < 1 挡掉。
      //
      // ★ 这里用 CJK_RE 而不是下面那个 hasCJK：hasCJK 定义在本函数之后，
      //   用它会形成「函数定义早于依赖」的隐式顺序依赖（虽然本函数只在
      //   buildMovieGroups 里调用、那时模块已初始化完毕，但后人挪动代码
      //   顺序就会踩到 TDZ）。直接用正则，无顺序负担。
      if (raw.length < 1 || CJK_RE.test(raw)) return null;
      const name = stripEnglishTitleNoise(raw);
      if (name.length < 1) return null;
      return {
        name,
        base: !hasFormatMarker(m.nameZh || m.nameEn),
        src: EN_SOURCE_ORDER[m.source] ?? 9,
      };
    })
    .filter((c): c is { name: string; base: boolean; src: number } => c !== null);

  if (!cands.length) return null;
  cands.sort((a, b) => {
    if (a.base !== b.base) return a.base ? -1 : 1;
    if (a.src !== b.src) return a.src - b.src;
    return a.name.length - b.name.length;
  });
  return cands[0].name;
}

/**
 * 选择组的展示时长
 *
 * 时长在各源里差异不大（都是分钟数），优先取原版版本（versions 里 __base__ key 的那条），
 * 若没有再取 primary 的 duration。
 */
function pickDisplayDuration(list: Movie[], primary: Movie): number | null {
  // 原版条目优先
  const base = list.find((m) => isBaseVersion(m.nameZh || m.nameEn) && m.duration);
  if (base) return base.duration!;
  const withDur = list.find((m) => m.duration);
  return withDur?.duration ?? primary.duration ?? null;
}

/**
 * 选择组的展示导演 / 演員 / 類型 / 語言（中文优先）
 *
 * ★ 这不是多余功夫，而是数据真的分裂：
 *   broadway 存的是日文/英文人名（director="Yuuichi Fukuda"、
 *   cast="Ren Meguro, Fumiya Takahashi"），genres 也是 "Comedy"/"Action"；
 *   而 emperor / cinemacity / bestar（icirena 平台）存的是中文：
 *   「福田雄一」「目黑蓮、高橋文哉」、「動作/喜劇片」。
 *   以前详情页直接用 primary（场次最多的 broadway 条目），
 *   所以中文片名配上一串罗马拼音 —— 用户要的「导演和演员」其实就是这个。
 *
 * 做法统一为：**同义字段取第一个含 CJK 的值，没有再退回任意非空值**。
 * 不拼各源（会重复且长度不一），只选一个权威表述。
 */
const hasCJK = (s: string | null | undefined) => !!s && CJK_RE.test(s);

function pickCjkField(list: Movie[], get: (m: Movie) => string | null | undefined): string | null {
  for (const m of list) if (hasCJK(get(m))) return get(m)!.trim();
  for (const m of list) if (get(m)) return get(m)!.trim();
  return null;
}

/** 导演（多人用、分隔） */
function pickDisplayDirector(list: Movie[]): string | null {
  const raw = pickCjkField(list, (m) => m.director);
  if (!raw) return null;
  return raw
    .split(/[,，、;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('、');
}

/**
 * 演員
 *
 * icirena 系会给「主演：张三、李四」这种带前缀的写法，
 * 而卡片/表格只需要人名，所以去掉「xx：」前缀。
 */
function pickDisplayCast(list: Movie[], limit = 12): string[] {
  const raw = pickCjkField(list, (m) => m.cast);
  if (!raw) return [];
  return raw
    .replace(/^[^:：]{1,6}[:：]\s*/, '')
    .split(/[、,，;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** 類型（中文优先；各源分隔符不统一，这里归一后去重） */
/**
 * 類型：中文优先，英文走词表映射
 *
 * emperor / cinemacity / bestar 直接给中文（「劇情片」），
 * broadway 只给英文（占 195/385 条），所以必须自己翻（见 lib/genre-zh.ts）。
 * 注意不能因为某个源有中文就用它的列表了事 ——
 * 同一片的英文项可能多出一个「Sci-Fi」，译完合并才不会丢信息。
 */
function pickDisplayGenres(list: Movie[]): string[] {
  const merged: string[] = [];
  for (const m of list) for (const g of zhGenres(m.genres)) if (!merged.includes(g)) merged.push(g);
  // ★ 跨院线合并后必须再去一次父子标签：
  //   「音樂」（百老匯 Music）与「演唱會」（英皇）往往来自不同条目，
  //   在 zhGenres 内部看不到彼此，会以「音樂 / 演唱會」并列展示。
  return dropParents(merged);
}

/**
 * 語言细节（对白 + 字幕）
 *
 * 院线存的是**英文**语种名（"Cantonese,Mandarin" / "Chinese,English"），
 * 而界面是中文 —— 用 lib/lang-zh.ts 映射。没有豆瓣评分可用后，
 * 这是唯一的语言数据源，所以自己做翻译而不是指望外部补充。
 */
function pickDisplayLanguageDetail(list: Movie[]): { spoken: string | null; subtitle: string | null } {
  const spoken = pickCjkField(list, (m) => m.dialect);
  const sub = pickCjkField(
    list.filter((m) => m.subtitle && m.subtitle !== '無字幕'),
    (m) => m.subtitle
  );
  return {
    spoken: spoken ? zhLanguages(spoken).join(' / ') : null,
    subtitle: sub ? zhSubtitles(sub).join(' / ') : null,
  };
}

/**
 * 上映日期：组内最早的非空值（与 versions 里的口径一致）
 */
function pickDisplayOpening(list: Movie[]): string | null {
  const dates = list.map((m) => m.openingDate).filter(Boolean).sort();
  return dates[0] ?? null;
}

/**
 * 简介：院线官方文案（中文优先，各源里最长最完整的那份）
 */
function pickDisplayDescription(list: Movie[]): string | null {
  const cjk = list.find((m) => m.description && hasCJK(m.description) && m.description.length > 30);
  if (cjk) return cjk.description;
  const any = list.find((m) => m.description && m.description.length > 10);
  return any?.description ?? null;
}

// ============================================================
// 电影组（跨院线 + 跨版本聚合）
// ============================================================

/** 同一部电影的某个放映版本 */
export interface MovieVersion {
  /** 版本 key（格式组合，如 "imax" / "__base__"） */
  key: string;
  /** 版本标签，如 ['IMAX']；空数组表示原版 */
  formats: string[];
  /** 提供该版本的院线 */
  sources: Source[];
  /** 该版本涉及的源条目 id（每院线一条） */
  movieIds: string[];
  /** 场次数 */
  showCount: number;
  /** 最低票价 */
  minPrice: number | null;
  /** 上映日期 */
  openingDate: string | null;
  /** 详情页 slug（取该版本场次最多的条目） */
  slug: string;
}

/** 一部电影（含全部版本与院线） */
export interface MovieGroup {
  key: string;
  /** 代表影片（优先原版、元数据丰富） */
  primary: Movie;
  /** 展示用片名（已去除格式标记） */
  displayName: string;
  /**
   * 展示用**英文**片名（详情页中文标题下方的副标题）
   *
   * 组级决策，与 primary 无关（见 pickDisplayNameEn 注释：
   * primary 按场次最多选，而场次最多的院线可能压根不给英文名）。
   * 无可用英文名（或英文名就是中文）时为 null。
   */
  displayNameEn: string | null;
  /**
   * 展示用海报：组内**最清晰**的那张（见 pickDisplayPoster 注释）。
   *
   * 与 primary.poster 可能不同：MCL 只给 290×390，而同一部片在
   * 百老汇 / 英皇有 800×1125。卡片、详情页大图、JSON-LD 都应读这个字段。
   */
  displayPoster: string | null;
  /**
   * 展示海报的主色（`#rrggbb`），取不到为 null
   *
   * ★ 2026-09-24 用户要求「卡片背景填充改成网易云那样按海报取主题色」。
   *   由 scripts/poster-colors.mjs 在构建前算好（见 lib/data.ts 的
   *   posterAccent 注释），这里只做一次查表。
   *
   * 为什么挂在组上而不是让组件自己查：displayPoster 是**组级**决策
   *   （pickDisplayPoster 会在多个版本里挑），主色必须跟着那张被选中的图，
   *   组件层拿到的只是路径字符串，自己查会多一次路径→文件名的转换。
   */
  displayAccent: string | null;
  /** 全部版本 */
  versions: MovieVersion[];
  /** 总场次数 */
  totalShows: number;
  /** 最低票价 */
  minPrice: number | null;
  /** 涉及院线 */
  sources: Source[];
  /** 全部可用格式标签 */
  allFormats: string[];
  /** 详情页 slug */
  slug: string;
  status: 'showing' | 'upcoming';
  /**
   * 聚合后的香港电影分级（卡片左上角）
   * 来源：broadway / cinemacity / bestar / mcl 的香港官方分级。
   * emperor 源的 category 是 1–10 评分，不是官方分级，不参与
   */
  displayCategory: string | null;
  /** 聚合后的主语言（卡片右下角） */
  displayLanguage: string | null;
  /** 导演（中文优先，多人用、分隔） */
  displayDirector: string | null;
  /** 演員名单（中文优先，最多 12 人） */
  displayCast: string[];
  /** 類型（中文优先） */
  displayGenres: string[];
  /** 語言细节：对白语言 + 字幕（均已映射为中文，页面分开展示） */
  displayLanguageDetail: { spoken: string | null; subtitle: string | null };
  /** 上映日期（组内最早，与版本口径一致） */
  displayOpeningDate: string | null;
  /** 剧情简介（院线文案优先，中文） */
  displayDescription: string | null;
  /** 聚合后的时长（分钟），首选原版版本 */
  displayDuration: number | null;
  /**
   * 外部补充数据（IMDb 评分 + 人工覆盖）
   *
   * 由 data/enrich.json 按 enrichment key 叠加，无缓存时为 null。
   * 不放进 Movie 而是放在组上：一部电影在多家院线有多条 Movie，
   * 评分是「电影级」而非「条目级」的属性。
   */
  enrich: EnrichEntry | null;
}

/**
 * 构建电影组：按「归一化片名」聚合为电影，再按「放映格式」聚合为版本。
 *
 * 示例（《复仇者联盟4》）：
 *   电影组
 *     └─ 版本
 *          ├─ 原版    : 百老汇 + MCL + 英皇  → 场次合并
 *          ├─ IMAX    : 百老汇 + MCL
 *          ├─ 4DX     : 百老汇
 *          └─ 全景聲   : 百老汇
 *
 * 关键：同一格式在不同院线是独立条目，需合并为一个版本；
 *       不同格式必须分开，否则详情页的版本分类就没了。
 */
/**
 * 为一组条目找对应的补充数据
 *
 * 依次用组内每个条目的 nameZh / nameEn 算 key 去查，命中即返。
 * 之所以不只用 displayName：不同院线的片名写法不同（带不带 IMAX、
 * 中英文优先），而 enrich.js 建缓存时用的是「按条目算出的 key」，
 * 这里多试几个名字才能跟上。
 */
function findEnrich(list: Movie[], pool: Record<string, EnrichEntry>): EnrichEntry | null {
  for (const m of list) {
    for (const n of [m.nameZh, m.nameEn]) {
      if (!n) continue;
      const hit = pool[enrichKey(n)];
      if (hit) return hit;
    }
  }
  return null;
}

export function getMovieGroups(status?: 'showing' | 'upcoming'): MovieGroup[] {
  // ★ memo：分组要扫全部条目并逐个做片名归一，实测单跑 ~110ms（('showing')）。
  //   此前调用点都是页面级（首页 / 待映页 / 详情页各算一次），这个开销没被发现；
  //   影院页需要**逐场次条目**反查所属组（getGroupForMovieId），
  //   不缓存就是 条目数 × 110ms，静态导出直接超时。
  //   失效条件与 load() 一致：超过 CACHE_TTL_MS 重建。
  const ck = status ?? 'all';
  const hit = _groupsCache.get(ck);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.groups;

  const groups = buildMovieGroups(status);

  // ★ 「在映優先」：同一部片只要有任一條目在映，整組就歸 showing，
  //   不再出現在 /upcoming/（用戶 2026-09-23 指定）。
  //
  // 背景：status 過濾發生在 buildMovieGroups 的**第一步**（按片名分組之前），
  //   所以 upcoming 池只看得到該片的 upcoming 條目，看不到同片的 showing 條目，
  //   於是把它當成一部獨立待映片建組。緊接著的 canonicalSlugById() 又把 slug
  //   改寫成全量池的 slug —— 兩個池撞到同一個 slug，詳情頁（取全量池的
  //   status=showing）與 /upcoming/ 列表（upcoming 池）互相矛盾。
  //
  //   2026-09-23 實際踩到（probe/check-nav-category.mjs 在部署時攔下）：
  //     《善男信女》 broadway-1341(showing, 4 場) + broadway-1086(upcoming, 0 場)
  //     《怎麼可能我家的祖先是你家的鬼》 cinemacity/bestar(showing, 6 場)
  //                                       + broadway-1380(upcoming, 0 場)
  //   兩部片都同時出現在 /upcoming/ 與 /showing/，詳情頁卻只標 showing。
  //
  // 為什麼用「全量池的 status」而不是「本池條目有無場次」：
  //   全量池是 slug 的唯一權威（見下方 canonicalSlugById），詳情頁也是按
  //   全量池的組渲染的。要讓列表與詳情頁一致，判據必須同源，否則又是兩套邏輯。
  if (status === 'upcoming') {
    const showingIds = new Set<string>();
    for (const g of getMovieGroups()) {
      if (g.status !== 'showing') continue;
      for (const v of g.versions) for (const id of v.movieIds) showingIds.add(id);
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      const ids = groups[i].versions.flatMap((v) => v.movieIds);
      if (ids.some((id) => showingIds.has(id))) groups.splice(i, 1);
    }
  }

  // ★ slug 必须与「全量池」一致，否则卡片链接会指向不存在的静态页。
  //
  // 背景：`slug: primary.slug`，而 primary 是**在当前过滤池内**选出来的
  //   （isBaseVersion 优先，再比场次数）。同一部片若同时有 showing 与 upcoming
  //   条目，两个池选出的 primary 不同 —— 全量池 slug ≠ 待映池 slug。
  //   而 generateStaticParams 只取 getMovieGroups()（全量池）的 slug，
  //   于是待映页的卡片链接指向未生成的页面（dynamicParams = false，必然 404）。
  //
  //   2026-09-22 实际踩到：
  //     《善男信女》 broadway-1341(showing, 4 場) + broadway-1086(upcoming)
  //       全量池 → we-are-born-good-bc30-1341 ｜ 待映池 → we-are-born-good-1086
  //     《怎麼可能我家的祖先是你家的鬼》 cinemacity/bestar(showing) + broadway-1380(upcoming)
  //       全量池 → ...-cinemacity-ce259d270695 ｜ 待映池 → ...-1380
  //   共 3 条死链（首页 1 + 待映页 2），被 probe/check-published-links.mjs 拦下。
  //
  // 为什么只改 slug 而不整体复用全量池的组：池内其余字段（status、versions、
  //   totalShows、displayOpeningDate…）按设计就该反映**当前池**的数据
  //   —— 待映页要显示「上映日期」角标靠的就是 status === 'upcoming'。
  //   只有 slug 是「页面身份」，全站必须唯一。
  if (status) {
    const canon = canonicalSlugById();
    for (const g of groups) {
      const s = canon.get(g.primary.id);
      // 兜底：查不到就保留池内 slug。正常情况下 canonicalSlugById 覆盖
      // 全部 showing ∪ upcoming 条目，取不到说明分组逻辑有洞，
      // 那时宁可留下旧行为也不要静默改成空字符串（会让链接变成 /movie/undefined）。
      if (s) g.slug = s;
    }
  }

  _groupsCache.set(ck, { at: now, groups });
  return groups;
}

/**
 * 条目 id → 该组在「全量池」里的 slug
 *
 * 全量池是 slug 的唯一权威：generateStaticParams、sitemap 都用它，
 * 所有卡片链接也必须收敛到它（见 getMovieGroups 的说明）。
 *
 * 这里直接调 getMovieGroups()（无参）而不是复用 groupIndex()：
 * groupIndex 的 slug 来自 showing/upcoming 两个池，正是要修掉的那个不一致。
 */
function canonicalSlugById(): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of getMovieGroups()) {
    for (const v of g.versions) for (const id of v.movieIds) map.set(id, g.slug);
  }
  return map;
}

const _groupsCache = new Map<string, { at: number; groups: MovieGroup[] }>();

function buildMovieGroups(status?: 'showing' | 'upcoming'): MovieGroup[] {
  const { movies, shows, enrich: enrichPool } = load();
  const posterWidthMap = posterWidths();
  const highResolutionPosterIndex = posterFallbackIndex(movies, posterWidthMap);

  // ---------- 预统计：每个源条目的场次数与最低价 ----------
  const showCount = new Map<string, number>();
  const minPrice = new Map<string, number>();
  for (const s of shows) {
    if (!s.movieId) continue;
    showCount.set(s.movieId, (showCount.get(s.movieId) || 0) + 1);
    if (s.price != null) {
      const cur = minPrice.get(s.movieId);
      if (cur == null || s.price < cur) minPrice.set(s.movieId, s.price);
    }
  }

  // ---------- 第一步：按归一化片名聚合为「电影」 ----------
  const movieGroups = new Map<string, Movie[]>();
  for (const m of movies) {
    if (status && m.status !== status) continue;
    const name = m.nameZh || m.nameEn;
    // ★ 兜底：片名被剔成空串时退回「只去标点」的形式。
    //   不留兜底会直接 continue，整部电影静默从页面上消失。
    const key = normalizeTitle(name) || fallbackTitle(name);
    if (!key) continue;

    const bucket = movieGroups.get(key);
    if (bucket) bucket.push(m);
    else movieGroups.set(key, [m]);
  }

  // ---------- 第一步 b：跨语言合并（中文组 + 纯英文组）----------
  //
  // 背景：部分院线（如 bestar）只提供英文名，nameZh 里存的就是英文；
  // 其他院线用中文名。归一化后 key 不同，同一部电影会分裂成两组，
  // 页面上出现「一个中文标题 + 一个英文标题」的重复卡片。
  //
  // 做法：若某组的英文名与另一组相同，且其中一组是纯英文（无中文名），
  //       就把纯英文组并入含中文的那组。
  //       只在「一组纯英文」时合并，避免把英文名恰好相同的不同电影误并。
  const aliasToKeys = new Map<string, Set<string>>();
  for (const [key, list] of movieGroups) {
    const aliases = new Set<string>();
    for (const m of list) {
      // 英文名（含 nameZh 本身是英文的情况）
      for (const raw of [m.nameEn, m.nameZh]) {
        if (!raw) continue;
        const n = normalizeTitle(raw);
        if (n && !CJK_RE.test(n)) aliases.add(n);
      }
    }
    for (const a of aliases) {
      const set = aliasToKeys.get(a);
      if (set) set.add(key);
      else aliasToKeys.set(a, new Set([key]));
    }
  }

  for (const [, keys] of aliasToKeys) {
    if (keys.size !== 2) continue; // 只处理明确的两组情形，降低误并风险
    const [a, b] = [...keys];
    const aZh = CJK_RE.test(a);
    const bZh = CJK_RE.test(b);
    // 需要恰好一组含中文、另一组为纯英文
    if (aZh === bZh) continue;
    const zhKey = aZh ? a : b;
    const enKey = aZh ? b : a;

    const zhList = movieGroups.get(zhKey);
    const enList = movieGroups.get(enKey);
    if (!zhList || !enList) continue;

    // 并入中文组，保留中文 key 作为展示名
    zhList.push(...enList);
    movieGroups.delete(enKey);
  }

  const result: MovieGroup[] = [];

  for (const [key, list] of movieGroups) {
    // ---------- 第二步：按「放映格式组合」聚合为「版本」 ----------
    const versionMap = new Map<string, Movie[]>();

    for (const m of list) {
      const formats = sortFormats(extractFormats(m.nameZh || m.nameEn));
      const vKey = formats.length ? formats.join('|').toLowerCase() : '__base__';
      const bucket = versionMap.get(vKey);
      if (bucket) bucket.push(m);
      else versionMap.set(vKey, [m]);
    }

    // ---------- 第三步：构建版本列表 ----------
    const versions: MovieVersion[] = [];

    for (const [vKey, items] of versionMap) {
      const formats = sortFormats(extractFormats(items[0].nameZh || items[0].nameEn));
      const totalShows = items.reduce((n, m) => n + (showCount.get(m.id) || 0), 0);
      const prices = items
        .map((m) => minPrice.get(m.id))
        .filter((p): p is number => p != null);

      // 代表条目：场次最多（用于 slug）
      const best = [...items].sort(
        (a, b) => (showCount.get(b.id) || 0) - (showCount.get(a.id) || 0)
      )[0];

      // 上映日期：取最早的非空值
      const dates = items.map((m) => m.openingDate).filter(Boolean).sort();

      versions.push({
        key: vKey,
        formats,
        sources: [...new Set(items.map((m) => m.source))] as Source[],
        movieIds: items.map((m) => m.id),
        showCount: totalShows,
        minPrice: prices.length ? Math.min(...prices) : null,
        openingDate: dates[0] ?? null,
        slug: best.slug,
      });
    }

    // 版本排序：原版在前，再按场次多寡
    versions.sort((a, b) => {
      if (a.formats.length === 0 && b.formats.length > 0) return -1;
      if (b.formats.length === 0 && a.formats.length > 0) return 1;
      if (a.showCount !== b.showCount) return b.showCount - a.showCount;
      return a.formats.join().localeCompare(b.formats.join());
    });

    // ---------- 第四步：选代表影片 ----------
    const primary = [...list].sort((a: Movie, b: Movie) => {
      const aBase = isBaseVersion(a.nameZh || a.nameEn) ? 0 : 1;
      const bBase = isBaseVersion(b.nameZh || b.nameEn) ? 0 : 1;
      if (aBase !== bBase) return aBase - bBase;
      return (showCount.get(b.id) || 0) - (showCount.get(a.id) || 0);
    })[0];

    const totalShows = versions.reduce((n, v) => n + v.showCount, 0);
    const prices = versions.map((v) => v.minPrice).filter((p): p is number => p != null);
    const allFormats = sortFormats([...new Set(versions.flatMap((v) => v.formats))]);
    const sources = [...new Set(versions.flatMap((v) => v.sources))] as Source[];
    const displayPoster = pickDisplayPoster(list, primary, highResolutionPosterIndex, posterWidthMap);

    result.push({
      key,
      primary,
      displayName: stripFormats(primary.nameZh || primary.nameEn),
      displayNameEn: pickDisplayNameEn(list),
      displayPoster,
      displayAccent: posterAccent(displayPoster),
      versions,
      totalShows,
      minPrice: prices.length ? Math.min(...prices) : null,
      sources,
      allFormats,
      slug: primary.slug,
      status: primary.status,
      // ★ 卡片显示用的聚合字段（按各源语义优先级选择，详见 helper 注释）
      displayCategory: pickDisplayCategory(list),
      displayLanguage: pickDisplayLanguage(list),
      displayDuration: pickDisplayDuration(list, primary),
      displayDirector: pickDisplayDirector(list),
      displayCast: pickDisplayCast(list),
      displayGenres: pickDisplayGenres(list),
      displayLanguageDetail: pickDisplayLanguageDetail(list),
      displayOpeningDate: pickDisplayOpening(list),
      displayDescription: pickDisplayDescription(list),
      enrich: findEnrich(list, enrichPool),
    });
  }

  return result;
}

/** 上映中的电影组（按场次排序） */
export function getShowingGroups(): MovieGroup[] {
  // ★ 列表中的「上映中」必须仍有未开映场次。
  //   上游 showing 列表会保留已下画影片（或无可售场次的影片），单看 status
  //   会让它们出现在 /showing，但详情页却显示「暫無場次資料」。load() 已按
  //   当前时间剔除已开映场次，因此 totalShows === 0 代表目前没有可看的排片。
  //   只影响列表与首页，不删除底层影片组：已有详情页、影院关联仍可正常访问。
  //
  // ★ 必须复制再排：Array.prototype.sort 就地改动，而 getMovieGroups 现在会 memo，
  //   直接排会把缓存里那个数组顶序改掉，后面的调用者（如 getGroupBySlug、
  //   groupIndex）拿到的就是被排过序的数组 —— 不报错，但会静默改变行为。
  return [...getMovieGroups('showing')]
    .filter((group) => group.totalShows > 0)
    .sort((a, b) => {
      if (a.totalShows !== b.totalShows) return b.totalShows - a.totalShows;
      return (b.primary.openingDate || '').localeCompare(a.primary.openingDate || '');
    });
}

/** 待映的电影组（按上映日排序） */
export function getUpcomingGroups(): MovieGroup[] {
  return [...getMovieGroups('upcoming')].sort((a, b) =>
    (a.primary.openingDate || '').localeCompare(b.primary.openingDate || '')
  );
}

/**
 * 待映按月分组
 *
 * ★ 为什么按「月」而不是按「日」（2026-09-19 改）
 *   原按具体日期分组，但待映片的开画日非常分散（实测 25 部散在 13 个日期上），
 *   结果几乎每个小节只有 1 部电影 —— 一天一个标题，页面被标题切得粉碎，
 *   也看不出「这个月大概有什么」。
 *   按月归类后只剩 6 个分组（其中 10 月 15 部），密度合理。
 *
 * 月内仍按日期升序（getUpcomingGroups 已排好，逐条推入即保持有序）。
 * 月份本身按时间升序；「未定」排在最后 —— 没有日期的条目不该插在
 * 已确定日期的片单中间。
 */
export function getUpcomingGroupsByMonth(): { month: string; groups: MovieGroup[] }[] {
  const byMonth = new Map<string, MovieGroup[]>();
  for (const g of getUpcomingGroups()) {
    const d = g.primary.openingDate || '';
    // 2026-10-08 → 2026-10；日期缺失归到 '未定'
    const mo = /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '未定';
    const bucket = byMonth.get(mo);
    if (bucket) bucket.push(g);
    else byMonth.set(mo, [g]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => {
      if (a[0] === '未定') return 1;
      if (b[0] === '未定') return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([month, groups]) => ({ month, groups }));
}

/** 根据 slug 取回电影组（详情页用，支持任一版本的 slug） */
/**
 * 根据 slug 取回电影组（详情页用，支持任一版本的 slug）
 *
 * 先查全量池：它是静态详情页的唯一权威，决定 canonical slug 与详情页状态。
 * 过滤池只作兼容回退。否则同一片的 showing/upcoming 版本可能共享 canonical
 * slug，先命中 showing 子集会让待映列表链接打开一张「现正上映」详情页。
 */
export function getGroupBySlug(slug: string): MovieGroup | undefined {
  const pools = [getMovieGroups(), getMovieGroups('showing'), getMovieGroups('upcoming')];
  for (const all of pools) {
    const hit = all.find(
      (g: MovieGroup) =>
        g.slug === slug || g.versions.some((v: MovieVersion) => v.slug === slug)
    );
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 条目 id → 所属电影组
 *
 * ★ 为什么需要：详情页只按**电影组**生成（generateStaticParams 取 g.slug），
 * 而一个组里多个版本条目各自有 slug（bestar / mcl 等）。若直接用 movie.slug 链，
 * 非代表条目的 slug 根本不存在对应页面。按场次统计，修复前影院页会生成
 * 7304 个 /movie 链接，其中 4182 个（57%）指向不存在的页面
 * （dynamicParams = false，Next 不会现生）。
 *
 * 用 Map 而不是先 find 出组再线性比对：影院页会对每个条目查一次。
 * 失效条件与 load() 一致（抓取写盘后 TTL 到期自然重建）。
 */
let _groupIndex: { at: number; byId: Map<string, MovieGroup> } | null = null;

function groupIndex(): Map<string, MovieGroup> {
  const now = Date.now();
  if (_groupIndex && now - _groupIndex.at < CACHE_TTL_MS) return _groupIndex.byId;
  const byId = new Map<string, MovieGroup>();
  for (const g of [...getMovieGroups('showing'), ...getMovieGroups('upcoming')]) {
    for (const v of g.versions) for (const id of v.movieIds) byId.set(id, g);
  }
  _groupIndex = { at: now, byId };
  return byId;
}

/** 取某场次条目所属的电影组（无组可归时返回 undefined） */
export function getGroupForMovieId(movieId: string): MovieGroup | undefined {
  return groupIndex().get(movieId);
}

// ============================================================
// 基础查询
// ============================================================

export function getAllMovies(): Movie[] {
  return load().movies;
}

export function getMovies(): Movie[] {
  return load().movies;
}

export function getShows(): Show[] {
  return load().shows;
}

export function getShowing(): Movie[] {
  return load()
    .movies.filter((m) => m.status === 'showing')
    .sort((a, b) => (b.openingDate || '').localeCompare(a.openingDate || ''));
}

export function getUpcoming(): Movie[] {
  return load()
    .movies.filter((m) => m.status === 'upcoming')
    .sort((a, b) => (a.openingDate || '').localeCompare(b.openingDate || ''));
}

export function getMovieBySlug(slug: string): Movie | undefined {
  return load().movies.find((m) => m.slug === slug);
}

export function getMovieById(id: string): Movie | undefined {
  return load().movies.find((m) => m.id === id);
}

export function getShowsByMovie(movieId: string): Show[] {
  return load()
    .shows.filter((s) => s.movieId === movieId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** 取某版本全部源条目的场次（跨院线合并） */
export function getShowsByVersion(version: MovieVersion): Show[] {
  const ids = new Set(version.movieIds);
  return load()
    .shows.filter((s) => ids.has(s.movieId))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** 按影院分组场次 */
export function getShowsByMovieGrouped(movieId: string): {
  cinemaId: string;
  cinema: Cinema | undefined;
  shows: Show[];
}[] {
  const { cinemas } = load();
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));

  const byCinema = new Map<string, Show[]>();
  for (const s of getShowsByMovie(movieId)) {
    const cid = s.cinemaId || '';
    if (!byCinema.has(cid)) byCinema.set(cid, []);
    byCinema.get(cid)!.push(s);
  }
  return [...byCinema.entries()]
    .map(([cinemaId, list]) => ({ cinemaId, cinema: cinemaById.get(cinemaId), shows: list }))
    .sort((a, b) => (a.cinema?.nameZh || '').localeCompare(b.cinema?.nameZh || ''));
}

/** 把一组场次按影院分组 */
export function groupShowsByCinema(shows: Show[]): {
  cinemaId: string;
  cinema: Cinema | undefined;
  shows: Show[];
}[] {
  const { cinemas } = load();
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));

  const byCinema = new Map<string, Show[]>();
  for (const s of shows) {
    const cid = s.cinemaId || '';
    if (!byCinema.has(cid)) byCinema.set(cid, []);
    byCinema.get(cid)!.push(s);
  }
  return [...byCinema.entries()]
    .map(([cinemaId, list]) => ({ cinemaId, cinema: cinemaById.get(cinemaId), shows: list }))
    .sort((a, b) => (a.cinema?.nameZh || '').localeCompare(b.cinema?.nameZh || ''));
}

// ============================================================
// 影院
// ============================================================

export function getAllCinemas(): Cinema[] {
  const rank = new Map(SOURCE_ORDER.map((s, i) => [s, i]));
  return [...load().cinemas].sort((a, b) => {
    const ra = rank.get(a.source) ?? 99;
    const rb = rank.get(b.source) ?? 99;
    return ra - rb || a.nameZh.localeCompare(b.nameZh);
  });
}

export function getCinemas(): Cinema[] {
  return load().cinemas;
}

export function getCinemaById(id: string): Cinema | undefined {
  return load().cinemas.find((c) => c.id === id);
}

export function getShowsByCinema(cinemaId: string): Show[] {
  return load()
    .shows.filter((s) => s.cinemaId === cinemaId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

// ============================================================
// 戲院頁的場次列表（展平給客戶端組件）
// ============================================================

/** 戲院頁裡單條場次 */
export interface CinemaShowtimeShow {
  id: string;
  /** ISO(+08:00)，客戶端據此實時判定是否已開映 */
  startAt: string;
  houseName: string;
  price: number | null;
  seats: number | null;
  bookingUrl: string;
}

/** 戲院頁裡某一天的某部影片 */
export interface CinemaShowtimeMovie {
  movieId: string;
  /** 展示片名（已取組的 displayName，去掉了 IMAX / 特典場 等格式後綴） */
  label: string;
  /**
   * 電影詳情頁的 slug；null 表示無可歸屬的組
   *
   * ★ 必須是「組」的 slug，不能用 movie.slug：詳情頁只按組生成
   *   （dynamicParams = false），非代表條目的 slug 沒有頁面，鏈過去就是 404。
   *   null 時客戶端渲染純文字（不鏈 404）。
   */
  slug: string | null;
  /** 已解析好的縮略圖路徑（構建期確認存在，缺失時為 null） */
  poster: string | null;
  shows: CinemaShowtimeShow[];
}

/** 戲院頁的一天 */
export interface CinemaShowtimeDay {
  date: string;
  movies: CinemaShowtimeMovie[];
}

/**
 * 戲院頁的場次：按「日期 → 影片」分組後展平給客戶端
 *
 * ===== 為什麼要搬到客戶端 =====
 *
 * 戲院頁是 SSG，整份 HTML 在構建時定稿，而場次時間在持續流逝 ——
 * 構建後才開映的場次會一直留在頁面上，直到下一次定時重建（3 小時）。
 * 只有瀏覽器裡的 JS 能貼著時鐘走，故把渲染交給
 * components/CinemaShowtimes.tsx，由它按當前時間實時剔除。
 *
 * 這裡只做「取數 + 分組 + 解析好顯示所需的欄位」——
 * 圖海報縮圖（posterThumbPath 要讀檔案系統）與組的 slug 都必須在服務端算完，
 * 客戶端拿到的必須是可直接渲染的純數據。
 */
export function getCinemaShowtimeDays(cinemaId: string): CinemaShowtimeDay[] {
  const byDate = new Map<string, Map<string, Show[]>>();

  // getShowsByCinema 已按 startAt 升序，故影片分組內的場次天然有序
  for (const s of getShowsByCinema(cinemaId)) {
    if (!s.movieId) continue;
    let byMovie = byDate.get(s.date);
    if (!byMovie) byDate.set(s.date, (byMovie = new Map()));
    const bucket = byMovie.get(s.movieId);
    if (bucket) bucket.push(s);
    else byMovie.set(s.movieId, [s]);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, byMovie]) => ({
      date,
      movies: [...byMovie.entries()].map(([movieId, list]) => {
        const movie = getMovieById(movieId);
        const group = getGroupForMovieId(movieId);
        // 海報優先取組的 displayPoster（已按清晰度挑過，見 pickDisplayPoster）
        const poster = group?.displayPoster || movie?.poster || null;
        return {
          movieId,
          label:
            group?.displayName?.trim() ||
            movie?.nameZh?.trim() ||
            movie?.nameEn?.trim() ||
            `影片 #${movieId}`,
          slug: group?.slug ?? null,
          poster: poster ? posterThumbPath(poster) : null,
          shows: list.map((s) => ({
            id: s.id,
            startAt: s.startAt,
            houseName: s.houseName || '',
            price: s.price,
            seats: s.seats ?? null,
            bookingUrl: s.bookingUrl,
          })),
        };
      }),
    }));
}

/**
 * 戲院頁的篩選列（展平給客戶端組件）
 *
 * ===== 為什麼不直接把 Cinema[] 給客戶端 =====
 *
 * Cinema 裡有 address / mapUrl / detailUrl 等大字段，且 specs 是原始 key。
 * 篩選只需 5 個維度 + 顯示用的 3 個短字段，單獨展平可：
 *   1. 把規格預先算成 { key, label } —— 客戶端不必再依賴 lib/cinema-specs
 *      （那是服務端模塊，打進客戶端 bundle 純屬浪費）
 *   2. 語義明確：這是一個為篩選而生的形狀，不是 Cinema 的第二種寫法
 */
export interface CinemaRow {
  id: string;
  nameZh: string;
  address: string;
  mapUrl: string;
  source: Source;
  region: Region | null;
  district: string | null;
  specs: { key: string; label: string }[];
  /** 網上購票手續費（每張票）；規則見 lib/booking-fee.ts */
  fee: BookingFee;
}

/**
 * 戲院篩選面板的候選項
 *
 * specs 分兩組（放映格式 / 特色影廳），客戶端下拉按 group 插小標題。
 * 只返回**實際有戲院**的選項，避免出現「選了卻沒有結果」的空選項。
 */
export interface CinemaFacets {
  sources: { value: string; label: string; count: number }[];
  specs: { value: string; label: string; count: number; group: string }[];
  regions: { value: string; label: string; count: number }[];
  districts: { value: string; label: string; count: number }[];
}

export function getCinemaRows(): CinemaRow[] {
  return getAllCinemas().map((c) => ({
    id: c.id,
    nameZh: c.nameZh,
    address: c.address,
    mapUrl: c.mapUrl,
    source: c.source,
    region: c.region ?? null,
    district: c.district ?? null,
    specs: (c.specs ?? []).map((k) => ({ key: k, label: specLabel(k) })),
    fee: bookingFeeOf(c.id, c.source),
  }));
}

export function getCinemaFacets(rows: CinemaRow[]): CinemaFacets {
  const count = <T extends string>(get: (r: CinemaRow) => T | null) => {
    const m = new Map<T, number>();
    for (const r of rows) {
      const v = get(r);
      if (v == null || v === '') continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };

  const srcCount = count((r) => r.source);
  const regCount = count((r) => r.region);
  const disCount = count((r) => r.district);

  // 規格：一間戲院在一個規格上只計 1（同一規格不會在一間戲院重複）
  const specCount = new Map<string, number>();
  for (const r of rows) for (const s of r.specs) specCount.set(s.key, (specCount.get(s.key) ?? 0) + 1);

  return {
    sources: SOURCE_ORDER.filter((s) => srcCount.has(s)).map((s) => ({
      value: s,
      label: SOURCE_LABEL[s],
      count: srcCount.get(s)!,
    })),
    // 展示顺序由 HALL_SPECS 决定（放映格式在前、特色影廳在后）
    specs: HALL_SPECS.filter((s) => specCount.has(s.key)).map((s) => ({
      value: s.key,
      label: s.label,
      count: specCount.get(s.key)!,
      group: SPEC_GROUP_LABEL[s.group],
    })),
    regions: REGION_ORDER.filter((r) => regCount.has(r)).map((r) => ({
      value: r,
      label: r,
      count: regCount.get(r)!,
    })),
    districts: [...disCount.entries()]
      .sort((a, b) => districtOrder(a[0]) - districtOrder(b[0]) || a[0].localeCompare(b[0]))
      .map(([value, c]) => ({ value, label: value, count: c })),
  };
}

/**
 * ★ 2026-09-21 删除了 getCinemasBySource()。
 *
 * 它原本只服务戲院列表页的「按院線分節」。现在戲院页改成客戶端筛选
 * （CinemaExplorer），分節必須**跟隨篩選結果實時重算** ——
 * 篩掉一條院線後那一節要整段消失，而這是靜態 HTML 做不到的。
 * 因此分組邏輯隨之搬到了 components/CinemaExplorer.tsx，
 * 排序仍在服務端的 getCinemaRows()（院線優先序 + 院名）裡做，
 * 客戶端只負責分堆。
 *
 * 留著它會是一個「看起來能用但永遠不會被調用」的導出，
 * 下次有人要做戲院分組時會先找到它 —— 然後才發現分完組
 * 不會跟隨篩選，白跑一趟。
 */

export { formatLabel, extractFormats, normalizeTitle, stripFormats };

// ============================================================
// 場次篩選 / 排序（詳情頁用）
// ============================================================

/**
 * 展平后的单条场次（可直接序列化给客户端组件做筛选）
 *
 * 为什么要「展平」：
 *   原先详情页按「版本 → 日期 → 影院」三层嵌套服务端渲染，
 *   所有场次都写死在 HTML 里（热门片实测 746KB），
 *   无法做交互式筛选（静态 HTML 改不了），也拖慢首屏。
 *
 *   展平为「一行一场次」后，可以：
 *     1. 作为紧凑 JSON 交给客户端组件，用 JS 实时筛选/排序
 *     2. HTML 体积大幅下降（不再重复嵌套标签）
 */
export interface ShowRow {
  id: string;
  startAt: string;
  /** 香港时区 HH:mm */
  time: string;
  date: string;
  price: number | null;
  /** 剩余可选率（0–1），颜色标记依据 */
  remainRate: number | null;
  /** 是否已满座 */
  soldOut?: boolean;
  seats: number | null;
  houseName: string;
  bookingUrl: string;
  source: Source;
  sourceLabel: string;
  cinemaId: string;
  cinemaName: string;
  /**
   * 戲院完整地址
   *
   * ★ 2026-09-21 用戶指定（第二次修正）：「把戏院后面的地区区域补充为完整地址」。
   *   場次卡片標題行原本顯示「香港 · 南區」這種大區·十八區 ——
   *   那是**篩選維度的殘留**：用戶已在第一層用下拉篩過地區/區域，
   *   卡片上再寫一次既重複、又對「怎麼去」毫無幫助。
   *   改成完整地址（如「香港黃竹坑香葉道11號THE SOUTHSIDE3樓」）。
   *   region / district 仍保留在 ShowRow 上，供篩選與 facets 使用。
   */
  cinemaAddress: string;
  region: Region | null;
  district: string | null;
  /**
   * 網上購票手續費（每張戲票，HKD）
   *
   * ★ 2026-09-21 用戶指定：場次卡片群組的「戲院名下方那行」由地址改為手續費。
   *   放在戲院層級（而非每場一行）—— 同一間戲院全線同價，
   *   逐場存會讓壓縮後的傳輸量白漲（見 lib/compact.ts 的影院字典）。
   *   規則與出處見 lib/booking-fee.ts。
   */
  cinemaFee: number;
  /** 手續費說明（hover 提示；0 元時負責解釋「為何是 0」） */
  cinemaFeeNote: string;
  /** 顯示票價是否已含手續費（決定文案寫「$8 手續費」還是「$8 手續費（已含於票價）」） */
  cinemaFeeIncluded: boolean;
  /** 版本 key（如 'imax' / '__base__'），用于筛选 */
  versionKey: string;
  /** 版本展示名（如 'IMAX' / '原版'） */
  versionLabel: string;
  /**
   * 场次卡片中行的「影片版本·语言」文案（如 'IMAX·英語' / '原版·日語'）
   *
   * ★ 2026-09-21 用户指定：卡片中行不再显示影厅名（「1院」「House 1」），
   *   改显示版本与语言 —— 那才是用户选场次时要看的。
   *   文案规则见 lib/versions.ts 的 formatVersionText。
   */
  versionText: string;
  /** 版本标签数组（用于图标/角标） */
  formats: string[];
}

/**
 * 把一部电影组的所有场次展平为 ShowRow[]
 *
 * 版本来源：从**片名**推断（extractFormats），而不是 show.version 字段。
 * 原因：百老匯的 1479 場 version 全为 null（其 API 不提供该字段），
 *       而片名里其实带了格式标记（「復仇者聯盟4 IMAX with Laser」）。
 *       统一从片名推断，四个源才能用同一套版本维度筛选。
 */
export function getShowRowsForGroup(group: MovieGroup): ShowRow[] {
  const { shows, movies, cinemas } = load();

  const movieById = new Map(movies.map((m) => [m.id, m]));
  const cinemaById = new Map(cinemas.map((c) => [c.id, c]));
  const ids = new Set(group.versions.flatMap((v) => v.movieIds));

  /**
   * 影片级对白语言（如「英語」「日語」），作为版本语言的兵底。
   *
   * ★ 为什么要兵底（用户 2026-09-21 确认「语言取自影片本身的对白语言」）：
   *   实测只有百老匯的条目带 dialect（emperor / cinemacity 全为 null），
   *   而 IMAX 版常常没有语言标记。没有兵底的话
   *   「IMAX 英語片」就只剩「IMAX」，与「原版·英語」不齐。
   *
   * 取首个语言（「粵語 / 普通話」取「粵語」）：卡片只有一行，
   *   全部塞进去会折行；多个语言的情形在详情页资料表里有完整展示。
   */
  const filmLang = group.displayLanguageDetail.spoken?.split('/')[0]?.trim() || null;

  const rows: ShowRow[] = [];

  for (const s of shows) {
    if (!ids.has(s.movieId)) continue;

    const movie = movieById.get(s.movieId);
    const formats = sortFormats(extractFormats(movie?.nameZh || movie?.nameEn || ''));
    const cinema = cinemaById.get(s.cinemaId);
    // 手續費是戲院級常量，逐場重算一次純函數查表（無 IO，可忽略）
    const fee = bookingFeeOf(s.cinemaId, s.source);

    rows.push({
      id: s.id,
      startAt: s.startAt,
      time: s.startAt.slice(11, 16),
      date: s.date,
      price: s.price,
      remainRate: s.remainRate ?? null,
      soldOut: s.soldOut,
      seats: s.seats ?? null,
      houseName: s.houseName || '',
      bookingUrl: s.bookingUrl,
      source: s.source,
      sourceLabel: SOURCE_LABEL[s.source] ?? s.source,
      cinemaId: s.cinemaId,
      cinemaName: cinema?.nameZh || `戲院 #${s.cinemaId}`,
      cinemaAddress: cinema?.address || '',
      region: cinema?.region ?? null,
      district: cinema?.district ?? null,
      cinemaFee: fee.amount,
      cinemaFeeNote: fee.note,
      cinemaFeeIncluded: fee.included,
      versionKey: formats.length ? formats.join('|').toLowerCase() : '__base__',
      versionLabel: formats.length ? formats.map(formatLabel).join(' + ') : '原版',
      versionText: formatVersionText(formats, filmLang),
      formats,
    });
  }

  rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return rows;
}

/**
 * 为一批场次计算筛选面板的候选项
 *
 * 只返回**实际有场次**的选项，避免出现「选了却没有任何结果」的空选项。
 * 各维度按「场次多寡 / 行政顺序」排序，让常用项排前面。
 */
export interface Facets {
  sources: { value: string; label: string; count: number }[];
  versions: { value: string; label: string; count: number }[];
  regions: { value: string; label: string; count: number }[];
  districts: { value: string; label: string; count: number }[];
}

export function getFacets(rows: ShowRow[]): Facets {
  const count = <T extends string>(get: (r: ShowRow) => T | null) => {
    const m = new Map<T, number>();
    for (const r of rows) {
      const v = get(r);
      if (v == null || v === '') continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };

  const srcCount = count((r) => r.source);
  const verCount = count((r) => r.versionKey);
  const regCount = count((r) => r.region);
  const disCount = count((r) => r.district);

  // 版本展示名：取该 key 下任意一行的 label
  const verLabel = new Map<string, string>();
  for (const r of rows) if (!verLabel.has(r.versionKey)) verLabel.set(r.versionKey, r.versionLabel);

  return {
    sources: SOURCE_ORDER.filter((s) => srcCount.has(s)).map((s) => ({
      value: s,
      label: SOURCE_LABEL[s],
      count: srcCount.get(s)!,
    })),
    // 原版排最前，其余按场次多寡
    versions: [...verCount.entries()]
      .sort((a, b) => {
        if (a[0] === '__base__') return -1;
        if (b[0] === '__base__') return 1;
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      })
      .map(([value, c]) => ({ value, label: verLabel.get(value) ?? value, count: c })),
    regions: REGION_ORDER.filter((r) => regCount.has(r)).map((r) => ({
      value: r,
      label: r,
      count: regCount.get(r)!,
    })),
    districts: [...disCount.entries()]
      .sort((a, b) => districtOrder(a[0]) - districtOrder(b[0]) || a[0].localeCompare(b[0]))
      .map(([value, c]) => ({ value, label: value, count: c })),
  };
}
