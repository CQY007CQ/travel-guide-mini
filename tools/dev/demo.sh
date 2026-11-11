#!/bin/bash
# ============================================================
# demo.sh —— 一键演示（验收 / 路演现场用）
#
# 用途：30 秒内把项目的「智能能力 + 质量保障」跑给人看，全程离线、不依赖 IDE、不联网。
# 用法：./tools/dev/demo.sh            自检 + 四组推荐示例
#       ./tools/dev/demo.sh 古镇 三天    自定义一句需求
# ============================================================
set -u
PROJ="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJ" || exit 1

# node 解析：环境变量 > PATH > 托管运行时最新版（禁止写死版本号目录）
if [ -n "${NODE_BIN:-}" ]; then NODE="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then NODE="$(command -v node)"
else NODE="$(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | sort -V | tail -1)"; fi
if [ -z "${NODE:-}" ] || [ ! -x "$NODE" ]; then echo "找不到 node，请设置 NODE_BIN=..." >&2; exit 1; fi

echo ""
echo "══════════════════════════════════════════════"
echo " 晨的旅行助手 · 现场演示"
echo "══════════════════════════════════════════════"

if [ "$#" -gt 0 ]; then
  # 自定义需求
  TEXT="$*"
  echo ""
  echo "▶ 需求：$TEXT"
  TEXT="$TEXT" "$NODE" -e '
    const R = require("./utils/recommend.js");
    const t = process.env.TEXT;
    const r = R.recommend(t, { topN: 5 });
    if (r.pending) { console.log("  数据尚未加载完成"); process.exit(0); }
    console.log("  识别：标签=" + JSON.stringify(r.prefs.tags) + " 天数=" + (r.prefs.days || "-") + " 预算=" + (r.prefs.budget || "-"));
    r.list.forEach(function (x, i) {
      console.log("  " + (i + 1) + ". " + x.name + "（" + x.province + "） " + x.score + " 分   " + x.summary);
      x.reasons.slice(0, 3).forEach(function (z) {
        console.log("       · " + z.label + (z.delta > 0 ? " +" : " ") + z.delta + "  " + z.note);
      });
    });
  '
  exit 0
fi

echo ""
echo "▶ 1/3 推荐引擎：四组真实需求的前五名"
"$NODE" -e '
  const R = require("./utils/recommend.js");
  const cases = ["古镇 人少 三天", "海边亲子游 五天 舒适", "沙漠戈壁 摄影 四天", "温泉放松 周末 两天"];
  cases.forEach(function (q) {
    const r = R.recommend(q, { topN: 5 });
    const names = r.list.map(function (x) { return x.name + "(" + x.score + ")"; }).join("  ");
    console.log("  " + q.padEnd(22) + " → " + names);
  });
'

echo ""
echo "▶ 2/3 推荐引擎回归"
"$NODE" tools/test/_test-recommend.mjs | tail -2

echo ""
echo "▶ 3/3 全量回归（含数据分包发布门禁）"
./allcheck.sh | tail -8

echo ""
echo "演示完毕。全程离线，未发起任何网络请求。"
echo ""
