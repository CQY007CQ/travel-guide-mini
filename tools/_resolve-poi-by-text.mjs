// 用高德 assistant/inputtips（输入提示）解析「geocode 按名解析失败」的景区真实坐标。
// 2026-09-14：原用 v3/place/text，该接口已被高德按服务协议 4.12.3（反爬条款）封禁
//   → 改用独立「辅助服务」配额的 inputtips（未在封禁清单内）。
//
// 背景：官方名录(v200) / 池名转正(v198) / 高德抓取(v199) 中的长名景区，
//   既无法用 geocode/geo 按名解析（会被缓存成 null，永久卡住），
//   就一直是「有景点、无精确坐标」→ 前端只能退回城锚兜底（导航偏几百米）。
//   本例用关键字搜索（POI 检索的正确接口）补上这批真实坐标。
//
// 铁律：坐标只来自真实 API 返回；名字必须置信匹配（归一化+去通用后缀后比对）；
//   必须落在本城池心 150km 内，否则整条丢弃。绝不捏造。
//
// 用法： node tools/_resolve-poi-by-text.mjs [--budget N] [--dry]
// 产出： 就地把 tools/geocode-official-cache.json 里的 null 槽位改写为 {lat,lon,addr}
//   → 之后重跑 tools/geocode-official.mjs 即可并入 v201-official-coords.js
import fs from "fs";
import zlib from "zlib";
import { isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";

const args = process.argv.slice(2);
const BUDGET = (() => { const i = args.indexOf("--budget"); return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 190; })();
const DRY = args.includes("--dry");

// key：全部读入，遇到「超限/失效」即标记该 key 死亡并跳过（1–5 把的搜索类通常当日已尽）
const keys = fs.readFileSync("tools/geocode.keys", "utf8").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
if (!keys.length) { console.error("无可用 key（tools/geocode.keys）"); process.exit(1); }
const dead = new Array(keys.length).fill(false);
let ki = 0;
function nextKey() {
  for (let n = 0; n < keys.length; n++) {
    const i = (ki++) % keys.length;
    if (!dead[i]) return { k: keys[i], i };
  }
  return null; // 全部耗尽
}

// base：读 data-packed.js 拿 CITY_COORDS 做「本城 150km」校验（v1.20 起在分包）
const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const CITY_COORDS = D.CITY_COORDS || {};

const CACHE = "tools/geocode-official-cache.json";
const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const nulls = Object.keys(cache).filter(k => cache[k] === null);
console.log("待解析（geocode 负缓存）:", nulls.length, "| 可用 key 数:", keys.length, "| 预算:", BUDGET);

const GENERIC = ["风景旅游区", "旅游度假区", "旅游体验园", "商贸旅游区", "旅游区", "度假区", "保护区", "景区", "小镇", "公园", "广场", "园区", "博物园", "科博园", "观光园"];
function norm(s) {
  let t = String(s);
  t = t.replace(/[（(][^）)]*[）)]/g, "");      // 去掉括号注释：广东修学旅游体验园（广东省旅游职业技术学校）
  t = t.replace(/[·•・\-—–_、,，.。\/\s'"：:]/g, "");
  return t;
}
function core(s) {
  let t = norm(s);
  for (let n = 0; n < 3; n++) {
    let cut = false;
    for (const g of GENERIC) if (t.length > g.length && t.endsWith(g)) { t = t.slice(0, -g.length); cut = true; }
    if (!cut) break;
  }
  return t;
}
// 置信匹配：核心名相等，或核心名互相包含且短边占比 >= 0.6
function matchScore(q, p) {
  const a = core(q), b = core(p);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const longer = Math.max(a.length, b.length), shorter = Math.min(a.length, b.length);
  if (shorter / longer < 0.6) {
    // 核心不等长时再退回「全名包含」一次机会
    const na = norm(q), nb = norm(p);
    const l2 = Math.max(na.length, nb.length), s2 = Math.min(na.length, nb.length);
    if (s2 / l2 >= 0.6 && (na.includes(nb) || nb.includes(na))) return 70;
    return 0;
  }
  if (a.includes(b) || b.includes(a)) return 90;
  return 0;
}
function hav(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

let calls = 0, hit = 0, miss = 0, netFail = 0, keyDead = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 并发安全：只记录本轮的改动，落盘时「重读磁盘 → 合并 → 写回」，绝不整文件覆盖别人的改动
const updates = {};
function saveAll() {
  let disk = {};
  try { disk = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { disk = {}; }
  for (const k in updates) disk[k] = updates[k];
  fs.writeFileSync(CACHE, JSON.stringify(disk));
}

for (const ck of nulls) {
  if (calls >= BUDGET) break;
  const sep = ck.indexOf("|");
  const city = ck.slice(0, sep), name = ck.slice(sep + 1);
  const kk = nextKey();
  if (!kk) { console.log("⚠️ 全部 key 搜索类已耗尽，提前停止"); break; }
  // 2026-09-14：v3/place/text 已被官方封禁（4.12.3）→ 改用 assistant/inputtips（输入提示）
  const url = `https://restapi.amap.com/v3/assistant/inputtips?keywords=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&citylimit=true&datatype=poi&key=${kk.k}`;
  calls++;
  let j;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    const _txt = await r.text();
    // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立刻终止整轮，绝不重试
    if (isPunishPage(_txt)) { console.error(BAN_HINT); process.exit(3); }
    j = JSON.parse(_txt);
  } catch (e) { netFail++; await sleep(400); continue; }
  // inputtips 的响应体不一定带 status 字段（实测首键即 tips）→ 以 tips 数组是否存在为成功判据
  if (!Array.isArray(j.tips)) {
    if (/OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE/.test(String(j.info))) {
      dead[kk.i] = true; keyDead++; calls--;
      console.log(`   key#${kk.i + 1} 已失效/超限 → 停用（${j.info}）`);
      continue;
    }
    miss++; await sleep(150); continue;
  }
  const pois = j.tips.filter(p => p && p.name && p.location);
  let best = null, bestS = 0;
  for (const p of pois) {
    const s = matchScore(name, p.name);
    if (s > bestS) { bestS = s; best = p; }
  }
  let v = null;
  if (best && bestS > 0) {
    const [lngS, latS] = String(best.location).split(",");
    const lat = +(+latS).toFixed(6), lon = +(+lngS).toFixed(6);
    const anchor = CITY_COORDS[city];
    const okRange = lat > -90 && lat < 90 && lon > -180 && lon < 180;
    const okAnchor = !anchor || hav(lat, lon, anchor[0], anchor[1]) <= 150;
    if (okRange && okAnchor) {
      // inputtips 的行政区字段是 district（"山西省太原市晋源区"），保留 pname/cityname/adname 兼容分支
      const _adm = String(best.pname || "") + String(best.cityname || "") + String(best.adname || "");
      v = { lat, lon, addr: (_adm || String(best.district || "")) + String(best.name || ""), src: "inputtips" };
    }
  }
  if (v) {
    updates[ck] = v; hit++;
    console.log(`  ✅ ${city} ${name} → ${best.name} ${v.lat},${v.lon} (score ${bestS})`);
  } else { miss++; }
  if (calls % 20 === 0) { saveAll(); process.stdout.write(`  进度 ${calls}/${Math.min(nulls.length, BUDGET)} 命中 ${hit}\r`); }
  await sleep(150);
}

if (!DRY) saveAll(); else console.log("(dry) 未写缓存");
const merged = Object.assign({}, cache, updates);
console.log(`\n调用 ${calls} | 命中 ${hit} | 未命中 ${miss} | 网络失败 ${netFail} | 停用 key ${keyDead}`);
console.log("剩余负缓存:", Object.keys(merged).filter(k => merged[k] === null).length);
