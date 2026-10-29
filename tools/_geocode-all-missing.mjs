// 一次性：为全库缺坐标景点补真实坐标（geocode/geo，合规独立配额）
// 输出合并进 tools/v201-official-coords.js 的 COORDS_ADD，供 _apply-safe 合并。
import fs from "fs";
import zlib from "zlib";
import { isCoveredByName } from "./lib-near-dup.mjs";

const keys = fs.readFileSync("tools/geocode.keys", "utf8").split(/\r?\n/).map(s => s.trim()).filter(s => /^[a-zA-Z0-9]{28,40}$/.test(s));
if (!keys.length) { console.error("无可用 key"); process.exit(1); }

const PACKED = "subdata/data/data-packed.js";
const raw = fs.readFileSync(PACKED, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));

const CITY_COORDS = D.CITY_COORDS || {};
const SPOT_COORDS = D.SPOT_COORDS || {};
const have = new Set();
for (const cn in SPOT_COORDS) for (const x of (SPOT_COORDS[cn] || [])) if (x && x[0]) have.add(cn + "\u0000" + x[0]);

// 收集缺坐标景点（v1.20 重构后字段，替代已移除的 CITIES[].experiences）
// 来源：EXTRA_SPOTS*/CITY_LANDMARKS*/SPOT_DETAILS_BY_CITY；拼音键经 CITIES.id->@A 解析为城名。
const jobs = [];
const seen = new Set();
let fuzzyCovered = 0;   // 已由「名称包含」规则覆盖、无需补坐标的条目数

// 拼音 -> 中文城名（CITIES.id 为拼音，@A 为中文名）
const PY2CN = {};
for (const c of (D.CITIES || [])) { if (c && c.id && c["@A"]) PY2CN[c.id] = c["@A"]; }

function pushJob(city, name) {
  if (!city || !name) return;
  const k = city + "\u0000" + name;
  if (have.has(k) || seen.has(k)) return;
  // 与产品 getSpotCoord 的 fuzzy() 对齐：同城内已有名称互相包含（≥2 字）即视为已覆盖。
  // 不加这一步，「九寨沟风景名胜区」这类全称会永远被判缺失 → geocode 回来又被
  // _apply-safe 的近似重复守卫丢弃 → 每日任务连续多天空转（实测连续 3 天均「命中 46」）。
  if (isCoveredByName(SPOT_COORDS[city], name)) { fuzzyCovered++; return; }
  seen.add(k);
  jobs.push({ city, name });
}

// 1) EXTRA_SPOTS / EXTRA_SPOTS2..5：拼音键 -> 城名
for (const f of ["EXTRA_SPOTS", "EXTRA_SPOTS2", "EXTRA_SPOTS3", "EXTRA_SPOTS4", "EXTRA_SPOTS5"]) {
  const obj = D[f];
  if (!obj) continue;
  for (const pk in obj) {
    const cn = PY2CN[pk]; if (!cn) continue;
    for (const nm of (obj[pk] || [])) pushJob(cn, nm);
  }
}
// 2) CITY_LANDMARKS / CITY_LANDMARKS_EXTRA / _EXTRA2..6：城名键，数组
for (const f of ["CITY_LANDMARKS", "CITY_LANDMARKS_EXTRA", "CITY_LANDMARKS_EXTRA2", "CITY_LANDMARKS_EXTRA3", "CITY_LANDMARKS_EXTRA4", "CITY_LANDMARKS_EXTRA5", "CITY_LANDMARKS_EXTRA6"]) {
  const obj = D[f];
  if (!obj) continue;
  for (const cn in obj) for (const nm of (obj[cn] || [])) pushJob(cn, nm);
}
// 3) SPOT_DETAILS_BY_CITY：城名键，内层 key 即景点名
{
  const obj = D.SPOT_DETAILS_BY_CITY;
  if (obj) for (const cn in obj) for (const nm of Object.keys(obj[cn] || {})) pushJob(cn, nm);
}

console.log("全库缺坐标景点:", jobs.length, "| 名称已覆盖(无需补):", fuzzyCovered, "| key 数:", keys.length);
// 零预算时打印待办清单，便于人工判断这些是真实景点还是行程用语（诊断用，不消耗配额）
if (parseInt(process.argv[2] || "", 10) === 0) {
  jobs.forEach((j, i) => console.log("  [待补] " + (i + 1) + ". " + j.city + " / " + j.name));
}

const BUDGET = parseInt(process.argv[2] || "400", 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hav = (lat1, lng1, lat2, lng2) => {
  const R = 6371, dLa = (lat2 - lat1) * Math.PI / 180, dLo = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

let ki = 0, done = 0, hit = 0, fail = 0, over = 0;
const out = {};
for (const job of jobs) {
  if (done >= BUDGET) break;
  done++;
  const key = keys[ki % keys.length]; ki++;
  const cityHint = job.city.replace(/市|州|地区|盟|自治州/g, "");
  const url = "https://restapi.amap.com/v3/geocode/geo?key=" + key + "&address=" + encodeURIComponent(job.name) + "&city=" + encodeURIComponent(cityHint);
  let g = null;
  try {
    const j = await (await fetch(url)).json();
    if (j && j.status === "1" && Array.isArray(j.geocodes) && j.geocodes.length && j.geocodes[0].location) {
      const [lng, lat] = j.geocodes[0].location.split(",").map(Number);
      g = { lat, lng };
    } else if (j && (j.infocode === "10044" || j.infocode === "10003")) { over++; await sleep(300); }
  } catch (e) { await sleep(300); }
  if (g) {
    const anchor = CITY_COORDS[job.city];
    if (!anchor || hav(g.lat, g.lng, anchor[0], anchor[1]) <= 150) {
      if (!out[job.city]) out[job.city] = [];
      out[job.city].push([job.name, +g.lat.toFixed(3), +g.lng.toFixed(3)]);
      hit++;
    } else fail++;
  } else fail++;
  if (done % 50 === 0) process.stderr.write(`处理 ${done}/${jobs.length} 命中 ${hit} 未命中 ${fail} 超限 ${over}\n`);
  await sleep(120);
}
console.log("本次调用", done, "| 命中", hit, "| 未命中", fail, "| 超限", over);

// 合并进 v201
const V201 = "tools/v201-official-coords.js";
let v = {};
try { v = JSON.parse(fs.readFileSync(V201, "utf8").replace(/^[^=]*=\s*/, "").replace(/;\s*$/, "")); } catch (e) { v = {}; }
const COORDS_ADD = v.COORDS_ADD || {};
// 快照：合并前各城已有哪些景点名，用于算出「净新增」。
// 起因：只报"命中 N"会误导自动化 —— 命中多但净新增 0 时，任务仍会走完整打包上传，
// 每天白白升一个版本号（实测：命中 46 / 净新增 0 连续多天）。
const _beforeNames = new Map();
for (const cn in COORDS_ADD) _beforeNames.set(cn, new Set((COORDS_ADD[cn] || []).map((x) => x && x[0])));
for (const cn in out) {
  if (!COORDS_ADD[cn]) COORDS_ADD[cn] = [];
  const seenNames = new Set(COORDS_ADD[cn].map(x => x && x[0]));
  for (const e of out[cn]) if (!seenNames.has(e[0])) { seenNames.add(e[0]); COORDS_ADD[cn].push(e); }
}
fs.writeFileSync(V201, "// 自动生成：官方名录/全库缺坐标景点补坐标（geocode/geo）\nmodule.exports = " + JSON.stringify({ COORDS_ADD }, null, 1) + ";\n", "utf8");
let netNew = 0;
for (const cn in COORDS_ADD) {
  const before = _beforeNames.get(cn) || new Set();
  for (const e of (COORDS_ADD[cn] || [])) if (e && e[0] && !before.has(e[0])) netNew++;
}
console.log("已合并写入", V201, "| COORDS_ADD 城市数:", Object.keys(COORDS_ADD).length, "| 净新增:", netNew);
