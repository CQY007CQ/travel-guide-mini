// tools/_rich-info-pilot.mjs
// Tier 1 编辑整理管线：校验作者补丁的店名/片区名是否命中 base 数据
// （避免回写成空操作），并报告将写入的扩展字段数量。
// 补丁本身（tools/v20N-rich-info.js）由 _apply-safe.mjs 合并进包。
import { createRequire } from "node:module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const file = process.argv[2];
if (!file) { console.error("用法: node tools/_rich-info-pilot.mjs tools/v20N-rich-info.js"); process.exit(2); }
let patch;
try { patch = req("./" + file.replace(/^\.\//, "")); }
catch (e) { console.error("读不到补丁文件:", e.message); process.exit(3); }

const foodAdd = patch.FOOD_SPOTS_ADD || {};
const hotelAdd = patch.HOTEL_AREA_NOTES || {};

// 建索引
const foodByName = {};
for (const cn in (D.FOOD_SPOTS || {})) for (const s of (D.FOOD_SPOTS[cn] || [])) {
  const n = String((s && (s.shop || s.name)) || "").trim(); if (n) foodByName[cn + " " + n] = s;
}
const areaByName = {};
for (const c of (D.CITIES || [])) {
  const cn = c.name; if (!cn || !Array.isArray(c.areas)) continue;
  for (const a of c.areas) { const n = String((a && a.name) || "").trim(); if (n) areaByName[cn + " " + n] = a; }
}

let foodHit = 0, foodMiss = 0, foodFields = 0;
for (const cn in foodAdd) for (const it of (foodAdd[cn] || [])) {
  const nm = String(it.shop || it.name || "").trim();
  if (!nm) { foodMiss++; continue; }
  if (foodByName[cn + " " + nm]) {
    foodHit++;
    if (it.menu) foodFields++;
    if (it.rep) foodFields++;
    if (it.note) foodFields++;
  } else { foodMiss++; console.log("  ⚠️ 美食店名未命中 base（将跳过）: " + cn + " / " + nm); }
}
let hotelHit = 0, hotelMiss = 0;
for (const cn in hotelAdd) for (const it of (hotelAdd[cn] || [])) {
  const nm = String(it.name || "").trim();
  if (!nm) { hotelMiss++; continue; }
  if (areaByName[cn + " " + nm]) hotelHit++;
  else { hotelMiss++; console.log("  ⚠️ 酒店片区名未命中 base（将跳过）: " + cn + " / " + nm); }
}
console.log("美食：命中已有店 " + foodHit + " / 未命中(将跳过) " + foodMiss + " | 待写扩展字段 " + foodFields);
console.log("酒店：命中已有片区 " + hotelHit + " / 未命中(将跳过) " + hotelMiss);
const total = foodHit + hotelHit;
console.log(total === 0 ? "无有效内容" : "校验通过 → 走 _apply-safe.mjs 合并（FOOD_SPOTS_ADD 走 §6.6，HOTEL_AREA_NOTES 走 §6.8）");
