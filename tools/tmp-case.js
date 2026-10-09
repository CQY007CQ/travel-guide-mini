const T = require("../utils/travel.js");
const D = require("../utils/data.js");
const DEP = "2026-10-01";
const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
const FILL = /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/;
const isReal = n => n && !FRAME.test(n) && !FILL.test(n);

console.log("===== 案例1：北京 4 天（景点重复）=====");
const bj = T.buildPlan({ city: "北京", days: 4, depart: DEP });
bj.forEach((d, i) => {
  console.log("D" + (i + 1), (d.items || []).map(it => it.period + ":" + it.name).join(" | "));
});

console.log("\n===== 案例2：芜湖 4 天（空天）=====");
const wh = T.buildPlan({ city: "芜湖", days: 4, depart: DEP });
wh.forEach((d, i) => {
  const real = (d.items || []).filter(it => isReal(it.name));
  console.log("D" + (i + 1), "真实景点" + real.length, (d.items || []).map(it => it.name).join(" | "));
});

console.log("\n===== 案例3：天津 全省精华 7 天（天数缩水）=====");
const tj = T.buildProvPlan({ province: "天津", days: 7, depart: DEP, budget: "mid", pace: "balance" });
console.log("实得", tj.length, "天（请求 7）");

console.log("\n===== 案例4：cleanSpotName 行为 =====");
["天安门广场 + 故宫博物院", "八达岭/慕田峪长城", "上海迪士尼乐园", "颐和园 + 圆明园"].forEach(n => {
  console.log(JSON.stringify(n), "→", JSON.stringify(T.cleanSpotName(n)));
});
