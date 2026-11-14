// v1.19.182 团队合并：把 7 份分区 JSON 聚合，校验，注入三处标记块，cp + 打包。
// 用法：node tools/data/_merge-team-enrich.mjs [--pack]
//   --pack  注入后自动 cp utils/data.js 并跑 pack-data.mjs 重生成 subdata（默认关闭，单独跑更可控）
import { createRequire } from "module";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
const req = createRequire(process.cwd() + "/");

const REPS = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);
const TPL = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院"];
const IN_CHINA = (lat, lon) => lat >= 3.8 && lat <= 53.5 && lon >= 73 && lon <= 135;
// v1.20.6：各分支机采集端「未取到坐标」的占位写法不统一（缺字段 / null / 0,0 三种）。
// 0,0 不在中国境内，若当真值写入会在几内亚湾生成假 pin，也会让整批合并被坐标校验误拦。
// 这里统一归一为「无坐标」：直接剥掉 lat/lon，保留店名/菜单/口碑等真实文字信息，
// 与加载器内既有 285 条无坐标店铺口径一致（applyTeamFoodEnrich 用 sh.lat != null 判空，天然兼容）。
// 红线：只对 0 做占位归一；任何真实越界（含非数值、经纬反填）仍返回 true 由调用方 fail-closed 报错，
// 绝不自动改数、绝不补造坐标。
const isNoCoord = (v) => v == null || v === "" || +v === 0;
function normCoord(o) {
  if (isNoCoord(o.lat) || isNoCoord(o.lon)) { delete o.lat; delete o.lon; return false; }
  // +v 非数值时 IN_CHINA 的比较全为 false，会走到 !false === true，同样按越界报错（fail-closed）。
  return !IN_CHINA(+o.lat, +o.lon);
}

// v1.19.191：社区采集的美食常缺「编辑点评 note」，但 rep/menu 完整。
// 用其真实 rep 标签生成一句诚实的概化点评作兜底（不臆造具体菜品/历史事实），保证合并后每条都有 note。
const NOTE_FALLBACK = {
  "老字号": "本地老字号，口碑长期稳定，值得专程一试。",
  "本地人常去": "本地人常去的实在馆子，性价比高。",
  "游客打卡": "人气打卡店，出品稳定，适合顺路尝鲜。",
  "市井烟火": "市井小店，烟火气足，接地气。",
  "宴请名店": "适合宴请的品质餐厅，环境与服务在线。",
  "__def__": "本地人气店铺，出品稳定，可放心一试。"
};
// 城市中心坐标（来自 data.js 的 CITY_COORDS，764 城），用于给团队医院反算距城心 kmc。
const CITY_COORDS = (() => { try { return req("./utils/data.js").CITY_COORDS || {}; } catch (e) { return {}; } })();
function cityCenter(c) {
  if (CITY_COORDS[c]) return CITY_COORDS[c];
  if (CITY_COORDS[c + "市"]) return CITY_COORDS[c + "市"];
  const s = String(c).replace(/市$/, "");
  return CITY_COORDS[s] || null;
}
function havKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let warns = 0;
function W(m) { warns++; console.warn("  ⚠ " + m); }

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
      if (normCoord(s)) E(`${R}.food.${city}.${s.shop} 坐标越界`);
      if (s.rep && !REPS.has(s.rep)) E(`${R}.food.${city}.${s.shop} rep 不在白名单`);
      if (s.menu) for (const m of s.menu) if (!m || typeof m.n !== "string" || !(typeof m.p === "string" || typeof m.p === "number")) E(`${R}.food.${city}.${s.shop} 菜单项需 {n,p}`);
      if (!s.note) s.note = NOTE_FALLBACK[s.rep] || NOTE_FALLBACK["__def__"];
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
      if (normCoord(h)) E(`${R}.hotelList.${city}.${h.name} 坐标越界`);
      agg.hotelList[city].push(h);
    }
  }
  for (const city in (j.hospitals || {})) {
    const arr = j.hospitals[city] || [];
    if (!Array.isArray(arr)) { E(`${R}.hospitals.${city} 非数组`); continue; }
    for (const h of arr) {
      if (!h || !h.n) { E(`${R}.hospitals.${city} 缺 n`); continue; }
      if (normCoord(h)) { E(`${R}.hospitals.${city}.${h.n} 坐标越界`); continue; }
      if (!h.lv) { E(`${R}.hospitals.${city}.${h.n} 缺 lv 等级`); continue; }
      for (const t of TPL) if (h.n === city + t) { E(`${R}.hospitals.${city}.${h.n} 命中模板名红线（城市名+${t}）`); continue; }
      // v1.19.191：团队医院常缺 kmc，用城心反算；距城心>25km（v1.19.180 收录规则上限）或无城心/无坐标则跳过，不污染 HOSPITALS 可信度红线。
      if (typeof h.lat !== "number" || typeof h.lon !== "number") { W(`${R}.hospitals.${city}.${h.n} 缺坐标，跳过`); continue; }
      const ctr = cityCenter(city);
      if (!ctr) { W(`${R}.hospitals.${city}.${h.n} 无城心坐标，跳过`); continue; }
      const kmc = +havKm(h.lat, h.lon, ctr[0], ctr[1]).toFixed(1);
      if (kmc > 25) { W(`${R}.hospitals.${city}.${h.n} 距城心 ${kmc}km>25，按 v1.19.180 规则跳过`); continue; }
      if (typeof h.kmc !== "number") h.kmc = Math.max(kmc, 0.1);
      if (!agg.hospitals[city]) agg.hospitals[city] = [];
      total.hospitals++;
      agg.hospitals[city].push(h);
    }
  }
}

if (errs) { console.error(`\n❌ 合并前校验 ${errs} 条错误，已中止注入。请各人先跑 _validate-region.mjs 修好再合并。`); process.exit(1); }

// 2) 注入标记块（v1.20.6 起主包预算感知）
// 背景：7 人分区全量（992 店 / 581 片区 / 628 家酒店 / 130 家医院）四块一起注入会让 utils/ +171KB，
// 把主包 raw 从 1459KB 顶到 1626KB，越过 check-pkgsize 的 1.5M 代码质量线，allcheck 与 CI 一起变红。
// 策略：注入前按「美食 > 具名医院 > 逐店酒店 > 住宿片区」的价值序逐块试算主包体积，预算不够的块
// 保留原有内容不注入；原始数据完整留在 tools/team/*.json，等 subdata3 预留数据槽接通后再入包。
// 红线：不丢数、不伪造、不改门禁阈值蒙混过关。
const MAIN_LIMIT_KB = 1536; // 与 tools/check/check-pkgsize.mjs 的 MAIN_LIMIT 同口径
function mainRawKB() {
  let out = "";
  try { out = execSync(process.execPath + " tools/check/check-pkgsize.mjs", { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); }
  catch (e) { out = String((e && e.stdout) || ""); } // 超线时脚本 exit 1，但 stdout 仍有 raw=NNNKB
  const m = out.match(/主包[^\n]*?raw=(\d+)KB/);
  return m ? +m[1] : null;
}
function blockJson(file, start, end) {
  const s = readFileSync(file, "utf8");
  const re = new RegExp("(\\/\\/ >>>" + start + ">>>)([\\s\\S]*?)(\\/\\/ <<<" + end + "<<<)");
  const m = s.match(re);
  if (!m) throw new Error("找不到标记块 " + start + " in " + file);
  const body = m[2].trim();            // 形如 const XXX = {...};
  const eq = body.indexOf("="), semi = body.lastIndexOf(";");
  return eq < 0 || semi < eq ? "{}" : body.slice(eq + 1, semi).trim();
}
function inject(file, start, end, constName, obj) {
  let s = readFileSync(file, "utf8");
  const re = new RegExp("(\\/\\/ >>>" + start + ">>>)[\\s\\S]*?(\\/\\/ <<<" + end + "<<<)", "g");
  if (!re.test(s)) throw new Error("找不到标记块 " + start + " in " + file);
  s = s.replace(re, "$1\nconst " + constName + " = " + JSON.stringify(obj) + ";\n$2");
  writeFileSync(file, s, "utf8");
  console.log("  ✓ 注入 " + constName + " → " + file + "（" + Object.keys(obj).length + " 城）");
}
const baseRaw = mainRawKB();
let budget = baseRaw == null ? Infinity : Math.max(0, (MAIN_LIMIT_KB - baseRaw) * 1024);
console.log("\n主包预算：raw=" + (baseRaw == null ? "未测" : baseRaw + "KB") + " / 上限 " + MAIN_LIMIT_KB +
  "KB，可用 " + (budget === Infinity ? "未测" : (budget / 1024).toFixed(0) + "KB"));
// 美食注入 tools/_src-backup/data.js 后由末尾 cp 到 utils/data.js，主包只增长一份，故按一份计。
const JOBS = [
  ["美食", "tools/_src-backup/data.js", "TEAM_FOOD_START", "TEAM_FOOD_END", "TEAM_FOOD_ENRICH", agg.food],
  ["具名医院", "utils/emergency-data.js", "TEAM_HOSP_START", "TEAM_HOSP_END", "TEAM_HOSP_ENRICH", agg.hospitals],
  ["逐店酒店", "utils/hotel-areas.js", "TEAM_HOTEL_LIST_START", "TEAM_HOTEL_LIST_END", "TEAM_HOTEL_LIST_ENRICH", agg.hotelList],
  ["住宿片区", "utils/hotel-areas.js", "TEAM_HOTEL_START", "TEAM_HOTEL_END", "TEAM_HOTEL_ENRICH", agg.hotels]
];
console.log("\n注入标记块：");
const held = [];
for (const [label, file, start, end, name, obj] of JOBS) {
  const delta = Buffer.byteLength(JSON.stringify(obj)) - Buffer.byteLength(blockJson(file, start, end));
  if (delta > budget) {
    held.push(label + "(+" + (delta / 1024).toFixed(0) + "KB)");
    W(`${label} 需 +${(delta / 1024).toFixed(0)}KB > 主包剩余 ${(budget / 1024).toFixed(0)}KB：` +
      `保留 ${file} 原有 ${name} 块不注入（原始数据完整保留在 tools/team/*.json）`);
    continue;
  }
  inject(file, start, end, name, obj);
  budget -= delta;
}
if (held.length) console.log("  ⏸ 本轮受主包预算约束暂缓：" + held.join("、"));

// v1.19.205 / v1.20.6 修订：团队医院并入后须从 APPROX 剔除已具名医院城，
// 严守 v1.19.191「两集合不重叠」红线（_test-corpus.mjs 有断言）。
// 旧实现用 /const APPROX = (\{...\n\});/ 匹配，但 utils/emergency-data.js 是压缩产物，
// 声明形如 `const TRIAGE=[...],HOSPITALS={...},APPROX={...};` —— 正则永远匹配不到，
// 剔除空转 → 新增具名城（天水/中卫/嘉峪关）与 APPROX 重叠，回归判红。
// 改为「平衡括号扫描」定位任意 `NAME = {` 字面量，压缩产物与 .src.js 源码两种形态通吃。
function objLiteral(file, name) {
  const s = readFileSync(file, "utf8");
  const m = new RegExp(name + "\\s*=\\s*\\{").exec(s);
  if (!m) return null;
  const b = s.indexOf("{", m.index);
  let depth = 0, quote = "", esc = false, end = -1;
  for (let k = b; k < s.length; k++) {
    const ch = s[k];
    if (quote) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = k + 1; break; }
  }
  if (end < 0) return null;
  let obj;
  try { obj = Function("return " + s.slice(b, end) + ";")(); } catch (e) { return null; }
  return { s, start: b, end, obj: (obj && typeof obj === "object") ? obj : null };
}
function pruneApprox(file, hospCities) {
  const lit = objLiteral(file, "APPROX");
  if (!lit || !lit.obj) { W("找不到/无法解析 APPROX 字面量：" + file + "，跳过剔除"); return; }
  const removed = [];
  for (const c of hospCities) if (lit.obj[c] !== undefined) { delete lit.obj[c]; removed.push(c); }
  if (!removed.length) return;
  // 压缩产物写紧凑 JSON，源码保留缩进，避免无谓的格式噪音。
  const pretty = /\.src\.js$/.test(file);
  const ser = JSON.stringify(lit.obj, null, pretty ? 2 : 0);
  writeFileSync(file, lit.s.slice(0, lit.start) + ser + lit.s.slice(lit.end), "utf8");
  console.log("  ✓ " + file + " APPROX 剔除已具名医院城 " + removed.length + " 城：" + removed.join(", "));
}
{
  const hospCities = new Set(Object.keys(agg.hospitals));
  const hl = objLiteral("utils/emergency-data.js", "HOSPITALS");
  if (hl && hl.obj) for (const c of Object.keys(hl.obj)) hospCities.add(c);
  else W("找不到 HOSPITALS 字面量，仅用团队医院城集合剔除 APPROX");
  // 产物与源码同步，避免下次从 .src.js 重建时把重叠城带回来。
  pruneApprox("utils/emergency-data.js", hospCities);
  pruneApprox("tools/_src-backup/emergency-data.src.js", hospCities);
}

// 3) cp + 打包
console.log("\n同步 utils/data.js ...");
execSync("cp tools/_src-backup/data.js utils/data.js", { stdio: "inherit" });

console.log(`\n✅ 合并完成：美食 ${total.food} 店 / 酒店区域 ${total.hotels} 片区 + 逐店 ${total.hotelList} 家 / 医院 ${total.hospitals} 家，覆盖 ${Object.keys(agg.food).length}+${Object.keys(agg.hotels).length}+${Object.keys(agg.hotelList).length}+${Object.keys(agg.hospitals).length} 城${warns ? `（跳过 ${warns} 项警告，详见上）` : ""}`);
if (doPack) {
  console.log("\n重打包 subdata ...");
  try { execSync("node tools/build/pack-data.mjs", { stdio: "inherit" }); console.log("\n下一步：bash allcheck.sh 回归，再 tools/dev/upload.sh"); }
  catch (e) { console.error("\n✗ pack-data 失败，请手工排查"); process.exit(1); }
} else {
  console.log("\n下一步（默认未打包）：");
  console.log("  node tools/build/pack-data.mjs      # 重生成 subdata");
  console.log("  bash allcheck.sh              # 回归（坐标自检 + 医院红线会拦违规）");
  console.log("  ./tools/dev/upload.sh <版本> \"说明\"   # 上传");
}
