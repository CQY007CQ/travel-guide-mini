// v1.12.0 回归：100 城扩容 + 100 项新功能护栏
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const mem = {};
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ""),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getStorageInfoSync: () => ({ currentSize: 320, limitSize: 10240, keys: Object.keys(mem) }),
  showToast: () => {},
  setNavigationBarColor: () => {}, setTabBarStyle: () => {},
  request: () => {}, getSystemInfoSync: () => ({})
};

const T = require("../utils/travel.js");
const P = require("../utils/planner.js");
const D = T.D;
let pass = 0, fail = 0;
const assert = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log("  ✗ FAIL:", name, extra != null ? "| " + extra : ""); } };

const mkPlan = (city, days, depart) => ({
  cityName: city, depart,
  days: T.buildPlan({ city: T.findCity(city), days, depart, budget: "mid" })
});

/* ========== A. 数据护栏（v1.12 扩容） ========== */
console.log("== A. v1.12 · 100 城扩容护栏 ==");
assert("A1 城市池 ≥232", D.CITIES.length >= 232, D.CITIES.length);
const exp = D.CITIES.reduce((s, c) => s + (c.experiences || []).length, 0);
assert("A2 experiences ≥1300", exp >= 1300, exp);

// 泰州/台州 id 不冲突（曾因拼音同 "taizhou" 静默覆盖）
const tz = D.CITIES.find(c => c.name === "台州");
const tj = D.CITIES.find(c => c.name === "泰州");
assert("A3 台州存在且非泰州覆盖", !!tz && (tz.experiences || []).length > 0, tz && tz.id);
assert("A3 泰州存在且 id 唯一", !!tj && tj.id !== tz.id, tj && tj.id);

// 新城直达率（v1.12 新增 100 城）
const NEW100 = require("./v193-spots-list.json");
const _rate = (names) => {
  let tot = 0, real = 0;
  names.forEach(nm => {
    const c = D.CITIES.find(x => x.name === nm);
    if (!c) return;
    (c.experiences || []).forEach(e => {
      const n = typeof e === "string" ? e : (e.name || e.t || "");
      if (!n) return;
      tot++;
      const g = P.getSpotCoord(nm, n);
      if (g && g.approx === false) real++;
    });
  });
  return { tot, real, rate: tot ? real / tot * 100 : 100 };
};
const _reach = (names) => {
  let tot = 0, ok = 0;
  names.forEach(nm => {
    const c = D.CITIES.find(x => x.name === nm);
    if (!c) return;
    (c.experiences || []).forEach(e => {
      const n = typeof e === "string" ? e : (e.name || e.t || "");
      if (!n) return;
      tot++;
      const g = P.getSpotCoord(nm, n);
      if (g && g.lat && g.lon && g.approx !== true) ok++;
    });
  });
  return { tot, ok, rate: tot ? ok / tot * 100 : 100 };
};
const rNew = _rate(Object.keys(NEW100));
assert("A4 v1.12 新增 100 城精确率 ≥95%", rNew.rate >= 95, rNew.real + "/" + rNew.tot + " = " + rNew.rate.toFixed(1) + "%");
const rAllReach = _reach(D.CITIES.map(c => c.name));
assert("A5 全量可达率（精确+城锚）≥98%", rAllReach.rate >= 98, rAllReach.ok + "/" + rAllReach.tot + " = " + rAllReach.rate.toFixed(1) + "%");

/* ========== B. 100 项新功能冒烟（抽样 30 个） ========== */
console.log("== B. v1.12 · 100 项新功能冒烟 ==");
const city = T.findCity("保定");
// 交通
assert("B1 trainBetween", T.trainBetween("北京", "上海") && T.trainBetween("北京", "上海").found === true);
assert("B1 trainBetween 无数据安全", T.trainBetween("北京", "不存在城").found === false);
assert("B2 flightCodeOf", T.flightCodeOf("北京") === "PEK");
assert("B2 routeDist 数值", typeof T.routeDist("北京", "上海") === "number");
assert("B3 nearbyCities 数组", Array.isArray(T.nearbyCities("北京", 5)) && T.nearbyCities("北京", 3).length === 3);
assert("B4 cityHopTime", "txt" in T.cityHopTime("北京", "上海"));
assert("B5 dayPlanOrder 数组", Array.isArray(T.dayPlanOrder(mkPlan("保定", 2, "2026-10-05"), 0)));
// 行程
assert("B6 mustSeeOf 数组", Array.isArray(T.mustSeeOf("北京")));
assert("B7 itineraryDensity", "level" in T.itineraryDensity(mkPlan("北京", 2, "2026-10-05"), 0));
assert("B8 spotClusterOf", Array.isArray(T.spotClusterOf("北京")));
assert("B9 transferChain 保序", T.transferChain(["北京", "上海", "广州"]).length === 3);
assert("B10 ticketPriceOf 故宫", T.ticketPriceOf("故宫").known === true);
// 美食
assert("B11 foodStreetOf 北京", T.foodStreetOf("北京").length > 0);
assert("B12 foodTop3 非空", T.foodTop3("北京").length === 3);
assert("B13 foodBudgetOf", "txt" in T.foodBudgetOf("北京"));
assert("B14 spicyLevelOf 四川", T.spicyLevelOf("成都").spicy === true);
assert("B15 provFoodOf 北京", T.provFoodOf("北京").length > 0);
// 天气
assert("B16 seasonWeather", T.seasonWeather("北京") && "春" in T.seasonWeather("北京"));
assert("B17 bestTravelMonth 非空", T.bestTravelMonth("北京").length > 0);
assert("B18 rainLikely", "txt" in T.rainLikely("广州"));
assert("B19 typhoonHint 广东", T.typhoonHint("广州").risk === true);
assert("B20 tempRangeOf", "min" in T.tempRangeOf("北京"));
// 预算/安全
assert("B21 hotelBudgetOf", "txt" in T.hotelBudgetOf("北京"));
assert("B22 budgetPieOf 4 项", T.budgetPieOf("北京").length === 4);
assert("B23 saveTipsOf 数组", Array.isArray(T.saveTipsOf("北京")));
assert("B24 altitudeRisk 拉萨", T.altitudeRisk("拉萨").risk >= 2);
assert("B25 altitudeRisk 北京无高反", T.altitudeRisk("北京").risk === 0);
assert("B26 scamAlertOf 数组", Array.isArray(T.scamAlertOf("北京")));
assert("B27 medKitList 数组", Array.isArray(T.medKitList("北京")));
assert("B28 valueScoreOf 0-100", T.valueScoreOf("北京") >= 0 && T.valueScoreOf("北京") <= 100);
// 文化/工具
assert("B29 localTabooOf 数组", Array.isArray(T.localTabooOf("北京")));
assert("B30 festivalOf 数组", Array.isArray(T.festivalOf("北京")));
assert("B31 giftIdea 数组", Array.isArray(T.giftIdea("北京")));
assert("B32 luggageCheck", "must" in T.luggageCheck("北京"));
assert("B33 photoSpotOf 数组", Array.isArray(T.photoSpotOf("北京")));
// 数据洞察
assert("B34 yearTravelSummary", "cities" in T.yearTravelSummary());
assert("B35 achievementProgress 结构", "list" in T.achievementProgress() && "pct" in T.achievementProgress());
assert("B36 footMapOf", "points" in T.footMapOf());
assert("B37 budgetTrendOf 数组", Array.isArray(T.budgetTrendOf()));
// 空值健壮性（fuzz 已锁，这里抽查）
assert("B38 nearbyCities 空城安全", Array.isArray(T.nearbyCities("", 3)));
assert("B39 foodStreetOf 空安全", Array.isArray(T.foodStreetOf("")));
assert("B40 dayPlanOrder 空安全", Array.isArray(T.dayPlanOrder(null, 0)));

/* ========== C. 100 新城可建 3 日行程 ========== */
console.log("== C. v1.12 · 100 新城可建行程 ==");
const badCity = [];
Object.keys(NEW100).forEach(nm => {
  try {
    const p = mkPlan(nm, 3, "2026-10-05");
    if (!p.days || p.days.length !== 3) badCity.push(nm + "(天数异常)");
  } catch (e) { badCity.push(nm + "(" + e.message + ")"); }
});
assert("C1 100 新城全部可建 3 日行程", badCity.length === 0, badCity.slice(0, 10).join(","));

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
if (fail > 0) process.exit(1);
