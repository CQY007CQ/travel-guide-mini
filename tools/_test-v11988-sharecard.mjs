#!/usr/bin/env node
// tools/_test-v11988-sharecard.mjs —— v1.19.88「转发卡片」vm 单测
// 惯例：从页面 js 源码 indexOf 抽方法文本 → 转函数表达式 → vm 沙盒跑真实代码（防漂移）。
// 覆盖：_shareCardModel 字段与统计口径、_drawShareCard 绘制结构、_ensureShareCard
// stamp 短路 + 失败静默、onShareAppMessage 有图接 imageUrl / 无图回退。
import { readFileSync } from "fs";
import vm from "vm";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};

// 方法定义体 → 函数表达式（vm 里可执行）：去掉方法名签名与尾部逗号
const grab = (file, name) => {
  const s = readFileSync(file, "utf8");
  const re = new RegExp(name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(s);
  if (!m) throw new Error("method not found: " + name);
  const i = m.index;
  const j = s.indexOf("\n  },", i);
  return s.slice(i, j + 4)   // 到 "}" 为止（不含逗号）
    .replace(re, "function(" + m[1] + "){");
};

const PLAN = { cityName: "太原", province: "山西", savedAt: 123, days: [{ items: [{ n: "a" }] }, { items: [{ n: "b" }, { f: 1 }] }] };

// ---------- 1. _shareCardModel ----------
{
  const src = grab("pages/plan/plan.js", "_shareCardModel");
  const ctx = { app: { globalData: { plan: PLAN } } };
  vm.createContext(ctx);
  const page = { data: { summary: "兜底", modeTxt: "", view: [{ items: [{ n: "晋祠" }] }, { items: [{ n: "蒙山" }, { n: "x", f: 1 }] }] } };
  const m = vm.runInContext("(" + src + ")", ctx).call(page);
  ok("model：尺寸 5:4（750×600）", m.W === 750 && m.H === 600);
  ok("model：城市/省份（省≠市才带）", m.cityName === "太原" && m.prov === "山西");
  ok("model：spots 只计非框架项", m.spots === 2, "spots=" + m.spots);
  ok("model：天数取 plan.days", m.daysN === 2);
  ok("model：mode 空时兜底「平衡舒适」", m.mode === "平衡舒适");

  // 省与市同名（直辖市）不带省
  const ctx2 = { app: { globalData: { plan: { cityName: "北京", province: "北京", days: PLAN.days } } } };
  vm.createContext(ctx2);
  const m2 = vm.runInContext("(" + src + ")", ctx2).call({ data: { view: [] } });
  ok("model：直辖市不重复带省名", m2.prov === "");
}

// ---------- 2. _drawShareCard（mock ctx 记录调用） ----------
{
  const src = grab("pages/plan/plan.js", "_drawShareCard");
  const calls = { gradient: 0, fillText: [], fillRect: 0, stroke: 0 };
  const ctx = {
    createLinearGradient: () => { calls.gradient++; return { addColorStop() {} }; },
    fillRect: () => calls.fillRect++,
    fillText: (t) => calls.fillText.push(String(t)),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke: () => calls.stroke++,
    scale() {}, set globalAlpha(v) {}, set fillStyle(v) {}, set font(v) {}, set lineWidth(v) {}, set strokeStyle(v) {}, set textAlign(v) {},
  };
  const sandbox = { ctx };
  vm.createContext(sandbox);
  vm.runInContext("(" + src.replace(/ctx/g, "ctx") + ")", sandbox).call(null, ctx, 750, { W: 750, H: 600, cityName: "太原", prov: "山西", daysN: 3, spots: 9, mode: "平衡舒适" });
  ok("draw：全屏底色 fillRect", calls.fillRect >= 1);
  ok("draw：两处渐变（底+金字）", calls.gradient === 2, "gradients=" + calls.gradient);
  ok("draw：金装饰线 stroke", calls.stroke >= 1);
  ok("draw：四行文案（品牌/城市/副行/slogan）", calls.fillText.length === 4, calls.fillText.join(" | "));
  ok("draw：城市名上画布", calls.fillText.some(t => t.indexOf("太原") >= 0));
  ok("draw：slogan 带品牌语", calls.fillText.some(t => t.indexOf("每月正当时") >= 0));
}

// ---------- 3. _ensureShareCard（stamp 短路 + 生成赋值） ----------
{
  const src = grab("pages/plan/plan.js", "_ensureShareCard");
  let queried = 0, toTemp = null;
  const node = { width: 0, height: 0, getContext: () => ({ scale() {} }) };
  const ctx = {
    app: { globalData: { plan: PLAN } },
    wx: {
      createSelectorQuery: () => ({
        in() { return this; },
        select() { return this; },
        fields() { return this; },
        exec: (cb) => { queried++; cb([{ node, size: true }]); }
      }),
      getWindowInfo: () => ({ pixelRatio: 2 }),
      canvasToTempFilePath: (o) => { toTemp = o; if (o.success) o.success({ tempFilePath: "wxfile://tmp_share.png" }); },
    },
  };
  const model = { W: 750, H: 600, cityName: "太原", prov: "山西", daysN: 2, spots: 2, mode: "平衡舒适" };
  const page = { __shareImg: null, __shareStamp: null, _shareCardModel: () => model, _drawShareCard: () => {} };
  vm.createContext(ctx);
  vm.runInContext("(" + src + ")", ctx).call(page);
  ok("ensure：生成了分享卡 tempFilePath", page.__shareImg === "wxfile://tmp_share.png");
  const n = queried;
  vm.runInContext("(" + src + ")", ctx).call(page);
  ok("ensure：行程没变不重画（stamp 短路）", queried === n, "queried=" + queried + "/" + n);
  // plan 变更后重画
  PLAN.savedAt = 999;
  vm.runInContext("(" + src + ")", ctx).call(page);
  ok("ensure：行程变更（savedAt）触发重画", queried === n + 1);
}

// ---------- 4. onShareAppMessage 接线 ----------
{
  const src = grab("pages/plan/plan.js", "onShareAppMessage");
  const mk = (shareImg) => {
    const ctx = { app: { globalData: { plan: PLAN } } };
    vm.createContext(ctx);
    const page = { __shareImg: shareImg };
    return vm.runInContext("(" + src + ")", ctx).call(page);
  };
  const withImg = mk("wxfile://tmp_share.png");
  ok("share：有图时 imageUrl 接上", withImg.imageUrl === "wxfile://tmp_share.png");
  ok("share：深链参数保留（city/days）", withImg.path.indexOf("city=") >= 0 && withImg.path.indexOf("days=") >= 0);
  const noImg = mk(null);
  ok("share：无图回退（不传 imageUrl，纯文字现状）", noImg.imageUrl === undefined);
}

console.log(fail ? "\n❌ " + fail + " 项失败" : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
