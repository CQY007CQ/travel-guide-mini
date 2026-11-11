/**
 * tools/test/_test-foodmap.mjs —— 「菜名 → 店铺」匹配回归
 *
 * 这类功能的失败方式不是崩，而是「点北京烤鸭却列出火锅店」。
 * 因此断言分三组：命中正确性、无命中不瞎给、以及品牌联想不能被词根覆盖掉。
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const FM = require("../../subpkg/utils/food-map.js");

let n = 0, bad = 0;
function ok(desc, cond, detail) {
  n++;
  if (cond) return;
  bad++;
  console.log("  ✗ " + desc + (detail ? "  → " + detail : ""));
}

const BJ = [
  { shop: "四季民福烤鸭店（故宫店）", addr: "南池子大街11号" },
  { shop: "全聚德（前门店）", addr: "前门大街30号" },
  { shop: "聚宝源（牛街总店）", addr: "牛街5号" },
  { shop: "海碗居（增光路总店）", addr: "增光路11号" },
  { shop: "尹三豆汁（天坛店）", addr: "天坛北里" },
  { shop: "门框胡同百年卤煮（新街口店）", addr: "新街口南大街" },
  { shop: "蜀大侠火锅（王府井店）", addr: "王府井大街" },
];

console.log("【命中正确性】");
{
  const r = FM.shopsForDish(BJ, "北京烤鸭");
  ok("北京烤鸭命中烤鸭店", r.some((x) => x.shop.indexOf("四季民福") >= 0), r.map((x) => x.shop).join("/"));
  ok("北京烤鸭命中全聚德（品牌联想）", r.some((x) => x.shop.indexOf("全聚德") >= 0));
  ok("北京烤鸭不应命中火锅店", !r.some((x) => x.shop.indexOf("火锅") >= 0));
}
{
  const r = FM.shopsForDish(BJ, "铜锅涮肉");
  ok("铜锅涮肉命中聚宝源", r.some((x) => x.shop.indexOf("聚宝源") >= 0), r.map((x) => x.shop).join("/"));
}
{
  const r = FM.shopsForDish(BJ, "豆汁儿配焦圈");
  ok("豆汁儿配焦圈命中尹三豆汁", r.some((x) => x.shop.indexOf("豆汁") >= 0), r.map((x) => x.shop).join("/"));
}
{
  const r = FM.shopsForDish(BJ, "卤煮火烧");
  ok("卤煮火烧命中卤煮店", r.some((x) => x.shop.indexOf("卤煮") >= 0));
}

console.log("【无命中不瞎给】");
{
  ok("无匹配菜名返回空数组", FM.shopsForDish(BJ, "螺蛳粉").length === 0);
  ok("空菜名返回空数组", FM.shopsForDish(BJ, "").length === 0);
  ok("空店铺列表不崩", FM.shopsForDish([], "北京烤鸭").length === 0);
  ok("店铺列表为 undefined 不崩", FM.shopsForDish(undefined, "北京烤鸭").length === 0);
}

console.log("【强/弱匹配与排序】");
{
  const r = FM.shopsForDish(BJ, "北京烤鸭");
  ok("结果带匹配等级 m", r.every((x) => x.m === 1 || x.m === 2));
  ok("强匹配排在弱匹配前", (() => {
    for (let i = 1; i < r.length; i++) if (r[i - 1].m < r[i].m) return false;
    return true;
  })());
}
{
  // 词根不应把品牌联想吃掉：'北京烤鸭' 的尾两字「烤鸭」是弱词，全聚德只有品牌强词
  const k = FM.dishKeys("北京烤鸭");
  ok("dishKeys 产出强词含品牌", k.strong.indexOf("全聚德") >= 0);
  ok("dishKeys 尾两字进弱词", k.weak.indexOf("烤鸭") >= 0 || k.strong.indexOf("烤鸭") >= 0);
  ok("强词不含单字", k.strong.every((x) => x.length >= 2));
}

/* 不修改入参（页面会把结果直接 setData，污染原数组会越点越少） */
{
  const before = JSON.stringify(BJ);
  FM.shopsForDish(BJ, "北京烤鸭");
  ok("匹配不修改传入的店铺列表", JSON.stringify(BJ) === before);
}

console.log("");
if (bad) { console.log("foodmap 回归失败：" + bad + " 项"); process.exit(1); }
console.log("foodmap 回归通过：" + n + " 项");
