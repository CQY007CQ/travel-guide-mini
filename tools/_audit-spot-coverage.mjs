// 审计已入库景点在「门票 / 预约 / 链接 / 相关介绍」四个维度的覆盖情况
// 用法: node tools/_audit-spot-coverage.mjs
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

// ---- 1. 收集「已入库景点」= 所有城市的 experiences 去重名 ----
const expNames = new Map(); // name -> cityName
for (const c of D.CITIES) {
  const exps = c.experiences || [];
  for (const e of exps) {
    const n = (e && (e.name || e.t)) || "";
    if (!n) continue;
    if (!expNames.has(n)) expNames.set(n, c.name);
  }
}
// 坐标库里的景点名（更大池）
const coordNames = new Set();
for (const k of Object.keys(D.SPOT_COORDS || {})) for (const s of (D.SPOT_COORDS[k] || [])) if (s[0]) coordNames.add(s[0]);

const expSet = new Set(expNames.keys());
const allSet = new Set([...expSet, ...coordNames]);

// ---- 2. 三套结构 ----
const TICKETS = D.SPOT_TICKETS || {};
const DETAILS = D.SPOT_DETAILS || {};
const BOOKING = D.BOOKING_TIPS || {};
const INFO = D.SPOT_INFO || {};

// 统计某 name 集合在结构里的命中
function coverage(map, names) {
  let hit = 0; const samples = [];
  for (const n of names) {
    if (map[n]) { hit++; if (samples.length < 6) samples.push([n, map[n]]); }
  }
  return { hit, total: names.size, samples };
}
const cTickExp = coverage(TICKETS, expSet);
const cDetExp = coverage(DETAILS, expSet);
const cBookExp = coverage(BOOKING, expSet);
const cInfoExp = coverage(INFO, expSet);

// ---- 3. 是否含「链接」字段 / 文本里的链接或预约 ----
function valueShapes(map, n = 12) {
  const shapes = new Map();
  let i = 0;
  for (const k of Object.keys(map)) {
    const v = map[k];
    const ks = (v && typeof v === "object") ? Object.keys(v).join(",") : typeof v;
    shapes.set(ks, (shapes.get(ks) || 0) + 1);
    if (i++ > 4000) break;
  }
  return shapes;
}
// 扫描所有结构的值，找 link/url/预约/官网/预订 关键词
const KEYWORDS = ["link", "url", "http", "官网", "预约", "预订", "购票", "公众号", "小程序"];
function scanForKeyword(map, kw) {
  let n = 0; const ex = [];
  for (const k of Object.keys(map)) {
    const v = map[k];
    const s = (v && typeof v === "object") ? JSON.stringify(v) : String(v || "");
    if (s.includes(kw)) { n++; if (ex.length < 4) ex.push(k + " => " + s.slice(0, 80)); }
  }
  return { n, ex };
}

console.log("══════════════════════════════════════════════════");
console.log(" 已入库景点覆盖审计");
console.log("══════════════════════════════════════════════════");
console.log("城市数 CITIES:", D.CITIES.length);
console.log("experience 去重景点名:", expSet.size);
console.log("坐标库景点名(SPOT_COORDS):", coordNames.size);
console.log("坐标+经验 全景点名并集:", allSet.size);
console.log("");
console.log("── 三套结构当前容量 ──");
console.log("SPOT_TICKETS 条数:", Object.keys(TICKETS).length);
console.log("SPOT_DETAILS 条数:", Object.keys(DETAILS).length);
console.log("BOOKING_TIPS 条数:", Object.keys(BOOKING).length);
console.log("SPOT_INFO 条数:", Object.keys(INFO).length);
console.log("");
console.log("── 对「已入库景点」(experience) 的覆盖率 ──");
console.log(`门票 SPOT_TICKETS : ${cTickExp.hit}/${cTickExp.total} (${(100*cTickExp.hit/cTickExp.total).toFixed(1)}%)`);
console.log(`介绍 SPOT_DETAILS : ${cDetExp.hit}/${cDetExp.total} (${(100*cDetExp.hit/cDetExp.total).toFixed(1)}%)`);
console.log(`预约 BOOKING_TIPS : ${cBookExp.hit}/${cBookExp.total} (${(100*cBookExp.hit/cBookExp.total).toFixed(1)}%)`);
console.log(`信息 SPOT_INFO    : ${cInfoExp.hit}/${cInfoExp.total} (${(100*cInfoExp.hit/cInfoExp.total).toFixed(1)}%)`);
console.log("");
console.log("── 值结构形状（抽查）──");
console.log("SPOT_TICKETS 值形状:", [...valueShapes(TICKETS).entries()]);
console.log("SPOT_DETAILS 值形状:", [...valueShapes(DETAILS).entries()]);
console.log("BOOKING_TIPS 值形状:", [...valueShapes(BOOKING).entries()]);
console.log("SPOT_INFO 值形状:", [...valueShapes(INFO).entries()]);
console.log("");
console.log("── 是否含「链接」类字段 / 文本 ──");
for (const kw of KEYWORDS) {
  const a = scanForKeyword(TICKETS, kw), b = scanForKeyword(DETAILS, kw), c = scanForKeyword(BOOKING, kw), d = scanForKeyword(INFO, kw);
  const tot = a.n + b.n + c.n + d.n;
  if (tot) console.log(`关键词「${kw}」命中: TICKETS ${a.n} / DETAILS ${b.n} / BOOKING ${c.n} / INFO ${d.n}`);
}
console.log("");
console.log("── 抽样：门票样例 ──");
for (const [n, v] of cTickExp.samples) console.log("  ", n, "=>", JSON.stringify(v));
console.log("── 抽样：介绍样例 ──");
for (const [n, v] of cDetExp.samples) console.log("  ", n, "=>", JSON.stringify(v).slice(0, 120));
console.log("── 抽样：预约样例 ──");
for (const [n, v] of cBookExp.samples) console.log("  ", n, "=>", JSON.stringify(v).slice(0, 120));
console.log("── 抽样：信息样例 ──");
for (const [n, v] of cInfoExp.samples) console.log("  ", n, "=>", JSON.stringify(v).slice(0, 120));
