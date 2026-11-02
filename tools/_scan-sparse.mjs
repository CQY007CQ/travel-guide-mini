// v1.19.182 全量城市空天 / 稀疏扫描门禁
// 目的：把「某城某天数行程出现空天（整天无真景点，只剩抵达/退房/自由活动/返程）」这类退化，
// 从「靠压测偶然抓到」升级为「全量 751 城 × 多长度逐日断言」。直接守护 v1.19.170 修过的 cityDayCap 上限，
// 防止后续改动让稀疏县（黄龙/酉阳/抚远…）重新出现「末天空天」。
//
// 「已填」判定口径与 cityDayCap 内部 _planDayFilled 完全一致：当天存在任一「非框架」item 即算已填。
// （山地叙事日「深度游览/看日出」属非框架，算已填，不算空天——与 cap 上限的语义保持一致。）
// 跳过：limited 城（本就只有框架行，属预期）、无 experiences 城（buildPlan 会抛 unsupported）。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

function dayFilled(day) {
  if (!day || !Array.isArray(day.items)) return false;
  return day.items.some(it => it && typeof it.name === "string" && !T.isFrameName(it.name));
}

let fails = 0, checked = 0, skipped = 0;
const redList = [];
const t0 = Date.now();

(async () => {
  await T.ready();
  const cities = (D.CITIES || []).filter(c => c && c.name && !c.limited && Array.isArray(c.experiences) && c.experiences.length);
  for (const c of cities) {
    const name = c.name;
    let cap = 2;
    try { cap = T.cityDayCap(name, "balance"); } catch (e) { cap = 2; }
    if (!(cap >= 2)) { skipped++; continue; }
    // 校验两个长度：最大可填天数 cap（最坏情况），与最短长度 2（下限）
    for (const days of [2, cap]) {
      if (days < 2) continue;
      let plan;
      try { plan = T.buildPlan({ city: name, days, depart: "2027-04-05", budget: "mid", pace: "balance" }); }
      catch (e) { console.error("  ✗ " + name + " 天数" + days + " 生成异常: " + e.message); fails++; checked++; continue; }
      if (!Array.isArray(plan) || plan.length !== days) { console.error("  ✗ " + name + " 天数" + days + " 返回长度不符"); fails++; checked++; continue; }
      let empty = 0;
      for (let i = 1; i < days; i++) { if (!dayFilled(plan[i])) { empty++; redList.push(name + " D" + (i + 1) + "(共" + days + "天)"); } }
      if (empty > 0) { console.error("  ✗ " + name + " 天数" + days + " 有 " + empty + " 天空天"); fails++; }
      checked++;
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n扫描: " + cities.length + " 城 / " + checked + " 项 / 跳过 " + skipped + " / 用时 " + dt + "s");
  if (redList.length) console.log("空天红榜(" + redList.length + "): " + redList.slice(0, 20).join("、") + (redList.length > 20 ? " …" : ""));
  if (fails) { console.error("\n❌ " + fails + " 项存在空天 / 生成异常"); process.exit(1); }
  console.log("✅ 全量城市空天扫描通过（无空天退化）");
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
