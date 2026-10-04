#!/usr/bin/env bash
# 为「旧 slug → 新 slug 的 301」准备 nginx include 目录（需 root，跑一次即可）
#
# 背景：详情页 slug 取「组内场次最多的条目」，代表条目换人时旧网址就 404 了。
#   解法是让 nginx 按一张 map 表把旧地址 301 到新地址（见
#   scripts/gen-slug-redirects.mts 的详细说明）。
#
# 为什么需要这个脚本：
#   - 表是**每次重建都要重新生成**的（数据变了表就跟着变），所以写入方是
#     构建进程 hkmovie（systemd 里 User=hkmovie，无 sudo）。
#   - 而 /home/web/conf.d 是 root 所有，hkmovie 写不进去。
#   于是这里建一个**子目录**、把属主交给 hkmovie：
#     /home/web/conf.d/redirects/          root:hkmovie 0775
#         └── hkmovie-slug-redirects.map   ← 由构建进程原子替换
#
# ★ 为什么用子目录而不是直接把那个 .map 放在 conf.d 顶层：
#   nginx.conf 里是 `include /etc/nginx/conf.d/*.conf`，顶层放 .map 不会被
#   自动加载（不匹配 *.conf），但**留一个 .conf 后缀的生成物在顶层**很危险
#   —— 一旦它被当成站点配置加载，内容却是 map 块，nginx 直接起不来，
#   而这个容器还带着 komari / jpstage / imgmove。子目录隔离掉这个风险。
#
# ★ 站点 conf 里是**精确路径** include，文件缺失时 nginx 起不来
#   （实测 `[emerg] open() failed`）。所以本脚本在动站点 conf 之前
#   先放一个空 map（只有 default ""，等于「不重定向」），保证任何时刻
#   那个路径都存在。生成器之后会用原子替换覆盖它。
#
# 用法（在 VPS 上）：
#   bash deploy/setup-slug-redirects.sh            # 建目录 + 装好空表 + 接入站点 conf
#   bash deploy/setup-slug-redirects.sh --dir-only # 只建目录与空表，不碰站点 conf
set -euo pipefail

WEB_DIR="${WEB_DIR:-/home/web}"
CONF_DIR="${WEB_DIR}/conf.d"
REDIRECT_DIR="${CONF_DIR}/redirects"
MAP_FILE="${REDIRECT_DIR}/hkmovie-slug-redirects.map"
SITE_DOMAIN="${SITE_DOMAIN:-hkmovie.yuurei.de}"
SITE_CONF="${CONF_DIR}/${SITE_DOMAIN}.conf"
SERVICE_USER="${SERVICE_USER:-hkmovie}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DIR_ONLY=0
[ "${1:-}" = "--dir-only" ] && DIR_ONLY=1

if [ "$(id -u)" -ne 0 ]; then
  echo "✖ 请用 root 运行（sudo bash deploy/setup-slug-redirects.sh）"
  exit 1
fi
if [ ! -d "${CONF_DIR}" ]; then
  echo "✖ 未找到 ${CONF_DIR}，用 WEB_DIR= 指定正确路径"
  exit 1
fi

echo "▶ [1/4] 建立可写的 include 目录"
mkdir -p "${REDIRECT_DIR}"
chown "root:${SERVICE_USER}" "${REDIRECT_DIR}"
chmod 0775 "${REDIRECT_DIR}"
echo "  ${REDIRECT_DIR} → root:${SERVICE_USER} 0775"

echo "▶ [2/4] 放一张空的 map（保证 include 路径始终存在）"
# 空表 = 只有 default ""，行为上等于「没有任何重定向」，
# 因此这一步对线上是零影响，可以安全地先做。
if [ ! -s "${MAP_FILE}" ]; then
  cat > "${MAP_FILE}" <<'MAPEOF'
# /movie/ 旧 slug → 新 slug 的 301 重定向表
#
# ★ 由 scripts/gen-slug-redirects.mts 自动生成（原子替换），请勿手改。
#   本文件是「占位空表」：只有 default ""，等于没有任何重定向。
#   首次部署时由 deploy/setup-slug-redirects.sh 放入，
#   之后每次 rebuild-static.sh 重建都会用真实数据覆盖它。
map $uri $hkm_redirect_to {
    default "";
}
MAPEOF
  chown "root:${SERVICE_USER}" "${MAP_FILE}"
  chmod 0664 "${MAP_FILE}"
  echo "  已写入空表 ${MAP_FILE}"
else
  echo "  已存在非空表，保留不动（${MAP_FILE}）"
fi
# 构建进程要能原子替换 → 需要写**目录**权限，这一点上面已经给了
sudo -u "${SERVICE_USER}" test -w "${REDIRECT_DIR}" \
  && echo "  ✓ ${SERVICE_USER} 可写该目录" \
  || { echo "  ✖ ${SERVICE_USER} 仍不可写，检查目录属主"; exit 1; }

if [ "${DIR_ONLY}" -eq 1 ]; then
  echo "▶ --dir-only：跳过站点 conf 接入"
  echo "✅ 完成"
  exit 0
fi

echo "▶ [3/4] 把 include 接入站点 conf（${SITE_CONF}）"
if [ ! -f "${SITE_CONF}" ]; then
  echo "  ⚠️ 未找到 ${SITE_CONF}，跳过"
  echo "     （新装机器请用 deploy/nginx-attach.sh 接入站点 conf，它已含该 include）"
  exit 0
fi

INCLUDE_LINE="include /etc/nginx/conf.d/redirects/hkmovie-slug-redirects.map;"
if grep -qF "${INCLUDE_LINE}" "${SITE_CONF}"; then
  echo "  include 已存在，无需改动"
else
  BACKUP="${SITE_CONF}.bak-slugredirect-$(date +%Y%m%d-%H%M%S)"
  cp -a "${SITE_CONF}" "${BACKUP}"
  echo "  已备份 → ${BACKUP}"
  # 插到第一个 server 块之前（map 属于 http 上下文，放在 server 之外）
  python3 - "$SITE_CONF" "$INCLUDE_LINE" <<'PYEOF'
import sys
path, line = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as fh:
    text = fh.read()
idx = text.find('server {')
if idx < 0:
    sys.exit('✖ 站点 conf 里找不到 server 块，放弃')
text = text[:idx] + line + '\n\n' + text[idx:]
with open(path, 'w', encoding='utf-8') as fh:
    fh.write(text)
PYEOF
  echo "  已插入 include"
fi

echo "▶ [4/4] nginx 配置检查"
if ! docker exec nginx nginx -t 2>&1 | sed 's/^/    /'; then
  echo "  ✖ 配置检查失败，回滚站点 conf"
  LATEST=$(ls -t "${SITE_CONF}".bak-slugredirect-* 2>/dev/null | head -1 || true)
  if [ -n "${LATEST}" ]; then
    cp -a "${LATEST}" "${SITE_CONF}"
    echo "  已回滚（${LATEST}）"
  fi
  exit 1
fi

docker exec nginx nginx -s reload
echo "✅ 完成：旧 slug 的 301 已接入（重建时会自动刷新映射表）"
