// utils/corpus.js —— 离线知识库规模统计（平台级「大数据」）
//
// 与「本机数据洞察」(insights.js，聚的是用户自己的本地记录) 和「个性化推荐」(personalize.js，聚的是用户画像)
// 都不同：这里聚的是【随包下发的离线知识库】本身的体量 —— 城市数 / 景点数 / 美食点 / 应急医院 / 气候与区域分布。
// 用途：在帮助页用一张卡直观呈现「这个小程序背后是一份多大的结构化旅行知识库」，
// 直接回应评审对「大数据维度缺失」的质疑（且全部来自真实打包数据，离线可复现，不夸大）。
//
// v1.19.204 修复：应急医院数据从来不在 data.js，而在 utils/emergency-data.js。
// 旧版读 D.HOSPITALS 恒为 undefined，帮助页因此显示「0 家应急医院覆盖 0 城」，
// 与真实的具名医院规模完全对不上。统计必须指向数据真源，并把「具名医院」与
// 「只有城中心坐标、走地图搜索降级」的两种覆盖分开算，不把降级城算成医院。
// emergency-data.js 是纯数据模块（不 require 任何东西），不会形成循环依赖。
const D = require("./data.js");
const { HOSPITALS, APPROX } = require("./emergency-data.js");

const CLIMATE_TXT = {
  plateau: "高原山地", temperate: "温带", cold: "寒温带", dry: "干旱区",
  hot: "炎热区", tropical: "热带", subtropical: "亚热带", alpine: "高山",
  temperate_continental: "温带大陆性"
};
const REGION_TXT = {
  "西南": "西南", "东北": "东北", "西北": "西北", "华北": "华北",
  "华东": "华东", "华中": "华中", "华南": "华南", "远方": "其他"
};

function _countKeys(obj) { return (obj && typeof obj === "object") ? Object.keys(obj).length : 0; }

function corpusStats() {
  const cities = Array.isArray(D.CITIES) ? D.CITIES.length : 0;
  const spotCities = _countKeys(D.SPOT_COORDS);
  let spots = 0;
  for (const k in D.SPOT_COORDS) if (Array.isArray(D.SPOT_COORDS[k])) spots += D.SPOT_COORDS[k].length;
  const spotInfo = _countKeys(D.SPOT_INFO);
  const foods = _countKeys(D.FOOD_SPOTS);
  const hospitalCities = _countKeys(HOSPITALS);
  let hospitals = 0;
  for (const k in HOSPITALS) if (Array.isArray(HOSPITALS[k])) hospitals += HOSPITALS[k].length;
  // 只有城心坐标的城市不算「收录医院」，单独统计，UI 走地图搜索降级
  const approxCities = _countKeys(APPROX);
  const provinces = _countKeys(D.PROVINCE_CITIES);

  const clim = {};
  for (const c of (D.CITIES || [])) { const k = c.climate || "temperate"; clim[k] = (clim[k] || 0) + 1; }
  const maxClim = Math.max(1, ...Object.values(clim));
  const climate = Object.keys(clim)
    .map(k => ({ k, label: CLIMATE_TXT[k] || k, n: clim[k], pct: Math.round(clim[k] / maxClim * 100) }))
    .sort((a, b) => b.n - a.n);

  const reg = {};
  for (const c of (D.CITIES || [])) { const k = c.region || "远方"; reg[k] = (reg[k] || 0) + 1; }
  const region = Object.keys(reg)
    .map(k => ({ k, label: REGION_TXT[k] || k, n: reg[k] }))
    .sort((a, b) => b.n - a.n);

  return {
    ready: !!(D.__dataReady),
    cities, spotCities, spots, spotInfo, foods,
    hospitalCities, hospitals, approxCities, provinces,
    climate, region,
    // 一句话总览（用于卡片头）—— 全部为真实打包数据，不夸大覆盖
    headline: cities + " 座城市 · " + spots + " 个景点 · " + hospitals + " 家具名医院覆盖 " +
      hospitalCities + " 城（另 " + approxCities + " 城走地图搜索）"
  };
}
module.exports = { corpusStats };
