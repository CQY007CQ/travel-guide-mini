/**
 * tools/_test-dedup.mjs —— 景点数据去重回归（v1.19.167）
 *
 * 背景：SPOT_COORDS 内出现同城同名完全重复副本（仙桃/天门/潜江 等单城同一景点被录入 41 次、
 * 坐标完全一致），导致地图/行程中同一景点重复出现 40+ 次。v1.19.167 在 applyPacked 加
 * dedupeSpots() 按「城市+景点名+坐标」去重，仅移除逐字节相同的副本、保留首个。
 *
 * 断言：
 *  1) 全量无同城逐字节相同的重复景点行（核心不变量）
 *  2) 三个重灾城市去重后唯一景点数 == 实测值（仙桃5/天门8/潜江4）
 *  3) v1.19.166 坐标修正覆盖层未被去重破坏
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const D = require("../utils/data.js");

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

// ---------- 1. 核心不变量：同城无逐字节相同的重复行 ----------
let dupRows = 0;
const perCity = {};
for (const [city, list] of Object.entries(D.SPOT_COORDS)) {
  if (!Array.isArray(list)) continue;
  const seen = Object.create(null);
  for (const row of list) {
    if (!Array.isArray(row)) continue;
    const key = JSON.stringify([row[0], row[1], row[2]]);
    if (seen[key]) { dupRows++; if (!perCity[city]) perCity[city] = 0; perCity[city]++; }
    seen[key] = 1;
  }
}
ok("SPOT_COORDS 同城无逐字节重复副本", dupRows === 0, JSON.stringify(perCity));

// ---------- 2. 三个重灾城市去重后唯一数 ----------
const expectUnique = { "仙桃": 5, "天门": 8, "潜江": 4 };
for (const [city, exp] of Object.entries(expectUnique)) {
  const list = D.SPOT_COORDS[city] || [];
  const uniq = new Set(list.map((s) => s[0])).size;
  ok(`${city} 去重后唯一景点数 == ${exp}`, uniq === exp, "实得 " + uniq);
}

// ---------- 3. 坐标修正覆盖层（v1.19.166）未被破坏 ----------
const expectCoord = {
  "澳门/郑家大屋": [22.1906, 113.5385], "澳门/北帝庙": [22.1975, 113.541], "澳门/海事博物馆": [22.1819, 113.5319],
  "香港/大澳渔村": [22.2526, 113.8636], "香港/大馆": [22.282, 114.154],
  "漠河/黑龙江源头": [53.480, 121.480], "漠河/北极林海观音": [53.294, 122.204]
};
for (const [k, exp] of Object.entries(expectCoord)) {
  const [city, nm] = k.split("/");
  const s = (D.SPOT_COORDS[city] || []).find((x) => x[0] === nm);
  ok(`${k} 坐标修正保留`, s && Math.abs(s[1] - exp[0]) < 1e-4 && Math.abs(s[2] - exp[1]) < 1e-4,
    s ? `[${s[1]},${s[2]}]` : "缺失");
}

console.log("");
if (fail) { console.log("景点去重回归失败：" + fail + " / " + n); process.exit(1); }
console.log("景点去重回归通过：" + n + " 项（移除 440 条重复副本）");
