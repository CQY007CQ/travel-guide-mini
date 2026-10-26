const { getAppSafe, SafePage } = require("../../utils/app.js");
// guide：使用指南（首页「使用指南」胶囊进入）
// 覆盖：一分钟上手 / 全部功能地图 / 进阶技巧 / 常见问题；样式走 var(--xxx) 双主题
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一走存储封装（带类型守卫 + 会话缓存）
const TOOL_GROUPS = require("../../utils/toolkit-groups.js").ITEM_GROUPS;
const app = getAppSafe();

const TABS = ["一分钟上手", "功能地图", "进阶技巧", "常见问题"];

Page(SafePage(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "3 分钟学会用它生成专属旅行攻略", path: "/pages/index/index" };
  },

  data: {
    td: false,
    tab: 0,
    tabs: TABS,
    hasPlan: false,
    // v1.18：关键数字运行时化（避免每次扩城后手写文档又过期）
    cityCount: 0,
    toolCount: 0,
    // v1.8.4 A9：阅读字号三档（1 标准 / 2 大 / 3 特大），随页面持久
    fz: 1
  },

  // v1.11：任何取值异常都不能拖垮整个指南页（静态文档页最不该白屏）
  onLoad() {
    this.__boot = T.ready().catch(() => null);
    try {
      const fz = Math.max(1, Math.min(3, Number(S.get("miniGuideFzV1", 1)) || 1));
      const plan = app.globalData && app.globalData.plan;
      const cityCount = (T.D && T.D.CITIES && T.D.CITIES.length) || 0;
      let toolCount = 0;
      if (Array.isArray(TOOL_GROUPS)) toolCount = TOOL_GROUPS.reduce((s, g) => s + (g.items ? g.items.length : 0), 0);
      this.setData({ hasPlan: !!(plan && plan.days && plan.days.length), fz: fz, cityCount, toolCount });
    } catch (e) { this.setData({ hasPlan: false, fz: 1, cityCount: 0, toolCount: 0 }); }
  },

  _theme() {
    try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {}
  },
  onShow() { this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) {} }); },
  _renderShow() { this._theme(); },

  // 顶部分段：上手 / 功能 / 技巧 / 常见问题
  onTab(e) { this.setData({ tab: Number(e.currentTarget.dataset.t) || 0 }); },

  // 全局字号：与「更多」页共用同一份设置（miniFontScaleV1），改完所有页即时生效
  _setFz(v) {
    const fz = T.setFontScale(v);
    this.setData({ fz });
  },
  fzMinus() { this._setFz(this.data.fz - 1); },
  fzPlus() { this._setFz(this.data.fz + 1); },

  // 指南内直达入口：tab 页用 switchTab，子页 navigateTo（从 guide 返回仍回首页）
  // v1.19.39：导航失败给出可见提示；子页 navigateTo 栈满退回 redirectTo
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const isTab = ["/pages/plan/plan", "/pages/today/today", "/pages/more/more", "/pages/index/index"].indexOf(url) >= 0;
    if (isTab) {
      wx.switchTab({
        url,
        fail: (err) => wx.showToast({ title: "切换失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" })
      });
    } else {
      wx.showLoading({ title: "打开中" });
      wx.navigateTo({
        url,
        success: () => wx.hideLoading(),
        fail: (err) => {
          wx.redirectTo({
            url,
            success: () => wx.hideLoading(),
            fail: () => { wx.hideLoading(); wx.showToast({ title: "打开失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" }); }
          });
        }
      });
    }
  }
})));