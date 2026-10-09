// 精确景点名解析器：把"热门景区候选名"映射到库内真实景点名。
// 用途：SPOT_TICKETS / SPOT_DETAILS 的 key 必须与 experiences 的 name（经 cleanSpotName 后）精确一致，
// 否则 app 的 D.SPOT_TICKETS[cleanSpotName(name)] 查不到。写补丁前先用本脚本核对真实名，避免白填。
import fs from "fs";
import zlib from "zlib";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");

const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const base = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));

function cleanSpotName(name) {
  const rawS = String(name || "").trim();
  let n = rawS.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )s*[「]?/, "").replace(/」$/, "");
  n = n.replace(/[（(【].*?[)）】]/g, "").trim();
  return n || rawS;
}

// 收集所有 experiences 名（clean 后）与原始名
const namesClean = new Set();
const namesRaw = new Set();
for (const c of base.CITIES) {
  for (const e of (c.experiences || [])) {
    const nm = (e && (e.name || e.t)) || "";
    if (!nm) continue;
    namesRaw.add(nm);
    namesClean.add(cleanSpotName(nm));
  }
}
// SPOT_COORDS 名（第二参考，用于确认库内有坐标）
const coordNames = new Set();
for (const cn in (base.SPOT_COORDS || {})) for (const x of base.SPOT_COORDS[cn] || []) if (x && x[0]) coordNames.add(String(x[0]));

const tickets = base.SPOT_TICKETS || {};
const details = base.SPOT_DETAILS || {};

// 候选热门景区（全国级 / 各省头部 5A，避开北京已覆盖集中的 287）
const CANDIDATES = [
  "外滩","东方明珠广播电视塔","上海迪士尼度假区","豫园","南京路步行街",
  "秦始皇兵马俑博物馆","大雁塔","西安城墙","华清宫","钟楼",
  "西湖","灵隐寺","西溪国家湿地公园","千岛湖",
  "成都大熊猫繁育研究基地","宽窄巷子","都江堰","武侯祠","青城山","锦里",
  "洪崖洞","解放碑","长江索道","磁器口古镇",
  "广州塔","长隆旅游度假区","陈家祠",
  "中山陵","夫子庙","明孝陵","总统府","玄武湖",
  "拙政园","周庄","平江路","苏州古典园林",
  "黄鹤楼","东湖","武汉大学",
  "岳麓山","橘子洲","湖南省博物馆",
  "栈桥","八大关","崂山",
  "鼓浪屿","南普陀寺","厦门大学",
  "丽江古城","玉龙雪山",
  "漓江","象鼻山","阳朔西街",
  "亚龙湾","天涯海角","蜈支洲岛",
  "泰山",
  "黄山",
  "张家界国家森林公园","天门山",
  "九寨沟",
  "布达拉宫","大昭寺",
  "石林","滇池",
  "天津之眼","五大道",
  "沈阳故宫","九一八历史博物馆",
  "中央大街","哈尔滨冰雪大世界","圣索菲亚大教堂",
  "星海广场","老虎滩",
  "世界之窗","深圳欢乐谷",
  "龙门石窟","白马寺","老君山",
  "清明上河园",
  "孔庙","孔府","孔林",
  "云冈石窟","恒山","悬空寺",
  "莫高窟","鸣沙山月牙泉",
  "乐山大佛","峨眉山",
  "篁岭","江湾",
  "武夷山",
  "普陀山",
  "大理古城","苍山","洱海",
  "西塘古镇","乌镇",
  "凤凰古城",
  "平遥古城",
  "五台山",
  "华山",
  "武当山",
  "神农架",
  "庐山",
  "井冈山",
  "太湖","鼋头渚",
  "瘦西湖",
  "趵突泉","大明湖","千佛山",
  "鼓浪屿","梵净山",
  "黄果树瀑布","荔波小七孔",
  "青海湖",
  "喀纳斯",
  "吐鲁番葡萄沟","天山天池",
  "壶口瀑布",
  "长白山","伪满皇宫博物院",
  "北戴河","山海关",
  "周庄","同里","甪直",
  "南靖土楼","鼓浪屿",
  "日月潭","阿里山",
  "黄龙","都江堰",
  "织金洞","赤水",
  "滕王阁","庐山",
  "黄鹤楼","神农架",
];

function bestMatch(cand) {
  // 1) 精确（clean 后）
  if (namesClean.has(cand)) return cand;
  // 2) 原始名精确
  if (namesRaw.has(cand)) return cand;
  // 3) 候选是某库内名的子串（库内名更长更具体）
  let sub = null, subLen = 1e9;
  for (const nm of namesClean) {
    if (nm.includes(cand) && nm.length < subLen) { sub = nm; subLen = nm.length; }
  }
  if (sub) return sub;
  // 4) 库内名是候选子串
  let sup = null, supLen = -1;
  for (const nm of namesClean) {
    if (cand.includes(nm) && nm.length > supLen) { sup = nm; supLen = nm.length; }
  }
  if (sup) return sup;
  return null;
}

let found = 0, missing = 0, hasTicket = 0, missTicket = 0;
console.log("候选 | 库内匹配名 | 有门票数据? | 有介绍数据? | 有坐标?");
for (const cand of CANDIDATES) {
  const m = bestMatch(cand);
  if (!m) { console.log(`${cand} | ❌未入库 | - | - | -`); missing++; continue; }
  found++;
  const t = tickets[m] || tickets[cleanSpotName(m)];
  const d = details[m] || details[cleanSpotName(m)];
  const hasT = !!t, hasD = !!d, hasC = coordNames.has(m);
  if (hasT) hasTicket++; else missTicket++;
  console.log(`${cand} | ${m} | ${hasT ? "✅" : "—"} | ${hasD ? "✅" : "—"} | ${hasC ? "✅" : "—"}`);
}
console.log(`\n汇总：候选 ${CANDIDATES.length} | 库内命中 ${found}（未入库 ${missing}）| 命中里已有门票 ${hasTicket}、缺门票 ${missTicket}`);
