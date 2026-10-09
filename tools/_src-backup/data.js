// v1.20 数据拆分包：data-packed.js（约 1.4MB base64）已移入 subdata/data/，
// 主包不再携带这份大头。微信端用 require.async 异步加载；Node（allcheck/工具链）同步读分包文件。
// 页面侧统一在 travel.js 的 ready() 之后使用数据；planner.js 因模块顶层解构 data.js，
// 由 travel.js 惰性 require（数据就绪后才加载），避免拿到空数据。
const pako = require("./pako-inflate.js");

const DATA = {
  CITIES: [], SPOT_COORDS: {}, CITY_COORDS: {}, PROVINCE_CITIES: {}, PROVINCES: [],
  CITY2PROV: {}, SPOT_INFO: {}, FOOD_SPOTS: {}, GENERIC_SPOT_WORDS: [], BUDGETS: {}, BUDGET_STYLE: {},
  BIG_SPOT_DAYS: [], SUNRISE_SPOTS: [], PREP_CHECKLIST: []
};
DATA.__dataReady = false;

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
  DATA.__dataReady = true;
  return DATA;
}

// 数据分块路径解析（v1.20.x 多数据分包）：
//  - 测试态：DATA_CHUNKS 环境变量注入逗号分隔的自定义多块路径（_test-multichunk 用）
//  - 微信生产：读 subdata/data/_manifest.js（由 tools/pack-data.mjs 生成，列出全部数据分块相对路径）
//  - 兜底：单个默认分块
function resolveChunkPaths() {
  if (process.env.DATA_CHUNKS) {
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
