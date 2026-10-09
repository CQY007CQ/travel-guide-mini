#!/bin/bash
# ============================================================
# allcheck.sh —— 小程序一键全量回归（headless，无需 IDE / 网络）
# 串起：JS 语法 → JSON 合法性 → 数据健康 → 单测链 → WXML → 事件配对
# 用法: ./allcheck.sh            # 全量
#       ./allcheck.sh <过滤器>   # 只跑名字含过滤词的步骤（如 ./allcheck.sh data）
# 退出码: 0 全绿 / 1 有失败
# ============================================================
set -u
PROJ="$(cd "$(dirname "$0")" && pwd)"
# node 可执行文件自动解析（此前写死了托管运行时的具体版本号，版本一升级整条回归链就会全挂）：
# 优先级：环境变量 NODE_BIN > PATH 中的 node > 托管运行时目录下版本号最大的那个
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
FILTER="${1:-}"
cd "$PROJ" || exit 1

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
FAILED=0
declare -a LINES

step() { # step <名称> <命令...>
  local name="$1"; shift
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then return; fi
  echo ""
  echo "──────────────────────────────────────────────"
  echo "▶ $name"
  echo "──────────────────────────────────────────────"
  local out; out=$("$@" 2>&1); local rc=$?
  if [ $rc -eq 0 ]; then
    LINES+=("${GRN}✓${RST} $name")
    echo "${out}"
  else
    FAILED=1
    LINES+=("${RED}✗${RST} $name")
    echo "${out}"
  fi
}

step "JS 语法检查" bash -c '
  err=0
  while IFS= read -r f; do
    if ! '"$NODE"' --check "$f" 2>/dev/null; then echo "语法错误: $f"; err=1; fi
  done < <(find app.js utils pages -name "*.js" -o -name "*.mjs" | sort)
  for f in tools/*.mjs tools/*.js; do
    if ! '"$NODE"' --check "$f" 2>/dev/null; then echo "语法错误: $f"; err=1; fi
  done
  [ $err -eq 0 ] && echo "全部 JS 语法通过"
  exit $err
'

step "JSON 合法性" bash -c '
  err=0
  for f in app.json project.config.json sitemap.json pages/*/*.json; do
    '"$NODE"' -e "JSON.parse(require(\"fs\").readFileSync(\"$f\",\"utf8\"))" 2>/dev/null || { echo "JSON 错误: $f"; err=1; }
  done
  [ $err -eq 0 ] && echo "全部 JSON 合法"
  exit $err
'

step "数据健康 (372 城/坐标/泛词)" bash -c '
  '"$NODE"' -e "
    const T = require(\"./utils/travel.js\");
    const D = T.D;
    const assert = (n,c)=>console.log((c?\"  ✓ \":\"  ✗ FAIL: \")+n)||(c?0:process.exitCode=1);
    assert(\"CITIES 232 城\", D.CITIES.length >= 232);
    const exp = D.CITIES.reduce((s,c)=>s+(c.experiences?c.experiences.length:0),0);
    assert(\"experiences ≥1300 条\", exp >= 1300);
    const ks = Object.keys(D.SPOT_COORDS||{}); let n=0;
    ks.forEach(k=>n+=D.SPOT_COORDS[k].length);
    assert(\"SPOT_COORDS ≥1915 (258 城)\", n >= 1915 && ks.length >= 250);
    assert(\"GENERIC_SPOT_WORDS ≥30\", (D.GENERIC_SPOT_WORDS||[]).length >= 30);
    // v1.11 护栏：每城必须有市中心锚点 + 省归属（缺一会让地图/省内游拿不到兜底坐标）
    const noCC = D.CITIES.filter(c=>!D.CITY_COORDS[c.name]).map(c=>c.name);
    assert(\"每城都有 CITY_COORDS\", noCC.length===0, noCC.join(\",\")||\"\");
    const noCP = D.CITIES.filter(c=>!D.CITY2PROV[c.name]).map(c=>c.name);
    assert(\"每城都有 CITY2PROV\", noCP.length===0, noCP.join(\",\")||\"\");
    const noSC = D.CITIES.filter(c=>!c.limited && !D.SPOT_COORDS[c.name]).map(c=>c.name);
    assert(\"每城都有 SPOT_COORDS 条目\", noSC.length===0, noSC.join(\",\")||\"\");
    let bad=0;
    Object.keys(D.SPOT_COORDS).forEach(c=>(D.SPOT_COORDS[c]||[]).forEach(s=>{
      // 三沙（西沙群岛）属南海合法纬度；大陆/海南/台湾仍按 17°N 下界守卫
      if(typeof s[1]!==\"number\"||typeof s[2]!==\"number\"||s[1]>54||s[2]>136||
        (c!==\"三沙\"&&(s[1]<17||s[2]<73))||
        (c===\"三沙\"&&(s[1]<15||s[1]>18||s[2]<110||s[2]>114))) bad++;
    }));
    assert(\"坐标值全部在国境内\", bad===0, \"越界 \"+bad+\" 条\");
  "
  exit $?
'

# 【v1.11 护栏】utils 里同名 function 会让后者静默覆盖前者（曾把既有 tripCountdown /
# cityCompareLines 覆盖掉，导致旧功能悄悄变样）。这里强制零重名。
step "重名定义检查 (防静默覆盖)" bash -c '
  '"$NODE"' -e "
    const fs = require(\"fs\");
    let bad = 0;
    for (const f of [\"utils/travel.js\", \"utils/planner.js\", \"utils/store.js\", \"app.js\"]) {
      const src = fs.readFileSync(f, \"utf8\");
      const cnt = {};
      for (const m of src.matchAll(/^function\s+([A-Za-z_\$][\w\$]*)\s*\(/gm)) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
      for (const n in cnt) if (cnt[n] > 1) { console.log(\"  ✗ FAIL: \" + f + \" 重名 function \" + n + \"() ×\" + cnt[n]); bad++; }
      const c2 = {};
      for (const m of src.matchAll(/^const\s+([A-Z_][A-Z0-9_]*)\s*=/gm)) c2[m[1]] = (c2[m[1]] || 0) + 1;
      for (const n in c2) if (c2[n] > 1) { console.log(\"  ✗ FAIL: \" + f + \" 重名常量 \" + n + \" ×\" + c2[n]); bad++; }
    }
    if (!bad) console.log(\"  无重名 function / 常量\");
    process.exit(bad ? 1 : 0);
  "
  exit $?
'

step "单测 selfcheck" "$NODE" tools/selfcheck.mjs
step "单测 check-new (v1.3+ 新 API)" "$NODE" tools/check-new.mjs
step "单测 check-more (v1.10 扩容+36 新函数)" "$NODE" tools/check-more.mjs
step "单测 check-v111 (20 新功能+数据护栏)" "$NODE" tools/check-v111.mjs
step "单测 check-v112 (100 城扩容+100 新功能)" "$NODE" tools/check-v112.mjs
step "单测 check-boundary (跨年/同名)" "$NODE" tools/check-boundary.mjs
step "文案质量 泛化/雷同扫描 (v1.15)" "$NODE" tools/scan-generic.mjs
step "行政区覆盖审计 (v1.15)" bash -c '
  out=$('"$NODE"' tools/cities-census.mjs 2>&1)
  rc=$?
  echo "$out" | head -5
  # 主缺口必须为 0（缺失城市会导致全省游/生成链缺数据）
  if echo "$out" | grep -q "缺失: 无"; then
    echo "  ✓ 行政区覆盖 0 缺失"
  else
    echo "  ✗ 存在未收录行政区"; rc=1
  fi
  exit $rc
'
step "全省生成回归 (v1.15)" bash -c '
  out=$('"$NODE"' -e "
    const T = require(\"./utils/travel.js\");
    const D = T.D;
    const provs = Object.keys(D.PROVINCE_CITIES || {});
    let ok = 0, fail = 0;
    provs.forEach(p => { [3,5,7].forEach(days => { [\"speed\",\"balance\",\"leisure\"].forEach(st => {
      try { const plan = T.buildProvPlan({ province:p, days, depart:\"2026-10-01\", budget:\"mid\", pace:st, travelMode:\"car\" }); if (plan && plan.length) ok++; else fail++; }
      catch(e){ fail++; console.log(\"ERR\", p, days, st, e.message); }
    }); }); });
    console.log(\"全省生成 OK:\", ok, \"/ FAIL:\", fail);
    process.exit(fail ? 1 : 0);
  " 2>&1)
  rc=$?
  echo "$out" | tail -2
  exit $rc
'
step "高强度压测 (v1.17.5)" "$NODE" tools/stress-test.mjs
step "WXML 结构校验" "$NODE" tools/check-wxml.mjs
step "页面结构 + 事件配对" "$NODE" tools/check-handlers.mjs

step "主包体积预警 (P2-8)" bash -c '
  out=$('"$NODE"' -e "
    const fs=require(\"fs\"),path=require(\"path\"),zlib=require(\"zlib\");
    const EXC=new Set([\"tools\",\"shots\",\".qr\",\"outputs\",\"node_modules\",\".git\",\".workbuddy\"]);
    const acc={raw:0,gzip:0};
    (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name===\".\"||e.name===\"..\")continue;if(EXC.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else{try{const b=fs.statSync(p).size;acc.raw+=b;acc.gzip+=zlib.gzipSync(fs.readFileSync(p)).length;}catch(_){}}}})(process.cwd());
    const rawKB=Math.round(acc.raw/1024),gzipKB=Math.round(acc.gzip/1024);
    console.log(\"  raw KB:\",rawKB,\"| gzip KB:\",gzipKB);
    // 微信 2MB 上限按【压缩后体积】计（官方：开发者工具显示未压缩，平台实际上传检测压缩后大小）。
    // raw 仅作黄色预警参考（开发者工具面板会显示 raw，偏大属正常），不以 raw 判失败。
    if(rawKB>1850)console.log(\"  [warn] raw 进入黄色区(>1850KB)，开发者工具将显示偏大，上传按压缩后计，正常\");
    if(gzipKB>1850)console.log(\"  [warn] 压缩后体积进入黄色区(>1850KB gzip)，接近微信 2MB 压缩上限\");
    if(gzipKB>2048){console.log(\"  [fail] 压缩后超过微信主包 2048KB 上限(gzip)!\");process.exit(2);}
    else console.log(\"  [ok] 主包体积安全(压缩后 < 2048KB)\");
  " 2>&1)
  rc=$?
  if [ $rc -eq 2 ]; then exit 1; fi
  exit 0
'

echo ""
echo "══════════════════════════════════════════════════"
echo " allcheck 汇总"
echo "══════════════════════════════════════════════════"
for l in "${LINES[@]}"; do echo "  $l"; done
if [ $FAILED -eq 0 ]; then
  echo ""
  echo "${GRN}🎉 全部通过 —— 可进入 E2E / 发版流程${RST}"
else
  echo ""
  echo "${RED}❌ 存在失败步骤，请先修复后重跑${RST}"
fi
echo "提示：E2E（verify-mini*/automator）需 IDE 运行，另见回归链约定"
exit $FAILED
