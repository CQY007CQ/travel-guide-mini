// 从地标库自动补充景点数不足 14 的城市（生成补丁文件）
// 规则：① 只取地标库中尚未收录的真实地标
//      ② 跳过会新增跨城重名的条目（避免破坏省域优先断言）
//      ③ 只要「已有精确坐标」的条目（无坐标会拉低精确率门禁，且不能声称可一键导航）
// 说明：地标库中绝大多数条目没有精确坐标，因此本脚本收益有限（约 30 条）；
//      「每城≥14」主要仍需按批次手写补充（见 v199-hot-spots-* 的做法）。
const fs = require("fs");
const D = require("../utils/data.js");
const LIBS = ["CITY_LANDMARKS", "CITY_LANDMARKS_EXTRA", "CITY_LANDMARKS_EXTRA2", "CITY_LANDMARKS_EXTRA3", "CITY_LANDMARKS_EXTRA4", "CITY_LANDMARKS_EXTRA5", "CITY_LANDMARKS_EXTRA6"];

const owners = {};
for (const c of D.CITIES) for (const e of (c.experiences || [])) (owners[e.name] = owners[e.name] || []).push(c.name);

const EXP = {};
let skippedDup = 0, skippedNoCoord = 0;
for (const c of D.CITIES) {
  const n = (c.experiences || []).length;
  if (n >= 14) continue;
  const ex = new Set((c.experiences || []).map(e => e.name));
  const coordSet = new Set((D.SPOT_COORDS[c.name] || []).map(s => s[0]));
  const pool = [];
  LIBS.forEach(l => ((D[l] || {})[c.name] || []).forEach(x => { if (!ex.has(x) && !pool.includes(x)) pool.push(x); }));
  const need = 14 - n;
  const picked = [];
  for (const nm of pool) {
    if (picked.length >= need) break;
    const others = (owners[nm] || []).filter(o => o !== c.name);
    if (others.length) { skippedDup++; continue; }
    if (!coordSet.has(nm)) { skippedNoCoord++; continue; }
    picked.push(nm);
  }
  if (picked.length) {
    EXP[c.name] = picked.map(nm => ({
      from: "",
      to: { name: nm, period: "全天", note: "坐标已收录，可一键导航：" + nm }
    }));
  }
}

const src = "// v1.17.3 地标库自动补充：把景点数不足 14 的城从地标库补足（真实地标 + 已有精确坐标，不虚构）\n" +
  "// 生成方式：tools/gen-fill-landmarks.js（可重跑）。跳过跨城重名与无坐标条目。\n" +
  "module.exports = " + JSON.stringify({ EXP_REPLACE: EXP }, null, 1) + ";\n";
fs.writeFileSync("tools/v199-fill-landmarks.js", src, "utf8");

console.log("补丁已生成：补入", Object.keys(EXP).length, "城 /", Object.values(EXP).reduce((s, v) => s + v.length, 0), "条");
console.log("  跳过无坐标:", skippedNoCoord, "条 | 跨城重名跳过:", skippedDup);
