import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
// v1.9.0 数据补丁合并器：data.js(现有) + tools/v190-*.js(补丁) → data.js(合并结果)
// 用法: node tools/merge-data-patch.mjs   （在项目根目录运行）
// 补丁文件约定（CommonJS，module.exports 为对象，可含下列键）：
//   CITIES_ADD : [{完整城市对象}]           —— 按 id 覆盖/新增进 CITIES
//   EXP_REPLACE: {城名:[{from,to:{...}}]}   —— 替换 city.experiences 中 name===from 的条目（无则追加 to）
//   EXP_REMOVE : {城名:[names]}             —— 从 experiences 移除这些 name
//   LM_ADD     : {城名:[具体景点名]}         —— 追加进 CITY_LANDMARKS_EXTRA[城名]（不重复）
//   LM_REMOVE  : {城名:[名字]}              —— 从全部 landmark 库移除该名字
//   COORDS_ADD : {城名:[[名,lat,lng]]}      —— 追加进 SPOT_COORDS[城名]（按名去重，同名已存在则跳过）
//   COORDS_SET : {城名:[[名,lat,lng]]}      —— 覆盖/upsert SPOT_COORDS[城名]（同名替换为新值，常用于旧粗坐标升级）
//   TICKET_ADD : {景名:"票价文案"}
//   DETAIL_ADD : {景名:{intro,how,route:[]}}
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ = process.cwd();
const DATA = join(PROJ, "utils", "data.js");
const PATCH_DIR = join(__dir);
const BAK = join(__dir, "data-before-merge.bak.js");

if (!existsSync(DATA)) { console.error("❌ 请在项目根运行"); process.exit(1); }

// v1.17：data.js 已改为「压缩存储 + 运行时解压」格式，不再是 JSON 字面量，
// 因此不能用正则截取后 JSON.parse，改为直接 require 拿到数据对象。
const base = (() => {
  try {
    return { ...(req(process.cwd() + "/utils/data.js")) };
  } catch (e) {
    console.error("❌ 读取 data.js 失败：", e.message);
    process.exit(1);
  }
})();
const patches = readdirSync(PATCH_DIR).filter(f => /^v19\d-.*\.js$/.test(f)).sort();
if (!patches.length) { console.error("❌ 无补丁文件"); process.exit(1); }
const P = {};
for (const f of patches) {
  const m = { ...(await import("file://" + join(PATCH_DIR, f))) }.default;
  for (const k of Object.keys(m)) (P[k] = P[k] || []).push(...(Array.isArray(m[k]) ? m[k] : [m[k]]));
  console.log("  patch:", f);
}
const pick = k => P[k] || [];
const dedupe = arr => { const s = new Set(); return arr.filter(x => { const k = String(x); if (s.has(k)) return false; s.add(k); return true; }); };
const _cnt = () => base.CITIES.reduce((s,c)=>s+(c.experiences||[]).length,0);
const _log = (tag) => console.error(`[DBG] ${tag}: experiences=${_cnt()}`);

// 1) CITIES_ADD
for (const city of pick("CITIES_ADD")) {
  const i = base.CITIES.findIndex(c => c.id === city.id || c.name === city.name);
  if (i >= 0) base.CITIES[i] = city; else base.CITIES.push(city);
}
// 2) EXP_REPLACE / EXP_REMOVE（幂等：from 已不存在且 to 已存在时跳过，避免重放补丁造成重复）
const expByCity = {};
for (const c of base.CITIES) expByCity[c.name] = c.experiences || (c.experiences = []);
for (const m of pick("EXP_REPLACE")) {
  for (const cn of Object.keys(m)) {
    const arr = expByCity[cn]; if (!arr) continue;
    for (const { from, to } of m[cn]) {
      const i = arr.findIndex(e => e.name === from);
      if (i >= 0) arr[i] = to;
      else if (!arr.some(e => e.name === to.name)) arr.push(to);
    }
  }
  _log("  EXP_REPLACE patch applied keys=" + Object.keys(m).join(",") + " -> " + _cnt());
}
_log("after EXP_REPLACE only: " + _cnt());
for (const m of pick("EXP_REMOVE")) for (const cn of Object.keys(m)) {
  const arr = expByCity[cn]; if (!arr) continue;
  for (const nm of m[cn]) { const i = arr.findIndex(e => e.name === nm); if (i >= 0) arr.splice(i, 1); }
}
_log("after EXP_REPLACE/EXP_REMOVE: " + _cnt());
// 3) LM_REMOVE → 全部 landmark 库（先清理：移除已转正进 experiences 的名字）。
//    ⚠️ 必须在 LM_ADD 之前执行：否则 LM_REMOVE 会把"本次新增、尚未转正"的景点从 fallback 池误删，
//    与 LM_ADD 互相抵消（表现为 CITY_LANDMARKS_EXTRA 数量归零、真实 POI 落不进库）。
const LM_LIBS = ["CITY_LANDMARKS", "CITY_LANDMARKS_EXTRA", "CITY_LANDMARKS_EXTRA2", "CITY_LANDMARKS_EXTRA3", "CITY_LANDMARKS_EXTRA4", "CITY_LANDMARKS_EXTRA5", "CITY_LANDMARKS_EXTRA6"];
for (const m of pick("LM_REMOVE")) for (const cn of Object.keys(m)) {
  const del = new Set(m[cn]);
  for (const lib of LM_LIBS) {
    const arr = base[lib] && base[lib][cn];
    if (arr) base[lib][cn] = arr.filter(x => !del.has(x));
  }
}
// 3b) LM_ADD → CITY_LANDMARKS_EXTRA（在 LM_REMOVE 之后，确保本次新增景点不被"已转正"清理误删）
for (const m of pick("LM_ADD")) for (const cn of Object.keys(m)) {
  if (!base.CITY_LANDMARKS_EXTRA[cn]) base.CITY_LANDMARKS_EXTRA[cn] = [];
  base.CITY_LANDMARKS_EXTRA[cn] = dedupe(base.CITY_LANDMARKS_EXTRA[cn].concat(m[cn]));
}
_log("after LM_REMOVE/LM_ADD: " + _cnt());
// 4) COORDS_ADD（按名追加，同名已存在则跳过——用于新收录）
for (const m of pick("COORDS_ADD")) for (const cn of Object.keys(m)) {
  if (!base.SPOT_COORDS[cn]) base.SPOT_COORDS[cn] = [];
  const exist = new Set(base.SPOT_COORDS[cn].map(s => s[0]));
  for (const s of m[cn])     if (s && s[0] && !exist.has(s[0])) { base.SPOT_COORDS[cn].push(s); exist.add(s[0]); }
}
// 4b) COORDS_SET（按名覆盖/upsert——用于把旧的粗坐标/示意坐标替换为腾讯地图精确值；幂等）
for (const m of pick("COORDS_SET")) for (const cn of Object.keys(m)) {
  if (!base.SPOT_COORDS[cn]) base.SPOT_COORDS[cn] = [];
  const arr = base.SPOT_COORDS[cn];
  for (const s of m[cn]) {
    if (!s || !s[0]) continue;
    const i = arr.findIndex(x => x && x[0] === s[0]);
    if (i >= 0) arr[i] = s; else arr.push(s);
  }
}
// 4c) COORDS_DROP : {城名:[景名]} —— 从 SPOT_COORDS[城名] 移除这些景名；删空则删除整个键
//     用于修正「省名误作城市键」的脏数据（如「吉林」键应归「吉林市」，避免 getSpotCoord 省域查找被劫持）
for (const m of pick("COORDS_DROP")) for (const cn of Object.keys(m)) {
  const arr = base.SPOT_COORDS[cn]; if (!arr) continue;
  const del = new Set(m[cn]);
  base.SPOT_COORDS[cn] = arr.filter(s => !(s && del.has(s[0])));
  if (!base.SPOT_COORDS[cn].length) delete base.SPOT_COORDS[cn];
}
// 4d) CITY2PROV_DROP : [城名] —— 删除 CITY2PROV 里的脏键（省名自映射等）
for (const cn of pick("CITY2PROV_DROP")) delete base.CITY2PROV[cn];
// 4f) ID_REKEY : [{from,to,libs?}] —— 迁移「按城市 id 索引」结构里的键。
//     修复「城市 id 改名后忘记迁移其附属数据」的历史脏数据：
//     苏州 id 由 suzhou 改为 suzhou_jiangsu 时，HOTELS/EXTRA_SPOTS 的 suzhou 键未同步迁移，
//     导致占用 suzhou 的宿州错拿了苏州的酒店与候选景点（宿州行程里出现留园/狮子林/盘门）。
const ID_LIBS = ["HOTELS", "EXTRA_SPOTS", "EXTRA_SPOTS2", "EXTRA_SPOTS3", "EXTRA_SPOTS4", "EXTRA_SPOTS5"];
for (const m of pick("ID_REKEY")) {
  if (!m || !m.from || !m.to) continue;
  const libs = Array.isArray(m.libs) && m.libs.length ? m.libs : ID_LIBS;
  for (const lib of libs) {
    const o = base[lib];
    if (!o || !(m.from in o)) continue;
    if (!(m.to in o)) o[m.to] = o[m.from];   // 目标键无数据 → 直接搬迁
    delete o[m.from];                        // 源键交还给真正占用它的城市
  }
  console.log("  id-rekey:", m.from, "→", m.to);
}
// 4e) PROV_CITIES_DROP : {省名:[城市名]} —— 从 PROVINCE_CITIES[省名] 移除脏城市名
for (const m of pick("PROV_CITIES_DROP")) for (const pn of Object.keys(m)) {
  const arr = base.PROVINCE_CITIES[pn]; if (!arr) continue;
  const del = new Set(m[pn]);
  base.PROVINCE_CITIES[pn] = arr.filter(c => !del.has(c));
}
_log("after COORDS: " + _cnt());
// 5) TICKET_ADD / DETAIL_ADD
for (const m of pick("TICKET_ADD")) Object.assign(base.SPOT_TICKETS, m);
for (const m of pick("DETAIL_ADD")) Object.assign(base.SPOT_DETAILS, m);
// 5b) v1.16 SPOT_INFO：地图 POI 返回的真实开放时间/评分/人均/地址（缺项为空，不虚构）
for (const m of pick("SPOT_INFO")) {
  if (!base.SPOT_INFO) base.SPOT_INFO = {};
  Object.assign(base.SPOT_INFO, m);
}
// 6) v1.10 扩容注入：城市中心坐标 / 省-市表 / 城市归属省 / 省城美食表
for (const m of pick("CITY_COORDS_ADD")) for (const cn of Object.keys(m)) base.CITY_COORDS[cn] = m[cn];
for (const m of pick("PROV_CITIES_ADD")) for (const pn of Object.keys(m)) {
  if (!base.PROVINCE_CITIES[pn]) base.PROVINCE_CITIES[pn] = [];
  base.PROVINCE_CITIES[pn] = dedupe(base.PROVINCE_CITIES[pn].concat(m[pn]));
}
for (const m of pick("CITY2PROV_ADD")) Object.assign(base.CITY2PROV, m);
for (const m of pick("PROV_FOODS_ADD")) for (const cn of Object.keys(m)) {
  if (!base.PROVINCE_CITY_FOODS[cn]) base.PROVINCE_CITY_FOODS[cn] = [];
  base.PROVINCE_CITY_FOODS[cn] = dedupe(base.PROVINCE_CITY_FOODS[cn].concat(m[cn]));
}
// 7) EXTRA_ADD：精编城候选景池（按城市 id 进 EXTRA_SPOTS，供 加景点/换方案/想玩候选 使用）
for (const m of pick("EXTRA_ADD")) for (const id of Object.keys(m)) {
  if (!base.EXTRA_SPOTS[id]) base.EXTRA_SPOTS[id] = [];
  base.EXTRA_SPOTS[id] = dedupe(base.EXTRA_SPOTS[id].concat(m[id]));
}
// 8) FOOD_SPOTS_ADD：地道名店（按城市名追加，按 shop 名去重）
for (const m of pick("FOOD_SPOTS_ADD")) for (const cn of Object.keys(m)) {
  if (!base.FOOD_SPOTS[cn]) base.FOOD_SPOTS[cn] = [];
  const exist = new Set(base.FOOD_SPOTS[cn].map(s => s && s.shop));
  for (const s of m[cn]) if (s && s.shop && !exist.has(s.shop)) { base.FOOD_SPOTS[cn].push(s); exist.add(s.shop); }
}

_log("before §9 dedup: " + _cnt());
// 9) v1.19 体验去重：每个城市的 experiences 按 cleanSpotName 归一，同一清洗名只保留 1 条
//    （优先「裸名/最短」，如 纯阳宫 而非 纯阳宫（山西省艺术博物馆））。
//    原因：planner 按清洗名去重时会把「纯阳宫」与「纯阳宫（山西省艺术博物馆）」判为同一景点跨天重复；
//    地标池转正（v198/v199）可能把带括号的写法也转正进 experiences，造成清洗名碰撞。
//    该步放在所有补丁之后，保证任意补丁组合（含重复转正）最终数据都干净，且幂等（无碰撞时不影响）。
{
  const T = req("./utils/travel.js");
  const clean = (n) => (T && T.cleanSpotName) ? T.cleanSpotName(n) : String(n || "").replace(/[（(].*?[）)]/g, "").trim();
  let removed = 0;
  for (const c of base.CITIES) {
    const exps = c.experiences;
    if (!Array.isArray(exps) || !exps.length) continue;
    const groups = new Map();
    exps.forEach(e => { const n = (e && (e.name || e.t)) || ""; const k = clean(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    if (groups.size === exps.length) continue; // 无碰撞，跳过
    const out = [];
    for (const [, arr] of groups) {
      const canon = arr.filter(e => { const n = (e && (e.name || e.t)) || ""; return clean(n) === n; });
      const best = (canon.length ? canon : arr).slice().sort((a, b) => ((a.name || "").length) - ((b.name || "").length))[0];
      out.push(best);
      removed += arr.length - 1;
    }
    c.experiences = out;
  }
  if (removed) console.log("  experiences 去重（清洗名碰撞）:", removed, "条");
_log("after §9 dedup: " + _cnt());
}

// 写出
const json = JSON.stringify(base);
const header = `// 由 merge-data-patch.mjs 合并生成：data.js + tools/v190-*.js（勿手改，改数据请改补丁再合并）。\n// 重新生成: node tools/merge-data-patch.mjs（若重跑 export-data.mjs 会还原，需再跑本合并）\n// 数据总字节: ${json.length}\n`;
writeFileSync(BAK, "module.exports = " + JSON.stringify(base) + "\n");
writeFileSync(DATA, header + "module.exports = " + json + "\n");
console.log("✅ 合并完成 →", DATA, `(${json.length} 字节)`);
console.log("   CITIES:", base.CITIES.length, "| SPOT_COORDS 覆盖城:", Object.keys(base.SPOT_COORDS).length, "| 总坐标条数:", Object.values(base.SPOT_COORDS).reduce((a, b) => a + b.length, 0));
