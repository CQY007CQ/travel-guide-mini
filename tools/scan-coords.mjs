// v1.15.5 坐标可信度审计
// 背景：坐标多为「参考级估算值」（非地图 API 实测），精度在数百米~1-2km；个别城市锚点曾偏离市中心 9~21km。
// 本脚本做两层核查，输出需要人工/真实 API 复核的清单：
//   A. 城市锚点 vs 该城「市区型景点」坐标中位数（排除远郊山水/草原等）→ 发现锚点异常
//   B. 同城景点中，距离城市锚点异常远（>80km）的条目 → 疑似坐标给错或归属错误城市
// 用法: node tools/scan-coords.mjs
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const hav = (a, b) => {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const urbanRx = /公园|博物|街|古城|广场|寺|塔|馆|老城|步行/;
const farRx = /山$|峰|峡谷|草原|沙漠|森林|国家|地质|湿地|海岸|岛|湾|冰川|梯田|瀑布|溶洞|草原|胡杨/;

const anchorIssues = [], farIssues = [];
Object.keys(D.SPOT_COORDS).forEach(city => {
  const sc = (D.SPOT_COORDS[city] || []).filter(s => typeof s[1] === "number" && typeof s[2] === "number");
  const anchor = D.CITY_COORDS[city];
  if (!anchor) return;
  // A. 锚点 vs 市区型景点中位数
  const urban = sc.filter(s => urbanRx.test(s[0]) && !farRx.test(s[0]));
  if (urban.length >= 2) {
    const lats = urban.map(s => s[1]).sort((a, b) => a - b), lons = urban.map(s => s[2]).sort((a, b) => a - b);
    const med = [lats[Math.floor(lats.length / 2)], lons[Math.floor(lons.length / 2)]];
    const d = hav(anchor, med);
    if (d > 8) anchorIssues.push({ city, dist: +d.toFixed(1), n: urban.length });
  }
  // B. 距锚点异常远的景点
  sc.forEach(s => { const d = hav(anchor, [s[1], s[2]]); if (d > 80) farIssues.push({ city, spot: s[0], dist: +d.toFixed(0) }); });
});
anchorIssues.sort((a, b) => b.dist - a.dist);
farIssues.sort((a, b) => b.dist - a.dist);

console.log("坐标可信度审计");
console.log("A. 锚点 vs 市区型景点中位数 偏差>8km:", anchorIssues.length, "城（含下属远郊景区导致的正常偏离，需人工判断是否真错）");
anchorIssues.slice(0, 15).forEach(x => console.log("   " + x.city.padEnd(8) + x.dist + "km（市区景点" + x.n + "）"));
console.log("B. 距城市锚点>80km 的景点:", farIssues.length, "条（辽阔辖区属正常，但应抽查归属是否给错城市）");
farIssues.slice(0, 15).forEach(x => console.log("   " + x.city + "·" + x.spot + " " + x.dist + "km"));
console.log("\n提示：坐标为参考级估算值，未经地图 API 实测。接入腾讯地图/高德 Key 后可批量校正为真实 POI。");
process.exit(0);
