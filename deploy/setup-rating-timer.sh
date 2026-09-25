#!/usr/bin/env bash
# 安装/更新独立的每小时评分刷新定时器。
# 评分抓取复用 rebuild-static.sh 的共享锁；评分写入后重建静态站才能上线。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SERVICE_USER="${SERVICE_USER:-hkmovie}"
POSTER_ORIGIN="${POSTER_ORIGIN-https://imgmove.yuurei.de}"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行（sudo bash deploy/setup-rating-timer.sh）" >&2
  exit 1
fi
id -u "${SERVICE_USER}" >/dev/null 2>&1 || { echo "✖ 服务用户不存在：${SERVICE_USER}" >&2; exit 1; }
[ -f "${APP_DIR}/deploy/rebuild-static.sh" ] || { echo "✖ 找不到 ${APP_DIR}/deploy/rebuild-static.sh" >&2; exit 1; }

cat > /etc/systemd/system/hk-movie-ratings.service <<EOF
[Unit]
Description=Refresh IMDb and Douban ratings, then rebuild HK Movie static site
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=DATA_DIR=${APP_DIR}/data
Environment=POSTER_ORIGIN=${POSTER_ORIGIN}
Environment=SCRAPE=0
Environment=ENRICH=1
Environment=FORCE_REFRESH=1
Environment=POSTERS=0
# 与现有抓取服务使用相同的内存上限；等院线抓取/构建释放共享锁，最长等 55 分钟。
# 超时通过 exit 75 明确标记失败，不会把未刷到当成功。
Environment=LOCK_WAIT_SEC=3300
Environment=LOCK_BUSY_EXIT=75
CPUQuota=100%
CPUWeight=20
MemoryMax=300M
Nice=10
ExecStart=/bin/bash ${APP_DIR}/deploy/rebuild-static.sh
TimeoutStartSec=5400
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/hk-movie-ratings.timer <<'EOF'
[Unit]
Description=Refresh IMDb and Douban ratings every hour

[Timer]
# 每小时第 20 分启动，避开 :12 的 light 与 :40 的 heavy 院线抓取。
OnCalendar=*-*-* *:20:00
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now hk-movie-ratings.timer
systemctl list-timers hk-movie-ratings.timer --no-pager

if [ "${1:-}" = "--run-now" ]; then
  echo "▶ 立即执行首次 IMDb / 豆瓣评分刷新"
  systemctl start hk-movie-ratings.service
fi
