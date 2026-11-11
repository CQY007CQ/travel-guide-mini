#!/bin/bash
# tools/dev/release-and-qr.sh —— 一键：上传体验版 + 生成当前代码预览二维码
#
# 用法：
#   ./tools/dev/release-and-qr.sh                       # 默认版本取 project.config.json
#   ./tools/dev/release-and-qr.sh 1.20.7 "本次说明"
#
# 前置：微信开发者工具已打开且**已用微信扫码登录**（islogin=true）。
#   未登录时脚本会立即退出并给出指引，不会 pkill IDE、不会白等端口。
#
# 产物区别（别混用）：
#   · 预览二维码 = 开发者工具 CLI 对「当前本地代码」生成的开发版码，有有效期，
#     所见即最新代码，适合马上扫码自测。
#   · 体验版二维码 = 微信公众平台「管理 → 版本管理 → 开发版本 → 体验版」取，
#     token 随开发版本变化，每次上传后必须重新取，旧码会指向旧版本。
#
# 本脚本不生成公众平台体验版码（需账号身份 + 网页操作），只打印取码路径。

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -n "${NODE_BIN:-}" ]; then :
elif command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"
else NODE_BIN="$(ls -d ~/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
VER="${1:-$("$NODE_BIN" -e 'process.stdout.write(require("./project.config.json").version)')}"
DESC="${2:-最新开发版}"
OUT="${3:-$(pwd)/预览二维码-latest.png}"

echo "════════ 发布 v${VER} ════════"
# 可选全量门禁：FULL_CHECK=1 时先跑 allcheck（默认只由 upload.sh 做 verify-release 发布门禁）
if [ "${FULL_CHECK:-0}" = "1" ]; then
  echo "⓪ 全量回归"
  (cd "$(pwd)" && bash allcheck.sh > /tmp/release-allcheck.log 2>&1) || {
    echo "❌ allcheck 未通过，终止上传。日志：/tmp/release-allcheck.log" >&2
    tail -6 /tmp/release-allcheck.log >&2
    exit 1
  }
  echo "  全绿"
fi
echo "① 上传体验版"
bash tools/dev/upload.sh "$VER" "$DESC"

echo "② 生成当前代码预览二维码"
bash tools/dev/preview-qr.sh "$OUT"

# ③ 落发版记录（便于追溯「哪个 commit / 什么时候 / 用的什么说明」）
COMMIT="$(/Library/Developer/CommandLineTools/usr/bin/git -C "$(pwd)" rev-parse --short HEAD 2>/dev/null || echo unknown)"
STATE="$(pwd)/tools/dev/release-state.json"
cat > "$STATE" <<EOF
{
  "version": "${VER}",
  "desc": "${DESC}",
  "time": "$(date '+%Y-%m-%d %H:%M:%S')",
  "commit": "${COMMIT}",
  "previewQr": "${OUT}"
}
EOF

echo ""
echo "════════ 完成 ════════"
echo "预览二维码（当前最新代码，有效期有限）：$OUT"
echo ""
echo "体验版二维码（长期稳定）请到微信公众平台重新取："
echo "  管理 → 版本管理 → 开发版本 → 找到 v${VER} → 点蓝色「体验版」标签 → 下载二维码"
echo "  ⚠ 上次体验版码会指向旧版本，上传后必须重新取。"
echo ""
echo "云函数（若首次部署 / 有改动）另需在开发者工具里对 tools/cloud/ 下 5 个函数"
echo "  右键「上传并部署：云端安装依赖」，并配好 llmProxy 环境变量。"
