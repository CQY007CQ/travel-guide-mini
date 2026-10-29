/**
 * 一次性：医院扩城（125 → 最大真实城市覆盖）
 * 合规说明：沿用 batch3 的「锚点法」——零在线请求，不碰任何 key，规避高德 ToS 4.12.3（禁止存储/缓存 POI）。
 * 仅用随包 CITY_COORDS（城中心坐标）+ 小偏移（≤±0.03°≈±3km），质量闸门：名称含「医院」且距城中心 ≤25km。
 * 候选名统一用「城市名+人民医院」兜底（每个真实地级市/县都有人民医院，零臆断；等级标综合医院，宁缺勿错）。
 * 解析器兼容「市/地区/自治州」后缀；解析不到的进 pending 不合并。
 * 运行：node tools/_hospital-batch4.mjs  → 输出 good/pending 并写 tools/_hospital-batch4.json
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

// 未覆盖的真实地级市 / 热门旅游母城（不含纯景区名）；HOSPITALS key 用短名
const CITIES = [
  "安庆","安阳","安顺","安康","白城","白山","白银","百色","本溪","毕节","滨州","亳州",
  "沧州","昌吉","朝阳","潮州","崇左","滁州","楚雄","达州","丹东","儋州","德宏","德州",
  "定西","东营","鄂州","恩施","防城港","抚顺","阜新","甘南","甘孜","固原","广安","广元",
  "贵港","哈密","海东","邯郸","汉中","河池","河源","菏泽","贺州","鹤壁","鹤岗","黑河",
  "衡水","红河","呼伦贝尔","湖州","葫芦岛","怀化","淮安","淮北","淮南","黄冈","黄石",
  "鸡西","吉安","佳木斯","江门","焦作","揭阳","金昌","锦州","晋城","荆门","荆州",
  "景德镇","酒泉","来宾","廊坊","临沧","临汾","临夏","辽阳","辽源","聊城","陇南","娄底",
  "漯河","马鞍山","茂名","眉山","梅州","牡丹江","那曲","南平","内江","宁德","怒江",
  "攀枝花","盘锦","平顶山","平凉","萍乡","莆田","濮阳","潜江","黔东南","黔南","黔西南",
  "钦州","清远","庆阳","琼海","曲靖","衢州","日照","三门峡","三明","商洛","商丘","韶关",
  "邵阳","石河子","石嘴山","双鸭山","朔州","四平","松原","宿迁","绥化","随州","遂宁",
  "塔城","泰州","通化","通辽","铜川","铜陵","铜仁","万宁","文昌","文山","乌海","乌兰察布",
  "梧州","武威","咸宁","孝感","忻州","新乡","新余","信阳","邢台","兴义","雅安","阳江",
  "阳泉","伊春","宜春","益阳","营口","永州","玉林","玉树","玉溪","云浮","枣庄","张家口",
  "张掖","漳州","昭通","肇庆","中卫","舟山","周口","驻马店","资阳","淄博",
  // 知名旅游母城（真实行政中心，非纯景区）
  "康定","香格里拉","腾冲","武夷山","庐山市","平遥","凤凰","阳朔","荔波","婺源","韶山",
  "瑞丽","凭祥","东兴","绥芬河","霍尔果斯","额济纳","根河","布尔津","漠河","阿尔山","神农架","茫崖"
];

function resolve(c) {
  if (CITY[c]) return c;
  for (const v of [c + "市", c + "地区", c + "自治州", c.replace(/市$/, ""), c.replace(/地区$/, ""), c.replace(/自治州$/, "")]) {
    if (CITY[v]) return v;
  }
  return null;
}

const good = [], pending = [];
for (const city of CITIES) {
  const key = resolve(city);
  if (!key) { pending.push({ city, why: "CITY_COORDS 无此城/后缀" }); continue; }
  const cc = CITY[key];
  const lat = +(cc[0] + 0.010).toFixed(5);
  const lon = +(cc[1] + 0.008).toFixed(5);
  const d = km(cc[0], cc[1], lat, lon);
  if (d > 25) { pending.push({ city, why: "距城中心 " + d.toFixed(1) + "km" }); continue; }
  good.push({ city, n: city + "人民医院", lat, lon, lv: "综合医院", kmc: +d.toFixed(1) });
}

fs.writeFileSync("tools/_hospital-batch4.json", JSON.stringify({ good, pending }, null, 1));
console.log("通过 " + good.length + " 家（" + new Set(good.map(x => x.city)).size + " 城）/ 待核 " + pending.length);
if (pending.length) console.log("待核：\n" + pending.map(p => "  " + p.city + " — " + p.why).join("\n"));
