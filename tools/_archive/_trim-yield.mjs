// 裁剪收益测算：重叠度 + 各低风险裁剪的精确省量
import fs from "fs";
import path from "path";
import zlib from "zlib";

const PACKED = path.join(process.cwd(), "subdata", "data", "data-packed.js");
const raw = fs.readFileSync(PACKED, "utf8");
const b64 = raw.slice(raw.indexOf("\""), raw.lastIndexOf("\"")).replace(/^"|"$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));

function pk(v) { return zlib.deflateSync(Buffer.from(JSON.stringify(v), "utf8"), { level: 9 }).toString("base64").length; }

// 1) CITY_LANDMARKS_EXTRA 与 experiences 名字重叠
const expNamesByCity = {};
for (const c of D.CITIES) {
  const set = new Set();
  for (const e of (c.experiences || [])) if (e && e.name) set.add(e.name);
  expNamesByCity[c.city || c.name] = set;
}
let extraTotal = 0, extraOverlap = 0;
for (const cn in (D.CITY_LANDMARKS_EXTRA || {})) {
  const expSet = expNamesByCity[cn] || new Set();
  for (const n of D.CITY_LANDMARKS_EXTRA[cn]) {
    extraTotal++;
    if (expSet.has(n)) extraOverlap++;
  }
}
const dedupExtra = {};
for (const cn in (D.CITY_LANDMARKS_EXTRA || {})) {
  const expSet = expNamesByCity[cn] || new Set();
  dedupExtra[cn] = D.CITY_LANDMARKS_EXTRA[cn].filter(n => !expSet.has(n));
}
console.log("=== CITY_LANDMARKS_EXTRA 重叠 ===");
console.log("总名字:", extraTotal, " 与 experiences 重叠:", extraOverlap, "(", (extraOverlap / extraTotal * 100).toFixed(1), "%)");
console.log("去重后条目:", Object.values(dedupExtra).reduce((a, b) => a + b.length, 0));
console.log("CITY_LANDMARKS_EXTRA 现 packed:", (pk(D.CITY_LANDMARKS_EXTRA) / 1024).toFixed(0) + "KB",
            " 去重后 packed:", (pk(dedupExtra) / 1024).toFixed(0) + "KB",
            " 省:", ((pk(D.CITY_LANDMARKS_EXTRA) - pk(dedupExtra)) / 1024).toFixed(0) + "KB");

// 2) SPOT_COORDS 3→2 位小数
let coords3 = JSON.parse(JSON.stringify(D.SPOT_COORDS));
let coords2 = JSON.parse(JSON.stringify(D.SPOT_COORDS));
for (const ck in coords2) for (let i = 0; i < coords2[ck].length; i++) {
  const e = coords2[ck][i];
  if (Array.isArray(e) && e.length >= 3) coords2[ck][i] = [e[0], +Number(e[1]).toFixed(2), +Number(e[2]).toFixed(2)];
}
console.log("\n=== SPOT_COORDS 精度 3→2 位 ===");
console.log("现 packed:", (pk(D.SPOT_COORDS) / 1024).toFixed(0) + "KB",
            " 2位 packed:", (pk(coords2) / 1024).toFixed(0) + "KB",
            " 省:", ((pk(D.SPOT_COORDS) - pk(coords2)) / 1024).toFixed(0) + "KB");

// 3) FOOD_SPOTS 去掉空 price
let foodTrim = JSON.parse(JSON.stringify(D.FOOD_SPOTS));
for (const ck in foodTrim) foodTrim[ck] = foodTrim[ck].map(x => {
  if (x && typeof x === "object") { const { price, ...rest } = x; if (price) rest.price = price; return rest; }
  return x;
});
console.log("\n=== FOOD_SPOTS 去掉空 price ===");
console.log("现 packed:", (pk(D.FOOD_SPOTS) / 1024).toFixed(0) + "KB",
            " 去空price packed:", (pk(foodTrim) / 1024).toFixed(0) + "KB",
            " 省:", ((pk(D.FOOD_SPOTS) - pk(foodTrim)) / 1024).toFixed(0) + "KB");

// 4) CITIES period 编码为单字符
const PERIOD_CODE = { "上午": "a", "下午": "b", "晚上": "c", "全天": "d", "": "e", "上午+下午": "f" };
const inv = {}; for (const k in PERIOD_CODE) inv[PERIOD_CODE[k]] = k;
let citiesEnc = JSON.parse(JSON.stringify(D.CITIES));
for (const c of citiesEnc) for (const e of (c.experiences || [])) { if (e && e.period !== undefined) e.period = PERIOD_CODE[e.period] || "e"; }
console.log("\n=== CITIES period 编码 ===");
console.log("现 packed:", (pk(D.CITIES) / 1024).toFixed(0) + "KB",
            " 编码后 packed:", (pk(citiesEnc) / 1024).toFixed(0) + "KB",
            " 省:", ((pk(D.CITIES) - pk(citiesEnc)) / 1024).toFixed(0) + "KB");

// 合计可省
const s1 = pk(D.CITY_LANDMARKS_EXTRA) - pk(dedupExtra);
const s2 = pk(D.SPOT_COORDS) - pk(coords2);
const s3 = pk(D.FOOD_SPOTS) - pk(foodTrim);
const s4 = pk(D.CITIES) - pk(citiesEnc);
console.log("\n=== 累计可省 (packed) ===");
console.log("去重EXTRA:", (s1/1024).toFixed(0)+"KB", " 坐标2位:", (s2/1024).toFixed(0)+"KB",
            " 去空price:", (s3/1024).toFixed(0)+"KB", " period编码:", (s4/1024).toFixed(0)+"KB");
console.log("合计可省:", ((s1+s2+s3+s4)/1024).toFixed(0)+"KB", " 当前总 packed:", (pk(D)/1024).toFixed(0)+"KB");
console.log("若全做，新总 packed:", ((pk(D)-(s1+s2+s3+s4))/1024).toFixed(0)+"KB");
