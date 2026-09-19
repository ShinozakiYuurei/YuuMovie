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
#
#   2026-09-19 同时加了 flock 串行锁（见下）。
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

# ---------- 2. 构建静态站点 ----------
# 注意：不要 mv 掉 out/ 目录再建新的 —— nginx 容器的 bind mount
# 绑定的是目录 inode，替换目录会让容器看不到文件（曾踩过这个坑）。
# 直接构建到原目录即可。
echo "▶ 构建中（约 90 秒）..."
rm -rf "${APP_DIR}/out"
export NEXT_PUBLIC_SITE_URL="${SITE_URL}"
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
