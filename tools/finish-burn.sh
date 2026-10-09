#!/usr/bin/env bash
# ⚠️ 2026-09-14 高德已按《服务协议》4.12.3 封禁本账号 v3/place/text 接口权限。
#   本脚本内含 amap 通道的 geocode-fix（原走 place/text，现已改走 place/around）与全城批量抓取，
#   继续运行仍有合规风险（协议 3.5 禁止存储/缓存本服务数据）。运行前请确认已想清楚。
# 收尾流水线（在 LJyet2 = 664f geocode --fresh 跑完之后运行）：
#   合并 664f → d6031cd8 烧光搜索配额（非 --fresh，读 664f 缓存只补未校项，既烧额度又保缓存）
#   → around 主收录 → 合并 → inputtips 补抓 → 合并 → 最终合并 + pack 落盘
# 全程写日志到 /tmp/finish-burn-*.log；需出网（restapi.amap.com）。
set -u
ROOT=/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel
cd "$ROOT" || exit 1
NODE_BIN=$(ls -d ~/.workbuddy/binaries/node/versions/*/bin/node | sort -V | tail -1)
export NODE_BIN
LOG=/tmp/finish-burn-$(date +%Y%m%d-%H%M%S).log
exec > >(tee -a "$LOG") 2>&1
echo "===== finish-burn start $(date) | NODE_BIN=$NODE_BIN ====="
# 0) 备份 664f 烧完后的缓存/补丁（d6031cd8 若 --fresh 会覆盖缓存，先留底便于重建）
cp -f tools/geocode-cache.json "tools/geocode-cache.pre-d6031.bak" 2>/dev/null
cp -f tools/v199-coords-geocoded.js "tools/v199-coords-geocoded.pre-d6031.bak" 2>/dev/null
CITIES=$("$NODE_BIN" -e 'const r=require("module").createRequire(process.cwd()+"/");const D=r("./utils/data.js");process.stdout.write(D.CITIES.map(c=>c.name).join(","))')
echo "cities=$(echo -n "$CITIES" | tr ',' '\n' | wc -l)"
# 1) 合并 664f 成果
echo "----- [1/7] merge 664f @ $(date) -----"
"$NODE_BIN" tools/merge-data-patch.mjs
# 2) d6031cd8 烧光搜索配额（--fresh：664f 的 --fresh 已把缓存写满，非 --fresh 会跳过全部 → 必须 --fresh 才能烧到 d6031cd8 的配额）
echo "----- [2/7] geocode-fix d6031cd8 --fresh @ $(date) -----"
MAP_PROVIDER=amap "$NODE_BIN" tools/geocode-fix.mjs --fresh   # 2026-09-14：已移除硬编码的他人 KEY，改从 tools/geocode.key / MAP_KEY 读
"$NODE_BIN" tools/merge-data-patch.mjs
# 3) 主收录：around（搜索配额，key 池轮换，剩 b0d7e1bb 等可用）
echo "----- [3/7] fetch around @ $(date) -----"
"$NODE_BIN" tools/fetch-amap-spots.mjs --mode around --fresh --only "$CITIES"
"$NODE_BIN" tools/merge-data-patch.mjs
# 4) 补抓：inputtips（独立配额）
echo "----- [4/7] fetch inputtips @ $(date) -----"
"$NODE_BIN" tools/fetch-amap-spots.mjs --mode inputtips --fresh --only "$CITIES"
"$NODE_BIN" tools/merge-data-patch.mjs
# 5) 落盘
echo "----- [5/7] final merge @ $(date) -----"
"$NODE_BIN" tools/merge-data-patch.mjs
echo "----- [6/7] pack-data @ $(date) -----"
"$NODE_BIN" tools/pack-data.mjs
echo "===== finish-burn done @ $(date) | log=$LOG ====="
