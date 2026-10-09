// 一次性修复：还原被「两套键别名方案」污染的 data-packed.js。
//
// 背景（2026-10-02 白屏事故根因）：
//   历史上数据被反复增量 merge，同一座城市累积了「两份拷贝」：一份用大写方案别名（name→@A…），
//   一份用小写方案别名（name→@k…）。而 data.js 只能从一个 __A 映射还原（小写那套），
//   大写那套的反向映射丢失 → 大写拷贝的 CITIES[i].name 永远 undefined → 首页白屏。
//   同时 CITIES 条目由 ~751 被灌成 1082（重复）。
//
// 本脚本：
//   1) 用「合并映射」（大写码 + 小写码 → 同一长键）深度还原所有别名键；
//   2) CITIES 按城市名合并两份拷贝（字段并集 / 数组去重）；
//   3) 全树数组去重；对象重复键合并；
//   4) 删除 __A；输出干净数据（默认 dry-run 只打印统计，--write 才写 utils/data.js）。
//
// 用法：node tools/_repair-alias.mjs            # 干跑，看统计
//       node tools/_repair-alias.mjs --write    # 写 utils/data.js（供 pack-data 重新打包）
import fs from "fs";
import path from "path";
import zlib from "zlib";

const cwd = process.cwd();
const WRITE = process.argv.includes("--write");

// 合并映射：49 个别名码 → 长键（两套方案指向同一长键；由 tools/data-before-merge.bak.js 干净 schema 逐字段判定）
const MAP = {
  "@A": "name", "@B": "note", "@C": "period", "@D": "intro", "@E": "how",
  "@F": "lat", "@G": "price", "@H": "lon", "@I": "price", "@J": "experiences",
  "@K": "where", "@L": "book", "@M": "climate", "@N": "region", "@O": "cost",
  "@P": "areas", "@Q": "experiences", "@R": "province", "@S": "best", "@T": "foods",
  "@U": "foodNote", "@V": "travel", "@W": "cityTravel", "@X": "route", "@Y": "stayTip",
  "@Z": "limited", "@a": "spots",
  "@b": "tier", "@c": "place", "@d": "brands", "@e": "trains", "@f": "stns", "@g": "dur",
  "@h": "days", "@i": "hours", "@j": "reason",
  "@k": "name", "@l": "intro", "@m": "how", "@n": "route", "@o": "note", "@p": "province",
  "@q": "region", "@r": "climate", "@s": "cost", "@t": "areas", "@u": "limited",
  "@v": "where", "@w": "book"
};

const isPlainObj = (x) => x && typeof x === "object" && !Array.isArray(x);
// 规范化：递归排序对象键，使「键序不同但内容相同」的重复项可被识别
// （历史两套别名方案令同一字段的键序漂移，直接 JSON.stringify 会误判为不同）
function canon(o) {
  if (Array.isArray(o)) return o.map(canon);
  if (isPlainObj(o)) { const r = {}; for (const k of Object.keys(o).sort()) r[k] = canon(o[k]); return r; }
  return o;
}
const jx = (x) => JSON.stringify(canon(x));
function arrMerge(dst, src) { for (const x of src) if (!dst.some((y) => jx(y) === jx(x))) dst.push(x); }
function objMerge(dst, src) {
  for (const k of Object.keys(src)) {
    const dv = dst[k], sv = src[k];
    if (dv === undefined) dst[k] = sv;
    else if (Array.isArray(dv) && Array.isArray(sv)) arrMerge(dv, sv);
    else if (isPlainObj(dv) && isPlainObj(sv)) objMerge(dv, sv);
    else if ((dv === "" || dv === null) && sv !== "" && sv !== null) dst[k] = sv;
  }
  return dst;
}

// 深度还原别名键（同对象内出现多个别名指向同一长键时合并）
function rename(o) {
  if (Array.isArray(o)) return o.map(rename);
  if (isPlainObj(o)) {
    const r = {};
    for (const k of Object.keys(o)) {
      const nk = MAP[k] || k;
      const v = rename(o[k]);
      if (nk in r) {
        if (Array.isArray(r[nk]) && Array.isArray(v)) arrMerge(r[nk], v);
        else if (isPlainObj(r[nk]) && isPlainObj(v)) objMerge(r[nk], v);
        else if ((r[nk] === "" || r[nk] === null || r[nk] === undefined) && v !== "" && v !== null) r[nk] = v;
      } else r[nk] = v;
    }
    return r;
  }
  return o;
}

// 数组去重（深比较 JSON）
function dedupArr(a) {
  const seen = new Set(); const out = [];
  for (const x of a) { const j = jx(x); if (!seen.has(j)) { seen.add(j); out.push(x); } }
  return out;
}

// 载入受污染的 packed
const raw = fs.readFileSync(path.join(cwd, "subdata", "data", "data-packed.js"), "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const parsed = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
delete parsed.__A;

// 1) 全树还原
let D = rename(parsed);

// 2) CITIES 按名合并
const byName = new Map();
const dropped = [];
for (const c of (D.CITIES || [])) {
  const nm = c && (c.name || c.id);
  if (!nm) { dropped.push(c); continue; }
  if (byName.has(nm)) objMerge(byName.get(nm), c);
  else byName.set(nm, c);
}
const cities = [...byName.values()];
cities.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
D.CITIES = cities;

// 2b) 归位「用省名当城市键」的脏键（v195-fix-jilin-key.js 记录的吉林污染）。
//     仅保留直辖市/特别行政区（其名既是省也是城市）——其余省名键一律清除。
//     吉林市的雾凇岛/松花湖等已存在于 SPOT_COORDS["吉林市"]，故删除不丢数据。
const _MUNI = new Set(["北京", "天津", "上海", "重庆", "香港", "澳门"]);
const _provSet = new Set(Object.keys(D.PROVINCE_CITIES || {}));
let _dirty = 0;
for (const k of Object.keys(D.SPOT_COORDS || {})) {
  if (_provSet.has(k) && !_MUNI.has(k)) { delete D.SPOT_COORDS[k]; _dirty++; console.log("  删除脏省名键 SPOT_COORDS[" + k + "]"); }
}
for (const k of Object.keys(D.CITY2PROV || {})) {
  if (_provSet.has(k) && !_MUNI.has(k)) { delete D.CITY2PROV[k]; _dirty++; }
}
for (const p of Object.keys(D.PROVINCE_CITIES || {})) {
  if (Array.isArray(D.PROVINCE_CITIES[p])) D.PROVINCE_CITIES[p] = D.PROVINCE_CITIES[p].filter((c) => !(_provSet.has(c) && !_MUNI.has(c)));
}
console.log("脏省名键清理:", _dirty, "处");

// 2c) 恢复被破坏的 FOOD_SPOTS（当前全部退化为 {lat:0,lon:0,price:""}，店名/坐标丢失）
//     成因：历史键别名污染 + pack-data 瘦身只保留 shop 字段 → 店名被剥离、坐标归零。
//     从 09-12 packed 备份恢复（404 城带店名+坐标）；仅当现数据确实无店名时执行。
{
  const hasShop = (FS) => Object.keys(FS || {}).some((k) => (FS[k] || []).some((x) => x && x.shop));
  if (!hasShop(D.FOOD_SPOTS)) {
    const bak = path.join(cwd, "tools", "_bak-c1dca571", "data-packed.js");
    if (fs.existsSync(bak)) {
      const raw2 = fs.readFileSync(bak, "utf8");
      const b642 = raw2.slice(raw2.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
      const bakData = JSON.parse(zlib.inflateSync(Buffer.from(b642, "base64")).toString("utf8"));
      if (bakData.FOOD_SPOTS && hasShop(bakData.FOOD_SPOTS)) {
        D.FOOD_SPOTS = rename(bakData.FOOD_SPOTS);
        console.log("恢复 FOOD_SPOTS:", Object.keys(D.FOOD_SPOTS).length, "城（含店名+坐标）");
      }
    }
  }
}

// 3) 全树深度去重（含嵌套数组：SPOT_COORDS[城]、experiences、areas 等——本次白屏源头的重复就在嵌套层）
function deepDedup(o) {
  if (Array.isArray(o)) return dedupArr(o.map(deepDedup));
  if (isPlainObj(o)) { const r = {}; for (const k of Object.keys(o)) r[k] = deepDedup(o[k]); return r; }
  return o;
}
D = deepDedup(D);

// ---- 统计 ----
const remainCod = [];
(function scan(o) {
  if (Array.isArray(o)) { o.forEach(scan); return; }
  if (isPlainObj(o)) for (const k of Object.keys(o)) { if (/^@[A-Za-z0-9+\-=]$/.test(k)) remainCod.push(k); scan(o[k]); }
})(D);

const withName = D.CITIES.filter((c) => c && c.name).length;
console.log("原始 CITIES:", (parsed.CITIES || []).length, "→ 去重合并后:", D.CITIES.length);
console.log("有 name 的城市:", withName, "| 丢弃无名条目:", dropped.length);
console.log("CITIES[0]:", JSON.stringify(D.CITIES[0]).slice(0, 160));
console.log("残留别名码:", remainCod.length ? [...new Set(remainCod)].join(",") : "(无)");
console.log("顶层键数:", Object.keys(D).length);

if (WRITE) {
  fs.writeFileSync(path.join(cwd, "utils", "data.js"),
    "// 临时明文数据（由 _repair-alias.mjs 生成，供 pack-data 重新打包；pack-data 完成后会覆盖回加载器）\n" +
    "module.exports = " + JSON.stringify(D) + ";\n");
  console.log("已写入 utils/data.js（明文）");
} else {
  console.log("(dry-run，未写文件；加 --write 生效)");
}
