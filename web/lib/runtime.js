/* web/lib/runtime.js —— 浏览器端小程序运行时
 *
 * 目标：让 pages/*.js 与 subpkg/*.js 这些「小程序页面逻辑」一行不改地在浏览器里跑。
 * 提供四样东西：
 *   1. __h / __c / __t / __pick   —— WXML 编译产物调用的渲染原语
 *   2. wx.*                       —— 适配到 localStorage / fetch / DOM
 *   3. Page / getApp / Component  —— 页面注册与实例化（含 setData 与生命周期）
 *   4. 路由与外壳                  —— hash 路由 + tabBar + 页面挂载
 *
 * 刻意不做虚拟 DOM：整个页面重建，然后恢复焦点与滚动位置。
 * 17 个页面的 DOM 体量都不大，重建 ~10ms，比维护 diff 更不容易出错。
 */
(function (global) {
  "use strict";

  /* ───────── 环境标记：让 SafePage 走「生产」兜底路径（吞异常 + toast + errlog） ───────── */
  global.__wxConfig = { envVersion: "release" };

  var LS = global.localStorage;
  var toastTimer = null;

  /* 审计 #44/#46：任何进入 innerHTML 的动态文本都必须转义。
     导入的 JSON、URL hash、异常消息都可能携带标签，直接拼接等于 DOM 注入。 */
  function escHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }


  /* ────────────────────────── 渲染原语 ────────────────────────── */

  var TEXT = "__t";
  function __t(s) { var o = { __text: String(s == null ? "" : s) }; return o; }

  /**
   * 安全成员访问：__m(a,"b","c") 等价 a?.b?.c
   * WXML 表达式求值容错（undefined.length 返回 undefined），编译成 JS 后不能，
   * 编译期已把所有 a.b.c 改写成 __m(a,"b","c")。
   */
  function __m(o) {
    for (var i = 1; i < arguments.length; i++) {
      if (o === null || o === undefined) return undefined;
      o = o[arguments[i]];
    }
    return o;
  }

  function __c() {
    var out = [];
    (function flat(a) {
      for (var i = 0; i < a.length; i++) {
        var v = a[i];
        if (v === null || v === undefined || v === false || v === "") continue;
        if (Array.isArray(v)) { flat(v); continue; }
        out.push(v);
      }
    })(arguments);
    return out;
  }

  var inputSeq = 0;
  function __h(tag, props, children) {
    if (tag === "#text") return __t(props);
    var el = document.createElement(tag);
    props = props || {};
    for (var k in props) {
      var v = props[k];
      if (k === "__ev") { el.__ev = v; continue; }
      if (k === "__ds") { for (var d in v) el.dataset[d] = v[d]; continue; }
      if (k === "class") { if (v) el.className = v; continue; }
      if (k === "style") { if (v) el.setAttribute("style", v); continue; }
      if (k === "value") { el.value = v; continue; }
      if (k === "checked") { el.checked = !!v && v !== "false"; continue; }
      if (k === "disabled") { el.disabled = v === true || v === "true" || v === ""; continue; }
      if (v === true || v === "") { el.setAttribute(k, ""); continue; }
      try { el.setAttribute(k, v); } catch (e) { /* 忽略非法属性 */ }
      if (k === "src" && tag === "img") el.src = v;
    }
    // 输入类元素做焦点保持编号
    if (tag === "input" || tag === "textarea" || tag === "select") {
      el.__fkey = "f" + (inputSeq++);
      // paint() 用 [data-fkey="fN"] 选择器恢复焦点，只写 JS 属性 el.__fkey 是找不到的，
      // 必须同步写 DOM 属性，否则每次输入触发整页重建后输入框都会失焦。
      el.setAttribute("data-fkey", el.__fkey);
      if (props.value !== undefined && el.value !== props.value) el.value = props.value;
      if (props.placeholder && tag !== "select") el.placeholder = props.placeholder;
    }
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null || c === false) continue;
        if (c.nodeType) { el.appendChild(c); continue; }          // 已经是 DOM 节点
        if (c.__text !== undefined) { el.appendChild(document.createTextNode(c.__text)); continue; }
        // 静态文本被编译成裸字符串（JSON.stringify），这里兜底成文本节点
        el.appendChild(document.createTextNode(String(c)));
      }
    }
    return el;
  }

  /** picker：selector → select；date/time → input[type]；否则退化为只读容器 */
  function __pick(mode, value, el) {
    try {
      if (mode === "selector" || mode === "multiSelector") {
        el.classList.add("w-picker-select");
        return el;
      }
      var wrap = document.createElement("div");
      wrap.className = "w-picker-wrap";
      var input = document.createElement("input");
      input.type = (mode === "time" || mode === "time") ? "time" : (mode === "date" ? "date" : "text");
      input.className = "w-picker-input";
      input.value = String(value || "");
      input.__fkey = "f" + (inputSeq++);
      input.setAttribute("data-fkey", input.__fkey);  // 同上：picker 输入框也要能被焦点恢复找到
      wrap.appendChild(el);
      wrap.appendChild(input);
      return wrap;
    } catch (e) { return el; }
  }

  /* ────────────────────────── UI：toast / modal / loading ────────────────────────── */

  function layer(cls) {
    var d = document.createElement("div");
    d.className = "w-layer " + cls;
    document.body.appendChild(d);
    return d;
  }

  function showToast(o) {
    o = o || {};
    var old = document.querySelector(".w-toast");
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    var d = layer("w-toast");
    var icon = o.icon && o.icon !== "none" ? '<i class="w-ti w-ti-' + escHtml(o.icon) + '"></i>' : "";
    d.innerHTML = '<div class="w-toast-box">' + icon + '<span></span></div>';
    d.querySelector("span").textContent = o.title || "";
    d.style.display = "flex";
    toastTimer = setTimeout(function () { d.remove(); }, o.duration || 1800);
    if (o.success) setTimeout(function () { o.success({ errMsg: "showToast:ok" }); }, 0);
  }

  function hideToast() {
    var d = document.querySelector(".w-toast");
    if (d) d.remove();
  }

  function showLoading(o) {
    o = o || {};
    var d = layer("w-loading");
    d.innerHTML = '<div class="w-loading-box"><i class="w-spin"></i><span></span></div>';
    d.querySelector("span").textContent = o.title || "加载中";
  }

  function hideLoading() {
    var d = document.querySelector(".w-loading");
    if (d) d.remove();
  }

  function showModal(o) {
    o = o || {};
    var d = layer("w-modal");
    var btns = o.showCancel === false
      ? '<button class="w-mb w-mb-ok">' + escHtml(o.confirmText || "确定") + "</button>"
      : '<button class="w-mb w-mb-cancel">' + escHtml(o.cancelText || "取消") + "</button>" +
        '<button class="w-mb w-mb-ok">' + escHtml(o.confirmText || "确定") + "</button>";
    d.innerHTML = '<div class="w-modal-box"><div class="w-mtitle"></div><div class="w-mcontent"></div>' +
      '<div class="w-mbtns">' + btns + "</div></div>";
    d.querySelector(".w-mtitle").textContent = o.title || "提示";
    d.querySelector(".w-mcontent").textContent = o.content || "";
    function done(ok) {
      d.remove();
      var r = { confirm: ok, cancel: !ok, errMsg: ok ? "showModal:ok" : "showModal:cancel" };
      o.success && o.success(r);
      o.complete && o.complete(r);
    }
    var okBtn = d.querySelector(".w-mb-ok");
    var cancelBtn = d.querySelector(".w-mb-cancel");
    if (okBtn) okBtn.onclick = function () { done(true); };
    if (cancelBtn) cancelBtn.onclick = function () { done(false); };
    d.querySelector(".w-modal-box").style.pointerEvents = "auto";
  }

  function showActionSheet(o) {
    o = o || {};
    var d = layer("w-sheet");
    var items = (o.itemList || []).map(function (t, i) {
      return '<button class="w-sh-item" data-i="' + i + '">' + escHtml(t) + "</button>";
    }).join("");
    d.innerHTML = '<div class="w-sh-box">' + items + '<button class="w-sh-cancel">取消</button></div>';
    d.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      d.remove();
      if (b.classList.contains("w-sh-cancel")) {
        o.fail && o.fail({ errMsg: "showActionSheet:fail cancel" });
        return;
      }
      var i = Number(b.dataset.i);
      o.success && o.success({ tapIndex: i });
    });
  }

  function previewImage(o) {
    o = o || {};
    var urls = o.urls || [];
    var cur = o.current || urls[0] || "";
    var d = layer("w-preview");
    d.innerHTML = '<div class="w-pv-box"><img alt=""/><button class="w-pv-close">关闭</button></div>';
    d.querySelector("img").src = cur;
    d.querySelector(".w-pv-close").onclick = function () { d.remove(); };
    d.onclick = function (e) { if (e.target === d) d.remove(); };
  }

  /* ────────────────────────── 路由 ────────────────────────── */

  var PAGES = {};      // path → config（Page 注册）
  var ROUTER = null;   // app.js 注入

  function route(path, mode) {
    if (!ROUTER) { location.hash = "#" + path; return; }
    ROUTER(path, mode || "push");
  }

  /* ────────────────────────── wx 适配 ────────────────────────── */

  function lsGet(k) {
    try {
      var raw = LS.getItem("wx:" + k);
      if (raw === null) return "";
      return JSON.parse(raw);
    } catch (e) { return ""; }
  }
  function lsSet(k, v) {
    LS.setItem("wx:" + k, JSON.stringify(v === undefined ? "" : v));
  }

  function ok(name, res) {
    return Object.assign({ errMsg: name + ":ok" }, res || {});
  }

  var wx = {
    /* --- 存储 --- */
    getStorageSync: function (k) { return lsGet(k); },
    setStorageSync: function (k, v) { lsSet(k, v); },
    removeStorageSync: function (k) { LS.removeItem("wx:" + k); },
    clearStorageSync: function () {
      Object.keys(LS).filter(function (k) { return k.indexOf("wx:") === 0; })
        .forEach(function (k) { LS.removeItem(k); });
    },
    getStorageInfoSync: function () {
      var keys = [], bytes = 0;
      for (var i = 0; i < LS.length; i++) {
        var k = LS.key(i);
        if (k.indexOf("wx:") === 0) {
          keys.push(k.slice(3));
          bytes += (LS.getItem(k) || "").length;
        }
      }
      return { keys: keys, currentSize: Math.round(bytes / 1024), limitSize: 10240 };
    },
    getStorage: function (o) {
      o = o || {};
      var r = ok("getStorage", { data: lsGet(o.key) });
      o.success && o.success(r); o.complete && o.complete(r);
    },
    setStorage: function (o) {
      o = o || {}; lsSet(o.key, o.data);
      var r = ok("setStorage");
      o.success && o.success(r); o.complete && o.complete(r);
    },
    removeStorage: function (o) {
      o = o || {}; LS.removeItem("wx:" + o.key);
      var r = ok("removeStorage");
      o.success && o.success(r); o.complete && o.complete(r);
    },

    /* --- 交互 --- */
    showToast: showToast,
    hideToast: hideToast,
    showLoading: showLoading,
    hideLoading: hideLoading,
    showModal: showModal,
    showActionSheet: showActionSheet,
    previewImage: previewImage,

    setClipboardData: function (o) {
      o = o || {};
      var text = String(o.data == null ? "" : o.data);
      var fin = function () { var r = ok("setClipboardData"); o.success && o.success(r); o.complete && o.complete(r); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(fin).catch(function () { fallbackCopy(text); fin(); });
      } else { fallbackCopy(text); fin(); }
    },
    getClipboardData: function (o) {
      o = o || {};
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
          var r = ok("getClipboardData", { data: t });
          o.success && o.success(r); o.complete && o.complete(r);
        }).catch(function () { o.fail && o.fail({ errMsg: "getClipboardData:fail" }); });
      } else { o.fail && o.fail({ errMsg: "getClipboardData:fail" }); }
    },

    /* --- 导航 --- */
    navigateTo: function (o) { route(cleanUrl(o && o.url), "push"); o && o.success && o.success(ok("navigateTo")); },
    redirectTo: function (o) { route(cleanUrl(o && o.url), "replace"); o && o.success && o.success(ok("redirectTo")); },
    reLaunch: function (o) { route(cleanUrl(o && o.url), "replace"); o && o.success && o.success(ok("reLaunch")); },
    switchTab: function (o) { route(cleanUrl(o && o.url), "tab"); o && o.success && o.success(ok("switchTab")); },
    navigateBack: function () { history.back(); },
    openLocation: function (o) {
      o = o || {};
      var name = encodeURIComponent(o.name || "目的地");
      global.open("https://uri.amap.com/marker?position=" + o.longitude + "," + o.latitude + "&name=" + name, "_blank");
      o.success && o.success(ok("openLocation"));
    },
    makePhoneCall: function (o) { o = o || {}; location.href = "tel:" + (o.phoneNumber || ""); },
    setNavigationBarTitle: function (o) { if (o && o.title) document.title = o.title + " · 旅行攻略生成器"; },
    setNavigationBarColor: function (o) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m && o && o.frontColor) m.setAttribute("content", o.frontColor);
    },
    setBackgroundColor: function () {},
    pageScrollTo: function (o) {
      o = o || {};
      if (o.selector) {
        var el = document.querySelector(o.selector);
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      }
      global.scrollTo({ top: o.scrollTop || 0, behavior: o.duration === 0 ? "auto" : "smooth" });
    },
    vibrateShort: function () { try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} },
    vibrateLong: function () { try { navigator.vibrate && navigator.vibrate(300); } catch (e) {} },

    /* --- 系统信息 --- */
    getSystemInfoSync: info,
    getWindowInfo: function () { return { windowWidth: innerWidth, windowHeight: innerHeight, pixelRatio: devicePixelRatio, screenWidth: screen.width, screenHeight: screen.height, statusBarHeight: 0, safeArea: { top: 0, bottom: innerHeight } }; },
    getAppBaseInfo: function () { return { SDKVersion: "3.8.12", theme: theme(), language: navigator.language, version: "web" }; },
    getDeviceInfo: function () { return { platform: "web", brand: "browser", model: navigator.userAgent }; },
    getSystemSetting: function () { return { theme: theme(), fontSizeSetting: 16 }; },
    getAppAuthorizeSetting: function () { return {}; },
    onThemeChange: function () {},
    onWindowResize: function (cb) {
      var h = function () { cb && cb({ size: { windowWidth: innerWidth, windowHeight: innerHeight } }); };
      global.addEventListener("resize", h);
      return h;
    },
    env: { USER_DATA_PATH: "/user" },

    /* --- 网络 --- */
    request: function (o) {
      o = o || {};
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, o.timeout || 12000);
      fetch(o.url, { method: (o.method || "GET").toUpperCase(), headers: o.header || {}, body: o.data && o.method === "POST" ? JSON.stringify(o.data) : undefined, signal: ctrl.signal })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          clearTimeout(to);
          var data = t;
          try { data = JSON.parse(t); } catch (e) {}
          var res = ok("request", { statusCode: 200, data: data });
          o.success && o.success(res); o.complete && o.complete(res);
        })
        .catch(function (e) {
          clearTimeout(to);
          o.fail && o.fail({ errMsg: "request:fail " + (e && e.message) });
          o.complete && o.complete({ errMsg: "request:fail" });
        });
      return { abort: function () { ctrl.abort(); } };
    },

    /* --- 选择器 / 节点 --- */
    createSelectorQuery: function () {
      var tasks = [];
      var q = {
        select: function (sel) {
          return {
            boundingClientRect: function (cb) { tasks.push({ sel: sel, cb: cb, type: "rect" }); return q; },
            fields: function (o, cb) { tasks.push({ sel: sel, cb: cb, type: "fields" }); return q; },
            node: function (cb) { tasks.push({ sel: sel, cb: cb, type: "node" }); return q; },
            scrollOffset: function (cb) { tasks.push({ sel: sel, cb: cb, type: "scroll" }); return q; },
          };
        },
        selectAll: function (sel) {
          return {
            boundingClientRect: function (cb) { tasks.push({ sel: sel, cb: cb, type: "rectAll" }); return q; },
            fields: function (o, cb) { tasks.push({ sel: sel, cb: cb, type: "fieldsAll" }); return q; },
          };
        },
        selectViewport: function () {
          return {
            scrollOffset: function (cb) { tasks.push({ sel: null, cb: cb, type: "scroll" }); return q; },
          };
        },
        in: function () { return q; },
        exec: function (cb) {
          var results = tasks.map(function (t) {
            if (t.type === "scroll") return { scrollTop: global.scrollY || document.documentElement.scrollTop || 0 };
            if (t.type === "rectAll") {
              return Array.prototype.map.call(document.querySelectorAll(t.sel), function (el) {
                var r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, id: el.id };
              });
            }
            var el = t.sel ? document.querySelector(t.sel) : null;
            if (!el) return null;
            if (t.type === "node") return { node: el, width: el.clientWidth, height: el.clientHeight };
            var r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, id: el.id, dataset: el.dataset };
          });
          tasks.forEach(function (t, i) { t.cb && t.cb(results[i]); });
          cb && cb(results);
        },
      };
      return q;
    },

    /* --- canvas 导出 --- */
    canvasToTempFilePath: function (o) {
      o = o || {};
      try {
        var el = (o.canvas && o.canvas.nodeName) ? o.canvas : document.querySelector("canvas[data-share], canvas.canvas");
        if (!el) throw new Error("canvas not found");
        var url = el.toDataURL("image/png");
        var res = ok("canvasToTempFilePath", { tempFilePath: url });
        o.success && o.success(res); o.complete && o.complete(res);
      } catch (e) {
        o.fail && o.fail({ errMsg: "canvasToTempFilePath:fail " + e.message });
        o.complete && o.complete({ errMsg: "canvasToTempFilePath:fail" });
      }
    },
    createOffscreenCanvas: function () {
      var c = document.createElement("canvas");
      c.getContext("2d");
      return c;
    },
    getImageInfo: function (o) {
      var img = new Image();
      img.onload = function () {
        var r = ok("getImageInfo", { width: img.width, height: img.height, path: o.src });
        o.success && o.success(r); o.complete && o.complete(r);
      };
      img.onerror = function () { o.fail && o.fail({ errMsg: "getImageInfo:fail" }); };
      img.src = o.src;
    },
    saveImageToPhotosAlbum: function (o) {
      // 浏览器端直接触发下载；原来没有可见反馈，用户点了像「分享图生成失败」
      o = o || {};
      try {
        var a = document.createElement("a");
        a.href = o.filePath; a.download = "travel-plan-" + Date.now() + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        showToast({ title: "图片已保存到下载目录", icon: "success" });
        var r = ok("saveImageToPhotosAlbum");
        o.success && o.success(r); o.complete && o.complete(r);
      } catch (e) { o.fail && o.fail({ errMsg: "saveImageToPhotosAlbum:fail " + (e && e.message) }); }
    },
    showShareImageMenu: function (o) {
      // 浏览器端没有系统分享面板，降级为下载（带 toast）
      wx.saveImageToPhotosAlbum(o);
    },
    openSetting: function (o) { o && o.success && o.success({ authSetting: {} }); },
    authorize: function (o) { o && o.success && o.success(ok("authorize")); },
    getSetting: function (o) { o && o.success && o.success({ authSetting: {} }); },
    // 没有模板消息许可，但不能静默失败：给一句去向说明，再让调用方走既有降级
    requestSubscribeMessage: function (o) {
      showToast({ title: "网页版暂不支持消息提醒，可在小程序中开启", icon: "none" });
      o && o.fail && o.fail({ errMsg: "requestSubscribeMessage:fail web" });
      o && o.complete && o.complete({ errMsg: "requestSubscribeMessage:fail web" });
    },
    // 浏览器等价能力：导出标准 .ics 文件下载。原来直接 fail，页面会退回「复制一大段
    // .ics 文本」，用户还得自己存成文件；现在拿到的是可直接导入日历的文件。
    // 成功提示由页面 success 回调负责（它会按平台显示不同文案），避免双重 toast。
    addPhoneCalendar: function (o) {
      o = o || {};
      try {
        downloadICS(o);
        var r = ok("addPhoneCalendar");
        o.success && o.success(r); o.complete && o.complete(r);
      } catch (e) {
        o.fail && o.fail({ errMsg: "addPhoneCalendar:fail " + (e && e.message) });
      }
    },
    addPhoneRepeatCalendar: function (o) {
      wx.addPhoneCalendar(Object.assign({}, o || {}, { repeat: true }));
    },
    // 地图页 onReady/_fitDay 会取上下文；网页版地图是文字占位，但 API 必须存在
    createMapContext: function () { return webMapContext(); },
    reportAnalytics: function () {},
    reportEvent: function () {},
    cloud: null,
    getAccountInfoSync: function () { return { miniProgram: { appId: "web", envVersion: "release" } }; },
    onError: function () {},
    onAppShow: function () {},
    offAppShow: function () {},
    nextTick: function (fn) { setTimeout(fn, 0); },
  };

  function info() {
    return {
      windowWidth: innerWidth, windowHeight: innerHeight, pixelRatio: devicePixelRatio,
      screenWidth: screen.width, screenHeight: screen.height, statusBarHeight: 0,
      platform: "web", system: navigator.userAgent, SDKVersion: "3.8.12",
      language: navigator.language, theme: theme(), fontSizeSetting: 16,
      safeArea: { top: 0, left: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight },
    };
  }
  function theme() {
    return (global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function cleanUrl(u) {
    return String(u || "").replace(/^\//, "").split("?")[0];
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  /* ── 浏览器等价能力：日历 .ics 导出 / 地图上下文 ──
   * 小程序用 wx.addPhoneCalendar 直接写系统日历，网页版没有该 API；
   * 但同一份日程可以导出为标准 .ics 文件，用户下载后双击即可导入日历，
   * 比原来静默 fail → 退回「复制一大段 .ics 文本」可用得多。
   * 刻意不引入任何在线地图 SDK：项目红线是「离线零 key」，地图区域只给
   * 文字说明，点位清单与逐条导航（openLocation→高德）保持可用。
   */
  function icsEscape(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }
  function icsDate(ts) {
    var n = Number(ts);
    if (!isFinite(n) || n <= 0) n = Date.now() / 1000;
    if (n > 1e11) n = n / 1000;              // 兼容误传毫秒
    return new Date(n * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  function downloadICS(o) {
    o = o || {};
    var title = icsEscape(o.title || "旅行行程");
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travel Guide//Web Calendar//CN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + Date.now() + "@travel-guide-web",
      "DTSTAMP:" + icsDate(Date.now() / 1000),
      "DTSTART:" + icsDate(o.startTime),
      "DTEND:" + icsDate(o.endTime),
      "SUMMARY:" + title,
    ];
    if (o.description) lines.push("DESCRIPTION:" + icsEscape(o.description));
    if (o.address || o.location) lines.push("LOCATION:" + icsEscape(o.address || o.location));
    if (o.repeat) {
      var freq = ({ day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" })[o.repeatInterval] || "DAILY";
      lines.push("RRULE:FREQ=" + freq + (o.repeatEndTime ? ";UNTIL=" + icsDate(o.repeatEndTime) : ""));
    }
    if (o.alarm) {
      lines.push("BEGIN:VALARM", "TRIGGER:-PT" + Math.max(1, Math.round(Number(o.alarmOffset || 3600) / 60)) + "M",
        "ACTION:DISPLAY", "DESCRIPTION:" + title, "END:VALARM");
    }
    lines.push("END:VEVENT", "END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "旅行行程-" + new Date().toISOString().slice(0, 10) + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /** 网页版没有原生 map 组件，但页面 JS 会在 onReady/_fitDay 里取上下文。
   *  返回一套 no-op 上下文，让地图页不因缺 API 静默失效（视野数据仍由 setData 维护）。 */
  function webMapContext() {
    var noop = function (o) {
      var r = ok("mapContext");
      if (o && o.success) o.success(r);
      if (o && o.complete) o.complete(r);
    };
    var query = function (o, data) {
      var r = ok("mapContext", data);
      if (o && o.success) o.success(r);
      if (o && o.complete) o.complete(r);
    };
    return {
      moveToLocation: noop, includePoints: noop, setCenterOffset: noop,
      translateMarker: noop, addMarkers: noop, removeMarkers: noop,
      initMarkerCluster: noop, setLocMarkerIcon: noop, on: noop,
      getCenterLocation: function (o) { query(o, { latitude: 39.9, longitude: 116.4 }); },
      getRegion: function (o) { query(o, { southwest: { latitude: 0, longitude: 0 }, northeast: { latitude: 0, longitude: 0 } }); },
      getScale: function (o) { query(o, { scale: 12 }); },
      getRotate: function (o) { query(o, { rotate: 0 }); },
      getSkew: function (o) { query(o, { skew: 0 }); },
      toScreenLocation: function (o) { query(o, { x: 0, y: 0 }); },
      fromScreenLocation: function (o) { query(o, { latitude: 39.9, longitude: 116.4 }); },
    };
  }

  global.wx = wx;

  /* ────────────────────────── Page / Component / getApp ────────────────────────── */

  var APP = null;
  var LOADING = null;

  global.App = function (cfg) { global.__APP_CONFIG = cfg; return cfg; };
  global.Page = function (cfg) {
    if (LOADING) PAGES[LOADING] = cfg;
    return cfg;
  };
  global.Component = function (cfg) { return cfg; };
  global.getApp = function () { return APP; };
  global.getCurrentPages = function () { return []; };

  function setPath(obj, key, val) {
    if (key.indexOf(".") < 0 && key.indexOf("[") < 0) { obj[key] = val; return; }
    var parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  function deepClone(v) {
    try { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }
    catch (e) { return v; }
  }

  function createInstance(pagePath) {
    var cfg = PAGES[pagePath];
    if (!cfg) throw new Error("[web] 页面未注册: " + pagePath);
    var inst = { data: deepClone(cfg.data || {}), __path: pagePath, route: pagePath };
    // 复制属性与方法（不 bind，调用时 call(inst)）
    Object.keys(cfg).forEach(function (k) {
      if (k === "data") return;
      inst[k] = cfg[k];
    });
    inst.setData = function (patch, cb) {
      if (patch) {
        for (var k in patch) setPath(inst.data, k, patch[k]);
      }
      schedule();
      if (typeof cb === "function") setTimeout(cb, 0);
    };
    inst.selectComponent = function () { return null; };
    inst.selectAllComponents = function () { return []; };
    inst.createSelectorQuery = function () { return wx.createSelectorQuery(); };
    return inst;
  }

  /* ────────────────────────── 挂载与渲染 ────────────────────────── */

  var root = null;
  var current = null;
  var pending = false;

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; paint(); });
  }

  /**
   * 给 WXML 的 with(__d) 用的作用域代理。
   *
   * 为什么必须要这层：WXML 里写 {{dark}} 而 data 里没有 dark 时，小程序的表达式
   * 求值返回 undefined（静默），但 JS 的 with 作用域访问未声明变量会抛
   * ReferenceError（实测 pages/splash 直接炸在 `dark is not defined`）。
   * 所以 has 恒为 true 把所有标识符都交给 get，get 依次查：data → 全局 → undefined。
   * 渲染原语（__h/__c/__t/__pick）也挂在全局上，保证 with 体内仍能调到。
   */
  var _scopeCache = new WeakMap();
  function scopeOf(data) {
    var p = _scopeCache.get(data);
    if (p) return p;
    p = new Proxy(data, {
      has: function () { return true; },
      get: function (t, k) {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (k in global) return global[k];
        return undefined;
      },
      set: function (t, k, v) { t[k] = v; return true; },
    });
    _scopeCache.set(data, p);
    return p;
  }

  function paint() {
    if (!current || !root) return;
    var tpl = global.__TPL && global.__TPL[current.__path];
    if (!tpl) {
      root.innerHTML = '<div class="w-err">页面模板缺失：' + escHtml(current.__path) + "</div>";
      return;
    }
    // 记录焦点与滚动，重建后恢复（整页重建最怕输入框失焦）
    var ae = document.activeElement;
    var fkey = ae && ae.__fkey;
    var selStart = ae && ae.selectionStart;
    var scrollY = global.scrollY;

    inputSeq = 0;
    var node;
    try {
      node = tpl(__h, __c, __t, __pick, scopeOf(current.data));
    } catch (e) {
      console.error("[web] 渲染异常", current.__path, e);
      root.innerHTML = '<div class="w-err">渲染异常：' + escHtml(e && e.message) + "</div>";
      return;
    }
    var kids = (node == null) ? [] : (Array.isArray(node) ? node : [node]);
    root.setAttribute("data-page", current.__path);
    root.replaceChildren.apply(root, kids.map(function (k) {
      if (k && k.nodeType) return k;
      if (k && k.__text !== undefined) return document.createTextNode(k.__text);
      return document.createTextNode(k == null || k === false ? "" : String(k));
    }));

    if (fkey) {
      var next = root.querySelector('[data-fkey="' + fkey + '"]') || document.querySelector('[data-fkey="' + fkey + '"]');
      if (next) {
        try { next.focus({ preventScroll: true }); if (selStart != null && next.setSelectionRange) next.setSelectionRange(selStart, selStart); } catch (e) {}
      }
    }
    if (Math.abs((global.scrollY || 0) - scrollY) > 4) global.scrollTo(0, scrollY);
  }

  /** 事件委托：把 DOM 事件翻译成小程序的 e.currentTarget.dataset / e.detail */
  function bindEvents() {
    var map = { click: "click", input: "input", change: "change", blur: "blur", focus: "focus", submit: "submit", contextmenu: "contextmenu", touchstart: "touchstart", touchmove: "touchmove", touchend: "touchend", keydown: "keydown", scroll: "scroll" };
    Object.keys(map).forEach(function (domEvt) {
      root.addEventListener(domEvt, function (ev) {
        // scroll 事件不冒泡到 handler 名，需要单独找带 __ev 的祖先
        var el = ev.target;
        var handlerName = null, catchIt = false, hit = null;
        while (el && el !== root) {
          var e2 = el.__ev;
          if (e2) {
            var evKey = (domEvt === "keydown") ? "on:confirm" : (evEvKey(domEvt, e2));
            if (e2["catch:" + domEvt]) { handlerName = e2["catch:" + domEvt]; catchIt = true; hit = el; break; }
            if (e2["on:" + domEvt]) { handlerName = e2["on:" + domEvt]; hit = el; break; }
          }
          el = el.parentElement;
        }
        if (!handlerName) return;
        if (domEvt === "keydown") {
          if (ev.key !== "Enter") return;
        }
        if (catchIt) ev.stopPropagation();
        if (domEvt === "click") ev.preventDefault();

        var dataset = {};
        if (hit && hit.dataset) for (var d in hit.dataset) dataset[d] = hit.dataset[d];

        var detail = {};
        if (domEvt === "input" || domEvt === "change") detail = { value: hit && hit.value };
        if (domEvt === "keydown") detail = { value: hit && hit.value };
        if (domEvt === "submit") detail = { value: {} };

        var synth = {
          type: domEvt === "keydown" ? "confirm" : domEvt,
          timeStamp: Date.now(),
          target: { id: hit && hit.id, dataset: dataset, value: hit && hit.value },
          currentTarget: { id: hit && hit.id, dataset: dataset },
          detail: detail,
          touches: ev.touches ? Array.from(ev.touches) : [],
          preventDefault: function () {}, stopPropagation: function () {},
        };
        try {
          current[handlerName].call(current, synth);
        } catch (err) {
          console.error("[web] handler 异常 " + handlerName, err);
          showToast({ title: "操作失败：" + (err && err.message), icon: "none" });
        }
      }, true);
    });
  }

  function evEvKey(domEvt, e2) {
    if (e2["catch:" + domEvt]) return "catch:" + domEvt;
    return "on:" + domEvt;
  }

  /* ────────────────────────── 对外入口 ────────────────────────── */

  global.__bootWeb = function (appConfig, router) {
    APP = { globalData: (appConfig && appConfig.globalData) || {} };
    if (appConfig && typeof appConfig.onLaunch === "function") {
      try { appConfig.onLaunch.call(APP, { scene: 1001, query: {} }); } catch (e) { console.warn("[web] app.onLaunch 异常", e); }
    }
    if (appConfig && typeof appConfig.onShow === "function") {
      try { appConfig.onShow.call(APP, { scene: 1001 }); } catch (e) {}
    }
    ROUTER = router;
    root = document.getElementById("app");
    bindEvents();

    global.__mountPage = function (pagePath) {
      if (current && typeof current.onUnload === "function") {
        try { current.onUnload(); } catch (e) {}
      }
      if (current && typeof current.onHide === "function") {
        try { current.onHide(); } catch (e) {}
      }
      LOADING = pagePath;
      try {
        if (!PAGES[pagePath]) global.__require("__entry__", "./" + pagePath + ".js");
      } catch (e) {
        console.error("[web] 页面加载失败", pagePath, e);
        root.innerHTML = '<div class="w-err">页面加载失败：' + escHtml(pagePath) + "<br/>" + escHtml(e && e.message) + "</div>";
        return;
      }
      LOADING = null;
      if (!PAGES[pagePath]) {
        root.innerHTML = '<div class="w-err">页面未注册：' + escHtml(pagePath) + "</div>";
        return;
      }
      current = createInstance(pagePath);
      if (typeof current.onLoad === "function") {
        try { current.onLoad({ scene: 1001, query: {} }); } catch (e) { console.error("[web] onLoad 异常", e); }
      }
      if (typeof current.onShow === "function") {
        try { current.onShow(); } catch (e) { console.error("[web] onShow 异常", e); }
      }
      paint();
      // 部分页面在 ready() 之后才真正有数据，稍后再刷一次
      setTimeout(function () { if (current && current.__path === pagePath) paint(); }, 60);
      setTimeout(function () { if (current && current.__path === pagePath) paint(); }, 400);
    };

    global.__webRefresh = paint;
    global.__webCurrent = function () { return current; };
  };

  global.__wxError = function (msg) { showToast({ title: msg, icon: "none" }); };

  // 渲染原语挂全局：WXML 的 with 作用域会把所有标识符交给 scopeOf 的 get，
  // 这里让 __h/__c/__t/__pick 能被 "k in global" 兜住（否则 with 体内调不到）。
  global.__h = __h;
  global.__c = __c;
  global.__t = __t;
  global.__pick = __pick;
  global.__m = __m;
})(window);
