const T = require("../utils/travel.js");
const D = require("../utils/data.js");
const DEP = "2026-10-01";

console.log("===== E：dayAddSpot 崩溃复现 =====");
try {
  let plan = { cityName: "成都", days: T.buildPlan({ city: "成都", days: 3, depart: DEP }) };
  console.log("初始 plan.days:", plan.days.length, "| plan 键:", Object.keys(plan).join(","));
  for (let k = 0; k < 3; k++) {
    const r = T.dayAddSpot(plan, 0, "宽窄巷子");
    console.log("第" + (k + 1) + "轮 dayAddSpot 返回:", r === null ? "null" : (Array.isArray(r.days) ? "plan(" + r.days.length + "天)" : typeof r));
    if (!r) break;
    plan = r;
  }
  console.log("dayAddCandidates(plan,0) 前3:", JSON.stringify((T.dayAddCandidates(plan, 0) || []).slice(0, 3)));
} catch (e) {
  console.log("崩溃:", e.message, "\n", (e.stack || "").split("\n").slice(1, 4).join("\n"));
}

console.log("\n===== E2：不带 name 调用 =====");
try {
  const plan = { cityName: "成都", days: T.buildPlan({ city: "成都", days: 3, depart: DEP }) };
  const r = T.dayAddSpot(plan, 0);
  console.log("无 name 返回:", r === null ? "null" : "plan");
} catch (e) { console.log("崩溃:", e.message); }

console.log("\n===== C：多站联游空天复现 =====");
for (const route of [["北京", "上海"], ["成都", "重庆", "西安"], ["三亚", "海口"], ["太原", "大同", "平遥"], ["乌鲁木齐", "喀什"]]) {
  const out = T.buildMultiPlan({ route: route.map(n => ({ name: n, province: T.D.CITY2PROV[n] || "", days: 3 })), depart: DEP });
  const days = out && (out.days || out);
  const empty = [];
  (days || []).forEach((day, i) => {
    const FILL = /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/;
    const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
    const real = (day.items || []).filter(it => it.name && !FRAME.test(it.name) && !FILL.test(it.name));
    if (!real.length) empty.push(i + 1);
  });
  console.log(route.join("+"), "共", (days || []).length, "天 | 空天:", empty.length ? empty.map(d => "D" + d).join(",") : "无");
}

console.log("\n===== 单城游：景点数与天数上限 =====");
for (const n of ["芜湖", "唐山", "佛山", "北京", "成都", "三亚", "天津"]) {
  const c = D.CITIES.find(x => x.name === n);
  console.log(n.padEnd(4), "景点", String((c.experiences || []).length).padStart(2), "| 建议", T.cityBrief(n).days, "天 | 14 天时:");
  const out = T.buildPlan({ city: n, days: 14, depart: DEP });
  let blank = 0;
  out.forEach(d => {
    const FILL = /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/;
    const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
    const real = (d.items || []).filter(it => it.name && !FRAME.test(it.name) && !FILL.test(it.name));
    if (!real.length) blank++;
  });
  console.log("      实得", out.length, "天，其中", blank, "天空白");
}
