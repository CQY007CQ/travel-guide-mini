// 一次性审计：用 v1.19.156 已验证规则扫描全量景点坐标，找出仍越界的（应已被 SPOT_COORD_FIX 覆盖）。
// 规则：距所属城心 >300km 且落点省份≠城市所在省，或距城心 >1200km → 视为错位。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const hav = (a, b) => {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
};

// 城市中心 + 省份 索引
const centers = []; // [name, [lat,lon], prov]
for (const c in D.CITY_COORDS) {
  const cc = D.CITY_COORDS[c];
  if (Array.isArray(cc) && cc.length >= 2) centers.push([c, [cc[0], cc[1]], D.CITY2PROV[c]]);
}
const nearestProv = (lat, lon) => {
  let best = null, bd = 1e9;
  for (const [n, c, p] of centers) { const d = hav([lat, lon], c); if (d < bd) { bd = d; best = p; } }
  return [best, bd];
};

let flagged = 0, total = 0;
const out = [];
for (const city in D.SPOT_COORDS) {
  const cc = D.CITY_COORDS[city];
  if (!Array.isArray(cc) || cc.length < 2) continue;
  const cityProv = D.CITY2PROV[city];
  for (const row of D.SPOT_COORDS[city]) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const lat = +row[1], lon = +row[2];
    if (!isFinite(lat) || !isFinite(lon)) continue;
    total++;
    const dOwn = hav([lat, lon], cc);
    const [prov, dNearest] = nearestProv(lat, lon);
    const mis = (dOwn > 300 && prov && prov !== cityProv) || dOwn > 1200;
    if (mis) { flagged++; out.push({ city, name: row[0], lat, lon, dOwn, prov, dNearest, cityProv }); }
  }
}
console.log("扫描景点总数:", total, "| 越界数:", flagged);
for (const o of out.slice(0, 40)) {
  console.log(`  ${o.city}·${o.name} 距城心${o.dOwn}km 落点省=${o.prov}(最近城${o.dNearest}km) 城市省=${o.cityProv}`);
}
