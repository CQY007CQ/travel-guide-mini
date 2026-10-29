const { getAppSafe, SafePage } = require("../../utils/app.js");
// help：旅途应急（受伤 / 突发不适）—— 分诊常识 + 就近医疗机构
// 边界：只给「该挂什么科」与「就近有哪些医院」，不给诊疗结论、不评价医院优劣
const T = require("../../utils/travel.js");
const E = require("../../utils/emergency.js");
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
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() { this.__boot = T.ready().catch(() => null); },

  onShow() {
    try { this.setData({ fz: T.fontScale() }); } catch (e) {}
    this._theme();
    this._pickDefaultCity();
  },

  /* 默认城市：优先当前行程城市 → 首页最近选择 → 首个已收录城市 */
  _pickDefaultCity() {
    let c = "";
    try {
      const p = getApp().globalData.plan;
      if (p && p.city) c = p.city;
    } catch (e) {}
    if (!c) { try { c = wx.getStorageSync("lastCityName") || ""; } catch (e) {} }
    const list = E.cities();
    if (!c || !E.hasCity(c)) c = list[0] || "";
    this.setData({ city: c, hos: E.hospitalsOf(c) });
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

  onPickCity() {
    const list = E.cities();
    if (!list.length) return;
    wx.showActionSheet({
      itemList: list,
      success: (r) => {
        const c = list[r.tapIndex];
        this.setData({ city: c, hos: E.hospitalsOf(c) });
      },
    });
  },

  onShareAppMessage() {
    return { title: "旅途应急：受伤了该挂什么科、附近有哪些医院", path: "/pages/help/help" };
  },
}));
