// 单测：分包数据「晚到」必须补跑表合并（v1.20.9 主包瘦身后的头号静默风险）
//
// 病情：住宿片区 / 逐酒店这两张表在 applyPacked() 内部的 phase-2 才合并，而它们的数据源
//   hotel-areas3.js 是后到的异步分块。到达时如果只做「赋值」不补跑 phase 2，结果不是报错、
//   不是白屏，而是「住哪儿」卡片悄悄不出现 —— 用户看到的是一个能用的攻略，没人会发现少东西。
//   同类坑历史上踩过两次（坐标修正覆盖层、团队美食合并），都是「晚到即丢」。
//
// 本单测用 vm 造一个「有 require.async、没有 process」的沙箱（= 微信真机形态），
// 控制四个分块的 resolve 顺序，覆盖 早到 / 晚到 两种时序，两种都必须与 Node 同步路径
// 逐字一致。这样以后谁把 _applyHotelAreas 里的 applyStaticTables(2) 删了，这里立刻判红。
import fs from "fs";
import path from "path";
import vm from "vm";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const UTILS = path.join(ROOT, "utils");
const nodeRequire = createRequire(path.join(UTILS, "_sandbox.js"));

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

const CHUNK = {
  d1: "../subdata/data/data-packed.js",
  d2: "../subdata2/data/data-packed2.js",
  food: "../subdata3/data/team-food3.js",
  hotel: "../subdata3/data/hotel-areas3.js"
};

// 计数口径：有 areas / hotelList 的城市数 + 条目总数 + 名称指纹
function snap(D) {
  const cities = D.CITIES || [];
  const areas = cities.reduce((s, c) => s + ((c && c.areas) || []).length, 0);
  const hl = cities.reduce((s, c) => s + ((c && c.hotelList) || []).length, 0);
  const names = cities.map((c) => (c && c.name) + "|" +
    ((c.areas || []).map((a) => a && a.name).join(",")) + "|" +
    ((c.hotelList || []).map((h) => h && h.name).join(",")));
  const sha = crypto.createHash("sha1").update(JSON.stringify(names)).digest("hex").slice(0, 16);
  return { cities: cities.length, areas, hl, sha };
}

/**
 * 造沙箱：require.async 存在（走微信分支）、process 不存在（_PACK_BASE_ONLY=false）、
 * 无 window（不走网页分支）。同步 require 直接用宿主 Node 的真模块 —— 但 _ha() 因为
 * require.async 存在会返回空表，正是真机行为。
 */
function boot() {
  const pending = new Map();
  const resol = (id) => {
    if (String(id).charAt(0) !== ".") throw new Error("沙箱拒绝加载外部模块: " + id);
    return nodeRequire(path.resolve(UTILS, id));
  };
  resol.async = (p) => new Promise((res, rej) => { pending.set(p, { res, rej }); });

  const quiet = { warn() {}, log() {}, error() {} };
  const ctx = vm.createContext({ console: quiet, setTimeout, clearTimeout });
  const src = fs.readFileSync(path.join(UTILS, "data.js"), "utf8");
  const fn = vm.runInContext("(function(module, exports, require){" + src + "\n})", ctx);
  const m = { exports: {} };
  fn(m, m.exports, resol);
  return { DATA: m.exports, pending, resol };
}

// 把某个分块的 promise 兑现（= 真机分包下载完成）
function arrive(env, key) {
  const p = env.pending.get(CHUNK[key]);
  if (!p) throw new Error("该分块未被 require.async 请求: " + CHUNK[key] + "（data.js 的静态字面量漏了？）");
  p.res(env.resol(CHUNK[key]));
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── 基准：Node 同步路径（宿主真 require，走文件底部同步块） ──
const REF = snap(nodeRequire(path.join(UTILS, "data.js")));
ck("基准：Node 同步路径住宿片区非空", REF.areas > 2000, "areas=" + REF.areas);
ck("基准：Node 同步路径逐酒店非空", REF.hl > 300, "hotelList=" + REF.hl);

/* ───── 场景 1：晚到（真机最常见的时序） ───── */
{
  const env = boot();
  const ready = env.DATA.initData();
  ck("微信形态下四个分块都被请求（静态字面量完整）",
    env.pending.size === 4, "请求数=" + env.pending.size);

  arrive(env, "d1"); arrive(env, "d2"); arrive(env, "food");
  await flush();
  const before = snap(env.DATA);
  ck("住宿分块到达前：城市已就绪", before.cities === REF.cities, "cities=" + before.cities);
  ck("住宿分块到达前：住宿片区尚未合并（复现真实时序）",
    before.areas < REF.areas, before.areas + " < " + REF.areas);

  arrive(env, "hotel");
  await ready;
  const after = snap(env.DATA);
  ck("晚到后住宿片区补合并 = Node 口径", after.areas === REF.areas, after.areas + " vs " + REF.areas);
  ck("晚到后逐酒店补合并 = Node 口径", after.hl === REF.hl, after.hl + " vs " + REF.hl);
  ck("晚到后全量指纹一致", after.sha === REF.sha, after.sha + " vs " + REF.sha);
}

/* ───── 场景 2：早到（分包先于数据块下载完，弱网/缓存命中时会真的发生） ───── */
{
  const env = boot();
  const ready = env.DATA.initData();
  arrive(env, "hotel");              // 先到，此时还没有城市可挂
  await flush();
  arrive(env, "d1"); arrive(env, "d2"); arrive(env, "food");
  await ready;
  const after = snap(env.DATA);
  ck("早到也不丢：住宿片区 = Node 口径", after.areas === REF.areas, after.areas + " vs " + REF.areas);
  ck("早到也不丢：逐酒店 = Node 口径", after.hl === REF.hl, after.hl + " vs " + REF.hl);
  ck("早到也不丢：全量指纹一致", after.sha === REF.sha, after.sha + " vs " + REF.sha);
}

/* ───── 场景 3：分块缺失要能重试（不能把 __dataReady 卡死在残数据上） ───── */
{
  const env = boot();
  const ready = env.DATA.initData();
  arrive(env, "d1"); arrive(env, "d2"); arrive(env, "food");
  env.pending.get(CHUNK.hotel).rej(new Error("模拟分包下载失败"));
  await ready;
  ck("住宿分块失败：数据仍标记就绪（降级可用，不白屏）", env.DATA.__dataReady === true);
  ck("住宿分块失败：城市数据完好", (env.DATA.CITIES || []).length === REF.cities);
}

/* ───── 结构防回潮：文件位置与 require 形态 ───── */
const mainPath = path.join(UTILS, "hotel-areas.js");
ck("住宿数据已不在主包（防 274KB 回潮）", !fs.existsSync(mainPath),
  "utils/hotel-areas.js 又出现了，主包会被顶破");
const subPath = path.join(ROOT, "subdata3", "data", "hotel-areas3.js");
const sz = fs.existsSync(subPath) ? fs.statSync(subPath).size : 0;
ck("住宿数据在 subdata3 且体量正常", sz > 200 * 1024, Math.round(sz / 1024) + "KB");

const dataSrc = fs.readFileSync(path.join(UTILS, "data.js"), "utf8")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
ck("data.js 无顶层同步 require 住宿数据", !/^[^/]*require\(\s*["']\.\/hotel-areas\.js/m.test(dataSrc));
ck("data.js 以静态字面量异步请求住宿分块",
  /require\.async\(\s*["']\.\.\/subdata3\/data\/hotel-areas3\.js["']\s*\)/.test(dataSrc));
ck("到达后确实补跑 phase-2 表合并", /function _applyHotelAreas[\s\S]{0,400}?applyStaticTables\(2\)/.test(dataSrc));
const srcDup = fs.readFileSync(path.join(ROOT, "tools/_src-backup/data.js"), "utf8");
ck("手写双源字节一致", srcDup === fs.readFileSync(path.join(UTILS, "data.js"), "utf8"));

console.log("\n" + (fail === 0 ? "全部通过" : "有失败项") + `：${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
