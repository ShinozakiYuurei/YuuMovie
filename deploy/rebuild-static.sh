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
#       SCRAPE=0 bash /opt/hk-movie/deploy/rebuild-static.sh   # 跳过院线抓取
#       ENRICH=1 FORCE_REFRESH=1 SCRAPE=0 POSTERS=0 bash deploy/rebuild-static.sh  # 刷评分后重建
#       POSTERS=0 bash /opt/hk-movie/deploy/rebuild-static.sh  # 跳过海报本地化
#
#   2026-09-19 同时加了 flock 串行锁（见下）。
#   2026-09-19 又加海报本地化（第 1.7 步）：页面引用 /posters/*.webp，
#   图片必须先落 public/posters/ 再构建，否则同源海报会 404。
set -euo pipefail

# ★ 串行锁：院线抓取与评分刷新共用本脚本，避免同时读写 data/ 或重建 out/。
#   常规抓取立即放弃重复任务；每小时的评分刷新可设置 LOCK_WAIT_SEC 等待
#   当前构建结束，LOCK_BUSY_EXIT=75 时若等不到会将本轮明确标记为失败。
LOCK_FILE="${LOCK_FILE:-/tmp/hk-movie-rebuild.lock}"
LOCK_WAIT_SEC="${LOCK_WAIT_SEC:-0}"
LOCK_BUSY_EXIT="${LOCK_BUSY_EXIT:-0}"
[[ "${LOCK_WAIT_SEC}" =~ ^[0-9]+$ && "${LOCK_BUSY_EXIT}" =~ ^[0-9]+$ ]] || {
  echo "✖ LOCK_WAIT_SEC / LOCK_BUSY_EXIT 必须是非负整数" >&2
  exit 2
}
[ "${LOCK_BUSY_EXIT}" -le 255 ] || { echo "✖ LOCK_BUSY_EXIT 最大为 255" >&2; exit 2; }
exec 9>"${LOCK_FILE}"
if [ "${LOCK_WAIT_SEC}" -gt 0 ]; then
  LOCKED=0
  flock -w "${LOCK_WAIT_SEC}" 9 || LOCKED=$?
else
  LOCKED=0
  flock -n 9 || LOCKED=$?
fi
if [ "${LOCKED}" -ne 0 ]; then
  echo "⚠️ 另一個重建正在進行；等待 ${LOCK_WAIT_SEC}s 后仍未释放锁，本次退出（数据不受影响）"
  exit "${LOCK_BUSY_EXIT}"
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
  echo "▶ SCRAPE=0，跳过院线抓取"
fi

# ---------- 0.5 外部评分刷新（可选）----------
if [ "${ENRICH:-0}" = "1" ]; then
  echo "▶ 刷新 IMDb / 豆瓣评分（FORCE_REFRESH=${FORCE_REFRESH:-0}）..."
  FORCE_REFRESH="${FORCE_REFRESH:-0}" node scrapers/enrich.js
else
  echo "▶ ENRICH=0，跳过评分刷新"
fi

# ---------- 0.6 第三方简介补全（默认开）----------
# 院线不给简介的影片（新片、特映、歌劇轉播等）从 wmoov / kinohk 取一份，
# 缓存进 data/synopsis.json，由 lib/data.ts 在「整组都没有院线文案」时兜底。
#
# ⚠️ 只有香港 VPS 跑得动：wmoov 在 Cloudflare 后面，大陆直连 403（本机实测）。
# 非致命：抓不到就跳过，页面只是少这一块，不该阻断整站重建。
if [ "${SYNOPSIS:-1}" = "1" ]; then
  echo "▶ 补全院线缺失的简介..."
  # SYNOPSIS_FORCE=1 才强制重查（缓存的「查不到」有 7 天 TTL，正常重跑不会敲门）
  SYNOPSIS_FORCE="${SYNOPSIS_FORCE:-0}" node scrapers/synopsis.js || echo "  ⚠️ 简介补全失败（不影响重建）"
else
  echo "▶ SYNOPSIS=0，跳过简介补全"
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
# ★ 2026-09-20：主图由 400w 提到 800w（卡片在 HiDPI 屏上是 536×802
#   物理像素，400w 被放大显示所以发糊）。文件名带上了宽度，
#   因此 /posters/ 的 immutable 缓存不会把旧宽度的图卡住。
#   首次跑会把全部海报重下一遍（实测 346 张 58 秒），之后恢复增量。
#
# 非致命：脚本自身增量 + 自愈（文件名即 URL 的 sha1），且 lib/data.ts
#   对未命中的 URL 会回退到远端 —— 外部 CDN 抖动不该阻断整站重建。
#   重下失败时保留上一版记录（继续用旧文件），不会变成裂图。
# POSTERS=0 可跳过。
if [ "${POSTERS:-1}" = "1" ]; then
  echo "▶ 海报本地化 + 主色提取..."
  T_POSTER=$(date +%s)
  # ★ 2026-09-24：主色提取已挂在 fetch-posters.mjs 末尾（见该脚本注释）。
  #   之所以不单独跑一步：主色只依赖**已落盘的主图**，而主图刚好在
  #   fetch-posters 结束时全部就绪（含新下载与旧缓存），放一起就不会出现
  #   「图新了色没新」。取色也是增量的，日常重建只算新片（实测全量 4 秒、
  #   增量接近 0）。若确实要单独重算：node scripts/poster-colors.mjs --force
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

# ---------- 2.5 发布前快照上一版产物 ----------
# 下面第 3 步是 find -mindepth 1 -delete + 同步新产物，旧版页面一旦清掉就找不回。
# 快照放在同步之前，部署、定时抓取、评分刷新每条发布路径都自动留一份上一版整站，
# 新版本有问题或发布中途翻车时能直接拿回来。
#
# 用 cp -al 硬链接快照：瞬时完成、不复制数据，也没有 cp -a 全量拷贝的 I/O。
# 注意硬链接在这里省的是快照那一刻的复制成本，不是稳态磁盘：每次发布都是整站重建
# （tar 解包全新 inode），每份快照会钉住约 100M 数据块，KEEP=5 时稳态占用上限约 500M
# （站点 108M，其中大头是海报），磁盘余量 6.8G 可承受。
# 前提是快照目录与 SITE_DIR 在同一文件系统（都在 /dev/vda1）；跨文件系统时 cp -al
# 会整体失败 → 回退成普通 cp -a（代价同上，且慢几秒）。
# 滚动保留最近 SNAPSHOT_KEEP 份；非致命：快照失败只警告，不阻断本次发布。
SNAPSHOT_DIR="${SNAPSHOT_DIR:-${APP_DIR}/.snapshots}"
SNAPSHOT_KEEP="${SNAPSHOT_KEEP:-5}"
if [ "${SNAPSHOT:-1}" = "1" ] && [ -d "${SITE_DIR}" ] && [ -n "$(ls -A "${SITE_DIR}" 2>/dev/null)" ]; then
  echo "▶ 快照上一版产物..."
  SNAP="${SNAPSHOT_DIR}/$(date +%Y%m%d-%H%M%S)"
  # flock 已保证同一时刻只有一次重建；同一秒内的第 2、3 份…加递增序号。
  # ★ 不能只查「基名是否存在」就复用它（2026-10-04 实测踩坑）：上一秒的快照可能
  #   已被轮转回收，基名空出来 —— 复用后名字按字典序排到带后缀兄弟之前，
  #   紧接着的轮转会把这份新快照当最旧的删掉。所以只要这一秒还有任何快照，
  #   就续接最大后缀 +1，基名一去不回头；后缀递增保证同秒内字典序 = 时间序。
  #   （跨秒排序天然成立：时间戳宽度固定，下一秒的名字严格大于上一秒全部名字。）
  if ls -1 "${SNAPSHOT_DIR}" 2>/dev/null | grep -q "^$(basename "${SNAP}")\(-[0-9]\+\)\?$"; then
    _snapbase=$(basename "${SNAP}")
    _snapmax=$(ls -1 "${SNAPSHOT_DIR}" 2>/dev/null | grep -o "^${_snapbase}-[0-9]\+$" | cut -d- -f3 | sort -n | tail -1)
    SNAP="${SNAPSHOT_DIR}/${_snapbase}-$(( ${_snapmax:-0} + 1 ))"
  fi
  if mkdir -p "${SNAP}" && cp -al "${SITE_DIR}/." "${SNAP}/" 2>/dev/null; then
    echo "  已快照到 ${SNAP}（硬链接）"
  elif cp -a "${SITE_DIR}/." "${SNAP}/" 2>/dev/null; then
    echo "  硬链接快照失败（跨文件系统？），已全量拷贝到 ${SNAP}"
  else
    rm -rf "${SNAP}"
    echo "  ⚠️ 快照失败，本次发布不留档（不影响发布）"
  fi
  # cp -al 会把站点目录自身的旧 mtime 带到快照目录上（实测），恢复成创建时刻，
  # 免得人看目录时间时被误导
  if [ -d "${SNAP}" ]; then
    touch "${SNAP}"
  fi
  # 轮转：目录名即时间戳，按名字排序 = 时间排序，tail 丢弃第 KEEP+1 份起的旧快照。
  # ★ 不能用 ls -t（2026-10-04 实测踩坑）：cp -a 会把源目录自身的 mtime 原样带到
  #   快照目录上，各快照的 mtime 反映的是「站点目录上次被改的时间」而非创建时间；
  #   源目录 mtime 不变时（只覆写文件内容）所有快照 mtime 全部相同，
  #   ls -t 遇相同 mtime 退化为名字升序 —— tail 別掉的是最新的那份而不是最旧的。
  # ★ 也不能用带尾斜杠的 glob 排序（同日实测踩坑）：'/' 字节大于后缀 '-'，
  #   同一秒的首份（无后缀，最旧）会排到带后缀的兄弟之后，删的又不对 ——
  #   用 ls -1 裸名 + LC_ALL=C 按字节排序：前缀名排在前（更旧），后缀递增在后。
  [ "${SNAPSHOT_KEEP}" -ge 1 ] 2>/dev/null || SNAPSHOT_KEEP=5
  ls -1 "${SNAPSHOT_DIR}" 2>/dev/null | LC_ALL=C sort -r | tail -n +$((SNAPSHOT_KEEP + 1)) | while IFS= read -r old; do
    rm -rf "${SNAPSHOT_DIR:?}/${old}"
  done
else
  echo "▶ SNAPSHOT=0 或站点目录为空，跳过快照"
fi

# ---------- 3. 同步到 nginx 静态目录 ----------
# 同样：清空内容但保留目录本身（保持 inode 不变）
echo "▶ 同步到 ${SITE_DIR} ..."
find "${SITE_DIR}" -mindepth 1 -delete
tar -cf - -C out . | tar -xf - -C "${SITE_DIR}"
echo "  HTML 页数: $(find "${SITE_DIR}" -name '*.html' | wc -l)"

# ---------- 3.5 旧 slug 的 301 映射表 ----------
# 详情页 slug 取「组内场次最多的条目」，代表条目换人（分组规则修正、
# 场次此消彼长）时旧网址会 404 —— 实测 2026-10-04 修完分组 bug 就撞上。
# 这张表从当前数据纯推导（条目 slug 稳定，变的只是谁当代表），
# 所以每次重建都重新生成，写到 nginx 的 include 目录。
#
# ★ 非致命：生成失败就沿用上一版表（文件是原子替换，不会留半截）。
#   注意**不能**在失败时删掉它 —— 站点 conf 里是精确路径 include，
#   文件没了 nginx 直接起不来，而这个容器还带着另外三个站。
if [ "${SLUG_REDIRECTS:-1}" = "1" ]; then
  echo "▶ 生成旧 slug 的 301 映射表..."
  REDIRECT_OUT="${REDIRECT_DIR:-/home/web/conf.d/redirects}/hkmovie-slug-redirects.map" \
    node --import tsx scripts/gen-slug-redirects.mts \
    || echo "  ⚠️ 映射表生成失败，沿用上一版（旧 slug 可能仍 404，但不影响本次发布）"
else
  echo "▶ SLUG_REDIRECTS=0，跳过映射表生成"
fi

# ---------- 4. 重载 nginx ----------
# ★ 不能写成 `nginx -t && nginx -s reload`（2026-10-04 实际踩到）：
#   在 `set -e` 下，&& 列表中非末尾命令的失败是**豁免**的 ——
#   nginx -t 失败后 reload 被跳过，脚本却继续打印「✅ 完成」。
#   当时的情况是 map 表太长（键 108 字符 > 默认 bucket 64）导致 -t 失败，
#   线上带着一份**坏的磁盘配置**继续跑，只要容器重启就会连带把
#   komari / jpstage / imgmove 一起弄挂。现在显式判断，失败就非零退出。
if docker exec nginx nginx -t 2>&1 | tail -3 | sed 's/^/  /'; then
  docker exec nginx nginx -s reload
else
  echo "✖ nginx 配置检查失败，未 reload（站点仍在用旧配置运行，但磁盘上的配置是坏的）" >&2
  echo "  请先修好配置再重建；映射表异常时可用 SLUG_REDIRECTS=0 跳过生成。" >&2
  exit 1
fi
echo "✅ 完成 $(date -Iseconds)"
