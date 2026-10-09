// 地标转正后，把"已进 experiences"的名字从 CITY_LANDMARKS* fallback 库移除，
// 消除 planner 同时从业+库拉取导致的跨天重复。LM_REMOVE 由 merge 应用到全部 landmark 库。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const LM_LIBS = ["CITY_LANDMARKS","CITY_LANDMARKS_EXTRA","CITY_LANDMARKS_EXTRA2","CITY_LANDMARKS_EXTRA3","CITY_LANDMARKS_EXTRA4","CITY_LANDMARKS_EXTRA5","CITY_LANDMARKS_EXTRA6"];

const expSet = {};
D.CITIES.forEach(c => expSet[c.name] = new Set((c.experiences || []).map(e => (typeof e === "string" ? e : e.name || e.t || "").trim())));

const LM_REMOVE = {};
let total = 0;
D.CITIES.forEach(c => {
  const inLm = new Set();
  LM_LIBS.forEach(lib => { (D[lib] && D[lib][c.name] || []).forEach(n => inLm.add(String(n).trim())); });
  const overlap = [...inLm].filter(n => expSet[c.name].has(n));
  if (overlap.length) { LM_REMOVE[c.name] = overlap; total += overlap.length; }
});

const out = "// 自动生成：地标转正后从 fallback 库移除已进 experiences 的名字（消除跨天重复）\nmodule.exports = {\n  LM_REMOVE: " + JSON.stringify(LM_REMOVE, null, 1) + "\n};\n";
fs.writeFileSync(path.join(process.cwd(), "tools", "v198-landmark-lmremove.js"), out);
console.log("LM_REMOVE 覆盖城", Object.keys(LM_REMOVE).length, "移除名字", total);
