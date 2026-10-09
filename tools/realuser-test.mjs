// 真实用户视角回归：模拟不同用户生成行程，从"人能感知"的维度挑刺
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");
const P = require("../utils/planner.js");

const PERIOD_ORDER = { "": 0, "上午": 1, "中午": 2, "下午": 3, "傍晚": 4, "晚上": 5, "全天": 1 };
function isFrame(n){ return P.isFrameName ? P.isFrameName(n) : /(抵达|出发前往|返程|自由活动|休息|退房|前往)/.test(n); }

function analyzePlan(days, label){
  const issues = [];
  const seen = new Map(); // name -> count
  let realSpots = 0, frameDays = 0, noCoord = 0, totalSpots = 0;
  days.forEach((d, di) => {
    const items = (d.items||[]);
    // 时段单调
    let last = 0, prevName = null;
    const dayReal = [];
    items.forEach(it => {
      if (!it || !it.name) return;
      totalSpots++;
      const per = PERIOD_ORDER[it.period] ?? 0;
      if (per < last) issues.push(`D${di+1} 时段倒挂：${prevName}(${it.period}) 后接 ${it.name}(${it.period})`);
      last = per; prevName = it.name;
      if (isFrame(it.name)) return;
      realSpots++; dayReal.push(it.name);
      seen.set(it.name, (seen.get(it.name)||0)+1);
      if (it.coord === null || it.approx === null || it.approx === "city") noCoord++;
    });
    if (dayReal.length === 0) { frameDays++; issues.push(`D${di+1} 整天空泛（无真实景点）`); }
  });
  // 重复景点（跨天）
  for (const [n,c] of seen) if (c>1) issues.push(`景点重复 ${c} 次：${n}`);
  // 首尾框架
  const first = (days[0]?.items||[]).map(i=>i.name);
  const last = (days[days.length-1]?.items||[]).map(i=>i.name);
  if (!first.some(isFrame)) issues.push(`首日无抵达框架`);
  if (!last.some(n=>/返程|出发前往/.test(n))) issues.push(`末日无返程框架`);
  return { label, days: days.length, realSpots, frameDays, noCoord, totalSpots,
           dup: [...seen].filter(([n,c])=>c>1).map(([n,c])=>`${n}×${c}`), issues };
}

const scenarios = [
  ["热门·北京4天", () => T.buildPlan({city:"北京", days:4, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["热门·苏州5天", () => T.buildPlan({city:"苏州", days:5, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["长尾·芜湖3天(新数据)", () => T.buildPlan({city:"芜湖", days:3, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["长尾·宿州2天(修复城)", () => T.buildPlan({city:"宿州", days:2, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["小城·拉萨7天", () => T.buildPlan({city:"拉萨", days:7, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["极限·单天1天", () => T.buildPlan({city:"成都", days:1, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["极限·小城14天", () => T.buildPlan({city:"芜湖", days:14, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["全省·山西8天", () => T.buildProvPlan({province:"山西", days:8, depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["多站·北京2+西安2", () => T.buildMultiPlan({route:[{name:"北京",province:"北京",days:2},{name:"西安",province:"陕西",days:2}], depart:"2026-10-01", budget:"mid", pace:"balance"})],
  ["特种兵·重庆3天", () => T.buildPlan({city:"重庆", days:3, depart:"2026-10-01", budget:"mid", pace:"intense"})],
];

let allIssues = 0;
for (const [label, fn] of scenarios) {
  let r;
  try { r = fn(); }
  catch(e){ console.log(`\n【${label}】❌ 生成抛错: ${e.message}`); allIssues++; continue; }
  const days = Array.isArray(r) ? r : (r.days||[]);
  const a = analyzePlan(days, label);
  console.log(`\n【${label}】天数=${a.days} 真实景点=${a.realSpots} 空泛日=${a.frameDays} 无坐标=${a.noCoord} 总节点=${a.totalSpots}`);
  if (a.dup.length) console.log(`   重复: ${a.dup.join(", ")}`);
  if (a.issues.length){ a.issues.forEach(i=>console.log(`   ⚠️ ${i}`)); allIssues += a.issues.length; }
  else console.log(`   ✓ 结构健康`);
}
console.log(`\n══ 共发现可感知问题 ${allIssues} 处 ══`);
