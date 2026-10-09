// 把 amap-spots-cache.json（真实 AMap POI：name+lat+lon+...）转成 import-official-list.mjs 的规范化源。
// 坐标已是高德 GCJ-02，无需 --wgs84。
import fs from "fs";
import zlib from "zlib";
// v1.20：数据包已拆到分包（utils/data-packed.js 不再存在，保留兼容回退）
const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const nameToCity = {}; D.CITIES.forEach(c => nameToCity[c.name] = c);
const CITY_COORDS = D.CITY_COORDS || {};
const STRIP = /[市州区县盟地区]/g;
function norm(n) { return String(n || "").replace(STRIP, "").trim(); }
function resolveByName(q) {
  if (!q) return null;
  if (nameToCity[q]) return nameToCity[q];
  const nq = norm(q);
  for (const cn in nameToCity) if (norm(cn) === nq) return nameToCity[cn];
  for (const cn in nameToCity) if (cn.includes(q) || q.includes(cn)) return nameToCity[cn];
  return null;
}
function nearest(lat, lng) {
  let best = null, bd = Infinity;
  for (const cn in CITY_COORDS) { const [a, b] = CITY_COORDS[cn]; const d = Math.hypot(a - lat, b - lng); if (d < bd) { bd = d; best = cn; } }
  return bd <= 3 ? best : null; // 约 300km 内才认
}
const cache = JSON.parse(fs.readFileSync("tools/amap-spots-cache.json", "utf8"));
const out = [];
for (const key of Object.keys(cache)) {
  const q = key.split("|")[1];
  const cityFromQuery = resolveByName(q);
  for (const p of (cache[key] || [])) {
    if (!p || !p.name || typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    let city = cityFromQuery ? cityFromQuery.name : null;
    if (!city) city = nearest(p.lat, p.lon);
    if (!city) continue;
    out.push({ name: p.name.trim(), city, province: (nameToCity[city] && nameToCity[city].province) || "", lng: p.lon, lat: p.lat });
  }
}
fs.writeFileSync("tools/_dl/cache_spots.json", JSON.stringify(out, null, 1));
console.log("cache -> 规范化源条目:", out.length);
