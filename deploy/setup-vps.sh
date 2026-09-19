#!/usr/bin/env bash
# 香港 VPS 一键部署脚本（Debian/Ubuntu）
#
# 用法（在 VPS 上，项目已解压到 /opt/hk-movie）：
#   SITE_URL=https://你的域名 bash deploy/setup-vps.sh
#
# 环境变量：
#   SITE_URL    站点域名，如 https://hkfilmlist.com（用于 sitemap / canonical）
#   APP_DIR     项目目录，默认 /opt/hk-movie
#   MCL_PROXY   若非香港 VPS，填入代理地址；香港 VPS 留空即可直连
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SITE_URL="${SITE_URL:-http://localhost:3000}"
SERVICE_USER="${SERVICE_USER:-hkmovie}"
MCL_PROXY="${MCL_PROXY:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行（sudo bash deploy/setup-vps.sh）"
  exit 1
fi

echo "════════════════════════════════════════"
echo "  香港电影聚合站 · VPS 部署"
echo "  目录: ${APP_DIR}"
echo "  域名: ${SITE_URL}"
echo "  MCL 代理: ${MCL_PROXY:-（直连）}"
echo "════════════════════════════════════════"

# ---------- 1. 依赖 ----------
echo "▶ [1/7] 安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx >/dev/null

# --skip-build 模式下不需要 Node 构建工具链，但仍需 node 运行服务与抓取

# Node 22（Next 15 需要 Node >= 18.18）
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v//;s/\..*//')"
  [ "${NODE_MAJOR:-0}" -ge 20 ] && NEED_NODE=0
fi
if [ "${NEED_NODE}" -eq 1 ]; then
  echo "  安装 Node.js 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
echo "  Node $(node -v) | npm $(npm -v)"

# ---------- 2. 用户 ----------
echo "▶ [2/7] 创建服务用户"
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --shell /usr/sbin/nologin --home-dir "${APP_DIR}" "${SERVICE_USER}"
  echo "  已创建用户 ${SERVICE_USER}"
else
  echo "  用户 ${SERVICE_USER} 已存在"
fi

# ---------- 3. 构建 ----------
SKIP_BUILD=0
for arg in "$@"; do
  [ "$arg" = "--skip-build" ] && SKIP_BUILD=1
done

cd "${APP_DIR}"

if [ "${SKIP_BUILD}" -eq 1 ]; then
  # 低配机器模式：使用随包上传的已构建产物
  echo "▶ [3/7] 跳过构建（--skip-build），使用已有产物"
  if [ ! -f .next/standalone/server.js ]; then
    echo "  ✖ 未找到 .next/standalone/server.js"
    echo "    请在本机执行 npm run build && bash deploy/package-standalone.sh 后上传"
    exit 1
  fi
  # 静态资源通常已随包带入，缺失时补上
  if [ ! -d .next/standalone/.next/static ] && [ -d .next/static ]; then
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/static
  fi
  if [ -d public ] && [ ! -d .next/standalone/public ]; then
    cp -r public .next/standalone/public
  fi
  echo "  ✅ 使用已有 standalone 产物"
else
  echo "▶ [3/7] 安装依赖并构建（约 1-3 分钟）"
  export NEXT_PUBLIC_SITE_URL="${SITE_URL}"
  npm ci --no-audit --no-fund
  rm -rf .next
  npm run build

  # standalone 产物需手动补静态资源
  if [ -d .next/standalone ]; then
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/static
    if [ -d public ]; then
      cp -r public .next/standalone/public
    fi
    echo "  standalone 产物已就绪"
  else
    echo "  ✖ 未找到 standalone 产物，请确认 next.config.ts 中 output: 'standalone'"
    exit 1
  fi
fi

# 数据目录：应用以 DATA_DIR 指向项目根 data/，抓取器写入同一目录，重启即生效
mkdir -p "${APP_DIR}/data"

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

# ---------- 4. systemd: 应用 ----------
echo "▶ [4/7] 配置 systemd 服务"

cat > /etc/systemd/system/hk-movie.service <<EOF
[Unit]
Description=HK Movie Aggregator (Next.js)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_PUBLIC_SITE_URL=${SITE_URL}
# 数据目录指向项目根 data/（抓取器写入此处，重启即生效，无需重建）
Environment=DATA_DIR=${APP_DIR}/data
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

# ---------- 5. systemd: 定时抓取 + 重建 ----------
# ⚠️ 必须走 update.sh：页面是 SSG 预渲染，只更新 JSON 不重建不会生效
cat > /etc/systemd/system/hk-movie-scrape.service <<EOF
[Unit]
Description=HK Movie Scrape + Restart
After=network.target

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
Environment=SERVICE_USER=${SERVICE_USER}
Environment=SITE_URL=${SITE_URL}
Environment=MCL_PROXY=${MCL_PROXY}
ExecStart=/bin/bash ${APP_DIR}/deploy/update.sh
TimeoutStartSec=600
# 抓取/重建失败不阻断后续（update.sh 自身保证回滚与保留旧站点）
SuccessExitStatus=0 1

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/hk-movie-scrape.timer <<'EOF'
[Unit]
Description=Run HK Movie Scrape + Restart every 3 hours

[Timer]
# 服务器时区为 Asia/Hong_Kong 时即香港时间 00/03/06/.../21 点的 10 分
OnCalendar=*-*-* 00,03,06,09,12,15,18,21:10:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# ---------- 6. Nginx（非破坏性）----------
echo "▶ [5/7] 配置 Nginx 反代"

# 域名：优先用 SITE_DOMAIN，否则从 SITE_URL 解析
SITE_DOMAIN="${SITE_DOMAIN:-}"
if [ -z "${SITE_DOMAIN}" ] && [ -n "${SITE_URL}" ]; then
  SITE_DOMAIN=$(echo "${SITE_URL}" | sed -E 's|^https?://||; s|/.*$||; s|:.*$||')
fi
if [ -z "${SITE_DOMAIN}" ] || [ "${SITE_DOMAIN}" = "localhost" ]; then
  echo "  ⚠️ 未提供域名（SITE_URL / SITE_DOMAIN），将使用 _ 通配"
  echo "     若本机已有其他站点（如探针），通配会抢走其请求！"
  echo "     建议：SITE_URL=https://你的域名 bash deploy/setup-vps.sh"
  NGINX_SERVER_NAME="_"
else
  echo "  域名: ${SITE_DOMAIN}"
  NGINX_SERVER_NAME="${SITE_DOMAIN}"
fi

# ---------- 备份现有 nginx 配置 ----------
NGINX_BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${NGINX_BACKUP}"
cp -r /etc/nginx/sites-enabled "${NGINX_BACKUP}/" 2>/dev/null || true
cp -r /etc/nginx/sites-available "${NGINX_BACKUP}/" 2>/dev/null || true
cp /etc/nginx/nginx.conf "${NGINX_BACKUP}/" 2>/dev/null || true
echo "  已备份现有 nginx 配置 → ${NGINX_BACKUP}"

# ---------- 记录现有站点（用于冲突检测）----------
EXISTING_CONF=""
if [ -d /etc/nginx/sites-enabled ]; then
  EXISTING_CONF=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v '^hk-movie$' || true)
fi
if [ -n "${EXISTING_CONF}" ]; then
  echo "  检测到已有站点配置："
  echo "${EXISTING_CONF}" | sed 's/^/    - /'
fi

# ---------- 写入本站配置 ----------
# 从模板生成，替换域名占位符
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_TEMPLATE="${SCRIPT_DIR}/nginx-hk-movie.conf"

if [ -f "${NGINX_TEMPLATE}" ]; then
  sed "s|__SITE_DOMAIN__|${NGINX_SERVER_NAME}|g" "${NGINX_TEMPLATE}" \
    > /etc/nginx/sites-available/hk-movie
  echo "  已生成配置（来自模板）"
else
  # 模板缺失时回退到内联配置
  cat > /etc/nginx/sites-available/hk-movie <<NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${NGINX_SERVER_NAME};

    # Cloudflare 真实 IP 还原（套 CF 后必需）
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 2400:cb00::/32;
    set_real_ip_from 2606:4700::/32;
    set_real_ip_from 2803:f800::/32;
    set_real_ip_from 2405:b500::/32;
    set_real_ip_from 2405:8100::/32;
    set_real_ip_from 2a06:98c0::/29;
    set_real_ip_from 2c0f:f248::/32;
    real_ip_header CF-Connecting-IP;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml image/svg+xml;
}
NGINXEOF
  echo "  已生成配置（内联）"
fi

# 启用本站配置（只新增软链，不删任何东西）
ln -sf /etc/nginx/sites-available/hk-movie /etc/nginx/sites-enabled/hk-movie

# ⚠️ 关键：不删除 sites-enabled/default
#    已有站点（如探针）保持原样。若 default 是通配 server_name _，
#    且本站也用 _，会按字母序优先匹配 —— 故有域名时务必用真实域名。
if [ "${NGINX_SERVER_NAME}" = "_" ] && [ -f /etc/nginx/sites-enabled/default ]; then
  echo
  echo "  ⚠️ 警告：本站使用通配 _，且存在 default 站点"
  echo "     两者都匹配任意域名，可能互相抢请求。"
  echo "     建议改用真实域名：SITE_URL=https://你的域名 bash deploy/setup-vps.sh"
fi

if ! nginx -t 2>&1 | sed 's/^/    /'; then
  echo "  ✖ nginx 配置检查失败，回滚"
  rm -f /etc/nginx/sites-enabled/hk-movie
  nginx -t >/dev/null 2>&1 && echo "  已回滚，现有配置未受影响"
  exit 1
fi
echo "  ✅ nginx 配置检查通过"

# ---------- 7. 启动 ----------

# ---------- 7. 启动 ----------
echo "▶ [6/7] 启动服务"
# 设置时区为香港（定时任务按香港时间）
timedatectl set-timezone Asia/Hong_Kong 2>/dev/null || ln -sf /usr/share/zoneinfo/Asia/Hong_Kong /etc/localtime

systemctl daemon-reload
systemctl enable --now hk-movie.service
systemctl enable --now hk-movie-scrape.timer
systemctl restart nginx

# ---------- 验证 ----------
echo "▶ [7/7] 验证"
sleep 6
OK=1
if curl -sf --max-time 10 http://127.0.0.1:3000/ -o /dev/null; then
  echo "  ✅ 应用响应正常（Next.js）"
else
  echo "  ✖ 应用未响应 → journalctl -u hk-movie -n 50 --no-pager"
  OK=0
fi
if curl -sf --max-time 10 http://127.0.0.1/ -o /dev/null; then
  echo "  ✅ Nginx 反代正常"
else
  echo "  ✖ Nginx 异常 → nginx -t && journalctl -u nginx -n 30 --no-pager"
  OK=0
fi

echo
echo "════════════════════════════════════════"
if [ "${OK}" -eq 1 ]; then
  echo "  ✅ 部署完成"
else
  echo "  ⚠️ 部署完成但存在异常，请检查上方提示"
fi
echo "════════════════════════════════════════"
echo
echo "常用命令："
echo "  应用状态   systemctl status hk-movie"
echo "  应用日志   journalctl -u hk-movie -f"
echo "  手动更新   bash ${APP_DIR}/deploy/update.sh   # 抓取+重启（无需重建）"
echo "  更新日志   journalctl -u hk-movie-scrape -n 50 --no-pager"
echo "  定时器     systemctl list-timers hk-movie-scrape.timer"
echo "  重启应用   systemctl restart hk-movie"
echo
echo "ℹ️ 定时任务每 3 小时「抓取 → 重启」，无需重建（数据在运行时读取）"
echo
echo "下一步：配置 HTTPS（需先把域名解析到本机 IP）"
echo "  apt install -y certbot python3-certbot-nginx"
echo "  certbot --nginx -d 你的域名"
echo
if [ -z "${MCL_PROXY}" ]; then
  echo "ℹ️ 未设 MCL_PROXY，MCL 将直连抓取（仅香港 IP 可成功；失败不影响百老汇）"
else
  echo "ℹ️ MCL 通过代理抓取：${MCL_PROXY}"
fi
