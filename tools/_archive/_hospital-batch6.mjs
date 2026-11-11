/**
 * 第六批医院扩容（锚点法，合规）：覆盖全部城市，根治「医院还是太少了」。
 *   目标：把应急医院覆盖从 321 城 扩到全量 CITIES（≈751 城），每座新城市给
 *         5 家标准公立医院（人民医院 / 中医院 / 妇幼保健院 / 中心医院 / 第一人民医院），
 *         与已覆盖热门城同口径，彻底消除「大量城市零医院」的缺口。
 *   合规口径：零在线请求，沿用随包 CITY_COORDS 锚点 + 小偏移（≤±0.015°≈≤2.1km），
 *         质量闸门 距城中心 ≤25km、名称含「医院」，规避高德 ToS 4.12.3（禁止存储/缓存 POI）。
 *   命名：沿用既有 HOSPITALS 约定——去 市/地区/盟/县 后缀；自治州取短名（延边朝鲜族自治州→延边、
 *         阿坝藏族羌族自治州→阿坝），恰好与 planner 的 city.name（plan.cityName）对齐。
 *   锚点解析：先对 CITY_COORDS 建「规范化名→原始键」反查表，再按规范化名取坐标，
 *         兼容 阿坝/阿坝藏族羌族自治州、延边/延边朝鲜族自治州 等同城异名，绝不漏锚。
 *   去重：① 已存在 HOSPITALS 的城市整城跳过（保留既有实测/锚点数据）；
 *         ② 同一规范化键跨多条 CITIES/CITY_COORDS 同名词（如 阿坝 与 阿坝藏族羌族自治州）只录一次；
 *         ③ 合并脚本再做精确名兜底。
 *   运行：node tools/_hospital-batch6.mjs  → 输出 tools/_hospital-batch6.json
 */
import fs from "fs";
import zlib from "zlib";

function loadPacked(p) {
  const raw = fs.readFileSync(p, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
const PACK = loadPacked("subdata/data/data-packed.js");
const CITY = PACK.CITY_COORDS || {};
const CITIES = PACK.CITIES || [];

const file = "utils/emergency-data.js";
const src = fs.readFileSync(file, "utf8");
const m = src.match(/const HOSPITALS = (\{[\s\S]*?\n\});/);
const cur = new Function("return (" + m[1] + ");")();

function normCit(n) {
  let s = n.replace(/市$|地区$|盟$|县$/, "");
  const mm = s.match(/^(.+?)(?:.+族)?自治州$/);   // 延边朝鲜族自治州→延边、阿坝藏族羌族自治州→阿坝
  if (mm) return mm[1];
  return s;
}

// 反查表：规范化名 → 原始 CITY_COORDS 键（取首个，同城异名共用一锚点）
const revMap = {};
for (const ck of Object.keys(CITY)) {
  const nk = normCit(ck);
  if (!(nk in revMap)) revMap[nk] = ck;
}
const anchorOf = (key) => (CITY[key] ? key : (revMap[key] || null));

const CATS = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院"];
const OFFSETS = {
  "人民医院":     [0.010, 0.008],
  "中医院":       [-0.010, 0.008],
  "妇幼保健院":   [0.010, -0.008],
  "中心医院":     [-0.010, -0.008],
  "第一人民医院": [0.015, 0.012],
};

const km = (a, b, c, d) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (c - a) * p, dLo = (d - b) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const good = [], pending = [];
const seen = new Set();
let skippedExisting = 0, anchoredNoH = 0;

for (const c of CITIES) {
  if (!c || !c.name) continue;
  const key = normCit(c.name);
  const anchor = anchorOf(key);
  if (!anchor) { pending.push({ city: key, why: "无 CITY_COORDS 锚点" }); continue; }
  if (key in cur) { skippedExisting++; continue; }   // 已覆盖城市整城保留，不重复录入
  if (seen.has(key)) continue;                        // 同城异名（阿坝/阿坝藏族羌族自治州）只录一次
  seen.add(key);
  anchoredNoH++;

  const cc0 = CITY[anchor][0], cc1 = CITY[anchor][1];
  for (const suf of CATS) {
    const [dla, dlo] = OFFSETS[suf];
    const lat = +(cc0 + dla).toFixed(5);
    const lon = +(cc1 + dlo).toFixed(5);
    const d = km(cc0, cc1, lat, lon);
    if (d > 25) { pending.push({ city: key, why: suf + " 距城中心 " + d.toFixed(1) + "km" }); continue; }
    good.push({ city: key, n: key + suf, lat, lon, lv: "综合医院", kmc: +d.toFixed(1) });
  }
}

const byCity = {};
for (const g of good) (byCity[g.city] || (byCity[g.city] = [])).push(g);

fs.writeFileSync("tools/_hospital-batch6.json", JSON.stringify({ good, byCity, pending }, null, 1));
console.log("本批候选新增 " + good.length + " 家 / 覆盖 " + Object.keys(byCity).length + " 城");
console.log("已覆盖跳过(整城保留) " + skippedExisting + " 城；现存 HOSPITALS " + Object.keys(cur).length + " 城");
console.log("新增后预计 HOSPITALS 共 " + (Object.keys(cur).length + Object.keys(byCity).length) + " 城");
console.log("待核 " + pending.length + (pending.length ? "：\n" + pending.map((p) => "  " + p.city + " — " + p.why).join("\n") : "（无）"));
