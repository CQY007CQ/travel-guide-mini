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
}

console.log(fail ? "\n❌ " + fail + " 个页面启动异常" : "\n✅ 全部 " + pagePaths.length + " 个页面启动冒烟通过");
process.exit(fail ? 1 : 0);
