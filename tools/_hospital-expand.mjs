/**
 * 一次性：医院扩城（43 → 60 城）
 * 走与之前完全相同的合规路径：geocode/geo（地址→坐标）+ 质量闸门
 *   闸门：返回地址必须含「医院」、非公交站、距城中心 ≤25km
 * 通过者合并进 utils/emergency-data.js 的 HOSPITALS（重建该块），失败者记入待核。
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

// 只列名称可确证的大型综合医院；等级拿不准写「综合医院」
const LIST = [
  { city: "温州", name: "温州医科大学附属第一医院", lv: "三甲" },
  { city: "温州", name: "温州市中心医院", lv: "三甲" },
  { city: "泉州", name: "泉州市第一医院", lv: "三甲" },
  { city: "泉州", name: "福建医科大学附属第二医院", lv: "三甲" },
  { city: "常州", name: "常州市第一人民医院", lv: "三甲" },
  { city: "常州", name: "常州市第二人民医院", lv: "三甲" },
  { city: "南通", name: "南通大学附属医院", lv: "三甲" },
  { city: "徐州", name: "徐州医科大学附属医院", lv: "三甲" },
  { city: "徐州", name: "徐州市中心医院", lv: "三甲" },
  { city: "芜湖", name: "皖南医学院弋矶山医院", lv: "三甲" },
  { city: "宜昌", name: "宜昌市中心人民医院", lv: "三甲" },
  { city: "襄阳", name: "襄阳市中心医院", lv: "三甲" },
  { city: "绵阳", name: "绵阳市中心医院", lv: "三甲" },
  { city: "遵义", name: "遵义医科大学附属医院", lv: "三甲" },
  { city: "柳州", name: "柳州市人民医院", lv: "三甲" },
  { city: "唐山", name: "唐山市工人医院", lv: "三甲" },
  { city: "保定", name: "保定市第一中心医院", lv: "三甲" },
  { city: "大同", name: "大同市第三人民医院", lv: "三甲" },
  { city: "运城", name: "运城市中心医院", lv: "三甲" },
  { city: "延安", name: "延安大学附属医院", lv: "三甲" },
  { city: "宝鸡", name: "宝鸡市中心医院", lv: "三甲" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ki = 0;
const good = [], pending = [];

for (const it of LIST) {
  const k = keys[ki++ % keys.length];
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent(it.city + it.name)}&city=${encodeURIComponent(it.city)}`;
  let r = null;
  try {
    const j = JSON.parse(execSync(`curl -s --max-time 12 "${url}"`, { encoding: "utf8" }));
    const g = j.geocodes && j.geocodes[0];
    if (String(j.infocode) === "10000" && g && g.location) {
      const [lo, la] = g.location.split(",").map(Number);
      r = { lat: la, lon: lo, addr: g.formatted_address || "" };
    }
  } catch (e) {}

  let why = null;
  if (!r) why = "未命中";
  else if (r.addr.indexOf("医院") < 0) why = "地址不含医院 → " + r.addr.slice(0, 22);
  else if (r.addr.indexOf("公交站") >= 0) why = "公交站";
  else {
    const cc = CITY[it.city];
    if (!cc) why = "无城中心坐标";
    else {
      const d = km(cc[0], cc[1], r.lat, r.lon);
      if (d > 25) why = "距城中心 " + d.toFixed(0) + "km";
      else {
        good.push({ city: it.city, n: it.name, lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5), lv: it.lv, kmc: +d.toFixed(1) });
        console.log("✓ " + it.city + " / " + it.name + "  " + d.toFixed(1) + "km");
      }
    }
  }
  if (why) { pending.push({ city: it.city, name: it.name, why }); console.log("✗ " + it.city + " / " + it.name + " ← " + why); }
  await sleep(110);
}

fs.writeFileSync("tools/_hospital-batch2.json", JSON.stringify({ good, pending }, null, 1));
console.log("\n通过 " + good.length + " 家（" + new Set(good.map((x) => x.city)).size + " 城）/ 待核 " + pending.length);
