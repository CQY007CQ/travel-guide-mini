/**
 * utils/emergency.js —— 旅途应急：分诊匹配 + 就近医院
 *
 * 设计边界（与 emergency-data.js 一致）：
 *   · 只回答「该挂哪个科」「就近有哪些医院」，不输出诊疗结论，不做医院优劣排序
 *   · 医院按「距城中心」升序，这是纯几何排序，不是推荐排序
 *   · v1.19.180：没有具名医院的城市不再伪造机构名，改为 approx 标记 + 城中心坐标，
 *     由页面引导用户去地图搜索「医院」。宁可说「暂无收录」，不给错的名字。
 */
const { TRIAGE, HOSPITALS, APPROX } = require("./emergency-data.js");

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

/** 可选城市：有具名医院的 + 仅能地图降级的 */
function cities() {
  return Object.keys(HOSPITALS).concat(Object.keys(APPROX));
}

/** 某城具名医院（按距城中心升序；纯几何排序）。未收录城市返回空数组 */
function hospitalsOf(city) {
  const list = HOSPITALS[city];
  if (!list || !list.length) return [];
  return list.slice().sort((a, b) => a.kmc - b.kmc);
}

/** 该城是否只有降级信息（无具名医院） */
function isApprox(city) {
  return !(HOSPITALS[city] && HOSPITALS[city].length) && !!APPROX[city];
}

/** 降级城市中心坐标 [lat, lon]；无则 null */
function approxCoord(city) {
  return APPROX[city] || null;
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

module.exports = { triage, cities, hospitalsOf, isApprox, approxCoord, hasCity, QUICK };
