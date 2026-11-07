// utils/app.js —— 全局访问收敛 + 事件 handler 错误边界（P0 静默失败根治）
// v1.19.105
//
// 背景：小程序此前多次出现「按钮按下没反应」——根因是事件 handler 抛错被微信静默吞掉，
// 用户看不到任何提示；以及各处散落 `const app = new Proxy(...)` 三行重复、对 app 上不存在的属性静默读 undefined。
// 本模块把三件事收口到一处：
//   1) getAppSafe()      —— 替代各页复制粘贴的惰性 Proxy；开发环境访问不存在属性给 console.warn。
//   2) currentPlan()     —— 统一行程访问器，等价于 `app.globalData.plan` 但 getApp() 取不到时返回 undefined 而非抛错。
//   3) SafePage / SafeComponent / safe() —— 事件 handler / 生命周期外的函数错误兜底。
//        · 开发/测试环境（envVersion !== "release"，或 Node 无 __wxConfig）：rethrow，让单测能抓到、控制台可见。
//        · 生产环境（release）：吞掉异常并 wx.showToast，把「无声失灵」变成用户可见的反馈。
//
// 重要约束：SafePage/SafeComponent 只「改造并返回 config」，真正的 Page()/Component() 注册由调用方在自己作用域里做
// （即 Page(SafePage({...}))）。这样共享模块不依赖 vm 测试沙盒里的 Page 全局，单测仍可正常捕获 handler 抛错。

// v1.19.106：被兜住的异常同步进本地错误日志（errlog），让「按了没反应」在生产环境也可回溯，不再无声消失。
const EL = require("./errlog.js");

// 是否开发/测试环境：Node 测试环境无 __wxConfig，一律按开发处理（rethrow，便于定位 + 单测捕获）。
function __isDev() {
  try {
    if (typeof __wxConfig !== "undefined" && __wxConfig && typeof __wxConfig.envVersion === "string") {
      return __wxConfig.envVersion !== "release";
    }
  } catch (e) {}
  return true;
}

// 1) 惰性 Proxy（带缓存）：访问 app 实例上的属性；开发环境访问不存在属性给警告。
let _appProxy = null;
function getAppSafe() {
  if (_appProxy) return _appProxy;
  _appProxy = new Proxy({}, {
    get(_t, k) {
      const g = (typeof getApp === "function") ? getApp() : null;
      const v = g ? g[k] : undefined;
      if (v === undefined && g && typeof k === "string" && __isDev()) {
        try { console.warn("[getAppSafe] 访问了 app 上不存在的属性:", k); } catch (e) {}
      }
      return v;
    },
    set(_t, k, v) {
      const g = (typeof getApp === "function") ? getApp() : null;
      if (g) g[k] = v;
      return true;
    }
  });
  return _appProxy;
}

// 2) 统一行程访问器：语义等价于 `app.globalData.plan`，但 getApp()/globalData 取不到时返回 undefined 而非抛错。
function currentPlan() {
  const g = (typeof getApp === "function") ? getApp() : null;
  const gd = g && g.globalData;
  return gd ? gd.plan : undefined;
}

// handler 包裹器：try-catch + 开发 rethrow / 生产 toast。
function __wrapFn(orig, label) {
  return function (...args) {
    try {
      return orig.apply(this, args);
    } catch (err) {
      try { if (typeof console !== "undefined" && console.error) console.error("[safe] " + label + " 抛错:", err); } catch (e) {}
      if (__isDev()) throw err; // 开发/测试：原样抛出，便于定位 + 单测捕获
      // 生产：给用户一个可见反馈，而不是「按了没反应」
      try { if (typeof wx !== "undefined" && wx && wx.showToast) wx.showToast({ title: "操作失败，请重试", icon: "none" }); } catch (e) {}
      // 同步进本地错误日志（Node 测试环境 push 自动跳过，绝不抛错）
      try { EL.push(label, err); } catch (e2) {}
      return undefined;
    }
  };
}

// 不包裹的生命周期/框架回调：这些抛错由微信框架处理，包裹反而可能掩盖严重问题。
const LIFECYCLE = {
  onLoad: 1, onShow: 1, onReady: 1, onHide: 1, onUnload: 1, onPullDownRefresh: 1,
  onReachBottom: 1, onShareAppMessage: 1, onShareTimeline: 1, onPageScroll: 1,
  onTabItemTap: 1, onResize: 1, onAddToFavorites: 1, onShareAppImage: 1,
  onCollocation: 1, onSaveExitState: 1
};

// v1.19.197：setData 写入 undefined 时微信会告警，而且该字段实际不会更新。
// 草稿 / 深链 / 历史回填等动态配置很容易拼出 undefined 字段（如 provName），
// 逐个调用点补兜底治标不治本，故在 SafePage 这一全页面统一入口做顶层清洗：
// 丢弃值为 undefined 的键，语义与微信原本行为等价，但告警彻底消失。
function __stripUndefined(data) {
  if (!data || typeof data !== "object") return data;
  const out = {};
  for (const k in data) {
    if (Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined) out[k] = data[k];
  }
  return out;
}

function __patchSetData(ctx) {
  try {
    if (!ctx || typeof ctx.setData !== "function" || ctx.__safeSetData) return;
    const orig = ctx.setData;
    ctx.__safeSetData = true;
    ctx.setData = function (data, cb) {
      try { return orig.call(this, __stripUndefined(data), cb); }
      catch (e) { return orig.call(this, data, cb); }
    };
  } catch (e) { /* 测试沙盒无 setData 时静默跳过，绝不阻断页面注册 */ }
}

// 3a) Page 包裹：仅包裹事件类 handler（非生命周期函数），返回改造后的 config 供 Page() 注册。
function SafePage(config) {
  if (config && typeof config === "object") {
    for (const k in config) {
      if (typeof config[k] === "function" && !LIFECYCLE[k]) config[k] = __wrapFn(config[k], "Page." + k);
    }
    // 在 onLoad 最前面接一次 setData 清洗（覆盖所有页面，含 subpkg 分包页）
    const origOnLoad = config.onLoad;
    config.onLoad = function (...args) {
      __patchSetData(this);
      return typeof origOnLoad === "function" ? origOnLoad.apply(this, args) : undefined;
    };
  }
  return config;
}

// 3b) Component 包裹：包裹 methods 里的事件 handler（当前工程无 Component 页面，预留）。
function SafeComponent(config) {
  if (config && typeof config === "object" && config.methods && typeof config.methods === "object") {
    for (const k in config.methods) {
      if (typeof config.methods[k] === "function") config.methods[k] = __wrapFn(config.methods[k], "Component.methods." + k);
    }
  }
  return config;
}

module.exports = { getAppSafe, currentPlan, safe: __wrapFn, SafePage, SafeComponent };
