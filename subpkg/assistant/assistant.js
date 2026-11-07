const { getAppSafe, SafePage } = require("../../utils/app.js");
// assistant：本地攻略速查（离线 · 本地规则库 · 零网络）
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");
const EL = require("../../utils/errlog.js");   // v1.19.205：候选/收藏读取失败留痕，不再静默清空
const app = getAppSafe();

// 保留旧 key 名（兼容老用户数据，不影响审核）
const KEEP_KEY = "miniAIKeepV1";
const KEEP_MAX = 20;

const TILES = [
  { k: "weather", t: "天气穿衣", q: "天气穿衣", ic: "sun.png" },
  { k: "food", t: "必吃美食", q: "必吃美食", ic: "food.png" },
  { k: "ticket", t: "门票预约", q: "门票预约", ic: "ticket.png" },
  { k: "spot", t: "查景点", q: "查景点", ic: "search.png" },
  { k: "stay", t: "住宿建议", q: "住哪方便", ic: "home.png" },
  { k: "budget", t: "预算明细", q: "预算多少", ic: "coin.png" },
  { k: "traffic", t: "怎么去", q: "怎么去", ic: "bus.png" },
  { k: "warn", t: "避坑提醒", q: "有什么要注意", ic: "shield.png" },
  { k: "today", t: "今天安排", q: "今天干什么", ic: "calendar.png" }
];

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "旅行小助手：天气、预算、避坑提示随手查", path: "/pages/index/index" };
  },

  data: {
    fz: 1,
    td: false,
    hasPlan: false, ctx: "",
    tiles: TILES,
    mode: "",           // "" 普通查询 / "spot" 查景点
    lastQuery: "", lastResult: "", lastTileK: "",
    spotResult: null,   // 查景点结果
    planSpots: [],      // 查景点模式：当前行程里的景点（一键查）
    keepN: 0, keepsOpen: false, keeps: [],
    input: ""
  },

  // 取当前行程里去重后的真实景点名（查景点模式的一键入口）
  _computePlanSpots() {
    try {
      const plan = app.globalData && app.globalData.plan;
      if (!plan || !Array.isArray(plan.days)) { this.setData({ planSpots: [] }); return; }
      const seen = new Set(), out = [];
      for (const d of plan.days) {
        if (!d || !Array.isArray(d.items)) continue;
        for (const it of d.items) {
          const n = (it && (it.name || it.disp)) || "";
          if (!n || T.isFrameName(n)) continue;
          const key = T.cleanSpotName(n) || n;
          if (seen.has(key)) continue;
          seen.add(key); out.push(n);
          if (out.length >= 30) break;
        }
        if (out.length >= 30) break;
      }
      this.setData({ planSpots: out });
    } catch (e) { try { EL.push("assistant.planSpots", e); } catch (_) {} this.setData({ planSpots: [] }); }
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); if (this.data.mode === "spot") this._computePlanSpots(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() {
    try { this._theme(); this.refresh(); }
    catch (e) { try { wx.showToast({ title: "页面刷新异常", icon: "none" }); } catch (_) {} }
  },

  refresh() {
    const plan = app.globalData.plan;
    const hasPlan = !!(plan && plan.days && plan.days.length);
    const city = hasPlan ? T.activeCityOf(plan) : "";
    const people = hasPlan && plan.people ? plan.people : 0;
    const pace = hasPlan && plan.pace ? ({ leisure: "轻松", balance: "平衡", speed: "特种兵" })[plan.pace] || "" : "";
    const ctx = hasPlan
      ? ("正在查：" + plan.cityName + (city && plan.cityName !== city ? "（当前：" + city + "）" : "") +
         (people ? " · " + people + " 人" : "") + (pace ? " · " + pace + "节奏" : "") + " · 离线可用")
      : "先生成一份行程，下面卡片就能直接查";
    this.setData({ hasPlan, ctx });
    this._syncKeeps();
  },

  _syncKeeps() {
    try {
      const k = S.getArr(KEEP_KEY);
      this.setData({ keepN: (k && k.length) || 0, keeps: (k || []).slice(-KEEP_MAX).reverse() });
    } catch (e) { try { EL.push("assistant.syncKeeps", e); } catch (_) {} this.setData({ keepN: 0, keeps: [] }); }
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  onTile(e) {
    const k = e.currentTarget.dataset.k;
    const t = TILES.find(x => x.k === k);
    if (!t) return;
    if (k === "spot") { this.setData({ mode: "spot", input: "", lastResult: "", spotResult: null }); this._computePlanSpots(); return; }
    this.setData({ mode: "", spotResult: null, planSpots: [] });
    this._runQuery(t.q, k);
  },

  exitSpot() { this.setData({ mode: "", spotResult: null, input: "", planSpots: [] }); },

  // 查景点模式：点行程里的景点名，直接查详情
  tapPlanSpot(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    this._spotSearch(name);
  },

  search() {
    const q = (this.data.input || "").trim();
    if (!q) { wx.showToast({ title: "先输入关键词", icon: "none" }); return; }
    if (this.data.mode === "spot") { this._spotSearch(q); return; }
    this._runQuery(q, "");
  },

  _spotSearch(q) {
    let city = "";
    try { const plan = app.globalData && app.globalData.plan; if (plan) city = T.activeCityOf(plan) || plan.cityName || ""; } catch (e) {}
    let r;
    try { r = T.spotLookup(q, city); }
    catch (e) { r = { found: false }; }
    this.setData({ spotResult: r, input: "" });
    if (!r.found) wx.showToast({ title: "没查到这个景点，换个名字试试", icon: "none" });
  },

  _runQuery(q, tileK) {
    const plan = app.globalData.plan;
    let r;
    try { r = T.askAssistant(q, plan); }
    catch (e) { r = { text: "查询出错了，换个关键词试试", tag: "info" }; }
    this._lastResult = r.text;
    this.setData({
      lastQuery: q, lastResult: r.text, lastTileK: tileK,
      input: ""
    });
  },

  // 收藏最近一次结果（本地）
  keepLast() {
    const t = this._lastResult;
    if (!t) return;
    try {
      const k = S.getArr(KEEP_KEY);
      k.push(t);
      const full = k.length > KEEP_MAX;
      S.set(KEEP_KEY, k.slice(-KEEP_MAX));
      this._syncKeeps();
      this.setData({ keepsOpen: true });
      wx.showToast({ title: full ? "已收藏 · 替换最早一条" : "已收藏", icon: "none" });
    } catch (e) { wx.showToast({ title: "收藏失败", icon: "none" }); }
  },

  toggleKeeps() { this.setData({ keepsOpen: !this.data.keepsOpen }); },

  clearKeeps() {
    wx.showModal({
      title: "清空收藏？",
      success: (res) => {
        if (!res.confirm) return;
        S.set(KEEP_KEY, []);
        this._syncKeeps();
        this.setData({ keepsOpen: false });
      }
    });
  },

  goIndex() { wx.switchTab({ url: "/pages/index/index" }); }
}));
