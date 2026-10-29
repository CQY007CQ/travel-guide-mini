/**
 * utils/emergency.js —— 旅途应急：分诊匹配 + 就近医院
 *
 * 设计边界（与 emergency-data.js 一致）：
 *   · 只回答「该挂哪个科」「就近有哪些医院」，不输出诊疗结论，不做医院优劣排序
 *   · 医院按「距城中心」升序，这是纯几何排序，不是推荐排序
 */
const { TRIAGE, HOSPITALS } = require("./emergency-data.js");

/** 文本 → 匹配到的分诊条目（急症优先） */
function triage(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const out = [];
  for (const r of TRIAGE) {
    const hit = r.kw.filter((k) => t.indexOf(k) >= 0);
    if (hit.length) out.push({ dept: r.dept, er: r.er, tip: r.tip, hit });
  }
  out.sort((a, b) => b.er - a.er);
  return out;
}

/** 已收录医院的城市列表 */
function cities() {
  return Object.keys(HOSPITALS);
}

/** 某城医院（按距城中心升序；纯几何排序） */
function hospitalsOf(city) {
  const list = HOSPITALS[city];
  if (!list || !list.length) return [];
  return list.slice().sort((a, b) => a.kmc - b.kmc);
}

function hasCity(city) {
  return !!(HOSPITALS[city] && HOSPITALS[city].length);
}

/** 常用快捷入口（文本即关键词，可直接送进 triage） */
const QUICK = [
  "腿摔了 疑似骨折",
  "烧伤烫伤",
  "出血止不住",
  "中暑晕倒",
  "高原反应",
  "食物中毒",
  "眼睛进异物",
  "胸闷胸痛",
];

module.exports = { triage, cities, hospitalsOf, hasCity, QUICK };
