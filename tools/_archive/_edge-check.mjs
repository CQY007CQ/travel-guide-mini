// 边角用例静态核查：对纯函数喂退化/异常输入，看是否有抛错或 undefined/NaN 泄漏
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const issues = [];
const bump = (o) => issues.push(o);

await T.ready();

// 1) copyPlanText 退化行程
try {
  const r1 = T.copyPlanText({ days: [], cityName: "北京" });
  if (/undefined|NaN/.test(r1)) bump({ f: "copyPlanText", in: "{days:[],cityName:北京}", out: r1.slice(0, 40) });
  const r2 = T.copyPlanText(null);
  if (r2 !== "") bump({ f: "copyPlanText", in: "null", out: JSON.stringify(r2) });
  const r3 = T.copyPlanText({ days: [{ date: new Date(), items: [] }], cityName: "上海" });
  if (/undefined|NaN/.test(r3)) bump({ f: "copyPlanText", in: "无totalDays/depart", out: r3.slice(0, 60) });
} catch (e) { bump({ f: "copyPlanText", in: "various", err: e.message }); }

// 2) clampDepart 异常输入
for (const d of ["", "2026-13-40", "abc", "2026-2-30", "2026-1-1", "2030-01-01", null, undefined]) {
  try {
    const r = T.clampDepart(d);
    if (d && r === d) { /* 合法保持 */ }
  } catch (e) { bump({ f: "clampDepart", in: JSON.stringify(d), err: e.message }); }
}

// 3) parseQuickBill
for (const s of ["打车 32", "32", "餐饮 58.5", "", "abc", "12.3.4", "  ", "火锅 一人 88"]) {
  try { const r = T.parseQuickBill(s); }
  catch (e) { bump({ f: "parseQuickBill", in: JSON.stringify(s), err: e.message }); }
}

// 4) todayState / budgetGauge / dressForMonth 退化
try { const r = T.todayState({}); if (r === undefined) bump({ f: "todayState", in: "{}", out: "undefined" }); } catch (e) {}
try { const r = T.budgetGauge({ budget: "mid" }); if (!r || typeof r.pct !== "number" || isNaN(r.pct)) bump({ f: "budgetGauge", in: "{budget:mid}", out: JSON.stringify(r) }); } catch (e) {}
try { const c = T.findCity("北京"); const r = T.dressForMonth(c, "2026-10-01"); } catch (e) { bump({ f: "dressForMonth", in: "北京/2026-10-01", err: e.message }); }

// 5) routeScore 退化
try { const r = T.routeScore({ days: [] }, 0); } catch (e) { bump({ f: "routeScore", in: "空days", err: e.message }); }
try { const r = T.routeScore(null, 0); } catch (e) { bump({ f: "routeScore", in: "null", err: e.message }); }

// 6) cityDayCap 对象 vs 字符串一致性（确认缓存键 bug 是否真实影响）
try {
  const c = T.findCity("北京");
  const a = T.cityDayCap(c, "balance");
  const b = T.cityDayCap("北京", "balance");
  if (a !== b) bump({ f: "cityDayCap", in: "北京/对象vs字符串", out: `obj=${a} str=${b}` });
} catch (e) { bump({ f: "cityDayCap", in: "北京", err: e.message }); }

// 7) tripPhaseGuide 无行程
try { const r = T.tripPhaseGuide({ days: [] }); if (typeof r.days !== "number" || isNaN(r.days)) bump({ f: "tripPhaseGuide", in: "无行程", out: "days=" + r.days }); } catch (e) {}

console.log(JSON.stringify(issues, null, 2));
console.log("issues:", issues.length);
