// 自动衍生深度卡片 · 聚合入口（对外形状与原单文件完全一致）
// 零伪造：仅引用 utils/data.js 中真实存在的景点名 / 美食店名 / 坐标；
//   价格 / 简介 / 开放时间 / 班次等缺失字段一律不臆造；行程节奏用真实坐标就近串联。
// 与 ai-deep.js（人工核心）、ai-deep-extra.js（人工扩写）分离，便于人工复核与回退。
//
// 为什么切成 12 块：单文件曾达 8267 行，认知负荷与合并冲突面过大（T4）。
// 内容本体在 subai/data/deep-auto/pNN.js，本文件只做聚合，不再承载数据。
// 重新生成：node tools/team/build-deep-cards.mjs
//
// 两个不能改的地方：
//   1) require 必须逐个写静态字面量 —— 微信编译期不解析拼接出来的路径；
//   2) 合并必须按 p01→p12 顺序，键序即展示顺序，不可 sort。
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
