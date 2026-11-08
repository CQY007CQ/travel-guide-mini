// 为「官方名录」新增景点补真实坐标：高德「地理编码」v3/geocode/geo
//   —— 属「地图与定位类」配额（个人认证 5000/日/Key），与搜索类（place/text 100/日）独立，故可批量。
// 铁律：坐标只来自真实 API 返回，绝不捏造；校验不过（偏离本城池心 >150km）一律丢弃，退回城锚兜底。
// 用法： node tools/geocode-official.mjs [--budget N] [--cities 广州,深圳] [--dry]
// 产出： tools/v201-official-coords.js  { COORDS_ADD }  → _apply-safe.mjs 合并
// 缓存： tools/geocode-official-cache.json（断点续传）
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");

const args = process.argv.slice(2);
const BUDGET = (() => { const i = args.indexOf("--budget"); return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 0; })();
const CITY_FILTER = (() => { const i = args.indexOf("--cities"); return i >= 0 ? args[i + 1].split(",").map(s => s.trim()).filter(Boolean) : null; })();
const DRY = args.includes("--dry");

// key 池：只接受 28~40 位字母数字整行（与其它 geocode 脚本同一规则）。
// 旧版仅过滤 # 开头的行，任何非注释的说明文字都会被当成 key 发出请求；
// 空池时也必须 fail-closed（非 0 退出、零网络请求）。
const keys = (() => { try { return fs.readFileSync("tools/geocode.keys", "utf8"); } catch (e) { return ""; } })().split(/\r?\n/).map(s => s.trim())
  .filter(s => /^[a-zA-Z0-9]{28,40}$/.test(s));
if (!keys.length) { console.error("无可用 key（tools/geocode.keys）：请检查 key 池，勿发出空 key 请求"); process.exit(1); }
let ki = 0; const nextKey = () => keys[(ki++) % keys.length];

// base：以 data-packed.js 的 SPOT_COORDS / CITY_COORDS 判断已覆盖
// v1.20：大数据包已拆到分包，utils/data-packed.js 不再存在（保留兼容回退）
const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const v200 = req("./tools/v200-official-import.js");
let v201 = {};
try { v201 = req("./tools/v201-official-coords.js"); } catch (e) { /* 首批无 */ }
const CITY_COORDS = D.CITY_COORDS || {};
const have = {};  // city\0name -> true（含已生成的 v201）
for (const cn in (D.SPOT_COORDS || {})) (D.SPOT_COORDS[cn] || []).forEach(x => { if (x && x[0]) have[cn + "\u0000" + x[0]] = true; });
for (const cn in (v201.COORDS_ADD || {})) (v201.COORDS_ADD[cn] || []).forEach(x => { if (x && x[0]) have[cn + "\u0000" + x[0]] = true; });

// 待补：(city,name) 来自 v200 新增景点
// v1.20：除官方名录(v200)外，「池名转正」(v198) 与「高德新抓取」(v199) 的景点同样需要真实坐标。
// 此前只扫 v200，导致「转正进 experiences 但没有精确坐标」的景点只能退回城锚兜底（导航差几百米）。
let v198 = {}; try { v198 = req("./tools/v198-landmark-promote.js"); } catch (e) { v198 = {}; }
let v199 = {}; try { v199 = req("./tools/v199-amap-spots.js"); } catch (e) { v199 = {}; }
// v199 抓取时已带高德真实坐标 → 记为已覆盖，避免对同一景点再做一次地理编码（省配额）
const hasCoord = {};
for (const cn in (v199.COORDS_ADD || {})) (v199.COORDS_ADD[cn] || []).forEach(x => { if (x && x[0]) hasCoord[cn + "\u0000" + x[0]] = true; });

const jobs = [];
const seen = new Set();
const pushJob = (cn, nm) => {
  if (!nm) return;
  if (CITY_FILTER && !CITY_FILTER.includes(cn)) return;
  if (have[cn + "\u0000" + nm] || hasCoord[cn + "\u0000" + nm]) return;
  const k = cn + "\u0000" + nm; if (seen.has(k)) return; seen.add(k);
  jobs.push({ city: cn, name: nm });
};
for (const cn in (v200.EXP_REPLACE || {})) for (const { to } of v200.EXP_REPLACE[cn]) pushJob(cn, to && to.name);
for (const cn in (v198.EXP_REPLACE || {})) for (const { to } of v198.EXP_REPLACE[cn]) pushJob(cn, to && to.name);
for (const cn in (v199.EXP_REPLACE || {})) for (const { to } of v199.EXP_REPLACE[cn]) pushJob(cn, to && to.name);
for (const cn in (v199.LM_ADD || {})) for (const nm of v199.LM_ADD[cn]) pushJob(cn, nm);
console.log("待补坐标景点:", jobs.length, "| key 数:", keys.length, CITY_FILTER ? `| 限城 ${CITY_FILTER.length}` : "");

const CACHE = "tools/geocode-official-cache.json";
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) { cache = {}; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function hav(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let overLimit = 0;
async function geo(city, name) {
  const ck = city + "|" + name;
  if (cache[ck] !== undefined) return cache[ck];
  const anchors = [];
  const addrCands = [city + name, name];
  for (const addr of addrCands) {
    const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(addr)}&city=${encodeURIComponent(city)}&key=${nextKey()}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
      const j = await r.json();
      if (j.status !== "1") {
        if (/OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE/.test(String(j.info))) overLimit++;
        continue;
      }
      const g = (j.geocodes || [])[0];
      if (!g || !g.location) continue;
      const [lngS, latS] = String(g.location).split(",");
      const lat = +(+latS).toFixed(6), lon = +(+lngS).toFixed(6);
      if (!(lat > -90 && lat < 90 && lon > -180 && lon < 180)) continue;
      // 校验：落在本城池心 150km 内。
      // 注：直辖市(city=CITY_COORDS 有值)、地级市均适用；超出即视为错配，丢弃。
      const anchor = CITY_COORDS[city];
      if (anchor && hav(lat, lon, anchor[0], anchor[1]) > 150) continue;
      const v = { lat, lon, addr: String(g.formatted_address || "") };
      cache[ck] = v; return v;
    } catch (e) { return undefined; }  // 网络/超时：不写缓存，下次重试
  }
  cache[ck] = null; return null;
}

const COORDS_ADD = {};
if (v201.COORDS_ADD) for (const cn in v201.COORDS_ADD) COORDS_ADD[cn] = v201.COORDS_ADD[cn].slice();
let done = 0, hit = 0, miss = 0, fail = 0;
for (const job of jobs) {
  if (BUDGET && done >= BUDGET) break;
  const ck = job.city + "|" + job.name;
  if (cache[ck] !== undefined) { /* 已有缓存：直接采纳 */ }
  else {
    const r = await geo(job.city, job.name);
    if (r === undefined) { fail++; await sleep(400); continue; }
    done++;
    if (done % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); process.stdout.write(`  处理 ${done}/${jobs.length} 命中 ${hit} 未命中 ${miss} 失败 ${fail}\r`); }
    await sleep(120);
  }
  const v = cache[ck];
  if (v && v.lat != null) { (COORDS_ADD[job.city] = COORDS_ADD[job.city] || []).push([job.name, v.lat, v.lon]); hit++; }
  else miss++;
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

const out = "// 自动生成：官方名录新增景点真实坐标（高德 geocode/geo，非捏造）\nmodule.exports = {\n  COORDS_ADD: " + JSON.stringify(COORDS_ADD, null, 1) + "\n};\n";
if (!DRY) fs.writeFileSync("tools/v201-official-coords.js", out);
let tot = 0; for (const cn in COORDS_ADD) tot += COORDS_ADD[cn].length;
console.log(`\n本次调用 ${done} | 命中 ${hit} | 未命中 ${miss} | 网络失败 ${fail} | 超限计数 ${overLimit}`);
console.log((DRY ? "(dry) " : "写出 tools/v201-official-coords.js ") + "| COORDS_ADD 累计:", tot);
