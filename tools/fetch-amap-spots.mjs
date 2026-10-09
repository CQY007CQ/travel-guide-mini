// v1.18 高德真实景点扩充（双通道）
// 背景：本 key 的「搜索服务」日配额已用尽 —— place/text 与 place/around 同属该配额，全部返回
//       USER_DAILY_QUERY_OVER_LIMIT(10044)。但「辅助服务」的 inputtips（输入提示）与
//       geocode/regeo 走独立配额，仍可用。故本工具做双通道：
//         --mode around    (默认) place/around 周边搜索，返回带评分/开放时间，质量最高
//         --mode inputtips 关键词输入提示 + 类型码过滤，搜索配额用尽时的替代通道
//         --mode text      【2026-09-14 永久停用】原 place/text 关键字搜索，已被官方按服务协议 4.12.3 封禁
// 产出补丁（三键，进 merge-data-patch.mjs）：
//   LM_ADD     → 进「本市真实景点补充池」（行程空槽自动补入，无需编造介绍）
//   COORDS_ADD → 真实 GCJ-02 坐标 → 就近排序 + 微信 openLocation 一键导航
//   SPOT_INFO  → 真实地址 / 开放时间 / 评分 / 人均（缺项不填，不虚构）
// 前置：Key 写入 tools/geocode.keys（一行一把，可多把自动轮换）或 tools/geocode.key（单把），
//       也可用环境变量 MAP_KEYS（逗号分隔）/ MAP_KEY。
//       高德「搜索服务」配额是**账号级**的，一把用尽当天即废；多把 key 会自动接力（遇
//       OVER_LIMIT / INVALID_USER_KEY 立即换下一把并重试同一请求），全废则提前停止不再空跑。
// 用法：
//   node tools/fetch-amap-spots.mjs --check                 ← 体检所有 key × 各接口可用性
//   node tools/fetch-amap-spots.mjs --only 芜湖,蚌埠
//   node tools/fetch-amap-spots.mjs --mode inputtips
//   node tools/fetch-amap-spots.mjs --mode text
//   node tools/fetch-amap-spots.mjs --mode around --base tools/_bak-v118/base-data.js
//   node tools/fetch-amap-spots.mjs --limit 20
//   node tools/fetch-amap-spots.mjs --fresh
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { assertAllowed, isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";
const req = createRequire(process.cwd() + "/");
const ROOT = process.cwd();
/* ---------- Key 池（多 key 自动轮换） ---------- */
// 读取优先级：环境变量 MAP_KEYS / MAP_KEY > tools/geocode.keys（一行一把，# 后为注释）> tools/geocode.key
// 多把 key 的意义：高德「搜索服务」配额是**账号级**的，一把用尽当天即废；多把 key 可自动接力，
// 无需人工干预，也不会像单 key 那样把 200+ 城全部空跑一遍。
function loadKeys() {
  const out = [];
  const push = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
    .forEach(x => { if (!out.includes(x)) out.push(x); });
  if (process.env.MAP_KEYS) push(process.env.MAP_KEYS);
  if (process.env.MAP_KEY) push(process.env.MAP_KEY);
  for (const f of ["geocode.keys", "geocode.key"]) {
    try { push(fs.readFileSync(path.join(ROOT, "tools", f), "utf8").split("\n").map(l => l.replace(/#.*$/, "")).join(" ")); }
    catch (e) { /* 文件不存在则跳过 */ }
  }
  return out;
}
const KEYS = loadKeys();
if (!KEYS.length) {
  console.error("未找到 Key：请写入 tools/geocode.keys（一行一把，可多把轮换）或 tools/geocode.key，或设置 MAP_KEYS");
  process.exit(1);
}
let keyIdx = 0;
const curKey = () => KEYS[keyIdx];
const mask = (k) => String(k).slice(0, 6) + "…" + String(k).slice(-4);
// 命中这些错误说明「这把 key 不能用了」→ 自动换下一把：超额 / 无效 / 回收 / 平台不匹配 / IP 白名单
const ROTATE_RE = /OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE|USERKEY_PLAT_NOMATCH|INVALID_USER_IP|SERVICE_NOT_EXIST/;
let allExhausted = false;           // 所有 key 都不可用 → 提前结束，不再空跑剩余城市
const exhaustedInfo = [];
let CALLS = 0;                      // 本轮已发出的接口调用数（用于配额预算控制）
let budgetHit = false;

// 统一请求层：自动注入 key；遇「超额/失效」自动轮换到下一把并重试**同一请求**
async function apiGet(qs, { retry = true } = {}) {
  // 2026-09-14：被高德官方封禁的接口（v3/place/text，服务协议 4.12.3）硬拦截，永不发出请求
  assertAllowed(qs);
  let tried = 0;
  for (;;) {
    // 配额预算闸门：个人认证 key 的「搜索类」日配额只有 100 次，主动收手比被拒更好
    if (BUDGET && CALLS >= BUDGET) { budgetHit = true; return { json: null, err: "__BUDGET__" }; }
    let j = null, netErr = "";
    const url = `https://restapi.amap.com/v3/${qs}${qs.includes("?") ? "&" : "?"}key=${curKey()}`;
    CALLS++;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const txt = await r.text();
      // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立即熔断整轮，绝不重试
      if (isPunishPage(txt)) { console.error(BAN_HINT); process.exit(3); }
      j = JSON.parse(txt);
    }
    catch (e) { netErr = e.message; }
    if (netErr) return { json: null, err: netErr };
    if (j && j.status === "1") return { json: j, err: "" };
    const info = String((j && j.info) || ("status " + (j && j.status)));
    if (retry && ROTATE_RE.test(info)) {
      if (tried < KEYS.length - 1) {
        tried++;
        keyIdx = (keyIdx + 1) % KEYS.length;
        console.log(`\n  [key 轮换] ${info} → 改用第 ${keyIdx + 1}/${KEYS.length} 把 (${mask(curKey())})`);
        await sleep(120);
        continue;
      }
      allExhausted = true;
      if (!exhaustedInfo.includes(info)) exhaustedInfo.push(info);
    }
    return { json: j, err: info };
  }
}
const CACHE_FILE = path.join(ROOT, "tools", "amap-spots-cache.json");
const OUT_PATCH = path.join(ROOT, "tools", "v199-amap-spots.js");

const argv = process.argv.slice(2);
const FRESH = argv.includes("--fresh");
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : ""; };
// --base <文件>：用「原始数据快照」作为查重基准，生成「相对原始库的完整补丁」。
// 说明：数据合入 data.js 后，若仍以当前 data.js 为基准查重，补丁会因「景点已存在」而被
//      逐轮截短、无法独立重建。重建补丁时用 --base 指回原始快照即可恢复完整。
const BASE = argOf("--base");
const D = BASE ? req(path.join(ROOT, BASE)) : req("./utils/data.js");
const MODE = (argOf("--mode") || process.env.MAP_MODE || "around").toLowerCase();
// 2026-09-14：v3/place/text 已被高德官方封禁（服务协议 4.12.3 反爬条款）→ text 通道永久停用
if (MODE === "text") {
  console.error("❌ --mode text 已停用：v3/place/text 被高德官方封禁（2026-09-14，服务协议 4.12.3）。");
  console.error("   请改用 --mode around（周边搜索）或 --mode inputtips（输入提示）。");
  process.exit(4);
}
// 2026-09-14 批量抓取总闸：高德已按服务协议 4.12.3 处置本账号，任何「批量抓取后落盘」的行为
// （含 place/around、inputtips）都属同一违规类型 —— 这次只是恰好点到了 place/text。
// 故默认拒绝执行，必须显式设 AMAP_BULK_OK=1 才放行（--check 体检不受限）。
if (!process.env.AMAP_BULK_OK && !argv.includes("--check")) {
  console.error("🛑 批量抓取已默认关闭（2026-09-14 高德封禁事件后设的总闸）。");
  console.error("   《服务协议》3.5 禁止「直接存储、缓存或以技术手段抓取本服务数据」，");
  console.error("   4.12.3 禁止爬虫式访问 —— 本脚本产出会落盘成 POI 数据，属同一违规类型。");
  console.error("   如确需运行，请显式设置环境变量：AMAP_BULK_OK=1");
  console.error("   长期建议：景点基础数据改用 OSM（Overpass / Nominatim，ODbL 允许存储再分发）。");
  process.exit(5);
}
const LIMIT = parseInt(argOf("--limit"), 10) || 0;
// --budget N：本轮最多发 N 次接口调用（含翻页）后主动收手。
// 依据：高德官方配额表 —— 个人认证开发者「搜索类」（输入提示/周边搜索/关键字搜索）日配额仅 100 次，
//       企业认证才 1000 次。主动限额可保证「每天稳定推进若干城」而不是把配额烧在一座大城市上。
const BUDGET = parseInt(argOf("--budget"), 10) || 0;
const ONLY = argOf("--only").split(",").map(s => s.trim()).filter(Boolean);
const ALL = argv.includes("--all");                     // 忽略 SHORT 门槛，全网深挖
const MAX_ADD = parseInt(argOf("--max-add"), 10) || 12; // 每城最多新增（深挖时可提高）
const RADIUS = 50000;    // 高德周边搜索半径上限
const PAGES = 3;         // around：每种类型最多翻 3 页（75 条）
const SHORT = 14;        // 城市景点数低于此值才补（--all 时忽略）

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 归一与过滤 ---------- */
function normCity(s) {
  return String(s || "").replace(/(省|市|地区|自治州|自治县|自治旗|盟|林区|新区|特别行政区)+$/g, "").trim();
}
function sameCity(a, b) {
  const x = normCity(a), y = normCity(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return x.length >= 2 && y.length >= 2 && x.slice(0, 2) === y.slice(0, 2) && Math.abs(x.length - y.length) <= 4;
}
// 去掉行政前缀（"安徽省芜湖市马仁森林公园" → "马仁森林公园"）；绝不做通用首字裁剪（曾误把「市民广场」裁成「民广场」）
function cleanName(name, city, prov) {
  let s = String(name || "").trim();
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (prov) {
    const p = String(prov).replace(/省|自治区|壮族|回族|维吾尔|特别行政区/g, "");
    s = s.replace(new RegExp("^" + esc(p) + "(省|市|自治区)?(?=.{3,})"), "");
    s = s.replace(new RegExp("^" + esc(prov) + "(省|市|自治区)?(?=.{3,})"), "");
  }
  if (city) {
    s = s.replace(new RegExp("^" + esc(city) + "市(?=.{3,})"), "");
    s = s.replace(new RegExp("^" + esc(city) + "(?=.{4,})"), "");
  }
  return s.trim();
}
const CLOSED = /暂停开放|不对外开放|已关闭|停止开放|维修中|升级改造|闭园/;
const SUBENTRY = /[-–—·|｜]|\d+号(门|口|馆|厅)$/;
const NOISE = /停车场|停车位|公厕|厕所|卫生间|售票|票务|游客中心|游客服务|服务中心|管理处|管委会|派出所|警务室|地铁站|公交站|客运站|火车站|汽车站|充电|出入口|大门|正门|北门|南门|东门|西门|有限公司|集团|学院|大学|学校|中学|小学|幼儿园|医院|诊所|药店|银行|营业厅|邮政|快递|小区|公寓|住宅|写字楼|大厦|商场|购物中心|超市|便利店|农贸市场|加油站|4S店|工厂|仓库|工地|基站|水厂|变电站|泵站|服务区|收费站|售楼|项目部|指挥部|大道壹号|壹号院|别墅|酒店|宾馆|客栈|民宿|门市|营业部/;
const GENERIC_SUFFIX = /(风景区|旅游景区|旅游区|景区|森林公园|湿地公园|地质公园|公园|广场|游园|乐园|小镇|古镇|古城|博物馆|纪念馆|旧址|遗址)$/;
function coreKey(name) { return String(name || "").replace(GENERIC_SUFFIX, ""); }
// 核心名近似：相等，或「短核心名」被「长核心名」包含且占比 ≥0.7
// （用比例而非单纯包含，避免库内短名「黄河小浪底」误杀高德长名「黄河小浪底水利枢纽风景区」）
function nearCore(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, L] = a.length <= b.length ? [a, b] : [b, a];
  if (!L.includes(s)) return false;
  return s.length >= Math.max(2, Math.ceil(L.length * 0.7));
}
function inChina(lat, lon, city) {
  if (!isFinite(lat) || !isFinite(lon)) return false;
  if (lat > 54 || lon > 136) return false;
  if (city === "三沙") return lat >= 15 && lat <= 18 && lon >= 110 && lon <= 114;
  return lat >= 17 && lon >= 73;
}
// 通用单条过滤：返回清洗后的名字，或 null 表示丢弃
function acceptName(rawName, city, prov, opts) {
  const o = opts || {};
  const n0 = String(rawName || "").trim();
  if (!n0) return null;
  if (CLOSED.test(n0)) return null;
  if (SUBENTRY.test(n0)) return null;
  const nm = cleanName(n0, city, prov) || n0;
  if (!nm || /^[省市]/.test(nm)) return null;
  if (nm.length < 2 || nm.length > (o.maxLen || 20)) return null;
  if (NOISE.test(nm)) return null;
  return nm;
}

/* ---------- 通道 A：place/around 周边搜索 ---------- */
async function around(center, types, page) {
  const { json: j, err } = await apiGet(`place/around?location=${center}&types=${encodeURIComponent(types)}&radius=${RADIUS}&offset=25&page=${page}&extensions=all`);
  if (err) return { err, pois: [] };
  return { pois: j.pois || [] };
}
async function collectAround(city, center) {
  const prov = (D.CITY2PROV || {})[city] || "";
  const pool = [];
  let lastErr = "";
  for (const types of ["110202|110203", "110000"]) {
    const primary = types !== "110000";
    for (let page = 1; page <= PAGES; page++) {
      const { err, pois } = await around(center, types, page);
      if (err) { lastErr = err; await sleep(300); break; }
      for (const p of pois) {
        const loc = String(p.location || "").split(",");
        const lon = Number(loc[0]), lat = Number(loc[1]);
        if (!inChina(lat, lon, city)) continue;
        // around 搜索本身已按城市中心 50km 半径地理围栏；县级风景名胜区（峨眉山市 / 鼓浪屿 /
        // 乌镇 / 西塘 / 莫干山 / 黄龙 / 泰山 等）高德 cityname/adname 常写成上级地市，
        // 严格同名校验会整批误杀 → 改为「同名 OR 落在围栏内」接受（围栏已保证 ≤50km）。
        const cp = String(center).split(",");
        const inFence = haversineKm({ lat: Number(cp[1]), lon: Number(cp[0]) }, { lat, lon }) <= 55;
        if (!(sameCity(p.cityname, city) || sameCity(p.adname, city) || inFence)) continue;
        const bx = p.biz_ext || {};
        const rating = Number(bx.rating) || 0;
        if (!primary && rating < 4.5) continue;             // 宽类型：高评分门槛
        if (primary && rating > 0 && rating < 3.5) continue; // 窄类型：滤掉明显低分
        const nm = acceptName(p.name, city, prov, { maxLen: primary ? 26 : 18 });
        if (!nm) continue;
        pool.push({
          name: nm, lat: +lat.toFixed(6), lon: +lon.toFixed(6),
          rating: rating ? String(rating) : "",
          addr: String(p.address || "").trim() || String(p.adname || "").trim(),
          openTime: String(bx.opentime2 || p.opentime2 || "").slice(0, 160),
          cost: String(bx.cost || ""),
          rank: primary ? 0 : 1
        });
      }
      if (pois.length < 25) break;
      await sleep(220);
    }
    await sleep(220);
  }
  return { pool, err: lastErr };
}

/* ---------- 通道 B：inputtips 关键词输入提示（搜索配额用尽时的替代） ---------- */
const TIP_KEYWORDS = ["景区", "风景区", "公园", "古镇", "古城", "博物馆", "纪念馆", "湿地", "遗址", "岛", "溶洞", "长城"];
// 并发池：把 12 个关键词并发发出，避免逐个串行被网络往返拖慢（每城 19s → ~5s）
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}
async function collectTips(city) {
  const prov = (D.CITY2PROV || {})[city] || "";
  const pool = [];
  let lastErr = "", ok = 0;
  const results = await mapLimit(TIP_KEYWORDS, 4, async (kw) => {
    const { json: j, err } = await apiGet(`assistant/inputtips?keywords=${encodeURIComponent(kw)}&city=${encodeURIComponent(city)}&citylimit=true&datatype=poi`);
    if (err) return { tips: [], err };
    return { tips: j.tips || [], err: "" };
  });
  for (const r of results) {
    if (r.err) lastErr = r.err; else ok++;
    for (const t of r.tips) {
      const tc = String(t.typecode || "");
      if (!tc.startsWith("11")) continue;                    // 只要「风景名胜」大类
      const loc = String(t.location || "").split(",");
      const lon = Number(loc[0]), lat = Number(loc[1]);
      if (!inChina(lat, lon, city)) continue;
      // district 形如「安徽省芜湖市镜湖区」→ 用「包含城市名」判定归属
      const dist = String(t.district || "");
      if (dist && dist.indexOf(city) < 0 && !sameCity(dist, city)) continue;
      const nm = acceptName(t.name, city, prov, { maxLen: 20 });
      if (!nm) continue;
      // 排序权重：国家/省级景点 0 > 公园广场 1 > 其他风景名胜（含寺庙道观）2 > 其他 3
      const rank = /^11020[12]/.test(tc) ? 0 : (/^110101/.test(tc) ? 1 : (/^1102/.test(tc) ? 2 : 3));
      pool.push({
        name: nm, lat: +lat.toFixed(6), lon: +lon.toFixed(6),
        rating: "",                                          // inputtips 不返回评分
        addr: String(t.address || "").trim() || dist,
        openTime: "", cost: "", rank
      });
    }
  }
  await sleep(120);
  return { pool, err: ok === 0 ? lastErr : "" };   // 只要有一个关键词成功就不算接口异常
}

/* ---------- 通道 C：【2026-09-14 永久停用】原 place/text 关键字搜索 ---------- */
// 高德依据《高德地图开放平台服务协议》4.12.3（反爬条款）封禁本账号 v3/place/text 接口权限。
// 该通道整体废弃：调用点已删除，函数保留仅为兼容外部引用，一旦被触达立即抛错 ——
// 与 _amap-compliance.mjs 的 assertAllowed() 形成双保险，保证该请求不可能再被发出。
async function collectText(city) {
  throw new Error(
    `通道 C 已永久停用：v3/place/text 被高德官方封禁（2026-09-14，服务协议 4.12.3）。` +
    `请改用 --mode around（周边搜索）或 --mode inputtips（输入提示）。`
  );
}

/* ---------- 后置过滤（纯缓存阶段执行，不再消耗配额） ---------- */
function haversineKm(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const POST_NOISE = /全景图|导览图|指示牌|标识牌|示意图|分布图|平面图|导游图|宣传栏|公告栏|简介牌|地名石|景观石|雕塑小品|大门$|门口$|售票处|检票口|观景台$|瞭望台$|景区广场$/;
// 裸通用名（无任何限定词，指向不明）一律不要
const BARE_GENERIC = /^(古城墙|古城|古街|老街|老城|景区|风景区|公园|广场|博物馆|纪念馆|古镇|寺庙|遗址|故居|纪念园|文化园)$/;
// 归属硬校验：景点必须落在城市锚点 120km 内（district 为空时 inputtips 会给到外地同名 POI，
// 曾出现「岳阳」名下混入芜湖东湖公园）
function postOk(x, center) {
  const nm = String(x.name || "");
  if (!nm) return false;
  if (NOISE.test(nm) || POST_NOISE.test(nm) || BARE_GENERIC.test(nm)) return false;
  if (!inChina(x.lat, x.lon, "")) return false;
  if (center && center[0] && center[1]) {
    if (haversineKm({ lat: center[0], lon: center[1] }, { lat: x.lat, lon: x.lon }) > 120) return false;
  }
  return true;
}

/* ---------- 共用：池内去重 ---------- */
function dedupePool(pool) {
  // ① 同名 ② 核心名近似 → 折叠「龙子湖公园 / 龙子湖风景区 / 龙子湖西公园」这类同地异名
  pool.sort((a, b) => (a.rank - b.rank) || (Number(b.rating) - Number(a.rating)));
  const kept = [];
  for (const x of pool) {
    const cx = coreKey(x.name);
    let dup = false;
    for (const k of kept) {
      if (k.name === x.name) { dup = true; break; }
      if (nearCore(coreKey(k.name), cx)) { dup = true; break; }
    }
    if (dup) continue;
    kept.push(x);
  }
  return kept;
}

/* ---------- 现有景点查重 ---------- */
function existingNames(city) {
  const set = new Set();
  const c = D.CITIES.find(x => x.name === city);
  ((c && c.experiences) || []).forEach(e => { if (e && e.name) set.add(String(e.name).trim()); });
  ((D.SPOT_COORDS && D.SPOT_COORDS[city]) || []).forEach(s => { if (s && s[0]) set.add(String(s[0]).trim()); });
  ["CITY_LANDMARKS", "CITY_LANDMARKS_EXTRA", "CITY_LANDMARKS_EXTRA2", "CITY_LANDMARKS_EXTRA3", "CITY_LANDMARKS_EXTRA4", "CITY_LANDMARKS_EXTRA5", "CITY_LANDMARKS_EXTRA6"].forEach(lib => {
    (((D[lib] || {})[city]) || []).forEach(n => { if (n) set.add(String(n).trim()); });
  });
  return set;
}
function isDup(name, existSet) {
  if (existSet.has(name)) return true;
  const cn = coreKey(name);
  for (const u of existSet) {
    if (!u) continue;
    if (u.includes(name) || name.includes(u)) return true;
    if (nearCore(coreKey(u), cn)) return true;
  }
  return false;
}

/* ---------- Key 体检（--check）：不抓数据，只探每个通道对每把 key 是否可用 ---------- */
if (argv.includes("--check")) {
  console.log(`Key 池共 ${KEYS.length} 把：`);
  KEYS.forEach((k, i) => console.log(`  ${i + 1}. ${mask(k)}${i === keyIdx ? "  (当前)" : ""}`));
  const PROBES = [
    ["place/around 周边搜索", "place/around?location=118.433,31.353&types=110202%7C110203&radius=50000&offset=25&page=1"],
    // v3/place/text 已于 2026-09-14 被高德按服务协议 4.12.3 封禁 → 不再探测（探测本身即违规调用）
    ["inputtips 输入提示", "assistant/inputtips?keywords=%E6%99%AF%E5%8C%BA&city=%E8%8A%9C%E6%B9%96&citylimit=true&datatype=poi"],
    ["geocode/geo 地理编码", "geocode/geo?address=%E8%8A%9C%E6%B9%96"],
    ["geocode/regeo 逆地理编码", "geocode/regeo?location=118.433,31.353"]
  ];
  console.log("");
  for (let i = 0; i < KEYS.length; i++) {
    keyIdx = i;
    console.log(`【第 ${i + 1} 把 ${mask(KEYS[i])}】`);
    for (const [label, qs] of PROBES) {
      const { json, err } = await apiGet(qs, { retry: false });   // 体检不做轮换，逐把如实反映
      const ok = !err;
      const extra = ok ? ` (count=${json.count !== undefined ? json.count : "-"})` : ` → ${err}`;
      console.log(`   ${ok ? "✅" : "❌"} ${label}${extra}`);
    }
    console.log("");
  }
  process.exit(0);
}

/* ---------- 主流程 ---------- */
let cache = {};
if (!FRESH) { try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) { cache = {}; } }
const ck = city => MODE + "|" + city;

const SKIP_UNFETCHED = argv.includes("--skip-uncached");   // 只重筛缓存、不发请求（配额用尽时用）
const targets = D.CITIES.filter(c => (ONLY.length ? ONLY.includes(c.name) : (ALL || (c.experiences || []).length < SHORT)));
console.log(`模式: ${MODE} | 待抓取城市: ${targets.length} | 已有缓存: ${Object.keys(cache).length}`);

let done = 0, added = 0, empty = 0, netEmpty = 0, skipped = 0;
const LM_ADD = {}, COORDS_ADD = {}, SPOT_INFO = {};
for (const c of targets) {
  const city = c.name;
  if (LIMIT && done >= LIMIT) break;
  // 所有 key 都已超额/失效 → 立刻收手，不再把剩余城市空跑一遍（旧版会白跑 200+ 城）
  if (allExhausted) {
    console.log(`\n所有 key 均不可用（${exhaustedInfo.join(" / ")}），已提前结束本轮。剩余 ${targets.length - done} 城待下次继续。`);
    break;
  }
  // 达到本轮配额预算 → 主动收手，把剩余配额留给下一次（缓存断点续传，不会重复抓）
  if (budgetHit) {
    console.log(`\n已达本轮预算上限（${CALLS} 次调用），主动收手。剩余 ${targets.length - done} 城待下次继续。`);
    break;
  }
  const center = (D.CITY_COORDS || {})[city];
  let list;
  const cached = cache[ck(city)];
  if (cached !== undefined && !FRESH) list = cached || [];
  else {
    if (SKIP_UNFETCHED) { skipped++; continue; }
    let r;
    if (MODE === "inputtips") r = await collectTips(city);
    else if (MODE === "text") r = await collectText(city);
    else r = center ? await collectAround(city, `${center[1]},${center[0]}`) : { pool: [], err: "" };
    list = dedupePool(r.pool || []);
    // 抓取层报错（如配额用尽）→ 不写缓存，留待重试
    if (!list.length && r.err) { netEmpty++; await sleep(250); continue; }
    cache[ck(city)] = list;
    await sleep(100);
  }
  const exist = existingNames(city);
  const pick = [];
  for (const x of list) {
    if (pick.length >= MAX_ADD) break;
    if (!postOk(x, center)) continue;              // 归属/距离/名称后置硬校验
    if (isDup(x.name, exist)) continue;
    if (pick.some(p => p.name === x.name)) continue;
    pick.push(x);
    exist.add(x.name);
  }
  if (pick.length) {
    LM_ADD[city] = pick.map(p => p.name);
    COORDS_ADD[city] = pick.map(p => [p.name, p.lat, p.lon]);
    pick.forEach(p => {
      const info = {};
      if (p.addr) info.addr = p.addr.slice(0, 40);
      if (p.openTime) info.openTime = p.openTime;
      if (p.rating) info.rating = p.rating;
      if (p.cost) info.cost = p.cost;
      if (Object.keys(info).length) SPOT_INFO[p.name] = info;
    });
    added += pick.length;
  } else empty++;
  done++;
  if (done % 10 === 0) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
    process.stdout.write(`  已处理 ${done}/${targets.length}  新增 ${added}  无新增 ${empty}  接口异常 ${netEmpty}\r`);
  }
}
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");

// 与已有补丁「并集合并」而不是覆盖：
// 换 mode / 分批跑时不会把前几轮抓到并已合入 data.js 的景点从补丁里抹掉，也不会
// 因为「本轮同城只查到少量新项」而把该城原有的多条记录截短。
let prev = {};
try { prev = req("./tools/v199-amap-spots.js") || {}; } catch (e) { prev = {}; }
const mergeMap = (a, b) => {
  const o = Object.assign({}, a || {});
  for (const k of Object.keys(b || {})) {
    const A = Array.isArray(o[k]) ? o[k] : [];
    const B = Array.isArray(b[k]) ? b[k] : [];
    const seen = new Set();
    o[k] = A.concat(B).filter(x => { const key = JSON.stringify(x); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return o;
};
const LM_ALL = mergeMap(prev.LM_ADD, LM_ADD);
const CO_ALL = mergeMap(prev.COORDS_ADD, COORDS_ADD);
const INFO_ALL = Object.assign({}, prev.SPOT_INFO || {}, SPOT_INFO);

const src = "// 自动生成：高德 POI 抓取的真实景点（勿手改，由 tools/fetch-amap-spots.mjs 生成，最近模式 " + MODE + "）\n"
  + "// LM_ADD → 本市真实景点补充池；COORDS_ADD → 真实坐标；SPOT_INFO → 真实地址/开放时间/评分/人均\n"
  + "module.exports = " + JSON.stringify({ LM_ADD: LM_ALL, COORDS_ADD: CO_ALL, SPOT_INFO: INFO_ALL }, null, 1) + ";\n";
fs.writeFileSync(OUT_PATCH, src, "utf8");
console.log(`\n完成：城市 ${done} | 新增景点 ${added} | 无新增城市 ${empty} | 接口异常(未缓存) ${netEmpty} | 跳过未缓存 ${skipped}`);
console.log(`本轮接口调用: ${CALLS} 次（高德「搜索类」个人认证日配额 100 次 / 企业认证 1000 次）`);
console.log("本次覆盖城市:", Object.keys(LM_ADD).length, "| 补丁累计城市:", Object.keys(LM_ALL).length,
  "| 累计坐标:", Object.values(CO_ALL).reduce((a, b) => a + b.length, 0), "| 累计详情:", Object.keys(INFO_ALL).length);
console.log("补丁已生成:", OUT_PATCH);
console.log("下一步：node tools/merge-data-patch.mjs && node tools/pack-data.mjs && ./allcheck.sh");
