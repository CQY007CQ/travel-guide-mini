/**
 * stress100.mjs —— 100 轮全功能高强度压测（v1.20.35 起）
 *
 * 与 stress-test.mjs 的区别：
 *   · stress-test 是「全枚举 + 极端输入」，一次扫全城全省；
 *     本脚本是「100 轮随机真实用户组合」，每轮串起 40+ 个功能出口，看互相干扰与状态漂移。
 *   · 固定种子 LCG：同样的 100 轮永远同样输入，报障可复现。
 *   · 真跑断言：不只判「不抛异常」，还判结构（天数/数组/NaN/空结果）。
 *   · 计时：累计每个功能出口耗时，输出 Top-N 慢调用，先 profile 再优化（不凭感觉改性能）。
 *
 * 用法：node tools/test/stress100.mjs [轮数，默认 100]
 * 产物：tools/data/reports/stress100-<时间戳>.json / .md（生成物不落根层）
 * 不进 allcheck —— 61 步口径锁死。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { installWxShim } from "./_wx-shim.mjs";

installWxShim();                       // 无真 base64ToArrayBuffer 时数据整块为空却全绿
const require = createRequire(process.cwd() + "/");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = require(path.join(ROOT, "utils/travel.js"));
const D = require(path.join(ROOT, "utils/data.js"));
const RC = require(path.join(ROOT, "utils/recommend.js"));
const E = require(path.join(ROOT, "utils/emergency.js"));
// 真实页面走的是 subpkg/utils/spotsearch.js 的倒排索引（不是 travel.js 里那个旧 searchSpots）。
// 首版压测误测旧出口：27ms/次全表扫 3 万条 —— 尺子错了比没有尺子更糟，必须换成页面真调用。
const SS = require(path.join(ROOT, "subpkg/utils/spotsearch.js"));

const ROUNDS = Math.max(1, parseInt(process.argv[2] || "100", 10) || 100);
const SEED = 20261119;
let _s = SEED;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const j = (x) => { try { return JSON.stringify(x); } catch (e) { return "[unserializable]"; } };

const issues = [];
const cost = new Map();                // 功能 → 累计 ms
const calls = new Map();               // 功能 → 次数
let checks = 0, cases = 0;
const DEP = "2026-12-05";

function run(name, fn) {
  const t0 = process.hrtime.bigint();
  try {
    const v = fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    cost.set(name, (cost.get(name) || 0) + ms);
    calls.set(name, (calls.get(name) || 0) + 1);
    return v;
  } catch (e) {
    cost.set(name, (cost.get(name) || 0) + Number(process.hrtime.bigint() - t0) / 1e6);
    issues.push({ tag: "崩溃", fn: name, detail: String(e && e.message || e) });
    return null;
  }
}
function ok(cond, tag, detail) {
  checks++;
  if (!cond) issues.push({ tag, detail });
}
function noBadNumbers(obj, where) {
  let bad = null;
  (function walk(v, p) {
    if (bad || p.length > 6) return;
    if (typeof v === "number" && !isFinite(v)) { bad = p + "=" + v; return; }
    if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 12); i++) walk(v[i], p + "[" + i + "]"); return; }
    if (v && typeof v === "object") {
      const ks = Object.keys(v).slice(0, 14);
      for (const k of ks) {
        if (/^__|^_/.test(k)) continue;
        walk(v[k], p + "." + k);
        if (bad) return;
      }
    }
  })(obj, where);
  ok(!bad, "非有限数字", (bad || "") + " @ " + where);
}

await T.ready();
const realCities = (D.CITIES || []).filter((c) => c && c.name && !c.limited);
ok(realCities.length > 300, "基线", "真实城市仅 " + realCities.length);
const provinces = T.provinces();
const budgets = ["low", "mid", "high"];
const paces = ["leisure", "balance", "rush"];
const words = ["古镇 人少 三天", "海边亲子游 五天 舒适", "沙漠戈壁 摄影 四天", "温泉放松 周末 两天",
  "美食之城", "带娃 博物馆", "人少的古镇 三天", "雪山 徒步", "看海带娃", "性价比高 古都"];
const symptoms = ["腿摔了 疑似骨折", "烧伤烫伤", "中暑晕倒", "胸闷胸痛", "高原反应", "食物中毒"];

const t0 = Date.now();
for (let r = 1; r <= ROUNDS; r++) {
  cases++;
  const city = pick(realCities).name;
  const prov = pick(provinces);
  const days = int(1, 5);
  const budget = pick(budgets), pace = pick(paces);
  const month = int(1, 12);
  const date = `2026-${String(month).padStart(2, "0")}-${String(int(1, 26)).padStart(2, "0")}`;

  // ① 生成：单城 / 全省 / 多城 / 雨天改写 / 草稿
  const plan = run("buildPlan", () => T.buildPlan({ city, days, depart: date, budget, pace }));
  ok(Array.isArray(plan) && plan.length === days, "生成天数", `${city}/${days}天 → ${plan && plan.length}`);
  if (Array.isArray(plan)) {
    ok(plan.every((d) => d && Array.isArray(d.items) && d.items.length > 0), "空天", `${city} R${r}`);
    noBadNumbers(plan, "plan");
    run("tripDraft", () => T.tripDraft(plan));
    run("rainyDayPlan", () => T.rainyDayPlan(plan, 0));

    // ② 体检 / 评分 / 预算 / 复盘（一次生成后连续消费，最容易暴露状态污染）
    for (const fn of ["tripCheck", "planCheckup", "tripHealth", "tripScoreOf", "evaluatePlan", "budgetGauge",
      "tripOverview", "tripReview", "dateHintsForPlan", "routeAdvice", "luggageCheck", "holidayHint"]) {
      const v = run(fn, () => T[fn](plan));
      noBadNumbers(v, fn);
    }
    // ③ 打包：packSmart 返回 {groups,...}，packByPlan 返回数组 —— 两种结构都要真跑
    const pk = run("packSmart", () => T.packSmart(plan));
    ok(pk && Array.isArray(pk.groups) && pk.groups.length > 0, "打包分组空", city + " → " + j(pk).slice(0, 100));
    const pb = run("packByPlan", () => T.packByPlan(plan));
    ok(Array.isArray(pb) && pb.length > 0, "打包清单空", city + " → " + j(pb).slice(0, 100));
    // ④ 编辑往返：加 → 换 → 删 → 移动；不崩且天数不变
    // copyPlanText 要的是「行程对象」{days,...}，不是裸 days 数组（传数组必返空串）
    const p2 = run("copyPlan", () => T.copyPlanText({ cityName: city, days: plan, totalDays: days, depart: date, budget }));
    ok(typeof p2 === "string" && p2.length > 0, "行程文案", city + " copyPlanText 空");
    const cand = run("swapCandidates", () => T.swapCandidates(plan, 0, 0));
    if (Array.isArray(cand) && cand.length) {
      run("swapSpot", () => T.swapSpot(plan, 0, 0, cand[0].name || cand[0]));
    }
    run("dayAddSpot", () => T.dayAddSpot(plan, 0, (plan[0].items[0] || {}).name || "宽窄巷子"));
    run("dayRemoveSpot", () => T.dayRemoveSpot(plan, 0, 0));
    run("dayMove", () => T.dayMove(plan[0], city));
    ok(plan.length === days, "编辑后天数漂移", `${city} ${days}→${plan.length}`);
  }
  const pp = run("buildProvPlan", () => T.buildProvPlan({ province: prov, days: int(1, 4), depart: date, budget, pace }));
  ok(Array.isArray(pp) && pp.length > 0, "全省空结果", prov);
  const c2 = pick(realCities).name;
  const mp = run("buildMultiPlan", () => T.buildMultiPlan({
    route: [{ name: city, province: T.D.CITY2PROV[city] || "", days: 2 }, { name: c2, province: T.D.CITY2PROV[c2] || "", days: 2 }],
    depart: date
  }));
  ok(!!mp, "多城空结果", city + "+" + c2);

  // ⑤ 城市/景点/美食/天气/封面（纯查询，最容易被脏数据打穿）
  for (const fn of ["foodSpotsFor", "foodTop3", "foodMapOf", "mealPlanOf", "seasonWeather", "weatherFallback",
    "cityFoodOf", "provFoodOf", "foodPriceRange", "spotTiming", "spotDayLines"]) {
    const v = run(fn, () => T[fn](city));
    noBadNumbers(v, fn);
  }
  const cover = run("spotCover", () => T.spotCover(city, (realCities[0].experiences || [{}])[0].name || "景点"));
  ok(cover && typeof cover === "object", "封面结构", city + " → " + j(cover));
  const sr = run("searchSpots", () => SS.searchSpots({
    text: pick(["古镇", "雪山", "海", "博物馆", "人少的古镇", "看海带娃"]), tags: [], city: null, province: null, D, limit: 80
  }));
  ok(sr && Array.isArray(sr.results), "景点搜索结构", city + " → " + j(sr).slice(0, 120));
  run("spotLookup", () => T.spotLookup("故宫", city));
  run("realCity", () => T.realCity(city));
  const q = city;
  ok(T.decQuery(encodeURIComponent(encodeURIComponent(q))) === q, "URL 编码解码", q);

  // ⑥ 推荐引擎（大数据全表扫描，性能大头）
  const rec = run("recommend", () => RC.recommend(pick(words), { month, topN: 5 }));
  ok(rec && Array.isArray(rec.list), "推荐结构", j(rec).slice(0, 120));
  if (rec && rec.list.length) ok(rec.list.every((x) => typeof x.score === "number" && isFinite(x.score)), "推荐分数", j(rec.list).slice(0, 120));

  // ⑦ 账本 / 分账 / 导出（带 wx shim，真写 storage）
  run("addLedger", () => T.addLedger(int(5, 900), pick(["餐饮", "门票", "交通", "住宿", "购物"]), "压测", "我", 1, date, city));
  for (const fn of ["getLedger", "ledgerMonthly", "exportLedgerCSV", "iouStats", "budgetTotalObj", "weekLedgerTxt"]) {
    const v = run(fn, () => T[fn]());
    noBadNumbers(v, fn);
  }
  // ⑧ 急诊分诊 + 医院降级（零伪造）
  const tr = run("triage", () => E.triage(pick(symptoms)));
  ok(Array.isArray(tr) && tr.length > 0, "分诊空结果", String(pick(symptoms)));
  run("hospitalsOf", () => E.hospitalsOf(city));
}

const elapsed = Date.now() - t0;
const byTag = {};
issues.forEach((x) => { byTag[x.tag] = (byTag[x.tag] || 0) + 1; });
const slow = [...cost.entries()].map(([k, ms]) => ({ fn: k, ms: Math.round(ms), n: calls.get(k), per: Math.round(ms / calls.get(k) * 100) / 100 }))
  .sort((a, b) => b.ms - a.ms);
const report = { seed: SEED, rounds: ROUNDS, elapsedMs: elapsed, cases, checks, issues, byTag, slow };
const outDir = path.join(ROOT, "tools/data/reports");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jf = path.join(outDir, `stress100-${stamp}.json`);
const mf = path.join(outDir, `stress100-${stamp}.md`);
fs.writeFileSync(jf, JSON.stringify(report, null, 2));
let md = `# 100 轮全功能压测（seed=${SEED}）\n\n- 轮数 ${ROUNDS} ｜ 用例 ${cases} ｜ 断言 ${checks} ｜ 耗时 ${(elapsed / 1000).toFixed(1)}s\n`;
md += `- 问题 ${issues.length}：${JSON.stringify(byTag)}\n\n## 慢调用 Top 12\n\n| 功能 | 累计 ms | 次数 | 每次 ms |\n|---|---:|---:|---:|\n`;
slow.slice(0, 12).forEach((x) => { md += `| ${x.fn} | ${x.ms} | ${x.n} | ${x.per} |\n`; });
md += `\n## 问题明细（前 30）\n\n`;
issues.slice(0, 30).forEach((x) => { md += `- [${x.tag}] ${x.fn || ""} ${x.detail}\n`; });
fs.writeFileSync(mf, md);

console.log(`轮数=${ROUNDS} 用例=${cases} 断言=${checks} 耗时=${(elapsed / 1000).toFixed(1)}s 问题=${issues.length}`);
console.log("分类:", JSON.stringify(byTag));
console.log("慢调用 Top 8:", slow.slice(0, 8).map((x) => `${x.fn}=${x.ms}ms/${x.n}次(${x.per}/次)`).join(" | "));
issues.slice(0, 20).forEach((x) => console.log(`  [${x.tag}] ${x.fn || ""} ${x.detail}`));
console.log("报告:", path.relative(ROOT, mf), "/", path.relative(ROOT, jf));
process.exit(issues.length ? 1 : 0);
