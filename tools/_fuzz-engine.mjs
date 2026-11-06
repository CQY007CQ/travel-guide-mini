// 引擎 fuzz：跨参数矩阵跑 buildPlan/buildMultiPlan/buildProvPlan/evaluatePlan，
// 捕获 异常 / 空天 / 越界坐标 / 缺失坐标 / NaN文本 / 评分越界 / 天数截断 等可复现问题。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

const CITIES = ["三沙","漠河","香港","澳门","喀什","拉萨","乌鲁木齐","哈尔滨","三亚","北京","上海","成都","重庆","西安","杭州","广州","深圳","南京","武汉","长沙","苏州","厦门","青岛","丽江","昆明","大理","桂林","黄山","九寨沟","黄龙","武隆","奉节","酉阳","荔波","兴义","那拉提","茫崖","抚远","太原","唐山","芜湖"];
const PACES = ["balance","tight","loose"];
const BUDGETS = ["low","mid","high"];
const MODES = ["train","car","flight"];
const DAYS_LIST = [1,2,3,5,7,10];
const PROVS = T.provinces();

const issues = []; // {type, city, days, pace, budget, mode, detail}
const bump = (o) => issues.push(o);

function scanText(s, tag, ctx) {
  if (typeof s !== "string") return;
  if (/NaN|undefined|null/.test(s)) bump({ type: "TEXT_INTERP", ...ctx, detail: `${tag} 含字面量 NaN/undefined/null: "${s.slice(0,60)}"` });
}

function extractSpots(name) {
  // 形如 出发前往「X」/ 深度游览「X + Y」/ 「Z」看演出
  const re = /「([^」]+)」/g; const out = []; let m;
  while ((m = re.exec(name))) {
    m[1].split(/[+＋]/).forEach(x => {
      const s = x.trim();
      if (!s) return;
      // 酒店片区/枢纽描述（含「｜」或酒店品牌）不是景点，getSpotCoord 返 null 属正常，跳过以免误报
      if (/[｜|]/.test(s) || /酒店|如家|汉庭|7天|青年旅社|全季|亚朵|维也纳|丽枫|希尔顿|香格里拉|凯悦|威斯汀|商圈|高铁站|机场|市中心/.test(s)) return;
      out.push(s);
    });
  }
  return out;
}

function checkDays(days, ctx, reqDays) {
  if (!Array.isArray(days) || !days.length) { bump({ type: "EMPTY_PLAN", ...ctx, detail: "days 空或非数组" }); return; }
  if (reqDays && days.length < reqDays) bump({ type: "DAY_TRUNC", ...ctx, detail: `请求 ${reqDays} 天，实出 ${days.length} 天` });
  const overReq = reqDays && ctx.cap && reqDays > ctx.cap; // 超上限请求导致的空天属预期，不计 bug
  days.forEach((d, di) => {
    if (typeof d.spotCount !== "number" || d.spotCount < 0) bump({ type: "BAD_SPOTCOUNT", ...ctx, detail: `day${di} spotCount=${d.spotCount}` });
    if (d.spotCount === 0 && !overReq && di > 0) bump({ type: "EMPTY_DAY", ...ctx, detail: `day${di} 整天空天 (spotCount=0)` });
    if (!Array.isArray(d.items) || !d.items.length) bump({ type: "NO_ITEMS", ...ctx, detail: `day${di} 无 items` });
    (d.items || []).forEach(it => {
      scanText(it.name, "name", ctx); scanText(it.note, "note", ctx);
      if (it.name) extractSpots(it.name).forEach(sp => {
        let c = null;
        try { c = T.P.getSpotCoord(sp, ctx.cityName || ctx.city); } catch (e) { bump({ type: "COORD_ERR", ...ctx, detail: `getSpotCoord(${sp}) 抛错 ${e.message}` }); }
        if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") bump({ type: "COORD_MISS", ...ctx, detail: `「${sp}」无坐标` });
        else if (c.lat < 16 || c.lat > 54 || c.lon < 73 || c.lon > 136) bump({ type: "COORD_OOB", ...ctx, detail: `「${sp}」越界 lat=${c.lat} lon=${c.lon}` });
      });
    });
  });
  // evaluation
  const ev = days.evaluation;
  if (ev) {
    if (typeof ev.score !== "number" || ev.score < 0 || ev.score > 100) bump({ type: "SCORE_OOB", ...ctx, detail: `score=${ev.score}` });
    if (ev.detail) {
      if (!isFinite(ev.detail.avgDist)) bump({ type: "NAN_DIST", ...ctx, detail: `avgDist=${ev.detail.avgDist}` });
      if (!isFinite(ev.detail.cv)) bump({ type: "NAN_CV", ...ctx, detail: `cv=${ev.detail.cv}` });
    }
  }
}

let total = 0, errs = 0, mt = 0;
const t0 = Date.now();

(async () => {
  await T.ready();
  // 1) buildPlan 全矩阵
  for (const city of CITIES) {
    const c = T.findCity(city); if (!c) { bump({ type: "NO_CITY", city, detail: "findCity 返回空" }); continue; }
    for (const daysN of DAYS_LIST) {
      for (const pace of PACES) {
        for (const budget of BUDGETS) {
          for (const mode of MODES) {
            total++;
            if (total % 200 === 0) process.stderr.write(`  …${total}/${60*DAYS_LIST.length*PACES.length*BUDGETS.length*MODES.length}\n`);
            const cap = T.cityDayCap(c);
            const ctx = { city, cityName: city, days: daysN, pace, budget, mode, cap };
            try {
              const r = T.buildPlan({ city: c, days: daysN, depart: "2027-04-10", budget, pace, travelMode: mode, people: 2 });
              checkDays(r, ctx, daysN);
            } catch (e) { errs++; bump({ type: "EXCEPTION", ...ctx, detail: e.message + " | " + (e.stack||"").split("\n")[1] }); }
          }
        }
      }
    }
  }
  // 2) buildMultiPlan 多站（route 传对象数组，与 app 一致）
  const routes = [
    ["北京","西安","成都"], ["上海","杭州","苏州"], ["拉萨","西安"], ["香港","澳门"],
    ["哈尔滨","漠河"], ["喀什","乌鲁木齐"], ["成都","九寨沟","黄龙"], ["三亚","海口"],
    ["昆明","大理","丽江"], ["重庆","武隆","奉节"], ["贵阳","荔波","兴义"], ["那拉提","乌鲁木齐"]
  ];
  for (const rt of routes) {
    total++;
    const routeObj = rt.map(n => { const c = T.findCity(n); return { name: n, province: (c && c.province) || "", days: 3 }; });
    const ctx = { city: rt.join("→"), cityName: rt[0], days: rt.length*3, pace: "balance", budget: "mid", mode: "train" };
    try {
      const r = T.buildMultiPlan({ route: routeObj, depart: "2027-04-10", budget: "mid", pace: "balance", people: 2 });
      checkDays(r, ctx, rt.length); // segments 模式，day 数≈站数
    } catch (e) { errs++; bump({ type: "EXCEPTION_MULTI", route: rt.join("→"), detail: e.message + " | " + (e.stack||"").split("\n")[1] }); }
  }
  // 3) buildProvPlan 全省游
  for (const pv of PROVS) {
    total++;
    const ctx = { city: pv, cityName: "", days: 5, pace: "balance", budget: "mid", mode: "train", prov: pv };
    try {
      const r = T.buildProvPlan({ province: pv, days: 5, depart: "2027-04-10", budget: "mid", pace: "balance" });
      checkDays(r, ctx, 5);
    } catch (e) { errs++; bump({ type: "EXCEPTION_PROV", prov: pv, detail: e.message + " | " + (e.stack||"").split("\n")[1] }); }
  }

  // 汇总
  const byType = {};
  issues.forEach(i => { byType[i.type] = (byType[i.type]||0)+1; });
  console.log(`\n=== FUZZ 完成 ===`);
  console.log(`调用总数 ${total}；异常 ${errs}；问题条目 ${issues.length}`);
  console.log("按类型:", JSON.stringify(byType, null, 0));
  // 打印代表性样本（每类型最多 8 条）
  const seen = {};
  for (const i of issues) {
    seen[i.type] = (seen[i.type]||0)+1;
    if (seen[i.type] <= 8) console.log(`  [${i.type}] ${i.city||i.prov||i.route||""} d${i.days} ${i.pace}/${i.budget}/${i.mode} :: ${i.detail}`);
  }
  console.log(`耗时 ${(Date.now()-t0)/1000}s`);
  if (issues.length) process.exit(2);
  console.log("✅ 无异常问题");
})().catch(e => { console.error("Fuzz 运行异常:", e); process.exit(1); });
