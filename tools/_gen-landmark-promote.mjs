// 把既有真实地标池（LM_ADD / CITY_LANDMARKS / EXTRA_SPOTS）转正进 experiences。
// 这些是高德真实抓取的 POI 名，非捏造；merge 的 EXP_REPLACE(from:"") 会幂等追加（同名已存在则跳过）。
// 同时记录缺少精确坐标的地标，供后续 geocode/geo 补全。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const P = req("./utils/planner.js");
const T = req("./utils/travel.js");

const pools = ["CITY_LANDMARKS","CITY_LANDMARKS_EXTRA","CITY_LANDMARKS_EXTRA2","CITY_LANDMARKS_EXTRA3","CITY_LANDMARKS_EXTRA4","CITY_LANDMARKS_EXTRA5","CITY_LANDMARKS_EXTRA6","EXTRA_SPOTS","EXTRA_SPOTS2","EXTRA_SPOTS3","EXTRA_SPOTS4","EXTRA_SPOTS5","PROVINCE_LANDMARKS"];
// v1.19.7：高德每轮新抓的 POI 先进 v199-amap-spots.js 的 LM_ADD，再由 _apply-safe 并入数据池。
// 此前本脚本只读 data.js 存量池，导致「抓到了却没转正」（抓 1460 个、体验 0 增长）。
// 这里显式把 LM_ADD 也作为转正来源（幂等：已存在的精确名/清洗名会被跳过）。
let amapLM = {};
try { amapLM = (req("./tools/v199-amap-spots.js") || {}).LM_ADD || {}; } catch (e) {}
const amapCities = Object.keys(amapLM).length;
if (amapCities) console.log("并入高德新抓取 LM_ADD：", amapCities, "城");

const nameToCity = {}, idToCity = {};
D.CITIES.forEach(c => { nameToCity[c.name] = c; if (c.id) idToCity[c.id] = c; });
function resolve(k){
  if (nameToCity[k]) return nameToCity[k];
  if (idToCity[k]) return idToCity[k];
  const lk = k.toLowerCase();
  for (const x in nameToCity) if (x.toLowerCase() === lk) return nameToCity[x];
  for (const x in idToCity) if (x.toLowerCase() === lk) return idToCity[x];
  return null;
}
const expExact = {}, expClean = {};
D.CITIES.forEach(c => {
  expExact[c.name] = new Set();
  expClean[c.name] = new Set();
  (c.experiences || []).forEach(e => {
    const n = (typeof e === "string" ? e : e.name || e.t || "").trim();
    expExact[c.name].add(n);
    expClean[c.name].add(T.cleanSpotName(n));
  });
});
const addedClean = {}; // 本次运行已加名的清洗名，避免同名不同写法被加两次

const sources = pools.map(p => D[p] || {});
if (amapCities) sources.push(amapLM);

const EXP_REPLACE = {};
const noCoord = [];
let added = 0;
sources.forEach(v => {
  Object.keys(v).forEach(ck => {
    const city = resolve(ck); if (!city) return;
    (v[ck] || []).forEach(nm => {
      if (!nm) return;
      const t = String(nm).trim();
      const ck = T.cleanSpotName(t);
      // 跳过：① 已存在的精确名 ② 已存在的清洗名（纯阳宫 vs 纯阳宫（山西省艺术博物馆）按清洗名算同一景点）
      //       ③ 本次运行内已加过的清洗名（防止多库里同名不同写法被重复转正）
      if ((expExact[city.name] || new Set()).has(t)) return;
      if ((expClean[city.name] || new Set()).has(ck)) return;
      if ((addedClean[city.name] || new Set()).has(ck)) return;
      const si = D.SPOT_INFO ? D.SPOT_INFO[nm] : null;
      let note = "当地知名景点";
      if (si && typeof si === "object") {
        const parts = [];
        if (si.rating) parts.push("评分" + si.rating);
        if (si.openTime) parts.push("开放" + si.openTime);
        if (parts.length) note = parts.join("·");
      }
      EXP_REPLACE[city.name] = EXP_REPLACE[city.name] || [];
      EXP_REPLACE[city.name].push({ from: "", to: { name: t, period: "全天", note } });
      added++;
      if (!addedClean[city.name]) addedClean[city.name] = new Set();
      addedClean[city.name].add(ck);
      const g = P.getSpotCoord(city.name, t);
      if (!(g && g.approx === false)) noCoord.push({ city: city.name, name: t });
    });
  });
});

const out = "// 自动生成：真实地标池转正进 experiences（高德真实 POI，非捏造）\nmodule.exports = {\n  EXP_REPLACE: " + JSON.stringify(EXP_REPLACE, null, 1) + "\n};\n";
fs.writeFileSync(path.join(process.cwd(), "tools", "v198-landmark-promote.js"), out);
fs.writeFileSync(path.join(process.cwd(), "tools", "_promote-no-coord.json"), JSON.stringify(noCoord, null, 1));
console.log("生成补丁 v198-landmark-promote.js：新增体验", added, "覆盖城", Object.keys(EXP_REPLACE).length);
console.log("其中缺精确坐标（供 geocode 补全）：", noCoord.length);
