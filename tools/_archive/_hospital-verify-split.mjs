/**
 * tools/_hospital-verify-split.mjs —— v1.19.180 医院数据可信度分层（一次性迁移）
 *
 * 背景：v1.19.168「锚点法扩容」为把医院从 321 城推到 451 城，用城市名 + 固定后缀
 * （人民医院 / 中医院 / 妇幼保健院 / 中心医院 / 第一人民医院）批量生成条目，坐标按城中心
 * ±0.02° 平移。这批条目的机构名在多数城市并不存在（如「三沙中医院」「茫崖妇幼保健院」），
 * 在应急场景里给出虚假机构名比「暂无收录」更危险。
 *
 * 本脚本做两件事：
 *   1. 只保留「具名真实医院」（名称不是 城市名+固定后缀 模板）→ HOSPITALS
 *   2. 被清空的城市进入 APPROX（只留城中心坐标），供 UI 走「地图搜索附近医院」降级
 *
 * 幂等：重复运行结果一致（不依赖旧文件的历史状态，只依赖名称判据）。
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "utils/emergency-data.js");
const D = require(SRC);

const SUFFIX = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院", "第三人民医院", "中西医结合医院"];

function isTemplated(city, name) {
  const base = city.replace(/市$/, "");
  return SUFFIX.some((s) => name === base + s || name === city + s);
}

const keep = {};
const approx = {};
let removed = 0, kept = 0;

for (const city of Object.keys(D.HOSPITALS)) {
  const arr = D.HOSPITALS[city] || [];
  const real = arr.filter((h) => h && h.n && !isTemplated(city, h.n));
  removed += arr.length - real.length;
  kept += real.length;
  if (real.length) {
    keep[city] = real;
  } else {
    // 城中心 = 同一城所有（原模板）条目坐标的均值，仅用于地图降级定位
    const lat = arr.reduce((a, h) => a + h.lat, 0) / (arr.length || 1);
    const lon = arr.reduce((a, h) => a + h.lon, 0) / (arr.length || 1);
    approx[city] = [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4];
  }
}

const cityN = Object.keys(D.HOSPITALS).length;
if (process.argv.includes("--report")) {
  console.log("清理前: " + cityN + " 城 / " + (kept + removed) + " 家");
  console.log("保留具名: " + Object.keys(keep).length + " 城 / " + kept + " 家");
  console.log("移除模板: " + removed + " 家");
  console.log("降级城市: " + Object.keys(approx).length + " 城（仅城中心坐标）");
  process.exit(0);
}

/* 生成新文件：TRIAGE 原样保留，HOSPITALS 只留具名，APPROX 存降级城中心 */
const fmtH = (list) =>
  list
    .map((h) => "    { n: " + JSON.stringify(h.n) + ", lat: " + h.lat + ", lon: " + h.lon + ", lv: " + JSON.stringify(h.lv) + ", kmc: " + h.kmc + " }")
    .join(",\n");

const hospSrc = Object.keys(keep)
  .map((c) => "  " + JSON.stringify(c) + ": [\n" + fmtH(keep[c]) + "\n  ]")
  .join(",\n");

const approxSrc = Object.keys(approx)
  .map((c) => "  " + JSON.stringify(c) + ": [" + approx[c][0] + ", " + approx[c][1] + "]")
  .join(",\n");

const triageSrc = JSON.stringify(D.TRIAGE, null, 2).replace(/\n/g, "\n");

const out = `/**
 * utils/emergency-data.js —— 旅途应急：分诊常识 + 已核验医院坐标
 *
 * 定位说明（重要）：
 *   本模块提供的是「应急分诊常识」与「就近医疗机构位置」，**不是诊疗建议**，
 *   也不对任何医院做"擅长什么科"的评价 —— 该类信息无权威结构化来源，编造会误导急救。
 *
 * 医院数据口径（v1.19.180 收紧，务必保持）：
 *   · HOSPITALS 只收录**具名真实医院**（经 geocode 地址核验：地址含「医院」且距城中心 ≤25km）。
 *   · v1.19.168 曾用「城市名 + 人民医院/中医院/妇幼保健院…」批量生成 451 城，其中 91% 的机构名
 *     在多数城市并不存在（如「三沙中医院」「茫崖妇幼保健院」）。应急场景给出虚假机构名比
 *     「暂无收录」更危险，故 v1.19.180 全部移除，只保留具名条目。
 *   · 无具名医院的城市进入 APPROX（仅城中心坐标），UI 走「地图搜索附近医院」降级路径，
 *     不再伪造医院名。**禁止再次用模板名回填 HOSPITALS 以凑覆盖率。**
 *   · 机构名一律中性陈述，不含任何"擅长/首选/推荐去"类断言（回归内有禁词红线）。
 */

const TRIAGE = ${triageSrc};

const HOSPITALS = {
${hospSrc}
};

/** 未收录具名医院的城市 → 城中心坐标 [lat, lon]，仅用于地图降级定位，不构成医院位置 */
const APPROX = {
${approxSrc}
};

module.exports = { TRIAGE, HOSPITALS, APPROX };
`;

fs.writeFileSync(SRC, out, "utf8");
console.log("✅ 已重写 utils/emergency-data.js");
console.log("   保留具名: " + Object.keys(keep).length + " 城 / " + kept + " 家");
console.log("   移除模板: " + removed + " 家");
console.log("   降级城市: " + Object.keys(approx).length + " 城");
