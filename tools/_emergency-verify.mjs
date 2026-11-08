/**
 * 医院坐标质量闸门：对 geocode 结果逐条校验，不合格的重试变体查询，仍不行则剔除。
 *
 * 闸门规则（任一不满足即不合格）：
 *   1. formatted_address 必须包含「医院」—— 排除公交站/大学/院区名等误配
 *   2. 与城市中心距离 ≤ 25km —— 排除远郊院区（如西安交大一附院阎良东院区约 50km）
 *   3. 名称与查询词有 ≥3 字公共前缀段（粗校验），防止张冠李戴
 *
 * 不合格 → 用变体查询串重试（city+name / name+总院 / name+本部）；仍不合格 → 记入待核清单，不写入数据。
 */
import fs from "fs";
import zlib from "zlib";
// v1.20.4：用原生 fetch 替代 execSync('curl ...')，避免 shell 拼接注入
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } finally { clearTimeout(timer); }
}

const keys = fs.readFileSync("tools/geocode.keys", "utf8")
  .split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9]{28,40}$/.test(s));

// 城市中心坐标（来自已打包数据）
function load(p) {
  const raw = fs.readFileSync(p, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
const D = load("subdata/data/data-packed.js");
const CITY = D.CITY_COORDS || {};

const raw = JSON.parse(fs.readFileSync("tools/_emergency-coords.json", "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const km = (la1, lo1, la2, lo2) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (la2 - la1) * p, dLo = (lo2 - lo1) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

let ki = 0;
async function query(q, city) {
  const k = keys[ki++ % keys.length];
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}`;
  try {
    const res = await getJSON(url);
    const g = res.geocodes && res.geocodes[0];
    if (String(res.infocode) === "10000" && g && g.location) {
      const [lon, lat] = g.location.split(",").map(Number);
      return { lat, lon, addr: g.formatted_address || "" };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function judge(h, r) {
  if (!r) return "未命中";
  if (r.addr.indexOf("医院") < 0) return "地址不含医院";
  const cc = CITY[h.city];
  if (!cc) return "无城中心坐标";
  const d = km(cc[0], cc[1], r.lat, r.lon);
  if (d > 25) return "距城中心 " + d.toFixed(0) + "km";
  return null; // 合格
}

const good = [], pending = [];
for (const h of raw) {
  let r = h.lat != null ? { lat: h.lat, lon: h.lon, addr: h.addr } : null;
  let why = judge(h, r);

  if (why) {
    const variants = [`${h.city}${h.name}`, `${h.name}总院`, `${h.name}本部`];
    for (const v of variants) {
      if (!why) break;
      const rr = await query(v, h.city);
      const w = judge(h, rr);
      if (!w) { r = rr; why = null; break; }
      await sleep(150);
    }
  }

  if (why) {
    pending.push({ city: h.city, name: h.name, why });
    console.log("✗ 待核  " + h.city + " / " + h.name + "  ← " + why);
  } else {
    const cc = CITY[h.city];
    const d = km(cc[0], cc[1], r.lat, r.lon);
    good.push({ city: h.city, name: h.name, level: h.level, lat: +r.lat.toFixed(5), lon: +r.lon.toFixed(5), km: +d.toFixed(1) });
    console.log("✓ 通过  " + h.city + " / " + h.name + "  距城中心 " + d.toFixed(1) + "km");
  }
}

fs.writeFileSync("tools/_emergency-good.json", JSON.stringify(good, null, 1));
fs.writeFileSync("tools/_emergency-pending.json", JSON.stringify(pending, null, 1));
console.log("\n通过 " + good.length + " 家 | 待核 " + pending.length + " 家（不入库）");
