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
  # 补齐 subpkg/ 与网页版手写源码。原先只扫 app.js/utils/pages，
  # web/app.js 与 web/lib/runtime.js 有语法错误时回归链仍全绿，直到打开网页白屏才发现。
  # 只显式加这两个手写文件，不要把 lib/modules.js|data.js|tpl.js（MB 级生成产物）纳入。
  done < <(find app.js utils pages subpkg web/app.js web/lib/runtime.js -name "*.js" -o -name "*.mjs" | sort)
  for f in tools/*.mjs tools/*.js tools/*.cjs; do
    if ! '"$NODE"' --check "$f" 2>/dev/null; then echo "语法错误: $f"; err=1; fi
  done
  [ $err -eq 0 ] && echo "全部 JS 语法通过"
  exit $err
'

# 依赖完整性：任何相对 require/import 都必须可解析（防"移文件移断管线"，见 check-v112 事故）
step "依赖完整性 (相对引用可解析)" "$NODE" tools/check-deps.mjs
# 凭据泄露：全仓（含 docs/ 与 tools/）不得出现明文 key；随包额外查高德接口 / 未登记外链。
# 2026-11-09 修正：旧版只扫随包目录，公开仓库 docs/ 里的明文 key 因此整轮漏检。
step "凭据泄露 (全仓无明文 key)" "$NODE" tools/check-secrets.mjs
# 图片引用：缺失不会编译报错，只会在特定主题下显示破图（深色 tabBar 图标曾整组缺失）
step "图片引用 (无缺失图标)" "$NODE" tools/check-assets.mjs
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
step "单测 daily-insp (函数保留·UI 已下线)" "$NODE" tools/_test-daily-insp.mjs
step "单测 recommend (个性推荐引擎)" "$NODE" tools/_test-recommend.mjs
# 模糊测试：171 组标签组合 + 极端输入 + 全量城市不变量。曾借此抓到 topN=0 未被夹取的 bug。
step "模糊测试 recommend (标签组合/极端输入)" "$NODE" tools/_fuzz-recommend.mjs
# 旅途应急：分诊正确性 + 医院数据完整性 + 「不得出现医疗断言」红线
step "单测 emergency (旅途应急分诊)" "$NODE" tools/_test-emergency.mjs
# 菜名→店铺匹配：命中正确性 + 无命中不瞎给 + 品牌联想不被词根覆盖
step "单测 foodmap (菜名→店铺)" "$NODE" tools/_test-foodmap.mjs
# 美食菜单/口碑试点（10 热门城市）：每城每家 menu(1-3)/rep/note 完整，经分块真实加载校验
step "单测 food-menu (菜单·口碑·点评 试点)" "$NODE" tools/_test-food-menu.mjs
# 酒店住宿多片区推荐 + 平台门户（v1.19.145）：精选城/退化/地图多点/门户搜索词
step "单测 hotel (多片区·门户 v1.19.145)" "$NODE" tools/_test-hotel.mjs
# plan 页 summary 卡精简（v1.19.146）：stats 去重 + 倒计时 label/tip
step "单测 plan146 (summary 精简)" "$NODE" tools/_test-plan146.mjs
# 天气多城按各天所在城市预报（v1.19.151）：mergeWeatherByDay 对齐 + rainyDaySpots 形态/室内命中
step "单测 weather151 (多城天气对齐)" "$NODE" tools/_test-weather151.mjs
step "单测 spotsearch (按标签找景点·倒排检索 v1.19.163)" "$NODE" tools/_test-spotsearch.mjs
# 「今日正当时」已于 2026-10-29 按用户要求下线，原接线测试改为「下线守卫」（防被无意加回）
step "单测 insp 下线守卫" "$NODE" tools/_test-insp-removed.mjs
step "单测 气候补充去重" "$NODE" tools/_test-climate-dedupe.mjs
step "单测 景点去重 (v1.19.167)" "$NODE" tools/_test-dedup.mjs
step "单测 模糊POI坐标补录 (v1.19.172)" "$NODE" tools/_test-fuzzy-poi.mjs
step "单测 坐标完整性自检 (v1.19.173)" "$NODE" tools/_test-coord-integrity.mjs
step "单测 稀疏县景点补全 (v1.19.174)" "$NODE" tools/_test-spot-enrich.mjs
step "单测 动线优化 (v1.19.176 最近邻贪心重排)" "$NODE" tools/_test-route-opt.mjs
step "单测 攻略自评分 (v1.19.177 评分+建议)" "$NODE" tools/_test-score.mjs
step "单测 跨会话偏好学习 (v1.19.178 记/取/回填)" "$NODE" tools/_test-prefs.mjs
step "单测 字号无障碍 (v1.19.181 跟随系统字号)" "$NODE" tools/_test-a11y.mjs
# v1.19.182：全量城市空天 / 稀疏扫描门禁（守护 cityDayCap 上限，防稀疏县末天空天回归）
step "单测 全量空天扫描 (v1.19.182)" "$NODE" tools/_scan-sparse.mjs
# v1.19.182：批量生成冒烟门禁（多城 × 多天数 × 多节奏，统计异常率 / 空天率 / 评分基线）
step "单测 批量生成冒烟 (v1.19.182)" "$NODE" tools/_smoke-batch.mjs
# v1.19.182：分享深链出发日边界（过期顺延今天，保证 auto=1 复现有效行程）
step "单测 分享过期日期边界 (v1.19.182)" "$NODE" tools/_test-clamp-depart.mjs
# v1.19.182：美食富信息扩城（加载期增量合并，字段完整 / 同城幂等）
step "单测 美食富信息扩城 (v1.19.182)" "$NODE" tools/_test-food-enrich.mjs
step "单测 sharecard (转发卡片 v1.19.88)" "$NODE" tools/_test-v11988-sharecard.mjs
step "单测 plan-handlers (行程页交互回归 v1.19.109)" "$NODE" tools/_test-plan-handlers.mjs
# v1.19.93：全页面启动冒烟——vm 模拟 17 个注册页「被打开」（Page 构造+onLoad+onShow）。
# 抓上传工具链与静态扫描都查不到的运行时级问题（曾抓到 7 个分包页 require 路径层级错误→白屏）。
step "全页面启动冒烟 (v1.19.93)" "$NODE" tools/_test-v11993-bootsmoke.mjs
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
# v1.19.147：导航死链 + 跳转合规审计（按键能否正常跳转：死链 / switchTab 误用 / 动态 url 列出）
step "导航死链审计 (按键跳转)" "$NODE" tools/_nav-audit.mjs

# 【v1.19.78 修正】微信约束是「每包独立 2MB 压缩后红线」，旧版把全项目（含 1.7MB 数据分包）
# 累加成一个数去比对 2MB → 必然误报。改为按 app.json 主包+各分包逐包核算（tools/check-pkgsize.mjs）。
step "分包体积体检 (每包 2MB 红线)" "$NODE" tools/check-pkgsize.mjs

# 【v1.19.196 新增】preloadRule 任一页面预下载分包「源码体积」合计不得超 2MB，否则上传报
# 系统错误 80058（本地编译/真机调试都发现不了，只在上传时由微信平台校验），故固化为 fail-fast。
step "预下载体积门禁 (preloadRule ≤ 2MB)" "$NODE" tools/check-preload.mjs

# 【v1.19.182 体积预算门禁】把「数据分包被静默撑爆 / 主包逻辑膨胀」从「上传后盯尺寸表」升级为 fail-fast。
# data-packed.js 硬红线：v1.19.182 初设为 1800KB（留 180KB 余量给 1980KB 自动拆分阈值）；
#   v1.19.191 起放宽到 1950KB —— 合法数据增长（部分东北/华东团队采集 + 富信息 P2②）已把单块顶到 ~1826KB，
#   仍远低于 pack-data.mjs 的 CHUNK_B64_MAX=1980KB 自动拆分阈值与微信 2MB 分包硬上限，单块无需拆分；
#   红线保留的意义是卡住「无征兆撑爆」与「残包异常缩小」（后者由 verify-release 兜底）。
# utils 主包逻辑总体积预算 ≤1000KB：留足 headroom 的同时卡住无谓膨胀（富信息/覆盖层增量都算在主包内）。
step "体积预算门禁 (data≤1950KB / utils≤1000KB)" bash -c '
  dp="subdata/data/data-packed.js"; [ -f "$dp" ] || dp=$(ls subdata*/data/data-packed*.js 2>/dev/null | head -1)
  sz=0; [ -f "$dp" ] && sz=$(wc -c < "$dp")
  ut=$(cat utils/*.js 2>/dev/null | wc -c)
  echo "  data-packed: $((sz/1024))KB  红线 1950KB"
  echo "  utils 逻辑:  $((ut/1024))KB  预算 1000KB"
  bad=0
  [ "$sz" -gt 1996800 ] && { echo "  ✗ FAIL: data-packed 超 1950KB"; bad=1; }
  [ "$ut" -gt 1024000 ] && { echo "  ✗ FAIL: utils 主包逻辑超 1000KB"; bad=1; }
  [ "$sz" -lt 102400 ] && { echo "  ✗ FAIL: data-packed 异常偏小（疑似残包）"; bad=1; }
  exit $bad
'

# 【P0-2 发布安全门禁】把「数据分包被 ignoreUploadUnusedFiles 静默剥离成 10KB 残包」这条
# 最危险的静默灾难型 footgun 从「上传后人工盯尺寸表」升级为 fail-fast。详见 tools/verify-release.mjs。
step "发布安全门禁 (数据必随包发布)" "$NODE" tools/verify-release.mjs

# 【v1.19.197 新增】演示质量 / Console 告警防回潮：废弃 API 误调用、跨分包同步 require、
# setData undefined、recents 重复 wx:key、分包专用 JS 滞留主包、三处版本号不一致。
# 这些本地编译 + 原有门禁都发现不了，只在开发者工具 Console / 代码质量面板暴露。
step "演示质量门禁 (Console 告警防回潮)" "$NODE" tools/check-demo-quality.mjs
# v1.19.198：「换一批」曾因算法确定性而点了没反应，固化为运行时回归
step "单测 换景点分批 (换一批真的会变)" "$NODE" tools/_test-swap-batch.mjs
# v1.19.199：「生成分享图」真机稳定失败，固化为运行时回归
step "单测 分享图导出 (生成失败防回潮)" "$NODE" tools/_test-share-img.mjs
# v1.19.200：美食页对象方法裸调用导致整页假空态，固化为运行时 + 全仓静态回归
step "单测 美食页渲染 (假空态防回潮)" "$NODE" tools/_test-food-render.mjs
# v1.19.201：推荐引擎月份漂移 + 考核材料数字口径漂移，固化为「动态真值 vs 材料文本」门禁
step "材料口径一致性 (版本/回归项/单测数/榜单)" "$NODE" tools/check-doc-consistency.mjs
# v1.19.203：门票清单长票价把景点名挤成逐字竖排，固化为「全量数据拆分 + CSS 限宽」回归
step "单测 门票清单布局 (逐字竖排防回潮)" "$NODE" tools/_test-ticket-layout.mjs
# v1.19.204：帮助页离线规模统计把医院读成 0（数据真源在 emergency-data 而非 data.js），
#             固化为「统计 vs 真源逐项一致 + 帮助页渲染 + 指南无静态数字」回归
step "单测 离线数据规模口径 (医院统计为 0 防回潮)" "$NODE" tools/_test-corpus.mjs
# 【v1.20.4 #106 合并门禁】本仓 utils/*.js（travel/planner/weather/store/geo/corpus/pako-inflate/toolkit-groups）
# 是 tools/build-min.mjs 的压缩产物，不是手改文件。若「改了 tools/_src-backup 漏跑 build-min」或
# 「手改了 utils 应改 _src-backup」，随包上线的 utils 就会与源码不一致（静默 footgun）。
# 做法：构建前把 8 个目标快照到 /tmp，跑 build-min 后再逐文件 cmp；任一不一致即说明漏构建 / 改错文件。
step "合并门禁 (utils 与 _src-backup 一致)" bash -c '
  mkdir -p /tmp/mg106
  for f in utils/travel.js utils/planner.js utils/weather.js utils/store.js utils/geo.js utils/corpus.js utils/pako-inflate.js utils/toolkit-groups.js; do
    cp "$f" "/tmp/mg106/$(basename "$f").before" 2>/dev/null
  done
  "$1" tools/build-min.mjs >/dev/null 2>&1 || { echo "  ✗ build-min 执行失败"; exit 1; }
  BAD=0
  for f in utils/travel.js utils/planner.js utils/weather.js utils/store.js utils/geo.js utils/corpus.js utils/pako-inflate.js utils/toolkit-groups.js; do
    if ! cmp -s "$f" "/tmp/mg106/$(basename "$f").before"; then echo "  ✗ $f 构建前后不一致（漏跑 build-min，或手改了 utils 应改 tools/_src-backup）"; BAD=1; fi
  done
  # 手写双源（keys.js / data.js 经 cp 同步，非 build-min 产物）：与 _src-backup 字节一致，否则「改了 _src-backup 忘 cp」会静默漂移
  for f in utils/keys.js utils/data.js; do
    if ! cmp -s "$f" "tools/_src-backup/$(basename "$f")"; then echo "  ✗ $f 与 tools/_src-backup/$(basename "$f") 不一致（手写双源漂移：改了 _src-backup 忘 cp 到 utils）"; BAD=1; fi
  done
  [ $BAD -eq 0 ] && echo "  ✓ utils 与 _src-backup 一致（含手写 keys.js/data.js）"
  exit $BAD
' _ "$NODE"

# v1.20.0：网页版 —— 把小程序同一份源码（utils + 页面 JS + WXML + WXSS）编译到浏览器。
# 核心保障是「同源」：任何改动都先构建再用引擎冒烟验证，网页端不会悄悄漂移。
# NODE 是父 shell 局部变量（未 export），bash -c 子 shell 里取不到 → 曾报 "bash: : command not found"；
# 必须用位置参数传进去。管道必须开 pipefail，否则 smoke 失败会被 tail 的退出码吞掉，门禁假绿。
# 审计加固的运行时单测串在同一 step 里跑，不新增 step —— 61 步口径与考核材料无需跟着改
step "审计整改防回潮断言 (#1/#19/#56/#81 不回潮)" bash -c '"$1" tools/_test-audit-guards.mjs && "$1" tools/_test-hardening.mjs && "$1" tools/_test-roster-integrity.mjs' _ "$NODE"

step "网页版 构建与引擎冒烟 (与小程序同源)" bash -c 'set -o pipefail; "$1" tools/web/build.mjs >/dev/null && "$1" tools/web/smoke.mjs | tail -4' _ "$NODE"

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
