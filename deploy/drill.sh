#!/bin/bash
# 在 /tmp 沙箱里完整演练 vps-deploy.sh，绝不碰 /opt/hk-movie 与 /home/web/html。
# 前提：bundle 含 main 分支。本机准备：
#   git bundle create /tmp/hkm.bundle main && scp /tmp/hkm.bundle deploy/drill.sh VPS:/tmp/
#   ssh VPS "bash /tmp/drill.sh"
沙箱内演练，不碰真实 APP_DIR / SITE_DIR；改完部署链路先跑它再上线。
#
# 用例按状态链单向走，全部在 app2（无 .git 的收编目录）上跑，
# 因为那才是真实首次上线的路径；app 只用来提供 archive 源。
set -u
T=/tmp/hk-dt
rm -rf "$T"; mkdir -p "$T/site"
cd "$T" || exit 1

pass=0; fail=0
ck() { # ck <名> <期望 0|nz> <实际>
  if { [ "$2" = "0" ] && [ "$3" = "0" ]; } || { [ "$2" = "nz" ] && [ "$3" != "0" ]; }; then
    echo "  ✅ $1 (exit=$3)"; pass=$((pass+1))
  else
    echo "  ❌ $1 (exit=$3，期望 $2)"; fail=$((fail+1))
  fi
}

echo "### 0 备料：clone 出 app（提供源文件），再造一个无 .git 的 app2"
git clone -q -b main /tmp/hkm.bundle "$T/app" || { echo "FATAL clone 失败"; exit 1; }
HEAD_SHA=$(git -C "$T/app" rev-parse --short main)
OLD_SHA=$(git -C "$T/app" rev-parse --short main~3)
mkdir -p "$T/app2"
git -C "$T/app" archive main | tar -x -C "$T/app2"
[ -d "$T/app2/.git" ] && echo "  ✖ 意外有 .git" || echo "  app2 无 .git，$(find "$T/app2" -type f | wc -l) 个文件"
ln -s /opt/hk-movie/node_modules "$T/app2/node_modules"   # 复用依赖，不真跑 npm ci
md5sum "$T/app2/package-lock.json" | cut -d' ' -f1 > "$T/stamp"
echo "  main=$HEAD_SHA 旧版=$OLD_SHA"

# 假重建：造出"发布后应有的最小站点"，供 verify_site 消费
cat > "$T/rb-good.sh" <<'EOS'
#!/bin/bash
S="$1"; rm -rf "$S"; mkdir -p "$S/movie/real" "$S/cinema" "$S/showing"
echo ok > "$S/index.html"
printf '<a href="/movie/real/">r</a>' > "$S/cinema/index.html"
printf '<a href="/movie/real/">r</a>' > "$S/showing/index.html"
EOS
cat > "$T/rb-bad.sh" <<'EOS'
#!/bin/bash
S="$1"; rm -rf "$S"; mkdir -p "$S/movie/real" "$S/cinema"
echo ok > "$S/index.html"
printf '<a href="/movie/does-not-exist/">x</a>' > "$S/cinema/index.html"
EOS
chmod +x "$T/rb-good.sh" "$T/rb-bad.sh"
cp "$T/rb-good.sh" "$T/rb.sh"

# 固定用一份脚本副本执行：用例 3 回滚后，工作区里的 vps-deploy.sh 会被 checkout
# 换成旧版（旧版不认 REBUILD，会去跑真 rebuild-static.sh 撞锁）。
# 上一轮演练就栽在这：用例 4 拿旧语义跑出 exit 1，"应失败"的断言以错误的理由
# 假绿。真实链路里 sync.sh 送 /tmp 执行正是为了避开这个，照同样方式做。
cp "$T/app2/deploy/vps-deploy.sh" "$T/vd.sh"

# run <ref>：在 app2 里部署。MIN_HTML=1 因假站点只有几页。
run() {
  ( cd "$T/app2" && env APP_DIR="$T/app2" SITE_DIR="$T/site" DEPS_STAMP="$T/stamp" \
      REBUILD="bash $T/rb.sh '$T/site'" REPO_URL=/tmp/hkm.bundle MIN_HTML=1 \
      ${EXTRA_ENV:-} bash "$T/vd.sh" "$1" ) > "$T/last" 2>&1
}
show() { tail -"${2:-5}" "$T/last" | sed "s/^/    | /"; }

echo; echo "### 1 首次收编 + 完整部署（真实上线必经，之前就是这样失败的）"
run main; ec=$?
ck "首次收编应成功" 0 "$ec"; show
[ -f "$T/app2/.deploy-info" ] \
  && echo "    ✅ 记录了线上版本: $(cut -f1 "$T/app2/.deploy-info" | cut -c1-8)" \
  || { echo "    ❌ 缺 .deploy-info"; fail=$((fail+1)); }
echo "    收编后分支: $(git -C "$T/app2" rev-parse --abbrev-ref HEAD)（期望 main）"
echo "    备份 tar: $(ls "$T/app2/.backup"/*.tar 2>/dev/null | wc -l) 个（期望 ≥1，收编前整目录可找回）"
echo "    仓库外文件仍在: server.js=$([ -f "$T/app2/server.js" ] && echo yes)"

echo; echo "### 2 同版本重复部署：应跳过重建，但仍复核站点"
run main; ec=$?
ck "幂等应成功" 0 "$ec"
grep -q "已是目标版本" "$T/last" && echo "    ✅ 跳过重建" || { echo "    ❌ 未跳过"; fail=$((fail+1)); }
grep -q "线上 HTML 页数" "$T/last" && echo "    ✅ 跳过时仍复核站点" || { echo "    ❌ 跳过时没复核"; fail=$((fail+1)); }

echo; echo "### 3 回滚到旧版（detached HEAD）"
run "$OLD_SHA"; ec=$?
ck "回滚应成功" 0 "$ec"; show 3
NOW=$(git -C "$T/app2" rev-parse --short HEAD)
[ "$NOW" = "$OLD_SHA" ] && echo "    ✅ HEAD=$NOW" || echo "    ❌ HEAD=$NOW 期望 $OLD_SHA"

echo; echo "### 4 死链必须判死（从旧版前进到 main，走完整重建）"
cp "$T/rb-bad.sh" "$T/rb.sh"
run main; ec=$?
ck "有死链应失败" nz "$ec"; show 3
grep -q "存在死链" "$T/last" && echo "    ✅ 失败原因准确" || { echo "    ❌ 未报死链"; fail=$((fail+1)); }
cp "$T/rb-good.sh" "$T/rb.sh"

echo; echo "### 5 脏工作区护栏：服务器有仓库外改动时停手且不覆盖"
git -C "$T/app2" checkout -q main
printf '\n// injected-by-drill\n' >> "$T/app2/lib/versions.ts"
run main; ec=$?
ck "脏工作区应停手" nz "$ec"; show 3
grep -q "injected-by-drill" "$T/app2/lib/versions.ts" \
  && echo "    ✅ 未授权不覆盖服务器改动" || { echo "    ❌ 擅自覆盖了"; fail=$((fail+1)); }

echo; echo "### 6 FORCE_TAKEOVER=1：先备份，再以仓库为准"
EXTRA_ENV="FORCE_TAKEOVER=1" run main; ec=$?
ck "强制收编应成功" 0 "$ec"; show 3
grep -q "injected-by-drill" "$T/app2/lib/versions.ts" \
  && { echo "    ❌ 仍以服务器改动为准"; fail=$((fail+1)); } \
  || echo "    ✅ 已改用仓库版本"

echo; echo "### 7 未知 ref：报错是否可行动（应列出可用分支）"
run nope-this-branch; ec=$?
ck "未知 ref 应失败" nz "$ec"; show 2

echo; echo "### 8 真实目录未被触碰（只读核对）"
echo "    /opt/hk-movie/.git : $(ls -d /opt/hk-movie/.git 2>/dev/null || echo '不存在 ✅')"
echo "    /home/web/html 页数: $(find /home/web/html -name '*.html' 2>/dev/null | wc -l)"
curl -s -o /dev/null -m 20 -w '    线上首页 HTTP %{http_code}（应 200）\n' https://hkmovie.yuurei.de/

rm -rf "$T" /tmp/rb-*.sh
echo; echo "══ 通过 $pass / 失败 $fail ══"
[ "$fail" = "0" ]
