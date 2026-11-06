// 工具箱函数 fuzz：遍历 toolkit.js 调用的全部 T.* 城市/行程函数，
// 跨 多城（含数据稀疏城）+ 无行程(city-only) 跑，捕获 异常 / NaN / undefined 文本泄漏。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

const issues = [];
const bump = (o) => issues.push(o);
function scanObj(v, path, ctx) {
  if (typeof v === "string") { if (/NaN|undefined|\[object/.test(v)) bump({ type: "TEXT_LEAK", ...ctx, detail: `${path}: ${v.slice(0,60)}` }); }
  else if (typeof v === "number") { if (!isFinite(v)) bump({ type: "BAD_NUM", ...ctx, detail: `${path}: ${v}` }); }
  else if (Array.isArray(v)) { if (v.length>3000) return; v.forEach((x,i)=>scanObj(x,path+"["+i+"]",ctx)); }
  else if (v && typeof v==="object") { const ks=Object.keys(v); if(ks.length>300) return; ks.forEach(k=>scanObj(v[k],path+"."+k,ctx)); }
}
function scanStr(s, ctx){ if(typeof s==="string" && /NaN|undefined/.test(s)) bump({type:"TEXT_LEAK",...ctx,detail:s.slice(0,60)}); }

// toolkit.js 中引用的全部 T.* 调用（按签名归类：plan 类 / city 类）
const PLAN_FNS = ["periodOf","spanCityOf","themeTagsOf","effortTagOf","tripScoreOf","loadRank","routeRhythm","tipsTop3","bookingByLead","museumDiList","sunriseDiList","sunsetDiList","riskCard","tripDraft","shareOneLine","shareLong","starMoments","dayPeek","cityFirstLine","gemOfCity","foodRouteOf","stayZoneOf","moveNote","weatherFallback","layerOf","spareOfCity","whoFit","endNoteTxt","bestTravelMonth","seasonWeather","rainLikely","typhoonHint","altitudeRisk","sunBlockHint","medKitList","scamAlertOf","localTabooOf","festivalOf","spicyLevelOf","foodBudgetOf","foodTop3","foodStreetOf","giftIdea","photoSpotOf","nearbyCities","valueScoreOf","localEtiquette","souvenirOf","mistakeChecklist","crowdAvoid","nightLifeList","rainyDayPlan","dayHighlight","itineraryDensity","ticketTotal","tripPhaseGuide","burnRate","costBreakdown"];
const CITY_FNS = ["bestTravelMonth","seasonWeather","rainLikely","typhoonHint","altitudeRisk","sunBlockHint","medKitList","scamAlertOf","localTabooOf","festivalOf","spicyLevelOf","foodBudgetOf","foodTop3","foodStreetOf","giftIdea","photoSpotOf","nearbyCities","valueScoreOf","localEtiquette","souvenirOf","mistakeChecklist","cityFirstLine","gemOfCity","foodRouteOf","stayZoneOf","moveNote","weatherFallback","layerOf","spareOfCity","endNoteTxt","nextCitySuggest","storageHealth"];

const CITIES = ["北京","上海","成都","西安","重庆","杭州","三亚","拉萨","漠河","三沙","黄龙","奉节","太原","香港","澳门","乌鲁木齐"];

async function run() {
  await T.ready();
  let total = 0;
  const planByCity = {};
  for (const c of CITIES) {
    const city = T.findCity(c); if (!city) { bump({type:"NO_CITY",city:c}); continue; }
    let plan = null;
    try { plan = T.buildPlan({ city, days: 5, depart:"2027-04-10", budget:"mid", pace:"balance" }); } catch(e){ bump({type:"EXC_BUILD",city:c,detail:e.message}); }
    planByCity[c] = plan;
    // city-only 函数（无行程也跑，toolkit 在 city 兜底时也会调）
    for (const fn of CITY_FNS) {
      if (typeof T[fn] !== "function") { bump({type:"MISSING_FN",fn,ctx:c}); continue; }
      total++;
      try {
        const r = T[fn](city, 4);
        scanObj(r, fn, {city:c, fn});
      } catch (e) { bump({ type:"EXC_CITYFN", city:c, fn, detail:e.message }); }
    }
    // plan 类函数（有行程）
    if (plan) {
      for (const fn of PLAN_FNS) {
        if (typeof T[fn] !== "function") continue;
        total++;
        try { const r = T[fn](plan, 0); scanObj(r, fn, {city:c, fn}); }
        catch (e) { bump({ type:"EXC_PLANFN", city:c, fn, detail:e.message }); }
      }
    }
  }

  // 无行程 + city-only 函数（fallback 北京），plan 类函数传空 plan
  const bj = T.findCity("北京");
  for (const fn of CITY_FNS) { if(typeof T[fn]!=="function") continue; total++; try{ const r=T[fn](bj,4); scanObj(r,fn,{city:"北京-empty",fn}); }catch(e){ bump({type:"EXC_CITYFN",city:"北京-empty",fn,detail:e.message}); } }
  for (const fn of ["whoFit","tripPhaseGuide"]) { total++; try{ const r=T[fn]({days:[]}, 0); scanObj(r,fn,{edge:"emptyPlan",fn}); }catch(e){ bump({type:"EXC_PLANFN",edge:"emptyPlan",fn,detail:e.message}); } }

  const byType={}; issues.forEach(i=>{byType[i.type]=(byType[i.type]||0)+1;});
  console.log(`\n=== TOOLKIT FUZZ 完成 ===`);
  console.log(`调用 ${total}；问题 ${issues.length}`);
  console.log("按类型:", JSON.stringify(byType));
  const seen={};
  for(const i of issues){ seen[i.type]=(seen[i.type]||0)+1; if(seen[i.type]<=8) console.log(`  [${i.type}] ${i.city||i.edge||""} ${i.fn||""} :: ${i.detail}`); }
  if(issues.length) process.exit(2);
  console.log("✅ 工具箱函数无异常");
}
run().catch(e=>{ console.error("Fuzz 异常:", e); process.exit(1); });
