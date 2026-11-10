#!/bin/bash
# tools/dev/upload.sh —— 一键上传（自动清 IDE 缓存 + 自动核对是否残包）
#
# 为什么需要这个脚本（三个都真实踩过）：
#   1. IDE 缓存旧编译结果时，上传会「✔ upload 成功」但数据块被剥掉 →
#      subdata 从 1.7MB 变成 10KB，用户打开发现没数据，编译还不报错。
#      → 必须先 pkill 让 cli 冷启重编译；每次都人工记得是不现实的。
#   2. pkill 后 IDE 冷启要 60–120s，cli 自己的等待经常超时（报 wait IDE port timeout），
#      得手动等端口就绪再重传。
#   3. 「上传后人工看尺寸表」是唯一防线，但人会忘、会懒。
#      → 这里把尺寸表解析成硬性断言：subdata < 1MB 直接判失败。
#
# 用法：
#   ./tools/dev/upload.sh 1.19.117 "本次改动说明"
#   ./tools/dev/upload.sh --parse /tmp/upload.log     # 只校验一份已有日志（不联网）

set -uo pipefail

CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
PORT=54871
MIN_SUBDATA_KB=1000          # 正常约 1.7MB；低于 1MB 视为残包

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }

# ── 尺寸表校验 ──
parse_sizes() {
  local log="$1"
  local subdata_line subdata2_line
  subdata_line=$(grep -E "\/subdata\/" "$log" | head -1)
  subdata2_line=$(grep -E "\/subdata2\/" "$log" | head -1)

  if [ -z "$subdata_line" ]; then
    red "✗ 日志里找不到 /subdata/ 尺寸行，无法判定（可能上传未完成）"
    return 1
  fi

  # 提取数值与单位：形如 '1.7 MB' / '10.0 KB'
  local val unit kb
  val=$(echo "$subdata_line" | grep -oE "[0-9]+(\.[0-9]+)? (MB|KB|B)" | head -1 | awk '{print $1}')
  unit=$(echo "$subdata_line" | grep -oE "[0-9]+(\.[0-9]+)? (MB|KB|B)" | head -1 | awk '{print $2}')

  if [ -z "${val:-}" ]; then
    red "✗ 无法解析 subdata 尺寸：$subdata_line"
    return 1
  fi
  # 统一折算成整数 KB：MB→×1024、KB→取整、B→/1024
  # （初版这里直接把 "10.0" 赋给 kb，整数比较会报 integer expression expected 并静默放行 → 残包被误判为正常）
  kb=$(awk -v v="$val" -v u="$unit" 'BEGIN{
    if (u=="MB") printf "%d", v*1024;
    else if (u=="KB") printf "%d", v;
    else printf "%d", v/1024;
  }')

  echo "  /subdata/  ≈ ${kb}KB （阈值 ${MIN_SUBDATA_KB}KB）"
  [ -n "$subdata2_line" ] && echo "  /subdata2/ =$(echo "$subdata2_line" | grep -oE "[0-9.]+ (MB|KB)" | head -1)"

  if [ "$kb" -lt "$MIN_SUBDATA_KB" ]; then
    red "✗ 残包！数据块被剥离（subdata 只有 ${kb}KB）。这个包发出去用户会看到空数据。"
    red "  处理：确认 node tools/build/verify-release.mjs 通过 → 重新 pkill IDE → 再传一次。"
    return 1
  fi
  green "✓ 数据块体积正常（${kb}KB），不是残包"
  return 0
}

# ── 只解析模式 ──
if [ "${1:-}" = "--parse" ]; then
  parse_sizes "${2:?需要日志路径}"
  exit $?
fi

VERSION="${1:?用法: ./tools/dev/upload.sh <版本号> <说明>}"
DESC="${2:-手动上传}"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/tmp/upload-$(date +%H%M%S).log"

echo "▶ 登录态前置检查"
# 2026-11-10：未登录时 cli upload 必报 code 10「需要重新登录」。旧流程会先 pkill IDE、
# 再等端口最多 180s，直到最后一步才失败 —— 白等且把用户正在用的工具关掉。
# 这里提前探测，未登录立即返回并给出可照做的指引（--parse 离线模式不受影响）。
if [ ! -x "$CLI" ]; then
  red "✗ 找不到微信开发者工具 CLI：$CLI"
  exit 1
fi
LOGIN_JSON="$("$CLI" islogin 2>/dev/null | grep -o '{\"login\":[a-z]*}' | head -1)"
if [ "$LOGIN_JSON" != '{"login":true}' ]; then
  red "✗ 微信开发者工具未登录（islogin 返回 ${LOGIN_JSON:-无输出}），上传必然失败 code 10"
  echo  "   处理：打开微信开发者工具 → 用微信扫码登录 → 再重跑本脚本。"
  echo  "   离线校验日志请用：./tools/dev/upload.sh --parse /tmp/upload-*.log"
  exit 1
fi
green "  已登录"

echo "▶ 发布前门禁"
node "$PROJ/tools/build/verify-release.mjs" || { red "✗ 发布门禁未通过，终止"; exit 1; }

echo "▶ 清理 IDE（避免缓存旧编译结果导致残包）"
pkill -9 -f wechatwebdevtools 2>/dev/null
sleep 4

echo "▶ 启动 IDE 并等待端口（最多 180s）"
"$CLI" open --project "$PROJ" >/dev/null 2>&1 &
for i in $(seq 1 36); do
  if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    green "  端口就绪（${i}0s 内）"
    break
  fi
  sleep 5
done
if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  red "✗ 端口 $PORT 始终未就绪，IDE 可能没起来，请手动打开开发者工具后重跑"
  exit 1
fi

echo "▶ 上传 v$VERSION"
"$CLI" upload --project "$PROJ" --port "$PORT" --version "$VERSION" --desc "$DESC" 2>&1 | tee "$LOG" | tail -14

echo "▶ 核对尺寸表（残包检测）"
parse_sizes "$LOG" || exit 1

echo ""
green "✅ 上传完成且体积校验通过：v$VERSION"
echo "   日志：$LOG"
