import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const DATA = req("./utils/data.js");

// 中国（含海南三沙）宽松边界
const B = { latMin: 3, latMax: 54, lonMin: 73, lonMax: 136 };
function inBounds(lat, lon) { return lat >= B.latMin && lat <= B.latMax && lon >= B.lonMin && lon <= B.lonMax; }
function hav(a, b, c, d) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (c - a) * toR, dLon = (d - b) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const round = (n) => Math.round(n * 10) / 10;
const fmt = (arr) => arr.slice(0, 25).map((x) => "  - " + x).join("\n");

let issues = 0;
const report = {};
function add(cat, msg) { issues++; (report[cat] ||= []).push(msg); }

// ── 1. CITIES 基础完整性 ──
const cities = DATA.CITIES || [];
const seenId = {}, seenName = {};
const validClimate = new Set(Object.keys(DATA.CLOTH || {})); // 6
const validCost = new Set(Object.keys(DATA.BUDGETS || {})); // low/mid/high
const validRegion = new Set(Object.keys(DATA.REGION_DEFAULT || {})); // 7
const provSet = new Set(DATA.PROVINCES || []);
for (const c of cities) {
  if (!c || typeof c !== "object") { add("CITY_BAD", "非对象元素"); continue; }
  if (seenId[c.id]) add("DUP_ID", c.id);
  if (seenName[c.name]) add("DUP_NAME", c.name);
  seenId[c.id] = 1; seenName[c.name] = 1;
  if (!c.id) add("NO_ID", c.name || "?");
  if (!c.name) add("NO_NAME", c.id || "?");
  if (!c.province) add("NO_PROV", c.name);
  else if (!provSet.has(c.province)) add("BAD_PROV", `${c.name} -> ${c.province}`);
  if (!validClimate.has(c.climate)) add("BAD_CLIMATE", `${c.name} climate=${c.climate}`);
  if (!validCost.has(c.cost)) add("BAD_COST", `${c.name} cost=${c.cost}`);
  if (!validRegion.has(c.region)) add("BAD_REGION", `${c.name} region=${c.region}`);
  if (!c.best || !String(c.best).trim()) add("NO_BEST", c.name);
  if (!Array.isArray(c.experiences)) add("EXP_NOTARR", c.name);
}

// ── 2. CITY_COORDS 边界 + 缺失 + 重复 ──
const cc = DATA.CITY_COORDS || {};
const coordByCity = {}; // city name/id -> [lat,lon]
const coordDup = {};
for (const [k, v] of Object.entries(cc)) {
  if (!Array.isArray(v) || v.length < 2) { add("CC_BAD", k); continue; }
  const [lat, lon] = v;
  if (typeof lat !== "number" || typeof lon !== "number") { add("CC_NAN", k); continue; }
  if (!inBounds(lat, lon)) add("CC_OOB", `${k} (${lat},${lon})`);
  const key = round(lat) + "," + round(lon);
  (coordDup[key] ||= []).push(k);
  // 映射到城市（按 name 或 id）
  const hit = cities.find((c) => c.name === k || c.id === k);
  if (hit) coordByCity[hit.name] = v;
}
for (const [k, arr] of Object.entries(coordDup)) {
  if (arr.length > 1) add("CC_DUPCOORD", `${k} <= ${arr.join("/")}`);
}
// 城市缺坐标
for (const c of cities) {
  if (!coordByCity[c.name]) add("NO_COORD", c.name);
}

// ── 3. SPOT_COORDS 边界 + 离城距离异常 ──
const sc = DATA.SPOT_COORDS || {};
for (const [city, list] of Object.entries(sc)) {
  if (!Array.isArray(list)) { add("SC_BAD", city); continue; }
  const center = coordByCity[city];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 3) { add("SC_ROW", `${city} ${JSON.stringify(row)}`); continue; }
    const [nm, lat, lon] = row;
    if (typeof lat !== "number" || typeof lon !== "number") { add("SC_NAN", `${city}/${nm}`); continue; }
    if (!inBounds(lat, lon)) add("SC_OOB", `${city}/${nm} (${lat},${lon})`);
    if (center) {
      const d = hav(center[0], center[1], lat, lon);
      if (d > 300) add("SC_FAR", `${city}/${nm} 离城 ${round(d)}km`);
    }
  }
}

// ── 4. 医院闸门（名含医院 + 距城中心≤25km）──
let hospTotal = 0, hospCities = 0;
try {
  const EM = req("./utils/emergency-data.js");
  const H = EM.HOSPITALS || EM.default?.HOSPITALS || {};
  for (const [city, list] of Object.entries(H)) {
    if (!Array.isArray(list)) continue;
    hospCities++;
    for (const h of list) {
      hospTotal++;
      const nm = h.n || h.name;
      if (!nm || !/医院/.test(nm)) add("HOSP_NOYIY", `${city}/${nm || "?"}`);
      const center = coordByCity[city] || cc[city];
      if (center && typeof h.lat === "number" && typeof h.lon === "number") {
        const d = hav(center[0], center[1], h.lat, h.lon);
        if (d > 25.5) add("HOSP_FAR", `${city}/${nm} 距中心 ${round(d)}km`);
      }
    }
  }
} catch (e) { add("HOSP_LOAD", e.message); }

// ── 5. FOOD_SPOTS 抽样结构 ──
const fs = DATA.FOOD_SPOTS || {};
let foodCities = Object.keys(fs).length, foodShopCount = 0, foodWithMenu = 0, foodWithRep = 0, foodWithNote = 0;
for (const [city, v] of Object.entries(fs)) {
  const shops = Array.isArray(v) ? v : (v && v.shops) || [];
  for (const s of shops) {
    foodShopCount++;
    if (s.menu && s.menu.length) foodWithMenu++;
    if (s.rep) foodWithRep++;
    if (s.note) foodWithNote++;
  }
}

// ── 6. SPOT_INFO / SPOT_TICKETS 空值 ──
const si = DATA.SPOT_INFO || {};
let siEmpty = 0;
for (const [k, v] of Object.entries(si)) {
  if (v == null || (typeof v === "string" && !v.trim()) || (typeof v === "object" && Object.keys(v).length === 0)) siEmpty++;
}

// ── 输出 ──
console.log("════════ 数据正确性审计 ══════════");
console.log(`CITIES=${cities.length}  CITY_COORDS=${Object.keys(cc).length}  SPOT_COORDS城市=${Object.keys(sc).length}`);
console.log(`医院: ${hospCities}城 / ${hospTotal}家  美食: ${foodCities}城 / ${foodShopCount}店 (menu=${foodWithMenu}, rep=${foodWithRep}, note=${foodWithNote})`);
console.log(`SPOT_INFO空值=${siEmpty}/${Object.keys(si).length}`);
console.log(`\n待复核问题总数: ${issues}`);
for (const [cat, arr] of Object.entries(report)) {
  console.log(`\n■ ${cat} (${arr.length})`);
  console.log(fmt(arr));
}
if (issues === 0) console.log("\n✅ 未发现数据正确性异常");
