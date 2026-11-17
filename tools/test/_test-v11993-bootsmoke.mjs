#!/usr/bin/env node
// tools/test/_test-v11993-bootsmoke.mjs —— v1.19.93 全页面启动冒烟（vm 沙盒）
// 目的：模拟每个注册页面「被打开」的完整时序（Page 构造 → onLoad → onShow），
// 捕获白屏/黑屏/进不去类缺陷：onLoad 抛错、this 引用断裂、缺 wx API mock 不掩盖真实 nil 调用。
// 真机不可跑的替代：无 IDE 环境下最接近「页面进入」的 Node 侧防线。
import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
const require = createRequire(import.meta.url);

const ROOT = process.cwd();
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};

// 页面清单：app.json 注册的全部页面（主包 + 分包）
const appj = JSON.parse(readFileSync(ROOT + "/app.json", "utf8"));
const pagePaths = [
  ...appj.pages,
  ...(appj.subpackages || appj.subPackages || []).flatMap(s => (s.pages || []).map(p => s.root + "/" + p)),
];

// 宽松 wx mock：所有方法 no-op / 立即 success；createSelectorQuery 链式返回空结果
const chainQ = { in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([]); return this; } };
const mkToast = () => ({ success() {}, fail() {}, complete() {} });
const wxMock = new Proxy({}, {
  get(t, k) {
    // v1.20.10 修复（假绿）：缺这一条时 utils/data.js 的 b64ToBytes() 会走
    // `wx.base64ToArrayBuffer` → 拿到本 Proxy 的兜底空函数 → 返回 undefined →
    // new Uint8Array(undefined) → pako 抛 "buffer error" → 数据整块为空。
    // 症状是「每个页面都 ✓，因为它们在空数据上没崩」—— 这道门禁其实从未加载过真实数据，
    // 也就抓不到「数据依赖导致的页面白屏」。补上真解码后才有意义。
    if (k === "base64ToArrayBuffer") return (b64) => {
      const buf = Buffer.from(String(b64 || ""), "base64");
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    };
    if (k === "arrayBufferToBase64") return (ab) => Buffer.from(ab).toString("base64");
    if (k === "createSelectorQuery") return () => chainQ;
    if (k === "getSystemInfo" || k === "getSystemInfoSync") return (cb) => { const r = { pixelRatio: 2, windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: "devtools" }; if (cb) cb(r); return r; };
    if (k === "getMenuButtonBoundingClientRect") return () => ({ top: 20, right: 303, bottom: 64, left: 240, width: 63, height: 44 });
    if (k === "getStorageSync") return () => "";
    if (k === "setStorageSync" || k === "removeStorageSync") return () => {};
    if (k === "showModal" || k === "showActionSheet" || k === "showToast" || k === "showLoading") return (o) => { if (o && o.success) o.success({ confirm: false, cancel: true }); return mkToast(); };
    if (k === "hideLoading" || k === "hideToast" || k === "stopPullDownRefresh" || k === "startPullDownRefresh" || k === "vibrateShort" || k === "pageScrollTo") return () => {};
    if (k === "getUpdateManager") return () => ({ onCheckForUpdate() {}, onUpdateReady() {}, onUpdateFailed() {}, applyUpdate() {} });
    if (typeof k === "string" && k.startsWith("on")) return () => {};
    return () => {};
  },
  has() { return true; },
});
const appMock = { globalData: { plan: null }, setPlan(p) { this.globalData.plan = p; } };
// v1.19.105：页面模块现在 require 共享模块 utils/app.js（getAppSafe/currentPlan），该模块在真实 Node 作用域里
// 解析 getApp（而非 vm 沙盒全局）。把 getApp/wx 也挂到 Node 全局，使共享模块与页面在测试中一致可见。
globalThis.getApp = () => appMock;
globalThis.wx = wxMock;

/* 2026-11-17：先真实加载数据再逐页进入。
 * 原实现只跑「不抛异常」，而它是**在数据未就绪时**跑的（onLoad 里 T.ready() 是异步，
 * 紧接着同步调 onShow）——于是「页面结构在、但没有任何内容可渲染」这种空屏
 * 完全测不出来：不抛错就 ✓。深色底上空白渲染，用户看到的就是「黑屏」。
 * 现在加载真实数据后再进页面，并按下面的契约断言「要么有内容、要么有明确空态」。 */
const travelReq = createRequire(ROOT + "/utils/travel.js");
let dataReady = false;
try {
  const T = travelReq(ROOT + "/utils/travel.js");
  await T.ready();
  dataReady = (T.provinces() || []).length > 0;
} catch (e) { dataReady = false; }
ok("真实数据已加载（否则后面的空屏断言没有意义）", dataReady, dataReady ? "" : "城市表仍为空");

for (const p of pagePaths) {
  const jsFile = ROOT + "/" + p + ".js";
  const name = p.replace(/\//g, "·");
  if (!existsSync(jsFile)) { ok(name + " js 存在", false); continue; }
  const src = readFileSync(jsFile, "utf8");
  // Page() 收集器：抓 Page({...}) 字面量（允许尾部为逗号的 JSON5 容错由 vm 的 JS 解析兜底）
  let config = null;
  // 关键：require 的解析基准必须是【页面文件自身】，vm 里 Node 默认基于本测试脚本目录
  const pageRequire = createRequire(jsFile);
  const sandbox = {
    wx: wxMock, Page: (c) => { config = c; }, Component: () => {},
    getApp: () => appMock, App: () => {}, getCurrentPages: () => [],
    require: pageRequire, console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    module: { exports: {} }, exports: {},
  };
  vm.createContext(sandbox);
  let bootErr = null;
  try {
    vm.runInContext(src, sandbox, { filename: jsFile });
  } catch (e) { bootErr = e; }
  if (bootErr) { ok(name + " 构造无异常", false, bootErr.message); continue; }
  if (!config) { ok(name + " Page 配置存在", false); continue; }
  // 构造页面实例（this 上下文）
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data || {}));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page.selectComponent = () => null;
  page.selectAllComponents = () => [];
  let onErr = null;
  try {
    if (typeof config.onLoad === "function") config.onLoad.call(page, {});
    if (typeof config.onShow === "function") config.onShow.call(page);
  } catch (e) { onErr = e; }
  ok(name + " 进入时序无异常（onLoad+onShow）", !onErr, onErr ? (onErr.message || String(onErr)) : "");
  if (onErr) continue;
  await new Promise((r) => setTimeout(r, 20));   // 让异步分支（require.async / Promise.then）跑完

  /* ---- 空屏断言：进入页面后必须有可渲染内容，或有明确的空态/失败态标志 ----
   * 判据：至少一个非空数组，或明确的状态位（hasPlan=false 空态 / dataFailed 重试卡 /
   * empty 空清单）。三者都没有 = 页面渲染出来基本是空的，深色底上就是「黑屏」。
   * 白名单只放「本来就没有列表内容」的页面，每条都要写清理由（不许拿白名单当垃圾桶）。 */
  const d = page.data || {};
  const nonEmptyArr = Object.entries(d).filter(([, v]) => Array.isArray(v) && v.length > 0);
  const stateFlag = d.hasPlan === false || d.dataFailed === true || d.empty === true;
  const NO_CONTENT_OK = {
    "pages/splash/splash": "开屏页，只做跳转，本就不渲染内容",
    "subpkg/lens/lens": "识物页主界面是相机/选图入口，无列表数据（cloudOn 之类是能力位不是内容）",
    "subdata/boost/boost": "数据容器页，无 UI",
    "subdata2/keep/keep": "数据容器页，无 UI",
    "subdata3/keep/keep": "数据容器页，无 UI",
  };
  const exempt = NO_CONTENT_OK[p];
  const detail = exempt ? "豁免：" + exempt
    : (nonEmptyArr.length ? "数组 " + nonEmptyArr.slice(0, 3).map(([k, v]) => k + "=" + v.length).join(",")
      : (stateFlag ? "空态/失败态标志（hasPlan=" + d.hasPlan + " / dataFailed=" + d.dataFailed + " / empty=" + d.empty + "）"
        : "无空数组且无空态标志"));
  ok(name + " 进入后有内容可渲染（或明确空态）",
    exempt ? true : (nonEmptyArr.length > 0 || stateFlag), detail);

  /* ---- 无行程时必须落到「空态」，而不是把页面框架用空数据渲染一遍 ----
   * 2026-11-17 实测过的真缺陷：plan 页原先 hasPlan=false 只隐藏了底部保存条，
   * summary / chips / 日卡照样渲染空值 —— 深色底上就是一片黑屏，1.2 秒后还被弹回首页。
   * 这三页是「行程依赖页」，没有行程时必须是空态（wxml 里有 !hasPlan 分支 + CTA）。 */
  const PLAN_DEPENDENT = ["pages/plan/plan", "pages/today/today", "subpkg/map/map"];
  if (PLAN_DEPENDENT.includes(p)) {
    ok(name + " 无行程时 hasPlan=false（走空态，不渲染空壳）", d.hasPlan === false, "hasPlan=" + d.hasPlan);
    const wx = readFileSync(ROOT + "/" + p + ".wxml", "utf8");
    ok(name + " wxml 有 !hasPlan 空态分支", /\{\{\s*!\s*hasPlan\s*\}\}/.test(wx));
  }
}

console.log(fail ? "\n❌ " + fail + " 个页面启动异常" : "\n✅ 全部 " + pagePaths.length + " 个页面启动冒烟通过");
process.exit(fail ? 1 : 0);
