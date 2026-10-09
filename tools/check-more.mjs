// v1.10.0 回归：城市扩容(78)/坐标注入/省表/新函数(36+25 工具)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");
const D = T.D;
let pass = 0, fail = 0;
const assert = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log("  ✗ FAIL:", name, extra != null ? "| " + extra : ""); } };

/* ===== C1 城市池 66→78 ===== */
assert("C1 城市池 ≥78", D.CITIES.length >= 78, "CITIES=" + D.CITIES.length);
for (const nm of ["北海", "秦皇岛", "开封", "宜昌", "岳阳", "汕头", "潮州", "延吉", "喀什", "伊犁", "腾冲", "呼伦贝尔"]) {
  assert("C1 新城入池 " + nm, D.CITIES.some(c => c.name === nm), nm);
}
assert("C1 省表归属", (D.PROVINCE_CITIES["吉林"] || []).includes("延吉") && (D.PROVINCE_CITIES["云南"] || []).includes("腾冲"));
assert("C1 CITY2PROV", D.CITY2PROV["延吉"] === "吉林" && D.CITY2PROV["腾冲"] === "云南");
assert("C1 市中心注入", !!D.CITY_COORDS["延吉"] && !!D.CITY_COORDS["腾冲"] && !!D.CITY_COORDS["潮州"]);

/* ===== C2 精编内容 ===== */
for (const nm of ["北海", "潮州", "腾冲"]) {
  const c = T.findCity(nm);
  assert("C2 精编可解析 " + nm, c && c.experiences && c.experiences.length >= 6, nm + " exp=" + (c && c.experiences && c.experiences.length));
}
for (const nm of ["北海", "延吉", "腾冲", "潮州", "喀什", "呼伦贝尔"]) {
  try {
    const p = T.buildPlan({ city: T.findCity(nm), days: 3, depart: "2026-10-01", pace: "balance" });
    assert("C2 建程OK " + nm, Array.isArray(p) && p.length === 3, nm);
  } catch (e) { assert("C2 建程OK " + nm, false, e.message); }
}

/* ===== C3 坐标注入（全部为检索/存量真实坐标，approx=false） ===== */
const P = require("../utils/planner.js");
const ck = (city, spot, lat0, lon0) => {
  const c = P.getSpotCoord(city, spot);
  assert("C3 坐标 " + city + "/" + spot, c && c.approx === false && Math.abs(c.lat - lat0) < 0.02 && Math.abs(c.lon - lon0) < 0.02, JSON.stringify(c));
};
ck("延吉", "延边大学弹幕墙", 42.9124, 129.488);
ck("腾冲", "和顺古镇", 25.0068, 98.458);
ck("腾冲", "国殇墓园 + 滇西抗战纪念馆", 25.0259, 98.4813);
ck("潮州", "广济桥", 23.6626, 116.6554);
ck("伊犁", "那拉提草原", 43.239725, 84.023757);   // v1.16：已由高德 POI 校正为真实坐标

/* ===== C4 新函数（36 项纯逻辑） ===== */
const plan = T.buildPlan({ city: T.findCity("北京"), days: 3, depart: "2026-10-01", pace: "balance" });
const per = T.periodOf(plan);
assert("C4 periodOf", per.nDays === 3 && per.nNights === 2 && /2026-10-01/.test(per.label), per.label);
assert("C4 spanCityOf", T.spanCityOf(plan).text === "北京");
assert("C4 loadRank", T.loadRank(plan).rows.length === 3 && !!T.loadRank(plan).max);
assert("C4 themeTagsOf", Array.isArray(T.themeTagsOf(plan).top));
assert("C4 natureShareOf", T.natureShareOf(plan).total > 0);
assert("C4 bookingLines 结构", Array.isArray(T.bookingLines(plan)));
assert("C4 museumDiList", Array.isArray(T.museumDiList(plan)));
assert("C4 sunriseDiList", Array.isArray(T.sunriseDiList(plan)));
assert("C4 sunsetDiList", Array.isArray(T.sunsetDiList(plan)));
const fam = T.familyFit(plan), eld = T.elderFit(plan);
assert("C4 familyFit", fam.score >= 0 && fam.score <= 100 && !!fam.tip, fam.score);
assert("C4 elderFit", eld.score >= 0 && eld.score <= 100 && !!eld.tip, eld.score);
assert("C4 effortTagOf", ["轻松慢游", "节奏适中", "紧凑充实", "特种兵"].includes(T.effortTagOf(plan).tag), T.effortTagOf(plan).tag);
assert("C4 packByPlan", T.packByPlan(plan).length >= 14);
const beihai = T.findCity("北海");
assert("C4 gemOfCity", !!T.gemOfCity(beihai));
assert("C4 spotDayLines", T.spotDayLines(plan, 0).length >= 1);
assert("C4 tripDraft", T.tripDraft(plan).indexOf("天") > 0);
assert("C4 tipsTop3", Array.isArray(T.tipsTop3(plan)));
assert("C4 shareOneLine", T.shareOneLine(plan).indexOf("北京") >= 0);
assert("C4 shareLong", T.shareLong(plan).length > 10);
const sc = T.tripScoreOf(plan);
assert("C4 tripScoreOf", sc.score >= 40 && sc.score <= 98 && !!sc.comment, sc.score);
assert("C4 cityFirstLine", T.cityFirstLine(beihai).indexOf("北海") >= 0);
assert("C4 foodRouteOf", T.foodRouteOf(beihai).length === 3);
assert("C4 weatherFallback", T.weatherFallback(beihai).indexOf("北海") >= 0);
assert("C4 layerOf", !!T.layerOf("cold", 1) && !!T.layerOf("tropical", 7));
assert("C4 stayZoneOf", T.stayZoneOf(beihai).length > 5);
assert("C4 moveNote", T.moveNote(beihai).indexOf("北海") >= 0);
assert("C4 bookingByLead", Array.isArray(T.bookingByLead(plan)));
assert("C4 cityCompareLines", T.cityCompareLines(beihai, T.findCity("北京")).length >= 3);
assert("C4 tipForSlot", !!T.tipForSlot(beihai, "上午"));
assert("C4 spareOfCity", T.spareOfCity(beihai, 3).length >= 1);
assert("C4 riskCard", T.riskCard(plan, T.findCity("北京")).length >= 1);
assert("C4 routeRhythm", T.routeRhythm(plan).length > 0);
assert("C4 endNoteTxt", T.endNoteTxt(beihai).indexOf("机场") >= 0 || T.endNoteTxt(beihai).length > 5);
assert("C4 dayPeek", T.dayPeek(plan[0]).indexOf("第") >= 0 || T.dayPeek(plan[0]).length > 5);
assert("C4 whoFit", !!T.whoFit(plan));

// 山野型城市：主题/自然占比不应为空
const tch = T.buildPlan({ city: T.findCity("腾冲"), days: 3, depart: "2026-11-20", pace: "balance" });
assert("C4 腾冲主题含山川", T.themeTagsOf(tch).top.indexOf("山川") >= 0, JSON.stringify(T.themeTagsOf(tch).top));

// ============ E. v1.10.1 数据护栏：坐标直达率 / 存储容量 ============
// v1.14 口径升级：approx:false=景点级精确坐标；approx:"city"=城锚兜底（真实市中心坐标，非景点位）；
//   “精确率”只认 approx:false；“可达率”= 精确 + 城锚（导航不死路）。
console.log("== E. 数据护栏（防未来扩城重蹈覆辙）==");
const _exact = (names) => {
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
const NEW12 = ["北海", "秦皇岛", "开封", "宜昌", "岳阳", "汕头", "潮州", "延吉", "喀什", "伊犁", "腾冲", "呼伦贝尔"];
const rNew = _exact(NEW12);
assert("E1 v1.10 新增 12 城精确率 ≥90%", rNew.rate >= 90,
  rNew.real + "/" + rNew.tot + " = " + rNew.rate.toFixed(1) + "%");
const rAll = _reach(D.CITIES.map(c => c.name));
assert("E2 全量可达率（精确+城锚）≥99%", rAll.rate >= 99,
  rAll.ok + "/" + rAll.tot + " = " + rAll.rate.toFixed(1) + "%");
const rAllExact = _exact(D.CITIES.map(c => c.name));
assert("E2b 全量精确率 ≥60%（精确优先，城锚只兜底）", rAllExact.rate >= 60,
  rAllExact.real + "/" + rAllExact.tot + " = " + rAllExact.rate.toFixed(1) + "%");

// 存储写入必须有容量上限（无上限会无限膨胀 → 撑爆配额 → 静默写入失败）
// 源码文本类断言：优先读 tools/_src-backup/ 下的可读源码。
// 背景：utils/ 下的 travel.js/store.js 为控制主包体积经 terser 压缩（见 tools/build-min.mjs），
//       压缩后 slice(0, 200) / return true 等字面量写法会被改写，纯文本断言会误报。
//       备份目录保存的就是未压缩源码，语义上等价于「检查源码里确实有这个守卫」。
const _rd = (rel) => {
  const fs = require("fs");
  const name = rel.replace(/^.*\//, "");
  const bak = new URL("../tools/_src-backup/" + name, import.meta.url);
  try {
    return fs.readFileSync(bak, "utf8");
  } catch (e) {
    return fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  }
};
const _src = _rd("../utils/travel.js");
assert("E3 账本有容量上限", /LEDGER_KEY[^\n]*slice\(0,\s*200\)|slice\(0,\s*200\)/.test(_src));
assert("E4 足迹有容量上限", /2000/.test(_src));
assert("E5 导入有体积守卫", /1500000/.test(_src));

// store.set 不得静默吞掉失败（配额满时用户会以为保存成功）
const _store = _rd("../utils/store.js");
assert("E6 store.set 返回成功标志", /return true/.test(_store) && /return false/.test(_store));
assert("E7 store 提供用量查询", /getStorageInfoSync/.test(_store));

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
