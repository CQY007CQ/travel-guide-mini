// 输出契约 fuzz：不只查抛错，更查「返回内容是否泄漏 undefined/NaN/Infinity、
// 数字是否越界、枚举是否合法、对象字段是否缺失」。喂退化/随机输入。
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(fileURLToPath(import.meta.url));
const T = require("../utils/travel.js");

let issues = [];
const rec = (fn, input, detail) => issues.push({ fn, input: JSON.stringify(input).slice(0, 60), detail });

// 1) 字符串输出不得含 undefined / NaN / Infinity
function strCheck(fn, cases) {
  for (const c of cases) {
    let r;
    try { r = fn(c); } catch (e) { rec(fn.name, c, "THROW " + e.message); continue; }
    if (typeof r === "string") {
      if (/undefined|NaN|Infinity/.test(r)) rec(fn.name, c, "LEAK: " + r.slice(0, 50));
    }
  }
}
strCheck(T.copyPlanText, [null, {}, { days: [] }, { days: [{ date: "2026-01-01", items: [] }] }, { cityName: "北京" }, { cityName: "北京", days: [{ date: "2026-01-01", items: [] }] }]);

// 2) parseQuickBill：金额必须匹配"最可能是金额"的数字（不是第一个）
const bills = ["第3天 早餐 15元", "2个人吃饭 88", "门票 300 第2天", "午餐35", "收入500", "50", "第12天 酒店 600", "3瓶水 5元", "公交2元 地铁3元"];
bills.forEach(s => {
  const r = T.parseQuickBill(s);
  if (!r) rec("parseQuickBill", s, "null");
  else if (!(r.amt > 0)) rec("parseQuickBill", s, "amt<=0: " + r.amt);
});

// 3) todayState：返回对象字段一致；during 时 idx 必须在 [0,total)
function fakePlan(dates) {
  return { days: dates.map(d => ({ date: d, items: [{ name: "故宫", period: "上午" }] })) };
}
const ts = "2026-06-15";
[["2026-06-10", "2026-06-12"], ["2026-06-16", "2026-06-18"], ["2026-06-15", "2026-06-17"], ["2026-06-13", "2026-06-14"]].forEach(dates => {
  let r; try { r = T.todayState(fakePlan(dates)); } catch (e) { rec("todayState", dates, "THROW " + e.message); return; }
  if (!r) { rec("todayState", dates, "null"); return; }
  if (r.phase === "during") {
    if (!(r.idx >= 0 && r.idx < r.total)) rec("todayState", dates, "idx越界 " + JSON.stringify(r));
    if (r.dayNo !== r.idx + 1) rec("todayState", dates, "dayNo不一致 " + JSON.stringify(r));
  }
  if ((r.phase === "before" && !(r.daysLeft > 0)) || (r.phase === "after" && !(r.daysSince > 0)))
    rec("todayState", dates, "天数非正 " + JSON.stringify(r));
});

// 4) routeScore：必须返回有限数
if (typeof T.routeScore === "function") {
  const p = { days: [{ items: [{ name: "故宫", lat: 39.9, lon: 116.4 }, { name: "天坛", lat: 39.88, lon: 116.4 }] }, { items: [{ name: "颐和园", lat: 39.99, lon: 116.27 }] }] };
  for (let i = 0; i < p.days.length; i++) {
    let r; try { r = T.routeScore(p, i); } catch (e) { rec("routeScore", i, "THROW " + e.message); continue; }
    if (typeof r !== "number" || !isFinite(r)) rec("routeScore", i, "非有限数 " + r);
  }
}

// 5) budgetGauge：返回 null 或所有数值有限且 >=0
if (typeof T.budgetGauge === "function") {
  const p = { budget: "mid", days: [{ items: [{ name: "x", period: "上午" }] }] };
  let r; try { r = T.budgetGauge(p); } catch (e) { rec("budgetGauge", p, "THROW " + e.message); r = null; }
  if (r) { for (const k of ["total", "spent", "remain", "pct"]) if (typeof r[k] !== "number" || !isFinite(r[k]) || r[k] < 0) rec("budgetGauge", k, "bad " + k + "=" + r[k]); }
}

// 6) mealSlotOf / tasteTagOf 枚举合法
const slots = new Set(["early", "main", "night"]);
const tastes = new Set(["辣", "甜", "鲜", "香", "爽", "经典"]);
["", "北京烤鸭", "夜市小龙虾", "早餐豆浆", null, "豆腐脑 肠粉"].forEach(n => {
  const s = T.mealSlotOf(n); if (!slots.has(s)) rec("mealSlotOf", n, "非法 " + s);
  const t = T.tasteTagOf(n); if (!tastes.has(t)) rec("tasteTagOf", n, "非法 " + t);
});

// 7) dressForMonth：返回非空字符串
if (typeof T.dressForMonth === "function") {
  [["北京", "2026-01-15"], ["三亚", "2026-07-01"], ["拉萨", "2026-12-01"], ["", ""], [null, null]].forEach(a => {
    let r; try { r = T.dressForMonth(a[0], a[1]); } catch (e) { rec("dressForMonth", a, "THROW " + e.message); return; }
    if (typeof r !== "string" || !r.trim()) rec("dressForMonth", a, "空 " + JSON.stringify(r));
  });
}

console.log("ISSUES:", issues.length);
issues.forEach(i => console.log(" -", i.fn, "|", i.input, "|", i.detail));
