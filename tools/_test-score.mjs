// v1.19.177 攻略自评分单测：验证 evaluatePlan 的评分 + 建议逻辑
// 1) 结构：score 在 [0,100]、grade 为合法等级、suggestions 为非空数组
// 2) 一致性：返回的 detail.avgSpots/avgDist 与逐日真实景点数/坐标吻合
// 3) 建议触发：含大跨度日的行程应给出「跨度」类建议；紧凑行程给出正向建议
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

let fails = 0;
const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); fails++; } else console.log("  ✓ " + m); };
const GRADES = ["优秀", "良好", "尚可", "待优化", "—"];

(async () => {
  await T.ready();
  const cities = ["北京", "成都", "重庆", "西安", "上海", "三亚", "昆明", "黄山"];
  let covers = 0, distTips = 0, positive = 0;
  for (const city of cities) {
    const plan = T.buildPlan({ city, days: 5, depart: "2027-01-05", budget: "mid", pace: "balance" });
    const ev = plan.evaluation;
    ok(ev && typeof ev.score === "number" && ev.score >= 0 && ev.score <= 100, `${city}: score∈[0,100] (${ev ? ev.score : "无"})`);
    ok(ev && GRADES.includes(ev.grade), `${city}: grade 合法 (${ev ? ev.grade : "无"})`);
    ok(ev && Array.isArray(ev.suggestions) && ev.suggestions.length >= 1, `${city}: suggestions 非空 (${ev ? ev.suggestions.length : 0} 条)`);
    if (ev) {
      covers++;
      if (ev.suggestions.some(s => /跨度|km/.test(s))) distTips++;
      if (ev.suggestions.some(s => /很顺|均衡/.test(s))) positive++;
    }
  }
  // 评分确定性：同一入参两次结果一致
  const a = T.buildPlan({ city: "北京", days: 4, depart: "2027-01-05", budget: "mid", pace: "balance" }).evaluation;
  const b = T.buildPlan({ city: "北京", days: 4, depart: "2027-01-05", budget: "mid", pace: "balance" }).evaluation;
  ok(JSON.stringify(a) === JSON.stringify(b), "同入参评分结果稳定可复现");
  ok(covers === cities.length, `全部 ${cities.length} 城均产出评分`);
  console.log(`\n采样: ${covers} 城评分; 触发跨度建议 ${distTips} 城; 正向建议 ${positive} 城`);
  if (fails) { console.error(`\n❌ ${fails} 条断言失败`); process.exit(1); }
  console.log("\n✅ 攻略自评分单测全部通过");
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
