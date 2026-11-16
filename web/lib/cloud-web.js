/* web/lib/cloud-web.js —— 网页版 CloudBase 适配器（由 index.html 以 <script> 静态引入）
 *
 * 职责：在网页版里把 @cloudbase/js-sdk（web/lib/cloudbase-sdk.js，由构建从 node_modules 拷贝）
 *       初始化并挂到 window.__cloudbase，使 utils/cloud.js 的 isWeb() 分支生效，从而网页版与
 *       小程序共用同一云环境 / 集合（plans 等），实现「小程序生成的行程，网页版能接着看」的互通。
 *
 * 设计（呼应高德 Key 泄露铁律与本地优先原则）：
 *   · 云环境 ID 来自 utils/keys.js 的 cloudEnv()（配置驱动，绝不写死进 git）。未填 → 完全不加载 SDK（fail-closed）。
 *   · SDK 仅在 cloudEnv 已配置时才动态注入，避免给所有用户白加载 1.4MB。
 *   · 匿名登录失败 / 任何异常都静默回落本地，绝不阻断网页版主流程。
 *   · 版本号从本脚本自身的 <script src> 上读取 ?v=，保证懒加载的 SDK 也破除缓存。
 */
(function () {
  "use strict";
  try {
    if (typeof window === "undefined") return;
    // 取云环境 ID（utils/keys.js 已随 modules.js 打包，直接用 CJS loader 取）
    var env = "";
    try {
      var KEYS = window.__require && window.__require("__entry__", "./utils/keys.js");
      if (KEYS && typeof KEYS.cloudEnv === "function") env = KEYS.cloudEnv() || "";
    } catch (e) { env = ""; }
    if (!env) return;  // fail-closed：未配置云环境，网页版不启用云能力（本地优先）

    // 从本脚本自身的 src 上取版本号，用于懒加载 SDK 的缓存破除
    var me = document.currentScript;
    var v = me && me.src ? (me.src.match(/[?&]v=([^&]+)/) || [])[1] : "";
    var sdkUrl = "lib/cloudbase-sdk.js" + (v ? "?v=" + v : "");

    function boot() {
      // SDK 用 esbuild 打成 CJS 互操作包装：window.tcb 上只有一个 { default, __esModule }，
      // 真正的工厂在 tcb.default.init；SDK 另外还会挂 window.cloudbase。
      // 曾只认 window.tcb.init → 该值为 undefined → 本函数第 32 行静默 return，
      // 于是 window.__cloudbase 永不挂载：网页版云同步、AI 强模型、识图上传全链路降级为离线，
      // 而且全程无报错（fail-closed 掩盖成"本地优先"），极难发现。三种形态任取其一。
      var cands = [window.tcb, window.tcb && window.tcb.default, window.cloudbase];
      var fac = null;
      for (var i = 0; i < cands.length; i++) {
        if (cands[i] && typeof cands[i].init === "function") { fac = cands[i]; break; }
      }
      if (!fac) return;   // SDK 确实没加载成功 → fail-closed
      try { globalThis.IS_MP_BUILD = false; } catch (e) {}  // 强制走 Web 适配器，避免被 wx 垫片误导
      var app;
      try { app = fac.init({ env: env, timeout: 8000 }); }
      catch (e) { return; }
      if (!app) return;
      var auth = (typeof app.auth === "function") ? app.auth() : null;
      if (auth && typeof auth.signInAnonymously === "function") {
        auth.signInAnonymously().then(function () {
          window.__cloudbase = app;   // 登录成功才挂上：此前 ready()=false，云操作 fail-closed，避免无效网络请求
        }).catch(function () {
          window.__cloudbase = null;  // 匿名登录失败 → 不挂，云能力整体降级（本地优先）
        });
      } else {
        // 极少数版本无匿名登录 API：仍挂上，由具体调用失败兜底回落
        window.__cloudbase = app;
      }
    }

    var s = document.createElement("script");
    s.src = sdkUrl;
    s.async = true;
    s.onload = boot;
    s.onerror = function () { window.__cloudbase = null; };   // 加载失败静默降级
    document.head.appendChild(s);
  } catch (e) { /* 任何异常都不应阻断网页版主流程 */ }
})();
