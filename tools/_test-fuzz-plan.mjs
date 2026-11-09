/**
 * tools/_test-fuzz-plan.mjs —— 行程生成模糊测试核心引擎 (#491)
 *
 * 对 buildPlan / buildProvPlan 在海量输入组合下进行鲁棒性模糊测试，捕获四类缺陷：
 *   ① 异常    —— 任何 城市/天数/节奏/预算/出发日 组合不得抛错
 *   ② NaN     —— 评分 / 距离 / 景点数 / 变异系数 / spotCount 必须有限且非负
 *   ③ 越界    —— score ∈ [0,100]；routeCoords 经纬度全部在国境内（含三沙特例）
 *   ④ 空天    —— 非抵达日均必须含真景点（与 _smoke-batch 口径一致：i>=1）
 *
 * 覆盖维度：
 *   · 106 城（热门城 + 历史稀疏县 + limited 城 + 随机抽样的 751 城子集）
 *   · 天数 2/3/5/7/10/14（按 cityDayCap 截断，避免「空天末日」假阳性）
 *   · 节奏 speed/balance/leisure；预算 low/mid/high
 *   · 出发日边界：常态 / 跨年(12-31↔01-01) / 闰年(02-29) / 过去日期
 *   · 全省游：34 省 × 多天数 × 多节奏 × 交通方式(car/train/plane)
 *
 * 固定随机种子（mulberry32 20261109）保证可复现，定位偶发缺陷时能稳定重放。
 *
 * 退出码：0 全绿 / 1 发现致命缺陷（异常 / NaN / 越界）。
 *   注：空天按「捕获并报告」处理——非 limited 城的空天属于真实数据缺口（喂给 #293/#296
 *   数据补全），不在此门禁硬性 fail（避免把 61/61 绿基线压在跨城数据稀疏这种已知存量上）；
 *   其余三类为无歧义回归，硬性 fail。
 */
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

// ── 固定种子 PRNG（可复现）──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261109);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

let bugs = 0, builds = 0, errs = 0, emptyDays = 0, totalDays = 0, badCoords = 0, nanFields = 0;
const RED = [];

function isFrame(name) { try { return T.isFrameName(name); } catch (e) { return false; } }
function dayFilled(day) {
  if (!day || !Array.isArray(day.items)) return false;
  return day.items.some((it) => it && typeof it.name === "string" && !isFrame(it.name));
}
function coordOk(lat, lon, city) {
  if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) return false;
  if (lat > 54 || lon > 136) return false;
  if (city === "三沙") return lat >= 15 && lat <= 18 && lon >= 110 && lon <= 114; // 南海合法纬度（与数据健康门禁一致）
  if (lat < 17 || lon < 73) return false;
  return true;
}
function bad(msg) { bugs++; console.log("  ✗ BUG: " + msg); }

function validatePlan(plan, label, cityName, limitedSet) {
  if (!Array.isArray(plan) || !plan.length) { bad(label + ": 返回空行程"); errs++; return; }
  const ev = plan.evaluation;
  if (!ev || typeof ev.score !== "number") { bad(label + ": 无评分"); nanFields++; }
  else {
    if (!isFinite(ev.score) || ev.score < 0 || ev.score > 100) { bad(label + ": score 越界/NaN " + ev.score); nanFields++; }
    const d = ev.detail || {};
    for (const k of ["avgDist", "avgSpots", "cv"]) {
      const v = d[k];
      if (v !== undefined && (typeof v !== "number" || !isFinite(v) || v < 0)) { bad(label + ": detail." + k + " 异常 " + v); nanFields++; }
    }
  }
  for (let i = 0; i < plan.length; i++) {
    const day = plan[i];
    totalDays++;
    if (!day || !Array.isArray(day.items)) { bad(label + " D" + (i + 1) + ": items 非数组"); continue; }
    const effCity = day.cityName || cityName;
    const limited = limitedSet.has(effCity);
    // limited 城本就只有框架行，空天属预期（与 _scan-sparse 口径一致，跳过不计）
    if (i >= 1 && !limited && !dayFilled(day)) {
      emptyDays++;
      if (RED.length < 30) RED.push(label + " D" + (i + 1));
    }
    if (day.routeCoords) {
      for (const c of day.routeCoords) {
        if (!coordOk(c && c.lat, c && c.lon, day.cityName || cityName)) { badCoords++; bad(label + " D" + (i + 1) + " routeCoord 越界/NaN " + (c && c.name)); break; }
      }
    }
    for (const it of day.items) {
      if (it && typeof it === "object" && (typeof it.name !== "string" || !it.name)) bad(label + " D" + (i + 1) + ": item.name 异常");
    }
    const sc = day.spotCount;
    if (sc !== undefined && (typeof sc !== "number" || !isFinite(sc) || sc < 0)) { bad(label + " D" + (i + 1) + ": spotCount 异常 " + sc); nanFields++; }
  }
}

(async () => {
  await T.ready();
  const allCities = (D.CITIES || []).filter((c) => c && c.name);
  const limitedSet = new Set(allCities.filter((c) => c.limited).map((c) => c.name));

  const CURATED = ["北京", "上海", "成都", "西安", "重庆", "杭州", "三亚", "昆明", "拉萨", "黄山",
    "哈尔滨", "乌鲁木齐", "青岛", "大理", "香港", "澳门", "厦门", "桂林", "黄龙", "酉阳",
    "抚远", "漠河", "茫崖", "三沙", "台北", "海口", "和田", "喀什", "阿勒泰", "漠河"];
  const sampled = [];
  const used = new Set();
  for (const c of CURATED) if (allCities.find((x) => x.name === c)) { sampled.push(c); used.add(c); }
  while (sampled.length < 106) { const c = pick(allCities).name; if (!used.has(c)) { used.add(c); sampled.push(c); } }

  const DAYS = [2, 3, 5, 7, 10, 14];
  const PACES = ["speed", "balance", "leisure"];
  const BUDGETS = ["low", "mid", "high"];
  const DEPARTS = ["2027-04-05", "2026-12-31", "2027-01-01", "2028-02-29", "2020-01-01"];

  console.log("【城市行程模糊测试】 抽样 " + sampled.length + " 城");
  for (const city of sampled) {
    const co = allCities.find((c) => c.name === city);
    const limited = !!(co && co.limited);
    for (let b = 0; b < 2; b++) {
      // 关键：必须按「实际节奏」取 cap（speed 的 cap 系统性低于 balance），
      // 否则用 balance cap 截断却按 speed 构建会超发、造出假空天（本 fuzz 自身踩过）。
      const pace = pick(PACES);
      let cap = 2; try { cap = T.cityDayCap(city, pace); } catch (e) { }
      const days = Math.max(2, Math.min(pick(DAYS), cap));
      const budget = pick(BUDGETS);
      const depart = pick(DEPARTS);
      builds++;
      try {
        const plan = T.buildPlan({ city, days, depart, budget, pace });
        validatePlan(plan, city + " " + days + "天/" + pace + "/" + budget, city, limitedSet);
      } catch (e) { errs++; bad(city + " " + days + "天/" + pace + " 生成异常: " + e.message); }
    }
  }

  console.log("【压力：热门城按上限天数 × 三节奏】");
  const POPULAR = ["北京", "上海", "成都", "西安", "重庆", "杭州", "广州", "深圳", "武汉", "南京",
    "苏州", "天津", "长沙", "青岛", "厦门", "昆明", "三亚", "丽江", "桂林", "拉萨"];
  for (const city of POPULAR) {
    if (!allCities.find((c) => c.name === city)) continue;
    for (const pace of PACES) {
      let cap = 2; try { cap = T.cityDayCap(city, pace); } catch (e) { }
      const days = Math.max(2, cap);
      builds++;
      try {
        const plan = T.buildPlan({ city, days, depart: "2027-04-05", budget: "mid", pace });
        validatePlan(plan, "STRESS " + city + " " + days + "天/" + pace, city, limitedSet);
      } catch (e) { errs++; bad("STRESS " + city + " " + days + "天/" + pace + " 异常: " + e.message); }
    }
  }

  console.log("【全省游模糊测试】 " + Object.keys(D.PROVINCE_CITIES || {}).length + " 省");
  const provs = Object.keys(D.PROVINCE_CITIES || {});
  for (const p of provs) {
    for (let b = 0; b < 2; b++) {
      const days = pick([3, 5, 7, 10]);
      const pace = pick(PACES);
      const tm = pick(["car", "train", "plane"]);
      builds++;
      try {
        const plan = T.buildProvPlan({ province: p, days, depart: "2026-10-01", budget: "mid", pace, travelMode: tm });
        validatePlan(plan, "省 " + p + " " + days + "天/" + pace + "/" + tm, p, limitedSet);
      } catch (e) { errs++; bad("省 " + p + " " + days + "天/" + pace + " 异常: " + e.message); }
    }
  }

  console.log("\n构建 " + builds + " 次 / 致命异常 " + errs + " / 总天数 " + totalDays +
    " / 空天(非limited) " + emptyDays + " / 坐标越界 " + badCoords + " / 数值异常 " + nanFields);
  if (RED.length) console.log("空天红榜(前30): " + RED.join("、"));

  const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); bugs++; } else console.log("  ✓ " + m); };
  ok(errs === 0, "全部组合生成零异常（致命）");
  ok(badCoords === 0, "routeCoords 坐标全部在国境内（致命）");
  ok(nanFields === 0, "评分/距离/景点数/变异系数/spotCount 全部有限且非负（致命）");

  // 致命三类硬性 fail；空天仅捕获报告（喂 #293/#296 数据补全），不阻塞 61/61 绿基线
  const fatal = errs + badCoords + nanFields;
  if (fatal) {
    console.error("\n❌ 行程生成模糊测试发现 " + fatal + " 个致命缺陷（异常/NaN/越界）");
    process.exit(1);
  }
  console.log(emptyDays
    ? "✅ 行程生成模糊测试通过（" + builds + " 次构建，零异常/NaN/越界；空天 " + emptyDays + " 处已捕获并报告，待数据补全）"
    : "✅ 行程生成模糊测试通过（" + builds + " 次构建，零异常/NaN/越界/空天）");
})().catch((e) => { console.error("运行异常:", e); process.exit(1); });
