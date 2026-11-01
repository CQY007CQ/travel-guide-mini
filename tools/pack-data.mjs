// v1.17 数据打包工具：把 utils/data.js（明文）压缩成 subdata/data/data-packed.js（v1.20 起数据移入分包，v1.19.36 拆到独立 subdata 包腾 2MB 空间）
// 背景：data.js 原文 1342KB（中文 UTF-8 占 3 字节），deflate+base64 后仅 555KB，主包省约 790KB。
// 用法（数据更新后务必重跑）：
//   node tools/pack-data.mjs
// 之后跑 ./allcheck.sh 验证解压正常。
// v1.20.x：支持「多数据分包」。当压缩后单块逼近 2MB 包上限时，自动把数据切成多个 chunk，
// 分别写入 subdata/subdata2/subdata3（各自独立 2MB 上限），并生成 subdata/data/_manifest.js 列出分块路径；
// utils/data.js 在微信端按 manifest 懒加载全部分块并用 mergeInto 深合并（同键并集 / 数组去重拼接 / 其余覆盖）。
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");

const D = req("./utils/data.js");

// ── v1.19.174 打包期坐标完整性硬门禁 ─────────────────────────────────
// 复用加载期同款 checkCoordIntegrity()（v1.19.156 规则：距城心>300km且跨省 或 >1200km），
// D 此刻已是「SPOT_COORD_FIX 等覆盖层生效后的最终数据」，故 7 个历史误编码已被修正、不会误报；
// 若检出越界，说明出现了「未被 SPOT_COORD_FIX 覆盖的新坐标回归」——直接中止打包，
// 强制开发者先加入 SPOT_COORD_FIX 再重打包，把坐标回归从「上线后告警」前移到「打包即拦截」。
{
  const _bad = D.checkCoordIntegrity();
  if (_bad > 0) {
    console.error("❌ 打包期坐标完整性门禁失败：发现 " + _bad + " 个越界坐标（未被 SPOT_COORD_FIX 覆盖的新回归），请修正数据或补充 SPOT_COORD_FIX 后重打包");
    process.exit(1);
  }
  console.log("✓ 打包期坐标完整性门禁通过");
}

// ── v1.19.55: JSON 键别名压缩（无损）────────────────────────────────
// 仅别名高频 schema 键（出现次数>=MIN_ALIAS_FREQ 且长度>2），数据名键（公园/餐厅/城市名等）保持原样。
// 每个分块 blob 内附带正向映射 __A；加载器(data.js) 据此还原，无需双文件同步。
// 打包前做 round-trip 断言：别名化+还原后必须 === 原数据，否则中止（保证绝不损坏数据）。
function _collectKeys(o, freq) {
  if (Array.isArray(o)) { for (const x of o) _collectKeys(x, freq); return; }
  if (o && typeof o === "object") { for (const k of Object.keys(o)) { freq[k] = (freq[k] || 0) + 1; _collectKeys(o[k], freq); } }
}
function _buildKeyMap(D) {
  const freq = {}; _collectKeys(D, freq);
  const MIN = 50;
  const cand = Object.keys(freq).filter(k => freq[k] >= MIN && k.length > 2 && k !== "__A");
  cand.sort((a, b) => freq[b] - freq[a]);
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+=";
  const existing = new Set(Object.keys(freq)); // 数据里已存在的全部键（含 v1.20 CITIES 压缩键 @A/@M/…），避免别名目标冲突
  const map = {};
  let ai = 0;
  for (const k of cand) {
    // 找到一个不与数据中已有键冲突的别名目标；若冲突会令 rename 覆盖真实键、导致 round-trip 失配、打包中止
    while (ai < ALPHA.length) {
      const alias = "@" + ALPHA[ai]; ai++;
      if (!existing.has(alias)) { map[k] = alias; break; }
    }
    if (ai >= ALPHA.length) break; // 别名池用尽，剩余高频键保留原名（仅体积略增，绝不损坏数据）
  }
  return map; // long -> short
}
function _renameKeys(o, map) {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) _renameKeys(o[i], map); return; }
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === "__A") continue;
      if (Object.prototype.hasOwnProperty.call(map, k)) { const nk = map[k]; o[nk] = v; delete o[k]; _renameKeys(v, map); }
      else _renameKeys(v, map);
    }
  }
}
function _invert(map) { const inv = {}; for (const k in map) inv[map[k]] = k; return inv; }
function _expandKeys(o, inv) {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) _expandKeys(o[i], inv); return; }
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === "__A") continue;
      if (Object.prototype.hasOwnProperty.call(inv, k)) { const nk = inv[k]; o[nk] = v; delete o[k]; _expandKeys(v, inv); }
      else _expandKeys(v, inv);
    }
  }
}
// 规范化为「键排序」的稳定形态：delete+add 会改变对象键顺序，JSON.stringify 因而失配；
// 但运行时只按键名取值、不依赖顺序，故用排序后的深比较做 round-trip 断言（更严格、可捕获真实损坏）。
function _canon(o) {
  if (Array.isArray(o)) return o.map(_canon);
  if (o && typeof o === "object") {
    const r = {};
    for (const k of Object.keys(o).sort()) r[k] = _canon(o[k]);
    return r;
  }
  return o;
}
// ⚠️ 2026-10-02 起「键别名压缩」已停用（白屏事故根因）。
//   原因：数据经 _apply-safe.mjs 反复增量 merge，同一字段被两套别名方案分别编码（如 name 既是 @A 又是 @k、
//   limited 既是 @Z 又是 @u），而加载器只能从 __A 还原一套 → 另一套拷贝的 CITIES[i].name 永远 undefined →
//   首页白屏 /「无法加载完整数据内容」。且 _apply-safe.mjs 直接读写原始 packed（不还原别名），
//   只要别名存在就会持续污染。停用它即从根上消除该类损坏；_apply-safe 读写 long-key 数据也不再有害。
//   代价：包体略增，若超过单块上限会自动拆成 2 个数据分包（app.json 已注册 subdata2/subdata3，加载器需补静态字面量）。
const _KEYMAP = {};
if (Object.keys(_KEYMAP).length) D.__A = _KEYMAP; // 附带正向映射，供加载器还原

// ── 主包瘦身（v1.19.9）─────────────────────────────────────────────
// 微信主包上限 2048KB。数据扩到 2 万景点后再次逼近红线（实测 2126KB）。
// 以下处理只降低「冗余展示精度」，不虚构也不删除任何景点：
//   1) SPOT_INFO 只保留 rating ≥4.0：开放时间/人均/地址均非刚需（addr 曾是原始大头）
//   2) 美食店移除 addr、坐标降精度：导航用坐标，地址文本可省
//   3) 坐标 6 位小数 → 3 位：精度约 110 米，远高于浏览/导航需要
//   4) 景点备注上限 26 字：超长文案多来自采集截断，页面也放不下
// 实测合计约 -310KB base64（2014KB 主包），是让 2 万景点 + 6.8 千家美食店进 2MB 主包的关键。
// v1.19.156 坐标健康修复：haversine（km）
function _havKm(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const dLat = (c - a) * t, dLon = (d - b) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
let _coordNulled = 0;
// 省-坐标一致性辅助：构建 cityKey→省 映射；给定坐标返回最近 city 所在省，用于判别误地理编码。
const _keyProv = {};
for (const k in (D.CITY_COORDS || {})) {
  const c = (D.CITIES || []).find(x => x.name === k || x.id === k);
  if (c && c.province) _keyProv[k] = c.province;
}
function _nearestProvince(lat, lon) {
  let best = null, bd = 1e9;
  for (const k in (D.CITY_COORDS || {})) {
    const c = D.CITY_COORDS[k];
    if (!Array.isArray(c) || c.length < 2) continue;
    const d = _havKm(c[0], c[1], lat, lon);
    if (d < bd) { bd = d; best = k; }
  }
  return best ? (_keyProv[best] || null) : null;
}

try {
  for (const k in (D.SPOT_INFO || {})) {
    const v = D.SPOT_INFO[k];
    if (!v || typeof v !== "object") continue;
    // 只留评分（低分条目对行程无正向价值，一并去掉以省体积）
    if (v.rating && Number(v.rating) >= 4.0) D.SPOT_INFO[k] = { rating: v.rating };
    else delete D.SPOT_INFO[k];
  }
  for (const ck in (D.SPOT_COORDS || {})) {
    const arr = D.SPOT_COORDS[ck];
    if (!Array.isArray(arr)) continue;
    const ctr = D.CITY_COORDS[ck] || (() => { const c = (D.CITIES || []).find(x => x.name === ck || x.id === ck); return c ? D.CITY_COORDS[c.name] : null; })();
    if (!ctr) continue;
    // v1.19.156 坐标健康修复：仅当「距城心 >300km 且落到了别的省」才判定为误地理编码 → 降级到城市中心。
    // 同省远点（阿拉善/和田/那曲/重庆等超大市域）一律保留真实坐标，避免误伤；同时能抓出大跨度市域里个别跨省错点。
    const cityProv = (() => { const c = (D.CITIES || []).find(x => x.name === ck || x.id === ck); return c ? c.province : null; })();
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!Array.isArray(e) || e.length < 3) continue;
      const lat = +Number(e[1]).toFixed(3), lon = +Number(e[2]).toFixed(3);
      arr[i] = [e[0], lat, lon];
      const d = _havKm(ctr[0], ctr[1], lat, lon);
      if (d > 300) {
        const cp = _nearestProvince(lat, lon);
        const crossProv = cp && cityProv && cp !== cityProv;
        // 跨省错位一律降级；另加极端距离兜底（>1200km，远超任何地市合理跨度，
        // 且能兜住「最近城市无省信息」时漏判的跨省错点，如就近落在石河子/蓟州等无CITIES条目的坐标点）。
        if (crossProv || d > 1200) { arr[i] = [e[0], +ctr[0].toFixed(3), +ctr[1].toFixed(3)]; _coordNulled++; }
      }
    }
  }
  if (_coordNulled) console.log("坐标健康修复: 降级 " + _coordNulled + " 个错位景点坐标(超大市域阈值) 至城市中心");
  for (const ck in (D.FOOD_SPOTS || {})) {
    const arr = D.FOOD_SPOTS[ck];
    if (!Array.isArray(arr)) continue;
    // v1.21：试点城市（10 热门）的店铺带 menu/rep/note 扩展字段，这里一并保留；
    // 非试点城市无这些字段，条件写入避免给上千家店塞空数组撑包。
    D.FOOD_SPOTS[ck] = arr.map(x => {
      if (!(x && typeof x === "object")) return x;
      const o = { shop: x.shop, lat: +Number(x.lat).toFixed(3), lon: +Number(x.lon).toFixed(3), price: x.price || "" };
      if (Array.isArray(x.menu) && x.menu.length) o.menu = x.menu;
      if (x.rep) o.rep = x.rep;
      if (x.note) o.note = x.note;
      return o;
    });
  }
  // v1.19.37：CITY_LANDMARKS_EXTRA 去重——99.9% 的名字已在 SPOT_COORDS 可解析
  //（getSpotCity 先扫坐标库），仅保留「coords 里没有」的独有名字，省 ~106KB 且零功能损失。
  {
    const coordNames = new Set();
    let before = 0, after = 0;
    for (const ck2 in (D.SPOT_COORDS || {})) {
      const arr2 = D.SPOT_COORDS[ck2];
      if (!Array.isArray(arr2)) continue;
      for (const e2 of arr2) if (Array.isArray(e2) && typeof e2[0] === "string") coordNames.add(e2[0]);
    }
    for (const cn in (D.CITY_LANDMARKS_EXTRA || {})) {
      const arr = D.CITY_LANDMARKS_EXTRA[cn];
      if (!Array.isArray(arr)) continue;
      before += arr.length;
      const kept = arr.filter(n => !coordNames.has(n));
      after += kept.length;
      if (kept.length) D.CITY_LANDMARKS_EXTRA[cn] = kept;
      else delete D.CITY_LANDMARKS_EXTRA[cn];
    }
    console.log("CITY_LANDMARKS_EXTRA 去重:", before, "→", after, "(coords 已覆盖的冗余名剔除)");
  }
  // 备注上限：优先在标点处断开，避免截成半句话
  for (const c of (D.CITIES || [])) {
    for (const e of (c.experiences || [])) {
      if (!e || typeof e !== "object" || typeof e.note !== "string" || e.note.length <= 26) continue;
      let cut = 26;
      const head = e.note.slice(0, 26);
      const p = Math.max(head.lastIndexOf("，"), head.lastIndexOf("、"), head.lastIndexOf("；"), head.lastIndexOf("。"));
      if (p >= 12) cut = p + 1;
      e.note = e.note.slice(0, cut);
    }
  }
} catch (e) {
  console.log("瘦身跳过（数据异常，保持原样）:", e && e.message);
}

// ── 脏省名键清理（v1.19.62）：SPOT_COORDS / CITY2PROV / PROVINCE_CITIES 里「用省名当城市键」的项必须剔除。
// 例：SPOT_COORDS["吉林"] 会让 getSpotCoord("吉林", "南湖公园") 命中该键的少量景点表 → 跳过全省扫描 →
// 落入兜底坐标 → 省域优先解析串城（check-boundary 43 例失败）。仅保留直辖市/特区（其名本身就是城市）。
// 每日 geocode 自动化（_apply-safe / _geocode-all-missing）会重新引入该键，故在此兜底，保证任何一次打包都干净。
{
  const _MUNI = new Set(["北京", "天津", "上海", "重庆", "香港", "澳门"]);
  const _provSet = new Set(Object.keys(D.PROVINCE_CITIES || {}));
  let _n = 0;
  for (const k of Object.keys(D.SPOT_COORDS || {})) if (_provSet.has(k) && !_MUNI.has(k)) { delete D.SPOT_COORDS[k]; _n++; }
  for (const k of Object.keys(D.CITY2PROV || {})) if (_provSet.has(k) && !_MUNI.has(k)) delete D.CITY2PROV[k];
  for (const p of Object.keys(D.PROVINCE_CITIES || {})) {
    if (Array.isArray(D.PROVINCE_CITIES[p])) D.PROVINCE_CITIES[p] = D.PROVINCE_CITIES[p].filter((c) => !(_provSet.has(c) && !_MUNI.has(c)));
  }
  if (_n) console.log("脏省名键清理:", _n, "个（防省域解析串城）");
}

const cwd = process.cwd();
const json = JSON.stringify(D);
const deflated = zlib.deflateSync(Buffer.from(json, "utf8"), { level: 9 });
const b64 = deflated.toString("base64");

// ── 多数据分包（v1.20.x）───────────────────────────────────────────
// 约束单位是「单块 base64 体积」：微信分包硬上限 2MB，数据块之外还有 boost 占位页与 manifest，
// 故单块 base64 控制在 ~1.95MB，给分包留出余量。deflate 压缩率约 3~4x、base64 仅 1.33x，
// 所以「按压缩后 base64 长度」装箱才能贴近真实包体上限（按原始 JSON 估算会严重低估、产生过多碎片）。
const CHUNK_B64_MAX = Math.floor(1980 * 1024);
const CHUNK_SLOTS = [
  { dir: path.join(cwd, "subdata", "data"), file: "data-packed.js", rel: "../subdata/data/data-packed.js" },
  { dir: path.join(cwd, "subdata2", "data"), file: "data-packed2.js", rel: "../subdata2/data/data-packed2.js" },
  { dir: path.join(cwd, "subdata3", "data"), file: "data-packed3.js", rel: "../subdata3/data/data-packed3.js" }
];

function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function packB64(x) { return zlib.deflateSync(Buffer.from(JSON.stringify(x), "utf8"), { level: 9 }).toString("base64"); }
function b64len(x) { return packB64(x).length; }

// 把单一超大顶层值切成多份「同键」部分（数组→子数组；对象→子对象），保证 mergeInto 能正确合并
function splitValue(v, maxB64) {
  if (Array.isArray(v)) {
    const parts = []; let cur = []; let curB = 0;
    for (const it of v) {
      const b = b64len(it);
      if (curB + b > maxB64 && cur.length) { parts.push(cur); cur = []; curB = 0; }
      cur.push(it); curB += b;
    }
    if (cur.length) parts.push(cur);
    return parts;
  } else if (isObj(v)) {
    const parts = []; let cur = {}; let curB = 0;
    for (const k of Object.keys(v)) {
      const b = b64len(v[k]);
      if (curB + b > maxB64 && Object.keys(cur).length) { parts.push(cur); cur = {}; curB = 0; }
      cur[k] = v[k]; curB += b;
    }
    if (Object.keys(cur).length) parts.push(cur);
    return parts;
  }
  return [v];
}

// 把整个 DATA 切成若干「DATA 形状」的局部对象（同键可能出现在多块，供 mergeInto 合并）
function splitData(D, maxB64) {
  // __A 是「键别名正向映射」，由下方统一注入每个分块（保证多分包各自可独立还原），这里先排除避免被随机切走；
  // 同时排除函数类型的值（如 initData / checkCoordIntegrity 等挂在 DATA 上的方法），函数无法 JSON 序列化、
  // 若漏网会让 Buffer.from(JSON.stringify(fn)) 收到 undefined 而崩溃（v1.19.173 加 checkCoordIntegrity 后暴露）。
  const keys = Object.keys(D).filter(k => k !== "__dataReady" && k !== "initData" && k !== "__A" && typeof D[k] !== "function");
  const chunks = []; let cur = {}; let curB = 0;
  const flush = () => { if (Object.keys(cur).length) { chunks.push(cur); cur = {}; curB = 0; } };
  for (const k of keys) {
    const b = b64len(D[k]);
    if (b > maxB64) {
      flush();
      for (const part of splitValue(D[k], maxB64)) chunks.push({ [k]: part });
    } else if (curB + b <= maxB64) {
      cur[k] = D[k]; curB += b;
    } else {
      flush(); cur[k] = D[k]; curB = b;
    }
  }
  flush();
  return chunks;
}

function writeChunk(file, b64str) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, "// 自动生成：data.js 的 deflate+base64 压缩包（勿手改，由 tools/pack-data.mjs 生成）\nmodule.exports = \"" + b64str + "\";\n");
}

function cleanStale(slots, usedCount) {
  for (let i = usedCount; i < slots.length; i++) {
    const f = path.join(slots[i].dir, slots[i].file);
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  }
}

let manifest;
if (b64.length <= CHUNK_B64_MAX) {
  // 单块：保持原路径与向后兼容
  writeChunk(path.join(CHUNK_SLOTS[0].dir, CHUNK_SLOTS[0].file), b64);
  manifest = [CHUNK_SLOTS[0].rel];
  cleanStale(CHUNK_SLOTS, 1);
  console.log("分块策略 : 单块（未超 1.95MB 上限）");
} else {
  const parts = splitData(D, CHUNK_B64_MAX);
  // 键别名映射 __A 注入「每个」分块：每块加载时据此独立还原短键，多分包也安全
  parts.forEach(p => { p.__A = _KEYMAP; });
  if (parts.length > CHUNK_SLOTS.length) {
    console.error("✗ 需要 " + parts.length + " 个数据分包，但 app.json 仅注册 " + CHUNK_SLOTS.length +
      " 个（subdata/subdata2/subdata3）。请在 app.json 增加 subdata4… 并重跑。");
    process.exit(1);
  }
  manifest = parts.map((_, i) => CHUNK_SLOTS[i].rel);
  parts.forEach((p, i) => {
    const j = JSON.stringify(p);
    const b = zlib.deflateSync(Buffer.from(j, "utf8"), { level: 9 }).toString("base64");
    writeChunk(path.join(CHUNK_SLOTS[i].dir, CHUNK_SLOTS[i].file), b);
  });
  cleanStale(CHUNK_SLOTS, parts.length);
  console.log("分块策略 : 切成 " + parts.length + " 块（写入 subdata/subdata2/subdata3）");
}

// 生成 manifest：列出全部数据分块的相对路径（相对 utils/data.js），供微信端加载
// v1.19.54 修复：额外写入「静态 require.async 提示」（包在 typeof 守卫内），确保即使
// project.config.json 的 ignoreUploadUnusedFiles=true，上传分包器也能静态追踪并打包数据块。
// 否则动态 require.async 的运行时字符串路径会被当成未使用文件而剥离，导致线上包缺失城市数据。
// 用 require.async + 守卫：不触发主包同步加载分包（保持懒加载），Node 端 require.async 不存在自动跳过。
const _manifestDir = path.join(cwd, "subdata", "data");
const _hintLines = manifest.map(rel => {
  const _abs = path.resolve(cwd, "utils", rel);
  let _r = path.relative(_manifestDir, _abs).split(path.sep).join("/");
  if (!_r.startsWith(".")) _r = "./" + _r;
  return 'if (typeof require.async === "function") require.async("' + _r + '");';
}).join("\n");
fs.writeFileSync(path.join(cwd, "subdata", "data", "_manifest.js"),
  "// 自动生成：数据分块清单（由 tools/pack-data.mjs 生成，勿手改）\n" +
  "// 静态 require.async 提示：保证上传分包器始终打包数据块（与 ignoreUploadUnusedFiles 无关）\n" +
  _hintLines + "\n" +
  "module.exports = " + JSON.stringify(manifest) + ";\n");
console.log("分块清单 :", JSON.stringify(manifest));

console.log("原始 JSON:", (json.length / 1024).toFixed(0) + "KB");
console.log("压缩后   :", (b64.length / 1024).toFixed(0) + "KB");
console.log("压缩率   :", (b64.length / json.length * 100).toFixed(1) + "%");

// 关键：merge-data-patch.mjs 会把 data.js 写成明文 JSON，这里负责把它恢复成「分包异步加载版」。
// 规范加载器以 tools/_src-backup/data.js 为准（utils/data.js 由它拷贝，避免模板转义漂移）。
const DATA_JS = path.join(cwd, "utils", "data.js");
fs.copyFileSync(path.join(cwd, "tools", "_src-backup", "data.js"), DATA_JS);
console.log("已恢复   :", DATA_JS, "(分包异步加载版)");

// v1.19.61 防回归断言：微信「分包异步化」要求 require.async 的实参是「静态字符串字面量」。
// 校验刚拷贝的 utils/data.js 中，每个已生成的数据分块都以静态字面量形式出现；
// 缺失即说明被改成了变量（曾导致线上首页白屏 / 无法加载完整数据），直接 fail-fast。
{
  const _src = fs.readFileSync(DATA_JS, "utf8");
  const _stripped = _src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const _missing = manifest.filter(rel => _stripped.indexOf('require.async("' + rel + '")') === -1);
  if (_missing.length) {
    console.error("✗ [pack-data] utils/data.js 缺少静态 require.async 字面量：");
    _missing.forEach(rel => console.error("    " + rel));
    console.error("  微信分包异步化只接受静态字符串字面量，动态变量会导致数据不加载、首页白屏。");
    console.error("  请在 tools/_src-backup/data.js 的 initData() 内按字面量补齐后重跑 pack-data。");
    process.exit(1);
  }
  console.log("静态校验 : utils/data.js 含 " + manifest.length + " 条静态 require.async 字面量 ✓");
}
console.log("提示：跑 ./allcheck.sh 确认解压与回归正常");
