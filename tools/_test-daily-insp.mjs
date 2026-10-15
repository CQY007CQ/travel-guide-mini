#!/usr/bin/env node
// tools/_test-daily-insp.mjs —— v1.19.87「今日正当时」单测
// 覆盖：bestMonths 解析（区间/跨年/次年/四季/单月/空）、dailyInspire 确定性、
// 数量与去重、字段完整性、当月季节匹配、数据厚度（experiences≥8）、12 个月全覆盖、
// 相邻日期轮换（保证每天有新鲜感）。
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};

// ---- 1. bestMonths 解析 ----
ok("bestMonths 区间「4-5月、9-10月」→ [4,5,9,10]",
  JSON.stringify(T.bestMonths("4-5月、9-10月，春秋凉爽")) === JSON.stringify([4, 5, 9, 10]));
ok("bestMonths「四季皆宜」→ null（全月适宜）", T.bestMonths("四季皆宜") === null);
ok("bestMonths 空值 → null", T.bestMonths("") === null);
ok("bestMonths 跨年区间「12-2月」→ [1,2,12]",
  JSON.stringify(T.bestMonths("12-2月看雪")) === JSON.stringify([1, 2, 12]));
ok("bestMonths「11月到次年2月」→ [1,2,11,12]",
  JSON.stringify(T.bestMonths("11月到次年2月")) === JSON.stringify([1, 2, 11, 12]));
ok("bestMonths 单月「10月」→ [10]",
  JSON.stringify(T.bestMonths("10月最美")) === JSON.stringify([10]));

// ---- 2. dailyInspire 基本属性 ----
const now = new Date(2026, 9, 15);   // 10 月 15 日
const a = T.dailyInspire(3, now);
const b = T.dailyInspire(3, now);
ok("确定性：同一天两次调用结果一致", JSON.stringify(a) === JSON.stringify(b));
ok("返回 3 张卡", a.length === 3, "len=" + a.length);
ok("城市名不重复", new Set(a.map(x => x.name)).size === a.length);
ok("字段完整（name/province/days/bestShort/why）",
  a.every(x => x.name && x.province && x.days >= 1 && x.bestShort && typeof x.why === "string"));

// ---- 3. 当月季节匹配：要么 bestMonths 命中 10 月，要么四季皆宜 ----
const octOk = a.every(x => {
  const bm = T.bestMonths(x.best);
  return !bm || bm.indexOf(10) >= 0;
});
ok("10 月的卡片全部「当月正当时」", octOk,
  a.map(x => x.name + (T.bestMonths(x.best) === null ? "(四季)" : "(旺季)")).join(" "));

// ---- 4. 数据厚度：每城 experiences ≥ 8 ----
const thickOk = a.every(x => {
  const c = T.findCity(x.name);
  return c && Array.isArray(c.experiences) && c.experiences.length >= 8;
});
ok("卡片城市 experiences ≥ 8（数据够厚）", thickOk);

// ---- 5. 12 个月全覆盖 ----
let monthsOk = true; const monthsInfo = [];
for (let m = 1; m <= 12; m++) {
  const r = T.dailyInspire(3, new Date(2026, m - 1, 15));
  const uniq = new Set(r.map(x => x.name)).size === r.length && r.length === 3;
  const seasonOk = r.every(x => { const bm = T.bestMonths(x.best); return !bm || bm.indexOf(m) >= 0; });
  if (!r.length || !uniq || !seasonOk) { monthsOk = false; monthsInfo.push(m + "月异常"); }
}
ok("12 个月每月 3 卡 · 不重复 · 季节匹配", monthsOk, monthsInfo.join(" ") || "全通过");

// ---- 6. 日期轮换：相邻两天的灵感不同（每天有新鲜感） ----
const a1 = T.dailyInspire(3, new Date(2026, 9, 14));
const a2 = T.dailyInspire(3, new Date(2026, 9, 16));
ok("相邻日期灵感轮换（14 日 ≠ 16 日）",
  JSON.stringify(a1.map(x => x.name)) !== JSON.stringify(a2.map(x => x.name)));

console.log(fail ? "\n❌ " + fail + " 项失败" : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
