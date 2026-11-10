/* web/app.js —— 网页版外壳：hash 路由 + tabBar + 全站页面导航 + 启动流程
 *
 * 刻意做得很薄：页面逻辑全在小程序源码里（由 modules.js 注册、runtime.js 驱动），
 * 这里只负责「换页 / 底部导航 / 顶部返回 / 全站页面抽屉」这几件外壳的事。
 *
 * 2026-11-10：router 支持 ?query 透传与 replace/tab 语义；页面清单来自构建生成的
 * lib/nav.js（与 app.json 同源），不再手抄 —— 小程序增删页面后重跑构建自动同步。
 */
(function () {
  "use strict";

  var HOME = "pages/index/index";
  var TABS = {
    "pages/index/index": "index",
    "pages/today/today": "today",
    "pages/plan/plan": "plan",
    "pages/more/more": "more",
  };
  var TAB_LABEL = {
    "pages/index/index": "出发",
    "pages/today/today": "今天",
    "pages/plan/plan": "行程",
    "pages/more/more": "更多",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function parseQuery(s) {
    var q = {};
    String(s || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? "" : kv.slice(i + 1);
      try { q[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) {}
    });
    return q;
  }

  function splitHash() {
    var raw = String(location.hash || "").replace(/^#\/?/, "");
    var qi = raw.indexOf("?");
    return {
      path: (qi < 0 ? raw : raw.slice(0, qi)) || HOME,
      query: qi < 0 ? {} : parseQuery(raw.slice(qi + 1)),
    };
  }

  function pageTitle(p) {
    var list = window.__WEB_NAV || [];
    for (var i = 0; i < list.length; i++) if (list[i].p === p) return list[i].t;
    return p.split("/").pop();
  }

  /** 运行时调用的路由：path 可带 ?query；mode = push / replace / tab */
  function router(path, mode, query) {
    var raw = String(path || "").replace(/^\//, "");
    var qi = raw.indexOf("?");
    var p = (qi < 0 ? raw : raw.slice(0, qi)) || HOME;
    var q = qi < 0 ? {} : parseQuery(raw.slice(qi + 1));
    if (query && typeof query === "object") {
      for (var k in query) if (Object.prototype.hasOwnProperty.call(query, k)) q[k] = query[k];
    }
    var qs = Object.keys(q).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]);
    }).join("&");
    var target = "#/" + p + (qs ? "?" + qs : "");
    mode = mode || "push";
    if (location.hash === target) {
      // 同页重复跳转（例如已在该 tab 再点一次、或换了 query）：直接重挂刷新数据
      window.__mountPage(p, q);
      syncTab(p);
      syncTopBar(p);
      return;
    }
    if (mode === "replace") {
      // replaceState 不触发 hashchange，必须手动重挂；失败则退回普通 hash 赋值
      try { history.replaceState(null, "", target); onHash(); return; } catch (e) {}
    }
    location.hash = target;
  }

  function syncTab(p) {
    // 桌面侧栏高亮必须放在 tabbar 的早退判断之前
    if (sidebar) Array.prototype.forEach.call(sidebar.querySelectorAll(".ws-item"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-p") === p);
    });
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    var key = TABS[p];
    if (key) {
      bar.classList.remove("hidden");
      document.body.classList.add("has-tabbar");
    } else {
      bar.classList.add("hidden");
      document.body.classList.remove("has-tabbar");
    }
    Array.prototype.forEach.call(bar.querySelectorAll(".tb"), function (el) {
      var on = el.dataset.p === p;
      el.classList.toggle("on", on);
      var k = TABS[el.dataset.p];
      if (k) el.querySelector("img").src = "images/tab-" + k + (on ? "-active" : "") + ".png";
    });
  }

  /* ── 顶部返回栏 + 全站页面抽屉 + 桌面侧栏 ── */
  var topBar = null, navPanel = null, sidebar = null;

  function ensureChrome() {
    if (topBar) return topBar;
    topBar = document.createElement("div");
    topBar.id = "webTopBar";
    topBar.className = "hidden";
    topBar.innerHTML =
      '<button class="wt-back" id="webBack" type="button" aria-label="返回">‹ 返回</button>' +
      '<span class="wt-title" id="webTopTitle"></span>' +
      '<button class="wt-nav" id="webNavBtn" type="button" aria-label="全部页面">☰ 页面</button>';
    document.body.appendChild(topBar);
    document.getElementById("webBack").addEventListener("click", function () {
      // 走 runtime 的 navigateBack：无历史时它会兜底回出发页，不会「点了没反应」
      if (window.wx && typeof window.wx.navigateBack === "function") window.wx.navigateBack();
      else router(HOME, "tab");
    });
    document.getElementById("webNavBtn").addEventListener("click", function () {
      if (navPanel) navPanel.classList.toggle("hidden");
    });
    // tab 页不显示顶部栏，所以外壳左下角保留一个常驻的「全部页面」入口
    var openBtn = document.getElementById("webNavOpen");
    if (openBtn) openBtn.addEventListener("click", function () {
      if (navPanel) navPanel.classList.toggle("hidden");
    });
    return topBar;
  }

  function buildNav() {
    var p = document.createElement("div");
    p.id = "webNavPanel";
    p.className = "hidden";
    var list = window.__WEB_NAV || [];
    var groups = {}, order = [];
    list.forEach(function (x) {
      if (!groups[x.g]) { groups[x.g] = []; order.push(x.g); }
      groups[x.g].push(x);
    });
    var html = '<div class="wn-head"><b>全部页面</b>' +
      '<button id="webNavClose" type="button" aria-label="关闭">×</button></div>';
    html += '<button class="wn-item wn-home" data-p="' + HOME + '" data-tab="1">回到出发页</button>';
    order.forEach(function (g) {
      html += '<div class="wn-g">' + esc(g) + "</div>";
      groups[g].forEach(function (x) {
        html += '<button class="wn-item" data-p="' + esc(x.p) + '" data-tab="' + (x.tab ? "1" : "0") + '">' +
          esc(x.t) + (x.tab ? '<span class="wn-tab">tab</span>' : "") + "</button>";
      });
    });
    html += '<div class="wn-foot">共 ' + list.length + " 页 · 清单由 app.json 自动生成，与小程序同源</div>";
    p.innerHTML = html;
    document.body.appendChild(p);
    p.querySelector("#webNavClose").addEventListener("click", function () { p.classList.add("hidden"); });
    p.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".wn-item") : null;
      if (!b) return;
      router(b.getAttribute("data-p"), b.getAttribute("data-tab") === "1" ? "tab" : "push");
      p.classList.add("hidden");
    });
    return p;
  }

  /* ── 桌面常驻侧栏（≥1100px 显示）：替代底部 tabBar，形成横屏应用结构 ── */
  function buildSidebar() {
    var p = document.createElement("aside");
    p.id = "webSidebar";
    var list = window.__WEB_NAV || [];
    var groups = {}, order = [];
    list.forEach(function (x) {
      if (!groups[x.g]) { groups[x.g] = []; order.push(x.g); }
      groups[x.g].push(x);
    });
    var html = '<div class="ws-brand"><b>旅行攻略生成器</b><span>网页版 · 桌面布局</span>' +
      '<button class="ws-collapse" id="wsCollapse" type="button" aria-label="收起侧栏" title="收起侧栏">‹</button></div>';
    html += '<div class="ws-scroll"><div class="ws-group">主导航</div>';
    Object.keys(TABS).forEach(function (path) {
      html += '<button class="ws-item" data-p="' + esc(path) + '" data-tab="1">' + esc(TAB_LABEL[path] || path) + "</button>";
    });
    order.forEach(function (g) {
      var rest = groups[g].filter(function (x) { return !x.tab; });
      if (!rest.length) return;
      html += '<div class="ws-group">' + esc(g) + "</div>";
      rest.forEach(function (x) {
        html += '<button class="ws-item" data-p="' + esc(x.p) + '" data-tab="0">' + esc(x.t) + "</button>";
      });
    });
    html += "</div>";
    html += '<div class="ws-foot">' +
      '<button class="ws-btn" id="wsAI">打开 AI 助手</button>' +
      '<button class="ws-btn" id="wsLayout">切换宽屏 / 单列</button>' +
      "</div>";
    p.innerHTML = html;
    document.body.appendChild(p);
    p.addEventListener("click", function (e) {
      var t = e.target;
      var item = t.closest ? t.closest(".ws-item") : null;
      if (item) {
        router(item.getAttribute("data-p"), item.getAttribute("data-tab") === "1" ? "tab" : "push");
        return;
      }
      if (t.closest && t.closest("#wsCollapse")) { toggleSidebar(); return; }
      if (t.closest && t.closest("#wsAI")) { if (window.__webAI) window.__webAI.open(); return; }
      if (t.closest && t.closest("#wsLayout")) toggleLayout();
    });
    // 折叠态的「展开菜单」浮钮（仅折叠时通过 CSS 显示）
    var expand = document.createElement("button");
    expand.id = "wsExpand";
    expand.type = "button";
    expand.textContent = "☰ 展开菜单";
    expand.addEventListener("click", toggleSidebar);
    document.body.appendChild(expand);
    return p;
  }

  /* ── 布局偏好：默认按视口自动分栏，用户可在任意宽度手动强制「宽屏多列 / 单列」 ── */
  var LAYOUT_KEY = "web_layout_v1";
  var WIDE_BP = 820;   // 与 shell.css 的自动两列断点一致
  function applyLayoutPref() {
    try {
      var v = localStorage.getItem(LAYOUT_KEY);
      document.body.classList.toggle("force-wide", v === "wide");
      document.body.classList.toggle("single-col", v === "single");
    } catch (e) {}
  }
  function currentlyWide() {
    if (document.body.classList.contains("single-col")) return false;
    if (document.body.classList.contains("force-wide")) return true;
    return window.innerWidth >= WIDE_BP;   // 自动模式
  }
  function toggleLayout() {
    var next = !currentlyWide();           // 点一下切到相反状态
    document.body.classList.toggle("force-wide", next);
    document.body.classList.toggle("single-col", !next);
    try { localStorage.setItem(LAYOUT_KEY, next ? "wide" : "single"); } catch (e) {}
    try {
      if (window.wx && window.wx.showToast) {
        window.wx.showToast({ title: next ? "已切换为宽屏多列" : "已切换为单列阅读", icon: "none" });
      }
    } catch (e) {}
  }

  /* ── 侧栏折叠偏好：默认展开，用户可收起让出全宽（桌面横屏时更有用） ── */
  var SIDEBAR_KEY = "web_sidebar_v1";
  function applySidebarPref() {
    try {
      var v = localStorage.getItem(SIDEBAR_KEY);
      document.body.classList.toggle("sidebar-collapsed", v === "collapsed");
    } catch (e) {}
  }
  function toggleSidebar() {
    var collapsed = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded"); } catch (e) {}
  }

  function syncTopBar(p) {
    var bar = ensureChrome();
    var isTab = Object.prototype.hasOwnProperty.call(TABS, p);
    bar.classList.toggle("hidden", isTab);
    document.body.classList.toggle("has-topbar", !isTab);
    var t = document.getElementById("webTopTitle");
    if (t) t.textContent = pageTitle(p);
    document.title = pageTitle(p) + " · 旅行攻略生成器";
    if (navPanel) Array.prototype.forEach.call(navPanel.querySelectorAll(".wn-item"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-p") === p);
    });
  }

  function onHash() {
    var r = splitHash();
    try {
      window.__mountPage(r.path, r.query);
    } catch (e) {
      console.error("[web] 换页失败", r.path, e);
    }
    syncTab(r.path);
    syncTopBar(r.path);
    window.scrollTo(0, 0);
    // 全站 AI 助手靠这个事件感知「用户现在在哪一页」，动态换快捷提问
    try { document.dispatchEvent(new CustomEvent("web:pagechange", { detail: r })); } catch (e) {}
  }

  function bootFail(msg, err) {
    var b = document.getElementById("boot");
    document.getElementById("bootMsg").innerHTML =
      '<span style="color:#e57373">' + esc(msg) + "</span>" +
      (err ? '<br/><span style="font-size:11px;color:#7d8798">' + esc(err.message || err) + "</span>" : "");
    console.error("[web] 启动失败", msg, err);
  }

  function ready() {
    var box = document.getElementById("boot");
    if (box) box.classList.add("hide");
    setTimeout(function () { if (box) box.remove(); }, 420);
  }

  window.addEventListener("load", function () {
    try {
      // 1) 小程序 app.js —— 拿到 globalData / onLaunch（复用同一份，不另写）
      window.__require("__entry__", "./app.js");
      var cfg = window.__APP_CONFIG || { globalData: {} };

      // 2) 启动运行时（提供 wx / Page / 渲染）
      window.__bootWeb(cfg, router);
      ensureChrome();
      navPanel = buildNav();
      sidebar = buildSidebar();
      applyLayoutPref();
      applySidebarPref();
      var layoutBtn = document.getElementById("webLayoutBtn");
      if (layoutBtn) layoutBtn.addEventListener("click", toggleLayout);
      // 工具条默认收起，避免浮动按钮压住内容；桌面侧栏里另有「切换宽屏 / 单列」入口
      var toolsToggle = document.getElementById("webToolsToggle");
      var toolsBox = document.getElementById("webTools");
      if (toolsToggle && toolsBox) toolsToggle.addEventListener("click", function () {
        var hidden = toolsBox.classList.toggle("hidden");
        toolsToggle.textContent = hidden ? "工具 / 布局" : "收起工具";
      });

      // 3) tabBar 点击
      Array.prototype.forEach.call(document.querySelectorAll("#tabbar .tb"), function (el) {
        el.addEventListener("click", function () { router(el.dataset.p, "tab"); });
      });

      // 4) 键盘快捷跳转：Alt+← 返回 / Alt+H 出发页 / Alt+N 页面抽屉
      document.addEventListener("keydown", function (e) {
        if (!e.altKey) return;
        if (e.key === "ArrowLeft") { e.preventDefault(); window.__webBack(); }
        else if (e.key === "h" || e.key === "H") { e.preventDefault(); router(HOME, "tab"); }
        else if (e.key === "n" || e.key === "N") { e.preventDefault(); if (navPanel) navPanel.classList.toggle("hidden"); }
      });

      // 5) 路由监听
      window.addEventListener("hashchange", onHash);
      if (!location.hash) location.hash = "#/" + HOME;
      else onHash();

      // 6) 等数据就绪再收起启动层（解压 2.3MB 需要一点时间）
      var T = window.__require("__entry__", "./utils/travel.js");
      var done = function () {
        setTimeout(function () {
          ready();
          // 数据回来后部分页面已渲染成空态，补刷一次
          if (window.__webCurrent && window.__webCurrent()) window.__webRefresh();
        }, 30);
      };
      if (T && typeof T.ready === "function") {
        T.ready().then(done, function (e) { bootFail("离线数据加载失败", e); });
      } else {
        done();
      }
      setTimeout(ready, 6000); // 兜底：绝不把用户永远挡在启动层
    } catch (e) {
      bootFail("启动异常", e);
      ready();
    }
  });

  /* 对外入口：控制台 / AI 助手 / 页面内都可用 */
  window.go = function (p, mode) { router(p, mode || "push"); };
  window.goQuery = function (p, q, mode) { router(p, mode || "push", q); };
  window.__webRouter = router;
  window.__webSplitHash = splitHash;
  window.__webBack = function () {
    if (window.wx && typeof window.wx.navigateBack === "function") window.wx.navigateBack();
    else router(HOME, "tab");
  };
})();
