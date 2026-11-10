const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// assistant：本地攻略速查（离线 · 本地规则库 · 零网络）
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");
const EL = require("../../utils/errlog.js");   // v1.19.205：候选/收藏读取失败留痕，不再静默清空
const AI = require("../../utils/ai-intent.js"); // 对齐网页版 AI 的增强意图（出片/周边/城市名片/单景点详情/跳页/云同步）
const Cloud = require("../../utils/cloud.js");        // 云互通基座（含跨端同步码）
const CloudSync = require("../../utils/cloud-sync.js"); // 行程上云 / 拉回
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
    actions: [],        // 增强意图附带的「直达对应页」按钮
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
  onShow() { onShowRender(this, "assistant", null, () => { if (this.data.mode === "spot") this._computePlanSpots(); }); },
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
    if (k === "spot") { this.setData({ mode: "spot", input: "", lastResult: "", spotResult: null, actions: [] }); this._computePlanSpots(); return; }
    this.setData({ mode: "", spotResult: null, planSpots: [], actions: [] });
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
    this.setData({ spotResult: r, input: "", actions: [] });
    if (!r.found) wx.showToast({ title: "没查到这个景点，换个名字试试", icon: "none" });
  },

  _runQuery(q, tileK) {
    const plan = app.globalData.plan;
    const city = (plan && T.activeCityOf(plan)) || (plan && plan.cityName) || "";
    // 先走增强意图（出片/周边/城市名片/单景点详情/显式导航），不命中回落本地规则引擎（零回归）
    let ai = null;
    try { ai = AI.handle(q, { city: city, plan: plan }); }
    catch (e) { try { EL.push("assistant.ai", e); } catch (_) {} }
    if (ai) {
      if (ai.jump) this._nav(ai.jump);   // 显式导航：直接切页
      this._lastResult = ai.text;
      this.setData({ lastQuery: q, lastResult: ai.text, lastTileK: tileK, input: "", actions: ai.actions || [] });
      return;
    }
    let r;
    try { r = T.askAssistant(q, plan); }
    catch (e) { r = { text: "查询出错了，换个关键词试试", tag: "info" }; }
    this._lastResult = r.text;
    this.setData({
      lastQuery: q, lastResult: r.text, lastTileK: tileK,
      input: "", actions: []
    });
  },

  // 跳转到目标页（action / jump 共用）。tab 用 switchTab，其余 navigateTo；query 拼成 URL 参数。
  _nav(t) {
    if (!t) return;
    const q = t.query || {};
    const qs = Object.keys(q).length
      ? "?" + Object.keys(q).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(q[k])).join("&")
      : "";
    try {
      if (t.mode === "tab") wx.switchTab({ url: t.path });
      else wx.navigateTo({ url: t.path + qs });
    } catch (e) {}
  },

  // 点击「直达对应页」按钮。普通 action 走 _nav；云同步类的特殊 mode 走本地处理。
  onAction(e) {
    const d = e.currentTarget.dataset;
    const mode = d.mode || "push";
    if (mode === "copySync") { this._copySync(); return; }
    if (mode === "inputSync") { this._inputSync(); return; }
    if (mode === "pushPlan") { this._pushPlan(); return; }
    if (mode === "pullPlan") { this._pullPlan(); return; }
    this._nav({ path: d.path, query: d.query || {}, mode: mode });
  },

  // 当前用于跨端关联的 uid：已配对则用配对码，否则用本机匿名 uid
  _syncCode() {
    const paired = Cloud.getPairedUid();
    return paired || Cloud.localUid();
  },
  _copySync() {
    const code = this._syncCode();
    try {
      wx.setClipboardData({
        data: code,
        success: () => wx.showToast({ title: "同步码已复制，去另一端粘贴", icon: "none" }),
        fail: () => wx.showToast({ title: "复制失败", icon: "none" })
      });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
  _inputSync() {
    wx.showModal({
      title: "输入同步码",
      editable: true,
      placeholderText: "粘贴另一端复制的同步码（u_ 开头）",
      success: (res) => {
        if (!res.confirm) return;
        if (Cloud.setPairedUid(res.content)) {
          wx.showToast({ title: "已关联，可跨端同步", icon: "none" });
        } else {
          wx.showToast({ title: "同步码无效", icon: "none" });
        }
      }
    });
  },
  _pushPlan() {
    if (!Cloud.cloudEnabled()) { wx.showToast({ title: "云未开启", icon: "none" }); return; }
    const plan = app.globalData && app.globalData.plan;
    wx.showLoading({ title: "上传中", mask: true });
    CloudSync.pushPlan(plan).then((r) => {
      wx.hideLoading();
      if (r && r.ok) wx.showToast({ title: "已上传到云端", icon: "none" });
      else wx.showToast({ title: "上传失败：" + ((r && r.reason) || "云未开启"), icon: "none" });
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: "上传异常", icon: "none" }); });
  },
  _pullPlan() {
    if (!Cloud.cloudEnabled()) { wx.showToast({ title: "云未开启", icon: "none" }); return; }
    wx.showLoading({ title: "恢复中", mask: true });
    CloudSync.pullLatest().then((r) => {
      wx.hideLoading();
      if (r && r.ok && r.plan) {
        try { app.globalData.plan = r.plan; if (app.setPlan) app.setPlan(r.plan); } catch (e) {}
        this.refresh();
        wx.showToast({ title: "已从云端恢复", icon: "none" });
      } else {
        wx.showToast({ title: "恢复失败：" + ((r && r.reason) || "云未开启"), icon: "none" });
      }
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: "恢复异常", icon: "none" }); });
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
