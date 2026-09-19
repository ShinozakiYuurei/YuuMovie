#!/usr/bin/env node
/**
 * 海报本地化：把第三方海报下载到本机，转成 800w WebP，改为同源 /img/ 提供。
 *
 * ★ 为什么必须这么做（2026-09-19 实测）：
 *
 *   1. www.mclcinema.com 对**用户网络完全不可达**（80/443 均超时，挂满 20s），
 *      而香港服务器 0.2s 就能取到。首页 60 张海报里 28 张来自它 ——
 *      即近半数图片不是「慢」，而是**永远加载不出来**，浏览器要等到超时才放弃。
 *      图片换成同源路径后，用户侧不再直连该域名。
 *
 *   2. media.grabticks.com 的 x-oss-process 参数**完全无效**
 *      （它是 Amazon S3 + CloudFront，不是阿里云 OSS；原图 390KB–1.5MB 原样返回）。
 *      lib/data.ts 里原本给它拼的缩放参数是空操作，白白背了约 8.9MB 流量。
 *
 *   3. 转 WebP 后体积降一个数量级（实测 390KB → 45KB，省 88%），
 *      且同源静态文件会被 Cloudflare 边缘缓存 —— 这就是要的「CDN 节点缓存」。
 *
 * 产物：
 *   public/posters/<sha1前16位>-<宽度>.webp      卡片/详情页主图（800w，.gitignore 已排除）
 *   public/posters/<sha1前16位>-<宽度>-t.webp   列表缩略图（64w）
 *
 *   ★ 文件名带宽度（2026-09-20 加）：/posters/ 在 nginx 侧是
 *     `immutable, max-age=1y`。若文件名只由 URL 决定，调整 POSTER_WIDTH 后
 *     产物变了而文件名没变，浏览器与 CF 边缘会继续用旧图整整一年。
 *     宽度编进文件名后，换宽度即换文件名，缓存自动失效。
 *   data/poster-manifest.json           { 原始URL: 本地文件名 }，供 lib/data.ts 查表
 *
 * ★ 2026-09-19 新增 -t 缩略图变体：
 *   影院页（app/cinema/[id]/page.tsx）把海报渲染在 32×48px 的位置，
 *   却引用主图 —— 实测单页 52 张 × 28KB = 1.43MB，而 64w 缩略图
 *   只要 ~1KB。全站 42 个影院页共引用 6094 张，浪费约 72MB 流量。
 *   缩略图文件名只是在主图名后加 `-t`，因此 lib/data.ts 能纯字符串推导，
 *   不必再查一张表。
 *
 * 为什么放 public/posters 而不是 data/：
 *   站点是 `output: 'export'` 静态导出，next build 会把 public/ 拷进 out/，
 *   再随 rebuild-static.sh 同步到 nginx 的 /home/web/html。
 *   放 public/ 即「同源 /posters/*.webp」，用户不再直连任何第三方图片域名 ——
 *   这正是绕开 mclcinema 不可达的关键。
 *   manifest 放 data/ 是因为它要在构建期被 lib/data.ts 读取，且同样不进仓库。
 *
 * 幂等 + 增量：已存在且非空的文件直接跳过，因此只有新片才会产生网络开销。
 *
 * 用法：
 *   node scripts/fetch-posters.mjs              # 增量（日常）
 *   node scripts/fetch-posters.mjs --limit 6    # 只处理前 6 张（冒烟）
 *   node scripts/fetch-posters.mjs --force      # 忽略缓存全量重下
 *   node scripts/fetch-posters.mjs --dry-run    # 只列清单不发请求
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
/** 图片落在 public/ 下，构建时被 next 拷进 out/ → 同源 /posters/*.webp */
const CACHE_DIR = process.env.POSTER_OUT_DIR || path.join(ROOT, 'public', 'posters');
const MANIFEST = path.join(DATA_DIR, 'poster-manifest.json');
const MOVIES = path.join(DATA_DIR, 'movies.json');

/**
 * 主图宽度。
 *
 * ★ 2026-09-20 由 400 提到 800（用户反馈「海报好模糊」）。
 *
 *   卡片实际渲染 268×401 CSS px（首页 lg:grid-cols-4），HiDPI 屏需要
 *   536×802 物理像素 —— 400w 在 2x 屏上是被**放大**显示的，必然发糊。
 *   服务器实测（18 张真实源，2x 显示盒 536×802）：
 *     400w/q78  30.7KB  PSNR 27.45 dB   ← 改动前
 *     600w/q82  57.6KB  PSNR 34.10 dB
 *     800w/q80  79.8KB  PSNR 36.98 dB   ← 现在
 *   800w 同时覆盖 3x 手机的 540 物理像素与详情页 256 CSS px 的大图位。
 *   全站 288 张合计约 27.6MB（各源原图合计约 258MB），同一量级。
 *
 * 源图更小时不放大（withoutEnlargement）：MCL 的 API 只有 290×390，
 *   那批就保持 290 —— 同组若有更清晰的源，由 lib/data.ts 的
 *   displayPoster 改用那张。
 */
const WIDTH = Number(process.env.POSTER_WIDTH || 800);
const QUALITY = Number(process.env.POSTER_QUALITY || 80);
/**
 * 列表缩略图宽度。
 *
 * 影院页把海报显示在 32×48px（见 app/cinema/[id]/page.tsx 的 width/height），
 * 2x 屏需 64px 物理像素 —— 取 64 已足够，且单张仅 ~1KB。
 * 不取更小是因为 64 已是「肉眼无差」的拐点，再小会开始发糊。
 */
const THUMB_WIDTH = Number(process.env.POSTER_THUMB_WIDTH || 64);
const THUMB_QUALITY = Number(process.env.POSTER_THUMB_QUALITY || 72);
/** 并发：2C2G 机器上 sharp 是 CPU 密集，6 路已能打满且不挤占 nginx */
const CONCURRENCY = Number(process.env.POSTER_CONCURRENCY || 6);
const TIMEOUT_MS = Number(process.env.POSTER_TIMEOUT_MS || 30_000);
const RETRIES = 2;

const argv = process.argv.slice(2);
const LIMIT = Number((argv.find((a) => a.startsWith('--limit')) || '').split('=')[1] || argv[argv.indexOf('--limit') + 1] || 0) || 0;
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry-run');

/**
 * icirena 走 x-oss-process 拿一份已缩小的源图再本地转码。
 * 直接下原图要 736KB，走参数只要 22KB —— 省 97% 的下载量，且结果一致。
 * 其余域名不支持该参数（grabticks 静默忽略），一律取原图。
 */
const OSS_HOSTS = new Set(['cdn.icirena.ai']);

function sourceUrlFor(url) {
  try {
    const u = new URL(url);
    if (!OSS_HOSTS.has(u.hostname)) return url;
    // 取 WIDTH 的两倍：OSS 侧先缩一次能省 97% 下载量，
    // 留一倍余量则保证本地 resize 是「缩小」而非放大，不额外损失锐度。
    u.searchParams.set('x-oss-process', `image/resize,w_${WIDTH * 2}/format,webp`);
    return u.toString();
  } catch {
    return url;
  }
}

function hashOf(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/**
 * 主图文件名：`<sha1(url) 前16位>-<宽度>.webp`
 *
 * ★ 为什么把宽度写进文件名：文件名原本只有 sha1(url)，那是「内容寻址」——
 *   前提是同一个 URL 必然产出同样的字节。这个前提在调整 POSTER_WIDTH 时
 *   不成立：URL 没变、产物变了，而 nginx 给 /posters/ 下发的是
 *   `immutable, max-age=1y`，旧图会在浏览器和 CF 边缘留一整年，
 *   等于改宽度对用户完全没生效。带上宽度后，宽度一变文件名必变。
 *
 * 缩略图沿用「主图名插 -t」的约定（见 thumbNameFor），
 *   因此 lib/data.ts 仍可纯字符串推导，不需要额外的表。
 */
function mainNameFor(url) {
  return `${hashOf(url)}-${WIDTH}.webp`;
}

/**
 * 缩略图文件名：主图名后插 `-t`。
 *
 * 之所以用「命名约定」而不是再存一张表：lib/data.ts 拿到主图名后
 * 只需一次字符串拼接就能推出缩略图路径，无需额外查表、也不会出现
 * 「表里有主图无缩略图」的不一致状态。
 */
function thumbNameFor(mainName) {
  return mainName.replace(/\.webp$/, '-t.webp');
}

async function fetchBuffer(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          // 部分 CDN 对空 UA 直接 403
          'User-Agent': 'Mozilla/5.0 (compatible; YuuMoviePosterBot/1.0)',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** 只处理仓库里真实用到的海报 URL */
function collectPosterUrls() {
  const raw = JSON.parse(fs.readFileSync(MOVIES, 'utf8'));
  const urls = new Set();
  for (const m of raw) {
    if (m && typeof m.poster === 'string' && /^https?:\/\//.test(m.poster)) urls.add(m.poster);
  }
  return [...urls];
}

async function main() {
  if (!fs.existsSync(MOVIES)) {
    console.error(`✖ 找不到 ${MOVIES}`);
    process.exit(1);
  }
  const sharp = (await import('sharp')).default;

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  let manifest = {};
  if (fs.existsSync(MANIFEST) && !FORCE) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    } catch {
      console.warn('⚠️ manifest 解析失败，按空处理');
    }
  }

  let urls = collectPosterUrls();
  if (LIMIT > 0) urls = urls.slice(0, LIMIT);

  /**
   * 自愈：从磁盘上的文件反推 manifest。
   *
   * ★ 为什么需要：文件名就是「原始 URL 的 sha1 前 16 位」，所以图在盘上
   *   就等于 manifest 记录存在 —— 只是可能没来得及写进 JSON
   *   （旧版只在结尾写一次，中断就丢记录；或 manifest 被误删）。
   *   这里按文件名反查，把已下载的图重新认领回 manifest，
   *   避免「图已在盘上却因为清单缺条而重下 258MB」。
   *
   * 不读 manifest 也能跑：即使 JSON 完全丢失，本步就能从文件重建全量映射。
   *
   * ★ 宽度校验：认领时要求文件名带当前 WIDTH。否则换宽度后
   *   （400→800）旧的 400w 文件会被误认领，下面 todo 的
   *   「宽度不符就重做」判断反而失效。
   */
  let healed = 0;
  for (const u of urls) {
    if (manifest[u] && manifest[u].endsWith(`-${WIDTH}.webp`)) continue;
    const name = mainNameFor(u);
    const p = path.join(CACHE_DIR, name);
    try {
      if (fs.statSync(p).size > 0) {
        manifest[u] = name;
        healed++;
      }
    } catch {
      /* 文件不存在，正常 */
    }
  }
  if (healed > 0) {
    console.log(`   ↻ 自愈：从磁盘找回 ${healed} 张已下载海报（manifest 补全）`);
    const tmp = `${MANIFEST}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, MANIFEST);
  }

  const todo = urls.filter((u) => {
    if (FORCE) return true;
    const f = manifest[u];
    if (!f) return true;
    // ★ 宽度不符也必须重做：换了 POSTER_WIDTH 之后，manifest 里仍记着旧宽度的
    //   文件名，而那个文件还在盘上 —— 只看「文件是否存在」会误判成已缓存，
    //   新宽度永远不生成（本次 400→800 就踩这个）。
    if (!f.endsWith(`-${WIDTH}.webp`)) return true;
    const p = path.join(CACHE_DIR, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });

  console.log(`▶ 海报本地化：共 ${urls.length} 张，待处理 ${todo.length} 张（跳过 ${urls.length - todo.length} 张已缓存）`);
  if (DRY) {
    for (const u of todo.slice(0, 20)) console.log('   ', u);
    if (todo.length > 20) console.log(`    …另有 ${todo.length - 20} 张`);
    return;
  }
  if (todo.length === 0) {
    console.log('   无新增主图，检查缩略图是否齐全...');
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }

  let done = 0;
  let failed = 0;
  let savedFrom = 0;
  let savedTo = 0;
  const failures = [];

  /**
   * 检查点：每张成功后就落盘 manifest。
   *
   * ★ 为什么必须增量写：本脚本要下载 300+ 张图，在 2C2G VPS 上约 2–4 分钟，
   *   而 systemd 单元有 TimeoutStartSec，SSH 会话也可能断。
   *   原实现只在结尾写一次，进程一被中断，已下载的几百张图就全部白干
   *   （图在盘上但 manifest 没记录，下次仍会重下）。
   *   增量写让每张图一旦成功就永久生效，中断后重跑自动续传。
   *
   * 写临时文件再 rename：避免写到一半被 kill 时留下半截 JSON，
   * 那会让下次启动直接解析失败（readJson 会静默降级为空 → 全量重下）。
   */
  function checkpoint() {
    const tmp = `${MANIFEST}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, MANIFEST);
  }

  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      const name = mainNameFor(url);
      const out = path.join(CACHE_DIR, name);
      const thumbOut = path.join(CACHE_DIR, thumbNameFor(name));
      // 记下旧记录：重下失败时用它兜底（见 catch）
      const prev = manifest[url];
      try {
        const src = sourceUrlFor(url);
        const buf = await fetchBuffer(src);
        const webp = await sharp(buf, { failOn: 'none' })
          .rotate() // 尊重 EXIF 方向
          .resize({ width: WIDTH, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toBuffer();
        fs.writeFileSync(out, webp);

        // 缩略图从**已生成的主图**再缩一次，而不是重新解码原图：
        //   1. 输入小得多，sharp 开销更低（2C2G 机器上值得）
        //   2. 尺寸关系确定（64 ≤ WIDTH），不会出现缩略图反而更大的怪状
        //   3. 与主图同源同色，不会因两次独立缩放而色调偏移
        const thumb = await sharp(webp)
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY })
          .toBuffer();
        fs.writeFileSync(thumbOut, thumb);

        manifest[url] = name;
        savedFrom += buf.length;
        savedTo += webp.length;
        done++;
        checkpoint();
      } catch (e) {
        failed++;
        failures.push(`${url}  →  ${e.message}`);
        // ★ 保留旧记录，而不是删掉。
        //   删掉会让 slimPoster 回退到**原始远端 URL** —— 而 MCL 那批
        //   对用户网络完全不可达（见 lib/data.ts 注释），结果是直接碎图。
        //   留着旧记录就能继续发上一版的本地文件（文件没被上面的清理删掉：
        //   清理只认 manifest 里登记过的 sha1），最多是分辨率旧一点。
        //   本次 400→800 正是这个情形：失败的那几张宁可继续用 400w，
        //   也不应该变成裂图。
        if (prev) manifest[url] = prev;
        else delete manifest[url];
      }
      const n = done + failed;
      if (n % 25 === 0 || n === todo.length) {
        process.stdout.write(`\r   进度 ${n}/${todo.length}（成功 ${done} 失败 ${failed}）   `);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  process.stdout.write('\n');

  checkpoint();

  // ---------- 补齐缺失的缩略图 ----------
  // ★ 为什么单独一步：本次新增 -t 变体之前，盘上已有几百张主图。
  //   若只在上面的循环里生成，老图永远拿不到缩略图，除非 --force 全量重下
  //   （那要重新下载 258MB）。这一步直接从**本地主图**生成，零网络开销。
  let thumbMade = 0;
  for (const [url, name] of Object.entries(manifest)) {
    const main = path.join(CACHE_DIR, name);
    const thumb = path.join(CACHE_DIR, thumbNameFor(name));
    try {
      if (fs.existsSync(thumb) && fs.statSync(thumb).size > 0) continue;
      if (!fs.existsSync(main) || fs.statSync(main).size === 0) continue;
      const t = await sharp(main)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
      fs.writeFileSync(thumb, t);
      thumbMade++;
    } catch {
      /* 单张失败不影响其他；缺缩略图时页面会回退到主图 */
    }
  }
  if (thumbMade > 0) console.log(`   ↻ 补齐缩略图 ${thumbMade} 张（从本地主图生成，未产生网络请求）`);

  const mb = (n) => (n / 1048576).toFixed(1);

  // ---------- 清理：删掉不再被引用的旧宽度文件 ----------
  //
  // ★ 为什么必须做（2026-09-20 加）：public/posters/ 是 .gitignore 的构建产物，
  //   nginx 直接服务 out/posters/。宽度从 400 改成 800 后，旧文件名不再被
  //   manifest 引用，但文件仍在盘上，并会被 next build 原样拷进 out/ ——
  //   等于每次改宽度都往站点里堆一整份废弃图（本次约 10MB）。
  //   这一步让目录严格等于 manifest，重建后不会越来越肿。
  //
  // ★ 删除条件写得**很窄**（而不是「不在 manifest 里就删」）：
  //   只删「sha1 与某个已登记 URL 相同、但宽度不是当前 WIDTH」的文件
  //   （含旧命名 `<sha1>.webp`：它没有宽度段，一样属于旧宽度产物）。
  //   理由：若本次全部下载失败，manifest 会被清空（见 catch 里的
  //   delete manifest[url]），此时「不在 manifest 里就删」会把整目录
  //   的海报删光 —— 而 rebuild-static.sh 海报步骤失败是**不中断**的，
  //   于是线上就变成「引用远端 URL」：MCL 那批对用户网络不可达，直接碎图。
  //   按 hash 前缀匹配后，manifest 为空就等于什么都不删，最坏只是留旧文件。
  //
  // 只在**全量**跑时清理：--limit 是冒烟用的，按它删会把未处理的图误删。
  if (LIMIT === 0) {
    const knownHashes = new Set();
    /** 当前 manifest 仍在引用的文件名（含兜底保留的旧宽度记录） */
    const referenced = new Set();
    for (const name of Object.values(manifest)) {
      const m = /^([0-9a-f]{16})-\d+\.webp$/.exec(name);
      if (m) knownHashes.add(m[1]);
      referenced.add(name);
      referenced.add(thumbNameFor(name));
    }
    let pruned = 0;
    let freed = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      // 两种命名都要覆盖：
      //   带宽度  <sha1>-<宽度>.webp / -t.webp   （2026-09-20 起）
      //   无宽度  <sha1>.webp / -t.webp          （旧产物，否则会永远留在盘上）
      const m = /^([0-9a-f]{16})(?:-(\d+))?(-t)?\.webp$/.exec(f);
      if (!m) continue;
      const [, hash, width] = m;
      // 仍被 manifest 引用的不动：重下失败时兜底保留的旧宽度记录就在这里，
      //   删掉它会让页面变成「引用不存在的本地文件」（碎图）。
      if (referenced.has(f)) continue;
      // 已是当前宽度 → 保留；sha1 不属任何已登记 URL → 不动（可能是别人的文件）
      if ((width && Number(width) === WIDTH) || !knownHashes.has(hash)) continue;
      try {
        const st = fs.statSync(path.join(CACHE_DIR, f));
        if (!st.isFile()) continue;
        fs.unlinkSync(path.join(CACHE_DIR, f));
        freed += st.size;
        pruned++;
      } catch {
        /* 单张删不掉不影响发布，下次再清 */
      }
    }
    if (pruned > 0) console.log(`   ↻ 清理旧宽度图 ${pruned} 张（释放 ${mb(freed)}MB）`);
  }

  console.log(`✅ 完成：成功 ${done}，失败 ${failed}`);
  console.log(`   图片目录: ${CACHE_DIR}（构建时拷进 out/posters/ → 同源 /posters/）`);
  if (savedFrom > 0) {
    console.log(`   下载源 ${mb(savedFrom)}MB → 缓存 ${mb(savedTo)}MB（省 ${(100 - (savedTo / savedFrom) * 100).toFixed(0)}%）`);
  }
  console.log(`   manifest: ${MANIFEST}`);
  if (failures.length) {
    console.log(`\n⚠️ 失败清单（有旧版记录则继续用旧文件，否则回退到原始 URL）：`);
    for (const f of failures.slice(0, 20)) console.log('   ', f);
    if (failures.length > 20) console.log(`    …另有 ${failures.length - 20} 条`);
  }
}

main().catch((e) => {
  console.error('✖ 海报本地化失败：', e);
  process.exit(1);
});
