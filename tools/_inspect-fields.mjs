// 结构勘察：CITIES 单条 experiences 的字段构成、CITY_LANDMARKS_EXTRA 结构、坐标重复度
import fs from "fs";
import path from "path";
import zlib from "zlib";

const PACKED = path.join(process.cwd(), "subdata", "data", "data-packed.js");
const raw = fs.readFileSync(PACKED, "utf8");
const b64 = raw.slice(raw.indexOf("\""), raw.lastIndexOf("\"")).replace(/^"|"$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));

// 1) experiences 字段构成（统计全部 experiences 出现的 key 频次与样例）
const keyCount = {};
let sample = null;
let totalExp = 0;
for (const c of D.CITIES) {
  for (const e of (c.experiences || [])) {
    totalExp++;
    if (!sample && e) sample = e;
    for (const k of Object.keys(e)) keyCount[k] = (keyCount[k] || 0) + 1;
  }
}
console.log("=== experiences 字段频次（总", totalExp, "条）===");
for (const k of Object.keys(keyCount).sort((a, b) => keyCount[b] - keyCount[a])) {
  console.log(" ", k.padEnd(14), keyCount[k]);
}
console.log("\n样例 experience:");
console.log(JSON.stringify(sample, null, 0).slice(0, 500));

// 2) CITY_LANDMARKS_EXTRA 结构
console.log("\n=== CITY_LANDMARKS_EXTRA ===");
const cle = D.CITY_LANDMARKS_EXTRA;
console.log("类型:", Array.isArray(cle) ? "array len " + cle.length : typeof cle);
if (Array.isArray(cle) && cle.length) {
  console.log("首条:", JSON.stringify(cle[0]).slice(0, 300));
  // 看是不是 {city:[...]} 还是扁平
  const first = cle[0];
  if (typeof first === "object" && first !== null) {
    for (const k of Object.keys(first)) {
      const v = first[k];
      console.log("  key", k, "样例:", JSON.stringify(v).slice(0, 200));
    }
  }
}
if (typeof cle === "object" && cle !== null && !Array.isArray(cle)) {
  const keys = Object.keys(cle);
  console.log("对象键数:", keys.length, "样例键:", keys.slice(0, 5));
  for (const k of keys.slice(0, 2)) console.log(" ", k, "→", JSON.stringify(cle[k]).slice(0, 200));
}

// 3) experiences 里是否带坐标，与 SPOT_COORDS 重复度
let expWithCoord = 0, expCoordBytes = 0;
for (const c of D.CITIES) {
  for (const e of (c.experiences || [])) {
    if (e && (e.lat !== undefined || e.lng !== undefined || e.lon !== undefined)) {
      expWithCoord++;
      expCoordBytes += JSON.stringify([e.lat, e.lng !== undefined ? e.lng : e.lon]).length;
    }
  }
}
console.log("\n=== 坐标重复度 ===");
console.log("experiences 带坐标的条数:", expWithCoord, "/", totalExp);
console.log("若从 experiences 移除坐标可省原始字节:", expCoordBytes);
