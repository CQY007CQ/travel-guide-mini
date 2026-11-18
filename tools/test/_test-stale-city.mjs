#!/usr/bin/env node
// tools/test/_test-stale-city.mjs —— 旧脏档「URL 编码城市名」展示出口回归（v1.20.32）
//
// 为什么要有它：
//   历史上有一批存档的 plan.cityName / plan.province 是 URL 编码串（%E5%8C%97%E4%BA%AC）。
//   真源口径是「存档一个字节都不动，展示时统一走 T.decQuery()」。这条路一旦漏一处，
//   用户就会看到「仅看 %E5%8C%97%E4%BA%AC」「正在查：%E5..」这类机器串 —— 全是静默显示
//   缺陷，不会报错、不影响任何静态门禁，只能靠真机截图或本测试发现。
//
// 本测试的判据不是「源码里有 decQuery 这个字」，而是**真的把脏 plan 喂进展示出口，
// 断言输出里没有 %**。同时对正常城市名做对照组，防 decQuery 把好数据改坏。
//
// 注意：这里刻意不 assert 具体文案（文案会迭代），只 assert「不含 %」+「含正确城市名」。
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = require(path.join(ROOT, "utils/travel.js"));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};

const BEIJING_ENC = "%E5%8C%97%E4%BA%AC";
const SHANXI_ENC = "%E5%B1%B1%E8%A5%BF";
const hasPct = (s) => String(s == null ? "" : s).indexOf("%") >= 0;

/** 造一份「旧脏档」：城市名/省份是编码串，其余字段完整可用 */
function dirtyPlan(cityName, province) {
  const today = new Date();
  const d0 = new Date(today.getTime() + 5 * 86400000);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const days = [0, 1].map((i) => {
    const d = new Date(d0.getTime() + i * 86400000);
    return { date: ymd(d), items: [] };
  });
  return {
    id: "dirty-" + cityName.length,
    cityName,
    province,
    depart: ymd(d0),
    days,
    totalDays: days.length,
    people: 2,
    pace: "balance",
    travelMode: "train",
    budget: 900,
    createdAt: Date.now(),
    savedAt: Date.now()
  };
}

const clean = dirtyPlan("北京", "山西");
const dirty = dirtyPlan(BEIJING_ENC, SHANXI_ENC);

console.log("▶ 前置：脏档与干净档结构一致，仅城市名编码不同");
ok("decQuery 能把脏档城市名解回明文", T.decQuery(BEIJING_ENC) === "北京", T.decQuery(BEIJING_ENC));
ok("对照组：干净档城市名不被 decQuery 改动", T.decQuery(clean.cityName) === "北京");

/* ── ① tripCountdown（首页倒计时「5 天后出发 · 北京」）── */
{
  const a = T.tripCountdown(dirty);
  const b = T.tripCountdown(clean);
  ok("tripCountdown 有输出", !!a);
  if (a) {
    ok("tripCountdown：脏档输出不含 %", !hasPct(JSON.stringify(a)), JSON.stringify(a.sub || "").slice(0, 40));
    ok("tripCountdown：脏档输出含正确城市名", JSON.stringify(a).indexOf("北京") >= 0);
    ok("tripCountdown：脏档与干净档的 sub 一致（对照组）", a.sub === (b && b.sub), a.sub + " / " + (b && b.sub));
  }
}

/* ── ② planCityName（各页取「展示用城市名」的唯一入口）── */
{
  const raw = T.planCityName(dirty);
  const marked = T.planCityName(Object.assign({}, dirty, { __staleCity: true }));
  ok("planCityName：未标记 __staleCity 时返回原值（口径如此，调用方需自行 decQuery）", raw === BEIJING_ENC);
  ok("planCityName：标记 __staleCity 后解码", marked === "北京", marked);
  ok("planCityName：对干净档零副作用", T.planCityName(clean) === "北京");
}

/* ── ③ exportCollabPlan（协作包里的 city 字段会被别人看到）── */
{
  if (typeof T.exportCollabPlan === "function") {
    let s = "";
    try { s = JSON.stringify(T.exportCollabPlan(dirty) || {}); } catch (e) { s = ""; }
    ok("exportCollabPlan：脏档导出不含 %", !!s && !hasPct(s), s.slice(0, 60));
  } else {
    ok("exportCollabPlan 存在", false, "导出缺失");
  }
}

/* ── ④ exportICS（日历文件名/摘要里带城市名）── */
{
  if (typeof T.exportICS === "function") {
    let s = "";
    try { s = String(T.exportICS(dirty) || ""); } catch (e) { s = ""; }
    ok("exportICS：脏档导出不含 %", !!s && !hasPct(s), s.length + " 字");
    ok("exportICS：导出内容非空（判据下限）", s.length > 50);
  } else {
    ok("exportICS 存在", false, "导出缺失");
  }
}

/* ── ⑤ 全量扫描：把 dirty plan 塞进所有「接受 plan 的 T.* 函数」，输出里不许有 % ── */
{
  // planCityName 故意排除：它是「按 __staleCity 标记决定是否解码」的取值器，
  // 未标记时返回原值是既定口径（见上面第 ② 组），不算漏。
  const PLAN_FNS = ["tripCountdown", "cityBrief", "evaluatePlan", "exportCollabPlan", "exportICS", "tripReview", "spendForecast", "dailyBudget"];
  let called = 0;
  const leaked = [];
  for (const fn of PLAN_FNS) {
    if (typeof T[fn] !== "function") continue;
    called++;
    let out;
    try { out = T[fn](dirty); } catch (e) { continue; }
    let s = "";
    try { s = typeof out === "string" ? out : JSON.stringify(out); } catch (e) { continue; }
    if (hasPct(s)) leaked.push(fn);
  }
  // 判据下限：别因为函数改名导致这条静默变成空跑
  ok("全量扫描覆盖到 ≥4 个接受 plan 的出口函数", called >= 4, called + " 个");
  ok("全量扫描：没有出口把编码城市名漏出去", !leaked.length, leaked.join("、"));
}

/* ── ⑥ 反向保护：decQuery 不能把正常中文/带空格/空值改坏 ── */
{
  const cases = ["北京", "江西 · 抚州", "", null, undefined, "上海", "阿勒泰地区"];
  const bad = cases.filter((v) => {
    const r = T.decQuery(v);
    const want = v == null ? "" : String(v);
    return r !== want;
  });
  ok("decQuery 对正常值零改动（含空值/空串）", !bad.length, bad.join("、"));
  ok("decQuery 幂等（解两次结果不变）", T.decQuery(T.decQuery(BEIJING_ENC)) === "北京");
}

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
