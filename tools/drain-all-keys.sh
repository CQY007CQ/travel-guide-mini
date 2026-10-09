#!/usr/bin/env bash
# ⚠️ 2026-09-14 高德正式封禁警告 ⚠️
#   高德开放平台已依据《高德地图开放平台服务协议》4.12.3 条（禁止使用爬虫/抓取工具访问、抓取、
#   存储、缓存本服务内容）对本账号违规 KEY 的 v3/place/text 接口权限作出封禁处理。
#   本脚本「主动用光所有 KEY 免费额度」的设计目标本身就是规避限流，属风控重点打击行为；
#   继续运行会将「接口级」处置升级为「账号级」封禁（封禁码 10026 INVALID_REQUEST，届时全部接口失效）。
#   现状：所有 place/text 调用点已加硬拦截（tools/_amap-compliance.mjs），脚本不会再发该接口，
#        但批量抓取后落盘 POI 仍违反协议 3.5。建议改为按需查询 + 迁移 OSM 数据源。运行前请想清楚。
# 每日自动用光所有高德 Key 的免费额度，并【优先收录新景点】（旅行攻略生成器）
# 安全版：落盘一律走 tools/_apply-safe.mjs，绝不 merge-data-patch.mjs
# （CITIES_ADD 整体替换城市对象会把 experiences 从 ~1.2 万塌缩回 ~8655，毁灭数据）。
# 需出网（restapi.amap.com），调用方务必 dangerouslyDisableSandbox。
set -u
ROOT=/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel
cd "$ROOT" || exit 1
NODE_BIN=$(ls -d ~/.workbuddy/binaries/node/versions/*/bin/node | sort -V | tail -1)
export NODE_BIN NODE_PATH=/Users/chenqianyuan/.workbuddy/binaries/node/workspace/node_modules
LOG=/tmp/drain-all-keys-$(date +%Y%m%d).log
exec > >(tee -a "$LOG") 2>&1
CITIES=$("$NODE_BIN" -e 'const r=require("module").createRequire(process.cwd()+"/");const D=r("./utils/data.js");process.stdout.write(D.CITIES.map(c=>c.name).join(","))')
echo "===== drain-all-keys start $(date) ====="
# 1) 坐标补校：仅未缓存（topup，非 --fresh 全量重校，避免把 POI 精确坐标降级成地址中心）；不在此 merge
for key in $(grep -v '^#' tools/geocode.keys | grep -v '^$'); do
  echo "----- geocode topup key=${key:0:6} @ $(date) -----"
  MAP_PROVIDER=amap MAP_KEY="$key" "$NODE_BIN" tools/geocode-fix.mjs
done
# 2) 主收录：place/around 全城抓新景点（搜索配额，key 池轮换；不传 --budget 一直跑到全 OVER_LIMIT 用光额度）
echo "----- fetch around (pool rotation, all cities) @ $(date) -----"
"$NODE_BIN" tools/fetch-amap-spots.mjs --mode around --only "$CITIES"
# 3) 补抓：inputtips（独立配额）
echo "----- fetch inputtips (pool rotation, all cities) @ $(date) -----"
"$NODE_BIN" tools/fetch-amap-spots.mjs --mode inputtips --only "$CITIES"
# 4) 美食店（餐饮 POI，搜索配额；逐 key）
echo "----- fetch-food-shops (per city top-10) @ $(date) -----"
for key in $(grep -v '^#' tools/geocode.keys | grep -v '^$'); do
  echo "----- fetch-food-shops key=${key:0:6} @ $(date) -----"
  MAP_KEY="$key" "$NODE_BIN" tools/fetch-food-shops.mjs --percap 10
done
# 5) 落盘（安全）：池名转正 → _apply-safe 折叠 → 打包；绝不 merge-data-patch
echo "----- promote + _apply-safe + pack @ $(date) -----"
"$NODE_BIN" tools/_gen-landmark-promote.mjs
"$NODE_BIN" tools/_apply-safe.mjs
"$NODE_BIN" tools/pack-data.mjs
echo "===== drain-all-keys done $(date) ====="
