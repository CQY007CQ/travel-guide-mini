// v1.19.173 QA 全量数据正确性探针（一次性，不入 allcheck）
// 注意：experiences 存于各城市对象 c.experiences（非 DATA 顶层）；价格"参考价/约¥"为合规写法，不计入失败。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail++; };

// 1) 基础体量
ok(D.CITIES.length >= 232, "CITIES=" + D.CITIES.length + " (≥232)");
const expCount = D.CITIES.reduce((s, c) => s + (c.experiences ? c.experiences.length : 0), 0);
ok(expCount >= 1300, "experiences(各城累加)=" + expCount + " (≥1300)");
ok(Object.keys(D.CITY2PROV).length > 300, "CITY2PROV 覆盖城市数=" + Object.keys(D.CITY2PROV).length);

// 2) 城市中心坐标全部落在合理中国范围
const CN = { latMin: 16, latMax: 54, lonMin: 73, lonMax: 135 };
let badCenter = 0;
for (const c in D.CITY_COORDS) {
  const v = D.CITY_COORDS[c];
  if (!Array.isArray(v) || v.length < 2) { badCenter++; continue; }
  if (v[0] < CN.latMin || v[0] > CN.latMax || v[1] < CN.lonMin || v[1] > CN.lonMax) badCenter++;
}
ok(badCenter === 0, "城市中心坐标越界数=" + badCenter);

// 3) 景点坐标非法值扫描（NaN / 0,0 / 极端值）
let badSpot = 0, totalSpots = 0;
for (const city in D.SPOT_COORDS) {
  for (const r of D.SPOT_COORDS[city]) {
    if (!Array.isArray(r) || r.length < 3) continue;
    totalSpots++;
    const lat = +r[1], lon = +r[2];
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0) ||
        lat < CN.latMin || lat > CN.latMax || lon < CN.lonMin || lon > CN.lonMax) badSpot++;
  }
}
ok(badSpot === 0, "景点非法坐标数=" + badSpot + " / 总计 " + totalSpots);

// 4) 应急医院闸门：名含「医院」且距城心≤25km（v1.19.168 锚点法）
const hav = (a, b) => { const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b[0]-a[0]), dLon = toR(b[1]-a[1]);
  const s = Math.sin(dLat/2)**2 + Math.cos(toR(a[0]))*Math.cos(toR(b[0]))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(s), Math.sqrt(1-s)); };
let hBad = 0, hTotal = 0;
for (const city in D.HOSPITALS) {
  const cc = D.CITY_COORDS[city]; if (!Array.isArray(cc) || cc.length < 2) continue;
  for (const h of D.HOSPITALS[city]) {
    hTotal++;
    if (!/医院/.test(h.n)) hBad++;
    else if (typeof h.lat === "number" && typeof h.lon === "number" && hav([h.lat,h.lon], cc) > 25) hBad++;
  }
}
ok(hBad === 0, "应急医院闸门违例=" + hBad + " / 总计 " + hTotal);

// 5) v1.19.155 误导措辞回潮扫描（仅计真正回归；价格"参考价/约¥"与体验备注"仅供参考"为合规/诚实写法，不计入失败）
const REGRESS = /参考停留|参考数据不足|比常见参考|明显超出参考|略超参考|名店参考|中心参考|门票预估|门票估算|（参考）/;
let txtBad = 0;
const scan = (o) => {
  if (Array.isArray(o)) o.forEach(scan);
  else if (o && typeof o === "object") for (const k in o) scan(o[k]);
  else if (typeof o === "string") { if (REGRESS.test(o)) txtBad++; }
};
scan(D.CITIES); scan(D.FOOD_SPOTS); scan(D.HOTELS || {}); scan(D.SPOT_INFO || {});
ok(txtBad === 0, "数据中 v1.19.155 误导措辞回潮数=" + txtBad);

// 5b) 信息项（不判失败）：体验备注里的"仅供参考"为诚实来源标注（非应急页套话），仅统计供审阅
let refOnly = 0;
const scanRef = (o) => {
  if (Array.isArray(o)) o.forEach(scanRef);
  else if (o && typeof o === "object") for (const k in o) scanRef(o[k]);
  else if (typeof o === "string" && /仅供参考/.test(o)) refOnly++;
};
scanRef(D.CITIES); scanRef(D.FOOD_SPOTS); scanRef(D.HOTELS || {}); scanRef(D.SPOT_INFO || {});
console.log("  ℹ 体验备注中『仅供参考』(诚实来源标注，非回归)=" + refOnly);

console.log(fail ? ("\n❌ 数据正确性探针失败 " + fail + " 项") : "\n✅ 数据正确性探针全部通过");
process.exit(fail ? 1 : 0);
