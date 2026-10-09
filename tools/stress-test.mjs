// 高强度压测（v1.17.4）：模拟真实旅行用户的各种操作与边界，找出真实 bug
// 用法: node tools/stress-test.mjs
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

const DEP = "2026-10-01";
const problems = [];
const note = (tag, msg) => problems.push("[" + tag + "] " + msg);
let cases = 0;

const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
const FILL = /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/;
const ACT = /^\+?\s*(登山|索道|上行|下行|徒步|漂流|骑行|泡汤|换乘)/;
const isReal = n => n && !FRAME.test(n) && !FILL.test(n) && !ACT.test(n);

// ---------- A. 全省精华游：全省份 × 多节奏 × 多天数 ----------
const provs = T.provinces();
const paces = ["leisure", "balance", "rush"];
for (const pv of provs) {
  for (const pace of paces) {
    for (const d of [1, 3, 7]) {
      cases++;
      let out;
      try { out = T.buildProvPlan({ province: pv, days: d, depart: DEP, budget: "mid", pace }); }
      catch (e) { note("A-崩溃", pv + "/" + pace + "/" + d + "天: " + e.message); continue; }
      if (!Array.isArray(out) || !out.length) { note("A-空结果", pv + "/" + pace + "/" + d + "天"); continue; }
      if (out.length !== d) note("A-天数不符", pv + "/" + pace + " 请求" + d + "实得" + out.length);
      // 空天检查：某天一个真实景点都没有
      out.forEach((day, i) => {
        const real = (day.items || []).filter(it => isReal(it.name));
        if (!real.length) note("A-空天", pv + "/" + pace + " D" + (i + 1) + " 无真实景点");
      });
      // 同一景点重复出现
      const seen = new Map();
      out.forEach((day, i) => (day.items || []).forEach(it => {
        if (!isReal(it.name)) return;
        const k = T.cleanSpotName(it.name);
        if (!k) return;
        if (seen.has(k) && seen.get(k) !== i) note("A-景点重复", pv + "/" + pace + " 「" + k + "」出现在 D" + (seen.get(k) + 1) + " 与 D" + (i + 1));
        else seen.set(k, i);
      }));
    }
  }
}

// ---------- B. 单城游：全城市 × 多天数 ----------
for (const c of D.CITIES) {
  cases++;
  let out;
  const wantD = Math.min(4, T.cityDayCap(c.name, "balance") || 4);   // UI 会按真实上限收敛，测试同步
  try { out = T.buildPlan({ city: c.name, days: wantD, depart: DEP }); }
  catch (e) { note("B-崩溃", c.name + ": " + e.message); continue; }
  if (!Array.isArray(out) || out.length !== wantD) { note("B-天数不符", c.name + " → " + (out && out.length)); continue; }
  if (c.limited) continue;   // 有限数据层：抵达 + 自由活动 + 离程（无真实景点属预期降级），豁免空天/重复检查
  out.forEach((day, i) => {
    if (i === 0) return;   // 第 1 天是抵达日，允许只排「抵达 + 自由活动」
    const real = (day.items || []).filter(it => isReal(it.name));
    if (!real.length) note("B-空天", c.name + " D" + (i + 1));
  });
  const seen = new Map();
  out.forEach((day, i) => (day.items || []).forEach(it => {
    if (!isReal(it.name)) return;
    const k = T.cleanSpotName(it.name);
    if (!k || ACT.test(k)) return;   // 归一后若只是动作（如「登山/索道上行」），不计入景点
    if (seen.has(k) && seen.get(k) !== i) note("B-景点重复", c.name + " 「" + k + "」跨天重复");
    if (!seen.has(k)) seen.set(k, i);
  }));
}

// ---------- C. 多站联游 ----------
const combos = [["北京", "上海"], ["成都", "重庆", "西安"], ["三亚", "海口"], ["太原", "大同", "临汾"], ["乌鲁木齐", "喀什"]];
for (const route of combos) {
  cases++;
  const spans = route.map(() => 3);
  let out;
  try { out = T.buildMultiPlan({ route: route.map((n, i) => ({ name: n, province: T.D.CITY2PROV[n] || "", days: spans[i] })), depart: DEP }); }
  catch (e) { note("C-崩溃", route.join("+") + ": " + e.message); continue; }
  const days = out && (out.days || out);
  if (!Array.isArray(days) || !days.length) { note("C-空结果", route.join("+")); continue; }
  days.forEach((day, i) => {
    const real = (day.items || []).filter(it => isReal(it.name));
    if (!real.length) note("C-空天", route.join("+") + " D" + (i + 1));
  });
}

// ---------- C2. 未知/非城市名（应有明确降级，不生成「当地代表性景点」占位）----------
cases++;
try {
  const out = T.buildMultiPlan({ route: [{ name: "平遥", province: "", days: 3 }], depart: DEP });
  const days = out && (out.days || out);
  const txt = JSON.stringify(days || []);
  if (/当地代表性景点/.test(txt) && !/平遥古城/.test(txt)) note("C2-未知城市占位", "平遥 → 生成了「当地代表性景点」占位文案");
} catch (e) { /* 抛错亦可接受 */ }

// ---------- D. 极端输入 ----------
const badDays = [0, -1, -100, NaN, "abc", null, undefined, 1.7, 999, Infinity];
for (const d of badDays) {
  cases++;
  try {
    const out = T.buildProvPlan({ province: "山西", days: d, depart: DEP });
    if (!Array.isArray(out)) note("D-类型异常", "days=" + d + " 返回非数组");
    else if (!out.length) note("D-空结果未抛错", "days=" + d);
    else if (d <= 0 || (typeof d === "number" && !isFinite(d))) note("D-非法天数被接受", "days=" + d + " → " + out.length + " 天");
  } catch (e) { /* 抛错是预期 */ }
}
const badDates = ["", "abc", "2026-13-01", "2026-02-30", "9999-99-99", null, undefined, "2026-1-1"];
for (const dt of badDates) {
  cases++;
  try {
    const out = T.buildProvPlan({ province: "山西", days: 3, depart: dt });
    if (Array.isArray(out) && out.length) note("D-非法日期被接受", JSON.stringify(dt) + " → " + out.length + " 天");
  } catch (e) { /* 预期 */ }
}

// ---------- E. 加/删景点往返 ----------
cases++;
try {
  let plan = { cityName: "成都", days: T.buildPlan({ city: "成都", days: 3, depart: DEP }) };
  const before = plan.days.reduce((s, d) => s + (d.items || []).length, 0);
  for (let k = 0; k < 30; k++) {
    // dayAddSpot / dayRemoveSpot 是「原地改 plan」，返回的是描述对象（不是 plan），别把返回值赋回 plan
    T.dayAddSpot(plan, 0, "宽窄巷子");
    T.dayRemoveSpot(plan, 0, 1);
  }
  const blanks = [];
  plan.days.forEach((d, i) => (d.items || []).forEach(it => { if (/留白/.test(it.name)) blanks.push(i + 1); }));
  if (blanks.length > plan.days.length) note("E-留白过多", "30 轮加删后留白 " + blanks.length + " 处 / " + plan.days.length + " 天");
  // 加景点是否排到返程之后
  plan.days.forEach((d, i) => {
    const idxRet = (d.items || []).findIndex(it => /^返程/.test(it.name));
    if (idxRet >= 0) {
      const after = (d.items || []).slice(idxRet + 1).filter(it => isReal(it.name));
      if (after.length) note("E-景点排在返程后", "D" + (i + 1) + ": " + after.map(x => x.name).join(","));
    }
  });
} catch (e) { note("E-崩溃", e.message); }

// ---------- F. 时段单调性 ----------
cases++;
try {
  const out = T.buildPlan({ city: "成都", days: 5, depart: DEP });
  const ORDER = { "凌晨": -1, "清晨": 0, "早上": 0, "上午": 1, "中午": 2, "下午": 2, "傍晚": 3, "晚上": 4, "夜间": 5, "深夜": 5, "全天": 6 };
  out.forEach((day, i) => {
    let last = -99;
    (day.items || []).forEach(it => {
      const v = ORDER[it.period];
      if (v === undefined) return;
      if (v < last) note("F-时段倒序", "D" + (i + 1) + " " + last + "→" + it.period + " (" + it.name + ")");
      last = Math.max(last, v);
    });
  });
} catch (e) { note("F-崩溃", e.message); }

console.log("用例数:", cases);
console.log("问题数:", problems.length);
const byTag = {};
problems.forEach(p => { const t = p.slice(1, p.indexOf("]")); byTag[t] = (byTag[t] || 0) + 1; });
Object.entries(byTag).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log("  " + t + ": " + n));
problems.slice(0, 40).forEach(p => console.log("   " + p));
process.exit(problems.length ? 1 : 0);
