#!/bin/bash
# ============================================================
# demo-serve.sh —— 一行启动「网页版」现场演示（构建 + 本地服务 + 打印地址）
#
# 用法： bash tools/demo-serve.sh [端口，默认 8899]
# 停止： Ctrl+C
# 说明： 网页版是同一份小程序源码编译到浏览器，离线可用（不依赖外网）；
#        唯一例外是「地图底图」——浏览器无原生 map 组件，网页版刻意降级为
#        「占位说明 + 高德跳转」，需要展示真实地图请用微信开发者工具。
# ============================================================
set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8899}"
cd "$PROJ" || exit 1

# node 三级解析（与 allcheck.sh 一致，禁止写死托管运行时版本路径）
if [ -n "${NODE_BIN:-}" ]; then
  NODE="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  NODE="$(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "${NODE:-}" ] || [ ! -x "$NODE" ]; then
  echo "❌ 找不到可用的 node，请设置 NODE_BIN=/path/to/node 后重跑" >&2
  exit 1
fi

echo "▶ 构建网页版（小程序源码 → 浏览器，同源编译）…"
"$NODE" tools/web/build.mjs >/dev/null 2>&1 || { echo "❌ 网页版构建失败" >&2; exit 1; }

echo ""
echo "══════════════════════════════════════════════════"
echo " 网页版演示地址： http://127.0.0.1:${PORT}/index.html"
echo " ────────────────────────────────────────────────"
echo " · 若页面空白：浏览器按 Cmd+Shift+R 强制刷新（绕过 PWA 缓存）"
echo " · 停止服务：Ctrl+C"
echo " · 真实地图底图：请用微信开发者工具（网页版刻意不画底图）"
echo "══════════════════════════════════════════════════"
echo ""

exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$PROJ/web"
