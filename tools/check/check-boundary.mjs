// 边界排雷回归（node + wx stub，cd 项目根后运行）
// D1 跨城同名：城市级隔离 + 全省游省域优先（湖南·十里画廊 ≠ 桂林·十里画廊）
// D2 跨年/跨月：buildPlan / buildMultiPlan 日期递增、segCityOfDay 归属、todayState 相位
// 用法：node tools/check/check-boundary.mjs
const mem = {};
global.wx = {
  getStorageSync: k => (k in mem ? mem[k] : ""),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: () => {}, showModal: () => {}, openLocation: () => {}, setClipboardData: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, navigateBack: () => {}
};
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const P = req("./utils/planner.js");
const D = T.D;
const CITY2PROV = D.CITY2PROV || {};
const PROV_C = D.PROVINCE_CITIES || {};

let pass = 0, fail = 0;
const assert = (n, c, ex) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (ex ? " → " + ex : "")); } };

// 与 getSpotCoord 城市内 list 口径一致的精查（SPOT_COORDS ∪ COORD_PATCH 同城）
function exactCity(city, name) {
  const l = (D.SPOT_COORDS[city] || []).concat((P.COORD_PATCH && P.COORD_PATCH[city]) || []);
  for (const s of l) if (s[0] === name) return s;
  return null;
}
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;

console.log("== D1. 跨城同名：城市级隔离 ==");
// 扫描同名组并逐个验证 city 作用域返回本城坐标
const byName = {};
Object.keys(D.SPOT_COORDS).forEach(city => {
  D.SPOT_COORDS[city].forEach(t => { const nm = t[0]; (byName[nm] = byName[nm] || []).push(city); });
});
const dupNames = Object.keys(byName).filter(n => new Set(byName[n]).size >= 2);
assert("同名组 ≥1（当前 14 组）", dupNames.length >= 1, "组数 " + dupNames.length);
for (const nm of dupNames) {
  const cities = [...new Set(byName[nm])];
  const recs = cities.map(c => exactCity(c, nm)).filter(Boolean);
  if (recs.length < 2) { assert("城市隔离 " + cities[0] + "/" + nm, false, "库内缺同名记录"); continue; }
  let ok = true, detail = "";
  for (const c of cities) {
    const got = P.getSpotCoord(c, nm);
    const exp = exactCity(c, nm);
    if (!exp || !got || got.approx !== false || !near(got.lat, exp[1]) || !near(got.lon, exp[2])) {
      ok = false; detail = c + " 期望 " + (exp ? exp[1] + "," + exp[2] : "无") + " 实得 " + (got ? got.lat + "," + got.lon : "null");
    }
  }
  if (ok) {
    // 两城坐标应互不相同——除非两城记录本身相同（同址跨区划，如 敦煌/酒泉·鸣沙山月牙泉 实为同一处）
    const [a, b] = cities;
    const ea = exactCity(a, nm), eb = exactCity(b, nm);
    const sameRow = ea && eb && near(ea[1], eb[1]) && near(ea[2], eb[2]);
    if (!sameRow) {
      const ra = P.getSpotCoord(a, nm), rb = P.getSpotCoord(b, nm);
      ok = ra && rb && !(near(ra.lat, rb.lat) && near(ra.lon, rb.lon));
      if (!ok) detail = a + " 与 " + b + " 返回相同坐标（记录不同）";
    }
  }
  assert("城市隔离 " + nm + "（" + cities.slice(0, 3).join("/") + "）", ok, detail);
}

console.log("== D1b. 全省游省域优先（跨省同名不串城） ==");
let provChecked = 0;
for (const nm of dupNames) {
  const cities = [...new Set(byName[nm])].filter(c => CITY2PROV[c]);
  // 按省分组：同省内可能有多座城市共有该名（如河南·郑州/安阳 都有「人民公园」），
  // 省域查询只能返回其中一个 → 正确断言是「结果落在本省拥有该名的城市坐标上」，
  // 而不是旧写法的「必须等于省内每一座城市自己的坐标」（省内≥2 城同名时自相矛盾）。
  const provMap = {};
  cities.forEach(c => { const p = CITY2PROV[c]; (provMap[p] = provMap[p] || []).push(c); });
  const provs = Object.keys(provMap);
  if (provs.length < 2) continue;            // 同省内同名（成都/都江堰·青城山）不做省域断言
  provChecked++;
  let ok = true, detail = "";
  for (const prov of provs) {
    const got = P.getSpotCoord(prov, nm);
    // 只断言「落在本省拥有该名的城市坐标上」＝不得串到省外。
    // 注意：不再断言各省坐标互不相同 —— 壶口瀑布(晋陕界)、泸沽湖(川滇界) 本就是
    // 跨省同一地理实体，两省共用同一坐标是正确的。
    const hit = !!got && provMap[prov].some(c => {
      const exp = exactCity(c, nm);
      return exp && near(got.lat, exp[1]) && near(got.lon, exp[2]);
    });
    if (!hit) {
      ok = false;
      detail = prov + " 下 " + nm + " 应落在本省 " + provMap[prov].join("/") + " 之一，实得 " + (got ? got.lat + "," + got.lon : "null");
      break;
    }
  }
  assert("省域优先 " + nm + "（" + cities.join("/") + "）", ok, detail);
}
assert("省域断言覆盖到跨省同名组", provChecked >= 3, "实际 " + provChecked + " 组");

console.log("== D2. 跨年：单城 12-30 出发 4 天 ==");
const depA = "2026-12-30";
const daysA = T.buildPlan({ city: D.CITIES.find(c => c.name === "北京"), days: 4, depart: depA, pace: "balance" });
assert("生成长度 4", daysA.length === 4);
const dts = daysA.map(d => String(d.date || "").slice(0, 10));
assert("日期序列跨年", JSON.stringify(dts) === JSON.stringify(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]), dts.join(","));
assert("无脏值", !daysA.flatMap(d => d.items || []).some(i => /undefined|NaN/.test(String(i && i.name))));

console.log("== D3. 跨年多站：12-31 出发 北京2天+西安2天 ==");
const multi = T.buildMultiPlan({
  route: [{ name: "北京", province: "北京市", days: 2 }, { name: "西安", province: "陕西省", days: 2 }],
  depart: "2026-12-31", budget: "mid", pace: "balance", people: 2
});
assert("多站总天数 4", multi && multi.days && multi.days.length === 4, multi && multi.days && multi.days.length);
const mdts = multi.days.map(d => String(d.date || "").slice(0, 10));
assert("多站日期跨月跨年", mdts.join(",") === "2026-12-31,2027-01-01,2027-01-02,2027-01-03", mdts.join(","));
const own = [0, 1, 2, 3].map(di => T.segCityOfDay(multi, di));
assert("segCityOfDay 归属", own.join(",") === "北京,北京,西安,西安", own.join(","));

console.log("== D4. 已结束（过期）行程回顾相位 ==");
const past = T.buildPlan({ city: D.CITIES.find(c => c.name === "北京"), days: 2, depart: "2026-01-02", pace: "balance" });
const st = past && T.todayState ? T.todayState({ cityName: "北京", days: past, totalDays: 2 }) : null;
assert("过期行程 todayState=after", st && st.phase === "after", JSON.stringify(st));
const rev = T.tripReview({ cityName: "北京", days: past, totalDays: 2 });
assert("过期行程可产出小结", !!rev && !/undefined|NaN/.test(String(rev.title || "")), JSON.stringify(rev).slice(0, 80));
assert("跨年元旦命中节日提示", (T.holidayHint("2027-01-01") || {}).name === "元旦", JSON.stringify(T.holidayHint("2027-01-01")));

console.log("== D5. app.js onLaunch 冷启动策略（wx stub 直测配置） ==");
let appCfg = null;
const savedApp = global.App;
global.App = cfg => { appCfg = cfg; };
const freshMem = () => {
  const m = {};
  const store = { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; }, del: k => { delete m[k]; },
    fmtLocalDate: d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
  return { m, store };
};
// 由于 app.js require 的是真实 store 模块（wx stub 顶层已建），这里直接操作同一 mem
const mkPlan = (dates) => ({ cityName: "北京", totalDays: dates.length, days: dates.map((date, i) => ({ date, dayNo: i + 1, items: [{ name: "故宫", period: "am" }] })) });
global.getCurrentPages = () => [];
req("./app.js");
const runOnLaunch = () => {
  const ctx = Object.assign({}, appCfg);           // 携带 onLaunch/_archiveOld/_watchTheme/setPlan 等
  ctx.globalData = { plan: null, from: null };
  ctx.onLaunch.call(ctx);
  lastCtx = ctx;
};
let lastCtx = null;
// 场景1：过期行程（昨天结束）→ 归档到我的行程并清当前档
// 同样改为动态日期，避免用例随时间失效
const pastDay = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
mem["planV1"] = mkPlan([pastDay(3), pastDay(2)]);
runOnLaunch();
assert("过期 → 归档 1 份且带「往期」", (mem["miniPlansV1"] || []).length === 1 && /往期/.test(mem["miniPlansV1"][0].name), JSON.stringify(mem["miniPlansV1"]).slice(0, 90));
assert("过期 → planV1 清空", !("planV1" in mem));
assert("过期 → 不作为当前行程", lastCtx.globalData.plan === null, JSON.stringify(lastCtx.globalData.plan && { city: lastCtx.globalData.plan.cityName }).slice(0, 80));
// 场景2：进行中/未开始行程 → 原样恢复
// 注意：日期必须动态生成。此前写死 2026-09-11，跨过午夜后「今天 > 最后一天」被判为过期，
//       导致本用例在每天 00:00 之后必然失败（与业务代码无关，是测试数据的时效 bug）。
mem["miniPlansV1"] = [];
const dayOffset = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const fut = mkPlan([dayOffset(-1), dayOffset(1), dayOffset(2)]);
mem["planV1"] = fut;
runOnLaunch();
assert("未结束 → 保留为当前 planV1", mem["planV1"] === fut);
assert("未结束 → 不产生归档", (mem["miniPlansV1"] || []).length === 0);
// 场景3：无行程 → 无副作用
mem["planV1"] = null; delete mem["planV1"]; mem["miniPlansV1"] = [];
runOnLaunch();
assert("无行程 → 不归档不报错", !("planV1" in mem) && (mem["miniPlansV1"] || []).length === 0);
if (savedApp) global.App = savedApp;

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
