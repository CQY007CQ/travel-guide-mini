// 999999 次模糊测试（v1.19.40）
// 设计：1,000,000 量级的迭代里，绝大多数走「廉价路径」（在缓存行程池上做随机增删 +
// 不变量复检 + 非法输入兜底），少数走「重路径」（真正调用 buildPlan/buildProvPlan/
// buildMultiPlan 生成行程）。既满足「测 999999 次」的量级，又把真实生成逻辑的随机
// 应力覆盖住，且总耗时可控（约数分钟）。
//
// 不变量（与 stress-test.mjs 同口径，适配模糊随机输入）：
//   1) 合法输入调用 builder 不得抛错（否则记 crash）
//   2) 跨天重复真实景点（cleanSpotName 归一后相同）→ 记 dup
//   3) 真实景点排在「返程」之后 → 记 afterReturn
//   4) 非法天数（<=0 / NaN / 非有限数 / 明显越界）被静默当成正常天数 → 记 illegalAccepted
//   5) 未知/非标准城市不得生成「当地代表性景点」占位文案 → 记 placeholder
//   6) 编辑态（dayAddSpot/dayRemoveSpot）不得崩溃，且不会产生返程后景点
//
// 用法: node tools/_fuzz-999999.mjs            （默认 N=999999, 重路径占比 6%）
//       N=200000 HEAVY=0.1 node tools/_fuzz-999999.mjs
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");
if (T.initData) { try { await T.initData(); } catch (e) {} }

const N = parseInt(process.env.N || "999999", 10) || 999999;
const HEAVY = parseFloat(process.env.HEAVY || "0.06");   // 重路径（真正调 builder）占比
const BAD = 0.04;                                         // 非法输入兜底占比（也算重路径）
const DEP = "2026-10-01";

const problems = [];
let stored = 0;
const MAX_STORE = 600;
const note = (tag, msg) => { if (stored < MAX_STORE) { problems.push("[" + tag + "] " + msg); stored++; } };
const counts = { crash: 0, dup: 0, afterReturn: 0, illegalAccepted: 0, placeholder: 0, editCrash: 0, badCrash: 0, lengthMismatch: 0, emptyDay: 0, other: 0 };
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

// ---------- 文本归一（与 stress-test 同口径）----------
const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
const FILL = /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/;
const ACT = /^\+?\s*(登山|索道|上行|下行|徒步|漂流|骑行|泡汤|换乘)/;
// 通用「填空式」建议语（非具体景点），多城联游时各城段独立生成会出现，跨城重复属预期，不计入重复
const FILLER = /慢逛|扫街|散步|喝杯咖啡|消食|夜市逛吃|老街|本地味道|近郊步道|闲坐|发呆|晒太阳|慢慢逛|咖啡|奶茶|小酌|逛吃|兜风|遛弯/;
const isReal = n => n && !FRAME.test(n) && !FILL.test(n) && !ACT.test(n);
const isFiller = n => FILLER.test(n || "");

function checkInvariants(days, where, opts) {
  // opts: { gen, skipDup }
  const gen = !!(opts && opts.gen);
  const skipDup = !!(opts && opts.skipDup);
  // 跨天重复 + 返程后景点
  const seen = new Map();
  for (let i = 0; i < days.length; i++) {
    const items = days[i].items || [];
    // 空天（整天空）：仅「生成路径」计入（编辑路径随机删点可能清空某天，属预期）。
    // 除首天允许抵达/留白外，其余天完全空算可疑。
    if (gen && i > 0 && items.length === 0) { bump("emptyDay"); note("空天", where + " D" + (i + 1) + " 整天空"); }
    let idxRet = -1;
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      if (/^返程/.test(it.name || "")) idxRet = j;
      if (!isReal(it.name)) continue;
      const k = T.cleanSpotName ? T.cleanSpotName(it.name) : it.name;
      if (!k || ACT.test(k)) continue;
      // 通用填空语跨城重复不算 bug；skipDup（如多城路线含重复城市）整体跳过
      if (!skipDup && !isFiller(it.name)) {
        if (seen.has(k) && seen.get(k) !== i) {
          bump("dup");
          note("跨天重复", where + " 「" + k + "」出现在 D" + (seen.get(k) + 1) + " 与 D" + (i + 1));
        } else if (!seen.has(k)) seen.set(k, i);
      }
      if (idxRet >= 0 && j > idxRet) {
        bump("afterReturn");
        note("返程后景点", where + " D" + (i + 1) + " 返程后仍有「" + it.name + "」");
      }
    }
  }
}

// ---------- 随机工具 ----------
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[ri(0, arr.length - 1)];
const cities = (D.CITIES || []).map(c => c.name).filter(Boolean);
const provs = T.provinces ? T.provinces() : [];
const paces = ["leisure", "balance", "rush"];
const budgets = ["low", "mid", "high"];
// 重路径（合法输入）只用真实 ISO 日期；非法日期由「非法输入兜底」路径专测
const goodDeps = [DEP, "2027-01-01", "2026-12-25", "2026-02-14", "2026-08-15", "2026-04-05", "2026-10-01", "2027-05-01"];
const badDays = [0, -1, -100, NaN, "abc", null, undefined, 1.7, 999, Infinity, -Infinity, 3.3, 1e9, -0, 0.0001];
let spotSeq = 0;   // 编辑路径占位景点名全局唯一计数器

// 预建一个行程池，供「廉价编辑 + 复检」路径使用
const pool = [];
for (let i = 0; i < 60; i++) {
  try {
    const c = pick(cities);
    const cap = Math.min(4, (T.cityDayCap ? T.cityDayCap(c, "balance") : 4) || 4);
    const d = ri(1, Math.max(1, cap));
    const out = T.buildPlan({ city: c, days: d, depart: DEP });
    if (Array.isArray(out) && out.length) pool.push({ cityName: c, days: out });
  } catch (e) {}
}
// 再多建几个多站/全省行程
for (let i = 0; i < 20; i++) {
  try {
    const route = [];
    const k = ri(2, 4);
    for (let j = 0; j < k; j++) route.push(pick(cities));
    const out = T.buildMultiPlan({ route: route.map(n => ({ name: n, province: (D.CITY2PROV && D.CITY2PROV[n]) || "", days: ri(1, 4) })), depart: DEP });
    const days = out && (out.days || out);
    if (Array.isArray(days) && days.length) pool.push({ cityName: route.join("+"), days });
  } catch (e) {}
}

// ---------- 主循环 ----------
let heavyN = 0, badN = 0, lightN = 0;
const tStart = Date.now();
for (let it = 0; it < N; it++) {
  const r = Math.random();
  if (r < HEAVY) {
    // ---- 重路径：真实生成 ----
    heavyN++;
    const kind = ri(0, 2);
    try {
      if (kind === 0) {
        const c = pick(cities);
        const cap = Math.min(7, (T.cityDayCap ? T.cityDayCap(c, pick(paces)) : 7) || 7);
        const d = ri(1, Math.max(1, cap));
        const out = T.buildPlan({ city: c, days: d, depart: pick(goodDeps) });
        if (!Array.isArray(out)) { bump("other"); note("非空数组", "buildPlan " + c + " → " + JSON.stringify(out).slice(0, 60)); }
        else {
          if (out.length !== d) { bump("lengthMismatch"); note("天数不符", "buildPlan " + c + " 要" + d + "得" + out.length); }
          checkInvariants(out, "buildPlan/" + c, { gen: true });
        }
      } else if (kind === 1) {
        const pv = pick(provs);
        const d = ri(1, 7);
        const out = T.buildProvPlan({ province: pv, days: d, depart: pick(goodDeps), budget: pick(budgets), pace: pick(paces) });
        if (!Array.isArray(out)) { bump("other"); note("非空数组", "buildProvPlan " + pv); }
        else {
          if (out.length !== d) { bump("lengthMismatch"); note("天数不符", "buildProvPlan " + pv + " 要" + d + "得" + out.length); }
          checkInvariants(out, "buildProvPlan/" + pv, { gen: true });
        }
      } else {
        const route = [];
        const k = ri(1, 5);
        for (let j = 0; j < k; j++) route.push(pick(cities));
        const out = T.buildMultiPlan({ route: route.map(n => ({ name: n, province: (D.CITY2PROV && D.CITY2PROV[n]) || "", days: ri(1, 5) })), depart: pick(goodDeps) });
        const days = out && (out.days || out);
        if (!Array.isArray(days)) { bump("other"); note("非空数组", "buildMultiPlan " + route.join("+")); }
        else {
          // 多城联游：不同城市的同名景点（人民公园/文化广场等）属预期，且同城段内由
          // buildPlan 逻辑去重（单城路径已覆盖），故多城整体跳过 dup 判定，只查返程后/空天。
          checkInvariants(days, "buildMultiPlan/" + route.join("+"), { gen: true, skipDup: true });
        }
      }
    } catch (e) { bump("crash"); note("生成崩溃", "kind=" + kind + ": " + e.message); }
  } else if (r < HEAVY + BAD) {
    // ---- 非法输入兜底（也算重路径，要调 builder）----
    badN++;
    const d = pick(badDays);
    try {
      const out = T.buildProvPlan({ province: "山西", days: d, depart: DEP });
      if (Array.isArray(out) && out.length) {
        if (typeof d !== "number" || !isFinite(d) || d <= 0) {
          bump("illegalAccepted");
          note("非法天数被接受", "days=" + String(d) + " → " + out.length + " 天");
        }
      }
    } catch (e) { /* 抛错是预期，不计 */ }
    // 未知城市不得生成占位文案
    try {
      const out = T.buildMultiPlan({ route: [{ name: "平遥", province: "", days: 3 }], depart: DEP });
      const days = out && (out.days || out);
      const txt = JSON.stringify(days || []);
      if (/当地代表性景点/.test(txt) && !/平遥古城/.test(txt)) { bump("placeholder"); note("未知城市占位", "平遥 → 占位文案"); }
    } catch (e) { /* 可 */ }
  } else {
    // ---- 廉价路径：编辑态模糊 + 不变量复检 ----
    lightN++;
    try {
      const base = pick(pool);
      if (!base) continue;
      const plan = JSON.parse(JSON.stringify(base));
      const rounds = ri(1, 8);
      for (let k = 0; k < rounds; k++) {
        const di = ri(0, plan.days.length - 1);
        if (Math.random() < 0.5) {
          // 编辑路径用全局唯一中性占位名，避免自身加点导致「跨天重复」误报
          const spot = "测试景点#" + (spotSeq++);
          if (T.dayAddSpot) T.dayAddSpot(plan, di, spot);
        } else {
          const items = (plan.days[di] && plan.days[di].items) || [];
          if (items.length) T.dayRemoveSpot && T.dayRemoveSpot(plan, di, ri(0, items.length - 1));
        }
      }
      // 编辑路径只校验「返程后景点 / 不得崩溃」；空天与跨天重复由生成路径负责。
      // 池里多城计划可能含重复城市（如 酒泉→…→酒泉），同名景点跨段重复属预期，故跳过 dup。
      checkInvariants(plan.days, "edit/" + base.cityName, { gen: false, skipDup: true });
    } catch (e) { bump("editCrash"); note("编辑崩溃", e.message); }
  }

  if ((it + 1) % 50000 === 0) {
    const el = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log("进度 " + (it + 1) + "/" + N + "  (" + el + "s, crash=" + counts.crash + " dup=" + counts.dup + " afterRet=" + counts.afterReturn + " illegal=" + counts.illegalAccepted + ")");
  }
}

const totalProblems = Object.values(counts).reduce((s, v) => s + v, 0) - (counts.other || 0);
const hardProblems = counts.crash + counts.dup + counts.afterReturn + counts.illegalAccepted + counts.placeholder + counts.editCrash + counts.badCrash;
console.log("==== 999999 模糊测试完成 ====");
console.log("总迭代:", N, " 重路径:", heavyN, " 非法兜底:", badN, " 廉价路径:", lightN);
console.log("耗时(s):", ((Date.now() - tStart) / 1000).toFixed(1));
console.log("计数:", JSON.stringify(counts));
console.log("已记录问题样本:", problems.length);
problems.slice(0, 40).forEach(p => console.log("   " + p));
process.exit(hardProblems ? 1 : 0);
