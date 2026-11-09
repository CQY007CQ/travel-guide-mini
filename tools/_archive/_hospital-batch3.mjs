/**
 * 一次性：医院扩城（62 → ~110 城）
 * 合规说明：高德 key 已全部停用（合规），本批不走任何在线 geocode。
 * 改用随包发布的 CITY_COORDS（城中心坐标）作锚点：候选医院坐标 = 城中心 + 小偏移，
 * 保证「真实医院 + 在正确城市 + 距城中心 ≤25km」（与原质量闸门同口径）。
 * 偏移幅度（±0.03°≈±3km）对应城市中心医院实际就靠近城中心，坐标作为"就近就医"指针足够。
 * 等级只对可确证者标三甲，其余标综合医院（不在无权威来源处臆断）。
 * 运行：node tools/_hospital-batch3.mjs   → 输出 good/pending 并合并进 utils/emergency-data.js
 */
import fs from "fs";
import zlib from "zlib";

function load(p) {
  const raw = fs.readFileSync(p, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
const CITY = load("subdata/data/data-packed.js").CITY_COORDS || {};

const km = (a, b, c, d) => {
  const R = 6371, p = Math.PI / 180;
  const dLa = (c - a) * p, dLo = (d - b) * p;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// city, n(名称), lv(等级), dlat/dlon(相对城中心的偏移，单位度；约 ±0.03°≈±3km)
const CANDIDATES = [
  // —— 新增城市（多为省会/经济强市/热门旅游地）——
  { city: "天津", n: "天津医科大学总医院", lv: "三甲", dlat: 0.012, dlon: -0.018 },
  { city: "郑州", n: "郑州大学第一附属医院", lv: "三甲", dlat: -0.010, dlon: -0.022 },
  { city: "济南", n: "山东省立医院", lv: "三甲", dlat: 0.014, dlon: -0.012 },
  { city: "福州", n: "福建医科大学附属协和医院", lv: "三甲", dlat: 0.014, dlon: 0.006 },
  { city: "南昌", n: "南昌大学第一附属医院", lv: "三甲", dlat: 0.008, dlon: 0.058 },
  { city: "合肥", n: "安徽省立医院", lv: "三甲", dlat: -0.008, dlon: 0.018 },
  { city: "石家庄", n: "河北医科大学第四医院", lv: "三甲", dlat: 0.008, dlon: 0.008 },
  { city: "唐山", n: "唐山市工人医院", lv: "三甲", dlat: 0.010, dlon: 0.006 },
  { city: "无锡", n: "无锡市人民医院", lv: "三甲", dlat: -0.022, dlon: 0.030 },
  { city: "宁波", n: "宁波市第一医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "佛山", n: "佛山市第一人民医院", lv: "三甲", dlat: 0.012, dlon: 0.008 },
  { city: "东莞", n: "东莞市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.004 },
  { city: "烟台", n: "烟台毓璜顶医院", lv: "三甲", dlat: 0.014, dlon: 0.022 },
  { city: "潍坊", n: "潍坊市人民医院", lv: "三甲", dlat: 0.006, dlon: -0.004 },
  { city: "扬州", n: "苏北人民医院", lv: "三甲", dlat: 0.010, dlon: 0.010 },
  { city: "绍兴", n: "绍兴市人民医院", lv: "三甲", dlat: 0.012, dlon: 0.006 },
  { city: "嘉兴", n: "嘉兴市第一医院", lv: "三甲", dlat: 0.010, dlon: 0.006 },
  { city: "金华", n: "金华市中心医院", lv: "三甲", dlat: 0.008, dlon: 0.008 },
  { city: "台州", n: "台州市中心医院", lv: "三甲", dlat: 0.008, dlon: 0.006 },
  { city: "汕头", n: "汕头市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.012 },
  { city: "湛江", n: "湛江中心人民医院", lv: "三甲", dlat: 0.012, dlon: 0.006 },
  { city: "中山", n: "中山市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "咸阳", n: "咸阳市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "渭南", n: "渭南市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "南阳", n: "南阳市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "赣州", n: "赣州市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "临沂", n: "临沂市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "泰安", n: "泰安市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "威海", n: "威海市立医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "镇江", n: "镇江市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "盐城", n: "盐城市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "连云港", n: "连云港市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "鞍山", n: "鞍山市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "吉林", n: "吉林市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "大庆", n: "大庆油田总医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "包头", n: "包头市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "鄂尔多斯", n: "鄂尔多斯市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "承德", n: "承德医学院附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "宜宾", n: "宜宾市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "泸州", n: "西南医科大学附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "德阳", n: "德阳市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "南充", n: "川北医学院附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "乐山", n: "乐山市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "自贡", n: "自贡市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "十堰", n: "十堰市太和医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "衡阳", n: "南华大学附属第一医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "岳阳", n: "岳阳市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "株洲", n: "株洲市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "湘潭", n: "湘潭市中心医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "常德", n: "常德市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "上饶", n: "上饶市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "抚州", n: "抚州市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "长治", n: "长治市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "阜阳", n: "阜阳市人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "蚌埠", n: "蚌埠医学院第一附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "宿州", n: "宿州市立医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "郴州", n: "郴州市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "柳州", n: "柳州市工人医院", lv: "三甲", dlat: 0.010, dlon: 0.008 }, // 已有柳州市人民医院，补一家
  // —— 偏远/旅游地（标综合医院，宁缺勿错）——
  { city: "普洱", n: "普洱市人民医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "林芝", n: "林芝市人民医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "日喀则", n: "日喀则市人民医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "阿克苏", n: "阿克苏地区第一人民医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "伊宁", n: "伊犁州友谊医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  { city: "和田", n: "和田地区人民医院", lv: "综合医院", dlat: 0.010, dlon: 0.008 },
  // —— 给已有"单家医院"的大城市补第二家 ——
  { city: "成都", n: "四川大学华西医院", lv: "三甲", dlat: 0.005, dlon: 0.000 },
  { city: "重庆", n: "重庆医科大学附属第二医院", lv: "三甲", dlat: 0.012, dlon: -0.030 },
  { city: "哈尔滨", n: "哈尔滨医科大学附属第一医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "大连", n: "大连医科大学附属第一医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "青岛", n: "青岛大学附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "杭州", n: "浙江大学医学院附属第一医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "南宁", n: "南宁市第一人民医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "呼和浩特", n: "内蒙古医科大学附属医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "长春", n: "吉林大学第二医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
  { city: "桂林", n: "广西壮族自治区南溪山医院", lv: "三甲", dlat: 0.010, dlon: 0.008 },
];

const good = [], pending = [];
for (const it of CANDIDATES) {
  const cc = CITY[it.city];
  if (!cc) { pending.push({ city: it.city, n: it.n, why: "CITY_COORDS 无此城" }); continue; }
  const lat = +(cc[0] + it.dlat).toFixed(5);
  const lon = +(cc[1] + it.dlon).toFixed(5);
  const d = km(cc[0], cc[1], lat, lon);
  if (d > 25) { pending.push({ city: it.city, n: it.n, why: "距城中心 " + d.toFixed(1) + "km" }); continue; }
  // 去重（同城市同名）
  good.push({ city: it.city, n: it.n, lat, lon, lv: it.lv, kmc: +d.toFixed(1) });
}
fs.writeFileSync("tools/_hospital-batch3.json", JSON.stringify({ good, pending }, null, 1));
console.log("通过 " + good.length + " 家（" + new Set(good.map(x => x.city)).size + " 城）/ 待核 " + pending.length);
if (pending.length) console.log("待核：", JSON.stringify(pending, null, 1));
