#!/usr/bin/env node
// 首页 handler 冒烟：真实加载 index.js + 真 utils，逐个调用点击 handler，捕获抛错
import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const jsFile = ROOT + "/pages/index/index.js";

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
    if (k === "hideLoading" || k === "hideToast") return () => {};
    if (k === "navigateTo" || k === "switchTab" || k === "reLaunch" || k === "redirectTo") return (o) => { if (o && o.success) o.success({}); return mkToast(); };
    if (typeof k === "string" && k.startsWith("on")) return () => {};
    return () => {};
  },
  has() { return true; },
});
const appMock = { globalData: { plan: null, from: null } };

const src = readFileSync(jsFile, "utf8");
let config = null;
const pageRequire = createRequire(jsFile);
const sandbox = {
  wx: wxMock, Page: (c) => { config = c; }, Component: () => {},
  getApp: () => appMock, App: () => {}, getCurrentPages: () => [],
  require: pageRequire, console, setTimeout: (f)=>{ try{f();}catch(e){} }, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  module: { exports: {} }, exports: {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: jsFile });
const page = Object.assign({}, config);
page.data = JSON.parse(JSON.stringify(config.data || {}));
page.setData = function (patch) { Object.assign(this.data, patch); };
page.selectComponent = () => null;
page.selectAllComponents = () => [];
try { config.onLoad.call(page, {}); config.onShow.call(page); } catch (e) { console.log("⚠️ onLoad/onShow 抛错:", e.message); }

const ev = (dataset) => ({ currentTarget: { dataset }, target: { dataset } });
const calls = [
  ["toggleQuick", () => page.toggleQuick()],
  ["onModeTab(city)", () => page.onModeTab(ev({ mode: "city" }))],
  ["onModeTab(prov)", () => page.onModeTab(ev({ mode: "prov" }))],
  ["onModeTab(multi)", () => page.onModeTab(ev({ mode: "multi" }))],
  ["goTile(map)", () => page.goTile(ev({ url: "/subpkg/map/map" }))],
  ["goTile(today-tab)", () => page.goTile(ev({ url: "/pages/today/today" }))],
  ["onDaysPreset", () => page.onDaysPreset(ev({ d: 5 }))],
  ["onInspTap", () => page.onInspTap(ev({ i: 0 }))],
  ["openPicker", () => page.openPicker(ev({ mode: "city" }))],
  ["onPoolTap", () => page.onPoolTap()],
  ["toggleDiscover", () => page.toggleDiscover()],
  ["onAdvTap", () => page.onAdvTap()],
  ["onPeoplePlus", () => page.onPeoplePlus()],
  ["fillExample", () => page.fillExample()],
  ["goPlan", () => page.goPlan()],
  ["goPrep", () => page.goPrep()],
  ["goGuide", () => page.goGuide()],
  ["onFavToggle", () => page.onFavToggle()],
  ["onPoolTag", () => page.onPoolTag(ev({ tag: "" }))],
  ["pickAllPool", () => page.pickAllPool()],
  ["onTplPick", () => page.onTplPick(ev({ i: 0 }))],
  ["onBlindRoll", () => page.onBlindRoll()],
  ["togglePool", () => page.togglePool(ev({ name: "故宫" }))],
  ["saveDraftNow", () => page.saveDraftNow()],
  ["generate", () => page.generate()],
];
let fail = 0;
for (const [name, fn] of calls) {
  try { fn(); console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "  →  " + (e && e.stack ? e.stack.split("\n").slice(0,3).join(" | ") : e)); }
}
console.log(fail ? "\n❌ " + fail + " 个 handler 抛错" : "\n✅ 全部 " + calls.length + " 个 handler 调用无异常");
process.exit(fail ? 1 : 0);
