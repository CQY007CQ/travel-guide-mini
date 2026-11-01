// v1.20 数据拆分包：data-packed.js（约 1.4MB base64）已移入 subdata/data/，
// 主包不再携带这份大头。微信端用 require.async 异步加载；Node（allcheck/工具链）同步读分包文件。
// 页面侧统一在 travel.js 的 ready() 之后使用数据；planner.js 因模块顶层解构 data.js，
// 由 travel.js 惰性 require（数据就绪后才加载），避免拿到空数据。
const pako = require("./pako-inflate.js");
// v1.19.171 扩展酒店住宿区域：额外的「城市级住哪儿区域指引」静态数据，加载时并入 CITIES[].areas。
// 与 data.js 同目录（utils/），不被 build-min 压缩；try/catch 保证缺失时不影响数据加载。
let HA = {};
try { HA = require("./hotel-areas.js"); } catch (e) { HA = {}; }

const DATA = {
  CITIES: [], SPOT_COORDS: {}, CITY_COORDS: {}, PROVINCE_CITIES: {}, PROVINCES: [],
  CITY2PROV: {}, SPOT_INFO: {}, FOOD_SPOTS: {}, GENERIC_SPOT_WORDS: [], BUDGETS: {}, BUDGET_STYLE: {},
  BIG_SPOT_DAYS: [], SUNRISE_SPOTS: [], PREP_CHECKLIST: []
};
DATA.__dataReady = false;

// v1.19.166 坐标修正覆盖层：修正若干被误地理编码的景点。
// 这些景点原坐标落在别的城市/省份，距所属城市中心 98~1116km，明显错误（地图标点错位、行程距离计算失真）。
// 覆盖在 applyPacked 之后、对所有消费方（行程生成/地图/景点检索）统一生效；不改动打包基数据，零重打包风险。
// 坐标均为各景点所属城市内的合理落点（SAR/小城 ±1km 级、漠河远郊也落在正确县域），远优于原 100~1100km 错位。
const SPOT_COORD_FIX = {
  "澳门": {
    "郑家大屋": [22.1906, 113.5385],   // 亚婆井前地·岗顶，原 [31.413,109.071] 落到湖北/重庆
    "北帝庙": [22.1975, 113.5410],     // 澳门半岛（大三巴/大炮台一带），原 [23.891,112.876] 落到广东清远
    "海事博物馆": [22.1819, 113.5319]  // 妈阁庙前地，原 [23.079,113.505] 落到广东广州
  },
  "香港": {
    "大澳渔村": [22.2526, 113.8636],   // 大屿山·大澳，原坐标落到广东阳江（209km）
    "大馆": [22.2820, 114.1540]        // 中环·大馆（荷李活道），原坐标落到广东清远（170km）
  },
  "漠河": {
    "黑龙江源头": [53.480, 121.480],    // 漠河西北·龙江第一湾/源头，原 [45.742,126.662] 落到牡丹江/延边（857km）
    "北极林海观音": [53.294, 122.204]  // 漠河观音山一带，原 [48.446,129.441] 落到佳木斯（698km）
  }
};
function applyCoordFix() {
  for (const city in SPOT_COORD_FIX) {
    const list = DATA.SPOT_COORDS[city];
    if (!Array.isArray(list)) continue;
    const m = SPOT_COORD_FIX[city];
    for (const row of list) {
      if (Array.isArray(row) && m[row[0]]) { row[1] = m[row[0]][0]; row[2] = m[row[0]][1]; }
    }
  }
}

// v1.19.172 模糊 POI 坐标补录：纳林湖 / 网师园 / 九凌湖 / 新寨嘉那嘛呢石经城 此前因 geocode 30001（POI 非地址）
// 整体跳过、长期挂在「已知未解」。现以公开权威坐标（腾讯/高德/维基/政府文档交叉确认）经城市归属校验后补入，
// 使地图/检索/行程引用时落到真实位置而非城市中心。仅补坐标（不编造景点文案、不擅自塞进行程库），
// 符合本项目「只加经核实数据、勿臆造」铁律。广化寺（莆田/北京重名）、石龙山（多地重名）因名称歧义、无法唯一归属，按「勿臆造」跳过。
const SPOT_COORD_ADD = [
  ["巴彦淖尔", "纳林湖", 40.532227, 106.64907],
  ["苏州", "网师园", 31.298021, 120.633654],
  ["贵港", "九凌湖", 22.966533, 109.474596],
  ["玉树", "新寨嘉那嘛呢石经城", 33.018206, 97.059472]
];
let _spotCoordAdded = 0;
function applySpotCoordAdd() {
  for (const [city, name, lat, lon] of SPOT_COORD_ADD) {
    if (!DATA.SPOT_COORDS[city]) DATA.SPOT_COORDS[city] = [];
    const arr = DATA.SPOT_COORDS[city];
    if (arr.some(r => r[0] === name)) continue; // 幂等：已存在不重复加（多分块重复调用安全）
    arr.push([name, lat, lon]);
    _spotCoordAdded++;
  }
  if (_spotCoordAdded) console.warn("[data] 模糊 POI 坐标补录 " + _spotCoordAdded + " 个");
}

// v1.19.167 景点去重：同城 SPOT_COORDS 内出现完全同名的重复副本（仙桃/天门/潜江 等，
// 单城同一景点被录入 41 次、坐标完全一致），导致地图/行程中同一景点重复出现 40+ 次。
// 加载时按「城市 + 景点名 + 坐标」去重，仅移除逐字节相同的副本、保留首个，零信息损失。
let _dedupRemoved = 0;
function dedupeSpots() {
  for (const city in DATA.SPOT_COORDS) {
    const list = DATA.SPOT_COORDS[city];
    if (!Array.isArray(list)) continue;
    const seen = Object.create(null);
    const out = [];
    for (const row of list) {
      if (!Array.isArray(row)) { out.push(row); continue; }
      const key = JSON.stringify([row[0], row[1], row[2]]);
      if (seen[key]) { _dedupRemoved++; continue; }
      seen[key] = 1; out.push(row);
    }
    DATA.SPOT_COORDS[city] = out;
  }
  if (_dedupRemoved) console.warn("[data] 同城重复景点去重移除 " + _dedupRemoved + " 条副本");
}

// v1.19.169 气候派生补齐 best 季节字段：打包基数据里部分城市缺 best（约 331 城），
// 导致「适宜时节 / 最佳季 / 今日正当时」对这批城只能回退到泛化的「四季皆宜」，推荐信息稀薄。
// 按气候带给出稳定的季节描述（离线、确定性、可复现），调高推荐信息密度，不触碰打包基数据（零重打包风险）。
// 月份写法沿用 bestMonths 解析约定（"5-10月" 区间、"11-次年4月" 跨年），让「今日正当时」能正确命中。
const BEST_BY_CLIMATE = {
  plateau: "5-10月最佳，夏季凉爽宜避暑",
  temperate: "4-5月与9-10月，春秋气候宜人",
  cold: "冬季冰雪与夏季避暑，12-2月、6-8月",
  dry: "春秋最佳，4-5月、9-10月避开酷暑风沙",
  hot: "春、秋最舒适，3-5月、9-11月避开盛夏",
  tropical: "11-次年4月旱季最佳，避开雨季",
  subtropical: "3-5月与10-11月，春秋舒适",
  alpine: "6-9月宜游，冬季雪景壮美",
  temperate_continental: "6-9月温暖少风，最佳出行期"
};
let _bestFilled = 0;
function fillBestSeason() {
  for (const c of DATA.CITIES) {
    if (!c || c.best) continue;
    const v = BEST_BY_CLIMATE[c.climate] || BEST_BY_CLIMATE["temperate"];
    if (v) { c.best = v; _bestFilled++; }
  }
  if (_bestFilled) console.warn("[data] 气候派生补齐 best 季节字段 " + _bestFilled + " 城");
}

// v1.19.171 扩展酒店住宿区域：把 utils/hotel-areas.js 的 HOTEL_AREAS_EXTRA（约 60 个热门旅游城市，
// 每城 3-4 个「商圈/地标/交通枢纽」住哪儿区域指引，含参考价区间）按城市名并入 CITIES[].areas，
// 既给 46 城精选区「追加更多选择」，又把覆盖扩到更多旅游城市（原本走通用三片区）。
// 合规：区域级指引，不臆造酒店门牌号；价格一律「参考价区间」，非实时报价、非交易。
// 幂等：按片区名去重，多数据分块重复调用 applyPacked 也不会重复追加。
let _hotelAreasMerged = 0;
function applyHotelAreasExtra() {
  const EX = (HA && HA.HOTEL_AREAS_EXTRA) || {};
  const keys = Object.keys(EX);
  if (!keys.length) return;
  for (const c of DATA.CITIES) {
    const ex = EX[c.name];
    if (!ex || !Array.isArray(ex) || !ex.length) continue;
    if (!Array.isArray(c.areas)) c.areas = [];
    const have = new Set(c.areas.map(a => (a && a.name) || ""));
    for (const a of ex) {
      if (a && a.name && !have.has(a.name)) {
        c.areas.push({ name: a.name, note: a.note || "", price: a.price || "" });
        have.add(a.name); _hotelAreasMerged++;
      }
    }
  }
  if (_hotelAreasMerged) console.warn("[data] 扩展酒店住宿区域并入 " + _hotelAreasMerged + " 条");
}

function b64ToBytes(b64) {
  try {
    if (typeof wx !== "undefined" && wx.base64ToArrayBuffer) {
      return new Uint8Array(wx.base64ToArrayBuffer(b64));
    }
  } catch (e) {}
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(b64 || "").replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor(s.length * 3 / 4) + 2);
  let p = 0;
  for (let i = 0; i < s.length; i += 4) {
    const rem = s.length - i;
    const a = chars.indexOf(s[i]);
    const b = rem > 1 ? chars.indexOf(s[i + 1]) : 0;
    const c = rem > 2 ? chars.indexOf(s[i + 2]) : -1;
    const d = rem > 3 ? chars.indexOf(s[i + 3]) : -1;
    const n = ((a & 63) << 18) | ((b & 63) << 12) | ((c < 0 ? 0 : c & 63) << 6) | (d < 0 ? 0 : d & 63);
    out[p++] = (n >> 16) & 255;
    if (c >= 0) out[p++] = (n >> 8) & 255;
    if (d >= 0) out[p++] = n & 255;
  }
  return out.subarray(0, p);
}
function utf8Decode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 0x80) out.push(b1);
    else if (b1 < 0xe0) out.push(((b1 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b1 < 0xf0) out.push(((b1 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b1 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      out.push(0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff));
    }
  }
  let s = "";
  const CH = 8192;
  for (let k = 0; k < out.length; k += CH) s += String.fromCharCode.apply(null, out.slice(k, k + CH));
  return s;
}

// v1.20.x：支持「多数据分包」——把城市数据切成多个 chunk 文件（subdata/subdata2…），
// 各自独立 2MB 上限、懒加载。合并语义：对象键按城市名并集、数组去重拼接、其余覆盖。
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function mergeInto(target, src) {
  for (const k of Object.keys(src)) {
    const sv = src[k], tv = target[k];
    if (isObj(sv) && isObj(tv)) mergeInto(tv, sv);
    else if (Array.isArray(sv) && Array.isArray(tv)) {
      const seen = new Set(tv.map(x => JSON.stringify(x)));
      for (const it of sv) { const j = JSON.stringify(it); if (!seen.has(j)) { tv.push(it); seen.add(j); } }
    } else target[k] = sv;
  }
  return target;
}
// v1.20.x 键别名还原：打包时 tools/pack-data.mjs 把高频 schema 键别名成 "@X"（如 name→@A），
// 并在「每个」数据分块内附带正向映射 __A。加载时据此把短键还原为长键，运行时(planner.js/travel.js)
// 完全无感、无需改动。每块独立还原，故多分包也安全。
function _invertKeyMap(map) { const inv = {}; for (const k in map) inv[map[k]] = k; return inv; }
function _expandAliasKeys(o, inv) {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) _expandAliasKeys(o[i], inv); return; }
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      if (k === "__A") continue;
      const v = o[k];
      if (Object.prototype.hasOwnProperty.call(inv, k)) { const nk = inv[k]; o[nk] = v; delete o[k]; _expandAliasKeys(v, inv); }
      else _expandAliasKeys(v, inv);
    }
  }
}
function applyPacked(packed) {
  const parsed = JSON.parse(utf8Decode(pako.inflate(b64ToBytes(packed))));
  if (parsed && parsed.__A) {
    _expandAliasKeys(parsed, _invertKeyMap(parsed.__A));
    delete parsed.__A;
  }
  mergeInto(DATA, parsed);
  applyCoordFix();
  applySpotCoordAdd();
  dedupeSpots();
  fillBestSeason();
  applyHotelAreasExtra();
  DATA.__dataReady = true;
  return DATA;
}

// 数据分块路径解析（v1.20.x 多数据分包）：
//  - 测试态：DATA_CHUNKS 环境变量注入逗号分隔的自定义多块路径（_test-multichunk 用）
//  - 微信生产：读 subdata/data/_manifest.js（由 tools/pack-data.mjs 生成，列出全部数据分块相对路径）
//  - 兜底：单个默认分块
function resolveChunkPaths() {
  if (typeof process !== "undefined" && process.env && process.env.DATA_CHUNKS) {
    return process.env.DATA_CHUNKS.split(",").map(s => s.trim()).filter(Boolean);
  }
  try {
    const manifest = require("../subdata/data/_manifest.js");
    if (Array.isArray(manifest) && manifest.length) return manifest;
  } catch (e) {}
  return ["../subdata/data/data-packed.js"];
}
const CHUNK_PATHS = resolveChunkPaths();

// ⚠️✖️ 微信「分包异步化」硬约束（= 线上首页白屏 / 「无法加载完整数据内容」的真根因）：
//   require.async() 的实参必须是「唯一的静态字符串字面量」，**不能是变量**！
//   传变量时微信无法在编译/运行期解析目标分包 → 数据块永远不加载 →
//   首页拿不到城市数据 → 白屏（审核实测复现）。
//   故此处必须把每个数据分块的路径「逐条字面量」直接写出，禁止 for 循环拼接变量。
//   分块数变化时须同步增删下面这几条；tools/pack-data.mjs 内置断言会在
//   「产物分块」与「此处字面量」不一致时直接 fail-fast，防止再次退化成变量。
// 限时推进：分包下载卡住时不把 ready() 拖死（到点先返回；晚到的分块仍会自行 applyPacked）
function _sleep(ms) { return new Promise((r) => { try { setTimeout(r, ms); } catch (e) { r(); } }); }

let _ready = null;
let _loadErr = false; // v1.19.60：上次加载有失败分块 → 允许再次 initData 重试（供首页「重试加载」）
function initData() {
  if (_ready && !_loadErr) return _ready;
  _ready = (async () => {
    let lastErr = null;
    if (typeof require.async === "function") {
      // 微信端：分包异步化。↓↓↓ 每条都必须是静态字面量（勿用变量）↓↓↓
      // v1.19.64：先给每条挂 applyPacked（无论多晚拿到都应用，绝不丢数据），
      // 再用 Promise.race 限时推进 —— 分包慢/卡时也不至于让 ready() 永不 resolve（黑屏）。
      const _jobs = [
        require.async("../subdata/data/data-packed.js").then((m) => { applyPacked((m && m.default) || m); }).catch((e) => { lastErr = e; }),
        require.async("../subdata2/data/data-packed2.js").then((m) => { applyPacked((m && m.default) || m); }).catch((e) => { lastErr = e; })
      ];
      await Promise.race([Promise.all(_jobs), _sleep(9000)]);
      // 若数据被拆到 subdata3…：在此按同样一行格式再追加一条字面量。
    } else {
      // Node / 测试端：无 require.async，直接同步 require（可用变量；微信那条约束不适用）
      for (const p of CHUNK_PATHS) {
        try { applyPacked(require(p)); } catch (e) { lastErr = e; }
      }
    }
    _loadErr = !!lastErr;
    DATA.__dataReady = true;
    if (lastErr && typeof console !== "undefined" && console.warn) console.warn("[data] 数据分块加载失败:", lastErr && lastErr.message);
    return DATA;
  })();
  return _ready;
}
DATA.initData = initData;

// Node / 测试环境（没有 require.async）：模块加载即同步就绪，保证 allcheck/tools 照常同步 require
if (typeof require.async !== "function") {
  for (const p of CHUNK_PATHS) {
    try { applyPacked(require(p)); } catch (e) { /* 数据缺失时保留空兜底 */ }
  }
  DATA.__dataReady = true;
}

module.exports = DATA;
