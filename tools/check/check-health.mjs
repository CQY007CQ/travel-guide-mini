#!/usr/bin/env node
/**
 * tools/check/check-health.mjs —— 全盘体检门禁（v1.20.6）
 *
 * 目的：把散落在 20+ 个守卫里的关键指标聚合成一份「项目健康报告」，
 *       每次全量回归自动打印并做跨层断言，让结构性问题（体积逼近红线 / 数据 shape 异常 /
 *       坐标回归 / 门禁回潮 / 触点丢失）在一条输出里可见，而不是逐个脚本翻日志。
 *
 * 六层覆盖：① 包体与余量 ② 数据规模 ③ 坐标健康 ④ 结构自检 ⑤ 守卫与回归链 ⑥ 全站 AI 触点。
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
const D = req(path.join(ROOT, "utils/data.js"));

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
// 软预警（不 fail）：主包逼近 1.5M 线时提示后续能力优先落分包 / 打通 subdata3 数据槽位。
if (mainKB != null && HEADROOM_LIMIT - mainKB < 16) {
  console.log("  [warn] 主包余量仅 " + (HEADROOM_LIMIT - mainKB) +
    "KB：新增能力请优先放分包，或先把团队静态块挪进 subdata3 预留槽位");
}

/* ───────── ② 数据规模（只报真实值，不写死期望） ───────── */
let cities = 0, spots = 0, foods = 0;
if (Array.isArray(D.CITIES)) cities = D.CITIES.length;
for (const c in (D.SPOT_COORDS || {})) if (Array.isArray(D.SPOT_COORDS[c])) spots += D.SPOT_COORDS[c].length;
for (const c in (D.FOOD_SPOTS || {})) if (Array.isArray(D.FOOD_SPOTS[c])) foods += D.FOOD_SPOTS[c].length;
console.log("  ── 规模: 城市池 " + cities + " 条 / 景点 " + spots + " 点 / 美食 " + foods + " 家");
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

console.log("\n  全盘体检: " + (n - fail) + "/" + n + " 通过" +
  (fail ? "" : "  · 六层指标无结构性异常"));
if (fail) process.exit(1);
