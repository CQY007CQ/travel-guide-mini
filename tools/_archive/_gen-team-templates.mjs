// v1.19.182 团队分工：生成 7 份「板块城市清单 + 可填模板」JSON，以及分工总览 MD。
// 用法：node tools/_gen-team-templates.mjs
// 数据来源：utils/data.js 的 CITIES（751 城，按 province 归类到七大地理板块）。
// 每个 region JSON 结构：{ region, food:{城市:[]}, hotels:{城市:[]}, hospitals:{城市:[]} }
// 城市名严格使用 CITIES 中的 name（含「保定/保定市」等并存形态，均保留，确保与小程序 key 对齐）。
import { createRequire } from "module";
import { writeFileSync, mkdirSync } from "fs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const REGION = {
  "华北": ["北京", "天津", "河北", "山西", "内蒙古"],
  "东北": ["辽宁", "吉林", "黑龙江"],
  "华东": ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"],
  "华中": ["河南", "湖北", "湖南"],
  "华南": ["广东", "广西", "海南"],
  "西南": ["重庆", "四川", "贵州", "云南", "西藏"],
  "西北": ["陕西", "甘肃", "青海", "宁夏", "新疆"]
};
const rev = {};
for (const r in REGION) for (const p of REGION[r]) rev[p] = r;

// 收集每个板块的城市（去重精确字符串重复，保留「保定/保定市」并存形态）
const byRegion = {};
const seen = new Set();
for (const c of D.CITIES) {
  const r = rev[c.province] || rev[c.name];
  if (!r) continue; // 港澳台等未匹配，单列处理
  const key = r + "|" + c.name;
  if (seen.has(key)) continue;
  seen.add(key);
  (byRegion[r] = byRegion[r] || new Set()).add(c.name);
}

// 现有覆盖情况（用于总览提示，帮助团队优先补缺口）
const foodCities = new Set(Object.keys(D.FOOD_SPOTS || {}));
const hotelCities = new Set(Object.keys((D.HOTEL_AREAS_EXTRA && D.HOTEL_AREAS_EXTRA) || {}));
const hospCities = new Set(Object.keys(D.HOSPITALS || {}));

mkdirSync("tools/team", { recursive: true });
const ORDER = ["华北", "东北", "华东", "华中", "华南", "西南", "西北"];
let overview = "# 旅行攻略小程序 · 7 人团队分工总览\n\n";
overview += "> 自动生成于数据基线（CITIES " + D.CITIES.length + " 城）。每人认领一个板块，按 `tools/team/team-region-<板块>.json` 填采。\n";
overview += "> 图例：食=已有美食富信息 / 酒=已有酒店片区 / 医=已有具名真实医院。空白即缺口，优先补。\n\n";

for (const r of ORDER) {
  const cities = [...(byRegion[r] || [])].sort();
  const obj = { region: r, food: {}, hotels: {}, hospitals: {} };
  for (const c of cities) { obj.food[c] = []; obj.hotels[c] = []; obj.hospitals[c] = []; }
  const file = "tools/team/team-region-" + r + ".json";
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");

  overview += "## " + r + "（" + cities.length + " 城）\n\n";
  overview += "| 城市 | 食 | 酒 | 医 |\n|---|---|---|---|\n";
  for (const c of cities) {
    const f = foodCities.has(c) ? "✓" : "";
    const h = hotelCities.has(c) ? "✓" : "";
    const p = hospCities.has(c) ? "✓" : "";
    overview += "| " + c + " | " + f + " | " + h + " | " + p + " |\n";
  }
  overview += "\n";
}
writeFileSync("tools/team/团队分工总览.md", overview, "utf8");
console.log("已生成 7 份板块模板 + 分工总览：");
for (const r of ORDER) console.log("  tools/team/team-region-" + r + ".json");
console.log("  tools/team/团队分工总览.md");
