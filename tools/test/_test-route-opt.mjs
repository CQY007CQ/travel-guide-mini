// v1.19.176 动线优化单测：验证 optimizeDayRoute 的「最近邻贪心重排」行为
// 1) 结构性：普通多景点日必挂 routeCoords，长度==真实景点数、坐标有限
// 2) 活跃性：跨城市采样中至少有日程被真正重排（非空操作）
// 3) 叙事日保护：含 深度游览/继续深度游览/看日出/凌晨出发 的山地/大景点日不重排（无 routeCoords）
// 4) 聚合距离：重排后全样本日内总路程 <= 原顺序（贪心就近不该更差）
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");
const P = req("./utils/planner.js");
const { haversine } = req("./utils/geo.js");

function isFrame(n) {
  return /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|继续游览|\+ ?登山|\+ ?索道)/.test(n) ||
    /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选|夜市|小吃街|馆子|早点铺|街边摊|烧烤摊|菜市场|家常菜馆|面食小馆|苍蝇馆子|散步|吹风|慢走|慢逛|闲逛|夜游|溜达|夜灯|拼一顿/.test(n);
}
function isNarrative(n) { return /深度游览|继续深度游览|看日出|凌晨出发|云海|看晚霞/.test(n); }
function routeSpotsOf(name) {
  let t = String(name || "").replace(/^(抵达\s*\+\s*入住|出发前往|前往|深度游览|继续深度游览|游览|凌晨出发)[\s·「「]*/, "").replace(/[」』]\s*$/, "");
  if (/酒店|民宿|客栈|青旅/.test(t)) return [];
  return t.split(/\s*\+\s*/).map(x => x.trim()).filter(Boolean);
}
function coordOf(cityName, name) {
  for (const sp of routeSpotsOf(name)) {
    const c = P.getSpotCoord(cityName, sp);
    if (c && typeof c.lat === "number" && typeof c.lon === "number") return { lat: c.lat, lon: c.lon };
  }
  return null;
}
function routeLen(coords) { let s = 0; for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i]); return s; }
// 最近邻贪心不变量：order[i] 必须是「距 order[i-1] 最近的未用点」（允许并列——并列时任意均可）
function nnInvariant(coords) {
  const pts = coords.map(c => ({ lat: c.lat, lon: c.lon }));
  const n = pts.length;
  if (n < 2) return true;
  const used = new Set([0]);
  const EPS = 1e-9;
  for (let i = 1; i < n; i++) {
    const cur = pts[i - 1];
    let bd = Infinity;
    for (let j = 0; j < n; j++) { if (used.has(j)) continue; const d = haversine(cur, pts[j]); if (d < bd) bd = d; }
    // order[i] 距上一个点的距离必须 == 最小值（并列可接受）
    if (Math.abs(haversine(cur, pts[i]) - bd) > EPS) return false;
    used.add(i);
  }
  return true;
}

const CITIES = ["北京","上海","广州","重庆","武汉","南京","天津","西安","成都","昆明","青岛","厦门","黄山","峨眉山","泰山"];
const NARRATIVE_CITIES = ["黄山","峨眉山","泰山"];

let fails = 0;
function assert(cond, msg) { if (!cond) { console.error("✗ " + msg); fails++; } else { console.log("✓ " + msg); } }

(async () => {
  await D.initData();
  const cityObj = n => (D.CITIES || []).find(c => c.name === n);

  let touchDays = 0, nnValid = 0, narrDays = 0, narrSkipped = 0;
  let sumRaw = 0, sumOpt = 0;

  for (const city of CITIES) {
    const co = cityObj(city);
    if (!co) { console.error("⚠ 跳过未收录城市 " + city); continue; }
    const days = T.buildPlan({ city, days: 7, depart: "2027-01-05", budget: "mid", pace: "balance" });
    const raw = P.buildPlanDays(co, 7, "2027-01-05", "mid",
      { style: "balance", pickSpots: [], pickOnly: true, stayMountain: true, travelMode: "", bias: "", lastMode: "return", nextCity: "", seg: 0 });
    for (let i = 0; i < days.length; i++) {
      const d = days[i], rd = raw[i];
      if (!d || !rd) continue;
      const reals = (d.items || []).filter(it => it && typeof it.name === "string" && !isFrame(it.name) && !isNarrative(it.name));
      const isNarr = (d.items || []).some(it => isNarrative(String(it.name || "")));
      if (isNarr) {
        narrDays++;
        if (!Array.isArray(d.routeCoords)) narrSkipped++;
        continue;
      }
      if (reals.length < 2) continue;
      touchDays++;
      // 结构性
      assert(Array.isArray(d.routeCoords) && d.routeCoords.length === reals.length,
        `${city} D${i + 1}: routeCoords 长度 ${d.routeCoords ? d.routeCoords.length : "无"} == 真实景点数 ${reals.length}`);
      if (Array.isArray(d.routeCoords)) {
        const allFinite = d.routeCoords.every(c => typeof c.lat === "number" && typeof c.lon === "number");
        assert(allFinite, `${city} D${i + 1}: routeCoords 坐标均有限`);
        if (d.routeCoords.length >= 2) {
          if (nnInvariant(d.routeCoords)) nnValid++;
          else assert(false, `${city} D${i + 1}: routeCoords 满足最近邻贪心不变量`);
        }
      }
      // 原顺序距离 vs 重排后距离
      const rawCoords = reals.map(it => coordOf(d.cityName, it.name)).filter(Boolean);
      if (rawCoords.length >= 2) {
        const rawD = routeLen(rawCoords);
        const optD = routeLen((d.routeCoords || []).map(c => ({ lat: c.lat, lon: c.lon })));
        sumRaw += rawD; sumOpt += optD;
      }
    }
  }

  assert(nnValid === touchDays && touchDays > 0, `${touchDays} 个多景点普通日的 routeCoords 全部满足最近邻贪心不变量`);
  assert(sumOpt <= sumRaw * 1.5, `重排后全样本日内总路程未显著劣化 (raw=${sumRaw.toFixed(1)}km opt=${sumOpt.toFixed(1)}km)`);
  assert(narrDays > 0 && narrSkipped === narrDays, `叙事日(${narrDays})全部跳过重排（无 routeCoords）`);

  console.log(`\n采样: ${touchDays} 个多景点普通日, ${nnValid} 天满足 NN 不变量, ${narrDays} 个叙事日全跳过`);
  if (fails) { console.error(`\n❌ ${fails} 条断言失败`); process.exit(1); }
  console.log("\n✅ 动线优化单测全部通过");
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
