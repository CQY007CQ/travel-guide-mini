#!/usr/bin/env node
// tools/_test-plan-handlers.mjs —— v1.19.109 行程页「非拖拽」交互 handler 回归（vm 抽方法真代码）
// 目的：plan 页是全局最重、且本环境无法真机测交互的核心页。拖拽已另有 _test-v11977-drag.mjs 覆盖，
// 本测试补齐其余高风险 handler（onToggle/onNav/onBaike/onWish/onVisited/onDel/onSwap/onTagSwap/
// onDelSpot/onDayAdd）的回归：① 空 plan / 缺字段不崩 ② 各分支（框架行/有货无货）不抛 ③ 状态变更正确。
// 写法：从 pages/plan/plan.js 抽方法文本 → vm 沙盒跑真实代码（防漂移），T 用 Proxy 兜底 + 针对性覆盖分支。
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_JS = path.join(__dirname, "..", "pages", "plan", "plan.js");

// 抽方法文本 → 函数表达式（vm 里可执行）：去掉签名与尾部逗号，复用 _test-v11988 的成熟约定
// 注意：plan.js 原始方法是 1 空格缩进（闭合 \n },），v1.19.109 抽出的 6 个 wrapper 是 2 空格（\n  },）。
// 两种缩进都要兼容，否则 indexOf 会跳到很远的 }, 把多个方法串在一起导致语法错。
const grab = (name) => {
  const s = readFileSync(PLAN_JS, "utf8");
  const re = new RegExp(name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(s);
  if (!m) throw new Error("method not found: " + name);
  const i = m.index;
  // 兼容 1 空格（原始方法 \n }, 4 字符）与 2 空格（v1.19.109 抽出的 wrapper \n  }, 5 字符）闭合。
  // 两种串互不嵌套（2 空格串里不含「单一空格+}」），各取首个命中；切到「逗号前」避免多出尾逗号。
  const cand = (sub) => { const k = s.indexOf(sub, i); return k >= 0 ? { idx: k, len: sub.length } : null; };
  const hits = [cand("\n  },"), cand("\n },")].filter(Boolean);
  if (!hits.length) throw new Error("method body not closed: " + name);
  hits.sort((x, y) => x.idx - y.idx);
  const { idx: j, len } = hits[0];
  return s.slice(i, j + len - 1).replace(re, "function(" + m[1] + "){");
};
const makeFn = (name, T = makeT()) => {
  const src = grab(name);
  const ctx = makeCtx(T);
  vm.createContext(ctx);
  return { run: (page, ev) => vm.runInContext("(" + src + ")", ctx).call(page, ev), ctx };
};

const isFrame = (n) => /抵达|返程|出发|回程/.test(String(n || ""));

// T：Proxy 兜底全部方法，默认返回安全值；对分支命中的少数方法给具体值
function makeT(over = {}) {
  const base = {
    isFrameName: (n) => isFrame(n),
    segCityOfDay: () => "西安",
    cleanSpotName: (n) => n,
    navTarget: (n) => ({ type: "coord", lat: 34, lon: 108, name: n }),
    baikeUrl: (n) => "https://baike.example/" + encodeURIComponent(String(n || "")),
    spotDetailText: () => null,
    spotLookup: () => null,
    spotTagOf: () => [],
    spotInfoText: () => "",
    spotTiming: () => null,
    wishHitsOf: () => [],
    isWished: () => false,
    toggleWish: () => true,
    isVisited: () => false,
    markVisited: () => true,
    swapCandidates: () => [{}],
    swapSpot: () => ({ name: "替换景点", left: 1 }),
    swapSpotByTag: () => ({ name: "同类景点" }),
    dayRemoveSpot: () => ({ name: "某点", left: 3 }),
    dayAddCandidates: () => [{}],
    dayAddSpot: () => ({ name: "新增点" }),
    normalizeDayItems: () => {},
    daySpots: (d) => (d && d.items ? d.items.filter((x) => !isFrame(x.name)) : []),
    tripHealth: () => ({ text: "健康摘要" }),
  };
  return new Proxy({}, { get: (_t, k) => (k in over ? over[k] : (k in base ? base[k] : () => undefined)) });
}

function makeCtx(T) {
  const app = { globalData: { plan: null }, setPlan(p) { this.globalData.plan = p; } };
  const wxCalls = { toasts: [], clipboard: null, openLocation: null, modals: 0, modalOpts: null, copy: 0 };
  const wx = {
    showToast: (o) => wxCalls.toasts.push(o && o.title),
    setClipboardData: (o) => { wxCalls.clipboard = o && o.data; wxCalls.copy++; if (o && o.success) o.success(); },
    openLocation: (o) => { wxCalls.openLocation = o; },
    showModal: (o) => { wxCalls.modals++; wxCalls.modalOpts = o; if (o && o.success) o.success({ confirm: true }); },
    vibrateShort: () => {},
  };
  return { app, wx, wxState: wxCalls, T, isFrame, console, setTimeout, Math, JSON, Object, Array, String, Number, Boolean };
}

// 构造可复用页面实例（提供 _render/_save/data/setData 桩）
function makePage(ctx, plan) {
  ctx.app.globalData.plan = plan;
  const page = {
    data: {},
    _suppressTap: false,
    setData(patch) { Object.assign(this.data, patch); },
    _render() { this._rendered = (this._rendered || 0) + 1; },
    _save() { this._saved = (this._saved || 0) + 1; ctx.app.setPlan({ ...ctx.app.globalData.plan, days: ctx.app.globalData.plan.days }); this._render(); },
    // 真实 plan 页有这两个关闭方法；_applySwap / onMovePick 会调用，桩里补上
    closeSwap() { this.setData({ swapOpen: false, swapDi: -1, swapIx: -1 }); },
    closeMove() { this.setData({ moveOpen: false, moveDi: -1, moveIx: -1 }); },
  };
  return page;
}

function planOf() {
  return {
    cityName: "西安", province: "陕西",
    days: [{ items: [
      { name: "兵马俑", period: "上午" },
      { name: "大雁塔", period: "下午" },
      { name: "回民街", period: "晚上" },
    ] }],
  };
}
const ev = (di, ix, extra = {}) => ({ currentTarget: { dataset: { di: String(di), ix: String(ix), ...extra } } });

let pass = 0, bad = 0;
const ck = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { bad++; console.log("  ✗ FAIL: " + name + (extra ? " → " + extra : "")); } };
const noThrow = (name, fn) => { try { fn(); ck(name, true); } catch (e) { ck(name, false, e.message); } };

/* ============ 1. 空 plan / 缺字段：所有 handler 必须静默早退，绝不抛 ============ */
{
  const T = makeT();
  for (const name of ["onToggle", "onNav", "onBaike", "onWish", "onVisited", "onDel", "onSwap", "onTagSwap", "onDelSpot", "onDayAdd"]) {
    const { run, ctx } = makeFn(name);
    const page = makePage(ctx, null);
    noThrow("空plan·" + name + " 不崩", () => run(page, ev(0, 0)));
    ck("空plan·" + name + " 早退无副作用", page._saved === undefined && page._rendered === undefined);
  }
  // 天越界
  const { run, ctx } = makeFn("onToggle");
  const page = makePage(ctx, planOf());
  noThrow("天越界·onToggle 不崩", () => run(page, ev(9, 0)));
}

/* ============ 2. onToggle：展开详情，setData 形状正确 ============ */
{
  const T = makeT();
  const { run, ctx } = makeFn("onToggle");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 1));
  ck("onToggle·open = ix+di*100", page.data.open === 1 + 0 * 100);
  ck("onToggle·detailName 取条目名", page.data.detailName === "大雁塔");
  ck("onToggle·无真介绍时 hasRealDetail=false", page.data.hasRealDetail === false);
  ck("onToggle·仅 setData（不重渲染）", page._rendered === undefined && page._saved === undefined);
  // 框架行（抵达/返程）不展开
  const p2 = makePage(ctx, { cityName: "西安", days: [{ items: [{ name: "抵达西安", period: "上午" }] }] });
  run(p2, ev(0, 0));
  ck("onToggle·框架行不展开", p2.data.open === undefined);
}

/* ============ 3. onNav：coord 类型 → wx.openLocation ============ */
{
  const T = makeT();
  const { run, ctx } = makeFn("onNav");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onNav·有坐标则 openLocation", !!ctx.wxState.openLocation && ctx.wxState.openLocation.name === "兵马俑");
}

/* ============ 4. onBaike：v1.20.5 零外链纯离线 ============ */
// ① 老桩（无 baikeInfo）② has:false → 只提示「该地点暂未收录百科」；③ 有收录 → 只弹窗展示。
// 三种分支都必须零剪贴板：旧版无条件复制 403 / 验证码死链，是用户明确要求根除的问题。
{
  const a = makeFn("onBaike");
  a.run(makePage(a.ctx, planOf()), ev(0, 0));
  const b = makeFn("onBaike", makeT({ baikeInfo: () => ({ has: false, title: "", text: "" }) }));
  b.run(makePage(b.ctx, planOf()), ev(0, 0));
  const c = makeFn("onBaike", makeT({ baikeInfo: () => ({ has: true, title: "兵马俑", text: "随包离线介绍" }) }));
  c.run(makePage(c.ctx, planOf()), ev(0, 0));
  const diag = JSON.stringify([a.ctx.wxState, b.ctx.wxState, c.ctx.wxState]);
  ck("onBaike·零外链：未收录只提示 / 有收录只弹窗，三分支均不复制",
    [a, b, c].every(x => x.ctx.wxState.copy === 0 && x.ctx.wxState.clipboard === null)
    && a.ctx.wxState.modals === 0 && b.ctx.wxState.modals === 0 && c.ctx.wxState.modals === 1
    && [a, b].every(x => x.ctx.wxState.toasts.join("|").indexOf("该地点暂未收录百科") >= 0)
    && c.ctx.wxState.toasts.length === 0
    && c.ctx.wxState.modalOpts && c.ctx.wxState.modalOpts.showCancel === false
    && c.ctx.wxState.modalOpts.content === "随包离线介绍", diag);
}

/* ============ 5. onWish：未想玩 → 加入，触发 _render ============ */
{
  const T = makeT();
  const { run, ctx } = makeFn("onWish");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onWish·加入想玩 toast", (ctx.wxState.toasts.join("|")).indexOf("已加入想玩") >= 0);
  ck("onWish·触发 _render", page._rendered === 1);
}

/* ============ 6. onVisited：打卡 → markVisited + toast ============ */
{
  const T = makeT();
  const { run, ctx } = makeFn("onVisited");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onVisited·打卡 toast", (ctx.wxState.toasts.join("|")).indexOf("已打卡") >= 0);
  ck("onVisited·触发 _render", page._rendered === 1);
}

/* ============ 7. onDel：非留白天 → 变自由活动（数量不变）；已留白天 → 直接删（数量-1） ============ */
{
  const T = makeT();
  const { run, ctx } = makeFn("onDel");
  const plan = planOf();
  const page = makePage(ctx, plan);
  run(page, ev(0, 0));
  ck("onDel·非留白天变自由活动（条数不变）", plan.days[0].items.length === 3 && /自由活动/.test(plan.days[0].items[0].name));
  ck("onDel·触发 _save", page._saved === 1);
  // 已含留白 → 直接删
  const plan2 = { cityName: "西安", days: [{ items: [{ name: "兵马俑", period: "上午" }, { name: "自由活动 · 第1天留白", period: "下午" }] }] };
  const p2 = makePage(ctx, plan2);
  run(p2, ev(0, 0));
  ck("onDel·已留白天直接删（条数-1）", plan2.days[0].items.length === 1);
}

/* ============ 8. onSwap / onTagSwap / onDelSpot / onDayAdd：分支命中 → _save + toast ============ */
{
  // 2026-11-09：onSwap 改为「打开选择面板」，不再立即随机替换
  const T = makeT();
  const { run, ctx } = makeFn("onSwap");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onSwap·打开换景点面板（不立即替换）", page.data && page.data.swapOpen === true && page._saved === undefined);
  ck("onSwap·面板带上当前景点名与候选", page.data && page.data.swapCur === "兵马俑" && Array.isArray(page.data.swapList));
}
{
  // 面板里选中具体景点 → _applySwap 执行替换 + _save + toast
  const T = makeT();
  const { run, ctx } = makeFn("_applySwap");
  const page = makePage(ctx, planOf());
  page.data.swapDi = 0; page.data.swapIx = 0;
  run(page, "替换景点");
  ck("_applySwap·替换 + _save", page._saved === 1 && (ctx.wxState.toasts.join("|")).indexOf("已换成") >= 0);
  ck("_applySwap·面板已关闭", page.data.swapOpen === false);
}
{
  // 单日行程无法跨天移动 → 给出提示，不崩
  const T = makeT();
  const { run, ctx } = makeFn("onMoveTo");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onMoveTo·单日行程给出提示", (ctx.wxState.toasts.join("|")).indexOf("只有一天") >= 0);
}
{
  const T = makeT();
  const { run, ctx } = makeFn("onTagSwap");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0, { tag: "古迹" }));
  ck("onTagSwap·同类替换 + _save", page._saved === 1);
  ck("onTagSwap·toast 正确", (ctx.wxState.toasts.join("|")).indexOf("已换成同类") >= 0);
}
{
  const T = makeT();
  const { run, ctx } = makeFn("onDelSpot");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onDelSpot·删除条目 + _save", page._saved === 1 && (ctx.wxState.toasts.join("|")).indexOf("已删掉") >= 0);
}
{
  const T = makeT();
  const { run, ctx } = makeFn("onDayAdd");
  const page = makePage(ctx, planOf());
  run(page, ev(0, 0));
  ck("onDayAdd·加入候选 + _save", page._saved === 1 && (ctx.wxState.toasts.join("|")).indexOf("已加入") >= 0);
}

console.log(bad ? `\n❌ ${bad} 项失败 / ${pass} 通过` : `\n✅ 全部 ${pass} 项通过`);
process.exit(bad ? 1 : 0);
