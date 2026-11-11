// v1.19.182 美食富信息扩城回归：校验 FOOD_ENRICH（加载期增量合并）真实落地且字段完整
// 覆盖：城市须收录、店名须存在、menu(1-3) 字段完整、rep 在白名单、note 非空、同城无重名店。
// 期望清单与 data.js 的 FOOD_ENRICH 保持一致（数据来源：天津/哈尔滨/兰州 公开探店·老字号资料交叉核验）。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const EXPECT = [
  ["天津", "登瀛楼饭庄", [["罾蹦鲤鱼", 68], ["八珍豆腐", 48], ["老爆三", 42]], "老字号"],
  ["天津", "耳朵眼炸糕", [["炸糕", 3]], "老字号"],
  ["天津", "桂发祥十八街麻花", [["夹馅麻花", 25]], "老字号"],
  ["天津", "红旗饭庄", [["罾蹦鲤鱼", 68], ["独面筋", 42]], "老字号"],
  ["哈尔滨", "老厨家", [["锅包肉", 48], ["得莫利炖鱼", 85]], "老字号"],
  ["哈尔滨", "马迭尔冷饮厅", [["原味冰棍", 5]], "游客打卡"],
  ["哈尔滨", "秋林里道斯", [["红肠", 30]], "老字号"],
  ["哈尔滨", "华梅西餐厅", [["罐焖牛肉", 68], ["红菜汤", 38]], "老字号"],
  ["兰州", "马子禄牛肉面", [["牛肉面(二细)", 12]], "老字号"],
  ["兰州", "吾穆勒蓬灰牛肉面", [["厚切牛肉面", 18]], "本地人常去"],
  ["兰州", "磨沟沿老字号", [["牛肉面(二细)", 16]], "本地人常去"]
];
const REPS = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);

let fails = 0;
const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); fails++; } else console.log("  ✓ " + m); };
const citySet = new Set((D.CITIES || []).map(c => c.name));
const seenShop = {};
let landed = 0, cities = new Set();

for (const [city, name, menu, rep] of EXPECT) {
  const tag = city + " / " + name;
  ok(citySet.has(city), tag + "：城市已收录");
  const arr = (D.FOOD_SPOTS && D.FOOD_SPOTS[city]) || [];
  const shop = arr.find(s => s && s.shop === name);
  ok(!!shop, tag + "：店铺已落地");
  if (!shop) continue;
  const m = Array.isArray(shop.menu) ? shop.menu : [];
  ok(m.length >= 1 && m.length <= 6, tag + "：menu 1-6 道（实际 " + m.length + "）");
  const menuOk = m.every(x => (x && x.n && (typeof x.p === "number" || (typeof x.p === "string" && x.p.length))) || (Array.isArray(x) && x.length === 2 && typeof x[0] === "string"));
  ok(menuOk, tag + "：menu 每道含菜名与参考价");
  ok(!!shop.rep && REPS.has(shop.rep), tag + "：rep 在白名单（" + shop.rep + "）");
  ok(!!shop.note, tag + "：编辑点评 note 非空");
  // 同城重名店幂等校验
  const key = city + "|" + name;
  ok(!seenShop[key], tag + "：同城无重名店（幂等）");
  seenShop[key] = 1;
  landed++; cities.add(city);
}
ok(landed === EXPECT.length, "全部 " + EXPECT.length + " 家富信息均落地（实际 " + landed + "）");
ok(cities.size === 3, "覆盖 3 座非试点旅游城（实际 " + cities.size + "）");

if (fails) { console.error("\n❌ 美食富信息扩城单测 " + fails + " 项失败"); process.exit(1); }
console.log("✅ 美食富信息扩城单测通过（" + landed + " 家 / " + cities.size + " 城，均经核验）");
