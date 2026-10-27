// 安全去重基准 = SPOT_COORDS 名字（getSpotCity 先扫它）。只砍「在 SPOT_COORDS 里能解析」的冗余名。
import fs from "fs";
import path from "path";
import zlib from "zlib";
const PACKED = path.join(process.cwd(), "subdata", "data", "data-packed.js");
const raw = fs.readFileSync(PACKED, "utf8");
const b64 = raw.slice(raw.indexOf("\""), raw.lastIndexOf("\"")).replace(/^"|"$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
function pk(v){ return zlib.deflateSync(Buffer.from(JSON.stringify(v),"utf8"),{level:9}).toString("base64").length; }

// SPOT_COORDS 名字集合（全局 + 每城）
const coordNamesAll = new Set();
const coordNamesByCity = {};
for (const ck in (D.SPOT_COORDS||{})) {
  const s = new Set();
  for (const e of D.SPOT_COORDS[ck]) if (Array.isArray(e) && typeof e[0]==="string") { s.add(e[0]); coordNamesAll.add(e[0]); }
  coordNamesByCity[ck] = s;
}

let total=0, dupInCity=0, dupAnywhere=0, keep=0;
const safeDedup = {};
for (const cn in (D.CITY_LANDMARKS_EXTRA||{})) {
  const arr = D.CITY_LANDMARKS_EXTRA[cn] || [];
  const out = [];
  for (const n of arr) {
    total++;
    const inCity = (coordNamesByCity[cn]||new Set()).has(n);
    const inAny = coordNamesAll.has(n);
    if (inCity) dupInCity++; else if (inAny) dupAnywhere++; else { out.push(n); keep++; }
  }
  if (out.length) safeDedup[cn] = out;
}
console.log("CITY_LANDMARKS_EXTRA 总:", total);
console.log(" 本市 SPOT_COORDS 命中(可砍):", dupInCity);
console.log(" 仅其他城 SPOT_COORDS 命中(可砍但跨城):", dupAnywhere);
console.log(" 保留( coords 里没有):", keep);
console.log("原 packed:", (pk(D.CITY_LANDMARKS_EXTRA)/1024).toFixed(0)+"KB",
            " 安全去重后 packed:", (pk(safeDedup)/1024).toFixed(0)+"KB",
            " 省:", ((pk(D.CITY_LANDMARKS_EXTRA)-pk(safeDedup))/1024).toFixed(0)+"KB");
// 写出去重脚本供 _apply-safe 复用（不覆盖，仅输出 JSON 到 stdout 已够；这里存盘）
fs.writeFileSync(path.join(process.cwd(),"tools","_landmark-dedup-result.json"), JSON.stringify(safeDedup,null,0));
console.log("已写出 tools/_landmark-dedup-result.json (保留条目)");
