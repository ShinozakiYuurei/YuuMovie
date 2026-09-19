#!/usr/bin/env bash
# 部署前自检：确认这台 VPS 是否适合运行本项目
#
# 用法（上传到 VPS 后）：
#   bash preflight.sh
#
# 检查项：
#   1. 系统配置（CPU/内存/磁盘/OS）
#   2. 网络可达性（百老汇 / MCL / 海报 CDN）
#   3. 给出部署建议

set -u

OK="\033[32m✅\033[0m"
NG="\033[31m✖\033[0m"
WA="\033[33m⚠️\033[0m"
BOLD="\033[1m"
RST="\033[0m"

line() { printf '─%.0s' $(seq 1 62); echo; }
hdr()  { echo; echo -e "${BOLD}$1${RST}"; line; }

hdr "1. 系统配置"

# --- CPU ---
if command -v nproc >/dev/null 2>&1; then
  CPUS=$(nproc)
else
  CPUS=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 0)
fi
echo "  CPU 核心: ${CPUS}"

# --- 内存 ---
if [ -r /proc/meminfo ]; then
  MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
  # MemAvailable 在旧内核/部分环境可能缺失，降级到 MemFree
  MEM_AVAIL_KB=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  [ -z "${MEM_AVAIL_KB:-}" ] && MEM_AVAIL_KB=$(awk '/MemFree/{print $2}' /proc/meminfo)
  MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
  MEM_AVAIL_MB=$((MEM_AVAIL_KB / 1024))
  echo "  内存总量: ${MEM_TOTAL_MB} MB"
  echo "  可用内存: ${MEM_AVAIL_MB} MB"
else
  MEM_TOTAL_MB=0
  echo "  内存: 无法读取"
fi

# --- Swap ---
SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
echo "  Swap:     ${SWAP_MB} MB"

# --- 磁盘 ---
DISK_FREE_MB=$(df -Pm / 2>/dev/null | awk 'NR==2{print $4}')
echo "  根分区可用: ${DISK_FREE_MB} MB"

# --- OS ---
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "  系统: ${PRETTY_NAME:-$ID}"
fi
echo "  架构: $(uname -m)"

# --- Node ---
if command -v node >/dev/null 2>&1; then
  echo "  Node: $(node -v)"
else
  echo "  Node: 未安装（部署脚本会自动安装）"
fi

# --- 出口 IP ---
echo
echo -n "  出口 IP: "
IP=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null || \
     curl -s --max-time 10 https://ifconfig.me 2>/dev/null || echo "获取失败")
echo "$IP"

if [ "$IP" != "获取失败" ]; then
  INFO=$(curl -s --max-time 12 "https://ipinfo.io/${IP}/json" 2>/dev/null)
  if [ -n "$INFO" ]; then
    echo "$INFO" | tr -d ' \n' | grep -oE '"(country|city|org)":"[^"]*"' | sed 's/"//g; s/:/: /' | sed 's/^/    /'
  fi
fi

hdr "2. 网络可达性（关键）"

test_url() {
  local name="$1" url="$2" expect="${3:-200}"
  local out code time
  out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 \
        -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' \
        "$url" 2>/dev/null)
  code=$(echo "$out" | awk '{print $1}')
  time=$(echo "$out" | awk '{print $2}')

  if [ "$code" = "$expect" ]; then
    printf "  ${OK} %-22s HTTP %s  (%ss)\n" "$name" "$code" "$time"
    return 0
  elif [ "$code" = "000" ] || [ -z "$code" ]; then
    printf "  ${NG} %-22s 连接失败/超时\n" "$name"
    return 2
  else
    printf "  ${WA} %-22s HTTP %s  (预期 %s)\n" "$name" "$code" "$expect"
    return 1
  fi
}

BW_OK=1; MCL_OK=1; CDN_OK=1

test_url "百老匯 cinema.com.hk" \
  "https://www.cinema.com.hk/hk/movie/ticketing" 200 || BW_OK=0

test_url "MCL mclcinema.com" \
  "https://www.mclcinema.com/MCLWebAPI2/GetNowShowingGrid.aspx?l=zh-TW" 200 || MCL_OK=0

test_url "海報 CDN grabticks" \
  "https://media.grabticks.com/programju_8cbe9730-63a8-4ef1-8451-98ae75b25c97__.jpg" 200 || CDN_OK=0

# MCL 若失败，进一步诊断：是 TCP 不通还是 HTTP 被拒
if [ "$MCL_OK" -eq 0 ]; then
  echo
  echo "  MCL 诊断："
  MCL_IP=$(getent hosts www.mclcinema.com 2>/dev/null | awk '{print $1; exit}')
  [ -z "$MCL_IP" ] && MCL_IP=$(nslookup www.mclcinema.com 2>/dev/null | awk '/^Address: /{print $2; exit}')
  echo "    DNS 解析: ${MCL_IP:-失败}"

  if command -v timeout >/dev/null 2>&1; then
    if timeout 8 bash -c "cat < /dev/null > /dev/tcp/www.mclcinema.com/443" 2>/dev/null; then
      echo "    TCP 443:   可连接（问题在 HTTP 层）"
    else
      printf '    TCP 443:   %b 不可连接（被防火墙/路由丢弃）\n' "${NG}"
    fi
  fi
fi

hdr "3. 结论与建议"

echo
if [ "$BW_OK" -eq 1 ] && [ "$MCL_OK" -eq 1 ]; then
  echo -e "  ${OK} ${BOLD}这台机器完全适合部署${RST}"
  echo "     百老匯 + MCL 均可直连，无需代理。"
  echo
  echo "  下一步："
  echo "     bash deploy/setup-vps.sh"
elif [ "$BW_OK" -eq 1 ]; then
  echo -e "  ${WA} ${BOLD}可部署，但 MCL 不可达${RST}"
  echo "     百老匯正常（13 家戲院 / 約 1,274 場次 / 181 部影片）"
  echo "     MCL 抓取會失敗，但不影響整體 —— 腳本會自動跳過並告警。"
  echo
  echo "  若必須要 MCL，可考慮："
  echo "     1. 用 MCL_PROXY 指定一個可達 MCL 的代理"
  echo "     2. 換一個 IP（部分 VPS 商支持）"
  echo "     3. 找香港住宅代理服務"
  echo
  echo "  以「僅百老匯」部署："
  echo "     bash deploy/setup-vps.sh"
else
  echo -e "  ${NG} ${BOLD}網絡異常，暫不建議部署${RST}"
  echo "     連百老匯都不可達，請檢查網路或防火牆設定。"
fi

# --- 部署模式建议 ---
echo
line
if [ "${MEM_TOTAL_MB:-0}" -ge 1500 ]; then
  echo -e "  ${OK} 内存 ${MEM_TOTAL_MB}MB ≥ 1500MB → 可在 VPS 上直接構建（全自動）"
  echo "     用源碼包：bash deploy/package.sh（本地）→ 上傳 → setup-vps.sh"
elif [ "${MEM_TOTAL_MB:-0}" -ge 900 ]; then
  echo -e "  ${WA} 内存 ${MEM_TOTAL_MB}MB → 構建偏緊（峰值約 1.3GB）"
  echo "     建議加 swap 或改用「本地構建 + 上傳產物」模式："
  echo "       bash deploy/package-standalone.sh  （本地）"
  echo "       setup-vps.sh --skip-build          （VPS）"
else
  echo -e "  ${NG} 内存 ${MEM_TOTAL_MB}MB → 不足以在 VPS 上構建"
  echo "     必須用「本地構建 + 上傳產物」模式："
  echo "       bash deploy/package-standalone.sh  （本地）"
  echo "       setup-vps.sh --skip-build          （VPS）"
fi

if [ "${DISK_FREE_MB:-0}" -lt 2048 ]; then
  echo
  echo -e "  ${WA} 磁盤可用 ${DISK_FREE_MB}MB < 2GB，建議清理或擴容"
  echo "     （源碼構建約需 600MB，產物模式約需 200MB）"
fi

echo
line
echo "  自檢完成 $(date -Iseconds)"
