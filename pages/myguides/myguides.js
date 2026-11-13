const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
const T = require("../../utils/travel.js");
const EL = require("../../utils/errlog.js");      // v1.19.205：读取存档失败留痕，不再伪装成空列表
const app = getAppSafe();

// v1.19.179 「我的攻略」本地库：复用既有行程存档(miniPlansV1，上限 10 份，同 sig 自动覆盖)，
// 这里只做「库」的浏览/打开/删除 UI；保存动作在行程页「保存到我的攻略」按钮里调 T.savePlanSlot。
Page(SafePage({
  data: {
    fz: 1,
    td: false,
    list: [],
    empty: true,
    // v1.19.205：把「确实没有存档」和「读存档失败」分开。旧版 catch 一律 list:[] + empty:true，
    // 存储读不出来时页面显示「还没有收藏的攻略」——用户会以为存档丢了，真机极难定位。
    loadErr: false,
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  onLoad() { this._theme(); },
  onShow() {
    try { AN.pageView("myguides"); } catch (e) {}
    this._theme();
    this._load();
  },

  // 完整 plan 对象只留在内存(this._plans)避免塞进 setData 渲染树，列表只带展示字段
  _plans: {},
  _load() {
    try {
      const raw = T.listSavedPlans() || [];
      this._plans = {};
      const list = raw.map(x => {
        this._plans[x.id] = x;
        return { id: x.id, title: x.name, sub: x.sub || "", dateText: this._fmt(x.ts) };
      });
      this.setData({ list, empty: list.length === 0, loadErr: false });
    } catch (e) {
      try { EL.push("myguides._load", e); } catch (_) {}
      this.setData({ list: [], empty: true, loadErr: true });
    }
  },
  // 读取失败时给用户一个可重试入口（不必杀进程重进）
  reload() { this._load(); },
  _fmt(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  },

  // 打开：把存档回写 planV1 并注入 globalData，再进行程页（与「出发→生成」后的打开路径完全一致）。
  // 注意：plan 是 tabBar 页，必须用 switchTab（navigateTo 到 tab 页会被微信静默拒绝 → 点击无反应）。
  // 行程页靠 onShow 读 globalData.plan 渲染、「已存」状态由 T.findSavedPlanHit 比对存档库得出，无需 query 传参。
  openPlan(e) {
    const id = e.currentTarget.dataset.id;
    const item = this._plans && this._plans[id];
    if (!item || !item.plan) return;
    try {
      T.restorePlanSlot(id);
      app.setPlan(item.plan);
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (err) { wx.showToast({ title: "打开失败", icon: "none" }); }
  },
  delPlan(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: "删除攻略", content: "确定从「我的攻略」移除这份？",
      success: (r) => {
        if (r.confirm) {
          try { T.delPlanSlot(id); } catch (_) {}
          self._load();
          wx.showToast({ title: "已删除", icon: "none" });
        }
      }
    });
  },
  goGen() { try { wx.switchTab({ url: "/pages/index/index" }); } catch (_) {} },
}));
