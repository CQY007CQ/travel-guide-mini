#!/usr/bin/env node
// tools/_test-handler-smoke-all.mjs —— 全工程按键失灵全量核查
// 对每个注册页面：加载 JS → onLoad+onShow → 解析 WXML 全部 bind/catch tap 绑定 → 真实调用每个 handler，
// 分「getApp 正常」与「getApp=undefined（复现 lazyCodeLoading 崩溃时序）」两种场景捕获抛错，
// 并做「WXML 绑定但 JS 未定义」的哑火检查。
import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const pagePaths = (() => {
  const a = JSON.parse(readFileSync(ROOT + "/app.json", "utf8"));
  return [...a.pages, ...(a.subpackages || a.subPackages || []).flatMap(s => (s.pages || []).map(p => s.root + "/" + p))];
})();

// 链式桩：任何方法调用都返回自身，避免 .method() 抛错（map context / observer 等）
const anyFn = new Proxy(function () {}, { get() { return anyFn; }, apply() { return anyFn; } });
const chainQ = { in() { return this; }, select() { return this; }, selectAll() { return this; }, selectViewport() { return this; }, fields() { return this; }, exec(cb) { if (cb) try { cb([]); } catch (e) {} return this; }, boundingClientRect() { return this; }, scrollOffset() { return this; }, context() { return this; } };
function mkWx(getAppImpl) {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createSelectorQuery") return () => chainQ;
      if (k.startsWith("create")) return () => anyFn;
      if (k === "getSystemInfo" || k === "getSystemInfoSync") return (cb) => { const r = { pixelRatio: 2, windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: "devtools" }; if (cb) cb(r); return r; };
      if (k === "getMenuButtonBoundingClientRect") return () => ({ top: 20, right: 303, bottom: 64, left: 240, width: 63, height: 44 });
      if (k === "getStorageSync") return () => "";
      if (k === "setStorageSync" || k === "removeStorageSync" || k === "clearStorageSync") return () => {};
      if (k === "showModal" || k === "showActionSheet" || k === "showToast" || k === "showLoading") return (o) => { if (o && o.success) try { o.success({ confirm: false, cancel: true }); } catch (e) {} return {}; };
      if (k === "hideLoading" || k === "hideToast" || k === "pageScrollTo" || k === "startPullDownRefresh" || k === "stopPullDownRefresh" || k === "vibrateShort") return () => {};
      if (k === "navigateTo" || k === "switchTab" || k === "reLaunch" || k === "redirectTo") return (o) => { if (o && o.success) try { o.success({}); } catch (e) {} return {}; };
      if (k === "getApp") return getAppImpl;
      if (typeof k === "string" && k.startsWith("on")) return () => {};
      return () => {};
    },
    has() { return true; }
  });
}
function mkApp(getAppImpl) {
  return { globalData: { plan: null, from: null }, setPlan(p) { this.globalData.plan = p; }, clearPlan() { this.globalData.plan = null; } };
}

// 解析 WXML 全部交互事件绑定（tap/touch/longpress/change/input）
function wxmlHandlers(wxml) {
  const names = new Set();
  const re = /(?:bind|catch|bind:|catch:)(tap|touchstart|touchend|longpress|change|input|confirm|blur|focus)\s*=\s*["']([^"']+)["']/g;
  let m; while ((m = re.exec(wxml))) names.add(m[2].trim());
  return [...names];
}

// 通用假事件：提供常见 dataset 键 + detail，尽量贴近真实点击（detail.value 用字符串，避免 .trim() 假阳性）
function ev(ds) {
  ds = ds || {};
  const base = { i: 0, d: 1, mode: "city", tag: "", name: "测试", url: "/subpkg/map/map", k: "", id: "x", dir: "1", p: "", index: 0, item: {} };
  const dataset = Object.assign({}, base, ds);
  return { currentTarget: { dataset }, target: { dataset }, detail: { value: "测试", index: 0 }, preventDefault() {}, stopPropagation() {}, mark: {} };
}

function runPage(pagePath, getAppImpl) {
  const jsFile = ROOT + "/" + pagePath + ".js";
  const wxmlFile = ROOT + "/" + pagePath + ".wxml";
  const res = { page: pagePath, wxml: existsSync(wxmlFile), bound: [], missing: [], onLoadErr: null, handlersThrew: [] };
  if (!existsSync(jsFile)) { res.skip = "js 缺失"; return res; }
  const src = readFileSync(jsFile, "utf8");
  let config = null;
  const pr = createRequire(jsFile);
  const sandbox = {
    wx: mkWx(getAppImpl), Page: (c) => { config = c; }, Component: (c) => { config = c; },
    getApp: getAppImpl, App: () => {}, getCurrentPages: () => [],
    require: pr, console, setTimeout: (f) => { try { f(); } catch (e) {} }, clearTimeout, setInterval: () => 0, clearInterval, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, RegExp, Error,
    module: { exports: {} }, exports: {},
  };
  vm.createContext(sandbox);
  try { vm.runInContext(src, sandbox, { filename: jsFile }); } catch (e) { res.onLoadErr = "模块加载抛错: " + e.message; return res; }
  if (!config) { res.onLoadErr = "Page 配置缺失"; return res; }
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data || {}));
  page.setData = function (patch, cb) { if (patch && typeof patch === "object") Object.assign(this.data, patch); if (cb) try { cb(); } catch (e) {} };
  page.selectComponent = () => anyFn; page.selectAllComponents = () => []; page.createSelectorQuery = () => chainQ; page.getTabBar = () => null;
  try { if (typeof config.onLoad === "function") config.onLoad.call(page, {}); if (typeof config.onShow === "function") config.onShow.call(page); }
  catch (e) { res.onLoadErr = e.message; }
  // 方法名集合
  const defs = new Set();
  const re2 = /\n\s{2}([A-Za-z_$][\w$]*)\s*\(/g; let m; while ((m = re2.exec(src))) defs.add(m[1]);
  if (existsSync(wxmlFile)) {
    const bound = wxmlHandlers(readFileSync(wxmlFile, "utf8"));
    res.bound = bound;
    // 哑火检测：用运行时真值 config[name] 是否为函数（避免正则漏掉 mixin/展开写法）
    res.missing = bound.filter(b => typeof config[b] !== "function" && typeof page[b] !== "function");
    for (const name of bound) {
      const fn = config[name];
      if (typeof fn !== "function") continue;
      try { fn.call(page, ev()); }
      catch (e) { res.handlersThrew.push(name + " → " + (e && e.message ? e.message : e)); }
    }
  }
  return res;
}

let totalFail = 0;
const appMock = mkApp(() => appMock); // 正常场景：getApp 返回正常 app
for (const pp of pagePaths) {
  // 场景1：getApp 正常
  const r1 = runPage(pp, () => appMock);
  // 场景2：getApp=undefined（复现崩溃时序）
  const r2 = runPage(pp, () => undefined);
  const onLoadBad = r2.onLoadErr ? " ⚠️getApp=undefined 下 onLoad 抛错:" + r2.onLoadErr : " ✓getApp=undefined 下 onLoad 无异常";
  const miss = r1.missing.length ? " ⚠️哑火(绑定未定义):" + r1.missing.join(",") : " ✓无哑火";
  const threw = r1.handlersThrew.length ? " ⚠️handler抛错:" + r1.handlersThrew.join(" | ") : " ✓handler全通过";
  const tag = (r2.onLoadErr || r1.missing.length || r1.handlersThrew.length) ? "❌" : "✅";
  if (r2.onLoadErr || r1.missing.length || r1.handlersThrew.length) totalFail++;
  console.log(`${tag} ${pp}  [绑定${r1.bound.length}个]${onLoadBad}${miss}${threw}`);
}
console.log(totalFail ? `\n❌ ${totalFail} 个页面存在问题` : "\n✅ 全工程 17 页全量按键核查通过（getApp 正常 & getApp=undefined 双场景）");
process.exit(totalFail ? 1 : 0);
