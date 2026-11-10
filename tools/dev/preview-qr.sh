#!/bin/bash
# tools/dev/preview-qr.sh —— 一键生成「当前代码」的开发版预览二维码（绕开公众平台取码）
#
# 为什么需要它：
#   体验版二维码的 token 随开发版本变化，每次上传后必须进公众平台
#   「管理 → 版本管理 → 开发版本」重新点蓝色的「体验版」标签取新码。
#   旧码仍指向旧体验版，扫码看到的还是修复前的画面（2026-11-07 实测踩过：
#   行前准备页的门票清单布局已修，但扫 1.19.202 的旧码仍显示逐字竖排）。
#   用内置浏览器截公众平台的弹窗又常因窗口过大报
#   "Browser screenshot exceeds the 10 MiB image limit"，clip/quality 都救不了。
#
#   而开发者工具 CLI 能把「当前本地代码」的预览二维码直接写成 PNG，
#   所见即最新代码，完全不需要网页截图。
#
# 注意：预览码（开发版）有有效期，过期后重新跑一次本脚本即可；
#       正式演示若要长期稳定的入口，仍建议去公众平台取体验版二维码。
#
# 用法：
#   ./tools/dev/preview-qr.sh                       # 默认写到 ../预览二维码-v<版本>.png
#   ./tools/dev/preview-qr.sh /tmp/demo-qr.png      # 指定输出路径

set -euo pipefail
cd "$(dirname "$0")/.."

CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
if [ ! -x "$CLI" ]; then
  echo "❌ 找不到微信开发者工具 CLI：$CLI" >&2
  exit 1
fi

VER=$(node -e 'process.stdout.write(require("./project.config.json").version)')
OUT="${1:-$(cd .. && pwd)/预览二维码-v${VER}.png}"

echo "▶ 生成 v${VER} 预览二维码（当前本地代码）"
"$CLI" preview \
  --project "$(pwd)" \
  --qr-format image \
  --qr-output "$OUT" \
  --qr-size large 2>&1 | tail -8

if [ ! -s "$OUT" ]; then
  echo "❌ 二维码未生成：$OUT" >&2
  exit 1
fi
SZ=$(wc -c < "$OUT" | tr -d ' ')
if [ "$SZ" -lt 1024 ]; then
  echo "❌ 二维码文件异常（仅 ${SZ} 字节）：$OUT" >&2
  exit 1
fi

echo "✅ 预览二维码已生成（${SZ} 字节）：$OUT"
echo "   扫码前请确认微信开发者工具已登录本项目 AppID；码过期后重跑本脚本。"
