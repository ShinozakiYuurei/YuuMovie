#!/usr/bin/env bash
# 抓取数据 + 重启应用（无需重新构建）
#
# 为什么不需要重建：lib/data.ts 在**运行时**用 fs 读取 data/*.json，
# 页面为动态渲染（force-dynamic）。更新 JSON 后重启进程即可生效。
# （旧架构是 SSG 预渲染，必须重建；已改掉，见 README）
#
# 用法：bash deploy/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SERVICE_USER="${SERVICE_USER:-hkmovie}"
MCL_PROXY="${MCL_PROXY:-}"
BACKUP_DIR="/tmp/hk-movie-backup"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行（sudo bash deploy/update.sh）"
  exit 1
fi

cd "${APP_DIR}"
echo "▶ $(date -Iseconds) 开始更新"

# ---------- 1. 备份 ----------
rm -rf "${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"
cp -r data/* "${BACKUP_DIR}/" 2>/dev/null || true

rollback() {
  echo "  ⚠️ 回滚数据，保留现有站点"
  cp -r "${BACKUP_DIR}"/* data/ 2>/dev/null || true
  chown -R "${SERVICE_USER}:${SERVICE_USER}" data 2>/dev/null || true
  exit 1
}

# ---------- 2. 抓取 ----------
echo "▶ 抓取数据 ..."
export NODE_ENV=production
if ! MCL_PROXY="${MCL_PROXY}" node scrape.js; then
  rollback
fi

# ---------- 3. 校验 ----------
if [ ! -f data/meta.json ]; then
  echo "  ✖ 未产出 data/meta.json"
  rollback
fi

SHOWS=$(node -e "console.log(require('./data/meta.json').counts?.shows ?? 0)")
ORPHANS=$(node -e "console.log(require('./data/meta.json').integrity?.orphanShows ?? 0)")
echo "  场次 ${SHOWS} | 悬空引用 ${ORPHANS}"

if ! [ "${SHOWS:-0}" -ge 100 ] 2>/dev/null; then
  echo "  ✖ 场次数异常偏低（${SHOWS:-空}）"
  rollback
fi

if [ "${ORPHANS:-0}" -gt 0 ] 2>/dev/null; then
  echo "  ⚠️ 存在悬空引用（${ORPHANS} 条），数据可能不一致，请检查"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" data

# ---------- 4. 重启（清内存缓存，让新数据立即生效）----------
echo "▶ 重启应用 ..."
systemctl restart hk-movie.service
sleep 5

if curl -sf --max-time 10 http://127.0.0.1:3000/ -o /dev/null; then
  echo "✅ $(date -Iseconds) 更新完成"
else
  echo "✖ 应用未响应 → journalctl -u hk-movie -n 50 --no-pager"
  exit 1
fi
