// v1.19.79 · 同名「X市」↔「X」归并
// 库里同时有「安康」(有数据) 与「安康市」(零景点) 这类重名条目，用户选/搜「安康市」会生成空白。
// 在名称解析总闸 findCity 落地 canonCityName，并在 citiesOf 选择器去重，外加若干按名取数点的防御性归一。
// 写法遵循项目铁律：每条替换「恰好命中 1 次」断言，避免同一文件多改静默回滚。
import fs from "fs";
import path from "path";

const SRC = path.join("tools", "_src-backup", "travel.js");
let s = fs.readFileSync(SRC, "utf8");
const before = s;

const reps = [
  {
    id: "canon+findCity",
    old: `  return _cityIdx;
};
// 同一行程里 findCity 会被反复调用（每日每项都查），结果缓存避免重复解析
const _findCache = new Map();
function findCity(name, province) {
 if (!name) return null;
 const ck = name + "|" + (province || "");
 if (_findCache.has(ck)) return _findCache.get(ck);
 let res = null;
 const prov = province || (D.CITY2PROV && D.CITY2PROV[name]);
 try {
  const full = P.findCity(name, prov);
  if (full && full.experiences && full.experiences.length) res = full;
 } catch (e) {}
 if (!res) res = _cityIndex().get(name) || null;
 if (_findCache.size > 400) _findCache.clear();   // 防多城切换后无限增长
 _findCache.set(ck, res);
 return res;
}`,
    neu: `  return _cityIdx;
};
// v1.19.79：同名「X市」↔「X」归并。
// 库里同时有「安康」(有数据) 与「安康市」(零景点) 这类重名条目，用户选/搜「安康市」会生成空白。
// 统一把名称收敛到「带数据的那个」变体：优先原样(有数据) → 否则剥「市」 → 再否则补「市」。
function canonCityName(name) {
  if (!name || typeof name !== "string") return name;
  const idx = _cityIndex();
  const hasData = (n) => { const c = idx.get(n); return !!(c && Array.isArray(c.experiences) && c.experiences.length); };
  if (hasData(name)) return name;
  if (name.endsWith("市")) {
    const s = name.slice(0, -1);
    if (idx.has(s)) return s;
  }
  const withSuffix = name + "市";
  if (idx.has(withSuffix) && hasData(withSuffix)) return withSuffix;
  return name;
}
// 同一行程里 findCity 会被反复调用（每日每项都查），结果缓存避免重复解析
const _findCache = new Map();
function findCity(name, province) {
 if (!name) return null;
 const canon = canonCityName(name);
 const ck = canon + "|" + (province || "");
 if (_findCache.has(ck)) return _findCache.get(ck);
 let res = null;
 const prov = province || (D.CITY2PROV && D.CITY2PROV[canon]);
 try {
  const full = P.findCity(canon, prov);
  if (full && full.experiences && full.experiences.length) res = full;
 } catch (e) {}
 if (!res) res = _cityIndex().get(canon) || null;
 if (_findCache.size > 400) _findCache.clear();   // 防多城切换后无限增长
 _findCache.set(ck, res);
 return res;
}`,
  },
  {
    id: "citiesOf-dedupe",
    old: ` const names = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || [];
 const guide = new Set((Array.isArray(D.CITIES) ? D.CITIES : []).map(c => c.name));
 const out = names
  .map(name => ({ name, province: prov, guide: guide.has(name) }));`,
    neu: ` const names = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || [];
 const guide = new Set((Array.isArray(D.CITIES) ? D.CITIES : []).map(c => c.name));
 // v1.19.79：同名「X市」归并 —— 选择列表只展示带数据的 canonical 名，避免用户选到零景点「X市」
 const out = [];
 const _seen = new Set();
 for (const name of names) {
  const cn = canonCityName(name);
  if (_seen.has(cn)) continue;
  _seen.add(cn);
  out.push({ name: cn, province: prov, guide: guide.has(cn) });
 }`,
  },
  {
    id: "citiesOf-limited",
    old: ` (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => {
  if (c && c.limited && c.province === prov && !names.includes(c.name)) {
   out.push({ name: c.name, province: prov, guide: true, limited: true });
  }
 });`,
    neu: ` (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => {
  if (c && c.limited && c.province === prov && !_seen.has(c.name)) {
   _seen.add(c.name);
   out.push({ name: c.name, province: prov, guide: true, limited: true });
  }
 });`,
  },
  {
    id: "foodSpotsFor",
    old: `function foodSpotsFor(cityName) {
 if (!cityName) return [];
 return (D.FOOD_SPOTS && D.FOOD_SPOTS[cityName]) || [];
}`,
    neu: `function foodSpotsFor(cityName) {
 if (!cityName) return [];
 return (D.FOOD_SPOTS && D.FOOD_SPOTS[canonCityName(cityName)]) || [];
}`,
  },
  {
    id: "spotTagOf-detail",
    old: ` const detail = (D.SPOT_DETAILS && D.SPOT_DETAILS[cityName] && D.SPOT_DETAILS[cityName][n]);`,
    neu: ` const _cn = canonCityName(cityName);
 const detail = (D.SPOT_DETAILS && D.SPOT_DETAILS[_cn] && D.SPOT_DETAILS[_cn][n]);`,
  },
  {
    id: "nearbyCityOf",
    old: `function nearbyCityOf(cityName) {
 try {
  const nm = String(cityName || "");
  if (!nm || !findCity(nm)) return "";
  const g = P.getCoord(nm);`,
    neu: ` function nearbyCityOf(cityName) {
 try {
  const nm = canonCityName(String(cityName || ""));
  if (!nm || !findCity(nm)) return "";
  const g = P.getCoord(nm);`,
  },
  {
    id: "APP_VER",
    old: `const APP_VER = "1.19.79";`,
    neu: `const APP_VER = "1.19.79";`,
  },
];

let ok = true;
for (const r of reps) {
  const n = s.split(r.old).length - 1;
  if (n !== 1) {
    console.log(`  ✗ [${r.id}] 命中 ${n} 次（须恰好 1 次）`);
    ok = false;
  } else {
    s = s.replace(r.old, r.neu);
    console.log(`  ✓ [${r.id}] 命中 1 次`);
  }
}
if (!ok) {
  console.log("补丁未全部命中，已中止，未写回");
  process.exit(1);
}
if (s === before) {
  console.log("⚠ 内容未变化（可能已打过）");
  process.exit(0);
}
fs.writeFileSync(SRC, s, "utf8");
console.log("\n✅ 已写回 tools/_src-backup/travel.js（7 处替换全部恰好命中 1 次）");
