#!/usr/bin/env node
/**
 * tools/check/check-health.mjs —— 全盘体检门禁（v1.20.6）
 *
 * 目的：把散落在 20+ 个守卫里的关键指标聚合成一份「项目健康报告」，
 *       每次全量回归自动打印并做跨层断言，让结构性问题（体积逼近红线 / 数据 shape 异常 /
 *       坐标回归 / 门禁回潮 / 触点丢失）在一条输出里可见，而不是逐个脚本翻日志。
 *
 * 七层覆盖：① 包体与余量 ② 数据规模 ③ 坐标健康 ④ 结构自检 ⑤ 守卫与回归链 ⑥ 全站 AI 触点
 *          ⑦ 单文件规模棘轮（T4：随包 JS ≤ 800 行，超标必须登记且名单只减不增）。
 * 只读：不改任何文件、不联网、不写存储；任何单项取数失败都标「未取到」而不伪造数字。
 */
import { createRequire } from "module";
import { readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const req = createRequire(fileURLToPath(import.meta.url));
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const T = req(path.join(ROOT, "utils/travel.js"));
const D = req(path.join(ROOT, "utils/data.js"));
// v1.20.8（T5 口径统一）：先跑到「运行时状态」再取数。
// 背景：数据分块（data-packed / data-packed2 / team-food3）在 Node 下是 ready() 时同步补齐的，
//   基础 require 只拿到第一层。旧版体检直接报 require 后的中间态（城市池 751 / 美食 9256），
//   而用户在 App 里看到的是 ready() 之后的 868 / 9569 —— 同一事实两个数字，文档无论抄哪一个都会
//   与另一半对不上。此处统一为「用户实际所见」口径，并由 [fig] 行对外输出真值。
const READY_OK = (() => { try { T.ready(); return true; } catch (e) { return false; } })();

let n = 0, fail = 0;
function ck(name, cond, extra) {
  n++;
  if (cond) { console.log("  [ok]   " + name + (extra ? " · " + extra : "")); return; }
  fail++;
  console.log("  [fail] " + name + (extra ? "  → " + extra : ""));
}
function countFiles(dir, suffix) {
  try { return readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(suffix)).length; }
  catch (e) { return 0; }
}

/* ───────── ① 包体与余量 ───────── */
const pkg = spawnSync(process.execPath, ["tools/check/check-pkgsize.mjs"], { cwd: ROOT, encoding: "utf8" });
const pkgOut = String((pkg && pkg.stdout) || "");
const mainRaw = (pkgOut.match(/主包[^\n]*?raw=(\d+)KB/) || [])[1];
const mainKB = mainRaw ? +mainRaw : null;
const HEADROOM_LIMIT = 1536;
ck("主包 raw 已取到", mainKB != null, mainKB == null ? "未取到" : mainKB + "KB");
ck("主包未越 1.5M 代码质量线", mainKB != null && mainKB <= HEADROOM_LIMIT,
  mainKB == null ? "" : "余量 " + (HEADROOM_LIMIT - mainKB) + "KB");
ck("主包仍有可迭代余量（> 0KB）", mainKB != null && mainKB < HEADROOM_LIMIT);
ck("体积体检逐包 2MB 红线通过", /全部包体在 2MB 红线内/.test(pkgOut));
// 软预警（不 fail）：主包逼近 1.5M 线时提示后续能力优先落分包。
// v1.20.7：团队静态美食块（227KB）已实际挪进 subdata3（余量 1KB→226KB），
// 故此处提示改为通用建议，不再指向已完成的动作。
if (mainKB != null && HEADROOM_LIMIT - mainKB < 16) {
  console.log("  [warn] 主包余量仅 " + (HEADROOM_LIMIT - mainKB) +
    "KB：新增静态数据请落 subdata3 槽位，新增能力请优先放分包");
}

/* ───────── ② 数据规模（只报真实值，不写死期望） ───────── */
const C = req(path.join(ROOT, "utils/corpus.js"));
const CS = (() => { try { return C.corpusStats(); } catch (e) { return null; } })();
let cities = 0, spots = 0, foods = 0, foodShops = 0;
if (Array.isArray(D.CITIES)) cities = D.CITIES.length;
for (const c in (D.SPOT_COORDS || {})) if (Array.isArray(D.SPOT_COORDS[c])) spots += D.SPOT_COORDS[c].length;
for (const c in (D.FOOD_SPOTS || {})) if (Array.isArray(D.FOOD_SPOTS[c]) && D.FOOD_SPOTS[c].length) { foods++; foodShops += D.FOOD_SPOTS[c].length; }
console.log("  ── 规模: 城市池 " + cities + " 条 / 景点 " + spots + " 点 / 美食 " + foodShops + " 家（" + foods + " 城）");
ck("核心数据三项均非空", cities > 0 && spots > 0 && foods > 0);

/* ───────── ③ 坐标健康 ───────── */
const cs = (typeof D.coordStats === "function") ? D.coordStats() : null;
ck("坐标观测接口可用", !!cs);
if (cs) {
  console.log("  ── 坐标: 越界 " + cs.outOfRange + " / (0,0)占位 " + cs.zeroFood +
    " / 无坐标 " + cs.noCoordFood + "（共 " + cs.foodTotal + " 家美食）");
  ck("景点无越界坐标（打包期硬门禁同口径）", cs.outOfRange === 0, "bad=" + cs.outOfRange);
  ck("占位与无坐标已被观测（不是静默吞掉）", cs.zeroFood > 0 && cs.noCoordFood > 0);
  ck("观测总数自洽", cs.foodTotal >= cs.zeroFood + cs.noCoordFood);
}
const coord = req(path.join(ROOT, "subpkg/utils/coord.js"));
ck("(0,0) 与字符串 \"0\" 都判为无坐标", !coord.hasCoord({ lat: 0, lon: 0 }) && !coord.hasCoord({ lat: "0", lon: "0" }));
ck("真实坐标仍可导航", coord.hasCoord({ lat: 30.655, lon: 104.079 }));

/* ───────── ④ 结构自检 ───────── */
const issues = (typeof D.assertDataShape === "function") ? D.assertDataShape() : ["assertDataShape 缺失"];
ck("加载期 shape 断言通过", issues.length === 0, issues.join("；"));
const srcData = read("tools/_src-backup/data.js"), outData = read("utils/data.js");
ck("data.js 手写双源字节一致", srcData === outData);
// v1.20.8（T2）：加载期合并函数只允许 2 个 —— applyPacked（分块合并）+ applyStaticTables（表合并内核）。
// 曾经有 8 个 apply*（坐标修正/坐标补录/稀疏补全/美食富信息/团队美食/坐标回写/住宿片区/逐酒店）
// 各自抄一遍「按城市+名定位、缺失才补」，改一处漏一处；收敛后新增数据表只需加一条表描述。
const applyFns = (srcData.match(/^function apply[A-Za-z]+/gm) || []).length;
ck("加载期合并函数 ≤ 2 个（内核化，不再各写一份）", applyFns <= 2, "apply* = " + applyFns);
const tableCount = (srcData.match(/\{ id: "/g) || []).length;
ck("静态表描述 ≥ 6 条（数据表与逻辑解耦）", tableCount >= 6, "表 = " + tableCount);

/* ───────── ⑤ 守卫与回归链 ───────── */
const guards = countFiles("tools/check", ".mjs");
const tests = countFiles("tools/test", ".mjs");
const steps = (read("allcheck.sh").match(/^step /gm) || []).length;
console.log("  ── 回归链: " + steps + " 步 / 守卫 " + guards + " 个 / 单测 " + tests + " 个");
ck("allcheck 保持 61 步口径", steps === 61, "steps=" + steps);
ck("守卫与单测数量充足", guards >= 20 && tests >= 30, guards + "/" + tests);
ck("新增优化守卫与体检单测都已接入回归链",
  /_test-optimizations\.mjs/.test(read("allcheck.sh")) && /check-health\.mjs/.test(read("allcheck.sh")));
ck("构建幂等依赖内容 hash（不是固定戳）",
  /内容 hash|content hash/.test(read("tools/web/build.mjs")));
// 历史高发点：_test-food-render.mjs 用 vm 只跑「方法体」，不执行顶层 require；
// 一旦页面把函数抽成模块依赖而没同步注入 ctx，就会抛 ReferenceError → 假空态。
ck("vm 沙箱单测已注入坐标模块依赖（防作用域回归）",
  /Object\.assign\(\{ T, FM, hasCoord \}/.test(read("tools/test/_test-food-render.mjs")));

/* ───────── ⑥ 全站 AI 触点 ───────── */
let appJson = null;
try { appJson = JSON.parse(read("app.json")); } catch (e) {}
const allPages = (appJson && Array.isArray(appJson.pages) ? appJson.pages.slice() : []);
((appJson && appJson.subPackages) || []).forEach(sp => (sp.pages || []).forEach(p => allPages.push(sp.root + "/" + p)));
const real = allPages.filter(p => !/^pages\/splash\/|^subdata\d*\/(keep|boost)\//.test(p));
const noEntry = real.filter(p => { try { return !/"ai-entry"/.test(read(p + ".json")); } catch (e) { return true; } });
console.log("  ── AI 触点: " + (real.length - noEntry.length) + "/" + real.length + " 页有统一入口");
ck("入口覆盖 ≥15/17", (real.length - noEntry.length) >= 15);
ck("无入口的只剩 AI 能力页自身",
  noEntry.every(p => /^subpkg\/(assistant\/assistant|lens\/lens)$/.test(p)), noEntry.join(","));
ck("页面级 grounding 与健康快照都在",
  /_contextOf\(/.test(read("subpkg/assistant/assistant.js")) &&
  /_healthLines\(\)/.test(read("pages/more/more.js")));

/* ───────── ⑦ 数字真值输出（T5：文档不再手写漂移值） ───────── */
console.log("【数字真值 · 文档引用这些】");
ck("运行时数据已就绪（规模口径统一的前提）", READY_OK, READY_OK ? "ready() 成功" : "ready() 抛错，下面的规模是中间态");
// 体验条数不在本文件里重算：城市去重规则（limited 别名）只存在于 corpus.js 的 _realCities()，
// 这里照抄一遍就是第二个真相源。corpus.js v1.20.8 起直接输出 experiences。
const exp = CS ? CS.experiences : 0;
let enCities = 0, enShops = 0;
for (const c in (D.FOOD_SPOTS || {})) {
  const arr = D.FOOD_SPOTS[c] || [];
  let hit = 0;
  arr.forEach((s) => { if (s && (s.menu || s.rep || s.note || s.repKey)) hit++; });
  if (hit) enCities++;
  enShops += hit;
}
const FIGS = [
  ["city_entries", cities],
  ["cities_real", CS ? CS.cities : 0],
  ["city_aliases", CS ? CS.aliasEntries : 0],
  ["spots", spots],
  ["spot_info", CS ? CS.spotInfo : 0],
  ["spot_cities", CS ? CS.spotCities : 0],
  ["food_shops", foodShops],
  ["food_cities", foods],
  ["food_enrich_shops", enShops],
  ["food_enrich_cities", enCities],
  ["experiences", exp],
  ["hospitals", CS ? CS.hospitals : 0],
  ["hospital_cities", CS ? CS.hospitalCities : 0],
  ["approx_cities", CS ? CS.approxCities : 0],
  ["provinces", CS ? CS.provinces : 0],
  ["main_raw_kb", mainKB == null ? 0 : mainKB],
  ["main_headroom_kb", mainKB == null ? 0 : HEADROOM_LIMIT - mainKB],
  ["steps", steps],
  ["guards", guards],
  ["tests", tests],
];
for (const [k, v] of FIGS) console.log("[fig] " + k + "=" + v);
// 余量允许为 0（= 刚好顶线），不属于「取数失败」，单独排除，避免误报成数据没读到。
const ZERO_OK = new Set(["main_headroom_kb"]);
ck("真值全部取到（0 表示取数失败，不是真实值）",
  FIGS.every(([k, v]) => v > 0 || ZERO_OK.has(k)),
  FIGS.filter(([k, v]) => !v && !ZERO_OK.has(k)).map(([k]) => k).join(",") || "");

/* ───────── ⑦ 单文件规模棘轮（T4）─────────
   动机：8267 行的 ai-deep-auto.js / 1708 行的 plan.js 这类巨型文件，代价不在运行期，
   而在「改一处要读半天 + 六个分支机合并必冲突」。拆完之后必须留一条硬线，
   否则下次顺手再塞一个功能就长回去了。
   口径：
     · 随包发布的 JS（app.js / pages / subpkg / subai / utils）单文件 ≤ 800 行，零例外。
       subdata* 是 pack-data 的生成产物，由「data≤1950KB」预算线约束，不在这里重复管。
     · 非随包的源文件（tools/）超过 800 行必须逐条登记在 OVERSIZE_ALLOWED 里，
       并断言「登记项依然存在且依然超标」—— 拆完就得从名单删掉，名单只减不增。
       这是「显式登记」而不是「悄悄放过」：每次全量回归都会把这些文件打印出来。 */
console.log("【单文件规模】");
const SIZE_LIMIT = 800;
const SHIPPED_DIRS = ["pages", "subpkg", "subai", "utils"];
const OVERSIZE_ALLOWED = new Map([
  // 逻辑真源（build-min 的输入），不随包发布；拆它们属于算法内核级重构，另立项。
  ["tools/_src-backup/travel.js", "行程生成/导航/百科内核，6729 行逻辑真源"],
  ["tools/_src-backup/planner.js", "行程编排真源，按天/预算/节奏耦合度高"],
  ["tools/_src-backup/emergency-data.src.js", "应急数据表，条目式结构"]
]);
function walkJs(dir, out) {
  let ents = [];
  try { ents = readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) walkJs(rel, out);
    else if (e.name.endsWith(".js")) out.push(rel);
  }
  return out;
}
const lineCount = (rel) => {
  try { return readFileSync(path.join(ROOT, rel), "utf8").split("\n").length; } catch (e) { return -1; }
};
const shipped = ["app.js"].concat(SHIPPED_DIRS).reduce((a, d) => walkJs(d, a), []);
const shippedBig = shipped.map((f) => [f, lineCount(f)]).filter(([, c]) => c > SIZE_LIMIT);
ck("随包发布 JS 单文件 ≤ " + SIZE_LIMIT + " 行（" + shipped.length + " 个文件，零例外）",
  shippedBig.length === 0, shippedBig.map(([f, c]) => f + "=" + c).join(","));

const toolJs = walkJs("tools", []).filter((f) => !f.startsWith("tools/data/"));
// tools/data/ 是采集/导入管线的数据表（十万行级条目），它的大是「数据量」不是「逻辑耦合」，
// 由各自导入脚本与坐标护栏管，不套 800 行线；这里只量「要人读的逻辑源码」。
const toolBig = toolJs.map((f) => [f, lineCount(f)]).filter(([, c]) => c > SIZE_LIMIT);
const unregistered = toolBig.filter(([f]) => !OVERSIZE_ALLOWED.has(f)).map(([f, c]) => f + "=" + c);
ck("tools/ 超标文件均已登记（新增超标必须登记或拆掉）", unregistered.length === 0, unregistered.join(","));
// 名单防僵化：登记项拆干净了就必须删登记，否则名单会变成「历史遗留免死金牌」。
const staleAllow = [...OVERSIZE_ALLOWED.keys()].filter((f) => lineCount(f) <= SIZE_LIMIT);
ck("规模豁免名单无过期项（拆完要删登记，名单只减不增）", staleAllow.length === 0, staleAllow.join(","));
ck("规模豁免仅限非随包源文件", [...OVERSIZE_ALLOWED.keys()].every((f) => f.startsWith("tools/")),
  [...OVERSIZE_ALLOWED.keys()].filter((f) => !f.startsWith("tools/")).join(","));

console.log("\n  全盘体检: " + (n - fail) + "/" + n + " 通过" +
  (fail ? "" : "  · 七层指标无结构性异常"));
if (fail) process.exit(1);
