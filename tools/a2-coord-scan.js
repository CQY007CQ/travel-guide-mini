// A2 无坐标统计：对每个 CITIES.experiences 用真实 getSpotCoord 判定
// approx:false = 真坐标可直达；approx:"city" = 城锚兜底（市中心真坐标，非景点位）；null = 完全无法定位
const D = require("../utils/data.js");
const P = require("../utils/planner.js");

const rows = [];
let realN = 0, cityN = 0, none = 0;
for (const cityObj of D.CITIES) {
  const cn = cityObj.name;
  (cityObj.experiences || []).forEach(x => {
    const n = String(x.name || "").trim();
    if (!n) return;
    const r = P.getSpotCoord(cn, n);
    const kind = r === null ? "null" : (r.approx === false ? "real" : "city");
    rows.push({ city: cn, n, kind });
    if (kind === "real") realN++;
    else if (kind === "city") cityN++;
    else none++;
  });
}
console.log("CITIES.experiences 共 " + rows.length + " 条：精确坐标 " + realN + " / 城锚兜底 " + cityN + " / null " + none);
console.log("精确率: " + (realN / rows.length * 100).toFixed(1) + "% | 可达率(精确+城锚): " + ((realN + cityN) / rows.length * 100).toFixed(1) + "%\n");

const fakeList = rows.filter(r => r.kind === "city");
console.log("◆ 城锚兜底（有城市锚点、缺景点精确坐标）共 " + fakeList.length + " 条：");
const byC = {};
fakeList.forEach(r => { byC[r.city] = byC[r.city] || []; byC[r.city].push(r.n); });
Object.keys(byC).sort((a, b) => byC[b].length - byC[a].length).forEach(c => {
  console.log("  [" + c + " ×" + byC[c].length + "] " + byC[c].join(" / "));
});

console.log("\n◆ null（完全无法定位）共 " + none + " 条：");
rows.filter(r => r.kind === "null").forEach(r => console.log("  [" + r.city + "] " + r.n));
