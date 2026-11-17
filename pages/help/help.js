const { getAppSafe, SafePage } = require("../../utils/app.js");
const S = require("../../utils/store.js");   // v1.20.4 #81：统一存储出口
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// help：旅途应急（受伤 / 突发不适）—— 分诊常识 + 就近医疗机构
// 边界：只给「该挂什么科」与「就近有哪些医院」，不给诊疗结论、不评价医院优劣
// v1.19.180：无具名医院的城市不再伪造机构名，改走「地图搜索」降级（宁缺勿错）
const T = require("../../utils/travel.js");
const E = require("../../utils/emergency.js");
const GEO = require("../../utils/geo.js");   // haversineKm：按当天景点重排医院距离
const app = getAppSafe();
const AIAgent = require("../../utils/ai-agent.js");
const Cloud = require("../../utils/cloud.js");

Page(SafePage({
  data: {
    fz: 1,
    aiQ: "", aiAnswer: "", aiLoading: false, aiSource: "", aiErr: "",
    td: false,
    text: "",
    quick: E.QUICK,
    res: [],
    city: "",
    hos: [],
    approx: false,      // 该城只有城中心坐标，无具名医院
    apLat: 0,
    apLon: 0,
    tripHint: "",       // 行程自动定位说明：第 N 天 · 城市 · 附近景点
    nearSpot: "",       // 当前用于排序的当天景点名（空=按城中心）
    daySpots: [],       // 当天景点（有真实坐标的才列出，供「按景点就近」切换）
    pickOpen: false,    // 城市选择弹层
    kw: "",
    cityList: [],
    cityAll: [],
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() { this.__boot = T.ready().catch(() => null); },

  onShow() {
    try { AN.pageView("help"); } catch (e) {}
    try { this.setData({ fz: T.fontScale() }); } catch (e) {}
    this._theme();
    if (!this.data.city) this._pickDefaultCity();
  },

  // 行程当天：during=当天 / before=首日 / after=末日；多城游由 segCityOfDay 按天取城市
  _tripDay() {
    try {
      const p = app && app.globalData && app.globalData.plan;
      if (!p || !p.days || !p.days.length) return null;
      const st = T.todayState(p);
      const di = st && st.phase === "during" && st.idx != null ? st.idx
        : (st && st.phase === "after" ? p.days.length - 1 : 0);
      return { city: T.segCityOfDay(p, di) || p.cityName || p.city || "", dayNo: di + 1,
        spots: T.daySpots(p.days[di]) || [], phase: st ? st.phase : "before" };
    } catch (e) { return null; }
  },

  // 应用城市；spotName 有真实坐标则按它重排医院，否则按城中心（不谎称景点距离）
  _applyCity(c, spotName, dayNo, phase) {
    const ap = E.isApprox(c), coord = ap ? E.approxCoord(c) : null;
    let hos = E.hospitalsOf(c), near = spotName || "";
    const hint = () => dayNo ? "第 " + dayNo + " 天 · " + c +
      (near ? " · 附近：" + near : (phase === "after" ? " · 行程已结束" : "")) : "";
    if (near) {
      let sc = null; try { sc = T.P.getSpotCoord(c, near); } catch (e) {}
      if (sc && sc.lat && sc.lon && sc.approx === false) {
        hos = hos.map((h) => Object.assign({}, h, { kms: GEO.haversineKm(sc, h) })).sort((a, b) => a.kms - b.kms);
      } else { near = ""; }
    }
    this.setData({ city: c, approx: ap, apLat: coord ? coord[0] : 0, apLon: coord ? coord[1] : 0,
      nearSpot: near, tripHint: hint(), hos });
  },

  // 默认城市：行程当天城市 → 最近选择 → 首个有具名医院城。多城游自动按天切。
  _pickDefaultCity() {
    const td = this._tripDay();
    let c = td ? td.city : "";
    if (!c) { try { c = S.get("lastCityName", "") || ""; } catch (e) {} }
    const list = E.cities();
    if (!c || list.indexOf(c) < 0) c = list.filter((x) => !E.isApprox(x))[0] || list[0] || "";
    let spots = [];
    if (td && td.city === c) spots = td.spots.map((it) => {
      let sc = null; try { sc = T.P.getSpotCoord(c, it.name); } catch (e) {}
      return (sc && sc.lat && sc.lon && sc.approx === false) ? { name: it.name } : null;
    }).filter(Boolean);
    this.setData({ daySpots: spots });
    this._applyCity(c, "", td ? td.dayNo : 0, td ? td.phase : "");
  },

  onInput(e) { this.setData({ text: (e.detail && e.detail.value) || "" }); },

  onQuick(e) {
    const t = e.currentTarget.dataset.t || "";
    this.setData({ text: t, res: E.triage(t) });
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 260, duration: 200 });
  },

  onAsk() {
    const t = (this.data.text || "").trim();
    if (!t) { wx.showToast({ title: "先说说什么情况", icon: "none" }); return; }
    const r = E.triage(t);
    this.setData({ res: r });
    if (!r.length) wx.showToast({ title: "没识别到，换个说法试试", icon: "none" });
  },

  onCall120() {
    wx.showModal({
      title: "拨打 120",
      content: "急危重症请直接拨打 120，说清所在位置与伤情。需要现在拨号吗？",
      confirmText: "拨打",
      success: (r) => {
        if (!r.confirm) return;
        wx.makePhoneCall({ phoneNumber: "120", fail: () => wx.showToast({ title: "请手动拨打 120", icon: "none" }) });
      },
    });
  },

  // 通用紧急号码拨打（110 报警 / 119 火警 / 122 交通事故）
  onCallNum(e) {
    const num = (e.currentTarget.dataset.num || "").toString().trim();
    if (!num) return;
    wx.showModal({
      title: "拨打 " + num,
      content: "需要现在拨号吗？",
      confirmText: "拨打",
      success: (r) => {
        if (!r.confirm) return;
        wx.makePhoneCall({ phoneNumber: num, fail: () => wx.showToast({ title: "请手动拨打 " + num, icon: "none" }) });
      },
    });
  },

  onNav(e) {
    const i = Number(e.currentTarget.dataset.i);
    const h = (this.data.hos || [])[i];
    if (!h) return;
    wx.openLocation({
      latitude: h.lat,
      longitude: h.lon,
      name: h.n,
      address: this.data.city + " · " + h.lv,
      scale: 15,
      fail: () => wx.showToast({ title: "打开地图失败，请用地图 App 搜索", icon: "none" }),
    });
  },

  /* 降级路径：把城市中心交给系统地图，让用户在那里搜「医院」。
     不再伪造机构名 —— 给错名字比说「暂无收录」更危险。 */
  onMapSearch() {
    const city = this.data.city;
    if (!city || !this.data.apLat) {
      wx.showToast({ title: "请先选择城市", icon: "none" });
      return;
    }
    wx.openLocation({
      latitude: this.data.apLat,
      longitude: this.data.apLon,
      name: city + "（城中心）",
      address: "在地图中搜索「医院」或「急诊」，或直接拨打 120",
      scale: 13,
      fail: () => {
        try { wx.setClipboardData({ data: city + " 医院 急诊" }); } catch (_) {}
        wx.showToast({ title: "已复制搜索词，请在地图 App 搜索", icon: "none" });
      },
    });
  },

  /* 城市选择：451 个城市远超 showActionSheet 的 6 项上限，改用可搜索弹层 */
  onPickCity() {
    const all = E.cities();
    const apSet = {};
    for (const c of all) if (E.isApprox(c)) apSet[c] = 1;
    this.setData({ pickOpen: true, kw: "", cityAll: all, cityList: all.slice(0, 80), apSet });
    if (!all.length) wx.showToast({ title: "城市数据未就绪", icon: "none" });
  },

  onPickInput(e) {
    const kw = ((e.detail && e.detail.value) || "").trim();
    const all = this.data.cityAll || [];
    const list = kw ? all.filter((c) => c.indexOf(kw) >= 0) : all;
    this.setData({ kw, cityList: list.slice(0, 80) });
  },

  onPickTap(e) {
    const c = e.currentTarget.dataset.c || "";
    if (!c) return;
    this._applyCity(c);
    this.setData({ pickOpen: false, kw: "" });
  },

  onPickClose() { this.setData({ pickOpen: false, kw: "" }); },

  // 「按城中心 / 按当天某个景点」切换医院排序口径
  onNearSpot(e) {
    const name = String(e.currentTarget.dataset.name || "");
    const td = this._tripDay();
    this._applyCity(this.data.city, name, td ? td.dayNo : 0, td ? td.phase : "");
  },

  // 数据规模说明已迁到使用指南，这里给一处可见入口（急救页不再堆无关统计）
  goGuide() { try { wx.navigateTo({ url: "/subpkg/guide/guide" }); } catch (e) {} },

  noop() {},

  onShareAppMessage() {
    return { title: "旅途应急：受伤了该挂什么科、附近有哪些医院", path: "/pages/help/help" };
  },
  // ── AI 多轮问答（Agent 记忆 + 云端强模型优先 · 离线兜底） ──
  onAIInput(e) { this.setData({ aiQ: e.detail.value }); },
  _aiCtx() {
    let s = "";
    try { s = Cloud.aiContextOf(app.globalData && app.globalData.plan, "旅途应急页"); } catch (e) {}
    return s + "\n【场景护栏】本页只做旅途应急科普：不给诊疗结论、不评价医院优劣、不编造医院名称/药品剂量/电话号码；急症一律建议拨打 120 并就近就医。";
  },
  aiAsk() {
    if (this.data.aiLoading) return;
    const q = String(this.data.aiQ || "").trim();
    if (!q) { wx.showToast({ title: "先输入问题", icon: "none" }); return; }
    const self = this;
    if (!Cloud.cloudEnabled()) { self._aiOffline(q); return; }
    // v1.20.16：先落本地规则引擎答案，云端 12s 后升级（徽标 = aiPending && aiLoading，任一路径结束即消隐）
    self._aiOffline(q);
    self.setData({ aiLoading: true, aiPending: true, aiErr: "" });
    AIAgent.ask("help", q, self._aiCtx()).then((r) => {
      if (r && r.ok && r.text) self.setData({ aiAnswer: r.text, aiSource: r.source || "ai", aiLoading: false, aiPending: false });
      else self._aiOffline(q);
    }).catch(() => { self._aiOffline(q); });
  },
  _aiOffline(q) {
    let r;
    try { r = T.askAssistant(q, app.globalData && app.globalData.plan); } catch (e) { r = { text: "" }; }
    this.setData({ aiAnswer: (r && r.text) || "离线模式：急症请立即拨打 120 并就近就医；本地应急资料见上方。", aiSource: "", aiLoading: false, aiErr: "" });
  },
  aiClear() {
    try { AIAgent.clearHistory("help"); } catch (e) {}
    this.setData({ aiQ: "", aiAnswer: "", aiSource: "", aiErr: "" });
  },
  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
}));
