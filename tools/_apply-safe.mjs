// 安全合并（绕过 merge-data-patch.mjs 的 CITIES_ADD 整体替换 bug）：
// 以 subdata/data/data-packed.js 的已知好状态为 base（v1.20 起数据包移入分包），只叠加「增量」补丁：
//   - v198-landmark-promote.js 的 EXP_REPLACE（剩余未入 experiences 的地标池名）
//   - v199-amap-spots.js 的 LM_ADD / COORDS_ADD / SPOT_INFO（本轮新增 131 真实 POI + 历史池）
// 跳过 CITIES_ADD / EXP_REMOVE / LM_REMOVE（这些已在 11,690 中固化，重放会整体替换城市对象导致掉数）。
import fs from "fs";
import zlib from "zlib";
import path from "path";
import { createRequire } from "module";
import { isNearDup } from "./lib-near-dup.mjs";
const req = createRequire(process.cwd() + "/");

// 1) base = 数据分块解压合并（已知好状态）
// v1.20：大数据包已拆到分包 subdata/data/data-packed.js，且可能因体积切成多块（subdata/subdata2/subdata3…）。
// 必须按 subdata/data/_manifest.js 列出的「全部」分块合并，否则只解 chunk1 会丢失其余分块数据
//（实测 SPOT_DETAILS_BY_CITY 整体落在 chunk2，漏读会静默丢数）。
function _loadChunk(file) {
  const raw = fs.readFileSync(file, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
function _mergeInto(target, src) {
  for (const k of Object.keys(src)) {
    const sv = src[k], tv = target[k];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) _mergeInto(tv, sv);
    else if (Array.isArray(sv) && Array.isArray(tv)) {
      const seen = new Set(tv.map(x => JSON.stringify(x)));
      for (const it of sv) { const j = JSON.stringify(it); if (!seen.has(j)) { tv.push(it); seen.add(j); } }
    } else target[k] = sv;
  }
  return target;
}
let _manifest = null;
try { _manifest = req("./subdata/data/_manifest.js"); } catch (e) {}
// manifest 内的相对路径以 utils/data.js 为基准（"../subdata/..."），这里从项目根用 fs 读取需拼回 "utils/"
const _rel = p => p.startsWith("../") ? path.join("utils", p) : p;
let base;
if (Array.isArray(_manifest) && _manifest.length) {
  base = _loadChunk(_rel(_manifest[0]));
  for (let i = 1; i < _manifest.length; i++) _mergeInto(base, _loadChunk(_rel(_manifest[i])));
  console.log("base 已按 manifest 合并", _manifest.length, "块");
} else {
  const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
  base = _loadChunk(PACKED_PATH);
}

let exp = 0;
for (const c of base.CITIES) exp += (c.experiences || []).length;
console.log("base (合并全部分块) experiences:", exp, "| cities:", base.CITIES.length);

const promo = req("./tools/v198-landmark-promote.js");
const amap = req("./tools/v199-amap-spots.js");
let official = {};
try { official = req("./tools/v200-official-import.js"); } catch (e) { /* 无官方名录批次时跳过 */ }
let officialCoords = {};
try { officialCoords = req("./tools/v201-official-coords.js"); } catch (e) { /* 无坐标批次时跳过 */ }
let foodShops = {};
try { foodShops = (req("./tools/v199-food-shops.js") || {}).FOOD_SPOTS_ADD || {}; } catch (e) { /* 无美食批次时跳过 */ }
// v202 美食增量批次 2：公开资料提店名 + geocode 精确地址取坐标 + 闸门校验（洛阳试点）
try {
  const _f2 = (req("./tools/v202-food-shops2.js") || {}).FOOD_SPOTS_ADD || {};
  for (const _cn in _f2) {
    if (!foodShops[_cn]) foodShops[_cn] = [];
    foodShops[_cn] = foodShops[_cn].concat(_f2[_cn]);
  }
} catch (e) { /* 无第二批时跳过 */ }
// v205 美食菜单/口碑试点（10 热门城市）：仅含 {shop,menu,rep,note} 扩展字段，§6.6 命中已有店回写
try {
  const _f3 = (req("./tools/v205-food-menu.js") || {}).FOOD_SPOTS_ADD || {};
  for (const _cn in _f3) {
    if (!foodShops[_cn]) foodShops[_cn] = [];
    foodShops[_cn] = foodShops[_cn].concat(_f3[_cn]);
  }
} catch (e) { /* 无 v205 批次时跳过 */ }
// v206 美食缺坐标补丁（geocode/geo 取得，仅坐标，按店名回写）—— §6.7 消费
let foodCoords = {};
try { foodCoords = (req("./tools/v206-food-coords.js") || {}).FOOD_COORDS_ADD || {}; } catch (e) { /* 无美食坐标批次时跳过 */ }
// v207 Tier1 编辑整理管线（菜单/口碑/酒店参考价区间），§6.6 消费 FOOD_SPOTS_ADD
try {
  const _r7 = (req("./tools/v207-rich-info.js") || {});
  const _f7 = _r7.FOOD_SPOTS_ADD || {};
  for (const _cn in _f7) { if (!foodShops[_cn]) foodShops[_cn] = []; foodShops[_cn] = foodShops[_cn].concat(_f7[_cn]); }
} catch (e) { /* 无 v207 批次时跳过 */ }
// v207 酒店片区参考价区间（HOTEL_AREA_NOTES）—— §6.8 消费
let hotelNotes = {};
try { hotelNotes = (req("./tools/v207-rich-info.js") || {}).HOTEL_AREA_NOTES || {}; } catch (e) { /* 无 v207 批次时跳过 */ }
// v208 Tier1 编辑整理管线（第二批美食扩城，10 城×3 店），§6.6 消费 FOOD_SPOTS_ADD
try {
  const _r8 = (req("./tools/v208-rich-info.js") || {});
  const _f8 = _r8.FOOD_SPOTS_ADD || {};
  for (const _cn in _f8) { if (!foodShops[_cn]) foodShops[_cn] = []; foodShops[_cn] = foodShops[_cn].concat(_f8[_cn]); }
} catch (e) { /* 无 v208 批次时跳过 */ }
// v210 美食扩城（72 城 × 真实老字号/代表餐饮，FOOD_SPOTS_ADD，坐标齐备）
try {
  const _r10 = (req("./tools/v210-food-deepcities.js") || {});
  const _f10 = _r10.FOOD_SPOTS_ADD || {};
  for (const _cn in _f10) { if (!foodShops[_cn]) foodShops[_cn] = []; foodShops[_cn] = foodShops[_cn].concat(_f10[_cn]); }
} catch (e) { /* 无 v210 批次时跳过 */ }

// 内联 cleanSpotName（避免 require utils/travel.js 触发 wx/微信全局，node 下崩溃）
function cleanSpotName(name) {
  const rawS = String(name || "").trim();
  let n = rawS.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )s*[「]?/, "").replace(/」$/, "");
  n = n.replace(/[（(【].*?[)）】]/g, "").trim();
  return n || rawS;
}

// v204 改名映射：改名后「旧名」已从 experiences 消失，但 v198/v200 等历史补丁里仍是旧名，
// 每轮 apply 都会因「同名检查不命中」把旧名当新条目再追加一次 → 同一景点长短名各一条（实测 +1808 条）。
// 这里提前建好映射，供 ① EXP_REPLACE 同名检查 ② §9.8 旧名残留清理 共用。
const RENAME = (() => {
  let nc = {};
  try { nc = req("./tools/v204-name-clean.js") || {}; } catch (e) { /* 无补丁 */ }
  const byCity = {};
  for (const cn in (nc.EXP_RENAME || {})) for (const r of nc.EXP_RENAME[cn]) {
    if (!r || !r.from || !r.to) continue;
    if (!byCity[cn]) byCity[cn] = {};
    byCity[cn][r.from] = r.to;
  }
  for (const key in (nc.NAME_FIX || {})) {
    const i = key.indexOf("|");
    if (i < 0) continue;
    const cn = key.slice(0, i), from = key.slice(i + 1);
    if (!byCity[cn]) byCity[cn] = {};
    byCity[cn][from] = nc.NAME_FIX[key];
  }
  return byCity;
})();
// 判断「该名字（或其改名后的新名）是否已存在于这座城市的 experiences 里」
const _hasExpName = (arr, name, cn) => {
  if (arr.some(e => (e && e.name) === name)) return true;
  const m = RENAME[cn];
  const to = m && m[name];
  if (to && arr.some(e => (e && e.name) === to)) return true;      // 旧名 → 已改成新名
  for (const k in (m || {})) if (m[k] === name && arr.some(e => (e && e.name) === k)) return true; // 新名 → 旧名还在
  return false;
};

// 2) EXP_REPLACE（仅 from==="" 的追加；同名跳过）
const expByCity = {};
for (const c of base.CITIES) expByCity[c.name] = c.experiences || (c.experiences = []);
let addedExp = 0;
for (const cn in (promo.EXP_REPLACE || {})) {
  const arr = expByCity[cn]; if (!arr) continue;
  for (const { from, to } of promo.EXP_REPLACE[cn]) {
    if (from !== "") continue;
    if (!_hasExpName(arr, to.name, cn)) { arr.push(to); addedExp++; }
  }
}
for (const cn in (official.EXP_REPLACE || {})) {
  const arr = expByCity[cn]; if (!arr) continue;
  for (const { from, to } of official.EXP_REPLACE[cn]) {
    if (from !== "") continue;
    if (!_hasExpName(arr, to.name, cn)) { arr.push(to); addedExp++; }
  }
}
console.log("promotion 追加 experiences:", addedExp);

// 3) LM_ADD → CITY_LANDMARKS_EXTRA（池，去重）
if (!base.CITY_LANDMARKS_EXTRA) base.CITY_LANDMARKS_EXTRA = {};
let addedPool = 0;
for (const cn in (amap.LM_ADD || {})) {
  if (!base.CITY_LANDMARKS_EXTRA[cn]) base.CITY_LANDMARKS_EXTRA[cn] = [];
  const s = new Set(base.CITY_LANDMARKS_EXTRA[cn]);
  for (const n of amap.LM_ADD[cn]) if (!s.has(n)) { base.CITY_LANDMARKS_EXTRA[cn].push(n); s.add(n); addedPool++; }
}
console.log("LM_ADD 追加池:", addedPool);

// 4) COORDS_ADD → SPOT_COORDS（按名去重 + 近似重复守卫）
if (!base.SPOT_COORDS) base.SPOT_COORDS = {};
let addedCoord = 0, skippedNearDup = 0;
// 近似重复：同城内已有名称互相包含（「劳动公园」vs「大连劳动公园」）且坐标相距 <3km 的条目时，
// 新条目是冗余的。而且它会在「全省游」的省域扫描里排在前面，把同名景点指到错误的城市
// （实测：辽宁·劳动公园 从朝阳市被改指到大连，跨城重名护栏挂）。
const _addCoords = (src) => {
  for (const cn in (src || {})) {
    if (!base.SPOT_COORDS[cn]) base.SPOT_COORDS[cn] = [];
    const list = base.SPOT_COORDS[cn];
    const s = new Set(list.map(x => x[0]));
    for (const x of src[cn]) {
      if (!x || !x[0] || s.has(x[0])) continue;
      if (isNearDup(list, x)) { skippedNearDup++; continue; }
      list.push(x); s.add(x[0]); addedCoord++;
    }
  }
};
_addCoords(amap.COORDS_ADD);
_addCoords(official.COORDS_ADD);
_addCoords(officialCoords.COORDS_ADD);
// 全量清理：对每座城市再扫一遍近似重复（同名近似 + 坐标 <3km），保留先出现的那条。
// 这一步是幂等的，也能修掉已写进 data-packed.js 的历史冗余（如 大连 同时有「大连劳动公园」与「劳动公园」）。
let cleanedNearDup = 0;
for (const cn in base.SPOT_COORDS) {
  const list = base.SPOT_COORDS[cn];
  if (!Array.isArray(list) || list.length < 2) continue;
  const out = [];
  for (const x of list) {
    if (!x || !x[0] || isNearDup(out, x)) { if (x && x[0]) cleanedNearDup++; continue; }
    out.push(x);
  }
  if (out.length !== list.length) base.SPOT_COORDS[cn] = out;
}
console.log("COORDS_ADD 追加坐标:", addedCoord, "| 近似重复丢弃(新增):", skippedNearDup, "| 近似重复清理(存量):", cleanedNearDup);

// 5) SPOT_INFO
base.SPOT_INFO = Object.assign(base.SPOT_INFO || {}, amap.SPOT_INFO || {});
base.SPOT_INFO = Object.assign(base.SPOT_INFO || {}, official.SPOT_INFO || {});

// 5.3) 门票 / 介绍 / 预约提示 合并（新增，幂等，按名累加）
// 此前 _apply-safe.mjs 从未合并 TICKET_ADD / DETAIL_ADD / BOOKING_TIPS（merge-data-patch 也跳过了），
// 导致门票/介绍/预约数据始终空着（审计：门票仅 1%、介绍 0.3%）。
// 扫描全部补丁文件 tools/v1NN-*.js 提取这三类增量，与已入库数据按名累加。
//   TICKET_ADD   形状：{ 景名: {p, book, where, url} }
//   DETAIL_ADD   形状：{ 景名: {intro, how, route} }
//   BOOKING_TIPS 形状：[{ kw, days, where }]（数组；travel.js 的 bookingLines 按数组消费；
//                       base 里历史存的是对象 {"0".."27"}，这里统一转数组使其生效）
let ticketAdd = {}, detailAdd = {}, bookingTips = [];
for (const fn of fs.readdirSync("tools")) {
  if (!/^v[12]\d\d-.*\.js$/.test(fn)) continue;   // v2xx 也要扫：v203-tickets-details.js 的票价/介绍增量靠这里进包
  let mod; try { mod = req("./tools/" + fn); } catch (e) { continue; }
  if (mod && mod.TICKET_ADD) Object.assign(ticketAdd, mod.TICKET_ADD);
  if (mod && mod.DETAIL_ADD) Object.assign(detailAdd, mod.DETAIL_ADD);
  if (mod && Array.isArray(mod.BOOKING_TIPS)) bookingTips = bookingTips.concat(mod.BOOKING_TIPS);
}
base.SPOT_TICKETS = Object.assign(base.SPOT_TICKETS || {}, ticketAdd);
base.SPOT_DETAILS = Object.assign(base.SPOT_DETAILS || {}, detailAdd);
// BOOKING_TIPS：base 历史对象 → 数组；按 kw 去重（后覆盖先）
{
  const btMap = {};
  const existBt = base.BOOKING_TIPS;
  if (Array.isArray(existBt)) for (const t of existBt) if (t && t.kw != null) btMap[t.kw] = t;
  else if (existBt && typeof existBt === "object") for (const k in existBt) { const t = existBt[k]; if (t && t.kw != null) btMap[t.kw] = t; }
  for (const t of bookingTips) if (t && t.kw != null) btMap[t.kw] = t;
  base.BOOKING_TIPS = Object.keys(btMap).map(k => btMap[k]);
}
console.log("TICKET_ADD 合并:", Object.keys(ticketAdd).length, "| DETAIL_ADD 合并:", Object.keys(detailAdd).length, "| BOOKING_TIPS 新增:", bookingTips.length);

// 6) §9 清洗名去重（与 merge 一致，防跨天重复 stress 误报；对已去重 base 是幂等的）
const clean = cleanSpotName;
let removed = 0;
for (const c of base.CITIES) {
  const exps = c.experiences;
  if (!Array.isArray(exps) || !exps.length) continue;
  const groups = new Map();
  exps.forEach(e => { const n = (e && (e.name || e.t)) || ""; const k = clean(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
  if (groups.size === exps.length) continue;
  const out = [];
  for (const [, arr] of groups) {
    const canon = arr.filter(e => { const n = (e && (e.name || e.t)) || ""; return clean(n) === n; });
    const best = (canon.length ? canon : arr).slice().sort((a, b) => ((a.name || "").length) - ((b.name || "").length))[0];
    out.push(best); removed += arr.length - 1;
  }
  c.experiences = out;
}
if (removed) console.log("§9 清洗名去重移除:", removed);

// §9.5 清洗 note 里未配对的括号。
// 真实体验发现：部分景点 note 形如「评分4.6·开放...周一 全天不开放(法」——
// 开放时间文案在采集时被截断，留下半个括号，用户看到会以为是乱码。
// 处理：丢掉多余的右括号；末尾未闭合的左括号直接移除（宁可少半个修饰语，也不显示残括号）。
function cleanBrackets(str) {
  const s = String(str || "");
  if (!/[()（）]/.test(s)) return s;
  let out = "", stack = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "（") { stack++; out += ch; }
    else if (ch === ")" || ch === "）") { if (stack > 0) { stack--; out += ch; } }
    else out += ch;
  }
  if (stack > 0) {
    let res = "", drop = stack;
    for (let i = out.length - 1; i >= 0; i--) {
      const ch = out[i];
      if ((ch === "(" || ch === "（") && drop > 0) { drop--; continue; }
      res = ch + res;
    }
    out = res;
  }
  return out;
}
let noteFixed = 0;
for (const c of base.CITIES) {
  for (const e of (c.experiences || [])) {
    if (!e || typeof e !== "object" || typeof e.note !== "string") continue;
    const fixed = cleanBrackets(e.note);
    if (fixed !== e.note) { e.note = fixed; noteFixed++; }
  }
}
if (noteFixed) console.log("§9.5 note 括号清洗:", noteFixed, "条");

// §9.6 占位备注改写（「当地知名景点」/「当地景区」这类没有信息量的占位文案）
// v1.19.27：备注按「景点类别」生成实用提示，并按景点名哈希在同类的 2-3 种说法里轮换
// （同一类景点不会千篇一律，同时每条都带可执行信息：穿什么/几点去/注意什么）。
// ⚠️ 只写「这一类场所普遍成立」的事实，不编造票价、开放时间、具体活动日期。
function noteBySpotName(name) {
  const n = String(name || "");
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const pick = (arr) => arr[h % arr.length];
  // —— 展馆类 ——
  if (/博物馆|博物院|美术馆|展览馆|陈列馆/.test(n)) return pick(["室内展馆，建议留 1-2 小时，雨天也能安排", "展馆以图文实物为主，配讲解更值", "室内为主，注意闭馆日与预约要求"]);
  if (/科技馆|天文馆|自然馆/.test(n)) return pick(["互动展项多，适合亲子，热门馆要提前约", "科技类展馆，互动装置排队，早到更好"]);
  if (/纪念馆|纪念堂|纪念碑|烈士/.test(n)) return pick(["纪念类场馆，免费参观需实名预约", "缅怀类场所，参观请保持安静", "纪念场馆多周一闭馆，出发前确认"]);
  // —— 自然地貌 ——
  if (/溶洞|洞|石窟|石刻|摩崖/.test(n)) return pick(["洞内湿滑凉爽，带件薄外套、穿防滑鞋", "钟乳石景观，禁止闪光灯，跟随指示路线", "洞窟光线暗、地面湿，注意脚下台阶"]);
  if (/温泉|汤/.test(n)) return pick(["泡汤自备泳衣泳帽，单次别超 15 分钟", "温泉区需泳衣，泡汤间隙记得补水", "温泉度假类，留出半天慢慢泡"]);
  if (/草原|草甸|牧场/.test(n)) return pick(["草原开阔，防晒防风，早晚温差大带外套", "草原景区日照强，注意防晒和补水", "开阔草场风大，带件防风外套"]);
  if (/沙漠|沙丘|沙海/.test(n)) return pick(["沙漠昼夜温差大，防晒墨镜必备", "沙地行走费鞋，建议穿高帮鞋或鞋套", "沙漠项目受天气影响，风大时可能停开"]);
  if (/梯田/.test(n)) return pick(["梯田看季节，灌水期与收割期最好看", "梯田多需步行爬坡，穿好走的鞋", "层层梯田，清晨云雾与日落光线最佳"]);
  if (/岛|群岛/.test(n)) return pick(["上岛看船班，返程末班船别错过", "海岛紫外线强，备好防晒与晕船药", "岛屿行程受潮汐天气影响，出发前查船班"]);
  if (/湿地/.test(n)) return pick(["湿地栈道较长，蚊虫多带驱蚊液", "湿地观鸟早晚最活跃，有望远镜更好", "湿地多木栈道，雨后注意防滑"]);
  if (/森林|林场|原始林|竹海/.test(n)) return pick(["林区内步行量大，带水与防蚊用品", "森林氧吧类，林间步道湿滑注意脚下", "林区手机信号可能弱，提前告知同行人"]);
  if (/峡谷|大峡谷|沟|谷|一线天/.test(n)) return pick(["峡谷内路程长，往返要留足时间", "峡谷多台阶栈道，膝盖不好量力而行", "峡谷一线天类，正午光线最好"]);
  if (/瀑布|叠水/.test(n)) return pick(["瀑布水雾大，靠近会湿身，注意相机防水", "瀑布观景台湿滑，抓稳扶手", "丰水期更壮观，枯水期水量可能很小"]);
  if (/山|峰|岭|登山|主峰/.test(n)) return pick(["登山耗体力，早点出发并留足下山时间", "山区天气多变，带雨具与防风外套", "登顶路段长，量力折返并带足水"]);
  // —— 宗教与人文 ——
  if (/寺|庙|庵/.test(n)) return pick(["宗教场所，着装得体、轻声慢行", "寺院多有过堂斋饭，留意开放时间", "进殿按指示参观，勿拍佛像"]);
  if (/道观|道院|观$/.test(n)) return pick(["道观为宗教场所，留意开放时间", "道院清幽，参观请保持安静"]);
  if (/清真寺/.test(n)) return pick(["宗教场所，礼拜时间请避让，着装得体"]);
  if (/教堂|礼拜堂|福音堂|天主堂/.test(n)) return pick(["开放时段可入内，弥撒礼拜期间请避让", "老教堂多为文物建筑，请勿用闪光灯"]);
  if (/古镇|古村|古城|古寨|村寨/.test(n)) return pick(["古镇边逛边吃，主街人多可拐进小巷", "古村慢逛更有味，清晨和傍晚最安静", "古镇夜景比白天好看，可留到晚上"]);
  if (/老街|步行街|街区|巷|胡同|古街|商业街|骑楼/.test(n)) return pick(["街区免费逛，沿街小店可慢慢挑", "老街傍晚去最舒服，灯光与人气刚好", "街区以逛吃为主，留出肚子尝小吃"]);
  if (/遗址|遗迹|古城址|废墟/.test(n)) return pick(["遗址看点偏人文，配讲解更有收获", "遗址多露天，晴天参观更舒服", "历史遗迹，留意保护提示别越线"]);
  if (/故居|旧居|旧址|故里/.test(n)) return pick(["名人故居展陈偏图文，半小时到一小时", "故居多为老建筑，参观请轻声慢行"]);
  if (/长城|关隘|关口|烽火台/.test(n)) return pick(["长城段多陡坡台阶，穿防滑鞋带水", "长城风大日晒，做好防晒", "爬长城体力消耗大，量力折返"]);
  if (/塔$|塔影|楼|阁|亭|钟楼|鼓楼/.test(n)) return pick(["登楼可俯瞰，台阶窄注意错身", "古建多为木构，留意限流与开放时间", "登高层看城市轮廓，傍晚光线最好"]);
  if (/城墙|城门|城楼/.test(n)) return pick(["城墙可骑行或步行，挑一段即可", "城墙上看城市轮廓，傍晚光线好"]);
  if (/桥|廊桥|风雨桥/.test(n)) return pick(["古桥多为文物，注意通行与限重提示", "桥头是拍照点，早晚人少更好拍"]);
  if (/园林|花园|园$|庭院/.test(n)) return pick(["园林讲究移步换景，慢慢逛别赶", "园内假山水榭适合拍照，清晨人少", "庭院类空间紧凑，细看更有趣"]);
  // —— 现代场馆 ——
  if (/动物园|海洋馆|水族馆|极地/.test(n)) return pick(["按表演场次安排路线，先查时刻表", "亲子友好，园区大建议早到", "馆内餐饮偏贵，可自带饮用水"]);
  if (/植物园|花卉园|百花园/.test(n)) return pick(["植物园面积大，按主题园区挑着看", "温室区闷热，注意补水"]);
  if (/游乐园|主题乐园|水上乐园|欢乐谷|方特|迪士尼|水世界/.test(n)) return pick(["热门项目排队久，先玩大项目", "开园就进更划算，带好防晒", "水上项目备换洗衣物与防水袋"]);
  if (/滑雪|雪场/.test(n)) return pick(["雪票雪具建议提前订，雪场气温低注意保暖", "初级道先练再上，护具别省"]);
  if (/漂流|橡皮艇/.test(n)) return pick(["漂流受水量影响，出发前确认是否开漂", "漂流会湿身，备防水袋与换洗衣物"]);
  if (/露营|营地|帐篷/.test(n)) return pick(["营地需提前订，山区夜里降温明显", "露营注意用火安全与垃圾带走"]);
  if (/绿道|步道|骑行|栈道/.test(n)) return pick(["绿道适合骑行慢跑，可租共享单车", "步道较长，按体力选一段走"]);
  if (/观景台|观景点|瞰|观景/.test(n)) return pick(["高层观景风大注意保暖，错峰更舒服", "看全景日落前一小时最佳"]);
  if (/夜市|市集|菜市场|早市|小吃街|集市/.test(n)) return pick(["夜市傍晚才热闹，空腹去更尽兴", "市集小吃多，看价再买", "夜市人多，看好随身物品"]);
  if (/非遗|民俗|手作|工坊|作坊/.test(n)) return pick(["可体验手作，先问清场次与费用", "非遗以展示为主，赶上体验场次更值"]);
  if (/文创|创意园|艺术区|工业遗址|798/.test(n)) return pick(["园区免费逛，展览演出另收", "老厂房改造很出片，工作日人少"]);
  if (/红色|革命|苏区|起义|抗战/.test(n)) return pick(["红色景区多为免费预约参观", "革命旧址配讲解更清楚历史脉络"]);
  if (/陵|墓|陵园/.test(n)) return pick(["陵园庄严肃穆，参观请保持安静", "陵墓类多需另购票，留意开放时间"]);
  if (/体育馆|体育场|体育中心/.test(n)) return pick(["场馆以外观与活动为主，赛事日才热闹"]);
  if (/码头|渡口|渔港/.test(n)) return pick(["码头看江景，坐船项目另购票", "轮渡班次固定，注意末班时间"]);
  if (/雕塑|雕像|浮雕|铜像/.test(n)) return pick(["打卡类雕塑，合影即可，不必久留"]);
  if (/广场/.test(n)) return pick(["城市广场，适合散步看夜景", "广场周边好逛，晚上更热闹"]);
  if (/花海|花田|花谷|花海景区/.test(n)) return pick(["花期受季节影响，出发前确认是否开花", "花田拍照别踩踏，沿田埂走"]);
  if (/茶园|茶山|茶场/.test(n)) return pick(["茶园可体验采茶制茶，春季最合适", "茶山步道有坡度，穿舒适平底鞋"]);
  if (/果园|采摘|农庄|田园|农场/.test(n)) return pick(["采摘按季节开放，出发前确认果期", "农事体验适合亲子，注意防晒"]);
  if (/酒庄|酒窖|酒堡/.test(n)) return pick(["酒庄含品鉴环节，驾车请安排代驾", "酒庄多在郊区，返程留足时间"]);
  if (/湖|水库|池|潭/.test(n)) return pick(["环湖慢慢逛更舒服，傍晚光线最好", "湖区风大，早晚偏凉带件外套", "水岸景点，晴天拍照更出片"]);
  if (/江|河|溪|滨江|沿江/.test(n)) return pick(["江边风大，注意保暖与防滑", "沿江步道较长，挑一段慢慢走"]);
  if (/海|海滩|沙滩|湾|海岸/.test(n)) return pick(["海边紫外线强，防晒补水要到位", "下海注意警示旗与救生员指示", "海滩游玩注意潮汐，别走太远"]);
  if (/公园/.test(n)) return pick(["城市公园，适合散步慢逛", "公园绿地，早晚遛弯最舒服"]);
  return pick(["可灵活安排半天，按顺路顺序排即可", "当地去处，停留时长自己掌握"]);
}
// 占位文案 + 上一版 §9.6 生成的 18 条笼统说法，都属于「没有信息量」，全部升级重写
const NOTE_PLACEHOLDER = [
  "当地知名景点", "当地景区", "当地景点", "景点", "当地", "",
  "公园绿地，适合散步慢逛", "园林景观，早晚更舒服", "本地景点，可灵活安排半天",
  "当地去处，按顺路安排即可", "古街古镇，适合边逛边吃", "老街街区，慢慢走更有味",
  "自然景观，需步行或爬升", "山地峡谷景观，穿好走的鞋", "人文古迹，留意开放时间",
  "古建或宗教场所，着装得体", "水景，傍晚光线更好", "水岸景观，适合傍晚散步",
  "室内展馆，建议留 1-2 小时", "展馆类，室内为主，雨天可安排",
  "历史遗址，看点偏人文", "人文遗址，配讲解更值",
  "体验类项目，建议预留半天", "玩乐项目，人多时先预约"
];
let notePlaceholder = 0;
for (const c of base.CITIES) {
  for (const e of (c.experiences || [])) {
    if (!e || typeof e !== "object") continue;
    const t = String(e.note || "").trim();
    if (NOTE_PLACEHOLDER.indexOf(t) >= 0) {
      e.note = noteBySpotName(e.name);
      notePlaceholder++;
    }
  }
}
if (notePlaceholder) console.log("§9.6 占位备注改写:", notePlaceholder, "条");

// 6.4) 城市补丁（CITY_PATCH / CITY2PROV_ADD / PROVINCE_CITIES_ADD）
// 安全按 name upsert，不整体替换 CITIES（避开 merge-data-patch 的 CITIES_ADD 塌缩 bug）。
let cityPatch = {};
try { cityPatch = req("./tools/v202-hubei-cities.js") || {}; } catch (e) { /* 无城市补丁批次时跳过 */ }
// v203：真实坐标 + 省映射 + 有限数据层城市（echarts-china-cities-js@0.1.1 MIT，取各城 GeoJSON cp 中心点）。
// CITY_PATCH：328 个地级市登记为「有限数据层」可选目的地（experiences 留空，planner 优雅降级，
//   UI 标「内容收集中」）。合并进同一 cityPatch，沿用下方 §6.4 / §6.5 的统一应用与 PROVINCE_CITIES 同步。
try {
  const cp2 = req("./tools/v203-city-coords.js") || {};
  if (cp2.CITY_COORDS_ADD) cityPatch.CITY_COORDS_ADD = Object.assign(cityPatch.CITY_COORDS_ADD || {}, cp2.CITY_COORDS_ADD);
  if (cp2.CITY2PROV_ADD) cityPatch.CITY2PROV_ADD = Object.assign(cityPatch.CITY2PROV_ADD || {}, cp2.CITY2PROV_ADD);
  if (cp2.PROVINCE_CITIES_ADD) {
    cityPatch.PROVINCE_CITIES_ADD = cityPatch.PROVINCE_CITIES_ADD || {};
    for (const p in cp2.PROVINCE_CITIES_ADD) cityPatch.PROVINCE_CITIES_ADD[p] = (cityPatch.PROVINCE_CITIES_ADD[p] || []).concat(cp2.PROVINCE_CITIES_ADD[p]);
  }
  if (Array.isArray(cp2.CITY_PATCH)) {
    cityPatch.CITY_PATCH = (cityPatch.CITY_PATCH || []).concat(cp2.CITY_PATCH);
  }
} catch (e) { /* 无 v203 批次时跳过 */ }
// 安全门：城市补丁必须带 CITY_COORDS_ADD（真实坐标）才启用；只有名称/景点没坐标会破坏 G3/G5 护栏。
const cityPatchReady = !!(cityPatch.CITY_COORDS_ADD && Object.keys(cityPatch.CITY_COORDS_ADD).length);
if (!cityPatchReady) cityPatch = {};
if (cityPatch.CITY2PROV_ADD) {
  if (!base.CITY2PROV) base.CITY2PROV = {};
  for (const cn in cityPatch.CITY2PROV_ADD) base.CITY2PROV[cn] = cityPatch.CITY2PROV_ADD[cn];
}
if (cityPatch.PROVINCE_CITIES_ADD) {
  if (!base.PROVINCE_CITIES) base.PROVINCE_CITIES = {};
  for (const p in cityPatch.PROVINCE_CITIES_ADD) {
    if (!base.PROVINCE_CITIES[p]) base.PROVINCE_CITIES[p] = [];
    for (const c of cityPatch.PROVINCE_CITIES_ADD[p]) if (base.PROVINCE_CITIES[p].indexOf(c) < 0) base.PROVINCE_CITIES[p].push(c);
  }
}
if (Array.isArray(cityPatch.CITY_PATCH)) {
  for (const pc of cityPatch.CITY_PATCH) {
    if (!pc || !pc.name) continue;
    const hit = base.CITIES.find(c => c && c.name === pc.name);
    if (hit) Object.assign(hit, pc);
    else base.CITIES.push(pc);
  }
}
// 城市坐标（CITY_COORDS_ADD）→ base.CITY_COORDS；景点坐标（COORDS_ADD）→ base.SPOT_COORDS
if (cityPatch.CITY_COORDS_ADD) {
  if (!base.CITY_COORDS) base.CITY_COORDS = {};
  for (const cn in cityPatch.CITY_COORDS_ADD) base.CITY_COORDS[cn] = cityPatch.CITY_COORDS_ADD[cn];
}
if (cityPatch.COORDS_ADD) {
  if (!base.SPOT_COORDS) base.SPOT_COORDS = {};
  for (const cn in cityPatch.COORDS_ADD) {
    const arr = cityPatch.COORDS_ADD[cn] || [];
    if (!arr.length) continue;
    if (!Array.isArray(base.SPOT_COORDS[cn])) base.SPOT_COORDS[cn] = [];
    const seen = new Set(base.SPOT_COORDS[cn].map(x => x && x[0]));
    for (const e of arr) {
      if (!e || !e[0] || seen.has(e[0])) continue;
      seen.add(e[0]);
      base.SPOT_COORDS[cn].push([e[0], +Number(e[1]).toFixed(3), +Number(e[2]).toFixed(3)]);
    }
  }
}

// 6.5) CITY2PROV → PROVINCE_CITIES 同步
// 全省游按 PROVINCE_CITIES[省] 遍历城市找坐标。若某城只在 CITY2PROV 里、没进省列表，
// 省域扫描会漏掉它，进而落到「跨所有城市兜底」，把同名景点串到外省（实测：
// 都江堰 不在 四川 列表 → 四川查「普照寺」拿到山东泰安的坐标，导航差上千公里）。
// 这里每次 apply 都补齐，避免同类问题随数据扩容复发。
let provFixed = 0;
// 有限数据层城市（limited / 0 真实景点）不参与全省游：它们没有可排的真实内容，
// 一旦进 PROVINCE_CITIES 会让 buildProvincePlanDays 拉入空内容城市 → 触发「出发日期无效」。
// 它们仍通过 CITIES + citiesOf 增强在【单城目的地选择器】中出现（见 travel.js citiesOf）。
const _skipProv = new Set(base.CITIES.filter(c => c && (c.limited || (c.experiences || []).length === 0)).map(c => c.name));
for (const c in (base.CITY2PROV || {})) {
  if (_skipProv.has(c)) continue;
  const p = base.CITY2PROV[c];
  if (!p) continue;
  if (!base.PROVINCE_CITIES) base.PROVINCE_CITIES = {};
  if (!base.PROVINCE_CITIES[p]) base.PROVINCE_CITIES[p] = [];
  if (base.PROVINCE_CITIES[p].indexOf(c) < 0) { base.PROVINCE_CITIES[p].push(c); provFixed++; }
}
if (provFixed) console.log("PROVINCE_CITIES 补齐城市:", provFixed);

// 清理：PROVINCE_CITIES 只允许「标准短省名」（D.PROVINCES）key。
// 历史上 v203 曾用全名（河北省）写入，会在 §6.5 同步时生成重复 key，污染全省游并触发 buildProvPlan 报错。
// 这里删除一切非标准 key（如「河北省」），确保全省游只遍历真实短名省。
const _validProv = new Set((base.PROVINCES || []).concat(Object.keys(base.PROVINCE_CITIES || {}).filter(p => /^(北京|天津|上海|重庆|河北|山西|内蒙古|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆|台湾|香港|澳门)$/.test(p))));
let provPruned = 0;
for (const k of Object.keys(base.PROVINCE_CITIES || {})) {
  if (!_validProv.has(k)) { delete base.PROVINCE_CITIES[k]; provPruned++; }
}
if (provPruned) console.log("PROVINCE_CITIES 清理非标准 key:", provPruned);

// 6.6) 美食店铺并入（v199-food-shops.js 的 FOOD_SPOTS_ADD，高德真实餐饮 POI）
// 按「店名」去重，已有同城同名店则跳过，避免重复；只收有真实坐标的店（可导航）。
// v205 起：补丁可只含 {shop, menu, rep, note}（无坐标）——用于给已入库老店补「菜单/口碑/编辑点评」，
//   命中已有同名店则合并扩展字段（menu/rep/note，不覆盖已有、不重复追加），新店仍只收有真实坐标者。
let foodAdded = 0, foodMerged = 0;
for (const cn in foodShops) {
  const list = foodShops[cn];
  if (!Array.isArray(list) || !list.length) continue;
  if (!base.FOOD_SPOTS) base.FOOD_SPOTS = {};
  if (!Array.isArray(base.FOOD_SPOTS[cn])) base.FOOD_SPOTS[cn] = [];
  // 建索引：店名 → 已入库条目（用于扩展字段回写）
  const byName = {};
  for (const s of base.FOOD_SPOTS[cn]) { const n = String((s && (s.shop || s.name)) || "").trim(); if (n) byName[n] = s; }
  const seen = new Set(Object.keys(byName));
  for (const it of list) {
    if (!it) continue;
    const nm = String(it.shop || it.name || "").trim();
    if (!nm) continue;
    const hasCoord = typeof it.lat === "number" && typeof it.lon === "number";
    if (hasCoord) {
      // 真实新店（有坐标）：按店名去重跳过已有，否则入库
      if (seen.has(nm)) continue;
      seen.add(nm);
      const _new = { shop: nm, addr: it.addr || "", lat: it.lat, lon: it.lon, price: it.price || "" };
      base.FOOD_SPOTS[cn].push(_new);
      byName[nm] = _new;   // 注册，便于同批次后续扩展条目也能回写
      foodAdded++;
    } else {
      // 扩展补丁（无坐标）：命中已有同名店 → 回写 menu/rep/note（幂等，不覆盖已有）
      const ex = byName[nm];
      if (!ex) continue;
      let changed = false;
      if (Array.isArray(it.menu) && it.menu.length && !Array.isArray(ex.menu)) { ex.menu = it.menu; changed = true; }
      if (it.rep && !ex.rep) { ex.rep = it.rep; changed = true; }
      if (it.note && !ex.note) { ex.note = it.note; changed = true; }
      if (changed) foodMerged++;
    }
  }
}
if (foodAdded) console.log("美食店铺新增:", foodAdded);
if (foodMerged) console.log("美食店铺扩展字段合并(菜单/口碑/点评):", foodMerged);

// §6.7) 美食缺坐标回写（v206-food-coords.js 的 FOOD_COORDS_ADD）：
//   按「店名」匹配已入库美食店，仅当该店缺坐标时补入 lat/lon（不覆盖已有、幂等、不凭空造店）。
if (foodCoords && Object.keys(foodCoords).length) {
  let foodCoordSet = 0;
  for (const cn in foodCoords) {
    if (!base.FOOD_SPOTS || !Array.isArray(base.FOOD_SPOTS[cn])) continue;
    const byName = {};
    for (const s of base.FOOD_SPOTS[cn]) { const n = String((s && (s.shop || s.name)) || "").trim(); if (n) byName[n] = s; }
    for (const e of (foodCoords[cn] || [])) {
      const nm = String((e && e[0]) || "").trim();
      if (!nm) continue;
      const ex = byName[nm];
      if (!ex) continue;                                          // 找不到同名店 -> 跳过（不凭空造店）
      if (typeof ex.lat === "number" && typeof ex.lon === "number") continue;  // 已有坐标 -> 不动
      ex.lat = +e[1]; ex.lon = +e[2];
      foodCoordSet++;
    }
  }
  if (foodCoordSet) console.log("美食坐标回写:", foodCoordSet);
}

// §6.8) 酒店片区参考价区间（v207-rich-info.js 的 HOTEL_AREA_NOTES）：
//   按「城市+片区名」匹配 CITIES[].areas，补入 price（参考价区间）、追加 note。
//   不覆盖已有 note，仅在其后追加；片区名须与 base 完全一致（含中间点·）。
if (hotelNotes && Object.keys(hotelNotes).length) {
  let hotelNoteSet = 0;
  for (const cn in hotelNotes) {
    const city = (base.CITIES || []).find((c) => c.name === cn);
    if (!city || !Array.isArray(city.areas)) continue;
    const byName = {};
    for (const a of city.areas) { const n = String((a && a.name) || "").trim(); if (n) byName[n] = a; }
    for (const e of (hotelNotes[cn] || [])) {
      const nm = String((e && e.name) || "").trim();
      if (!nm) continue;
      const ex = byName[nm];
      if (!ex) continue;                              // 片区名不匹配 -> 跳过（不凭空造片区）
      if (e.price && !ex.price) ex.price = e.price;
      if (e.note) ex.note = (ex.note ? ex.note + "；" : "") + e.note;
      hotelNoteSet++;
    }
  }
  if (hotelNoteSet) console.log("酒店片区参考价/点评回写:", hotelNoteSet);
}

// §9.7 显示名精简（v204-name-clean.js 由 _gen-name-clean.mjs 自动生成）：
// 剥离冗余行政区划前缀（广州市白云山风景区 → 白云山风景区）+ 修双横线/多余右括号。
// ⚠️ 改名必须同步改 SPOT_COORDS 的坐标名与 SPOT_TICKETS/SPOT_DETAILS/SPOT_INFO 的键，
//    否则改名后这些景点会丢坐标（地图无 pin）且票价/介绍查不到（显示「—」）。
{
  let nameClean = {};
  try { nameClean = req("./tools/v204-name-clean.js") || {}; } catch (e) { /* 无补丁则跳过 */ }
  const EXP_RENAME = (nameClean && nameClean.EXP_RENAME) || {};
  const NAME_FIX = (nameClean && nameClean.NAME_FIX) || {};
  if (Object.keys(EXP_RENAME).length || Object.keys(NAME_FIX).length) {
    const mapByCity = {};
    for (const cn in EXP_RENAME) for (const r of EXP_RENAME[cn]) {
      if (!r || !r.from || !r.to) continue;
      if (!mapByCity[cn]) mapByCity[cn] = {};
      mapByCity[cn][r.from] = r.to;
    }
    for (const key in NAME_FIX) {
      const i = key.indexOf("|");
      if (i < 0) continue;
      const cn = key.slice(0, i), from = key.slice(i + 1);
      if (!mapByCity[cn]) mapByCity[cn] = {};
      mapByCity[cn][from] = NAME_FIX[key];
    }
    // 全局字典改名只在「同一 old 名目标一致」时进行，跨城冲突则跳过（宁可不改也不错改）
    const gmap = {}, conflict = new Set();
    for (const cn in mapByCity) for (const from in mapByCity[cn]) {
      const to = mapByCity[cn][from];
      if (gmap[from] && gmap[from] !== to) conflict.add(from);
      else gmap[from] = to;
    }
    let renamed = 0, coordRenamed = 0, dictRenamed = 0, guardSkip = 0;
    for (const c of base.CITIES) {
      const m = mapByCity[c.name];
      if (!m) continue;
      const exps = c.experiences || [];
      for (const e of exps) {
        if (!e || !e.name) continue;
        const to = m[e.name];
        if (!to) continue;
        // 守卫：目标名已被「其他条目」占用即放弃——含本轮改名刚产生的占用。
        // （旧实现用改名前快照 owners.has(to) 联合判断，拦不住本轮改名自身造成的重名，
        //   会让同城重复副本每轮 +11；改为只看实时占用 used 才能真正幂等。宁可不改也不错改。）
        let used = false;
        for (const x of exps) { if (x !== e && String((x && (x.name || x.t)) || "") === to) { used = true; break; } }
        if (used) { guardSkip++; continue; }
        e.name = to; if (e.t) e.t = to;
        renamed++;
      }
      const cl = base.SPOT_COORDS && base.SPOT_COORDS[c.name];
      if (Array.isArray(cl)) for (const it of cl) if (it && it[0] && m[it[0]]) { it[0] = m[it[0]]; coordRenamed++; }
    }
    const renameDict = (dict) => {
      if (!dict || typeof dict !== "object") return;
      for (const from in gmap) {
        if (conflict.has(from) || !gmap[from]) continue;
        if (Object.prototype.hasOwnProperty.call(dict, from) && !dict[gmap[from]]) { dict[gmap[from]] = dict[from]; delete dict[from]; dictRenamed++; }
      }
    };
    renameDict(base.SPOT_TICKETS); renameDict(base.SPOT_DETAILS); renameDict(base.SPOT_INFO);
    console.log("§9.7 名称精简:", renamed, "| 坐标键同步:", coordRenamed, "| 字典键同步:", dictRenamed, "| 重名守卫放弃:", guardSkip);
  }
}

// §9.8 改名残留去重（幂等）：若某城同时存在「旧名」和「改名后的新名」两条（同一景点被追加了两次），删旧名那条。
// 触发场景：v204 改名后，v198/v200 的旧名条目在下一轮被当新条目重复追加（实测一次 +1808 条）。
{
  let removedDup = 0;
  for (const c of base.CITIES) {
    const m = RENAME[c.name];
    if (!m) continue;
    const exps = c.experiences;
    if (!Array.isArray(exps) || !exps.length) continue;
    const names = new Set(exps.map(e => String((e && e.name) || "")));
    const keep = [];
    for (const e of exps) {
      const n = String((e && e.name) || "");
      const to = m[n];
      // 旧名：改名后的新名已存在 → 丢掉旧名
      if (to && names.has(to)) { removedDup++; continue; }
      keep.push(e);
    }
    if (keep.length !== exps.length) c.experiences = keep;
  }
  if (removedDup) console.log("§9.8 改名残留去重移除:", removedDup);
}

// §9.9 城市维度离线简介（SPOT_DETAILS_BY_CITY）：通用名（公园/广场/博物馆…）多城同名，
// 不能进扁平 SPOT_DETAILS（会跨城误配），故按「城市 → 景点」收纳。spotLookup 优先按 cityName
// 在本市精确/子串命中，杜绝跨城误配；命中返回比 experiences.note 更丰富的简介。
// ⚠️ 2MB 分包硬上限：原始 JSON 受控（BYC_BUDGET），超出按「城市 → 体验」稳定顺序截断，绝不撑爆包。
{
  // 每轮从零重建（BYC 由 experiences 纯生成、幂等；避免历史残留累积撑爆包）
  base.SPOT_DETAILS_BY_CITY = {};
  const BYC = base.SPOT_DETAILS_BY_CITY;
  const flat = base.SPOT_DETAILS || {};
  const GEN = /公园|广场|博物馆|博物院|美术馆|纪念馆|展览馆|科技馆|图书馆|老街|古街|步行街|商业街|街区|巷|胡同|古镇|古村|古城|寺|庙|庵|道观|教堂|清真寺|遗址|故居|旧址|陵园|陵|墓|塔|楼|阁|城墙|城门|桥|园林|动物园|植物园|海洋馆|水族馆|乐园|滑雪|漂流|湿地|森林|峡谷|瀑布|草原|沙漠|梯田|溶洞|温泉|岛|湖|江|河|海|沙滩|海滩|湾|山|峰|岭|长城|观景台|夜市|市集|非遗|文创|体育|码头|雕塑|花海|茶园|果园|酒庄/;
  // richer 简介：在 §9.6 noteBySpotName 基础上追加一句通用实用尾注（按名哈希轮换，避免千篇一律；
  // 尾注/模板重复率极高，deflate 后几乎压成 0，by-city 体积由唯一键主导，故可安全多收）。
  const richerIntro = (nm) => {
    const base0 = noteBySpotName(nm);
    let h = 0; for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) >>> 0;
    const tail = ["。建议预留半天，按顺路顺序游览即可。", "。出发前查好开放时间与预约要求，避开高峰更舒服。", "。适合慢逛，结合周边景点串成一条线更高效。"][h % 3];
    return base0 + tail;
  };
  // 过滤行程合并名（「X + Y」「X→Y」「X／Y」等），它们不是真实景点名，会让子串匹配误配
  const _isMerged = (nm) => nm.indexOf(" + ") >= 0 || nm.indexOf("→") >= 0 || nm.indexOf("／") >= 0 || nm.indexOf("｜") >= 0;
  const BYC_BUDGET = 1200 * 1024;         // 原始 JSON 预算（v1.19.37：CITY_LANDMARKS_EXTRA 去重省 ~106KB 后放量；1200KB raw ≈ 压缩后 ~260KB，subdata 仍守 2MB 红线余量）
  let sizeEst = JSON.stringify(BYC).length;
  let added = 0, capped = false;
  outer:
  for (const c of base.CITIES) {
    const cn = c.name;
    if (!BYC[cn]) BYC[cn] = {};
    const cityMap = BYC[cn];
    for (const e of (c.experiences || [])) {
      const nm = (e && e.name) || "";
      if (!nm || _isMerged(nm) || flat[nm] || cityMap[nm]) continue;   // 已入扁平（唯一名）/ 合并名 / 已生成 → 跳过
      if (!GEN.test(nm)) continue;                     // 只收通用名；唯一名靠 v211+ 手写批次
      const obj = { intro: richerIntro(nm), how: "可乘地铁或公交至邻近站点，用地图导航到景区入口最稳妥。" };
      if (sizeEst + nm.length + JSON.stringify(obj).length + 6 > BYC_BUDGET) { capped = true; break outer; }
      cityMap[nm] = obj;
      sizeEst += nm.length + JSON.stringify(obj).length + 6;
      added++;
    }
  }
  console.log("§9.9 SPOT_DETAILS_BY_CITY 新增:", added, "| 城市数:", Object.keys(BYC).length, capped ? "(达体积上限截断)" : "");
}

// §9.10 真实景点资料卡（SPOT_CARDS_BY_CITY）—— v1.20.6 离线资料扩容
// 目标：把散在 6 张表里的「同一景点真实字段」聚合成一条可直接展示的档案，
//       让行程页「百科」从「一句短标签 + 两家不相关名店」升级为「看点 + 省份城市 + 评分 + 门票 + 坐标」。
// 真实性铁律：
//   · 字段一律取自本包已入库的真实数据（experiences.note / SPOT_INFO.rating / SPOT_TICKETS.p / SPOT_COORDS / CITY2PROV）；
//   · 绝不生成任何新事实、绝不把 §9.9 的类型化模板文案（SPOT_DETAILS_BY_CITY）写进资料卡；
//   · 通用名按「城市 → 景点」索引，杜绝跨城误配；行程合并名（X + Y）不是单点，排除。
// 形状：CARDS[城市][景名] = [note, rating, price, lat, lon]，缺失字段用 ""。
// 体积：按「每城轮转」稳定取 CARD_LIMIT 条，保证全国 400+ 城均匀覆盖，不撑爆数据分包。
{
  base.SPOT_CARDS_BY_CITY = {};
  const CARDS = base.SPOT_CARDS_BY_CITY;
  const CARD_LIMIT = 6000;                 // 用户要求 ≥5000，留 1000 余量
  const isMergedCard = (nm) => nm.indexOf(" + ") >= 0 || nm.indexOf("→") >= 0 || nm.indexOf("／") >= 0 || nm.indexOf("｜") >= 0;
  // 坐标索引：城市 → 景名 → [lat, lon]
  const coordIdx = {};
  for (const cn in (base.SPOT_COORDS || {})) {
    const m = {};
    for (const e of (base.SPOT_COORDS[cn] || [])) {
      if (!Array.isArray(e) || typeof e[0] !== "string") continue;
      if (typeof e[1] === "number" && typeof e[2] === "number" && e[1] && e[2]) m[e[0]] = [e[1], e[2]];
    }
    if (Object.keys(m).length) coordIdx[cn] = m;
  }
  const TICKETS = base.SPOT_TICKETS || {}, INFO = base.SPOT_INFO || {};
  // §9.9 的类型化模板文案不是真实看点，绝不写进资料卡（门禁会复扫）
  const CARD_TPL = /结合周边景点串成一条线|可乘地铁或公交至邻近站点|用地图导航到景区入口最稳妥|适合慢逛|避开高峰更舒服|建议预留半天/;
  // 每城候选，按「真实结构化字段数」降序（同分保持原始顺序，保证幂等）
  const buckets = [];
  for (const c of base.CITIES) {
    const cn = c.name;
    const bucket = [];
    for (const e of (c.experiences || [])) {
      const nm = String((e && e.name) || "").trim();
      if (!nm || nm.length < 2 || isMergedCard(nm)) continue;
      const note0 = String((e && e.note) || "").trim();
      const note = CARD_TPL.test(note0) ? "" : note0;
      const rating = String((INFO[nm] && INFO[nm].rating) || "").trim();
      const tk = TICKETS[nm];
      const price = String((tk && (tk.p || tk.text)) || "").trim();
      const cd = (coordIdx[cn] || {})[nm];
      if (!rating && !price && !cd) continue;   // 必须至少一项结构化真实字段，杜绝空壳卡
      // 已有策展正文的具名景点加权优先入卡（它们信息价值最高，不该被 round-robin 截断漏掉）
      const curated = (base.SPOT_DETAILS && base.SPOT_DETAILS[nm]) ? 2 : 0;
      const weight = (note ? 1 : 0) + (rating ? 2 : 0) + (price ? 2 : 0) + (cd ? 2 : 0) + curated;
      if (weight < 2) continue;
      bucket.push({ nm, w: weight, card: [note, rating, price, cd ? cd[0] : "", cd ? cd[1] : ""] });
    }
    if (bucket.length) {
      bucket.sort((a, b) => b.w - a.w);
      buckets.push({ cn, list: bucket, i: 0 });
    }
  }
  // round-robin：每轮从每城取 1 条，直到达到上限 → 全国均匀，不会只堆热门城市
  let addedCard = 0;
  for (let round = 0; round < 1000 && addedCard < CARD_LIMIT; round++) {
    let progressed = false;
    for (const b of buckets) {
      if (addedCard >= CARD_LIMIT) break;
      if (b.i >= b.list.length) continue;
      const it = b.list[b.i++];
      if (!CARDS[b.cn]) CARDS[b.cn] = {};
      CARDS[b.cn][it.nm] = it.card;
      addedCard++; progressed = true;
    }
    if (!progressed) break;
  }
  console.log("§9.10 SPOT_CARDS_BY_CITY 真实资料卡:", addedCard, "| 覆盖城市:", Object.keys(CARDS).length);
}

// 7) 写出
const json = JSON.stringify(base);
fs.writeFileSync("utils/data.js", "// 由 _apply-safe.mjs 生成（base=data-packed.js 11,690 + 增量补丁）\nmodule.exports = " + json + ";\n");
exp = 0; let low = 0;
for (const c of base.CITIES) { const n = (c.experiences || []).length; exp += n; if (n < 14) low++; }
console.log("✅ 写出 data.js | experiences:", exp, "| cities<14:", low, "| 字节:", json.length);
