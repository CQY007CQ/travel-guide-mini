// v1.15.6+ 坐标离线校正脚本（腾讯位置服务 WebServiceAPI）
// 用途：只在「本地」调用地图 API，把真实 GCJ-02 坐标写回 data.js；
//       Key 不进小程序包，小程序运行时仍用微信原生 wx.openLocation，审核不受影响。
// 前置：把 Key 写入 tools/geocode.key（脚本同目录），或设置环境变量 MAP_KEY。
// 用法：
//   node tools/geocode-fix.mjs            # 续跑（默认，读缓存跳过已查过的）
//   node tools/geocode-fix.mjs --fresh    # 忽略缓存重跑
//   node tools/geocode-fix.mjs --limit 50 # 本次最多查 50 条（限频/试跑）
// 产出：tools/geocode-cache.json（缓存/断点续传）+ tools/v199-coords-geocoded.js（补丁，需手工 merge）
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { isPunishPage, BAN_HINT } from "./_amap-compliance.mjs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const ROOT = process.cwd();
const KEY_FILE = path.join(ROOT, "tools", "geocode.key");
const CACHE_FILE = path.join(ROOT, "tools", "geocode-cache.json");
const OUT_PATCH = path.join(ROOT, "tools", "v199-coords-geocoded.js");
// 支持两家：腾讯（默认）与高德（腾讯配额用尽时切换，均为 GCJ-02，与微信 openLocation 同系）
const PROVIDER = (process.env.MAP_PROVIDER || "tencent").toLowerCase();
// 2026-09-14：高德 v3/place/text 已被官方封禁（服务协议 4.12.3 反爬条款）→ 高德通道改走
//   v3/place/around（周边搜索，未在封禁清单内），以城市中心为锚、半径 50km。
const ENDPOINT = PROVIDER === "amap"
  ? "https://restapi.amap.com/v3/place/around"
  : "https://apis.map.qq.com/ws/place/v1/search";

const argv = process.argv.slice(2);
const FRESH = argv.includes("--fresh");
const LIMIT = (() => { const i = argv.indexOf("--limit"); return i >= 0 ? parseInt(argv[i + 1], 10) || 0 : 0; })();
// SKIP_FETCH=1：不调用任何 API，直接用现有缓存生成补丁（配额用尽/收尾时使用）
const SKIP_FETCH = process.env.SKIP_FETCH === "1";

function readKey() {
  if (process.env.MAP_KEY) return process.env.MAP_KEY.trim();
  try {
    // 2026-09-14：原实现直接 trim 整个文件 → 文件里若只有注释说明，
    // 会把注释当 KEY 发出去（换来一个 10001，而不是 fail-closed）。
    // 改为按行取「第一个非空且非注释」的行。
    const line = fs.readFileSync(KEY_FILE, "utf8")
      .split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
    return line || "";
  } catch (e) { return ""; }
}
const KEY = readKey();
if (!KEY) {
  console.error("未找到 Key：请把腾讯位置服务 Key 写入 tools/geocode.key，或设置环境变量 MAP_KEY");
  process.exit(1);
}

let cache = {}; let lastApiErr = "";
if (!FRESH) { try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) { cache = {}; } }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 匹配校验：防止「簋街夜市」被错配成「王府井夜市」这类名称相近但地点不同的结果。
// 规则：① 一方包含另一方 → 通过；② 最长公共子串占比 ≥0.6 → 通过；③ 否则拒绝（不写坐标，走城锚兜底）。
function coreOf(s) {
  return String(s || "").replace(/[（(【].*?[)）】]/g, "").replace(/[\s·、,，/|+]/g, "").trim();
}
function lcsLen(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const dp = new Array(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = n; j >= 1; j--) {
      if (a[i - 1] === b[j - 1]) { dp[j] = dp[j - 1] + 1; if (dp[j] > best) best = dp[j]; }
      else dp[j] = 0;
    }
  }
  return best;
}
function matchOk(keyword, title) {
  const k = coreOf(keyword), t = coreOf(title);
  if (!k || !t) return false;
  if (t.includes(k) || k.includes(t)) return true;
  const ratio = lcsLen(k, t) / Math.min(k.length, t.length);
  return ratio >= 0.6;
}
async function geocode(cityName, keyword) {
  const ck = cityName + "|" + keyword;
  if (cache[ck] !== undefined) return cache[ck];
  const _cen = (D.CITY_COORDS || {})[cityName] || [];
  if (PROVIDER === "amap" && _cen.length < 2) { cache[ck] = null; return null; }
  const url = PROVIDER === "amap"
    ? `${ENDPOINT}?location=${_cen[1]},${_cen[0]}&keywords=${encodeURIComponent(keyword)}&radius=50000&offset=1&page=1&key=${KEY}`
    : `${ENDPOINT}?keyword=${encodeURIComponent(keyword)}&boundary=region(${encodeURIComponent(cityName)},0)&page_size=1&key=${KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const _txt = await r.text();
    // 响应不是 JSON（阿里「比西」punish 页）= 行为风控拦截 → 立刻终止整轮，绝不重试
    if (isPunishPage(_txt)) { console.error(BAN_HINT); process.exit(3); }
    const j = JSON.parse(_txt);
    if (PROVIDER === "amap") {
      if (j.status === "1" && Array.isArray(j.pois) && j.pois.length) {
        const it = j.pois[0];
        const loc = String(it.location || "").split(",");
        const lat = +Number(loc[1]).toFixed(6), lon = +Number(loc[0]).toFixed(6);
        if (isFinite(lat) && isFinite(lon) && matchOk(keyword, it.name || "")) {
          const bx = it.biz_ext || {};
          const v = {
            lat, lon, title: it.name || "",
            // 高德返回的真实信息（不虚构）
            addr: it.adname ? String(it.adname) : "",
            openTime: String(bx.opentime2 || it.opentime2 || "").slice(0, 160),
            rating: String(bx.rating || ""),
            cost: String(bx.cost || "")
          };
          cache[ck] = v; return v;
        }
      }
      lastApiErr = String(j.info || j.infocode || "");
      cache[ck] = null; return null;
    }
    if (j.status === 0 && Array.isArray(j.data) && j.data.length) {
      const it = j.data[0];
      if (matchOk(keyword, it.title || "")) {
        const v = { lat: +Number(it.location.lat).toFixed(6), lon: +Number(it.location.lng).toFixed(6), title: it.title || "" };
        cache[ck] = v; return v;
      }
    }
    cache[ck] = null; return null;
  } catch (e) { return undefined; }   // 网络/限频：不写缓存，下次重试
}

// 收集待校正：城市锚点 + 每个城市的景点
const jobs = [];
for (const c of D.CITIES) {
  const name = c.name;
  const spots = new Set();
  (c.experiences || []).forEach(e => { const n = String(e.name || "").trim(); if (n) spots.add(n); });
  (D.SPOT_COORDS[name] || []).forEach(s => { if (s && s[0]) spots.add(String(s[0]).trim()); });
  spots.forEach(sp => jobs.push({ city: name, spot: sp }));
}
console.log("待校正条目:", jobs.length, "| 已有缓存:", Object.keys(cache).length);

let done = 0, hit = 0, miss = 0, fail = 0, consecQuota = 0;
const patch = {};
for (const job of jobs) {
  if (SKIP_FETCH) break;
  const _ck = job.city + "|" + job.spot;
  if (cache[_ck] !== undefined) continue;   // 已查过（含未命中的 null）→ 跳过，不占用本次额度
  if (LIMIT && done >= LIMIT) break;
  const r = await geocode(job.city, job.spot);
  if (r === null && /OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE|PLAT_NOMATCH/.test(lastApiErr)) consecQuota++; else consecQuota = 0;
  if (consecQuota >= 30) { console.log("\n本 key 配额疑似耗尽（连续 30 次超限），提前结束"); break; }
  done++;
  if (r === undefined) { fail++; await sleep(400); continue; }
  if (r) {
    hit++;
    (patch[job.city] = patch[job.city] || []).push([job.spot, r.lat, r.lon]);
  } else miss++;
  if (done % 20 === 0) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8"); process.stdout.write(`  已处理 ${done}/${jobs.length}  命中 ${hit}  未命中 ${miss}  失败 ${fail}\r`); }
  await sleep(230);   // 限频保护（高德 Web服务 QPS 限制，避免超额报错）
}
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
console.log(`\n完成：处理 ${done} | 命中 ${hit} | 未命中 ${miss} | 网络失败 ${fail}`);

// 生成补丁：① COORDS_SET（真实坐标）② SPOT_INFO（高德真实开放时间/评分/人均/地址，缺项不填，不虚构）
// 从「整个缓存」生成，而不是只取本次 patch 的条目（否则之前批次抓到的详情会漏掉）
const info = {};
Object.keys(cache).forEach(key => {
  const v = cache[key];
  if (!v) return;
  if (!v.openTime && !v.rating && !v.cost && !v.addr) return;
  const nm = key.slice(key.indexOf("|") + 1);
  if (!nm) return;
  info[nm] = {
    addr: v.addr || "",
    openTime: v.openTime || "",
    rating: v.rating || "",
    cost: v.cost || ""
  };
});
// v1.17.3 修复：COORDS_SET 改为「从整个缓存生成」，而不是只含本次查询结果。
// 原因：脚本每次运行都会重写本补丁，若只写本次 patch，一次未命中的运行就会把补丁清空，
//       导致补丁无法独立重建全库坐标（data.js 若需重建就会丢失全部校正成果）。
const coordsAll = {};
Object.keys(cache).forEach(key => {
  const v = cache[key];
  if (!v || v.lat == null) return;
  const i = key.indexOf("|");
  if (i < 0) return;
  const cn = key.slice(0, i), nm = key.slice(i + 1);
  if (!cn || !nm) return;
  (coordsAll[cn] = coordsAll[cn] || []).push([nm, v.lat, v.lon]);
});
const patchSrc = "// 自动生成：地图 API 离线校正后的真实坐标 + 真实信息（勿手改）\n// COORDS_SET 为全量（从整个缓存生成），可独立重建全库坐标\nmodule.exports = {\n  COORDS_SET: " + JSON.stringify(coordsAll, null, 1) + ",\n  SPOT_INFO: " + JSON.stringify(info, null, 1) + "\n};\n";
fs.writeFileSync(OUT_PATCH, patchSrc, "utf8");
console.log("补丁已生成:", OUT_PATCH, "| 覆盖城市:", Object.keys(patch).length);
console.log("下一步：node tools/merge-data-patch.mjs 后跑 ./allcheck.sh");
