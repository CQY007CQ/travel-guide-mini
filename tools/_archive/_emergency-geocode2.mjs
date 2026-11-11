/**
 * 第二批：为更多热门旅游城市取医院坐标（geocode/geo，地址→坐标，合规）
 * 只列「名称可确证」的大型综合医院；等级拿不准的写「综合医院」
 * 输出 tools/_emergency-coords2.json，交由 _emergency-verify.mjs 做质量闸门
 */
import fs from "fs";
// v1.20.4：用原生 fetch 替代 execSync('curl ...')，避免 shell 拼接注入
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } finally { clearTimeout(timer); }
}

const keys = (() => { try { return fs.readFileSync("tools/geocode.keys", "utf8"); } catch (e) { return ""; } })()
  .split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9]{28,40}$/.test(s));
if (!keys.length) { console.error("无可用 key（tools/geocode.keys）：请检查 key 池，勿发出空 key 请求"); process.exit(1); }

const LIST = [
  // 一线 / 直辖市
  { city: "上海", name: "上海交通大学医学院附属瑞金医院", level: "三甲" },
  { city: "上海", name: "复旦大学附属华山医院", level: "三甲" },
  { city: "上海", name: "上海市第一人民医院", level: "三甲" },
  { city: "广州", name: "中山大学附属第一医院", level: "三甲" },
  { city: "广州", name: "广东省人民医院", level: "三甲" },
  { city: "广州", name: "南方医科大学南方医院", level: "三甲" },
  { city: "深圳", name: "深圳市人民医院", level: "三甲" },
  { city: "深圳", name: "北京大学深圳医院", level: "三甲" },
  // 省会 / 区域中心
  { city: "武汉", name: "华中科技大学同济医学院附属同济医院", level: "三甲" },
  { city: "武汉", name: "华中科技大学同济医学院附属协和医院", level: "三甲" },
  { city: "长沙", name: "中南大学湘雅医院", level: "三甲" },
  { city: "长沙", name: "湖南省人民医院", level: "三甲" },
  { city: "南京", name: "江苏省人民医院", level: "三甲" },
  { city: "南京", name: "南京鼓楼医院", level: "三甲" },
  { city: "苏州", name: "苏州大学附属第一医院", level: "三甲" },
  { city: "昆明", name: "昆明医科大学第一附属医院", level: "三甲" },
  { city: "昆明", name: "云南省第一人民医院", level: "三甲" },
  { city: "贵阳", name: "贵州医科大学附属医院", level: "三甲" },
  { city: "贵阳", name: "贵州省人民医院", level: "三甲" },
  { city: "南宁", name: "广西医科大学第一附属医院", level: "三甲" },
  { city: "南宁", name: "广西壮族自治区人民医院", level: "三甲" },
  { city: "海口", name: "海南省人民医院", level: "三甲" },
  { city: "海口", name: "海口市人民医院", level: "三甲" },
  { city: "兰州", name: "兰州大学第一医院", level: "三甲" },
  { city: "兰州", name: "甘肃省人民医院", level: "三甲" },
  { city: "西宁", name: "青海省人民医院", level: "三甲" },
  { city: "西宁", name: "青海大学附属医院", level: "三甲" },
  { city: "银川", name: "宁夏医科大学总医院", level: "三甲" },
  { city: "乌鲁木齐", name: "新疆维吾尔自治区人民医院", level: "三甲" },
  { city: "乌鲁木齐", name: "新疆医科大学第一附属医院", level: "三甲" },
  { city: "呼和浩特", name: "内蒙古自治区人民医院", level: "三甲" },
  { city: "沈阳", name: "中国医科大学附属第一医院", level: "三甲" },
  { city: "沈阳", name: "辽宁省人民医院", level: "三甲" },
  { city: "大连", name: "大连医科大学附属第一医院", level: "三甲" },
  { city: "大连", name: "大连市中心医院", level: "三甲" },
  { city: "长春", name: "吉林大学第一医院", level: "三甲" },
  { city: "哈尔滨", name: "哈尔滨医科大学附属第一医院", level: "三甲" },
  { city: "哈尔滨", name: "哈尔滨医科大学附属第二医院", level: "三甲" },
  // 热门旅游城市
  { city: "厦门", name: "厦门大学附属第一医院", level: "三甲" },
  { city: "厦门", name: "厦门大学附属中山医院", level: "三甲" },
  { city: "张家界", name: "张家界市人民医院", level: "综合医院" },
  { city: "黄山", name: "黄山市人民医院", level: "综合医院" },
  { city: "洛阳", name: "河南科技大学第一附属医院", level: "三甲" },
  { city: "洛阳", name: "洛阳市中心医院", level: "三甲" },
  { city: "开封", name: "开封市中心医院", level: "三甲" },
  { city: "秦皇岛", name: "秦皇岛市第一医院", level: "三甲" },
  { city: "北海", name: "北海市人民医院", level: "三甲" },
  { city: "吐鲁番", name: "吐鲁番市人民医院", level: "综合医院" },
  { city: "喀什", name: "喀什地区第一人民医院", level: "综合医院" },
  { city: "景洪", name: "西双版纳州人民医院", level: "综合医院" },
  { city: "晋中", name: "晋中市第一人民医院", level: "综合医院" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let i = 0;
for (const h of LIST) {
  const k = keys[i++ % keys.length];
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${k}&address=${encodeURIComponent(h.name)}&city=${encodeURIComponent(h.city)}`;
  let res = {};
  try {
    res = await getJSON(url);
  } catch (e) {}
  const g = res.geocodes && res.geocodes[0];
  const ok = String(res.infocode) === "10000" && g && g.location;
  out.push({
    city: h.city, name: h.name, level: h.level,
    lat: ok ? +g.location.split(",")[1] : null,
    lon: ok ? +g.location.split(",")[0] : null,
    addr: ok ? g.formatted_address : "",
  });
  await sleep(110);
}
fs.writeFileSync("tools/_emergency-coords2.json", JSON.stringify(out, null, 1));
console.log("第二批候选 " + out.length + " 家，取到坐标 " + out.filter((x) => x.lat != null).length + " 家 → tools/_emergency-coords2.json");
