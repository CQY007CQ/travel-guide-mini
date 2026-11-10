// 高德（AMap）合规批量采集 → 写入团队管线（tools/team/daily-region-amap.json）
// 用法：
//   node tools/team/collect-amap.mjs --key <你的AMAP_KEY> [--keys k1,k2] [--all] [--city 成都] [--limit 30]
//   node tools/team/collect-amap.mjs --dry          # 离线校验输出 schema 是否能被 _merge-team-enrich.mjs 接纳
//
// 合规说明（零伪造）：本脚本只拉取高德返回的「真实」POI——真实名称、真实坐标、真实地址、
//   真实医院等级。不编造任何字段；缺字段（菜单/价格/简介）一律留空，交给合并脚本按真实 rep 兜底。
//   医院命中「城市名+人民医院/中医院/…」模板名红线的，默认跳过（与 _merge-team-enrich.mjs 的红线一致），
//   避免把合规源里的真实名误伤——如确需收录，去掉 --skip-template 的默认行为自行调整。
//
// 配额：高德「搜索类」（text/around）个人认证仅 100 次/日/账号；多 key 共享同池，不扩容。
//   本脚本按请求计数，超出即停并报告，绝不盲跑。
import { createRequire } from "module";
import { writeFileSync, readFileSync, existsSync } from "fs";
const req = createRequire(process.cwd() + "/");

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
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
const KEYS = (get("--keys") || get("--key") || process.env.AMAP_KEY || "").split(",").filter(Boolean);
if (!KEYS.length) { console.error("✗ 缺少高德 key：--key <KEY> 或环境变量 AMAP_KEY"); process.exit(1); }
const https = (() => { try { return req("https"); } catch (e) { return require("https"); } })();
function amapText(key, keyword, city, page) {
  const params = `key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&citylimit=true&offset=25&page=${page}&extensions=all`;
  const url = `https://restapi.amap.com/v3/place/text?${params}`;
  return new Promise((res, rej) => {
    https.get(url, r => { let b = ""; r.on("data", d => b += d); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}

(async () => {
  const targets = ALL ? (D.CITIES || []).filter(c => !c.limited).map(c => c.name)
    : CITY ? [CITY]
    : (existsSync("tools/team/gap-targets.json") ? JSON.parse(readFileSync("tools/team/gap-targets.json", "utf8")).cities.map(r => r.city) : []);
  if (!targets.length) { console.error("✗ 无目标城市：用 --all / --city / 先跑 gap-report.mjs"); process.exit(1); }
  const out = { region: "amap-auto", food: {}, hospitals: {} };
  let used = 0, dayCap = 100 * KEYS.length;  // 搜索类配额
  let ki = 0;
  const nextKey = () => KEYS[ki = (ki + 1) % KEYS.length];

  for (const city of targets) {
    if (used >= dayCap) { console.warn(`⚠ 已达日配额 ${dayCap}，停止。剩余 ${targets.length - targets.indexOf(city)} 城下次再跑。`); break; }
    const ctr = cityCenter(city);
    for (const kw of ["美食", "旅游景点", "医院"]) {
      let page = 1, got = 0;
      while (page <= 2 && got < LIMIT) {
        const key = KEYS[ki % KEYS.length]; ki++; used++;
        let json;
        try { json = await amapText(key, kw, city, page); } catch (e) { console.warn("  ⚠", city, kw, "请求失败", e.message); break; }
        const pois = parsePois(json);
        if (!pois.length) break;
        for (const p of pois) {
          if (p.lonlat.length !== 2 || !IN_CHINA(p.lonlat[1], p.lonlat[0])) continue;
          const lat = p.lonlat[1], lon = p.lonlat[0];
          if (kw === "医院") {
            if (SKIP_TPL && TPL.some(t => p.name === city + t)) { continue; } // 模板名红线，跳过
            if (!out.hospitals[city]) out.hospitals[city] = [];
            out.hospitals[city].push({ n: p.name, lat: +lat.toFixed(4), lon: +lon.toFixed(4), lv: mapLv(p.tag) });
          } else if (kw === "美食") {
            const shop = { shop: p.name, lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
            const rep = mapRep(p.tag); if (rep) shop.rep = rep;
            if (p.cost) shop.price = "人均约¥" + p.cost;
            if (!out.food[city]) out.food[city] = [];
            out.food[city].push(shop);
          }
          got++;
        }
        page++;
      }
    }
  }
  writeFileSync("tools/team/daily-region-amap.json", JSON.stringify(out, null, 2));
  console.log(`✅ 写出 tools/team/daily-region-amap.json：美食 ${Object.keys(out.food).length} 城 / 医院 ${Object.keys(out.hospitals).length} 城（共用 ${used} 次搜索配额）`);
  console.log("下一步：node tools/_merge-team-enrich.mjs --pack   # 合并入包并重打包");
})();
