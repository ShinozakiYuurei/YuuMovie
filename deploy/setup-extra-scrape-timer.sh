#!/usr/bin/env bash
# 安装/更新「其余院线」抓取定时器。
#
# 背景（2026-09-28）：线上只有 light / heavy 两个抓取定时器
#   light = broadway,mcl
#   heavy = emperor,cinemacity,bestar
# 其余 8 条院线（cgv / chinachem / cineart / goldenscene / lumen / lux /
# newport / sunbeam）**没有任何定时器抓取**。scrape.js 对本次未抓取的源只并入
# 24 小时内的快照（STALE_MS），于是这些院线的快照一旦过期就永久从合并结果里
# 消失 —— 表现就是线上戏院页场次为 0 / 整间戏院消失（用户 2026-09-28 报的
# 「补全 高先及 Lumen 场次数据」）。
#
# 本脚本装第三个定时器补齐这条链路，与 light/heavy 共用 rebuild-static.sh 的
# 串行锁，抓取后重建静态站才能上线。
#
# 用法：sudo bash deploy/setup-extra-scrape-timer.sh
#       sudo bash deploy/setup-extra-scrape-timer.sh --run-now   # 立即跑一轮
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SERVICE_USER="${SERVICE_USER:-hkmovie}"
POSTER_ORIGIN="${POSTER_ORIGIN-https://imgmove.yuurei.de}"
# 与 scrape.js 的 KNOWN_SOURCES 对齐：除 light / heavy 已覆盖的 5 条之外的全部。
EXTRA_SOURCES="${EXTRA_SOURCES:-cgv,chinachem,cineart,goldenscene,lumen,lux,newport,sunbeam}"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行（sudo bash deploy/setup-extra-scrape-timer.sh）" >&2
  exit 1
fi
id -u "${SERVICE_USER}" >/dev/null 2>&1 || { echo "✖ 服务用户不存在：${SERVICE_USER}" >&2; exit 1; }
[ -f "${APP_DIR}/deploy/rebuild-static.sh" ] || { echo "✖ 找不到 ${APP_DIR}/deploy/rebuild-static.sh" >&2; exit 1; }

cat > /etc/systemd/system/hk-movie-scrape-extra.service <<EOF
[Unit]
Description=HK Movie scrape - remaining circuits (pure fetch)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=DATA_DIR=${APP_DIR}/data
Environment=POSTER_ORIGIN=${POSTER_ORIGIN}
Environment=ONLY=${EXTRA_SOURCES}
# 与 light/heavy 共用 rebuild-static.sh 的串行锁；等前面那轮释放，最长 20 分钟。
# 等不到就 exit 75 明确标记失败，不会把「没抓到」当成功。
Environment=LOCK_WAIT_SEC=1200
Environment=LOCK_BUSY_EXIT=75
# cineart 等源比 light/heavy 稍重，但仍远低于旧 Chromium 方案。
CPUQuota=150%
CPUWeight=30
MemoryMax=400M
Nice=10
ExecStart=/bin/bash ${APP_DIR}/deploy/rebuild-static.sh
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/hk-movie-scrape-extra.timer <<'EOF'
[Unit]
Description=Scrape remaining HK Movie circuits every 6 hours

[Timer]
# 每 6 小时的第 50 分启动：避开 :12 的 light、:40 的 heavy 与 :20 的 ratings。
OnCalendar=*-*-* 3,9,15,21:50:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now hk-movie-scrape-extra.timer
systemctl list-timers hk-movie-scrape-extra.timer --no-pager

if [ "${1:-}" = "--run-now" ]; then
  echo "▶ 立即执行首次「其余院线」抓取"
  systemctl start hk-movie-scrape-extra.service
fi
