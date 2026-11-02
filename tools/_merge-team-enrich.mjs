// v1.19.182 团队合并：把 7 份分区 JSON 聚合，校验，注入三处标记块，cp + 打包。
// 用法：node tools/_merge-team-enrich.mjs [--pack]
//   --pack  注入后自动 cp utils/data.js 并跑 pack-data.mjs 重生成 subdata（默认关闭，单独跑更可控）
import { createRequire } from "module";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
const req = createRequire(process.cwd() + "/");

const REPS = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);
const TPL = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院"];
const IN_CHINA = (lat, lon) => lat >= 3.8 && lat <= 53.5 && lon >= 73 && lon <= 135;

const doPack = process.argv.includes("--pack");

// 1) 读分区文件（7 人手工提交 team-region-* + 每日自动化采集 daily-region-*）
const files = readdirSync("tools/team").filter(n => /^(team|daily)-region-.*\.json$/.test(n)).sort();
if (!files.length) { console.error("tools/team/ 下没有 team-region-*.json 或 daily-region-*.json"); process.exit(1); }
console.log("读取分区文件：" + files.join(", "));

const agg = { food: {}, hotels: {}, hotelList: {}, hospitals: {} };
let errs = 0, total = { food: 0, hotels: 0, hotelList: 0, hospitals: 0 };
function E(m) { console.error("  ✗ " + m); errs++; }

for (const fn of files) {
  let j;
  try { j = JSON.parse(readFileSync("tools/team/" + fn, "utf8")); } catch (e) { E(fn + " 解析失败：" + e.message); continue; }
  const R = j.region || fn;
  for (const city in (j.food || {})) {
    const arr = j.food[city] || [];
    if (!Array.isArray(arr)) { E(`${R}.food.${city} 非数组`); continue; }
    for (const s of arr) {
      if (!agg.food[city]) agg.food[city] = [];
      total.food++;
      if (!s || typeof s.shop !== "string" || !s.shop) { E(`${R}.food.${city} 缺 shop`); continue; }
      if (s.lat != null && s.lon != null && !IN_CHINA(+s.lat, +s.lon)) E(`${R}.food.${city}.${s.shop} 坐标越界`);
      if (s.rep && !REPS.has(s.rep)) E(`${R}.food.${city}.${s.shop} rep 不在白名单`);
      if (s.menu) for (const m of s.menu) if (!m || typeof m.n !== "string" || !(typeof m.p === "string" || typeof m.p === "number")) E(`${R}.food.${city}.${s.shop} 菜单项需 {n,p}`);
      agg.food[city].push(s);
    }
  }
  for (const city in (j.hotels || {})) {
    const arr = j.hotels[city] || [];
    if (!Array.isArray(arr)) { E(`${R}.hotels.${city} 非数组`); continue; }
    for (const a of arr) {
      if (!agg.hotels[city]) agg.hotels[city] = [];
      total.hotels++;
      if (!a || !a.name || typeof a.price !== "string" || !/参考/.test(a.price)) E(`${R}.hotels.${city}.${a && a.name} price 须含「参考」`);
      agg.hotels[city].push(a);
    }
  }
  for (const city in (j.hotelList || {})) {
    const arr = j.hotelList[city] || [];
    if (!Array.isArray(arr)) { E(`${R}.hotelList.${city} 非数组`); continue; }
    for (const h of arr) {
      if (!agg.hotelList[city]) agg.hotelList[city] = [];
      total.hotelList++;
      if (!h || !h.name) { E(`${R}.hotelList.${city} 缺 name`); continue; }
      if (typeof h.price !== "string" || !/参考/.test(h.price)) E(`${R}.hotelList.${city}.${h.name} price 须含「参考」`);
      if (!Array.isArray(h.rooms) || !h.rooms.length) E(`${R}.hotelList.${city}.${h.name} 缺 rooms 房型`);
      else for (const r of h.rooms) { if (!r || !r.type) E(`${R}.hotelList.${city}.${h.name} 房型缺 type`); }
      if (h.lat != null && h.lon != null && !IN_CHINA(+h.lat, +h.lon)) E(`${R}.hotelList.${city}.${h.name} 坐标越界`);
      agg.hotelList[city].push(h);
    }
  }
  for (const city in (j.hospitals || {})) {
    const arr = j.hospitals[city] || [];
    if (!Array.isArray(arr)) { E(`${R}.hospitals.${city} 非数组`); continue; }
    for (const h of arr) {
      if (!agg.hospitals[city]) agg.hospitals[city] = [];
      total.hospitals++;
      if (!h || !h.n) { E(`${R}.hospitals.${city} 缺 n`); continue; }
      if (h.lat != null && h.lon != null && !IN_CHINA(+h.lat, +h.lon)) E(`${R}.hospitals.${city}.${h.n} 坐标越界`);
      if (!h.lv) E(`${R}.hospitals.${city}.${h.n} 缺 lv 等级`);
      for (const t of TPL) if (h.n === city + t) E(`${R}.hospitals.${city}.${h.n} 命中模板名红线（城市名+${t}）`);
      agg.hospitals[city].push(h);
    }
  }
}

if (errs) { console.error(`\n❌ 合并前校验 ${errs} 条错误，已中止注入。请各人先跑 _validate-region.mjs 修好再合并。`); process.exit(1); }

// 2) 注入三处标记块
function inject(file, start, end, constName, obj) {
  let s = readFileSync(file, "utf8");
  const re = new RegExp("(\\/\\/ >>>" + start + ">>>)[\\s\\S]*?(\\/\\/ <<<" + end + "<<<)", "g");
  if (!re.test(s)) throw new Error("找不到标记块 " + start + " in " + file);
  s = s.replace(re, "$1\nconst " + constName + " = " + JSON.stringify(obj) + ";\n$2");
  writeFileSync(file, s, "utf8");
  console.log("  ✓ 注入 " + constName + " → " + file + "（" + Object.keys(obj).length + " 城）");
}
console.log("\n注入标记块：");
inject("tools/_src-backup/data.js", "TEAM_FOOD_START", "TEAM_FOOD_END", "TEAM_FOOD_ENRICH", agg.food);
inject("utils/hotel-areas.js", "TEAM_HOTEL_START", "TEAM_HOTEL_END", "TEAM_HOTEL_ENRICH", agg.hotels);
inject("utils/hotel-areas.js", "TEAM_HOTEL_LIST_START", "TEAM_HOTEL_LIST_END", "TEAM_HOTEL_LIST_ENRICH", agg.hotelList);
inject("utils/emergency-data.js", "TEAM_HOSP_START", "TEAM_HOSP_END", "TEAM_HOSP_ENRICH", agg.hospitals);

// 3) cp + 打包
console.log("\n同步 utils/data.js ...");
execSync("cp tools/_src-backup/data.js utils/data.js", { stdio: "inherit" });

console.log(`\n✅ 合并完成：美食 ${total.food} 店 / 酒店区域 ${total.hotels} 片区 + 逐店 ${total.hotelList} 家 / 医院 ${total.hospitals} 家，覆盖 ${Object.keys(agg.food).length}+${Object.keys(agg.hotels).length}+${Object.keys(agg.hotelList).length}+${Object.keys(agg.hospitals).length} 城`);
if (doPack) {
  console.log("\n重打包 subdata ...");
  try { execSync("node tools/pack-data.mjs", { stdio: "inherit" }); console.log("\n下一步：bash allcheck.sh 回归，再 tools/upload.sh"); }
  catch (e) { console.error("\n✗ pack-data 失败，请手工排查"); process.exit(1); }
} else {
  console.log("\n下一步（默认未打包）：");
  console.log("  node tools/pack-data.mjs      # 重生成 subdata");
  console.log("  bash allcheck.sh              # 回归（坐标自检 + 医院红线会拦违规）");
  console.log("  ./tools/upload.sh <版本> \"说明\"   # 上传");
}
