const { getAppSafe, SafePage } = require("../../utils/app.js");
// 行程增强页：聚合新功能（体检/问答/动线/高光/错峰/行李/成就/年报/点亮/记账）
const T = require("../../utils/travel.js");
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    hasPlan: false,
    checkup: { score: 0, items: [], tips: [] },
    question: "",
    qAns: "",
    routeTips: [],
    highs: [],
    crowd: { txt: "暂无行程日期" },
    packStr: "",
    badges: [],
    yearTxt: "",
    liteTxt: "",
    amt: ""
  },

  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    this.setData({ fz: T.fontScale() });
    (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) {} });
  },
  _renderShow() {
    try { const d = T.themeMode() === "dark"; this.setData({ td: d }); } catch (e) {}
    this.refresh();
  },

  refresh() {
    const plan = app.globalData && app.globalData.plan;
    this.setData({ hasPlan: !!(plan && plan.days && plan.days.length) });
    if (!plan || !plan.days) {
      this.setData({ checkup: { score: 0, items: [], tips: [] }, routeTips: [], highs: [] });
      return;
    }
    const ck = T.planCheckup(plan);
    const hs = T.highlightOf(plan);
    const rt = T.routeAdvicePlus(plan).map(x => "D" + x.day + " " + x.from + " → " + x.to + " " + x.km + "km：" + x.tip);
    const firstDate = String(((plan.days && plan.days[0]) || {}).date || "").slice(0, 10);
    const cr = T.crowdTipOf(firstDate);
    const pkExtra = T.packExtra(plan);
    this.setData({
      checkup: ck,
      highs: hs.slice(0, 5),
      routeTips: rt.slice(0, 3),
      crowd: cr,
      packStr: pkExtra.join("、"),
      badges: T.badgesOf(),
      yearTxt: this._yearTxt(),
      liteTxt: this._liteTxt()
    });
  },

  _yearTxt() {
    try {
      const y = T.yearReportNew(new Date().getFullYear());
      return y.cities + " 座城市 / " + y.days + " 天 / " + y.bills + " 笔 " + (y.total ? "¥" + y.total : "");
    } catch (e) { return "-"; }
  },

  _liteTxt() {
    try { const c = T.chinaLite(); return c.provs.length + " 省 / " + c.cities.length + " 城"; }
    catch (e) { return "-"; }
  },

  onQInput(e) { this.setData({ question: e.detail.value }); },
  askQ() {
    const plan = app.globalData && app.globalData.plan;
    if (!plan) { this.setData({ qAns: "先在首页生成一份行程" }); return; }
    const ans = T.askTrip(plan, this.data.question);
    this.setData({ qAns: ans ? ans.txt : "这个问题我还没学会，试试「第2天去哪 / 下雨怎么办 / 改成5天」" });
  },

  onAmtInput(e) { this.setData({ amt: e.detail.value }); },
  quickLedger(e) {
    const cat = e.currentTarget.dataset.cat || "其他";
    const amt = Number(this.data.amt);
    if (!(amt > 0)) { try { wx.showToast({ title: "先输入金额", icon: "none" }); } catch (_) {} return; }
    try {
      T.addLedger(amt, cat, cat + "支出", "我", amt, new Date().toISOString().slice(0, 10), app.globalData && app.globalData.plan);
      this.setData({ amt: "" });
      try { wx.showToast({ title: "已记一笔", icon: "none" }); } catch (_) {}
    } catch (e) { try { wx.showToast({ title: "记账失败", icon: "none" }); } catch (_) {} }
  },

  onShareAppMessage() {
    return { title: "行程增强：体检、问答、动线、高光", path: "/pages/index/index" };
  }
}));
