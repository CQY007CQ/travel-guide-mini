#!/usr/bin/env node
// tools/_test-v11987-insp-ui.mjs —— v1.19.87「今日正当时」页面接线 vm 单测
// 惯例：从页面 js 源码 indexOf 抽 handler 文本 → vm 沙盒跑真实代码（不复制逻辑，防漂移）。
// 覆盖：index.onInspTap 预填成功/失败兜底（且不得重复调 _applyCity——_fillProv 内部已含）；
//       today.onInspTap 确认后真实 buildPlan + setPlan + switchTab、取消不生成。
import { readFileSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};

const extract = (file, anchor) => {
  const s = readFileSync(file, "utf8");
  const i = s.indexOf(anchor);
  if (i < 0) throw new Error("anchor not found: " + anchor);
  const j = s.indexOf("\n  },", i);
  // 方法定义体 → 函数表达式（vm 里可执行）
  return s.slice(i, j + 5).replace(/^onInspTap\(e\)\s*\{/, "function(e){").replace(/\},\s*$/, "}");
};

// ---------- 1. index.onInspTap ----------
{
  const src = extract("pages/index/index.js", "onInspTap(e) {");
  const insp = [{ name: "锦州", province: "辽宁", days: 3, bestShort: "9-10月" }];
  const calls = { fillProv: 0, applyCity: 0, toasts: [], setData: [] };
  const ctx = {
    T: { provinces: () => ["辽宁"] },
    wx: { showToast: o => calls.toasts.push(o.title), pageScrollTo: () => {} },
    Math, Date, String, Number, parseInt, parseFloat, isNaN, isFinite,
  };
  const page = {
    data: { insp },
    setData(p) { Object.assign(this.data, p); calls.setData.push(p); },
    _fillProv(pi, name) { calls.fillProv++; this.data.cityIdx = 0; this.data.cities = [{ name }]; },
    _applyCity() { calls.applyCity++; },
    _capOf() { return 4; },
  };
  vm.createContext(ctx);
  vm.runInContext("(" + src + ")", ctx).call(page, { currentTarget: { dataset: { i: 0 } } });
  ok("index：_fillProv 被调用且只调一次", calls.fillProv === 1);
  ok("index：未重复调用 _applyCity（_fillProv 内部已含）", calls.applyCity === 0);
  ok("index：天数写入表单", page.data.days === 3 && page.data.daysText === "3 天");
  ok("index：成功 toast「已填好」", calls.toasts.some(t => t.indexOf("已填好") >= 0), calls.toasts[0] || "");

  // 失败兜底：省份查不到
  const calls2 = { toasts: [] };
  const ctx2 = { T: { provinces: () => ["广东"] }, wx: { showToast: o => calls2.toasts.push(o.title) }, Math, Date, String, Number };
  vm.createContext(ctx2);
  const page2 = { data: { insp }, setData() {} , _fillProv() {}, _applyCity() {}, _capOf() { return 3; } };
  vm.runInContext("(" + src + ")", ctx2).call(page2, { currentTarget: { dataset: { i: 0 } } });
  ok("index：省份不匹配走兜底 toast，不抛错", calls2.toasts.some(t => t.indexOf("填入失败") >= 0));
}

// ---------- 2. today.onInspTap ----------
{
  const src = extract("pages/today/today.js", "onInspTap(e) {");
  const insp = [{ name: "锦州", province: "辽宁", days: 3, bestShort: "9-10月", why: "10月正当时" }];
  let modal = null, switchTab = null, setPlan = null, resetCalled = 0, toastFail = null;
  const ctx = {
    T: T,
    wx: {
      showModal(o) { modal = o; if (o && o.success) o.success({ confirm: true }); },
      switchTab(o) { switchTab = o.url; },
      showToast(o) { toastFail = o.title; },
    },
    app: { setPlan(p) { setPlan = p; } },
    Math, Date, String, Number, parseInt, parseFloat, isNaN, isFinite, Array, Object, JSON,
  };
  const origReset = T.resetPackChecks;
  T.resetPackChecks = () => { resetCalled++; };
  try {
    const page = { data: { insp }, setData() {} };
    vm.createContext(ctx);
    vm.runInContext("(" + src + ")", ctx).call(page, { currentTarget: { dataset: { i: 0 } } });
    ok("today：弹确认弹窗（标题含城市名）", !!modal && modal.title.indexOf("锦州") >= 0);
    ok("today：真实 buildPlan 生成（setPlan 拿到 days 数组）", !!(setPlan && Array.isArray(setPlan.days) && setPlan.days.length === 3),
      setPlan ? "days=" + setPlan.days.length : "未调用");
    ok("today：行程字段齐（cityName/province/depart/budget/pace）",
      !!(setPlan && setPlan.cityName === "锦州" && setPlan.province === "辽宁" && setPlan.depart && setPlan.budget === "mid" && setPlan.pace === "balance"));
    ok("today：重置行李清单勾选（对齐 more._gen）", resetCalled === 1);
    ok("today：生成后跳转行程页", switchTab === "/pages/plan/plan");
    ok("today：全程无失败 toast", toastFail === null, toastFail || "");

    // 取消路径：不生成
    let setPlan2 = null;
    const ctxC = {
      T: T,
      wx: { showModal(o) { o.success({ confirm: false }); }, switchTab() {}, showToast() {} },
      app: { setPlan(p) { setPlan2 = p; } },
      Math, Date, String, Number, Array, Object, JSON,
    };
    vm.createContext(ctxC);
    vm.runInContext("(" + src + ")", ctxC).call({ data: { insp }, setData() {} }, { currentTarget: { dataset: { i: 0 } } });
    ok("today：取消时不生成（setPlan 未被调用）", setPlan2 === null);
  } finally {
    T.resetPackChecks = origReset;
  }
}

console.log(fail ? "\n❌ " + fail + " 项失败" : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
