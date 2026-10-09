// v1.13 数据修复补丁 · 归位「吉林」省名键污染
//
// 问题：v194-landmark-coords.js 曾把「吉林雾凇岛 / 拉法山 / 蛟河红叶谷」3 个吉林市景点
//       误写入 SPOT_COORDS["吉林"]（省名键，城市名应为「吉林市」）。
//       后果：getSpotCoord("吉林", "南湖公园") 以省名查询时，_coordTable 命中「吉林」键的
//       3 个景点表 → 精确/模糊都不含南湖公园 → 跳过省域扫描（本应扫全省含长春）→ 落入
//       hash 偏移兜底（approx:true），导致全省游省域优先断言「吉林·南湖公园 应=长春」失败。
// 修复：删除 SPOT_COORDS["吉林"] 键（3 景点已由 v194 改键归入「吉林市」），
//       并清掉 CITY2PROV["吉林"]（省名自映射）与 PROVINCE_CITIES["吉林"] 里的「吉林」脏条目。
module.exports = {
  COORDS_DROP: {
    "吉林": ["吉林雾凇岛", "拉法山", "蛟河红叶谷"]
  },
  CITY2PROV_DROP: ["吉林"],
  PROV_CITIES_DROP: {
    "吉林": ["吉林"]
  }
};
