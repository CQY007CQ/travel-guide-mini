// 回归：酒店住宿多片区推荐 + 平台门户（v1.19.145）
// 覆盖：精选城(北京)返回 3 个 {name,note} 片区 + 精选住荐；
//       无片区城退化为通用 3 片区；地图多点坐标锚定市中心且偏移≤0.02°；
//       门户 6 平台 + 可复制搜索词（含行程日期 / 无日期两种）。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = T.D;

let fail = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n); if (!c) fail++; };

// 1) 精选城：北京 应返回 3 个带 note 的片区 + 精选住荐
const bj = T.hotelAreasFor("北京");
ok("北京返回 3 个住宿片区", bj.areas.length === 3);
ok("北京片区均为 {name,note}", bj.areas.every(a => a.name && typeof a.note === "string"));
ok("北京住荐含精选文案(地铁)", /地铁/.test(bj.stayTip));

// 2) 地图多点：3 个 pin，坐标锚定市中心且偏移≤0.02°
const bjPins = T.hotelAreaPins("北京");
ok("北京地图 pin 数 = 3", bjPins.length === 3);
const cc = T.P.getCoord("北京");
ok("北京中心点存在", !!cc && typeof cc.lat === "number");
const inRange = cc && bjPins.every(p => typeof p.lat === "number" && typeof p.lon === "number" && Math.abs(p.lat - cc.lat) <= 0.02 && Math.abs(p.lon - cc.lon) <= 0.02 && p.name);
ok("所有 pin 锚定市中心且偏移≤0.02°", inRange);

// 3) 退化：空名（findCity=null）返回通用 3 片区（防御性兜底）
const g = T.hotelAreasFor("");
ok("空名退化通用 3 片区", g.areas.length === 3 && g.areas.every(a => a.name && a.note));

// 4) 字符串片区城（阿坝）归一化为对象（不丢名）
const ab = T.hotelAreasFor("阿坝");
ok("阿坝(字符串片区)归一化为对象", ab.areas.length >= 1 && ab.areas.every(a => a.name && typeof a.note === "string"));

// 5) 门户：6 平台 + 含日期搜索词
const withDates = T.hotelPortals("北京", { depart: "2026-10-01", days: 3 });
ok("门户平台数 = 6", withDates.length === 6 && withDates.every(p => p.platform && p.term));
ok("含日期搜索词含「入住」", withDates[0].term.includes("北京") && withDates[0].term.includes("酒店") && withDates[0].term.includes("入住"));

// 6) 门户：无行程日期时不带日期
const noDates = T.hotelPortals("北京", {});
ok("无日期搜索词不含「入住」", noDates[0].term.includes("北京 酒店") && !noDates[0].term.includes("入住"));

// 7) stayZoneOf 现在列出多个片区（不再只取第一个）
const z = T.stayZoneOf({ name: "北京" });
ok("stayZoneOf 列出多片区(前门)", /前门/.test(z) && z.includes("推荐住宿区域"));

// 8) cityBrief 的 areas 已是规范化对象 + stayTip 非空
const cb = T.cityBrief("北京");
ok("cityBrief.areas 为对象且非空", cb && Array.isArray(cb.areas) && cb.areas.length >= 1 && cb.areas.every(a => a.name));
ok("cityBrief.stayTip 非空", cb && cb.stayTip && cb.stayTip.length > 0);

console.log(fail ? ("\n✗ 酒店单测失败 " + fail + " 项") : "\n✓ 酒店单测全部通过");
process.exit(fail ? 1 : 0);
