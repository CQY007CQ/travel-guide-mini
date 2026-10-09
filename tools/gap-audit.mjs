// 全国城市覆盖缺口审计（v1.14 前置）：CITIES vs PROVINCE_CITIES vs 锚点
// 用法：node tools/gap-audit.mjs [outfile]
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const cs = D.CITIES || [];
const cset = new Set(cs.map(c => c.name));
const pc = D.PROVINCE_CITIES || {};
const anchors = D.CITY_COORDS || {};

const lines = [];
const out = (s = "") => { lines.push(s); };

out("全国城市覆盖缺口审计  " + new Date().toISOString().slice(0, 10));
out("=".repeat(58));
out("CITIES 总数: " + cs.length + " | PROVINCE_CITIES 条目: " +
  Object.keys(pc).reduce((a, p) => a + (pc[p] || []).length, 0) +
  " | CITY_COORDS 锚点: " + Object.keys(anchors).length);

// 1) 省内路由提到、但没有 CITIES 记录的城市（= 主缺口）
out("\n【A】PROVINCE_CITIES 有、CITIES 无（补收录主缺口，按省）");
let missTotal = 0;
Object.keys(pc).sort().forEach(p => {
  const missing = (pc[p] || []).filter(n => !cset.has(n));
  if (!missing.length) return;
  missTotal += missing.length;
  out("  " + p + " (" + missing.length + "): " + missing.join("、"));
});
out("  小计: " + missTotal + " 城");

// 2) CITIES 里有、但没有锚点（导航兜底缺口）
out("\n【B】CITIES 无锚点（导航兜底缺口）");
let noAnc = [];
cs.forEach(c => {
  if (!anchors[c.name]) {
    const spotN = (c.experiences || []).length;
    noAnc.push(c.name + "(" + spotN + "景)");
  }
});
out("  小计: " + noAnc.length + " 城  → " + (noAnc.join("、") || "无"));

// 3) 每个 CITIES 的 experiences 命中精确坐标比例（现状）
out("\n【C】每城 experiences 精确坐标命中率（approx!==true 且非城锚级）");
const P = req("./utils/planner.js");
let bad = 0;
cs.forEach(c => {
  const ex = c.experiences || [];
  if (!ex.length) return;
  let hit = 0;
  ex.forEach(e => {
    const n = typeof e === "string" ? e : (e && e.name) || "";
    if (!n) return;
    const g = P.getSpotCoord(c.name, n);
    if (g && g.approx !== true) hit++;
  });
  const rate = hit / ex.length * 100;
  if (rate < 100) { bad++; out("  低命中 " + c.name + ": " + hit + "/" + ex.length + " = " + rate.toFixed(1) + "%  ← " + ex.filter(e => { const n = (typeof e === "string" ? e : e.name) || ""; const g = P.getSpotCoord(c.name, n); return !(g && g.approx !== true); }).map(e => (typeof e === "string" ? e : e.name)).slice(0, 5).join("、")); }
});
out("  非 100% 精确命中城市数: " + bad + "/" + cs.filter(c => (c.experiences || []).length).length);

// 4) 全省精华 landmark 缺精确坐标（过去修过一轮，防回退）
out("\n【D】坐标表体量");
const spotKeys = D.SPOT_COORDS || {};
out("  SPOT_COORDS 键数: " + Object.keys(spotKeys).length + " | 坐标总条数: " + Object.keys(spotKeys).reduce((a, k) => a + (spotKeys[k] || []).length, 0));

fs.writeFileSync(path.join(process.cwd(), "tools", "gap-report.txt"), lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\n报告已写入 tools/gap-report.txt");
