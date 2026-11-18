// tools/data/geocode-runner.mjs
// 统一坐标富集引擎（仅 v3/geocode/geo，合规）。
//
// 设计目标：在「9 把来自团队不同实名账号」的约束下，安全、合规地补齐小程序缺坐标数据。
// 合规要点（避免重蹈 2026-09-14 封禁 —— 其根因是「多 KEY 轮换绕过配额 + 批量 place/text 落盘」）：
//   1) 按天轮换、每次只用一把 key：dayIndex = floor(now/86400000) % nKeys。
//      每天只消耗【单个账号】的合法额度，无「同日多 key 规避单账号配额」特征（高德协议 3.7 风控重点）。
//      9 把 key 的价值 = 9 天的合法额度轮转 + 单把被限流时的自然错峰，而非「9 倍并发吞吐」。
//   2) 每把 key 独立熔断：命中 10044/10003(配额尽) 或 10026(账号封禁) -> 当天立即停手，
//      绝不同日切换其他 key（切换 = 规避配额）。次日 dayIndex 自然落到下一把。
//   3) 只走 geocode/geo：这是 place/text 封禁后官方仍放行、且被 _amap-compliance 显式列为替代方案的
//      唯一批量通道；不碰搜索类（place/text/around/inputtips，共享 100/日、无增益、批量落盘踩 3.5）。
//   4) 只补坐标、不存 POI 属性：geocode 返回「名->坐标」，存坐标是 geocode 的合法用途；
//      菜单/评分/房价/具体酒店地址属 POI 数据，批量落盘违反 3.5，须走编辑整理 / OSM / 用户投稿管线。
//   5) 路由经 _amap-compliance.mjs：拒绝已封 key、识别阿里「比西」punish 页、账号级封禁即熔断。
//
// 域名（domain）：
//   scenic —— 景点缺坐标（EXTRA_SPOTS*/CITY_LANDMARKS*/SPOT_DETAILS_BY_CITY），闸门 150km
//   food   —— 美食店缺坐标（FOOD_SPOTS 缺 lat/lon 的店），闸门 30km（店名解析更不稳，收紧）
//
// 用法：
//   node tools/data/geocode-runner.mjs [--domain=scenic|food|all] [--budget=N] [--dry-run] [--list] [--key-index=N]
//   （须在宿主网络运行：沙盒禁出网，restapi.amap.com 不可达；用 Bash dangerouslyDisableSandbox:true）
//
// ── 补齐「无 pin 美食店」完整作业手册（v1.20.28 核对口径后写定）────────────────────
// 现状（以 `node tools/data/geocode-runner.mjs --domain=food --list` 为准，别信记忆里的旧数）：
//   680 家 = 基数据带 (0,0) 占位 298 家 + 团队美食块无坐标 382 家。
//   这两类以前 **runner 全都漏掉**：基数据那批被 `typeof lat === "number"` 判成「有坐标」，
//   团队那批根本不在 data-packed 里（运行时才 upsert）。所以 `--list` 长期报「待补 0 条」。
//
// ① 拿一把合规 KEY（只有这一步需要本人，约 5 分钟）
//    - 高德开放平台用**你本人实名**账号登录 → 控制台 → 应用管理 → 创建新应用
//      （名称随便，如「旅行攻略生成器-离线数据」）。
//    - 该应用下「添加 Key」→ **服务平台必须选「Web服务」**（不是「微信小程序」：后者绑 AppID、
//      只能 wx.request 调，本仓是离线脚本；也不是「Web端(JS API)」，那是给浏览器地图用的）。
//    - 复制那串 32 位 key，**追加一行**到 `tools/geocode.keys`（该文件不进 git，权限 600）。
//    - 不要在这一步开搜索类接口：`place/text` 是 2026-09-14 封禁依据（协议 4.12.3），本 runner 也硬拦。
//    - 合规边界（协议原文，不是建议）：3.1 个人认证仅限个人研究学习 —— 小程序已上线属生产用途，
//      严格口径要走企业认证/商用授权；3.5 禁止落盘 POI 属性，所以这里**只存坐标**，不存菜单/评分/地址。
//
// ② 按天跑（每把 key 每天只用一次，单次预算 2000，刻意远离 5000 硬上限）
//    node tools/data/geocode-runner.mjs --domain=food --budget=2000
//    - 680 条 1~2 天跑完（每条约 0.5s 请求 + 0.12s 间隔，一轮 15~25 分钟）。
//    - 命中率现实预期 30~50%：geocode 认的是**地址**，店名能解析的有限，闸门 30km 只拦跨城误命。
//    - 熔断即停：10044/10003（配额尽）或 10026（账号封禁）当天立刻停手，绝不同日换 key 绕过配额；
//      次日 dayIndex 自动落到下一把。
//    - 结果写 `tools/data/v206-food-coords.js` 的 FOOD_COORDS_ADD（幂等合并，NetNew=0 就别打包）。
//
// ③ 落地（坐标进包的三步，缺一不可）
//    node tools/build/_apply-safe.mjs   → 写进 utils/data.js 的 FOOD_COORDS_V206 标记块
//    node tools/data/pack-data.mjs      → 重打包（否则白屏）
//    bash allcheck.sh                   → 全绿再升版
//    **团队那 382 家是关键**：它们是异步分块晚到的，utils/data.js 的 `_applyTeamFood3` 里
//    必须补跑 `applyStaticTables(1, "foodCoord")`，否则补丁找不到店 → 静默丢弃（护栏 _test-late-chunk 场景 4）。
//
// ④ 命中不了的怎么办（不伪造是红线）
//    - 交给分支机真实采集（团队采集管线会把坐标带回来，落 `tools/team/team-region-*.json`
//      → `node tools/data/_merge-team-enrich.mjs --pack`）；
//    - 或维持现状：无坐标店只做「列表展示、不生成地图 pin」，界面上明确写「该店暂无坐标」。
//
// 注意：本文件只做「离线富集」—— 结果写入 v201(景点)/v206(美食) 补丁，由 _apply-safe 合并进包；
//   小程序运行时仍零 key。

import fs from "node:fs";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { isRevokedKey, isPunishPage, isAccountBanned, infocodeOf } from "./_amap-compliance.mjs";
import { isCoveredByName } from "./lib-near-dup.mjs";

const DAY_MS = 86400000;
const GATE_KM = { scenic: 150, food: 30 };
const DEFAULT_BUDGET = 2000;     // 单把 key 当日上限，远低于 geocode/geo 的 5000，留足余量
const PER_KEY_HARD_CAP = 5000;   // 高德 geocode/geo 单账号日配额（独立，非搜索类共享 100）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hav = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLa = (lat2 - lat1) * Math.PI / 180;
  const dLo = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

function loadKeys() {
  let raw = "";
  try { raw = fs.readFileSync("tools/geocode.keys", "utf8"); } catch (e) { raw = ""; }
  const all = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9]{28,40}$/.test(s));
  const live = all.filter((k) => !isRevokedKey(k));
  return { all, live, dead: all.length - live.length };
}

function loadData() {
  const PACKED = "subdata/data/data-packed.js";
  const raw = fs.readFileSync(PACKED, "utf8");
  const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}

// ---- 景点缺坐标收集（与历史 _geocode-all-missing 口径一致）----
function gatherScenic(D, haveSet) {
  const PY2CN = {};
  for (const c of (D.CITIES || [])) { if (c && c.id && c["@A"]) PY2CN[c.id] = c["@A"]; }
  // 省名规范化：部分源数据（CITY_LANDMARKS["吉林"]）用「省名简称」当城市键，
  // 但 CITY_COORDS / SPOT_DETAILS_BY_CITY 用的是「市」全名（吉林市）。若直接按省名 geocode 并写回
  // SPOT_COORDS["吉林"]，pack-data 的「脏省名键清理」会整条删掉（防省域解析串城），导致坐标永远进不了包、
  // 每天补全都显示 NET_NEW=0。这里把「省名简称且有对应 市 坐标」的键归一化为市全名，使坐标落到持久键上。
  const _MUNI = new Set(["北京", "天津", "上海", "重庆", "香港", "澳门"]);
  const _prov = D.PROVINCE_CITIES || {};
  const normCity = (c) => {
    if (!c || _MUNI.has(c)) return c;
    if (_prov[c] && D.CITY_COORDS && D.CITY_COORDS[c + "市"]) return c + "市";
    return c;
  };
  const jobs = [];
  const seen = new Set();
  let fuzzyCovered = 0;
  const push = (city, name) => {
    city = normCity(city);
    if (!city || !name) return;
    const k = city + " " + name;
    if (haveSet.has(k) || seen.has(k)) return;
    if (isCoveredByName(D.SPOT_COORDS && D.SPOT_COORDS[city], name)) { fuzzyCovered++; return; }
    seen.add(k);
    jobs.push({ city, name });
  };
  for (const f of ["EXTRA_SPOTS", "EXTRA_SPOTS2", "EXTRA_SPOTS3", "EXTRA_SPOTS4", "EXTRA_SPOTS5"]) {
    const obj = D[f];
    if (!obj) continue;
    for (const pk in obj) { const cn = PY2CN[pk]; if (!cn) continue; for (const nm of (obj[pk] || [])) push(cn, nm); }
  }
  for (const f of ["CITY_LANDMARKS", "CITY_LANDMARKS_EXTRA", "CITY_LANDMARKS_EXTRA2", "CITY_LANDMARKS_EXTRA3", "CITY_LANDMARKS_EXTRA4", "CITY_LANDMARKS_EXTRA5", "CITY_LANDMARKS_EXTRA6"]) {
    const obj = D[f];
    if (!obj) continue;
    for (const cn in obj) for (const nm of (obj[cn] || [])) push(cn, nm);
  }
  const sd = D.SPOT_DETAILS_BY_CITY;
  if (sd) for (const cn in sd) for (const nm of Object.keys(sd[cn] || {})) push(cn, nm);
  return { jobs, fuzzyCovered };
}

// ---- 美食店缺坐标收集 ----
// v1.20.28：旧实现只读基数据，且用 `typeof s.lat === "number"` 判「有坐标」，
// 于是两类缺口同时被漏掉：
//   ① 基数据里 298 家带 (0,0) 占位坐标（是 number，被判成有坐标）——它们不会出现在地图上；
//   ② 团队美食块（subdata3/data/team-food3.js，1078 家）根本不在 data-packed 里，
//      运行时才由 _applyTeamFood3 upsert 进 FOOD_SPOTS —— 其中 673 条无坐标，
//      扣掉「与基数据同名店合并、沿用基数据真实坐标」的那部分，运行期实测剩 371 家无 pin。
// 症状是 `--list` 报「待补 0 条」，而体检一直说 669 家无 pin —— 两边口径不一致却都不报错。
const _hasUsableCoord = (s) => {
  const la = +s.lat, lo = +s.lon;
  return Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 || lo === 0);
};
/** 已落地的坐标批：data.js 里 `>>>FOOD_COORDS_V206_*` 标记块（_apply-safe 的写入目标）
 *  + 待合并的 tools/data/v206-food-coords.js。两处都是加载期回写，data-packed 里看不到。 */
function loadCoordPatches() {
  const out = {};
  const put = (city, list) => {
    if (!city || !Array.isArray(list)) return;
    (out[city] = out[city] || []).push(...list.filter(Array.isArray));
  };
  try {
    const src = fs.readFileSync("utils/data.js", "utf8");
    const b = src.indexOf(">>>FOOD_COORDS_V206_START>>>"), e = src.indexOf("<<<FOOD_COORDS_V206_END<<<");
    if (b >= 0 && e > b) {
      const seg = src.slice(b, e);
      const o = JSON.parse(seg.slice(seg.indexOf("{"), seg.lastIndexOf("}") + 1));
      for (const c in o) put(c, o[c]);
    }
  } catch (err) { console.error("读取 FOOD_COORDS_V206 失败：" + err.message); }
  try {
    const raw = fs.readFileSync("tools/data/v206-food-coords.js", "utf8");
    const o = JSON.parse(raw.slice(raw.indexOf("=") + 1).replace(/;\s*$/, "")).FOOD_COORDS_ADD || {};
    for (const c in o) put(c, o[c]);
  } catch (err) { /* 无待合并批次时正常 */ }
  return out;
}
function loadTeamFood() {
  const f = "subdata3/data/team-food3.js";
  try {
    const src = fs.readFileSync(f, "utf8");
    const i = src.indexOf("const TEAM_FOOD_ENRICH");
    if (i < 0) return {};
    const b = src.indexOf("{", i), e = src.indexOf("};", i);
    if (b < 0 || e < 0) return {};
    return JSON.parse(src.slice(b, e + 1));
  } catch (err) {
    console.error("团队美食块读取失败（" + f + "）：" + err.message);
    return {};
  }
}
function gatherFood(D) {
  const jobs = [];
  const seen = new Set();
  const push = (cn, name) => {
    const k = cn + " " + name;
    if (seen.has(k)) return;
    seen.add(k);
    jobs.push({ city: cn, name });
  };
  // ① 基数据：(0,0) / 非有限数 / 缺失 一律算缺
  const haveReal = new Set();
  // 已被历史坐标批覆盖的（data.js 的 FOOD_COORDS_V206 + 待合并的 v206-food-coords.js）也要算「已有」：
  // 这两处是加载期回写，data-packed 里看不到 → 不排除就会重复排 11 家已补过的店、白烧配额。
  for (const [city, list] of Object.entries(loadCoordPatches())) {
    for (const e of (list || [])) {
      const nm = String((e && e[0]) || "").trim();
      if (nm && Number.isFinite(+e[1]) && Number.isFinite(+e[2]) && +e[1] !== 0 && +e[2] !== 0) {
        haveReal.add(city + " " + nm);
      }
    }
  }
  const FS = D.FOOD_SPOTS || {};
  for (const cn in FS) {
    for (const s of (FS[cn] || [])) {
      const nm = String((s && (s.shop || s.name)) || "").trim();
      if (!nm) continue;
      if (_hasUsableCoord(s) || haveReal.has(cn + " " + nm)) { haveReal.add(cn + " " + nm); continue; }
      push(cn, nm);
    }
  }
  // ② 团队块：只排「合并后仍然没有真实坐标」的 —— 与基数据同名且基数据有真实坐标的，
  //    运行时 upsert 会沿用基数据坐标（overwrite 带 v != null 守卫，团队条目缺坐标不会覆盖），
  //    所以它们不算缺口；排进来只会白烧配额。
  const TEAM = loadTeamFood();
  let teamAdded = 0;
  for (const cn in TEAM) {
    for (const s of (TEAM[cn] || [])) {
      const nm = String((s && s.shop) || "").trim();
      if (!nm || _hasUsableCoord(s)) continue;
      if (haveReal.has(cn + " " + nm)) continue;
      const before = jobs.length;
      push(cn, nm);
      if (jobs.length > before) teamAdded++;
    }
  }
  const baseMissing = jobs.length - teamAdded;
  console.log("[food] 缺口构成：基数据 (0,0)/缺失 " + baseMissing + " 家 + 团队块无坐标 " + teamAdded + " 家");
  return jobs;
}

// ---- 单 key 顺序富集（带熔断）----
async function enrich(jobs, key, anchorByCity, gateKm, budget) {
  let done = 0, hit = 0, fail = 0, stopped = false, stopReason = "";
  const out = {};
  for (const job of jobs) {
    if (stopped || done >= budget) break;
    done++;
    const cityHint = job.city.replace(/市|州|地区|盟|自治州/g, "");
    const url = "https://restapi.amap.com/v3/geocode/geo?key=" + key + "&address=" + encodeURIComponent(job.name) + "&city=" + encodeURIComponent(cityHint);
    let g = null;
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (isPunishPage(body)) { stopped = true; stopReason = "punish-page"; break; }
      const j = JSON.parse(body);
      if (isAccountBanned(j)) { stopped = true; stopReason = "account-banned-10026"; break; }
      const code = infocodeOf(j);
      if (code === "10044" || code === "10003") { stopped = true; stopReason = "quota-exhausted-" + code; break; }
      if (j && j.status === "1" && Array.isArray(j.geocodes) && j.geocodes[0] && j.geocodes[0].location) {
        const parts = j.geocodes[0].location.split(",").map(Number);
        if (parts.length === 2 && !parts.some((n) => isNaN(n))) g = { lat: parts[1], lng: parts[0] };
      }
    } catch (e) { /* 网络抖动：计为未命中，继续，不熔断 */ }
    if (g) {
      const anchor = anchorByCity[job.city];
      if (!anchor || hav(g.lat, g.lng, anchor[0], anchor[1]) <= gateKm) {
        if (!out[job.city]) out[job.city] = [];
        out[job.city].push([job.name, +g.lat.toFixed(3), +g.lng.toFixed(3)]);
        hit++;
      } else fail++;
    } else fail++;
    if (done % 50 === 0) process.stderr.write("  处理 " + done + "/" + jobs.length + " 命中 " + hit + " 未命中 " + fail + "\n");
    await sleep(120);
  }
  return { out, hit, fail, done, stopped, stopReason };
}

// ---- 合并写入（幂等 + 净新增闸门）----
function parsePatch(file) {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(file, "utf8").replace(/^[^=]*=\s*/, "").replace(/;\s*$/, "")); } catch (e) { v = {}; }
  return v;
}
function mergeInto(file, keyName, out) {
  const v = parsePatch(file);
  const ADD = v[keyName] || {};
  const before = new Map();
  for (const cn in ADD) before.set(cn, new Set((ADD[cn] || []).map((x) => x && x[0])));
  for (const cn in out) {
    if (!ADD[cn]) ADD[cn] = [];
    const seen = new Set(ADD[cn].map((x) => x && x[0]));
    for (const e of out[cn]) if (!seen.has(e[0])) { seen.add(e[0]); ADD[cn].push(e); }
  }
  v[keyName] = ADD;
  fs.writeFileSync(file, "// 自动生成：坐标补全（geocode/geo，合规）\nmodule.exports = " + JSON.stringify(v, null, 1) + ";\n", "utf8");
  let net = 0;
  for (const cn in ADD) { const b = before.get(cn) || new Set(); for (const e of (ADD[cn] || [])) if (e && e[0] && !b.has(e[0])) net++; }
  return net;
}

export async function runDaily(opts = {}) {
  const domain = opts.domain || "all";
  const budget = Math.min(opts.budget || DEFAULT_BUDGET, PER_KEY_HARD_CAP);
  const dryRun = !!opts.dryRun;
  const listOnly = !!opts.list;

  const { all, live, dead } = loadKeys();
  if (!live.length) { console.error("无可用 key（全部在封禁黑名单或格式不符），结束"); process.exit(1); }
  // 按天轮换：今天用第 (dayIndex % live.length) 把，绝不同日多 key。
  const dayIndex = Math.floor(Date.now() / DAY_MS);
  const ki = (typeof opts.keyIndex === "number") ? (opts.keyIndex % live.length) : (dayIndex % live.length);
  const key = live[ki];
  console.log("key 池：文件 " + all.length + " 把 | 可用 " + live.length + " | 封禁/失效 " + dead);
  console.log("今日使用 key #" + (ki + 1) + "/" + live.length + "（按天轮换，单 key 当日预算 " + budget + "，远离 5000 硬上限）");

  const D = loadData();
  const anchorByCity = D.CITY_COORDS || {};

  const have = new Set();
  const SPOT_COORDS = D.SPOT_COORDS || {};
  for (const cn in SPOT_COORDS) for (const x of (SPOT_COORDS[cn] || [])) if (x && x[0]) have.add(cn + " " + x[0]);

  const domains = domain === "all" ? ["scenic", "food"] : [domain];
  const result = { scenic: { jobs: 0, hit: 0, fail: 0, net: 0 }, food: { jobs: 0, hit: 0, fail: 0, net: 0 } };

  for (const dm of domains) {
    const jobs = dm === "scenic" ? gatherScenic(D, have).jobs : gatherFood(D);
    result[dm].jobs = jobs.length;
    if (listOnly) {
      console.log("\n[" + dm + "] 待补 " + jobs.length + " 条：");
      jobs.slice(0, 30).forEach((j, i) => console.log("  " + (i + 1) + ". " + j.city + " / " + j.name));
      if (jobs.length > 30) console.log("  ... 其余 " + (jobs.length - 30) + " 条");
      continue;
    }
    if (!jobs.length) { console.log("\n[" + dm + "] 无缺口"); continue; }
    if (dryRun) { console.log("\n[" + dm + "] dry-run：将处理 " + jobs.length + " 条，不消耗配额"); continue; }
    console.log("\n[" + dm + "] 开始富集（闸门 " + GATE_KM[dm] + "km）...");
    const r = await enrich(jobs, key, anchorByCity, GATE_KM[dm], budget);
    const net = dm === "scenic" ? mergeInto("tools/data/v201-official-coords.js", "COORDS_ADD", r.out)
                                : mergeInto("tools/data/v206-food-coords.js", "FOOD_COORDS_ADD", r.out);
    result[dm].hit = r.hit; result[dm].fail = r.fail; result[dm].net = net;
    console.log("[" + dm + "] 调用 " + r.done + " | 命中 " + r.hit + " | 未命中 " + r.fail + (r.stopped ? " | 熔断(" + r.stopReason + ")" : "") + " | 净新增 " + net);
    if (r.stopped) { console.log("⚠️ 今日 key 熔断，停止后续 domain（次日 dayIndex 自动落到下一把 key）"); break; }
  }

  const totalNet = result.scenic.net + result.food.net;
  console.log("\n=== 汇总 === 景点净新增 " + result.scenic.net + " | 美食净新增 " + result.food.net + " | 合计净新增 " + totalNet + " ===");
  console.log(totalNet === 0 ? "NET_NEW=0 -> 调用方应停手：不打包、不上传、不提交" : "NET_NEW=" + totalNet + " -> 可进入 _apply-safe -> pack-data -> allcheck 流程");
  return result;
}

// CLI 入口（仅当本文件被直接 node 执行时触发；被 import 时不触发）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const p = args.find((a) => a.startsWith("--" + name + "="));
    return p ? p.split("=")[1] : undefined;
  };
  const dm = getFlag("domain") || "all";
  const bud = parseInt(getFlag("budget") || "", 10);
  const ki = parseInt(getFlag("key-index") || "", 10);
  runDaily({
    domain: dm,
    budget: isNaN(bud) ? DEFAULT_BUDGET : bud,
    dryRun: args.includes("--dry-run"),
    list: args.includes("--list"),
    keyIndex: isNaN(ki) ? undefined : ki,
  });
}
