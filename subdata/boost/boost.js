const { getAppSafe, SafePage } = require("../../utils/app.js");
// 行程增强页：聚合新功能（体检/问答/换景点/动线/高光/错峰/行李/成就/年报/点亮/交通/记账/照片/复制）
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    hasPlan: false,
    checkup: { score: 0, items: [], tips: [] },
    question: "",
    qAns: "",
    alts: [],
    altPage: 0,
    routeTips: [],
    highs: [],
    crowd: { txt: "暂无行程日期" },
    packStr: "",
    badges: [],
    yearTxt: "",
    liteTxt: "",
    cityA: "",
    cityB: "",
    trans: "",
    amt: "",
    photoN: 0
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
      this.setData({ checkup: { score: 0, items: [], tips: [] }, alts: [], routeTips: [], highs: [] });
      return;
    }
    const pk = plan.cityName || (plan.days[0] && plan.days[0].cityName) || "";
    const ck = T.planCheckup(plan);
    const hs = T.highlightOf(plan);
    const rt = T.routeAdvicePlus(plan).map(x => "D" + x.day + " " + x.from + " → " + x.to + " " + x.km + "km：" + x.tip);
    const firstDate = String(((plan.days && plan.days[0]) || {}).date || "").slice(0, 10);
    const cr = T.crowdTipOf(firstDate);
    const pkExtra = T.packExtra(plan);
    const alts = this._altsOf(plan, pk, this.data.altPage || 0);
    this.setData({
      checkup: ck,
      highs: hs.slice(0, 5),
      routeTips: rt.slice(0, 3),
      crowd: cr,
      packStr: pkExtra.join("、"),
      alts: alts.slice(0, 4),
      badges: T.badgesOf(),
      yearTxt: this._yearTxt(),
      liteTxt: this._liteTxt(),
      photoN: (S.get("boostPhotosV1", []) || []).length
    });
  },

  _altsOf(plan, cn, page) {
    try {
      const d0 = plan.days && plan.days[0] && plan.days[0].items;
      const first = (d0 || []).find(x => {
        const n = String(x.name || "");
        return n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|留白/.test(n);
      });
      // 每页 4 条，与卡片展示条数一致，避免批次间跳过候选
      return first ? T.swapSpotFor(plan, first.name, cn, page || 0, 4) : [];
    } catch (e) { return []; }
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

  refreshAlts() {
    const plan = app.globalData && app.globalData.plan;
    const toast = (t) => { try { wx.showToast({ title: t, icon: "none", duration: 1000 }); } catch (e) {} };
    if (!plan || !plan.days) { toast("先在首页生成行程"); return; }
    const pk = plan.cityName || (plan.days[0] && plan.days[0].cityName) || "";
    const next = (this.data.altPage || 0) + 1;
    let list = [];
    try { list = this._altsOf(plan, pk, next) || []; } catch (e) { list = []; }
    if (!list.length) { toast("暂无同类替代景点"); return; }
    const sig = list.map(x => x.name).join("|");
    const prev = (this.data.alts || []).map(x => x.name).join("|");
    if (sig === prev) {
      // 候选已轮完一圈：回到第一批，保证每次点击都有可见反馈
      const first = this._altsOf(plan, pk, 0) || [];
      this.setData({ altPage: 0, alts: first });
      toast("已看完，回到第一批");
      return;
    }
    this.setData({ altPage: next, alts: list });
    toast("第 " + (next + 1) + " 批");
  },

  onAInput(e) { this.setData({ cityA: e.detail.value }); },
  onBInput(e) { this.setData({ cityB: e.detail.value }); },
  calcTrans() {
    const r = T.transportEstimate(this.data.cityA.trim(), this.data.cityB.trim());
    this.setData({ trans: r ? (r.railText + "，" + r.price + "；" + r.hotel) : "暂未收录这对城市的出行数据" });
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

  pickPhoto() {
    try {
      wx.chooseMedia({
        count: 1, mediaType: ["image"],
        success: () => {
          const list = S.get("boostPhotosV1", []) || [];
          list.unshift(new Date().toISOString());
          if (list.length > 50) list.length = 50;
          S.set("boostPhotosV1", list);
          this.setData({ photoN: list.length });
          try { wx.showToast({ title: "已添加到行程相册", icon: "none" }); } catch (_) {}
        }
      });
    } catch (e) { try { wx.showToast({ title: "相册不可用", icon: "none" }); } catch (_) {} }
  },

  copyPlan() {
    const plan = app.globalData && app.globalData.plan;
    if (!plan) { try { wx.showToast({ title: "先生成行程", icon: "none" }); } catch (_) {} return; }
    try {
      const txt = T.copyPlanText(plan);
      wx.setClipboardData({ data: txt, success: () => { try { wx.showToast({ title: "已复制攻略", icon: "none" }); } catch (_) {} } });
    } catch (e) { try { wx.showToast({ title: "复制失败", icon: "none" }); } catch (_) {} }
  },

  onShareAppMessage() {
    return { title: "行程增强：体检、问答、一键换景点", path: "/pages/index/index" };
  }
}));
