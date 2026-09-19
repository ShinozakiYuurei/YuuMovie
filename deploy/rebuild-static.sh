#!/usr/bin/env bash
#
# 静态导出模式：抓取数据后重建站点
#
# 背景：2026-09-18 起 hk-movie 改为静态导出（output: 'export'），
#       nginx 直接服务 out/ 的纯 HTML，不再有 Node 常驻进程。
#       因此数据更新后**必须重建**才能让线上看到新数据。
#
# 流程：抓取 → 校验 → 重建静态站点 → 同步到 nginx 目录
#
# ★ 2026-09-19 修复：本脚本原先**不含抓取**，但两个 systemd 定时器
#   （hk-movie-scrape-light / -heavy）的 ExecStart 都指向这里 ——
#   即「名为 scrape 的定时器实际只重建，从不抓」，自 09-18 12:49 起
#   线上数据再没更新过。现在把抓取补回来：
#     - 尊重 unit 里的 ONLY（light=broadway,mcl；heavy=icirena 三源），
#       未运行的源由 scrape.js 自动并入 data/sources/*.json 快照
#     - SCRAPE=0 可跳过抓取（纯重建，例如只想改 UI 后快速发布）
#     - 抓取失败 → set -e 直接中止，**不**发布半成品，线上保持原样
#
# 用法：bash /opt/hk-movie/deploy/rebuild-static.sh
#       SCRAPE=0 bash /opt/hk-movie/deploy/rebuild-static.sh   # 跳过抓取
#       POSTERS=0 bash /opt/hk-movie/deploy/rebuild-static.sh  # 跳过海报本地化
#
#   2026-09-19 同时加了 flock 串行锁（见下）。
#   2026-09-19 又加海报本地化（第 1.7 步）：页面引用 /posters/*.webp，
#   图片必须先落 public/posters/ 再构建，否则同源海报会 404。
set -euo pipefail

# ★ 串行锁：light（每 2h）与 heavy（每 6h）两个定时器**共用本脚本**，
#   二者会同时 rm -rf out/ 并清空 /home/web/html。正常情况下时间窗相差
#   28 分钟不会撞车，但一次慢速抓取（网络抖动 / TimeoutStartSec=900 内）
#   就可能让两次构建交叉。这里用 flock 独占，第二个直接放弃（exit 0，
#   不报错），等下一个定时器重建 —— 数据已由第一个进程更新。
LOCK_FILE="${LOCK_FILE:-/tmp/hk-movie-rebuild.lock}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "⚠️ 另一个重建正在进行，本次退出（数据不受影响）"
  exit 0
fi

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SITE_DIR="${SITE_DIR:-/home/web/html}"
SITE_URL="${SITE_URL:-https://hkmovie.yuurei.de}"
# 图片子域（可选）：设为灰云子域可让海报直连香港，实测快 2.3–5.8 倍。
# 留空则海报保持同源 /posters/*.webp（默认，行为不变）。
POSTER_ORIGIN="${POSTER_ORIGIN:-}"
SERVICE_USER="${SERVICE_USER:-hkmovie}"

cd "${APP_DIR}"
echo "▶ $(date -Iseconds) 重建静态站点"

# ---------- 0. 抓取 ----------
if [ "${SCRAPE:-1}" = "1" ]; then
  echo "▶ 抓取数据（ONLY=${ONLY:-全部}）..."
  T_SCRAPE=$(date +%s)
  node scrape.js
  echo "  抓取耗时 $(( $(date +%s) - T_SCRAPE ))s"
else
  echo "▶ SCRAPE=0，跳过抓取（仅重建）"
fi

# ---------- 1. 校验数据 ----------
SHOWS=$(node -e "console.log(require('./data/meta.json').counts?.shows ?? 0)")
if [ "${SHOWS}" -lt 100 ]; then
  echo "  ✖ 场次仅 ${SHOWS}，疑似抓取失败，放弃重建"
  exit 1
fi
echo "  数据校验通过：${SHOWS} 场次"

# ---------- 1.7 海报本地化 ----------
# ★ 必须在构建前：页面引用的是 /posters/*.webp，图片要先落 public/posters/
#   才能被 next build 拷进 out/，再同步到 nginx 目录。
#
# 为什么要本地化（2026-09-19 实测）：
#   1. www.mclcinema.com 对**用户侧网络完全不可达**（80/443 均超时，
#      挂满 20s），而本机 0.2s 就能取到。首页 60 张海报里 28 张来自它 ——
#      近半数图片不是「慢」，而是永远加载不出来。同源后不再直连该域名。
#   2. media.grabticks.com 的 x-oss-process 参数无效（它是 S3/CloudFront，
#      不是阿里云 OSS），213 张原图 390KB–1.5MB 原样下发。
#   本地化后 390KB → 45KB，且全部同源（会被 Cloudflare 边缘缓存）。
#
# 非致命：脚本自身增量 + 自愈（文件名即 URL 的 sha1），且 lib/data.ts
#   对未命中的 URL 会回退到远端 —— 外部 CDN 抖动不该阻断整站重建。
# POSTERS=0 可跳过。
if [ "${POSTERS:-1}" = "1" ]; then
  echo "▶ 海报本地化..."
  T_POSTER=$(date +%s)
  if node scripts/fetch-posters.mjs; then
    echo "  海报耗时 $(( $(date +%s) - T_POSTER ))s"
  else
    echo "  ⚠️ 海报本地化失败，未命中部分将回退到原始 URL"
  fi
else
  echo "▶ POSTERS=0，跳过海报本地化"
fi

# ---------- 2. 构建静态站点 ----------
# 注意：不要 mv 掉 out/ 目录再建新的 —— nginx 容器的 bind mount
# 绑定的是目录 inode，替换目录会让容器看不到文件（曾踩过这个坑）。
# 直接构建到原目录即可。
echo "▶ 构建中（约 90 秒）..."
rm -rf "${APP_DIR}/out"
export NEXT_PUBLIC_SITE_URL="${SITE_URL}"
# ★ 图片子域（可选）：设了就指向灰云子域（直连香港），不设则保持同源。
#   为什么要单独一个变量：本站的 HTML/JS 走 Cloudflare 没问题（首页压缩后 7KB），
#   但海报走 CF 会慢 2.3–5.8 倍 —— CF 免费版把大陆用户导到西雅图，而源站在香港。
#   详见 lib/data.ts 里 POSTER_ORIGIN 的注释。
#   未设置时为空 → lib/data.ts 回退到同源 /posters/*.webp，行为与之前完全一致。
export NEXT_PUBLIC_POSTER_ORIGIN="${POSTER_ORIGIN:-}"
npm run build
echo "  HTML 页数: $(find out -name '*.html' | wc -l)"

# ---------- 3. 同步到 nginx 静态目录 ----------
# 同样：清空内容但保留目录本身（保持 inode 不变）
echo "▶ 同步到 ${SITE_DIR} ..."
find "${SITE_DIR}" -mindepth 1 -delete
tar -cf - -C out . | tar -xf - -C "${SITE_DIR}"
echo "  HTML 页数: $(find "${SITE_DIR}" -name '*.html' | wc -l)"

# ---------- 4. 重载 nginx ----------
docker exec nginx nginx -t >/dev/null 2>&1 && docker exec nginx nginx -s reload
echo "✅ 完成 $(date -Iseconds)"
