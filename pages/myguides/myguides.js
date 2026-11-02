const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
const T = require("../../utils/travel.js");
const app = getAppSafe();

// v1.19.179 「我的攻略」本地库：复用既有行程存档(miniPlansV1，上限 10 份，同 sig 自动覆盖)，
// 这里只做「库」的浏览/打开/删除 UI；保存动作在行程页「保存到我的攻略」按钮里调 T.savePlanSlot。
Page(SafePage({
  data: {
    fz: 1,
    td: false,
    list: [],
    empty: true,
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
      this.setData({ list, empty: list.length === 0 });
    } catch (e) { this.setData({ list: [], empty: true }); }
  },
  _fmt(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  },

  // 打开：把存档回写 planV1 并注入 globalData，再进行程页（与「出发→生成」后的打开路径完全一致）
  openPlan(e) {
    const id = e.currentTarget.dataset.id;
    const item = this._plans && this._plans[id];
    if (!item || !item.plan) return;
    try {
      T.restorePlanSlot(id);
      app.setPlan(item.plan);
      wx.navigateTo({ url: "/pages/plan/plan?from=saved&id=" + encodeURIComponent(id) });
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
