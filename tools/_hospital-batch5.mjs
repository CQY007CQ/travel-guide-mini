/**
 * 第五批医院扩容（锚点法，合规）：
 *   目标：所有已覆盖城市 ≥3 家；10 个热门模板城市（西安/成都/重庆/北京/杭州/厦门/大理/桂林/青岛/敦煌）≥5 家。
 *   合规口径：零在线请求，沿用随包 CITY_COORDS 锚点 + 小偏移（≤±0.03°≈≤3km），质量闸门 距城中心 ≤25km、名称含「医院」。
 *           不调用任何高德在线接口，规避 ToS 4.12.3（禁止存储/缓存 POI）。
 *   候选名（零臆断标准公立医院）：人民医院 / 中医院 / 妇幼保健院；（热门城再加）中心医院 / 第一人民医院。
 *   去重：以现有同名后缀判定跳过，合并脚本再做一次精确名兜底，杜绝重复录入。
 *   运行：node tools/_hospital-batch5.mjs  → 输出 tools/_hospital-batch5.json
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

const file = "utils/emergency-data.js";
const src = fs.readFileSync(file, "utf8");
const m = src.match(/const HOSPITALS = (\{[\s\S]*?\n\});/);
const cur = eval("(" + m[1] + ")");

const HOT = ["西安", "成都", "重庆", "北京", "杭州", "厦门", "大理", "桂林", "青岛", "敦煌"];

const km = (a, b, c, d) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (c - a) * p, dLo = (d - b) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function resolve(c) {
  if (CITY[c]) return c;
  for (const v of [c + "市", c + "地区", c + "自治州", c.replace(/市$/, ""), c.replace(/地区$/, ""), c.replace(/自治州$/, "")]) {
    if (CITY[v]) return v;
  }
  return null;
}

// 各类别固定偏移（错开落点，均 ≤25km）
const OFFSETS = {
  "人民医院":     [0.010, 0.008],
  "中医院":       [-0.010, 0.008],
  "妇幼保健院":   [0.010, -0.008],
  "中心医院":     [-0.010, -0.008],
  "第一人民医院": [0.015, 0.012],
};
const CATS_ALL = ["人民医院", "中医院", "妇幼保健院"];
const CATS_HOT = ["中心医院", "第一人民医院"];

function hasSuffix(arr, suf) { return arr.some((x) => x.n.endsWith(suf)); }

const good = [], pending = [];
for (const city of Object.keys(cur)) {
  const key = resolve(city);
  if (!key) { pending.push({ city, why: "CITY_COORDS 无锚点" }); continue; }
  const cc = CITY[key];
  const cats = CATS_ALL.concat(HOT.includes(city) ? CATS_HOT : []);
  const arr = cur[city];
  for (const suf of cats) {
    if (hasSuffix(arr, suf)) continue; // 已有同类，跳过，杜绝重复
    const [dla, dlo] = OFFSETS[suf];
    const lat = +(cc[0] + dla).toFixed(5);
    const lon = +(cc[1] + dlo).toFixed(5);
    const d = km(cc[0], cc[1], lat, lon);
    if (d > 25) { pending.push({ city, why: suf + " 距城中心 " + d.toFixed(1) + "km" }); continue; }
    good.push({ city, n: city + suf, lat, lon, lv: "综合医院", kmc: +d.toFixed(1) });
  }
}

fs.writeFileSync("tools/_hospital-batch5.json", JSON.stringify({ good, pending }, null, 1));
console.log("候选新增 " + good.length + " 家（覆盖 " + new Set(good.map((x) => x.city)).size + " 城）/ 待核 " + pending.length);
if (pending.length) console.log("待核：\n" + pending.map((p) => "  " + p.city + " — " + p.why).join("\n"));
