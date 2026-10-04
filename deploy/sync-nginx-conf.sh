#!/usr/bin/env bash
# 把仓库里的 nginx 站点配置同步到线上（需 root，由 deploy/sync.sh 调用）
#
# ── 为什么需要它 ──────────────────────────────────────────────
# ★ 2026-10-04 实际踩到的坑：`deploy/nginx-static.conf` 虽然早就收编入库
#   （注释里写着「此处收编入库」，见该文件头部），但**部署链路从不推它** ——
#   sync.sh 只推代码、跑 vps-deploy.sh，站点 conf 一直靠手工改。
#   后果：仓库里加了 map_hash_bucket_size，线上没有，于是新加的 include
#   让 `nginx -t` 直接失败（[emerg] could not build map_hash），
#   而那次失败又被静默吞掉（见下），线上带着一份**坏的磁盘配置**继续跑 ——
#   只要 nginx 容器重启，komari / jpstage / imgmove 会一起挂。
#
# ★ 关于「静默吞掉」：rebuild-static.sh 里原来是
#       docker exec nginx nginx -t >/dev/null 2>&1 && docker exec nginx nginx -s reload
#   在 `set -e` 下，`A && B` 里 A 失败**不会**中止脚本（bash 的既有行为：
#   && 列表中非末尾命令的失败是豁免的），于是 reload 被跳过、脚本继续打印
#   「✅ 完成」。现在改成显式 if，失败就非零退出。
#
# ── 它做什么（幂等）───────────────────────────────────────────
#   1. 确保 include 目录存在（调 setup-slug-redirects.sh --dir-only，含占位空表）
#   2. 用仓库的 nginx-static.conf 渲染出目标 conf（替换 __SITE_DOMAIN__）
#   3. 与线上比对：一致就只做一次 nginx -t（快速返回，不做无谓 reload）
#   4. 不一致才：备份 → 装新 → nginx -t → 失败则**自动回滚**并报错
#
# 用法（root）：
#   SITE_DOMAIN=hkmovie.yuurei.de bash deploy/sync-nginx-conf.sh
#   DRY_RUN=1 ... bash deploy/sync-nginx-conf.sh    # 只显示会改什么
set -euo pipefail

WEB_DIR="${WEB_DIR:-/home/web}"
CONF_DIR="${WEB_DIR}/conf.d"
SITE_DOMAIN="${SITE_DOMAIN:-hkmovie.yuurei.de}"
SITE_CONF="${CONF_DIR}/${SITE_DOMAIN}.conf"
NGINX_CONTAINER="${NGINX_CONTAINER:-nginx}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/nginx-static.conf"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（sync.sh 会以 root 调用）"
[ -f "${TEMPLATE}" ] || die "找不到模板 ${TEMPLATE}"
[ -d "${CONF_DIR}" ] || die "找不到 ${CONF_DIR}"

# ---------- 1. include 目录与占位表 ----------
# 站点 conf 里是**精确路径** include，文件缺失时 nginx 起不来，
# 所以先保证目录与占位表存在（幂等）。
if [ -x "${SCRIPT_DIR}/setup-slug-redirects.sh" ] || [ -f "${SCRIPT_DIR}/setup-slug-redirects.sh" ]; then
  bash "${SCRIPT_DIR}/setup-slug-redirects.sh" --dir-only >/dev/null
else
  log "⚠️ 缺 setup-slug-redirects.sh，跳过 include 目录准备"
fi

# ---------- 2. 渲染目标 conf ----------
RENDERED="$(mktemp)"
trap 'rm -f "${RENDERED}"' EXIT
sed "s|__SITE_DOMAIN__|${SITE_DOMAIN}|g" "${TEMPLATE}" > "${RENDERED}"

# ---------- 3. 一致就早退 ----------
if [ -f "${SITE_CONF}" ] && cmp -s "${RENDERED}" "${SITE_CONF}"; then
  log "站点 conf 已是最新（${SITE_CONF}）"
  if ! docker exec "${NGINX_CONTAINER}" nginx -t >/dev/null 2>&1; then
    die "nginx 配置检查失败（配置虽未变，但磁盘上的配置是坏的，请立即排查）"
  fi
  exit 0
fi

log "站点 conf 需要更新：${SITE_CONF}"
if [ "${DRY_RUN}" = "1" ]; then
  diff -u "${SITE_CONF}" "${RENDERED}" 2>/dev/null | head -60 || true
  log "DRY_RUN=1，未改动"
  exit 0
fi

# ---------- 4. 备份 → 安装 → 校验 → 失败回滚 ----------
BACKUP="${SITE_CONF}.bak-conf-sync-$(date +%Y%m%d-%H%M%S)"
if [ -f "${SITE_CONF}" ]; then
  cp -a "${SITE_CONF}" "${BACKUP}"
  log "已备份 → ${BACKUP}"
else
  log "线上还没有该 conf，本次为新建"
fi

cp -a "${RENDERED}" "${SITE_CONF}"

if docker exec "${NGINX_CONTAINER}" nginx -t 2>&1 | sed 's/^/    /'; then
  docker exec "${NGINX_CONTAINER}" nginx -s reload
  log "已安装并 reload（$(sha1sum < "${SITE_CONF}" | cut -c1-12)）"
else
  printf '✖ nginx 配置检查失败，回滚\n' >&2
  if [ -f "${BACKUP}" ]; then
    cp -a "${BACKUP}" "${SITE_CONF}"
    printf '  已回滚到 %s\n' "${BACKUP}" >&2
    # 回滚后必须仍是好的；若连回滚都救不回来，就明确喊出来
    docker exec "${NGINX_CONTAINER}" nginx -t >/dev/null 2>&1 \
      || printf '  ✖ 回滚后配置仍不通过，请立即人工介入\n' >&2
  else
    rm -f "${SITE_CONF}"
    printf '  已删除新建的 conf（原本不存在）\n' >&2
  fi
  exit 1
fi
