// v1.19.182 批量生成冒烟门禁
// 目的：用「多城 × 多天数 × 多节奏」的批量 buildPlan，统计
//   ① 生成异常率（任何城市/天数/节奏组合不得抛错）
//   ② 空天率（第 2..N 天必须都含真景点，呼应 _scan-sparse 全量门禁的抽样版）
//   ③ 攻略自评分分布（evaluatePlan 不得出现 NaN / 越界，整体均值给出可监控基线）
// 抽样城市兼顾热门城与历史稀疏县（黄龙/酉阳/抚远/漠河/茫崖），覆盖不同数据密度。
// 「已填」判定口径与 cityDayCap 的 _planDayFilled 一致：当天存在任一非框架 item 即已填。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

function dayFilled(day) {
  if (!day || !Array.isArray(day.items)) return false;
  return day.items.some(it => it && typeof it.name === "string" && !T.isFrameName(it.name));
}

const CITIES = ["北京","上海","成都","西安","重庆","杭州","三亚","昆明","拉萨","黄山",
  "哈尔滨","乌鲁木齐","青岛","大理","香港","澳门","厦门","桂林","黄龙","酉阳","抚远","漠河","茫崖"];
const DAYS = [3, 5, 7];
const PACES = ["speed", "balance", "leisure"];

let fails = 0;
let builds = 0, errs = 0, emptyDays = 0, totalDays = 0;
const scores = [];
const RED = [];

(async () => {
  await T.ready();
  for (const city of CITIES) {
    const co = (D.CITIES || []).find(c => c.name === city);
    if (!co) { console.error("  ⚠ 跳过未收录城市 " + city); continue; }
    for (const days of DAYS) {
      for (const pace of PACES) {
        // cityDayCap 是按「城市+节奏」分别取上限的（v1.19.170）：必须按当前节奏各自截断，
        // 否则 speed/leisure 在 balance 上限天数下会生成空天末日（非回归，是截断口径错配）。
        let cap = 2; try { cap = T.cityDayCap(city, pace); } catch (e) { cap = 2; }
        const realDays = Math.max(2, Math.min(days, cap));
        builds++;
        let plan;
        try { plan = T.buildPlan({ city, days: realDays, depart: "2027-04-05", budget: "mid", pace }); }
        catch (e) { errs++; console.error("  ✗ " + city + " " + realDays + "天/" + pace + " 生成异常: " + e.message); fails++; continue; }
        if (!Array.isArray(plan) || !plan.length) { errs++; console.error("  ✗ " + city + " " + realDays + "天/" + pace + " 空行程"); fails++; continue; }
        const ev = plan.evaluation;
        if (!ev || typeof ev.score !== "number" || ev.score < 0 || ev.score > 100) {
          console.error("  ✗ " + city + " " + realDays + "天/" + pace + " 评分异常"); fails++;
        } else scores.push(ev.score);
        for (let i = 0; i < plan.length; i++) {
          totalDays++;
          if (i >= 1 && !dayFilled(plan[i])) {
            emptyDays++; RED.push(city + " D" + (i + 1));
          }
        }
      }
    }
  }
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const min = scores.length ? Math.min.apply(null, scores) : 0;
  const max = scores.length ? Math.max.apply(null, scores) : 0;
  console.log("\n构建 " + builds + " 次 / 异常 " + errs + " / 总天数 " + totalDays + " / 空天 " + emptyDays);
  console.log("评分: 均值 " + avg.toFixed(1) + " / 最低 " + min + " / 最高 " + max + " (样本 " + scores.length + ")");
  if (RED.length) console.log("空天红榜: " + RED.slice(0, 20).join("、") + (RED.length > 20 ? " …" : ""));

  const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); fails++; } else console.log("  ✓ " + m); };
  ok(errs === 0, "全部组合生成零异常");
  ok(emptyDays === 0, "全部非抵达日均含真景点（空天率 0）");
  ok(avg >= 40, "整体自评分均值 ≥ 40（基线监控，当前 " + avg.toFixed(1) + "）");
  if (fails) { console.error("\n❌ 批量冒烟 " + fails + " 项未达标"); process.exit(1); }
  console.log("✅ 批量生成冒烟通过");
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
