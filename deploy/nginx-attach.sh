#!/usr/bin/env bash
# 为「nginx 容器化」环境接入电影站站点配置
#
# 适用：nginx 以 Docker 容器运行，配置目录挂载在 /home/web/conf.d/
#      （即 /home/web/docker-compose.yml 里 nginx 服务的环境）
#
# 用法：
#   SITE_DOMAIN=hk.yuurei.de bash deploy/nginx-attach.sh
#
# 特点：
#   - 只新增一个 conf.d 文件，不修改/删除任何现有配置
#   - 自动备份 conf.d 到 /root/
#   - 配置检查失败自动回滚
set -euo pipefail

SITE_DOMAIN="${SITE_DOMAIN:-}"
WEB_DIR="${WEB_DIR:-/home/web}"
CONF_DIR="${WEB_DIR}/conf.d"
CERT_DIR="${WEB_DIR}/certs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行"
  exit 1
fi

if [ -z "${SITE_DOMAIN}" ]; then
  echo "✖ 请指定域名：SITE_DOMAIN=hk.yuurei.de bash deploy/nginx-attach.sh"
  exit 1
fi

if [ ! -d "${CONF_DIR}" ]; then
  echo "✖ 未找到 ${CONF_DIR}，请确认 nginx 容器挂载路径（可用 WEB_DIR= 覆盖）"
  exit 1
fi

echo "════════════════════════════════════════"
echo "  nginx 接入 · ${SITE_DOMAIN}"
echo "  配置目录: ${CONF_DIR}"
echo "════════════════════════════════════════"

# ---------- 1. 备份 ----------
BK="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BK}"
cp -r "${CONF_DIR}" "${BK}/"
echo "▶ 已备份现有配置 → ${BK}"

# ---------- 2. 冲突检测 ----------
if grep -rl "server_name[[:space:]]*${SITE_DOMAIN}" "${CONF_DIR}" 2>/dev/null | grep -q .; then
  echo "✖ 已存在使用 ${SITE_DOMAIN} 的配置："
  grep -rl "server_name[[:space:]]*${SITE_DOMAIN}" "${CONF_DIR}" 2>/dev/null | sed 's/^/    /'
  exit 1
fi
echo "▶ 无域名冲突"

# ---------- 3. 证书检查 ----------
CERT="${CERT_DIR}/${SITE_DOMAIN}_cert.pem"
KEY="${CERT_DIR}/${SITE_DOMAIN}_key.pem"
HAS_CERT=1
if [ -f "${CERT}" ] && [ -f "${KEY}" ]; then
  echo "▶ 证书已存在：${CERT}"
else
  HAS_CERT=0
  echo "⚠️  未找到证书："
  echo "     ${CERT}"
  echo "     ${KEY}"
  echo
  echo "  请先获取证书（二选一）："
  echo
  echo "  【推荐】Cloudflare Origin Certificate（15 年，免费）："
  echo "    CF 后台 → SSL/TLS → Origin Server → Create Certificate"
  echo "    然后把证书内容保存为：${CERT}"
  echo "                   私钥保存为：${KEY}"
  echo
  echo "  或使用 certbot（需 80 端口可访问）："
  echo "    certbot certonly --webroot -w ${WEB_DIR}/letsencrypt -d ${SITE_DOMAIN}"
  echo "    然后复制到 certs/ 目录"
  echo
  echo "  现在将只生成 HTTP(80) 配置，证书就绪后再重跑本脚本。"
fi

# ---------- 4. 生成配置 ----------
TARGET="${CONF_DIR}/${SITE_DOMAIN}.conf"

if [ "${HAS_CERT}" -eq 1 ] && [ -f "${SCRIPT_DIR}/nginx-container.conf.template" ]; then
  sed "s|__SITE_DOMAIN__|${SITE_DOMAIN}|g" "${SCRIPT_DIR}/nginx-container.conf.template" > "${TARGET}"
  echo "▶ 已生成 HTTPS 配置：${TARGET}"
else
  # 无证书：只生成 HTTP 配置（配合 CF Flexible 模式）
  # ⚠️ 必须包含 letsencrypt 字样：/root/auto_cert_renewal.sh 靠它判断
  #    走 webroot 模式（否则会走 standalone，需停掉 nginx）
  cat > "${TARGET}" <<EOF
upstream hk_movie_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${SITE_DOMAIN};

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # ACME 验证（供 certbot 签发/续期，勿删）
    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        root /var/www/letsencrypt;
    }

    location /_next/static/ {
        proxy_pass http://hk_movie_backend;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    location / {
        proxy_pass http://hk_movie_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml image/svg+xml;
}
EOF
  echo "▶ 已生成 HTTP 配置（无证书）：${TARGET}"
fi

# ---------- 5. 检查并 reload ----------
echo "▶ 检查 nginx 配置 ..."
if ! docker exec nginx nginx -t 2>&1 | sed 's/^/    /'; then
  echo "✖ 配置检查失败，回滚"
  rm -f "${TARGET}"
  docker exec nginx nginx -t >/dev/null 2>&1 && echo "  已回滚，现有配置未受影响"
  exit 1
fi
echo "  ✅ 配置正确"

echo "▶ 重载 nginx（不中断现有服务）"
docker exec nginx nginx -s reload
sleep 2

# ---------- 6. 验证 ----------
echo "▶ 验证"
if curl -sf --max-time 10 -o /dev/null -H "Host: ${SITE_DOMAIN}" http://127.0.0.1/; then
  echo "  ✅ 本机反代正常"
else
  echo "  ⚠️ 本机验证失败（若只配了 443，用 https 测）"
  curl -skf --max-time 10 -o /dev/null -H "Host: ${SITE_DOMAIN}" https://127.0.0.1/ \
    && echo "  ✅ HTTPS 反代正常" || echo "  ✖ 反代异常，查看：docker logs nginx --tail 30"
fi

echo
echo "════════════════════════════════════════"
echo "  完成"
echo "════════════════════════════════════════"
echo
echo "Cloudflare 配置提醒："
echo "  1. DNS：添加 A 记录 ${SITE_DOMAIN} → 154.219.110.23，开启代理（小黄云）"
echo "  2. SSL/TLS 模式："
if [ "${HAS_CERT}" -eq 1 ]; then
  echo "     已配置源站证书 → 选 Full (strict)"
else
  echo "     未配置源站证书 → 选 Flexible（注意：不要开 HTTP→HTTPS 跳转，会死循环）"
fi
echo "  3. 缓存规则：不要缓存 HTML（页面读实时数据）"
echo
echo "回滚方法（如需）："
echo "  rm ${TARGET} && docker exec nginx nginx -s reload"
echo "  或恢复备份：cp -r ${BK}/conf.d/* ${CONF_DIR}/"
