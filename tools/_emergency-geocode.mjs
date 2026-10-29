/**
 * 一次性：为试点城市的主要医院取真实坐标（geocode/geo，合规：地址→坐标，不抓 POI）
 * 输出 tools/_emergency-coords.json 供人工核对后写入 utils/emergency-data.js
 */
import fs from "fs";
import { execSync } from "child_process";

const keys = fs.readFileSync("tools/geocode.keys", "utf8")
  .split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9]{28,40}$/.test(s));

// 只收录「名称可确证」的大型综合/专科医院；等级拿不准的写「综合医院」而不硬标三甲
const LIST = [
  { city: "太原", name: "山西医科大学第一医院", level: "三甲" },
  { city: "太原", name: "山西省人民医院", level: "三甲" },
  { city: "北京", name: "北京协和医院", level: "三甲" },
  { city: "北京", name: "北京大学第一医院", level: "三甲" },
  { city: "北京", name: "首都医科大学附属北京天坛医院", level: "三甲" },
  { city: "成都", name: "四川大学华西医院", level: "三甲" },
  { city: "成都", name: "四川省人民医院", level: "三甲" },
  { city: "西安", name: "西安交通大学第一附属医院", level: "三甲" },
  { city: "西安", name: "陕西省人民医院", level: "三甲" },
  { city: "杭州", name: "浙江大学医学院附属第一医院", level: "三甲" },
  { city: "杭州", name: "浙江大学医学院附属第二医院", level: "三甲" },
  { city: "重庆", name: "重庆医科大学附属第一医院", level: "三甲" },
  { city: "重庆", name: "重庆市急救医疗中心", level: "三甲" },
  { city: "青岛", name: "青岛大学附属医院", level: "三甲" },
  { city: "青岛", name: "青岛市市立医院", level: "三甲" },
  { city: "三亚", name: "三亚市人民医院", level: "综合医院" },
  { city: "丽江", name: "丽江市人民医院", level: "综合医院" },
  { city: "桂林", name: "桂林医学院附属医院", level: "三甲" },
  { city: "敦煌", name: "敦煌市医院", level: "综合医院" },
  { city: "拉萨", name: "西藏自治区人民医院", level: "三甲" },
  { city: "大理", name: "大理州人民医院", level: "综合医院" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let i = 0;
for (const h of LIST) {
  const k = keys[i++ % keys.length];
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent(h.name)}&city=${encodeURIComponent(h.city)}`;
  let res = {};
  try {
    res = JSON.parse(execSync(`curl -s --max-time 12 "${url}"`, { encoding: "utf8" }));
  } catch (e) { /* 网络异常留空 */ }
  const g = res.geocodes && res.geocodes[0];
  const ok = String(res.infocode) === "10000" && g && g.location;
  const rec = {
    city: h.city, name: h.name, level: h.level,
    lat: ok ? +g.location.split(",")[1] : null,
    lon: ok ? +g.location.split(",")[0] : null,
    addr: ok ? g.formatted_address : "",
    _cityOk: ok ? (g.formatted_address || "").indexOf(h.city) >= 0 : false,
  };
  out.push(rec);
  console.log(
    (ok ? "✓" : "✗") + " " + h.city + " / " + h.name +
    (ok ? "  → " + g.formatted_address + "  " + rec.lat + "," + rec.lon + (rec._cityOk ? "" : "  ⚠城市不符") : "  未命中")
  );
  await sleep(120);
}
fs.writeFileSync("tools/_emergency-coords.json", JSON.stringify(out, null, 1));
const okN = out.filter((x) => x.lat != null).length;
const cityOkN = out.filter((x) => x._cityOk).length;
console.log("\n合计 " + out.length + " 家 | 取到坐标 " + okN + " | 城市校验通过 " + cityOkN);
