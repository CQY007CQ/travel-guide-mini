// 高德（AMap）合规批量采集 → 写入团队管线（tools/team/daily-region-amap.json）
// 用法：
//   node tools/team/collect-amap.mjs --key <KEY> [--keys k1,k2] [--all] [--city 成都] [--limit 30]
//   node tools/team/collect-amap.mjs --dry            # 离线校验输出 schema
//   node tools/team/collect-amap.mjs --all --fresh    # 清空已有 daily 从头采集（默认续传）
//   node tools/team/collect-amap.mjs --all --food-cap 30 --hosp-cap 8   # 自定义每城上限
//   node tools/team/collect-amap.mjs --stats          # 离线统计已采集覆盖（美食/医院 城数·条数 + 对比 gap-targets 达标率，无需 key）
//
// 续传（resumable）：默认在已有 daily-region-amap.json 基础上增量补齐，跨日按 100/日配额
//   分批跑不会丢数据；已达标（美食≥food-cap 且 医院≥hosp-cap）的城市自动跳过，把配额让给缺口城。
//   同名（trim+小写）自动去重，重复跑不产生重复条目。--fresh 可清空重来。
//
// 合规说明（零伪造）：只拉高德返回的「真实」POI——真实名称/坐标/地址/医院等级，不编造任何字段。
//   医院命中「城市名+人民医院/中医院/…」模板名红线默认跳过（与 _merge-team-enrich.mjs 一致）。
//
// 配额：高德「搜索类」（text/around）个人认证仅 100 次/日/账号；多 key 共享同池不扩容。按请求计数，
//   超出即停并续写文件，绝不盲跑。（注：原「旅游景点」关键词仅消耗配额却不落盘，已移除。）
import { createRequire } from "module";
import { writeFileSync, readFileSync, existsSync } from "fs";
const req = createRequire(process.cwd() + "/");

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const STATS = args.includes("--stats");
const ALL = args.includes("--all");
const CITY = get("--city");
const LIMIT = parseInt(get("--limit", "30"), 10);
const SKIP_TPL = !args.includes("--keep-template");

// ── 与 _merge-team-enrich.mjs 保持一致的校验常量 ──
const REPS = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);
const TPL = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院"];
const IN_CHINA = (lat, lon) => lat >= 3.8 && lat <= 53.5 && lon >= 73 && lon <= 135;
function havKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const D = req("./utils/data.js");
const CITY_COORDS = D.CITY_COORDS || {};
function cityCenter(c) { return CITY_COORDS[c] || CITY_COORDS[c + "市"] || CITY_COORDS[String(c).replace(/市$/, "")] || null; }
function mapLv(tag) {
  if (!tag) return "未定级";
  if (/三甲/.test(tag)) return "三甲";
  if (/三乙/.test(tag)) return "三乙";
  if (/二甲/.test(tag)) return "二甲";
  if (/二乙/.test(tag)) return "二乙";
  if (/专科/.test(tag)) return "专科";
  return "未定级";
}
function mapRep(tag) {
  if (!tag) return undefined;
  if (/老字号/.test(tag)) return "老字号";
  if (/小吃|夜市|市井|大排档|苍蝇馆/.test(tag)) return "市井烟火";
  if (/宴请|高档|商务|精致|星级/.test(tag)) return "宴请名店";
  if (/网红|打卡|景点/.test(tag)) return "游客打卡";
  return undefined;
}

// 解析高德 text 搜索返回
function parsePois(json) {
  const arr = (json && json.pois) || [];
  return arr.map(p => ({
    name: p.name,
    lonlat: (p.location || "").split(",").map(Number),
    address: p.address || "",
    tag: p.tag || (p.biz_extension ? "" : ""),
    cost: p.cost || (p.biz_extensions && p.biz_extensions.cost) || null
  }));
}

if (DRY) {
  // 离线 schema 自检：用合成样本跑一遍与合并脚本同款的校验，证明可被接纳。
  console.log("== --dry：离线校验输出 schema ==");
  const city = "成都", ctr = cityCenter(city);
  const sample = {
    region: "amap-auto",
    food: { [city]: [
      { shop: "合成测试店", lat: 30.66, lon: 104.07, price: "人均约¥80", rep: "本地人常去", menu: [{ n: "招牌菜", p: "¥38" }] },
      { shop: "无rep店", lat: 30.67, lon: 104.08 }
    ]},
    hospitals: { [city]: [
      { n: "合成真实医院", lat: ctr ? ctr[0] : 30.66, lon: ctr ? ctr[1] : 104.07, lv: "三甲" }
    ]}
  };
  let ok = true;
  for (const c in sample.food) for (const s of sample.food[c]) {
    if (!s.shop) { console.log("✗ food 缺 shop"); ok = false; }
    if (s.lat != null && !IN_CHINA(+s.lat, +s.lon)) { console.log("✗ food 坐标越界", s.shop); ok = false; }
    if (s.rep && !REPS.has(s.rep)) { console.log("✗ food rep 不在白名单", s.rep); ok = false; }
    if (s.menu) for (const m of s.menu) if (!m.n || !(typeof m.p === "string" || typeof m.p === "number")) { console.log("✗ menu 格式", s.shop); ok = false; }
  }
  for (const c in sample.hospitals) for (const h of sample.hospitals[c]) {
    if (!h.n) { console.log("✗ hosp 缺 n"); ok = false; }
    if (!IN_CHINA(+h.lat, +h.lon)) { console.log("✗ hosp 坐标越界", h.n); ok = false; }
    if (!h.lv) { console.log("✗ hosp 缺 lv"); ok = false; }
    for (const t of TPL) if (h.n === c + t) { console.log("✗ hosp 命中模板名红线", h.n); ok = false; }
  }
  console.log(ok ? "✅ 输出 schema 通过合并校验（真实运行时会写入 daily-region-amap.json）"
                 : "❌ schema 有问题，见上");
  process.exit(ok ? 0 : 1);
}

// ── 真实运行（需联网 + 高德 key）──
const FRESH = args.includes("--fresh");
const FOOD_CAP = Math.max(1, parseInt(get("--food-cap", String(LIMIT)), 10)); // 每城美食采集上限（对齐 GOAL_FOOD=30）
const HOSP_CAP = Math.max(1, parseInt(get("--hosp-cap", "8"), 10));           // 每城真实医院采集上限（>GOAL_HOSP=5，留 kmc 过滤余量）
const KEYS = (get("--keys") || get("--key") || process.env.AMAP_KEY || "").split(",").filter(Boolean);
if (!KEYS.length && !STATS) { console.error("✗ 缺少高德 key：--key <KEY> 或环境变量 AMAP_KEY"); process.exit(1); }
const https = (() => { try { return req("https"); } catch (e) { return require("https"); } })();
function amapText(key, keyword, city, page) {
  const params = `key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&citylimit=true&offset=25&page=${page}&extensions=all`;
  const url = `https://restapi.amap.com/v3/place/text?${params}`;
  return new Promise((res, rej) => {
    https.get(url, r => { let b = ""; r.on("data", d => b += d); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}

// 续传：载入已有 daily 文件（保留 food/hospitals 及其它分区键），在其基础上增量补齐。
const DAILY = "tools/team/daily-region-amap.json";
const out = { region: "amap-auto", food: {}, hospitals: {} };
if (!FRESH && existsSync(DAILY)) {
  try {
    const prev = JSON.parse(readFileSync(DAILY, "utf8"));
    out.food = prev.food || {};
    out.hospitals = prev.hospitals || {};
    for (const k in prev) if (k !== "region" && k !== "food" && k !== "hospitals") out[k] = prev[k];
    if (!STATS) console.log(`== 续传：载入已有 ${DAILY}（美食 ${Object.keys(out.food).length} 城 / 医院 ${Object.keys(out.hospitals).length} 城），增量补齐 ==`);
  } catch (e) { console.warn("  ⚠ 解析已有 daily 失败，改为从头采集：", e.message); }
}

// ── 离线覆盖统计（--stats，无需 key / 不触网）──
if (STATS) {
  console.log("== --stats：采集覆盖统计 ==");
  const foodCities = Object.keys(out.food || {}).length;
  const hospCities = Object.keys(out.hospitals || {}).length;
  let foodItems = 0, hospItems = 0;
  for (const c in out.food) foodItems += (out.food[c] || []).length;
  for (const c in out.hospitals) hospItems += (out.hospitals[c] || []).length;
  console.log(`已采集：美食 ${foodCities} 城 / ${foodItems} 条；医院 ${hospCities} 城 / ${hospItems} 条`);
  let targets = [];
  if (existsSync("tools/team/gap-targets.json")) {
    try { targets = JSON.parse(readFileSync("tools/team/gap-targets.json", "utf8")).cities || []; } catch (e) { /* ignore */ }
  }
  if (targets.length) {
    let met = 0;
    for (const r of targets) {
      const f = (out.food[r.city] || []).length, h = (out.hospitals[r.city] || []).length;
      if (f >= FOOD_CAP && h >= HOSP_CAP) met++;
    }
    console.log(`目标城市 ${targets.length} 城：已达标（美食≥${FOOD_CAP} 且 医院≥${HOSP_CAP}）${met} 城，待补 ${targets.length - met} 城`);
  } else {
    console.log("（未找到 gap-targets.json，先跑 node tools/team/gap-report.mjs 生成待采集清单）");
  }
  process.exit(0);
}

// 同名（trim+小写）去重，避免重复跑产生重复条目
const foodDup = (city, shop) => (out.food[city] || []).some(s => String(s.shop || "").trim().toLowerCase() === String(shop).trim().toLowerCase());
const hospDup = (city, n) => (out.hospitals[city] || []).some(h => String(h.n || "").trim().toLowerCase() === String(n).trim().toLowerCase());

(async () => {
  const targets = ALL ? (D.CITIES || []).filter(c => !c.limited).map(c => c.name)
    : CITY ? [CITY]
    : (existsSync("tools/team/gap-targets.json") ? JSON.parse(readFileSync("tools/team/gap-targets.json", "utf8")).cities.map(r => r.city) : []);
  if (!targets.length) { console.error("✗ 无目标城市：用 --all / --city / 先跑 gap-report.mjs"); process.exit(1); }
  let used = 0, dayCap = 100 * KEYS.length;  // 搜索类配额（text/around 共享，个人认证 100/日/账号）
  let ki = 0;
  let skipped = 0, metFood = 0, metHosp = 0;

  for (const city of targets) {
    if (used >= dayCap) { console.warn(`⚠ 已达日配额 ${dayCap}，停止。剩余 ${targets.length - targets.indexOf(city)} 城下次再跑（数据已续写，不丢）。`); break; }
    const haveFood = (out.food[city] || []).length;
    const haveHosp = (out.hospitals[city] || []).length;
    if (haveFood >= FOOD_CAP && haveHosp >= HOSP_CAP) { skipped++; continue; } // 已达标，跳过省配额

    // 美食
    if (haveFood < FOOD_CAP) {
      if (!out.food[city]) out.food[city] = [];
      let page = 1, got = 0;
      while (page <= 2 && got < FOOD_CAP - haveFood && used < dayCap) {
        const key = KEYS[ki % KEYS.length]; ki++; used++;
        let json;
        try { json = await amapText(key, "美食", city, page); } catch (e) { console.warn("  ⚠", city, "美食请求失败", e.message); break; }
        const pois = parsePois(json);
        if (!pois.length) break;
        for (const p of pois) {
          if (p.lonlat.length !== 2 || !IN_CHINA(p.lonlat[1], p.lonlat[0])) continue;
          const lat = p.lonlat[1], lon = p.lonlat[0];
          if (foodDup(city, p.name)) continue;
          const s = { shop: p.name, lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
          const rep = mapRep(p.tag); if (rep) s.rep = rep;
          if (p.cost) s.price = "人均约¥" + p.cost;
          out.food[city].push(s); got++; metFood++;
        }
        page++;
      }
    }

    // 医院（模板名红线默认跳过；上限 HOSP_CAP）
    if (haveHosp < HOSP_CAP) {
      if (!out.hospitals[city]) out.hospitals[city] = [];
      let page = 1, got = 0;
      while (page <= 2 && got < HOSP_CAP - haveHosp && used < dayCap) {
        const key = KEYS[ki % KEYS.length]; ki++; used++;
        let json;
        try { json = await amapText(key, "医院", city, page); } catch (e) { console.warn("  ⚠", city, "医院请求失败", e.message); break; }
        const pois = parsePois(json);
        if (!pois.length) break;
        for (const p of pois) {
          if (p.lonlat.length !== 2 || !IN_CHINA(p.lonlat[1], p.lonlat[0])) continue;
          const lat = p.lonlat[1], lon = p.lonlat[0];
          if (SKIP_TPL && TPL.some(t => p.name === city + t)) continue; // 模板名红线
          if (hospDup(city, p.name)) continue;
          out.hospitals[city].push({ n: p.name, lat: +lat.toFixed(4), lon: +lon.toFixed(4), lv: mapLv(p.tag) });
          got++; metHosp++;
        }
        page++;
      }
    }
  }
  writeFileSync(DAILY, JSON.stringify(out, null, 2));
  console.log(`✅ 续写 ${DAILY}：美食 ${Object.keys(out.food).length} 城 / 医院 ${Object.keys(out.hospitals).length} 城（本次用 ${used} 次搜索配额，新增美食 ${metFood} / 医院 ${metHosp}${skipped ? `，跳过已达标 ${skipped} 城` : ""}）`);
  console.log("下一步：node tools/data/_merge-team-enrich.mjs --pack   # 合并入包并重打包");
})();
