const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// help：旅途应急（受伤 / 突发不适）—— 分诊常识 + 就近医疗机构
// 边界：只给「该挂什么科」与「就近有哪些医院」，不给诊疗结论、不评价医院优劣
// v1.19.180：无具名医院的城市不再伪造机构名，改走「地图搜索」降级（宁缺勿错）
const T = require("../../utils/travel.js");
const E = require("../../utils/emergency.js");
const CP = require("../../utils/corpus.js");
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    text: "",
    quick: E.QUICK,
    res: [],
    city: "",
    hos: [],
    approx: false,      // 该城只有城中心坐标，无具名医院
    apLat: 0,
    apLon: 0,
    pickOpen: false,    // 城市选择弹层
    kw: "",
    cityList: [],
    cityAll: [],
    corpus: null,
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() { this.__boot = T.ready().catch(() => null); },

  onShow() {
    try { AN.pageView("help"); } catch (e) {}
    try { this.setData({ fz: T.fontScale() }); } catch (e) {}
    this._theme();
    try { this.setData({ corpus: CP.corpusStats() }); } catch (e) {}
    if (!this.data.city) this._pickDefaultCity();
  },

  /* 应用某城：同时给出具名医院 / 降级城中心两种形态 */
  _applyCity(c) {
    const ap = E.isApprox(c);
    const coord = ap ? E.approxCoord(c) : null;
    this.setData({
      city: c,
      hos: E.hospitalsOf(c),
      approx: ap,
      apLat: coord ? coord[0] : 0,
      apLon: coord ? coord[1] : 0,
    });
  },

  /* 默认城市：优先当前行程城市 → 首页最近选择 → 首个已收录具名医院的城市 */
  _pickDefaultCity() {
    let c = "";
    try {
      const p = getApp().globalData.plan;
      if (p && p.city) c = p.city;
    } catch (e) {}
    if (!c) { try { c = wx.getStorageSync("lastCityName") || ""; } catch (e) {} }
    const list = E.cities();
    if (!c || list.indexOf(c) < 0) {
      // 默认落到首个「有具名医院」的城市，避免一进来就是降级态
      c = list.filter((x) => !E.isApprox(x))[0] || list[0] || "";
    }
    this._applyCity(c);
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

  noop() {},

  onShareAppMessage() {
    return { title: "旅途应急：受伤了该挂什么科、附近有哪些医院", path: "/pages/help/help" };
  },
}));
