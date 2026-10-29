/**
 * 美食试点 v2：洛阳 —— 只收「有明确门牌地址」的店，geocode 精确地址并校验街道
 *
 * 为什么改：geocode 解析的是地址而非店名。用店名查会把「二合馆」匹配到「洛阳博物馆(公交站)」、
 * 把「杏花村水席楼」匹配到「洛阳水席楼(正大广场店)」。所以必须喂地址，并校验返回地址含预期街道。
 *
 * 合规：店名/地址为事实信息；坐标由 geocode/geo 取得；不抓 POI 列表、不复制文章正文。
 * 价格仅在有明确公开来源时写入，且为约数。
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
const CITY = (load("subdata/data/data-packed.js").CITY_COORDS) || {};
const km = (a, b, c, d) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (c - a) * p, dLo = (d - b) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// addr = 公开资料里给出的门牌/路口地址；expect = 返回地址必须包含的街道词（用于校验没跑偏）
const LIST = [
  { city: "洛阳", shop: "真不同饭店", addr: "老城区中州东路359号", expect: "中州东路", price: "人均约¥90" },
  { city: "洛阳", shop: "马杰山牛肉汤馆", addr: "瀍河回族区启明东路235号", expect: "启明东路", price: "人均约¥25" },
  { city: "洛阳", shop: "龙门三旦羊肉汤", addr: "洛龙区龙门大道863号", expect: "龙门大道", price: "人均约¥15" },
  { city: "洛阳", shop: "东关大石桥陈记驴肉汤", addr: "瀍河回族区夹马营路87号", expect: "夹马营路", price: "人均约¥25" },
  { city: "洛阳", shop: "和记涮牛肚", addr: "春都路10号", expect: "春都路", price: "" },
  { city: "洛阳", shop: "小街天府", addr: "西工区西工小街与人民东路交叉口", expect: "小街", price: "人均约¥30" },
  { city: "洛阳", shop: "真不同饭店（新区店）", addr: "洛龙区太康路与广利街交叉口", expect: "太康路", price: "人均约¥90" },
  { city: "洛阳", shop: "管记水席老店", addr: "老城区仙果市街", expect: "仙果市街", price: "人均约¥25" },
  { city: "洛阳", shop: "杏花村水席楼", addr: "老城区西大街", expect: "西大街", price: "人均约¥35" },
  { city: "洛阳", shop: "南关小碗牛肉汤", addr: "老城区九都东路", expect: "九都东路", price: "人均约¥15" },
  { city: "洛阳", shop: "白果牛肉汤", addr: "瀍河回族区利民西街", expect: "利民西街", price: "人均约¥20" },
  { city: "洛阳", shop: "耀耀水席", addr: "瀍河回族区启明东路", expect: "启明东路", price: "人均约¥40" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ki = 0;
const good = [], pending = [];
for (const it of LIST) {
  const k = keys[ki++ % keys.length];
  const q = it.city + it.addr;
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent(q)}&city=${encodeURIComponent(it.city)}`;
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
  else if (r.addr.indexOf(it.expect) < 0) why = "地址不含「" + it.expect + "」→ " + r.addr.slice(0, 26);
  else if (r.addr.indexOf("公交站") >= 0) why = "匹配到公交站";
  else {
    const cc = CITY[it.city];
    const d = cc ? km(cc[0], cc[1], r.lat, r.lon) : 999;
    if (d > 25) why = "距城中心 " + d.toFixed(0) + "km";
    else {
      const rec = { shop: it.shop, lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5) };
      if (it.price) rec.price = it.price;
      good.push({ city: it.city, ...rec, _km: +d.toFixed(1), _addr: r.addr });
      console.log("✓ " + it.shop.padEnd(14) + " " + d.toFixed(1) + "km  " + r.addr.slice(0, 30));
    }
  }
  if (why) { pending.push({ city: it.city, shop: it.shop, addr: it.addr, why }); console.log("✗ " + it.shop + " ← " + why); }
  await sleep(110);
}
fs.writeFileSync("tools/_food-good.json", JSON.stringify(good, null, 1));
fs.writeFileSync("tools/_food-pending.json", JSON.stringify(pending, null, 1));
console.log("\n通过 " + good.length + " / " + LIST.length + "，待核 " + pending.length);
