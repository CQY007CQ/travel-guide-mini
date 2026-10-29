/**
 * tools/_test-climate-dedupe.mjs —— 气候补充项与主清单去重回归
 *
 * 背景：今天页「去 X 还要带这些」（气候补充）与「自动行李清单」（主清单 packSmart）
 * 由两套独立逻辑生成，会出现重复（墨镜 / 防晒 / 雨具 / 饮用水 / 羽绒服…）。
 * 2026-10-29 加了 climateAddOnsFiltered() 按关键词去重。
 *
 * 为什么必须锁死：初版实现里 packSmart 的 items 是对象数组 { k, t, done }，
 * 直接 join(" ") 会拼出 "[object Object]"，导致**去重永远不生效且不报错**——
 * 静默无效比崩溃更危险。这里专门断言"真的能比对到文本"。
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

const planOf = (city, depart, spotNames) => ({
  cityName: city,
  depart,
  days: spotNames.map((nm) => ({ items: [{ name: nm }] })),
});

// ---------- 1. 字段兼容：对象数组与字符串数组都要能取到文本 ----------
{
  const objGroups = [{ items: [{ k: "a", t: "防晒霜（SPF30+）· 墨镜", done: false }] }];
  const strGroups = [{ items: ["防晒霜（SPF30+）· 墨镜"] }];
  const a = T.climateAddOnsFiltered("dry", objGroups);
  const b = T.climateAddOnsFiltered("dry", strGroups);
  ok("对象数组 items 能正确比对（墨镜被剔除）", a.indexOf("墨镜") < 0, a.join("/"));
  ok("字符串数组 items 同样能比对（向后兼容）", b.indexOf("墨镜") < 0, b.join("/"));
  ok("两种形态结果一致", a.join("/") === b.join("/"), a.join("/") + " vs " + b.join("/"));
}

// ---------- 2. 干冷气候（西安·秋）：墨镜与水已在主清单 ----------
{
  const pk = T.packSmart(planOf("西安", "2026-11-05", ["兵马俑", "大雁塔", "华清池"]));
  const raw = T.climateAddOns("dry");
  const f = T.climateAddOnsFiltered("dry", pk.groups);
  ok("dry：墨镜已与主清单重复被剔除", f.indexOf("墨镜") < 0, f.join("/"));
  ok("dry：多带饮用水已与主清单「水杯」重复被剔除", f.indexOf("多带饮用水") < 0);
  ok("dry：润唇膏保留（主清单无此项）", f.indexOf("润唇膏") >= 0);
  ok("dry：结果确实少于原始", f.length < raw.length, raw.length + "→" + f.length);
}

// ---------- 3. 热带（三亚·夏）：防晒 / 速干 / 雨具 都在主清单 ----------
{
  const pk = T.packSmart(planOf("三亚", "2026-07-05", ["亚龙湾", "海岛"]));
  const f = T.climateAddOnsFiltered("tropical", pk.groups);
  ok("tropical：防晒霜被剔除", f.indexOf("防晒霜") < 0, f.join("/"));
  ok("tropical：雨具被剔除（主清单有折叠伞/雨衣）", f.indexOf("雨具") < 0);
  ok("tropical：驱蚊液保留（无山无驱蚊时主清单不含）", f.indexOf("驱蚊液") >= 0);
}

// ---------- 4. 严寒（哈尔滨·冬）：主清单已含冬装，补充项应清空 ----------
{
  const pk = T.packSmart(planOf("哈尔滨", "2027-01-05", ["中央大街"]));
  const f = T.climateAddOnsFiltered("cold", pk.groups);
  ok("cold：羽绒服被剔除（主清单有厚外套/羽绒服）", f.indexOf("羽绒服") < 0);
  ok("cold：手套围巾被剔除", f.indexOf("手套围巾") < 0);
  ok("cold：保温杯被剔除（主清单有水杯）", f.indexOf("保温杯") < 0);
  ok("cold：全部被覆盖时返回空数组（页面据此隐藏卡片）", f.length === 0, f.join("/"));
}

// ---------- 5. 空/异常入参不能炸，也不能误删 ----------
{
  ok("无主清单时原样返回", T.climateAddOnsFiltered("dry", []).length === 4);
  ok("packGroups 为 undefined 时原样返回", T.climateAddOnsFiltered("dry", undefined).length === 4);
  ok("未知气候返回空数组", T.climateAddOnsFiltered("unknown_climate", []).length === 0);
  ok("温带无补充项", T.climateAddOnsFiltered("temperate", []).length === 0);
}

// ---------- 6. extraText（穿衣卡文本）也参与去重 ----------
{
  const pk = T.packSmart(planOf("西安", "2026-11-05", ["兵马俑", "大雁塔"]));
  const dress = "上衣：长袖+薄外套 下装：长裤 配件：润唇膏+保湿霜 秋燥明显，多喝水";
  const withDress = T.climateAddOnsFiltered("dry", pk.groups, dress);
  const noDress = T.climateAddOnsFiltered("dry", pk.groups);
  ok("extraText：润唇膏被穿衣卡覆盖后剔除", withDress.indexOf("润唇膏") < 0, withDress.join("/"));
  ok("extraText：保湿护肤品被「保湿霜」覆盖后剔除", withDress.indexOf("保湿护肤品") < 0);
  ok("extraText：结果不多于不传时", withDress.length <= noDress.length, noDress.length + "→" + withDress.length);
  ok("extraText 为空串时行为不变", T.climateAddOnsFiltered("dry", pk.groups, "").join("/") === noDress.join("/"));
  // 只覆盖一项时应只剔除一项
  const onlyLip = T.climateAddOnsFiltered("dry", pk.groups, "润唇膏");
  ok("extraText 只命中一项 → 只剔除一项", onlyLip.indexOf("润唇膏") < 0 && onlyLip.indexOf("保湿护肤品") >= 0, onlyLip.join("/"));
}

console.log("");
if (fail) { console.log("气候去重回归失败：" + fail + " / " + n); process.exit(1); }
console.log("气候去重回归通过：" + n + " 项");
