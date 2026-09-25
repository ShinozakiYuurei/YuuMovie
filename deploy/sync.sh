#!/usr/bin/env bash
# 一条命令把本机代码发布到线上。
#
#   bash deploy/sync.sh                 # 存档本机改动 → 推送 → 服务器拉取重建 → 冒烟
#   bash deploy/sync.sh -m "修好筛选"   # 指定提交说明
#   bash deploy/sync.sh --no-deploy     # 只存档推送，不上线
#   bash deploy/sync.sh --rollback      # 把线上退回它自己的上一个存档点（不存档不推送）
#   bash deploy/sync.sh --to <sha>      # 线上切到指定存档点
#   SCRAPE=1 ONLY=mcl bash deploy/sync.sh  # 本次部署只抓 MCL，再构建发布
#
# 为什么需要它：本项目页面是 SSG，代码不推到服务器并重建，线上就永远是旧的。
# VPS 的 systemd 定时器只重复构建它自己已有的代码，从不拉新代码。
set -euo pipefail

VPS="${VPS_ALIAS:-伤心的云-HK}"
APP_DIR="${APP_DIR:-/opt/hk-movie}"
BRANCH="${DEPLOY_BRANCH:-main}"
SITE="${SITE_URL:-https://hkmovie.yuurei.de}"
# 伺服器上的站點目錄（與 deploy/vps-deploy.sh 的預設值一致）
# 冒煙測試需要它 —— 要从產物裡取一個真實的 movie slug，見 smoke()。
REMOTE_SITE_DIR="${SITE_DIR:-/home/web/html}"
TSX=node_modules/.bin/tsx
TSC=node_modules/.bin/tsc
cd "$(dirname "$0")/.."

DEPLOY=1; MODE=deploy; MSG=""; TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-deploy) DEPLOY=0 ;;
    --rollback)  MODE=rollback ;;
    --to)        MODE=to; shift; TO="${1:-}" ;;
    -m)          shift; MSG="${1:-}" ;;
    -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
  shift
done
# --to 不带值时不能默默变成一次正常部署，那正好是最危险的结果
[ "$MODE" != "to" ] || [ -n "$TO" ] || { echo "✖ --to 需要跟一个 sha 或分支名"; exit 1; }

# 显式抓取选项要传到服务器重建进程，供一次性定向抓取（例如 ONLY=mcl）。
DEPLOY_SCRAPE="${SCRAPE:-0}"
DEPLOY_ONLY="${ONLY:-}"
case "$DEPLOY_SCRAPE" in 0|1) ;; *) echo "✖ SCRAPE 只接受 0 或 1"; exit 1 ;; esac
if [ -n "$DEPLOY_ONLY" ]; then
  IFS=, read -r -a _sources <<< "$DEPLOY_ONLY"
  for _source in "${_sources[@]}"; do
    case "$_source" in broadway|mcl|emperor|cinemacity|bestar|cgv|chinachem|cineart|goldenscene|lumen|lux|newport|sunbeam) ;;
      *) echo "✖ ONLY 含未知院线：$_source"; exit 1 ;;
    esac
  done
fi

vps() { timeout "${2:-900}" ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS" "$1"; }

# 线上冒烟：只测三个必须 200 的路径。真正的结构验证（死链、版本记录）
# 已在 vps-deploy.sh 里跑过，这里只确认发布后的站点确实可访问。
smoke() {
  echo "▶ 線上冒煙"
  local a b c slug
  a=$(curl -s -o /dev/null -m 25 -w '%{http_code}' "$SITE/")
  b=$(curl -s -o /dev/null -m 25 -w '%{http_code}' "$SITE/showing/")

  # 第三項的 slug **不能寫死**。
  #
  # 原先是硬編碼《奧德賽》的 slug，而該片已下映、頁面不再生成 ——
  # 於是每次部署都會在「奧德賽=404」上失敗，把一次完全正常的發布
  # 報成失敗（2026-09-21 實際踩到）。冒煙測試的目的是驗「站點活著」，
  # 而不是驗「某一部片還在線」，因此改為**從實際產物裡取一個 slug**：
  # 先問伺服器上最新的 movie 目錄名，再請求它。
  #
  # 取不到（例如站點剛建、還沒任何電影）時略過此項，不把未知當失敗。
  slug=$(vps "ls $REMOTE_SITE_DIR/movie 2>/dev/null | head -1" | tr -d '\r')
  if [ -n "$slug" ]; then
    c=$(curl -s -o /dev/null -m 25 -w '%{http_code}' "$SITE/movie/$slug/")
    echo "  首頁=$a  /showing=$b  抽檢電影頁($slug)=$c"
    [ "$a$b$c" = "200200200" ] || { echo "✖ 冒煙未通過，檢查伺服器構建日誌"; exit 1; }
  else
    echo "  首頁=$a  /showing=$b  （產物裡尚無電影頁，跳過抽檢）"
    [ "$ab" = "200200" ] || { echo "✖ 冒煙未通過，檢查伺服器構建日誌"; exit 1; }
  fi
  echo "✅ 已發布"
}

# ---------- 回滚 / 切换版本：不碰本机存档，也不推送 ----------
# 目标 sha 只能由【服务器】的 reflog 决定：本机的 HEAD@{1} 只是我上次 push 前
# 的提交，跟线上实际跑过哪几版无关。
if [ "$MODE" != "deploy" ]; then
  if [ "$MODE" = "rollback" ]; then
    TARGET=$(vps "cd $APP_DIR && git rev-parse --short 'HEAD@{1}' 2>/dev/null || echo")
    [ -n "$TARGET" ] || { echo "✖ 服务器没有上一个存档点（首次部署或 reflog 已清），请用 --to <sha>"; exit 1; }
  else
    TARGET="$TO"
  fi
  CUR=$(vps "cd $APP_DIR && git rev-parse --short HEAD 2>/dev/null || echo none" || true)
  echo "⚠️ 线上当前 ${CUR:-?} → 切到 $TARGET（不存档、不推送本机改动）"
  vps "cat > /tmp/hkmovie-vps-deploy.sh" < deploy/vps-deploy.sh
  vps "sudo -u hkmovie APP_DIR=$APP_DIR bash /tmp/hkmovie-vps-deploy.sh $TARGET"
  smoke
  exit 0
fi

# ---------- 1 本地自检 ----------
# 只挡类型错误和错合并，不在本机跑完整 build：构建环境是服务器（Linux + 2C2G），
# 本机 build 既慢又会覆盖 out/，真正的构建验证在第 4 步。
echo "▶ [1/4] 本地自检"
if [ "${SKIP_CHECK:-0}" = "1" ]; then
  echo "  SKIP_CHECK=1，跳过自检（不推荐）"
else
  # 不用 npx：typescript / tsx 都是 devDependencies，npx 本地找不到时会联网
  # 临时下载 —— 本机就是这么跑通的，所以问题只在服务器才暴露。
  # 发布链路必须离线可重复，缺依赖就直说缺什么。
  [ -x "$TSC" ] || { echo "✖ 缺 $TSC，先跑 npm ci --include=dev"; exit 1; }
  [ -x "$TSX" ] || { echo "✖ 缺 $TSX，先跑 npm ci --include=dev"; exit 1; }
  "$TSC" --noEmit
  "$TSX" probe/check-danger.mts
  node --import tsx --test scripts/test-poster-parsers.mjs
  # MCL 官方详情从数字 ID 抓取；片名不符要拒绝，且分类/片长/简介须进组级资料卡。
  "$TSX" probe/check-mcl-details.mts
  "$TSX" probe/check-group-slug-status.mts
  # 选海报的规则全是取舍，错了不会报错、只会静默换封面（2026-09-21 就踩过），
  # 所以跟错合并一样在发布前钉死。不读 data/、不联网，服务器上也能跑。
  "$TSX" probe/check-poster-pick.mts
  # 卡片背景的主色：错了页面照样 200，只是黑白片被染成紫色 /
  # 亮色海报把次级文字压到 AA 线以下 —— 只有肉眼看详情页才发现。
  "$TSX" probe/check-poster-color.mts
  # 文字对比度令牌：错了页面照样 200，只是灰字在灰底上变难读。
  # 本次就是这类问题（卡片改玻璃后次级文字掉到 2.99:1）拖了很久才被发现。
  "$TSX" probe/check-contrast.mts
  # 类型标签：错了页面照样 200，只是多出「驚悚/驚險(恐怖)片/恐怖片」这种
  # 看着像重复的标签，或半简半繁（豆瓣 enrich 给的是简体）。同样钉死。
  "$TSX" probe/check-genres.mts
  # 场次卡片的「版本·语言」文案：两个正交维度拼出来，边界碎，
  # 写错了只是标签变得莫名其妙（「IMAX·加碼重映·英語」），不报错。
  "$TSX" probe/check-version-text.mts
  # 戲院影廳規格：推断了错了页面照样 200，只是「有 IMAX 的戲院」
  # 静默少几家 / 多几家 —— 用户筛 IMAX 看不到 K11 也只会以为它没有。
  "$TSX" probe/check-cinema-specs.mts
  # 详情页中文标题下的英文副标题：来源（组级而非 primary）与清洗（剥版本/活动/
  # 影展标记）是两个独立失效点，错了页面照样 200 —— 只是整行不见了，
  # 或变成「4DX Avengers: Endgame Encore Infinity Vision」。
  # 用户 2026-09-25 报的就是「整行不见了」那一类。
  "$TSX" probe/check-english-title.mts
  # 卡片链接 → 静态页的覆盖面：movie 页是 dynamicParams=false 的静态导出，
  # 链接 slug 与 generateStaticParams 的 slug 一旦分叉就是线上 404。
  # 这个 bug 本地构建不报错、类型不报错，只在服务器部署后才被死链检查拦下 ——
  # 代价是一整次服务器构建 + 必须回滚才能恢复发布（2026-09-22 实际踩到）。
  "$TSX" probe/check-slug-coverage.mts
fi

# ---------- 2 存档 ----------
echo "▶ [2/4] 存档"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  if [ -z "$MSG" ]; then
    MSG="本机 $(date +%F\ %H:%M) 改动：$(git status --porcelain | sed 's/^...//' | tr '\n' ' ' | cut -c1-60)"
  fi
  git commit -q -m "$MSG"
  echo "  已提交：$MSG"
else
  echo "  工作区干净，复用现有存档"
fi
git log --oneline -1 | sed 's/^/  HEAD /'

# ---------- 3 推送 ----------
echo "▶ [3/4] 推送 origin/$BRANCH"
git push -u origin "$BRANCH"

if [ "$DEPLOY" = "0" ]; then
  echo "✅ 已存档并推送，未上线（--no-deploy）"
  exit 0
fi

# ---------- 4 服务器部署（含构建、死链自检、记录线上版本） ----------
echo "▶ [4/4] 服务器部署"
# 必须先把部署脚本本身送到服务器再执行，而且不能送到 $APP_DIR/deploy/ 里：
# 一是首次收编时服务器上还没有 vps-deploy.sh（它只存在于仓库）；
# 二是脚本执行途中会被 git checkout 换掉内容，在 bash 逐行读取下担心自覆盖。
# 放 /tmp 跑副本，两个问题一起消。
vps "cat > /tmp/hkmovie-vps-deploy.sh" < deploy/vps-deploy.sh
vps "sudo -u hkmovie APP_DIR='$APP_DIR' SCRAPE='$DEPLOY_SCRAPE' ONLY='$DEPLOY_ONLY' bash /tmp/hkmovie-vps-deploy.sh '$BRANCH'"

# 评分数据也要同步更新静态页面；安装独立的每小时定时器，并立即跑首轮刷新。
echo "▶ 安装并立即运行 IMDb / 豆瓣每小时刷新"
vps "sudo APP_DIR='$APP_DIR' SERVICE_USER=hkmovie bash '$APP_DIR/deploy/setup-rating-timer.sh' --run-now" 5400

smoke
