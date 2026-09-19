#!/usr/bin/env bash
# 图片子域上线：签发证书 + 安装 nginx 配置。
#
#   sudo bash deploy/setup-img-subdomain.sh img.yuurei.de
#
# 为什么需要它（2026-09-19 实测）：
#   CF 免费版把大陆用户导到西雅图，而源站在香港 → 海报走 CF 慢 2.3–5.8 倍。
#   另开灰云子域（仅 DNS，不经 CF）指向香港源站可解决。详见 nginx-img.conf。
#
# ★ 本脚本存在的关键理由：先有鸡还是先有蛋。
#   完整配置里 443 段引用了 img.<域名> 的证书文件，但该证书还没签发 ——
#   直接装完整配置会让 `nginx -t` 失败（找不到证书文件），而证书又需要
#   nginx 先能在 80 端口响应 ACME 验证。解法：先装一个**只有 80 端口 +
#   ACME 路径**的临时配置，签发成功后再换成完整配置。
#
# 幂等：已有证书时跳过签发；可重复执行。
set -euo pipefail

IMG_DOMAIN="${1:-}"
[ -n "$IMG_DOMAIN" ] || { echo "✖ 用法：bash $0 <图片子域>，例如 img.yuurei.de"; exit 1; }

CONF_DIR=/home/web/conf.d
CERT_DIR=/home/web/certs
LE_WEBROOT=/home/web/letsencrypt
TARGET_CONF="${CONF_DIR}/${IMG_DOMAIN}.conf"
LE_EMAIL="${LE_EMAIL:-your@email.com}"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# ---------- 0 前置检查 ----------
log "检查 ${IMG_DOMAIN} 的 DNS"
RESOLVED=$(getent hosts "$IMG_DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
[ -n "$RESOLVED" ] || die "${IMG_DOMAIN} 解析不到。请先在 Cloudflare 面板添加 A 记录（灰云）→ 154.219.110.23"

# 灰云 = 直接解析到源站 IP。若解析到 CF 的 IP 段，说明还是橙云，ACME 会失败。
case "$RESOLVED" in
  104.*|172.6[4-9].*|172.7[0-1].*|188.114.*|162.15[89].*|173.245.*|103.2[12].*|141.101.*|108.162.*|190.93.*|197.234.*|198.41.*)
    die "${IMG_DOMAIN} 解析到 ${RESOLVED}（Cloudflare 的 IP），说明仍是橙云。
    请在 Cloudflare 面板把该记录的云朵图标点成**灰色**（仅 DNS），
    否则 ACME HTTP-01 验证会失败，且流量仍会绕西雅图。" ;;
esac
log "  → ${RESOLVED}（灰云，正确）"

command -v docker >/dev/null || die "需要 docker"
docker images --format '{{.Repository}}' | grep -qx 'certbot/certbot' || {
  log "拉取 certbot 镜像"
  docker pull certbot/certbot
}

# ---------- 1 已有证书则跳过签发 ----------
NEED_CERT=1
if [ -f "${CERT_DIR}/${IMG_DOMAIN}_cert.pem" ]; then
  # 检查是否仍然有效（到期前 15 天内视为需要重签）
  if openssl x509 -in "${CERT_DIR}/${IMG_DOMAIN}_cert.pem" -noout -checkend $((15*86400)) >/dev/null 2>&1; then
    log "证书已存在且 15 天内不会过期，跳过签发"
    NEED_CERT=0
  else
    log "证书即将过期，重新签发"
  fi
fi

# ---------- 2 临时配置（只有 80 + ACME，让 nginx -t 先过）----------
if [ "$NEED_CERT" = "1" ]; then
  log "安装临时配置（仅 80 端口 + ACME 验证）"
  mkdir -p "$LE_WEBROOT"
  cat > "$TARGET_CONF" <<EOF
# 临时配置：仅为签发 ${IMG_DOMAIN} 证书而存在，签发后由 setup-img-subdomain.sh 覆盖。
# 之所以不能直接装完整配置：443 段引用的证书此刻还不存在，nginx -t 会失败。
server {
    listen 80;
    listen [::]:80;
    server_name ${IMG_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        root /var/www/letsencrypt;
    }

    location / { return 404; }
}
EOF
  docker exec nginx nginx -t >/dev/null 2>&1 || die "临时配置语法失败"
  docker exec nginx nginx -s reload
  sleep 1

  log "签发证书（certbot webroot）"
  docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v "${LE_WEBROOT}:/var/www/letsencrypt" \
    certbot/certbot certonly \
    --webroot -w /var/www/letsencrypt \
    -d "$IMG_DOMAIN" \
    --email "$LE_EMAIL" \
    --agree-tos --no-eff-email \
    --key-type ecdsa \
    --non-interactive \
    || die "签发失败。常见原因：DNS 还是橙云、80 端口未放行、或域名写错"

  log "复制证书到 ${CERT_DIR}"
  mkdir -p "$CERT_DIR"
  cp "/etc/letsencrypt/live/${IMG_DOMAIN}/fullchain.pem" "${CERT_DIR}/${IMG_DOMAIN}_cert.pem"
  cp "/etc/letsencrypt/live/${IMG_DOMAIN}/privkey.pem"   "${CERT_DIR}/${IMG_DOMAIN}_key.pem"
fi

# ---------- 3 安装完整配置 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "${SCRIPT_DIR}/nginx-img.conf" ] || die "缺 ${SCRIPT_DIR}/nginx-img.conf"

log "安装完整配置（443 + /posters/ 缓存）"
# 先备份，便于回滚
[ -f "$TARGET_CONF" ] && cp "$TARGET_CONF" "/root/${IMG_DOMAIN}.conf.bak.$(date +%s)"
sed "s/__IMG_DOMAIN__/${IMG_DOMAIN}/g" "${SCRIPT_DIR}/nginx-img.conf" > "$TARGET_CONF"

if ! docker exec nginx nginx -t 2>&1 | tail -2; then
  die "完整配置语法失败，已保留原文件供排查：$TARGET_CONF"
fi
docker exec nginx nginx -s reload
log "nginx 已重载"

# ---------- 4 验证 ----------
log "验证（源站本机自测，绕开 DNS）"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -k --resolve "${IMG_DOMAIN}:443:127.0.0.1" \
  "https://${IMG_DOMAIN}/posters/$(ls /home/web/html/posters/*.webp 2>/dev/null | head -1 | xargs -r basename)" || echo 000)
echo "  HTTPS 取一张海报: HTTP ${CODE}"
[ "$CODE" = "200" ] || echo "  ⚠️ 非 200，检查 /home/web/html/posters/ 是否有文件"

log "完成。下一步：在服务器上设置 POSTER_ORIGIN 并重建"
cat <<EOF

  ★ 切换到图片子域（构建时注入，必须重建才会生效）：

    cd /opt/hk-movie
    sudo -u hkmovie POSTER_ORIGIN=https://${IMG_DOMAIN} bash deploy/rebuild-static.sh

  或在 systemd 定时器里持久化（这样每 2/6 小时的自动重建也用它）：
    给 hk-movie-scrape-light.service / -heavy.service 的 [Service] 段加
      Environment=POSTER_ORIGIN=https://${IMG_DOMAIN}
    然后 systemctl daemon-reload

  回滚：把 POSTER_ORIGIN 留空重建即可（lib/data.ts 会退回同源 /posters/）。
EOF
