/* web/app.js —— 网页版外壳：hash 路由 + tabBar + 启动流程
 *
 * 刻意做得很薄：页面逻辑全在小程序源码里（由 modules.js 注册、runtime.js 驱动），
 * 这里只负责「换页」和「底部导航」两件外壳的事。
 */
(function () {
  "use strict";

  var TABS = {
    "pages/index/index": "index",
    "pages/today/today": "today",
    "pages/plan/plan": "plan",
    "pages/more/more": "more",
  };

  function currentPath() {
    var h = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return h || "pages/index/index";
  }

  /** 运行时调用的路由：统一落到 hash，由 hashchange 统一驱动渲染 */
  function router(path, mode) {
    var p = String(path || "").replace(/^\//, "").split("?")[0];
    if (!p) return;
    var target = "#/" + p;
    if (location.hash === target) {
      // 同页重复跳转（例如已在该 tab 再点一次）：直接重挂，刷新数据
      window.__mountPage(p);
      return;
    }
    location.hash = target;
  }

  function syncTab(p) {
    var bar = document.getElementById("tabbar");
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

  function onHash() {
    var p = currentPath();
    try {
      window.__mountPage(p);
    } catch (e) {
      console.error("[web] 换页失败", p, e);
    }
    syncTab(p);
    window.scrollTo(0, 0);
  }

  function bootFail(msg, err) {
    var b = document.getElementById("boot");
    document.getElementById("bootMsg").innerHTML =
      '<span style="color:#e57373">' + msg + "</span>" +
      (err ? '<br/><span style="font-size:11px;color:#7d8798">' + String(err.message || err) + "</span>" : "");
    console.error("[web] 启动失败", msg, err);
  }

  function ready() {
    var box = document.getElementById("boot");
    if (box) box.classList.add("hide");
    setTimeout(function () { if (box) box.remove(); }, 420);
  }

  window.addEventListener("load", function () {
    var t0 = Date.now();
    try {
      // 1) 小程序 app.js —— 拿到 globalData / onLaunch（复用同一份，不另写）
      window.__require("__entry__", "./app.js");
      var cfg = window.__APP_CONFIG || { globalData: {} };

      // 2) 启动运行时（提供 wx / Page / 渲染）
      window.__bootWeb(cfg, router);

      // 3) tabBar 点击
      Array.prototype.forEach.call(document.querySelectorAll("#tabbar .tb"), function (el) {
        el.addEventListener("click", function () { router(el.dataset.p, "tab"); });
      });

      // 4) 路由监听
      window.addEventListener("hashchange", onHash);
      if (!location.hash) location.hash = "#/pages/index/index";
      else onHash();

      // 5) 等数据就绪再收起启动层（解压 1.8MB 需要一点时间）
      var T = window.__require("__entry__", "./utils/travel.js");
      var done = function () {
        setTimeout(function () {
          ready();
          // 数据回来后部分页面已渲染成空态，补刷一次
          if (window.__webCurrent && window.__webCurrent()) window.__webRefresh();
          console.log("[web] 就绪，" + (Date.now() - t0) + "ms");
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

  /* 调试入口：控制台可直接切页 */
  window.go = function (p) { router(p); };
})();
