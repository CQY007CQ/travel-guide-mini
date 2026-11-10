// 全局入口：行程存 storage，冷启动自动恢复（旅途中直接看到「今天」）
const store = require("./utils/store.js");
// v1.19.106：全局未捕获异常同步进本地错误日志，真机/审核环境也能回溯「无声失灵」
const EL = require("./utils/errlog.js");

// v1.19.40：统一导航出口防御 —— 全 app 的 navigateTo/switchTab/reLaunch 失败可见（带 toast）、
// 子页 navigateTo 加 loading 反馈、导航栈满等极端情况退回 redirectTo 仍尽量打开。
// 此前「首页快捷入口卡片点不动」「使用指南打不开」均因此类无回调的静默 navigateTo 报修，
// 逐个补回调治标不治本，故在此一处兜底，覆盖全部页面（含 allcheck 不扫描的 subpkg/）。
(function () {
  if (typeof wx === "undefined" || !wx) return; // Node 测试环境无 wx，直接跳过
  try {
    const TAB = ["/pages/index/index", "/pages/today/today", "/pages/plan/plan", "/pages/more/more"];
    const toast = (t) => { try { wx.showToast({ title: t, icon: "none" }); } catch (e) {} };
    const nt = wx.navigateTo && wx.navigateTo.bind(wx);
    if (nt) {
      wx.navigateTo = function (o) {
        o = o || {};
        const url = o.url;
        const userSuccess = typeof o.success === "function" ? o.success : null;
        o.success = function () { try { wx.hideLoading && wx.hideLoading(); } catch (e) {} if (userSuccess) { try { userSuccess.apply(this, arguments); } catch (e) {} } };
        o.fail = function (e) {
          try { wx.hideLoading && wx.hideLoading(); } catch (e2) {}
          // 导航栈满等极端情况：退回 redirectTo 仍尽量打开
          wx.redirectTo({ url: url, success: function () {}, fail: function () { toast("打开失败：" + ((e && e.errMsg) || "未知错误")); } });
        };
        try { wx.showLoading && wx.showLoading({ title: "打开中" }); } catch (e2) {}
        return nt(o);
      };
    }
    const st = wx.switchTab && wx.switchTab.bind(wx);
    if (st) {
      wx.switchTab = function (o) {
        o = o || {};
        if (typeof o.fail !== "function") o.fail = function (e) { toast("切换失败：" + ((e && e.errMsg) || "未知错误")); };
        return st(o);
      };
    }
    const rl = wx.reLaunch && wx.reLaunch.bind(wx);
    if (rl) {
      wx.reLaunch = function (o) {
        o = o || {};
        if (typeof o.fail !== "function") o.fail = function (e) { toast("打开失败：" + ((e && e.errMsg) || "未知错误")); };
        return rl(o);
      };
    }
  } catch (e) {}
})();

App({
  globalData: {
    plan: null,        // { days, cityName, totalDays, ... }
    from: null,        // { province, city }
    pendingAch: []     // v1.20.6：app.onShow 结算出的「新解锁成就」，待 more 页弹窗授予
  },
  onLaunch() {
    // 云开发接入（失败静默降级，绝不阻塞启动；未配置云环境 ID 时整体关闭，本地优先）
    try { require("./utils/cloud.js").init(); } catch (e) {}
    // v1.19.65：**启动阶段不再预加载分包数据**。数据包近 2.5MB，若在 appLaunch 期间就触发
    // 分包下载/解析，会拖垮启动（真机/审核环境实测 `routeTo appLaunch timeout` → 黑屏/白屏）。
    // 改为由首页 onLoad 触发（那时启动已完成），启动本身保持轻量。
    // v1.19.97：存储读取整体包 try/catch ——  corrupted storage 曾导致 onLaunch 抛错，
    // 极端真机/审核环境下可能表现为启动白屏；崩溃绝不该阻塞启动。
    try {
      const saved = store.get("planV1");
      if (saved && saved.days && saved.days.length) {
        // 只恢复「尚未结束」的行程；已结束的自动归档到「我的行程」，避免过期数据幽灵
        const last = String(saved.days[saved.days.length - 1].date || "").slice(0, 10);
        const today = store.fmtLocalDate(new Date());
        if (last && today <= last) this.globalData.plan = saved;
        else this._archiveOld(saved);
      }
    } catch (e) {
      try { if (typeof console !== "undefined" && console.warn) console.warn("[app] onLaunch storage 恢复失败（已跳过）:", e && e.message); } catch (_) {}
    }
  },
  // v1.20.6：每次进入前台都结算一次成就解锁，把「新解锁」暂存到 globalData.pendingAch 待 more 页弹窗授予；
  // 同时给一个轻量 toast 即时提示，避免只在成就页才感知到（隐藏成就「达成即授予」的核心体验）。
  onShow() {
    try {
      const T = require("./utils/travel.js");
      if (T && typeof T.syncAchievements === "function") {
        const r = T.syncAchievements();
        if (r && r.newly && r.newly.length) {
          if (!this.globalData.pendingAch) this.globalData.pendingAch = [];
          this.globalData.pendingAch = this.globalData.pendingAch.concat(r.newly);
          try {
            const msg = (r.newly.length > 1 ? ("解锁 " + r.newly.length + " 枚新成就") : ("解锁成就 · " + r.newly[0].t));
            if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: msg, icon: "none" });
          } catch (e2) {}
        }
      }
    } catch (e) {}
  },
  // C3（v1.9.1）：行程结束后首次冷启动 → 归档并清当前档；more「我的行程」可恢复回顾
  _archiveOld(p) {
    try {
      const T = require("./utils/travel.js");
      const nm = "往期 · " + (p.cityName || "行程") + " · " + p.days.length + " 天";
      if (T.savePlanSlot(p, nm)) store.del("planV1");
    } catch (e) { /* 归档失败不阻塞启动 */ }
  },
  setPlan(p) {
    // v1.15.3：目的地换了 → 重置「绑定本次行程」的准备项（订往返票/订酒店/过流程/请假…），
    // 避免上一程的「已订好」被带进新行程，看着像办妥了其实没有。同行程内的编辑不会触发。
    try {
      const prev = this.globalData.plan;
      const prevCity = prev && prev.cityName ? String(prev.cityName) : "";
      const nextCity = p && p.cityName ? String(p.cityName) : "";
      if (nextCity && prevCity && prevCity !== nextCity) {
        const T = require("./utils/travel.js");
        if (T && typeof T.resetTripPrep === "function") T.resetTripPrep();
      }
    } catch (e) {}
    this.globalData.plan = p; store.set("planV1", p);
  },
  clearPlan() { this.globalData.plan = null; store.del("planV1"); },
  // v1.19.60：全局异常捕获，避免无声白屏，便于真机/审核环境定位
  onError(err) {
    try { EL.push("app.onError", err); } catch (e2) {}
    try { if (typeof console !== "undefined" && console.warn) console.warn("[app] onError:", err && (err.message || err)); } catch (e) {}
  },
  // v1.19.60：未知页面兜底转回首页，避免「打不开」
  onPageNotFound(res) {
    try { wx.reLaunch({ url: "/pages/index/index" }); } catch (e) {}
  }
});
