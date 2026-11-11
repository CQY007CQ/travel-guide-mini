// 辅助函数 fuzz：遍历页面调用的 travel.js 工具函数，喂正常行程 + 边界（null/空行程/缺失城市），
// 捕获 异常 / NaN / undefined 文本泄漏 / 数值非有限。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

const issues = [];
const bump = (o) => issues.push(o);

function scanObj(v, path, ctx) {
  if (typeof v === "string") {
    if (/NaN|undefined|\[object/.test(v)) bump({ type: "TEXT_LEAK", ...ctx, detail: `${path}: "${v.slice(0,70)}"` });
  } else if (typeof v === "number") {
    if (!isFinite(v)) bump({ type: "BAD_NUM", ...ctx, detail: `${path}: ${v}` });
  } else if (Array.isArray(v)) {
    if (v.length > 2000) return;
    v.forEach((x, i) => scanObj(x, path + "[" + i + "]", ctx));
  } else if (v && typeof v === "object") {
    const ks = Object.keys(v);
    if (ks.length > 200) return;
    ks.forEach(k => scanObj(v[k], path + "." + k, ctx));
  }
}
function scanTextOnly(s, ctx) { if (typeof s === "string" && /NaN|undefined/.test(s)) bump({ type: "TEXT_LEAK", ...ctx, detail: s.slice(0,70) }); }

const CITIES = ["北京","上海","成都","西安","重庆","杭州","三亚","拉萨","漠河","三沙","黄龙","奉节","太原","香港","澳门"];

async function run() {
  await T.ready();
  const S = req("./utils/store.js");
  let total = 0;

  // 1) 正常行程上跑各辅助函数
  for (const c of CITIES) {
    const city = T.findCity(c); if (!city) continue;
    for (const days of [1,3,5,7]) {
      for (const pace of ["balance","leisure"]) {
        let plan;
        try { plan = T.buildPlan({ city, days, depart: "2027-04-10", budget: "mid", pace }); }
        catch (e) { bump({ type: "EXC_BUILD", city:c, days, detail:e.message }); continue; }
        const ctx = { city:c, days };
        total++;
        const fns = {
          todayState: () => T.todayState(plan),
          activeCityOf: () => T.activeCityOf(plan),
          budgetGauge: () => T.budgetGauge(plan),
          packSmart: () => T.packSmart(plan),
          copyPlanText: () => T.copyPlanText(plan),
          exportICS: () => T.exportICS(plan),
          routeScore: () => T.routeScore(plan, 0),
          tomorrowPeek: () => T.tomorrowPeek(plan),
          todayGear: () => T.todayGear(plan),
          evaluation: () => plan.evaluation,
          cityBrief: () => T.cityBrief(c),
          foodSpotsFor: () => T.foodSpotsFor(c),
          hotelAreaPins: () => T.hotelAreaPins(c, "mid"),
          hotelPortals: () => T.hotelPortals(c, plan),
          recommendCities: () => T.recommendCities ? T.recommendCities({ city:c, days }) : null,
        };
        for (const [name, fn] of Object.entries(fns)) {
          try {
            const r = fn();
            scanObj(r, name, { ...ctx, fn: name });
          } catch (e) { bump({ type: "EXC_FN", ...ctx, fn: name, detail: e.message }); }
        }
        // spotTagOf 每个景点
        try {
          plan.forEach(d => (d.items||[]).forEach(it => {
            if (!T.isFrameName(it.name)) { const tg = T.spotTagOf(T.cleanSpotName(it.name)||it.name, c); if (tg && !Array.isArray(tg)) bump({ type:"BAD_TAG", ...ctx, detail: it.name }); }
          }));
        } catch (e) { bump({ type: "EXC_TAG", ...ctx, detail: e.message }); }
        // swapSpotFor 试一次（每项换一个）
        try {
          const d0 = plan[0];
          if (d0 && d0.items && d0.items.length) T.swapSpotFor(plan, 0, 0);
        } catch (e) { bump({ type: "EXC_SWAP", ...ctx, detail: e.message }); }
        // mealSlotOf / tasteTagOf / navTarget
        try {
          plan.forEach(d => (d.items||[]).forEach(it => { T.mealSlotOf((it.name||"")+" x"); T.tasteTagOf(it.name||""); }));
        } catch (e) { bump({ type: "EXC_SLOT", ...ctx, detail: e.message }); }
      }
    }
  }

  // 2) 边界：null / 空行程 / days=[] 上跑「行程态」类函数（页面无行程时也会调）
  const edge = { null: null, empty: {}, noDays: { days: [], cityName: "北京" }, sparse: { days: [{ items: [] }], cityName: "北京" } };
  for (const [name, pl] of Object.entries(edge)) {
    const ctx = { edge: name };
    total++;
    for (const fnName of ["todayState","activeCityOf","budgetGauge","packSmart","copyPlanText","exportICS","routeScore","tomorrowPeek","todayGear"]) {
      try { const r = T[fnName](pl, 0); scanObj(r, fnName, ctx); }
      catch (e) { bump({ type: "EXC_EDGE", ...ctx, fn: fnName, detail: e.message }); }
    }
  }

  // 3) spotLookup / askAssistant：空行程 + 怪 query
  for (const [name, pl] of Object.entries(edge)) {
    const ctx = { edge: name + "(qa)" };
    total++;
    for (const q of ["故宫","xyz不存在的地方","", " ","长城 门票"]) {
      try { const r = T.spotLookup(q, "北京"); scanObj(r, "spotLookup:"+q, ctx); } catch(e){ bump({type:"EXC_LOOKUP",...ctx,q,detail:e.message}); }
      try { const r = T.askAssistant(q, pl); scanObj(r, "askAssistant:"+q, ctx); } catch(e){ bump({type:"EXC_ASK",...ctx,q,detail:e.message}); }
    }
  }

  // 4) 缺失城市 / 无数据城市
  for (const c of ["不存在城XYZ","", null]) {
    const ctx = { missingCity: String(c) };
    total++;
    try { scanObj(T.foodSpotsFor(c), "foodSpotsFor", ctx); } catch(e){ bump({type:"EXC_FOOD",...ctx,detail:e.message}); }
    try { scanObj(T.hotelAreaPins(c, "mid"), "hotelAreaPins", ctx); } catch(e){ bump({type:"EXC_HOTEL",...ctx,detail:e.message}); }
    try { const r = T.spotLookup("故宫", c); scanObj(r, "spotLookupNullCity", ctx); } catch(e){ bump({type:"EXC_LOOKUP2",...ctx,detail:e.message}); }
  }

  const byType = {};
  issues.forEach(i => { byType[i.type] = (byType[i.type]||0)+1; });
  console.log(`\n=== HELPER FUZZ 完成 ===`);
  console.log(`调用批次 ${total}；问题 ${issues.length}`);
  console.log("按类型:", JSON.stringify(byType));
  const seen = {};
  for (const i of issues) {
    seen[i.type] = (seen[i.type]||0)+1;
    if (seen[i.type] <= 6) console.log(`  [${i.type}] ${i.city||i.edge||i.missingCity||""} ${i.fn||i.q||""} :: ${i.detail}`);
  }
  if (issues.length) process.exit(2);
  console.log("✅ 辅助函数无异常");
}
run().catch(e => { console.error("Fuzz 运行异常:", e); process.exit(1); });
