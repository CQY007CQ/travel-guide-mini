// 数据缺口报告 + 采集目标生成
// 用法：node tools/team/gap-report.mjs
// 作用：对照「每城 ≥10 景点 / ≥30 美食 / ≥5 真实医院」目标，算出每城还差多少，
//       并产出 tools/team/gap-targets.json 供 collect-amap.mjs 作为采集清单。
// 原则：只读真实库，不编造；输出纯统计与待采集清单。
import { createRequire } from "module";
import { writeFileSync } from "fs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const EM = req("./utils/emergency-data.js");

const GOAL_SPOT = 10, GOAL_FOOD = 30, GOAL_HOSP = 5;

// 真实城市（去 limited 全称别名）
const realCities = (D.CITIES || []).filter(c => !c.limited).map(c => c.name);
const H = EM.HOSPITALS || {};
function realHosp(city) {
  const arr = H[city] || [];
  return arr.filter(h => h && !h.approx).length;
}

const rows = [];
let sUnder = 0, fUnder = 0, hUnder = 0;
let spotDeficit = 0, foodDeficit = 0, hospDeficit = 0;
for (const city of realCities) {
  const sc = (D.SPOT_COORDS && D.SPOT_COORDS[city]) ? D.SPOT_COORDS[city].length : 0;
  const fs = (D.FOOD_SPOTS && D.FOOD_SPOTS[city]) ? D.FOOD_SPOTS[city].length : 0;
  const hc = realHosp(city);
  const dSpot = Math.max(0, GOAL_SPOT - sc);
  const dFood = Math.max(0, GOAL_FOOD - fs);
  const dHosp = Math.max(0, GOAL_HOSP - hc);
  if (dSpot) { sUnder++; spotDeficit += dSpot; }
  if (dFood) { fUnder++; foodDeficit += dFood; }
  if (dHosp) { hUnder++; hospDeficit += dHosp; }
  if (dSpot || dFood || dHosp)
    rows.push({ city, spot: sc, food: fs, hosp: hc, needSpot: dSpot, needFood: dFood, needHosp: dHosp });
}

rows.sort((a, b) => (b.needSpot + b.needFood + b.needHosp) - (a.needSpot + a.needFood + a.needHosp));

console.log("真实城市数：", realCities.length);
console.log(`景点 <${GOAL_SPOT}：`, sUnder, "城，共缺", spotDeficit, "个");
console.log(`美食 <${GOAL_FOOD}：`, fUnder, "城，共缺", foodDeficit, "家");
console.log(`真实医院 <${GOAL_HOSP}：`, hUnder, "城，共缺", hospDeficit, "家");
console.log("\n缺口最重的 15 城：");
for (const r of rows.slice(0, 15))
  console.log(`  ${r.city.padEnd(8)} 景点 ${r.spot}/${GOAL_SPOT}(需${r.needSpot}) 美食 ${r.food}/${GOAL_FOOD}(需${r.needFood}) 医院 ${r.hosp}/${GOAL_HOSP}(需${r.needHosp})`);

writeFileSync("tools/team/gap-targets.json",
  JSON.stringify({ goal: { spot: GOAL_SPOT, food: GOAL_FOOD, hosp: GOAL_HOSP }, generated: new Date().toISOString().slice(0, 10), cities: rows }, null, 2));
console.log("\n已写出 tools/team/gap-targets.json（" + rows.length + " 城待采集）");
