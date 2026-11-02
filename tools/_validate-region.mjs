// v1.19.182 团队分区自检：node tools/_validate-region.mjs tools/team/team-region-<板块>.json
// 提交前每人必跑。硬错误（exit 1）→ 必须修；警告（W）可酌情保留但需人工复核。
import { createRequire } from "module";
import { readFileSync } from "fs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const REPS = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);
const TPL = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院"];
const IN_CHINA = (lat, lon) => lat >= 3.8 && lat <= 53.5 && lon >= 73 && lon <= 135;

const f = process.argv[2];
if (!f) { console.error("用法：node tools/_validate-region.mjs <region.json>"); process.exit(2); }
let json;
try { json = JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.error("✗ JSON 解析失败：" + e.message); process.exit(1); }

let errs = 0, warns = 0;
const E = (m) => { console.error("  ✗ " + m); errs++; };
const W = (m) => { console.warn("  ⚠ " + m); warns++; };
const ok = (c, m) => { if (!c) E(m); };

if (!json.food || !json.hotels || !json.hospitals) E("缺少 food/hotels/hospitals 三大块");

// —— 美食 ——
let fShops = 0;
for (const city in (json.food || {})) {
  const arr = json.food[city];
  if (!Array.isArray(arr)) { E(`food.${city} 不是数组`); continue; }
  for (const s of arr) {
    fShops++;
    ok(typeof s.shop === "string" && s.shop, `food.${city} 缺 shop 店名`);
    if (s.lat != null && s.lon != null) ok(IN_CHINA(+s.lat, +s.lon), `food.${city}.${s.shop||"?"} 坐标超出中国范围 (${s.lat},${s.lon})`);
    else W(`food.${city}.${s.shop||"?"} 缺坐标（lat/lon），地图无法标点`);
    if (s.menu != null) {
      ok(Array.isArray(s.menu), `food.${city}.${s.shop||"?"} menu 需为数组`);
      for (const m of (s.menu || [])) ok(m && typeof m.n === "string" && (typeof m.p === "string" || typeof m.p === "number"), `food.${city}.${s.shop||"?"} 菜单项需 {n:菜名, p:参考价}`);
    }
    if (s.rep) ok(REPS.has(s.rep), `food.${city}.${s.shop||"?"} rep 只能用白名单：${[...REPS].join("/")}`);
  }
}

// —— 酒店片区 ——
let hAreas = 0;
for (const city in (json.hotels || {})) {
  const arr = json.hotels[city];
  if (!Array.isArray(arr)) { E(`hotels.${city} 不是数组`); continue; }
  for (const a of arr) {
    hAreas++;
    ok(typeof a.name === "string" && a.name, `hotels.${city} 缺 name 片区名`);
    ok(typeof a.price === "string" && /参考/.test(a.price), `hotels.${city}.${a.name||"?"} price 须写区间且含「参考」`);
  }
}

// —— 医院（最高风险）——
let hHosp = 0;
for (const city in (json.hospitals || {})) {
  const arr = json.hospitals[city];
  if (!Array.isArray(arr)) { E(`hospitals.${city} 不是数组`); continue; }
  for (const h of arr) {
    hHosp++;
    ok(typeof h.n === "string" && h.n, `hospitals.${city} 缺 n 医院名`);
    if (h.lat != null && h.lon != null) ok(IN_CHINA(+h.lat, +h.lon), `hospitals.${city}.${h.n||"?"} 坐标超出中国范围 (${h.lat},${h.lon})`);
    else E(`hospitals.${city}.${h.n||"?"} 缺坐标（lat/lon），应急场景必须有真实坐标`);
    ok(typeof h.lv === "string" && h.lv, `hospitals.${city}.${h.n||"?"} 缺 lv 等级（三甲/三乙/二甲…）`);
    // 红线：城市名 + 模板后缀 = v1.19.168 被清除的捏造模式，硬拒
    for (const t of TPL) {
      if (h.n === city + t) E(`hospitals.${city}.${h.n} 命中模板名红线（城市名+${t}），禁止回填`);
    }
    // 软警告：含通用后缀但非精确「城市+后缀」，需人工确认是否真实
    for (const t of TPL) {
      if (h.n !== city + t && h.n.indexOf(t) >= 0) W(`hospitals.${city}.${h.n} 含通用后缀「${t}」，请人工确认是真实具名医院而非模板`);
    }
  }
}

console.log(`\n汇总：${json.region || f} | 美食 ${fShops} 店 | 酒店 ${hAreas} 片区 | 医院 ${hHosp} 家`);
if (warns) console.warn(`⚠ ${warns} 条警告（需人工复核，可保留）`);
if (errs) { console.error(`❌ ${errs} 条硬错误，请修复后再提交`); process.exit(1); }
console.log("✅ 自检通过（无硬错误）");
