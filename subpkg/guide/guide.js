const { getAppSafe, SafePage } = require("../../utils/app.js");
// guide：使用指南 —— 「速查条」形态
// 改版原因（问卷反馈）：原版 4 个 tab、14 张卡片、约 3900 字，用户反馈「字太多、看得费劲」，
// 首次弹窗引导也被直接跳过。改为：默认全部收起，只显示一行标题，点哪条展开哪条。
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一走存储封装（带类型守卫 + 会话缓存）
const app = getAppSafe();

// 一条只讲一件事：标题 ≤10 字，说明 ≤40 字，能直达的带 url
const TOPICS = [
  { t: "生成一份行程", d: "「出发」页选目的地与天数，点生成即可出逐日安排。", url: "/pages/index/index" },
  { t: "玩几天合适", d: "天数按目的地可玩量自动收敛；节奏、预算、人数在「高级设置」。", url: "/pages/index/index" },
  { t: "没想好去哪", d: "「出发」页点「换个目的地」，一次给 3 个随机目的地。", url: "/pages/index/index" },
  { t: "多城怎么串", d: "目的地可选整省精华，或 2–4 城串成一条线。", url: "/pages/index/index" },
  { t: "旅途中看什么", d: "「行程」页是当天安排，点景点直接导航；「今天」页给待办清单。", url: "/pages/plan/plan" },
  { t: "吃什么", d: "「美食」页点菜名，就能筛出做这道菜的店。", url: "/subpkg/food/food" },
  { t: "受伤不舒服", d: "「更多」→ 旅途应急：先拨 120，再看该挂什么科与附近医院。", url: "/pages/help/help" },
  { t: "花了多少钱", d: "「行程」页随手记账，「旅行账本」看分类统计。", url: "/subpkg/ledger/ledger" },
  { t: "数据存哪里", d: "全部存在本机，免注册、不上传；可在「更多」页导出备份。", url: "/pages/more/more" },
];

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "3 分钟学会用它生成专属旅行攻略", path: "/pages/index/index" };
  },

  data: {
    td: false,
    // v1.8.4 A9：阅读字号三档（1 标准 / 2 大 / 3 特大），随页面持久
    fz: 1,
    open: -1,          // 当前展开的条目；-1 = 全部收起
    topics: TOPICS
  },

  // v1.11：任何取值异常都不能拖垮整个指南页（静态文档页最不该白屏）
  onLoad() {
    this.__boot = T.ready().catch(() => null);
    try {
      const fz = Math.max(1, Math.min(3, Number(S.get("miniGuideFzV1", 1)) || 1));
      this.setData({ fz });
    } catch (e) { this.setData({ fz: 1 }); }
  },

  _theme() {
    try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {}
  },
  onShow() { this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._theme(); } catch (e) {} }); },

  // 点标题展开/收起（单开模式：避免一次展开很多条又变回长文档）
  onTopic(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    this.setData({ open: this.data.open === i ? -1 : i });
  },

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
}));
