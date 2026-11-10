// 一次性：湖北三直管市（仙桃/天门/潜江）城市坐标 + 19 个官方景点坐标
// 只用高德 geocode/geo（独立配额，合规）；输出 tools/data/v202-hubei-cities.js 补丁
import fs from "fs";

const KEYS = (() => { try { return fs.readFileSync("tools/geocode.keys", "utf8"); } catch (e) { return ""; } })()
  .split(/\r?\n/).map(s => s.trim()).filter(s => /^[a-zA-Z0-9]{28,40}$/.test(s));
if (!KEYS.length) { console.error("无可用 key"); process.exit(1); }

const SPOTS = [
  ["仙桃", "仙桃梦里水乡文化旅游区"], ["仙桃", "仙桃市沔阳小镇景区"],
  ["仙桃", "仙桃市荆楚云天旅游区"], ["仙桃", "仙桃市九合兰园生态旅游区"],
  ["仙桃", "仙桃市沔州百万花海景区"], ["仙桃", "仙桃市沔城风景名胜区"],
  ["天门", "天门市茶圣故里园景区"], ["天门", "天门市胡家花园景区"],
  ["天门", "天门市杨林方舟生态庄园景区"], ["天门", "天门市海龙岛景区"],
  ["天门", "天门市长寿山原村景区"], ["天门", "天门市七屋岭旅游景区"],
  ["天门", "天门南湖旅游区"], ["天门", "天门彭家垴红色旅游区"],
  ["潜江", "潜江龙湾国家考古遗址公园"], ["潜江", "潜江曹禺文化旅游区"],
  ["潜江", "拖船埠红色旅游景区"], ["潜江", "潜半夏中医药文化景区"],
  ["潜江", "潜江市广华水杉园"]
];
const CITIES = ["仙桃", "天门", "潜江"];

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ki = 0;
async function geo(address, cityHint) {
  for (let t = 0; t < KEYS.length * 2; t++) {
    const key = KEYS[ki % KEYS.length]; ki++;
    const url = "https://restapi.amap.com/v3/geocode/geo?key=" + key + "&address=" + encodeURIComponent(address) + "&city=" + encodeURIComponent(cityHint || "");
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (j && j.status === "1" && Array.isArray(j.geocodes) && j.geocodes.length && j.geocodes[0].location) {
        const [lng, lat] = j.geocodes[0].location.split(",").map(Number);
        return { lat, lng };
      }
      if (j && j.infocode === "10044") { await sleep(300); continue; }
      return null;
    } catch (e) { await sleep(300); }
  }
  return null;
}

const out = {
  CITY2PROV_ADD: {}, PROVINCE_CITIES_ADD: {}, CITY_COORDS_ADD: {},
  CITY_PATCH: [], COORDS_ADD: {}
};
const cityCoords = {};
for (const c of CITIES) {
  const g = await geo(c + "市", "湖北");
  if (g) cityCoords[c] = g;
  out.CITY2PROV_ADD[c] = "湖北";
  out.PROVINCE_CITIES_ADD["湖北"] = CITIES;
  await sleep(120);
}
const spotCoords = {};
for (const [city, name] of SPOTS) {
  const g = await geo(name, city);
  if (g) { if (!spotCoords[city]) spotCoords[city] = []; spotCoords[city].push([name, g.lat, g.lng]); }
  await sleep(120);
}
for (const c of CITIES) if (cityCoords[c]) out.CITY_COORDS_ADD[c] = [cityCoords[c].lat, cityCoords[c].lng];
out.COORDS_ADD = spotCoords;
for (const c of CITIES) {
  const spots = SPOTS.filter(([cc]) => cc === c).map(([, n]) => n);
  out.CITY_PATCH.push({
    name: c, province: "湖北", region: "华中", climate: "temperate", cost: "low", id: "hubei-" + c,
    areas: [{ name: "市中心", note: "住宿餐饮集中，去周边景点方便" }],
    experiences: spots.map(n => ({ name: n, period: "全天", note: "官方 A 级景区，建议预留 2-4 小时" }))
  });
}
fs.writeFileSync("tools/data/v202-hubei-cities.js",
  "// 自动生成（geocode/geo 合规）：湖北三直管市补丁\nmodule.exports = " + JSON.stringify(out, null, 1) + ";\n", "utf8");
console.log("城市坐标:", JSON.stringify(cityCoords));
console.log("景点坐标命中:", Object.keys(spotCoords).map(k => k + ":" + spotCoords[k].length).join(" "));
console.log("已写 tools/data/v202-hubei-cities.js");
