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

  /* ── 网页版地图示意图 ──
     合规红线：离线零 key，不加载任何在线地图 SDK / 底图。
     但空 div 会让演示与用户以为页面坏了，故用真实经纬度把「编号标点 + 当天连线」
     等距投影成 SVG 示意图（非底图），既保留合规又让地图页有内容、可讲解。
     数据来源：WXML <map> 已被编译为 __h("div",{id:"map",class:"the-map",markers,polyline,...})。 */
  function __schematic(props) {
    var markers = Array.isArray(props && props.markers) ? props.markers : [];
    var lines = Array.isArray(props && props.polyline) ? props.polyline : [];
    var pts = [];
    markers.forEach(function (m) { if (m && isFinite(m.latitude) && isFinite(m.longitude)) pts.push([+m.latitude, +m.longitude]); });
    lines.forEach(function (l) { ((l && l.points) || []).forEach(function (q) { if (q && isFinite(q.latitude) && isFinite(q.longitude)) pts.push([+q.latitude, +q.longitude]); }); });
    if (!pts.length) return '<div class="map-schem-empty">该天暂无精确坐标标点<br/>到当地后点下方列表行即可导航</div>';
    var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    pts.forEach(function (p) {
      if (p[0] < minLat) minLat = p[0]; if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLon) minLon = p[1]; if (p[1] > maxLon) maxLon = p[1];
    });
    var W = 750, H = 470, PAD = 60, iw = W - 2 * PAD, ih = H - 2 * PAD;
    var cosLat = Math.cos((minLat + maxLat) / 2 * Math.PI / 180) || 1;
    var latS = Math.max(0.0025, maxLat - minLat), lonS = Math.max(0.0025, maxLon - minLon);
    var s = Math.min(iw / (lonS * cosLat), ih / latS);
    var cx = PAD + iw / 2, cy = PAD + ih / 2, midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2;
    function X(lon) { return cx + (lon - midLon) * cosLat * s; }
    function Y(lat) { return cy - (lat - midLat) * s; }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="map-svg" xmlns="http://www.w3.org/2000/svg">';
    for (var gx = PAD; gx <= W - PAD + 1; gx += iw / 4) svg += '<line x1="' + gx.toFixed(1) + '" y1="' + PAD + '" x2="' + gx.toFixed(1) + '" y2="' + (H - PAD) + '" stroke="rgba(148,163,184,.18)" stroke-width="1"/>';
    for (var gy = PAD; gy <= H - PAD + 1; gy += ih / 4) svg += '<line x1="' + PAD + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(148,163,184,.18)" stroke-width="1"/>';
    lines.forEach(function (l) {
      var ps = ((l && l.points) || []).filter(function (q) { return q && isFinite(q.latitude) && isFinite(q.longitude); });
      if (ps.length < 2) return;
      var d = ps.map(function (q, i) { return (i ? "L" : "M") + X(+q.longitude).toFixed(1) + " " + Y(+q.latitude).toFixed(1); }).join(" ");
      svg += '<path d="' + d + '" fill="none" stroke="' + escHtml(l.color || "#d4a94e") + '" stroke-width="' + (l.width || 3) + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>';
    });
    markers.forEach(function (m) {
      if (!(m && isFinite(m.latitude) && isFinite(m.longitude))) return;
      var x = X(+m.longitude), y = Y(+m.latitude);
      var label = (m.callout && m.callout.content != null) ? String(m.callout.content) : "";
      var isNum = /^\d+$/.test(label);
      var fill = label.indexOf("美食") === 0 ? "#e07a5f" : (label.indexOf("住") === 0 ? "#3d7eff" : "#d4a94e");
      // data-mid 保留原始 marker id：网页版没有原生 map 组件，靠点击委托还原 markerId
      var mid = m.id == null ? "" : escHtml(String(m.id));
      svg += '<circle class="map-mk" data-mid="' + mid + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (isNum ? 13 : 8) + '" fill="' + fill + '" stroke="#fff" stroke-width="2"/>';
      if (isNum) svg += '<text x="' + x.toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a1a">' + escHtml(label) + "</text>";
      else if (label) svg += '<text x="' + x.toFixed(1) + '" y="' + (y - 14).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#3b4657">' + escHtml(label.slice(0, 12)) + "</text>";
    });
    svg += '<text x="' + (W - PAD) + '" y="' + (H - 16) + '" text-anchor="end" font-size="11" fill="rgba(120,132,150,.75)">示意图 · 真实坐标 · 不加载在线底图</text>';
    return svg + "</svg>";
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
    // 网页版地图：把编译后的 map 占位 div 换成「真实坐标示意图」（散点+连线，非底图）。
    if (tag === "div" && el.classList && el.classList.contains("the-map") && props && props.id === "map") {
      try {
        el.classList.add("map-schem");
        el.innerHTML = __schematic(props);
        // WXML 的 bindmarkertap / bindcallouttap 由原生 map 组件派发；网页端是 SVG 示意图，
        // 这里补一层点击委托，把点中的编号还原成 markerId，让「点标点直接唤起导航」
        // 在网页版同样可用（旧版事件被编译出来却永不触发，点了没反应）。
        var evm = props.__ev || {};
        var mkHandler = evm["on:markertap"] || evm["catch:markertap"] || evm["on:callouttap"] || evm["catch:callouttap"];
        if (mkHandler) {
          el.addEventListener("click", function (e) {
            var hit = e.target && e.target.closest ? e.target.closest(".map-mk[data-mid]") : null;
            if (!hit || !current || typeof current[mkHandler] !== "function") return;
            var rawId = hit.getAttribute("data-mid");
            var markerId = rawId;
            var mk = props.markers || [];
            for (var mi = 0; mi < mk.length; mi++) {
              if (String(mk[mi] && mk[mi].id) === rawId) { markerId = mk[mi].id; break; }
            }
            try {
              current[mkHandler].call(current, {
                type: "markertap", detail: { markerId: markerId },
                currentTarget: { id: el.id, dataset: {} }, target: { id: el.id, dataset: {} },
                timeStamp: Date.now()
              });
            } catch (err) { console.error("[web] markertap 异常", err); }
          });
        }
      } catch (e) { /* 任何异常都退回原占位，不影响页面 */ }
    }
    return el;
  }

  /**
   * picker 降级：
   *   selector → 真正的 <select>（option 由 range 生成，value = 索引，与小程序 e.detail.value 一致）
   *   date/time → 原生 <input type=date|time>，并把 __ev / dataset 复制到 input，
   *               否则用户操作的是 input、事件却挂在被隐藏的 select 上，bindchange 永不触发。
   * 2026-11-10：旧版 selector 是空 <select>（0 个 option）、date 初值是 "{{depart}}" 字面量、
   * 且 change handler 找不到 —— 网页版所有下拉与日期选择都点不动。
   */
  function __pick(mode, value, el, range, rangeKey, start, end) {
    try {
      if (mode === "selector" || mode === "multiSelector") {
        el.classList.add("w-picker-select");
        var arr = Array.isArray(range) ? range : [];
        el.innerHTML = "";
        arr.forEach(function (it, i) {
          var op = document.createElement("option");
          op.value = String(i);                       // 小程序 selector 返回索引，不是显示文本
          var txt = (rangeKey && it && typeof it === "object") ? it[rangeKey] : it;
          op.textContent = txt == null ? "" : String(txt);
          el.appendChild(op);
        });
        var idx = Number(value);
        el.selectedIndex = (isFinite(idx) && idx >= 0 && idx < arr.length) ? idx : 0;
        el.__fkey = "f" + (inputSeq++);
        el.setAttribute("data-fkey", el.__fkey);
        return el;
      }
      var wrap = document.createElement("div");
      wrap.className = "w-picker-wrap";
      var input = document.createElement("input");
      input.type = (mode === "time") ? "time" : (mode === "date" ? "date" : "text");
      input.className = "w-picker-input";
      input.value = String(value == null ? "" : value);
      if (start != null && start !== "") input.min = String(start);
      if (end != null && end !== "") input.max = String(end);
      // 事件与数据集必须随「真正被操作的元素」走
      if (el.__ev) input.__ev = el.__ev;
      if (el.dataset) { for (var d in el.dataset) input.dataset[d] = el.dataset[d]; }
      input.__fkey = "f" + (inputSeq++);
      input.setAttribute("data-fkey", input.__fkey);
      el.classList.add("w-picker-native");
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
  var navDepth = 0;    // 网页端简易页面栈深度：决定 navigateBack 能否真的退回

  function route(path, mode) {
    mode = mode || "push";
    if (mode === "push") navDepth++;
    else if (mode === "tab") navDepth = 0;
    // replace / reLaunch：用当前页替换，深度不变
    if (!ROUTER) { location.hash = "#/" + String(path).replace(/^\//, ""); return; }
    ROUTER(path, mode);
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

  /* 本地演示用：允许通过 URL 参数一次性注入第三方 Key（**仅 localhost / 127.0.0.1 生效**）。
     目的：仓库与代码里绝不含明文 Key（合规），但演示机可临时启用天气 / 高德。
     用法： index.html?qwk=<和风Key>&qwh=<和风专属Host>
     注入后写入 localStorage，之后的访问无需再带参数；生产域名下这段逻辑直接跳过。 */
  (function () {
    try {
      var h = String((global.location && global.location.hostname) || "");
      if (h !== "localhost" && h !== "127.0.0.1") return;
      var qs = String((global.location && global.location.search) || "").replace(/^\?/, "");
      if (!qs) return;
      var p = {};
      qs.split("&").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i < 0) return;
        try { p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {}
      });
      if (!p.qwk) return;
      var cur = lsGet("__app_keys__");
      var next = (cur && typeof cur === "object") ? cur : {};
      next.qweatherKey = p.qwk;
      if (p.qwh) next.qweatherHost = p.qwh;
      lsSet("__app_keys__", next);
    } catch (e) {}
  })();

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
    navigateBack: function (o) {
      o = o || {};
      // 网页端直接打开 /#/subpkg/food/food 时 history 里没有上一页，
      // history.back() 会「点了没反应」；退回首页给用户一个明确去处。
      if (navDepth > 0) { navDepth--; history.back(); }
      else route("pages/index/index", "tab");
      o.success && o.success(ok("navigateBack"));
      o.complete && o.complete(ok("navigateBack"));
    },
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
      var method = String(o.method || "GET").toUpperCase();
      var url = String(o.url || "");
      // 小程序 GET 的 data 会自动拼到 query，浏览器 fetch 不会 —— 旧版天气/地理请求因此丢参数。
      if (method === "GET" && o.data && typeof o.data === "object") {
        var qs = Object.keys(o.data).map(function (k) {
          return encodeURIComponent(k) + "=" + encodeURIComponent(o.data[k] == null ? "" : o.data[k]);
        }).join("&");
        if (qs) url += (url.indexOf("?") >= 0 ? "&" : "?") + qs;
      }
      var body;
      if (method !== "GET" && method !== "HEAD" && o.data != null) {
        var hdr = o.header || {}, isJson = false;
        for (var hk in hdr) if (/content-type/i.test(hk) && /json/i.test(String(hdr[hk]))) isJson = true;
        body = (isJson || typeof o.data === "object") ? JSON.stringify(o.data) : String(o.data);
      }
      fetch(url, { method: method, headers: o.header || {}, body: body, signal: ctrl.signal })
        .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
        .then(function (rr) {
          clearTimeout(to);
          var data = rr.text;
          try { data = JSON.parse(rr.text); } catch (e) {}
          var res = ok("request", { statusCode: rr.status, data: data });
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
            fields: function (o, cb) { tasks.push({ sel: sel, cb: cb, type: "fields", opts: o || {} }); return q; },
            node: function (cb) { tasks.push({ sel: sel, cb: cb, type: "node" }); return q; },
            scrollOffset: function (cb) { tasks.push({ sel: sel, cb: cb, type: "scroll" }); return q; },
          };
        },
        selectAll: function (sel) {
          return {
            boundingClientRect: function (cb) { tasks.push({ sel: sel, cb: cb, type: "rectAll" }); return q; },
            fields: function (o, cb) { tasks.push({ sel: sel, cb: cb, type: "fieldsAll", opts: o || {} }); return q; },
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
            // fields({node:true}) 必须返回真实 DOM 节点：分享长图 / canvas 2d 导出
            // 会用它取 context；旧版只回 rect，导出在网页端永远失败。
            if (t.type === "fields" || t.type === "fieldsAll") {
              var all = t.type === "fieldsAll";
              var els = all ? Array.prototype.slice.call(document.querySelectorAll(t.sel))
                            : [t.sel ? document.querySelector(t.sel) : null];
              var arr = els.filter(Boolean).map(function (node) {
                var rr = node.getBoundingClientRect();
                var out = { id: node.id, left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom,
                            width: rr.width, height: rr.height, dataset: node.dataset };
                if (t.opts && t.opts.node) out.node = node;
                return out;
              });
              return all ? arr : (arr[0] || null);
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
    // 保留 query：小程序 navigateTo({url:"/subpkg/map/map?di=2"}) 的参数必须到 onLoad，
    // 旧版 split("?")[0] 把 di 吞掉，网页版地图永远只显示第 1 天、AI 带参跳转也失效。
    return String(u || "").replace(/^\//, "");
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
  var lastQuery = {};     // 当前页 onLoad 收到的 query（AI / 导航抽屉读它感知上下文）

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
    // touchcancel / reset 原在 wxml 编译器里有映射，这里却没监听 → 拖拽中断收尾、表单重置永不触发
    var map = { click: "click", input: "input", change: "change", blur: "blur", focus: "focus",
      submit: "submit", reset: "reset", contextmenu: "contextmenu", touchstart: "touchstart",
      touchmove: "touchmove", touchend: "touchend", touchcancel: "touchcancel",
      keydown: "keydown", scroll: "scroll" };
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
    // 必须复制 appConfig 的方法（setPlan / clearPlan / _archiveOld…），不能只给 globalData：
    // 各页经 getAppSafe() 调 app.setPlan(...) 生成行程，旧版网页端拿到的是 undefined，
    // 首页「生成攻略」点了必然报错，AI 也无法真正把行程落到页面上。
    // globalData 保持同一引用，index.html 的备份导入写 __APP_CONFIG.globalData.plan 仍同步生效。
    APP = Object.assign({}, appConfig || {}, { globalData: (appConfig && appConfig.globalData) || {} });
    if (appConfig && typeof appConfig.onLaunch === "function") {
      try { appConfig.onLaunch.call(APP, { scene: 1001, query: {} }); } catch (e) { console.warn("[web] app.onLaunch 异常", e); }
    }
    if (appConfig && typeof appConfig.onShow === "function") {
      try { appConfig.onShow.call(APP, { scene: 1001 }); } catch (e) {}
    }
    ROUTER = router;
    root = document.getElementById("app");
    bindEvents();

    global.__mountPage = function (pagePath, query) {
      lastQuery = query || {};
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
        try { current.onLoad({ scene: 1001, query: lastQuery }); } catch (e) { console.error("[web] onLoad 异常", e); }
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
    global.__webQuery = function () { return lastQuery; };
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
