#!/usr/bin/env bash
# 服务器端部署：由 deploy/sync.sh 通过 ssh 调用，也可手工调用。
#
#   sudo -u hkmovie bash /tmp/hkmovie-vps-deploy.sh            # 部署 origin/main
#   sudo -u hkmovie bash /tmp/hkmovie-vps-deploy.sh <sha>      # 部署指定存档点（回滚）
#
# 必须由 hkmovie 身份执行：rebuild-static.sh 的 flock 锁文件、站点目录、
# node_modules 都属于它，以 root 跑会 Permission denied。
#
# 必须带 ref 参数，不用裸 `git pull`：pull 跟随 origin/HEAD 的指向，实测踩过
# 它指向一个本地从未 fetch 过的分支。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/hk-movie}"
SITE_DIR="${SITE_DIR:-/home/web/html}"
REPO="${REPO_URL:-git@github.com:ShinozakiYuurei/YuuMovie.git}"
REF="${1:-main}"
cd "$APP_DIR"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

target_paths() { git ls-tree -r --name-only "$1"; }

# 脏 = 已跟踪文件的改动 + 与目标树重名的未跟踪文件。
# 只看前者会漏掉首次收编（那里没有任何已跟踪文件，护栏全废），
# 只列后者会被 data/ 之类噪声刷屏，所以未跟踪部分只算真会阻塞 checkout 的。
dirty_paths() {
  git status --porcelain --untracked-files=no | sed 's/^...//;s/.* -> //'
  target_paths "$TARGET" | while read -r p; do
    [ -e "$p" ] || continue
    git ls-files --error-unmatch "$p" >/dev/null 2>&1 || echo "UNTRACKED  $p"
  done
}

BK=""
new_backup() { BK=".backup/pre-takeover-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BK"; }

# 把「目标树里有、但本地未被跟踪」的文件移进备份区。
# 不移走的话 git checkout 会直接 Aborting —— 真实首次收编正是这样失败的：
# /opt/hk-movie 有 83 个文件却没有 .git，它们全是未跟踪的。
stash_collisions() {
  local moved=0
  target_paths "$TARGET" | while read -r p; do
    [ -e "$p" ] || continue
    git ls-files --error-unmatch "$p" >/dev/null 2>&1 && continue
    mkdir -p "$BK/$(dirname "$p")"
    mv "$p" "$BK/$p"
  done
  moved=$(find "$BK" -type f 2>/dev/null | wc -l)
  log "已把 $moved 个阻塞文件移入 $BK"
}

# 首次收编：HEAD 为空，目录下所有文件都是未跟踪的。
# 整体 tar 一份（不只目标树），因为收编后任何不在仓库里的代码文件都成了孤儿，
# 必须连本地专有文件一起能找回。
take_over() {
  local n_exist
  n_exist=$(target_paths "$TARGET" | while read -r p; do [ -e "$p" ] && echo x; done | wc -l)
  if [ "$n_exist" = "0" ]; then
    log "目录为空，无需收编"
    return 0
  fi
  new_backup
  tar -cf "${BK}.tar" --exclude=./node_modules --exclude=./.git --exclude=./data \
      --exclude=./out --exclude=./.next --exclude=./.backup --exclude=./dist . 2>/dev/null || true
  log "首次收编：整目录已 tar 到 ${BK}.tar（$(tar -tf "${BK}.tar" 2>/dev/null | wc -l) 项），$n_exist 个同名文件让位给仓库"
  stash_collisions
}

# 发布后的结构自检。跳过重建的分支也要跑：版本没变不代表站点完好，
# 上一轮演练就是被"已是目标版本"提前退出掩盖了死链检查没执行。
verify_site() {
  [ -f "$SITE_DIR/index.html" ] || die "$SITE_DIR/index.html 不存在，站点没同步出来"
  local n rc=0 min
  n=$(find "$SITE_DIR" -name '*.html' | wc -l)
  min="${MIN_HTML:-100}"
  log "线上 HTML 页数 $n"
  # 阈值可注入：真实站点 240+ 页，沙箱里的假构建只有几页。
  [ "$n" -gt "$min" ] || die "页数只有 $n，低于阈值 $min，站点疑似残缺"
  if [ -f probe/check-published-links.mjs ]; then
    node probe/check-published-links.mjs "$SITE_DIR" || rc=$?
    # 1 = 真有死链；2 = 检查根本没跑起来。两者都要判死，但原因不同，
    # 不能用 && 串联（set -e 下先失败的那个会吞掉后面的分支）。
    if [ "$rc" = "1" ]; then
      die "存在死链，判定发布不健康"
    elif [ "$rc" != "0" ]; then
      die "死链检查未能执行（exit $rc），不能当作通过"
    fi
  else
    log "⚠️ 缺 probe/check-published-links.mjs，本次未做死链检查"
  fi

  # 詳情頁歸屬（用戶 2026-09-23 回報：待映片詳情頁被標成現正上映，頂欄色塊也亮錯）。
  # 放在**伺服器**而不是本地自檢：它要掃的是構建產物（HTML + 打包後的 CSS），
  # 本機在 `next build` 之前根本沒有 out/ 可掃。
  # 為什麼不能只靠人眼：這個 bug 編譯過、構建過、頁面 200，只有文案不對。
  if [ -f probe/check-nav-category.mjs ]; then
    rc=0
    node probe/check-nav-category.mjs "$SITE_DIR" || rc=$?
    if [ "$rc" = "1" ]; then
      die "詳情頁歸屬與列表不一致，判定發布不健康"
    elif [ "$rc" != "0" ]; then
      die "詳情頁歸屬檢查未能執行（exit $rc），不能當作通過"
    fi
  else
    log "⚠️ 缺 probe/check-nav-category.mjs，本次未做詳情頁歸屬檢查"
  fi

  # 詳情頁「級別」的長相（用戶 2026-09-25 回報：待映片的 TBC 是一行裸灰字，
  # 與現正上映那枚灰底藥丸不同殼）。同一類 bug 的第三例：編譯過、構建過、
  # 頁面 200，只是兩種分級狀態長得不一樣，只有肉眼看得出來。
  # 一並釘住第二個坑：JSON-LD 的 contentRating 必須與徽章同源
  #   （原先讀 group.primary.category，emperor 來源的片徽章寫 IIB、結構化數據寫「8.0」）。
  if [ -f probe/check-rating-badge.mjs ]; then
    rc=0
    node probe/check-rating-badge.mjs "$SITE_DIR" || rc=$?
    if [ "$rc" = "1" ]; then
      die "詳情頁級別顯示不一致（或與 JSON-LD 不符），判定發布不健康"
    elif [ "$rc" != "0" ]; then
      die "級別顯示檢查未能執行（exit $rc），不能當作通過"
    fi
  else
    log "⚠️ 缺 probe/check-rating-badge.mjs，本次未做級別顯示檢查"
  fi
}

# ---------- 0 首次收编：把服务器目录变成仓库 ----------
if [ ! -d .git ]; then
  log "初始化仓库（首次收编）"
  git init -q
  # 不必把默认分支改成 main：实测即使 git init 出来的是 master，
  # 后面的 `git checkout -B main <起点>` 也照样建得出 main。
  git remote add origin "$REPO"
  git config user.name  "vps-deploy"
  git config user.email "vps-deploy@local"
fi

log "fetch origin"
git fetch -q --prune origin

# 解析 ref：分支名 → 远端分支；sha → 直接对象
if git rev-parse --verify -q "refs/remotes/origin/$REF" >/dev/null; then
  TARGET=$(git rev-parse "refs/remotes/origin/$REF")
  BRANCH="$REF"
elif git rev-parse --verify -q "$REF^{commit}" >/dev/null; then
  TARGET=$(git rev-parse "$REF^{commit}")
  BRANCH=""
  log "目标是 commit（回滚模式，detached HEAD）"
else
  die "$REF 既不是 origin 上的分支也不是已知 commit。可用分支：$(git branch -r | tr -d ' ' | paste -sd, -)"
fi

CUR=$(git rev-parse -q --verify HEAD 2>/dev/null || echo "")

# ---------- 1 工作区护栏 ----------
if [ -z "$CUR" ]; then
  take_over
elif [ "$CUR" = "$TARGET" ] && [ -z "$(dirty_paths)" ] && [ "${SCRAPE:-0}" != "1" ] && [ -z "${ONLY:-}" ]; then
  log "服务器已是目标版本，不重建（仍复核站点）"
  verify_site
  exit 0
else
  DIRTY=$(dirty_paths)
  if [ -n "$DIRTY" ]; then
    echo "⚠️ 服务器代码与仓库不一致（$(echo "$DIRTY" | wc -l) 项）："
    echo "$DIRTY" | head -20 | sed 's/^/    /'
    if [ "${FORCE_TAKEOVER:-0}" != "1" ]; then
      die "已停手。要么把服务器改动提交回仓库，要么 FORCE_TAKEOVER=1 明确以仓库为准（会先备份）"
    fi
    new_backup
    while read -r p; do
      p=${p#UNTRACKED  }
      [ -n "$p" ] && [ -e "$p" ] || continue
      mkdir -p "$BK/$(dirname "$p")"; cp -a "$p" "$BK/$p"
    done <<< "$DIRTY"
    log "服务器改动已备份到 $BK"
    git checkout -q -- . 2>/dev/null || true
    stash_collisions
  fi
fi

# ---------- 2 切到目标版本 ----------
log "切到 ${TARGET:0:8}"
if [ -n "$BRANCH" ]; then
  git checkout -q -B "$BRANCH" "$TARGET"
else
  git checkout -q --detach "$TARGET"
fi

# ---------- 3 依赖 ----------
# --include=dev 不可省：typescript / tailwindcss / postcss / tsx 全在 devDependencies，
# 而 rebuild-static.sh 会 export NODE_ENV=production，npm 据此默认 --omit=dev。
# 实测不加旗标时 `npm ci` 输出 "remove tsx"。
# 用锁文件 md5 戳判断是否重装，不用 git diff：首次部署 CUR 为空时 diff 会报错，
# 被误判成"没变"而跳过安装。戳按 APP_DIR 命名，免得沙箱演练写下的戳
# 让真实部署误判依赖未变。
STAMP="${DEPS_STAMP:-/tmp/hkmovie-deps-$(basename "$APP_DIR").stamp}"
LOCK_HASH=$(md5sum package-lock.json | cut -d' ' -f1)
if [ -d node_modules ] && [ "$(cat "$STAMP" 2>/dev/null || echo none)" = "$LOCK_HASH" ]; then
  log "依赖未变，跳过 npm ci"
else
  log "npm ci --include=dev"
  npm ci --include=dev --no-audit --no-fund
  echo "$LOCK_HASH" > "$STAMP"
fi

# ---------- 4 重建静态站 ----------
# rebuild-static.sh 默认只抓院线数据；ENRICH=1 时可在构建前增量刷新评分。
# 常规定时抓取与发布默认 ENRICH=0，评分由独立的每小时 service/timer 处理。
#
# ★ 2026-09-21 修复：POSTER_ORIGIN 必须显式传下去
#
#   问题：两个 systemd 定时器（hk-movie-scrape-*.service）的 unit 里写了
#     Environment=POSTER_ORIGIN=https://imgmove.yuurei.de
#   但**本脚本没有**—— 它由 `sudo -u hkmovie bash vps-deploy.sh` 从 SSH 会话
#   启动，不继承任何 systemd 的 Environment。于是 `bash deploy/rebuild-static.sh`
#   读到的 POSTER_ORIGIN 是空字符串（脚本里 `${POSTER_ORIGIN:-}` 的默认值），
#   海报被构建成同源 /posters/*.webp。
#
#   后果：每次 `deploy/sync.sh` 上线后，海报会退回经 CF 西雅图的慢路径，
#   直到下一个定时器（最晚 2 小时）重建才恢复。大陆实测差距：
#     同源 5 张海报 3852ms / TLS 0.33s  vs  子域 1735ms / TLS 0.10s
#
#   修法：把子域写成本脚本的默认值（与 unit 里的一致），并允许环境覆盖。
#   注意这里不能用 `:-` 的空字符串默认—— 那正是 bug 的来源；
#   回滚办法是显式传 POSTER_ORIGIN= （空）来强制同源。
POSTER_ORIGIN="${POSTER_ORIGIN-https://imgmove.yuurei.de}"
log "重建静态站（SCRAPE=${SCRAPE:-0} ENRICH=${ENRICH:-0} FORCE_REFRESH=${FORCE_REFRESH:-0} POSTER_ORIGIN=${POSTER_ORIGIN:-<同源>}）"
# ★ 2026-09-25 修复：rebuild-static.sh 在「另一个重建正在进行」时会 **exit 0**
#   （flock 抢不到就放弃，见该脚本第 0 节）—— 它什么都没构建，但退出码是成功。
#   原先这里直接往下走到 verify_site，于是：
#     - 站点目录里还是**上一个版本**的产物，
#     - 新加的守卫却已经在拿它当真检验（实测被误报成「新代码有 bug」），
#     - 而且整条链路以「✅ 已发布」结束 —— 代码切了、页面没换，最坏的一种结果。
#   现在把「跳过了」当成部署失败：明确要求重跑，而不是把未知当成功。
REBUILD_OUT=$(mktemp)
trap 'rm -f "$REBUILD_OUT"' EXIT
set +e
SCRAPE="${SCRAPE:-0}" ENRICH="${ENRICH:-0}" FORCE_REFRESH="${FORCE_REFRESH:-0}" POSTER_ORIGIN="$POSTER_ORIGIN" \
  eval "${REBUILD:-bash deploy/rebuild-static.sh}" 2>&1 | tee "$REBUILD_OUT"
REBUILD_RC=${PIPESTATUS[0]}
set -e
[ "$REBUILD_RC" = "0" ] || die "重建失败（exit $REBUILD_RC），未发布"
if grep -q '另一個重建正在進行' "$REBUILD_OUT"; then
  die "重建被跳過（定時器正在重建，flock 未拿到）—— 代码已切到 ${TARGET:0:8} 但站点仍是上一版。\n   等定時器跑完再重跑一次 deploy/sync.sh 即可（工作區已乾淨，會直接走部署）。"
fi

# ---------- 5 自检 + 记录线上版本 ----------
verify_site

# 版本号写在工作区而不是站点目录：rebuild-static.sh 结尾会
# find "$SITE_DIR" -mindepth 1 -delete，而定时器不跑本脚本，
# 记在站点里的版本下一次抓取就被抹掉。
printf '%s\t%s\t%s\n' "$TARGET" "$(git log -1 --format=%s | cut -c1-70)" "$(date -Iseconds)" \
  > "$APP_DIR/.deploy-info"
log "线上版本 = ${TARGET:0:8}（记于 $APP_DIR/.deploy-info）"
log "完成"
