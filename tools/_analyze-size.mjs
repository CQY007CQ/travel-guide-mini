// 数据体积分析：解压 data-packed.js，按顶层字段分别测「原始 JSON」与「deflate(9)+base64」体积。
// 目的：定位 subdata 包内可压缩/可砍的大头字段，为 by-city 放量腾空间。
import fs from "fs";
import path from "path";
import zlib from "zlib";

const PACKED = path.join(process.cwd(), "subdata", "data", "data-packed.js");
const raw = fs.readFileSync(PACKED, "utf8");
const b64 = raw.slice(raw.indexOf("\""), raw.lastIndexOf("\"")).replace(/^"|"$/g, "");
const json = zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8");
const D = JSON.parse(json);

function packedSize(v) {
  return zlib.deflateSync(Buffer.from(JSON.stringify(v), "utf8"), { level: 9 }).toString("base64").length;
}

const rows = [];
let totalRaw = 0, totalPacked = 0;
for (const k of Object.keys(D)) {
  const rawLen = JSON.stringify(D[k]).length;
  const pkLen = packedSize(D[k]);
  rows.push({ k, rawLen, pkLen });
  totalRaw += rawLen;
  totalPacked += pkLen;
}
rows.sort((a, b) => b.pkLen - a.pkLen);

console.log("字段                        原始KB   压缩KB   占压缩包%");
console.log("--------------------------------------------------------------");
for (const r of rows) {
  console.log(
    r.k.padEnd(26),
    (r.rawLen / 1024).toFixed(0).padStart(7),
    (r.pkLen / 1024).toFixed(0).padStart(8),
    ((r.pkLen / totalPacked) * 100).toFixed(1).padStart(8)
  );
}
console.log("--------------------------------------------------------------");
console.log("合计".padEnd(26), (totalRaw / 1024).toFixed(0).padStart(7), (totalPacked / 1024).toFixed(0).padStart(8), "100.0");

// 关键规模指标
console.log("\n=== 规模指标 ===");
if (D.CITIES) console.log("城市数 CITIES:", D.CITIES.length);
let expCount = 0;
if (D.CITIES) for (const c of D.CITIES) expCount += (c.experiences || []).length;
console.log("experiences 总条目:", expCount);
if (D.SPOT_DETAILS) console.log("SPOT_DETAILS 键数:", Object.keys(D.SPOT_DETAILS).length);
if (D.SPOT_DETAILS_BY_CITY) {
  let n = 0, cities = 0;
  for (const ck of Object.keys(D.SPOT_DETAILS_BY_CITY)) {
    cities++; n += Object.keys(D.SPOT_DETAILS_BY_CITY[ck]).length;
  }
  console.log("SPOT_DETAILS_BY_CITY: 城市", cities, " 条目", n);
}
if (D.SPOT_COORDS) {
  let n = 0;
  for (const ck of Object.keys(D.SPOT_COORDS)) n += D.SPOT_COORDS[ck].length;
  console.log("SPOT_COORDS 坐标点:", n, " 城市", Object.keys(D.SPOT_COORDS).length);
}
if (D.FOOD_SPOTS) {
  let n = 0;
  for (const ck of Object.keys(D.FOOD_SPOTS)) n += D.FOOD_SPOTS[ck].length;
  console.log("FOOD_SPOTS 店:", n, " 城市", Object.keys(D.FOOD_SPOTS).length);
}
if (D.SPOT_TICKETS) console.log("SPOT_TICKETS 键:", Object.keys(D.SPOT_TICKETS).length);
if (D.BOOKING_TIPS) console.log("BOOKING_TIPS 键:", Object.keys(D.BOOKING_TIPS).length);

console.log("\n=== 实测包体 ===");
console.log("data-packed.js 文件:", (fs.statSync(PACKED).size / 1024).toFixed(0) + "KB");
console.log("deflate(base64) 总:", (b64.length / 1024).toFixed(0) + "KB", " 压缩率", (b64.length / json.length * 100).toFixed(1) + "%");
