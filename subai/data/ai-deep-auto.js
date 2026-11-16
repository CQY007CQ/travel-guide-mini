// ── 分块聚合入口（对外形状与原单文件完全一致）─────────────────────────
// 为什么切成 12 块：单文件曾达数千行，认知负荷与合并冲突面过大（T4）。
// 内容本体在 subai/data/deep-auto/pNN.js，本文件只做聚合，不再承载数据。
// 下面按 p01→p12 列出了每块覆盖的城市，改内容直接去对应块。
//
// 两个不能改的地方：
//   1) require 必须逐个写静态字面量 —— 微信编译期不解析拼接出来的路径；
//   2) 合并必须按 p01→p12 顺序，键序即展示顺序，不可 sort。

// 城市 → 分块索引（生成，供人工定位；查找请用 grep "\"城市名\":" subai/data/deep-auto/）
//   p01（18 城）：台州 … 汕头
//   p02（18 城）：宜昌 … 宝鸡
//   p03（18 城）：梅州 … 新乡
//   p04（18 城）：湛江 … 秦皇岛
//   p05（18 城）：张家口 … 滁州
//   p06（18 城）：吉安 … 荆门
//   p07（18 城）：马鞍山 … 菏泽
//   p08（18 城）：锦州 … 周口
//   p09（18 城）：百色 … 淮北
//   p10（18 城）：神农架 … 鸡西
//   p11（18 城）：曲靖 … 连云港
//   p12（2 城）：七台河 … 梧州

const P01 = require("./deep-auto/p01.js");
const P02 = require("./deep-auto/p02.js");
const P03 = require("./deep-auto/p03.js");
const P04 = require("./deep-auto/p04.js");
const P05 = require("./deep-auto/p05.js");
const P06 = require("./deep-auto/p06.js");
const P07 = require("./deep-auto/p07.js");
const P08 = require("./deep-auto/p08.js");
const P09 = require("./deep-auto/p09.js");
const P10 = require("./deep-auto/p10.js");
const P11 = require("./deep-auto/p11.js");
const P12 = require("./deep-auto/p12.js");

const PARTS = [
  P01,
  P02,
  P03,
  P04,
  P05,
  P06,
  P07,
  P08,
  P09,
  P10,
  P11,
  P12
];

const cities = {};
for (let i = 0; i < PARTS.length; i++) {
  const src = PARTS[i] && PARTS[i].cities;
  if (!src) continue; // 极端裁剪下某块缺失不应连累其余城市
  for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) cities[k] = src[k];
}

module.exports = {
  v: 1,
  updated: "2026-11-auto",
  auto: true,
  cities: cities
};
