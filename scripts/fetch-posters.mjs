#!/usr/bin/env node
/**
 * 海报本地化：把第三方海报下载到本机，转成 400w WebP，改为同源 /img/ 提供。
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
 *   public/posters/<sha1前16位>.webp   实际图片（.gitignore 已排除该目录）
 *   data/poster-manifest.json          { 原始URL: 本地文件名 }，供 lib/data.ts 查表
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

/** 卡片最大展示宽度约 400 CSS px，2x 屏 → 400 足够；详情页 176px 亦覆盖 */
const WIDTH = Number(process.env.POSTER_WIDTH || 400);
const QUALITY = Number(process.env.POSTER_QUALITY || 78);
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
    // w_800 留一倍余量给未来的大图需求，转码时再收到 WIDTH
    u.searchParams.set('x-oss-process', 'image/resize,w_800/format,webp');
    return u.toString();
  } catch {
    return url;
  }
}

function hashOf(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
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
   */
  let healed = 0;
  for (const u of urls) {
    if (manifest[u]) continue;
    const name = `${hashOf(u)}.webp`;
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
    console.log('✅ 无新增，直接写 manifest');
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    return;
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
      const name = `${hashOf(url)}.webp`;
      const out = path.join(CACHE_DIR, name);
      try {
        const src = sourceUrlFor(url);
        const buf = await fetchBuffer(src);
        const webp = await sharp(buf, { failOn: 'none' })
          .rotate() // 尊重 EXIF 方向
          .resize({ width: WIDTH, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toBuffer();
        fs.writeFileSync(out, webp);
        manifest[url] = name;
        savedFrom += buf.length;
        savedTo += webp.length;
        done++;
        checkpoint();
      } catch (e) {
        failed++;
        failures.push(`${url}  →  ${e.message}`);
        delete manifest[url];
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

  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`✅ 完成：成功 ${done}，失败 ${failed}`);
  console.log(`   图片目录: ${CACHE_DIR}（构建时拷进 out/posters/ → 同源 /posters/）`);
  if (savedFrom > 0) {
    console.log(`   下载源 ${mb(savedFrom)}MB → 缓存 ${mb(savedTo)}MB（省 ${(100 - (savedTo / savedFrom) * 100).toFixed(0)}%）`);
  }
  console.log(`   manifest: ${MANIFEST}`);
  if (failures.length) {
    console.log(`\n⚠️ 失败清单（这些会回退到原始 URL）：`);
    for (const f of failures.slice(0, 20)) console.log('   ', f);
    if (failures.length > 20) console.log(`    …另有 ${failures.length - 20} 条`);
  }
}

main().catch((e) => {
  console.error('✖ 海报本地化失败：', e);
  process.exit(1);
});
