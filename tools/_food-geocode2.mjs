/**
 * 美食批次 2：北京（公开资料提店名 + 门牌地址 → geocode → 闸门）
 * 目标：北京 22 家 → 30 家（热门城市达标）
 * 闸门：返回地址须含预期街道、非公交站、距城中心 ≤25km
 */
import fs from "fs";
import zlib from "zlib";
import { execSync } from "child_process";

const keys = fs.readFileSync("tools/geocode.keys", "utf8")
  .split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9]{28,40}$/.test(s));
function load(p) {
  const raw = fs.readFileSync(p, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
const CITY = load("subdata/data/data-packed.js").CITY_COORDS || {};
const km = (a, b, c, d) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (c - a) * p, dLo = (d - b) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const LIST = [
  { shop: "便宜坊烤鸭（灯市口店）", addr: "东城区东四南大街157号", expect: "东四南大街", price: "人均约¥120" },
  { shop: "东来顺饭庄（王府井APM店）", addr: "东城区王府井大街138号", expect: "王府井大街", price: "人均约¥130" },
  { shop: "姚记炒肝（鼓楼店）", addr: "东城区鼓楼东大街299号", expect: "鼓楼东大街", price: "人均约¥32" },
  { shop: "护国寺小吃（护国寺总店）", addr: "西城区护国寺大街93号", expect: "护国寺", price: "人均约¥31" },
  { shop: "烤肉季（起源店）", addr: "西城区前海东沿14号", expect: "前海东沿", price: "人均约¥120" },
  { shop: "烤肉宛（总店）", addr: "西城区南礼士路58号", expect: "南礼士路", price: "人均约¥110" },
  { shop: "都一处烧卖馆（前门店）", addr: "东城区前门大街38号", expect: "前门大街", price: "人均约¥70" },
  { shop: "天兴居（鲜鱼口店）", addr: "东城区鲜鱼口街81号", expect: "鲜鱼口", price: "人均约¥30" },
  { shop: "鸿宾楼（展览馆路店）", addr: "西城区展览馆路11号", expect: "展览馆路", price: "人均约¥150" },
  { shop: "方砖厂69号炸酱面（前门店）", addr: "东城区前门大街45号", expect: "前门大街", price: "人均约¥30" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ki = 0;
const good = [], pending = [];
for (const it of LIST) {
  const k = keys[ki++ % keys.length];
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent("北京" + it.addr)}&city=${encodeURIComponent("北京")}`;
  let r = null;
  try {
    const res = JSON.parse(execSync(`curl -s --max-time 12 "${url}"`, { encoding: "utf8" }));
    const g = res.geocodes && res.geocodes[0];
    if (String(res.infocode) === "10000" && g && g.location) {
      const [lon, lat] = g.location.split(",").map(Number);
      r = { lat, lon, addr: g.formatted_address || "" };
    }
  } catch (e) {}
  let why = null;
  if (!r) why = "未命中";
  else if (r.addr.indexOf(it.expect) < 0) why = "地址不含「" + it.expect + "」→ " + r.addr.slice(0, 24);
  else if (r.addr.indexOf("公交站") >= 0) why = "匹配到公交站";
  else {
    const cc = CITY["北京"];
    const d = cc ? km(cc[0], cc[1], r.lat, r.lon) : 999;
    if (d > 25) why = "距城中心 " + d.toFixed(0) + "km";
    else {
      good.push({ city: "北京", shop: it.shop, lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5), price: it.price, _addr: r.addr, _km: +d.toFixed(1) });
      console.log("✓ " + it.shop.padEnd(20) + " " + d.toFixed(1) + "km  " + r.addr.slice(0, 28));
    }
  }
  if (why) { pending.push({ city: "北京", shop: it.shop, addr: it.addr, why }); console.log("✗ " + it.shop + " ← " + why); }
  await sleep(110);
}
fs.writeFileSync("tools/_food-good2.json", JSON.stringify(good, null, 1));
fs.writeFileSync("tools/_food-pending2.json", JSON.stringify(pending, null, 1));
console.log("\n北京：通过 " + good.length + " / " + LIST.length);
