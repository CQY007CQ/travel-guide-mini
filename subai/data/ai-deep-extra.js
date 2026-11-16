// ── 分块聚合入口（对外形状与原单文件完全一致）─────────────────────────
// 为什么切成 6 块：单文件曾达数千行，认知负荷与合并冲突面过大（T4）。
// 内容本体在 subai/data/deep-extra/pNN.js，本文件只做聚合，不再承载数据。
// 下面按 p01→p06 列出了每块覆盖的城市，改内容直接去对应块。
//
// 两个不能改的地方：
//   1) require 必须逐个写静态字面量 —— 微信编译期不解析拼接出来的路径；
//   2) 合并必须按 p01→p06 顺序，键序即展示顺序，不可 sort。

// 城市 → 分块索引（生成，供人工定位；查找请用 grep "\"城市名\":" subai/data/deep-extra/）
//   p01（14 城）：天津 … 长沙
//   p02（14 城）：张家界 … 拉萨
//   p03（14 城）：乌鲁木齐 … 婺源
//   p04（14 城）：景德镇 … 九华山
//   p05（14 城）：韶山 … 伊春
//   p06（2 城）：延吉 … 长白山

const P01 = require("./deep-extra/p01.js");
const P02 = require("./deep-extra/p02.js");
const P03 = require("./deep-extra/p03.js");
const P04 = require("./deep-extra/p04.js");
const P05 = require("./deep-extra/p05.js");
const P06 = require("./deep-extra/p06.js");

const PARTS = [
  P01,
  P02,
  P03,
  P04,
  P05,
  P06
];

const cities = {};
for (let i = 0; i < PARTS.length; i++) {
  const src = PARTS[i] && PARTS[i].cities;
  if (!src) continue; // 极端裁剪下某块缺失不应连累其余城市
  for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) cities[k] = src[k];
}

module.exports = {
  v: 1,
  updated: "2026-11",
  auto: false,
  cities: cities
};
