// v1.11.0 回归：20 项新功能 + v1.11 优化护栏
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ---- wx 桩：内存存储 ----
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
const p4 = mkPlan("北京", 4, "2026-10-05");
const pLasa = mkPlan("拉萨", 3, "2026-09-20");

/* ========== F. 20 项新功能 ========== */
console.log("== F. v1.11 · 20 项新功能 ==");
// 1
const cd = T.tripPhaseGuide(p4);
assert("F1 tripCountdown 结构", cd && "days" in cd && "phase" in cd && typeof cd.txt === "string" && cd.txt.length > 2, JSON.stringify(cd));
assert("F1 行前进度 0-100", cd.prepPct >= 0 && cd.prepPct <= 100);
assert("F1 空行程安全", T.tripPhaseGuide(null).phase === "none");
// 2
const on1 = T.spotOpenNow("簋街夜市"), on2 = T.spotOpenNow("中国国家博物馆");
assert("F2 夜市判为夜间限定", on1.tag === "夜间限定", on1.tag);
assert("F2 博物馆判为白天", on2.tag === "白天开放", on2.tag);
assert("F2 ok 是布尔", typeof on1.ok === "boolean");
// 3
const hl = T.dayHighlight(p4, 0);
assert("F3 有名称", !!hl.name, JSON.stringify(hl));
assert("F3 越界安全", T.dayHighlight(p4, 99).name === "");
// 4
mem["miniLedgerV1"] = [
  { amount: 300, cat: "住宿", date: "2026-10-05" },
  { amount: 100, cat: "餐饮", date: "2026-10-05" }
];
const br = T.burnRate(p4);
assert("F4 已花 400", br.spent === 400, br.spent);
assert("F4 结构完整", "rate" in br && "projected" in br && typeof br.verdict === "string");
mem["miniLedgerV1"] = [];
// 5
const cmp = T.cityCompareCard("北京", "成都");
assert("F5 对比 5 行", cmp.length === 5, cmp.length);
assert("F5 行含分隔符", cmp.every(x => x.indexOf("｜") > 0));
assert("F5 非法城安全", T.cityCompareCard("", "北京").length === 0);
// 6
const vp = T.visitProgress();
assert("F6 完成度 0-100", vp.pct >= 0 && vp.pct <= 100);
assert("F6 总数 = 城市池", vp.total === D.CITIES.length, vp.total + " vs " + D.CITIES.length);
assert("F6 推荐 ≤3", vp.next.length <= 3);
// 7
const wp = T.weatherPack({ max: 33, min: 8, codes: [61] });
assert("F7 雨天有伞", wp.some(x => /伞|雨衣/.test(x)), JSON.stringify(wp));
assert("F7 温差有叠穿", wp.some(x => /叠穿/.test(x)));
assert("F7 空输入兜底", T.weatherPack(null).length >= 1);
// 8
const ps1 = T.photoScoreOf("外滩日落观景台"), ps2 = T.photoScoreOf("地下商场");
assert("F8 日落高分", ps1.score >= 80, ps1.score);
assert("F8 商场低分", ps2.score < 45, ps2.score);
assert("F8 5-100 区间", ps1.score >= 5 && ps1.score <= 100 && !!ps1.best);
// 9
const ec = T.energyCurve(p4);
assert("F9 天数一致", ec.length === 4, ec.length);
assert("F9 分数 0-100", ec.every(x => x.score >= 0 && x.score <= 100));
assert("F9 空行程 []", T.energyCurve(null).length === 0);
// 10
const fs10 = T.freeSlotPicker(p4, 0);
assert("F10 返回 ≤6", fs10.length <= 6, fs10.length);
assert("F10 不含行程已有", fs10.every(n => !JSON.stringify(p4.days).includes(n)));
// 11
const cb = T.costBreakdown(p4);
assert("F11 空账本安全", cb.total === 0 && cb.rows.length === 0 && cb.txt.length > 0);
mem["miniLedgerV1"] = [{ amount: 900, cat: "餐饮" }, { amount: 100, cat: "门票" }];
const cb2 = T.costBreakdown(p4);
assert("F11 合计 1000", cb2.total === 1000, cb2.total);
assert("F11 餐饮占比 90%", cb2.rows[0].pct === 90, cb2.rows[0].pct);
assert("F11 高占比有预警", cb2.warns.length >= 1);
mem["miniLedgerV1"] = [];
// 12
assert("F12 拉萨有礼仪", T.localEtiquette("拉萨").length >= 2);
assert("F12 普通城也有兜底", T.localEtiquette("合肥").length >= 1);
assert("F12 非法城 []", T.localEtiquette("").length === 0);
// 13
const sv = T.souvenirOf("成都");
assert("F13 有内容", sv.length >= 2);
assert("F13 含轻量兜底", sv.some(x => /冰箱贴|明信片|文创/.test(x)));
assert("F13 非法城 []", T.souvenirOf("").length === 0);
// 14
assert("F14 返回数组", Array.isArray(T.rainyDayPlan(p4, 0)));
assert("F14 越界 []", T.rainyDayPlan(p4, 99).length === 0);
// 15
assert("F15 返回数组", Array.isArray(T.nightLifeList(p4, 0)));
// 16
assert("F16 返回数组", Array.isArray(T.crowdAvoid(p4, 0)));
// 17
const mc = T.mistakeChecklist(p4);
assert("F17 有证件项", mc.some(x => /证件/.test(x)));
assert("F17 有截图项", mc.some(x => /截图/.test(x)));
assert("F17 高原城有高反项", T.mistakeChecklist(pLasa).some(x => /高反/.test(x)), JSON.stringify(T.mistakeChecklist(pLasa)));
// 18
const sc = T.snapshotCard(p4);
assert("F18 城市正确", sc.city === "北京", sc.city);
assert("F18 天数 4", sc.days === 4 && sc.nights === 3);
assert("F18 空行程 null", T.snapshotCard(null) === null);
// 19
const nc = T.nextCitySuggest();
assert("F19 有 top", !!nc.top, JSON.stringify(nc));
assert("F19 按分降序", nc.list.every((x, i) => i === 0 || nc.list[i - 1].score >= x.score));
// 20
const sh = T.storageHealth();
assert("F20 有用量", !!sh.usage, JSON.stringify(sh));
assert("F20 有建议", sh.tips.length >= 1);

/* ========== G. v1.11 优化护栏 ========== */
console.log("== G. v1.11 优化与数据护栏 ==");
assert("G1 城市池 ≥130", D.CITIES.length >= 130, D.CITIES.length);
assert("G2 experiences ≥690", D.CITIES.reduce((s, c) => s + (c.experiences || []).length, 0) >= 690);
const noCC = D.CITIES.filter(c => !D.CITY_COORDS[c.name]).map(c => c.name);
assert("G3 每城有 CITY_COORDS", noCC.length === 0, noCC.join(","));
const noCP = D.CITIES.filter(c => !D.CITY2PROV[c.name]).map(c => c.name);
assert("G4 每城有 CITY2PROV", noCP.length === 0, noCP.join(","));
const noSC = D.CITIES.filter(c => !c.limited && !D.SPOT_COORDS[c.name]).map(c => c.name);
assert("G5 每城有 SPOT_COORDS（防跨城错配；有限数据层城市豁免）", noSC.length === 0, noSC.join(","));
let bad = 0;
Object.keys(D.SPOT_COORDS).forEach(c => (D.SPOT_COORDS[c] || []).forEach(s => {
  // 三沙（西沙群岛）纬度可达 ~16°N，属中国合法范围；其余地区仍按大陆+海南/台湾下界 17°N 守卫。
  if (typeof s[1] !== "number" || typeof s[2] !== "number" ||
      (c !== "三沙" && (s[1] < 17 || s[2] < 73 || s[2] > 136)) ||
      (c === "三沙" && (s[1] < 15 || s[1] > 18 || s[2] < 110 || s[2] > 114)) ||
      s[1] > 54 || s[2] > 136) bad++;
}));
assert("G6 坐标全在国境", bad === 0, bad + " 条越界");
// 新城直达率（v1.11 新增 54 城）
const NEW54 = ["合肥", "芜湖", "池州", "蚌埠", "安庆", "徐州", "常州", "镇江", "南通", "盐城", "淮安", "温州", "湖州", "金华", "台州", "衢州", "丽水", "嘉兴", "漳州", "莆田", "南平", "龙岩", "赣州", "吉安", "上饶", "鹰潭", "宜春", "郑州", "焦作", "安阳", "信阳", "衡阳", "常德", "株洲", "湘潭", "邵阳", "十堰", "神农架", "荆门", "咸宁", "珠海", "中山", "江门", "湛江", "梅州", "佛山", "惠州", "柳州", "绵阳", "宜宾", "西昌", "康定", "凯里", "毕节"];
const _rate = (names) => {
  let tot = 0, real = 0;
  names.forEach(nm => {
    const c = D.CITIES.find(x => x.name === nm); if (!c) return;
    (c.experiences || []).forEach(e => {
      const n = typeof e === "string" ? e : (e.name || ""); if (!n) return;
      tot++; const g = P.getSpotCoord(nm, n); if (g && g.approx === false) real++;
    });
  });
  return { tot, real, rate: tot ? real / tot * 100 : 100 };
};
const _reach = (names) => {
  let tot = 0, ok = 0;
  names.forEach(nm => {
    const c = D.CITIES.find(x => x.name === nm); if (!c) return;
    (c.experiences || []).forEach(e => {
      const n = typeof e === "string" ? e : (e.name || ""); if (!n) return;
      tot++; const g = P.getSpotCoord(nm, n); if (g && g.lat && g.lon && g.approx !== true) ok++;
    });
  });
  return { tot, ok, rate: tot ? ok / tot * 100 : 100 };
};
const rNew = _rate(NEW54);
assert("G7 v1.11 新增 54 城精确率 ≥95%", rNew.rate >= 95, rNew.real + "/" + rNew.tot + " = " + rNew.rate.toFixed(1) + "%");
const rAllReach = _reach(D.CITIES.map(c => c.name));
assert("G8 全量可达率（精确+城锚）≥98%", rAllReach.rate >= 98, rAllReach.ok + "/" + rAllReach.tot + " = " + rAllReach.rate.toFixed(1) + "%");
// 高原打包项修复（v1.11 修的 bug）
const pkLasa = T.packByPlan(pLasa.days), pkBj = T.packByPlan(p4.days);
assert("G9 拉萨含防高反", pkLasa.some(x => /防高反/.test(x)), JSON.stringify(pkLasa.slice(-3)));
assert("G9 平原不含防高反", !pkBj.some(x => /防高反/.test(x)));
assert("G10 打包清单无空串", pkLasa.every(x => String(x).trim().length > 0) && pkBj.every(x => String(x).trim().length > 0));
// 去重逻辑：Set 化后结果必须与旧算法一致（顺序稳定）
const eff = T.effortTagOf(p4.days);
assert("G11 effortTagOf 正常", ["轻松慢游", "节奏适中", "紧凑充实", "特种兵"].includes(eff.tag), eff.tag);
assert("G12 spanCityOf 正常", T.spanCityOf(p4.days).text === "北京");
// 每个新城都能建程
let badCity = [];
NEW54.forEach(n => {
  try { const pl = T.buildPlan({ city: T.findCity(n), days: 3, depart: "2026-10-01", pace: "balance" }); if (!Array.isArray(pl) || pl.length !== 3) badCity.push(n); }
  catch (e) { badCity.push(n + ":" + e.message); }
});
assert("G13 54 新城全部可建 3 日行程", badCity.length === 0, badCity.join(","));

/* ========== H. 存储适配器（v1.11 修的静默失效 bug）========== */
// 背景：planner.js 里 getWish/getProfile 原本走 localStorage，小程序没有这个 API，
// 而且 PROFILE_KEY/WISH_KEY 常量也没定义 → ReferenceError 被 try/catch 吞掉 →
// buildPlanDays 中「想玩清单里的景点优先安排（d -= 400）」从未生效。
assert("H1 planner 已无 localStorage 直调", !/localStorage\.getItem/.test(require("fs").readFileSync(new URL("../utils/planner.js", import.meta.url), "utf8")));
assert("H2 P.setStoreAdapter 已导出", typeof P.setStoreAdapter === "function");
// 注入桩后，planner 的 getWish 必须能读到 wx 存储里的想玩清单
mem["miniWishV1"] = [{ name: "故宫", city: "北京" }, { name: "西湖", city: "杭州" }];
const wBack = P.getWish();
assert("H3 P.getWish 读到注入的想玩", Array.isArray(wBack) && wBack.length === 2, JSON.stringify(wBack));
assert("H4 P.isWished 命中想玩项", P.isWished("故宫") === true);
assert("H5 P.isWished 未命中返回 false", P.isWished("不存在的景点XYZ") === false);
// 端到端：把某城市的一个真实景点放进想玩，重新生成行程，它应出现在结果里
const bjCity = T.findCity("北京");
const target = (bjCity.experiences || []).map(e => e.name).find(n => n && !/抵达|返程|出发|入住|退房|自由/.test(n));
let wishHit = false;
if (target) {
  T.toggleWish ? T.toggleWish(target, "北京") : null;
  const plan2 = T.buildPlan({ city: bjCity, days: 3, depart: "2026-10-08", budget: "mid" });
  const flat = JSON.stringify(plan2);
  wishHit = flat.indexOf(target) >= 0;
}
assert("H6 想玩景点被排进生成的行程", !target || wishHit, target || "无候选");
delete mem["miniWishV1"];

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
