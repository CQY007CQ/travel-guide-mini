// prep：出行准备（票价/预约渠道 可勾跟踪 / 酒店比价 / 团队分工）
// 每个景点的「已订 / 预约日期 / 备注」按 城市·景点名 记本机，回来再看不丢
const T = require("../../../utils/travel.js");
const app = getApp();

const HOTEL_TIPS = [
  "携程 / 美团 / 飞猪 / 去哪儿四平台比价，同一酒店价差可达 10-30%",
  "周五周六及节假日价格最高，错峰或提前 1-2 周订更划算",
  "连住 2 晚以上常有「连住优惠」",
  "优先地铁站 500m 内的酒店，省下的交通费比房费差更值"
];

// 8 类分工，按出行人数 round-robin 分配
const DUTY_POOL = [
  "门票预约 / 攻略核对", "订酒店", "管钱记账 / AA 分摊", "拍照记录 / 行程提醒",
  "交通票务 / 值机选座", "查美食 / 排餐厅", "背包物资 / 充电宝", "证件 / 紧急联系人"
];

Page({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "出发前该带什么？行李清单 + 证件票据提醒", path: "/pages/index/index" };
  },

  data: {
    fz: 1,
    docList: [], docDone: 0, docPct: 0,
    td: false,
    hasPlan: false, cityName: "", isMulti: false,
    tickets: [], tkDone: 0, bookN: 0,
    hotelTips: HOTEL_TIPS, duties: [],
    sosList: [
      { tel: "110", label: "报警" },
      { tel: "120", label: "急救" },
      { tel: "119", label: "火警" },
      { tel: "122", label: "交通事故" },
      { tel: "12301", label: "旅游服务" },
      { tel: "12315", label: "消费投诉" }
    ]
  },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() {
    this._theme();
    // v1.10.1：refresh 内有多处对 plan/dict 的解引用，一旦脏数据抛错会整页白屏；
    // 这里兜底降级为空态并给出轻提示，保证页面始终可用。
    try {
      this.refresh();
    } catch (e) {
      this.setData({ hasPlan: false, tickets: [], duties: [] });
      wx.showToast({ title: "行前清单加载异常，已重置", icon: "none" });
    }
  },

  refresh() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) {
      this.setData({ hasPlan: false, tickets: [], duties: [] });
      return;
    }
    const dict = T.D.SPOT_TICKETS || {};
    const track = T.getTicketTrack();
    const isMulti = !!(plan.isMulti && plan.segments && plan.segments.length > 1);
    const segNameOf = d => (d.segName || (isMulti ? "" : plan.cityName) || "").trim();
    const seen = new Set();
    const tickets = [];
    (plan.days || []).forEach((d, di) => (d.items || []).forEach(it => {
      const n = String(it.name || "");
      if (T.isFrameName(n)) return;
      const cn = T.cleanSpotName(n) || n;
      if (seen.has(cn)) return;   // 同景点上午/下午拆分条目按清洗名去重
      seen.add(cn);
      let info = dict[n];
      if (!info) { for (const k in dict) { if (n.includes(k) && dict[k]) { info = dict[k]; break; } } }
      if (!info) { for (const k in dict) { if (cn.includes(k) && dict[k]) { info = dict[k]; break; } } }
      if (!info) return;
      // 多站行程：按当天归属城市记（原取 d.segName，逐日对象上没有该字段 → 全部落到整串城市名）
      const keyCity = T.segCityOfDay(plan, di) || plan.cityName;
      const t = track[T.tkKeyOf(keyCity, n)] || {};
      tickets.push({
        name: n, price: info.p || "—", book: !!info.book,
        where: (info.where && info.where !== "—") ? info.where : "",
        url: info.url || "",   // 官方预约/购票链接（有则显示「复制预约链接」）
        keyCity, seg: isMulti ? keyCity : "",
        done: !!t.done, date: t.date || "", dateTx: (t.date || "").slice(5), note: t.note || ""
      });
    }));

    // 门票总预估：逐条票价取首个数字 × 出行人数（票价可能是「¥80」「免费」「淡季80/旺季100」）
    const priceOf = v => { const m = String(v || "").match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const peopleN0 = Math.max(1, Math.min(10, (plan && plan.people) || 2));
    const tkSum = Math.round(tickets.reduce((a, t) => a + priceOf(t.price), 0) * peopleN0);

    // 团队分工：按 plan.people 铺开，每人分到不相邻的角色
    const peopleN = Math.max(1, Math.min(10, (plan && plan.people) || 2));
    const duties = [];
    for (let i = 0; i < peopleN; i++) {
      const list = [];
      for (let j = i; j < DUTY_POOL.length; j += peopleN) list.push(DUTY_POOL[j]);
      if (!list.length) list.push("机动支援");
      const who = i === 0 ? "我" : (peopleN === 2 ? "同行伙伴" : "同行人" + (i + 1));
      duties.push({ who, list });
    }

    const checks = T.getPrepChecks();
    this.setData({
      hasPlan: true, cityName: plan.cityName, isMulti,
      tickets, duties,
      tkDone: tickets.filter(x => x.done).length,
      bookN: tickets.filter(x => x.book).length,
      tkSum, peopleN: peopleN0,
      tkPct: tickets.length ? Math.round(tickets.filter(x => x.done).length / tickets.length * 100) : 0,
      // v1.5：智能行李清单
      pack: T.packSmart(plan), planDays: plan.days.length,
      // v1.7：证件与出行必备
      docList: T.docItems().map(x => Object.assign({}, x, { done: !!checks[x.k] })),
      docDone: T.docDone()
    });
    this._syncDocPct();
  },

  /* ---- 行李清单勾选（与 today 页共用 miniPrepV1 的 pg_ 前缀，两处同步） ---- */
  onPackTap(e) {
    const k = e.currentTarget.dataset.k;
    if (!k) return;
    T.togglePrepCheck(k);
    const pk = T.packSmart(app.globalData.plan);
    this.setData({ pack: pk });
  },

  // 勾选「已订 / 抢到票」
  onTkToggle(e) {
    const i = Number(e.currentTarget.dataset.i);
    const tk = this.data.tickets[i];
    if (!tk) return;
    const t = T.setTicketTrack(tk.keyCity, tk.name, { done: !tk.done });
    this._patch(i, { done: t.done });
    wx.showToast({ title: t.done ? "已订" : "已取消", icon: "none" });
  },

  // 预约 / 游玩日期
  onTkDate(e) {
    const i = Number(e.currentTarget.dataset.i);
    const tk = this.data.tickets[i];
    if (!tk) return;
    const v = e.detail.value;
    if (!v) return;
    T.setTicketTrack(tk.keyCity, tk.name, { date: v });
    this._patch(i, { date: v });
    wx.showToast({ title: "已记录日期", icon: "none" });
  },

  // 备注（输入失焦 / 完成时保存）
  onTkNote(e) {
    const i = Number(e.currentTarget.dataset.i);
    const tk = this.data.tickets[i];
    if (!tk) return;
    const v = String(e.detail.value || "").trim();
    T.setTicketTrack(tk.keyCity, tk.name, { note: v });
    this._patch(i, { note: v });
  },

  // v1.19.24：复制官方预约/购票链接（微信个人主体 web-view 受限，复制到浏览器打开最稳）
  onTkUrl(e) {
    const i = Number(e.currentTarget.dataset.i);
    const tk = this.data.tickets[i];
    if (!tk || !tk.url) return;
    wx.setClipboardData({
      data: tk.url,
      success: () => wx.showToast({ title: "链接已复制，到浏览器打开", icon: "none" })
    });
  },

  _patch(i, patch) {
    const tickets = this.data.tickets.slice();
    if (!tickets[i]) return;
    tickets[i] = Object.assign({}, tickets[i], patch);
    const doneN = tickets.filter(x => x.done).length;
    // tkPct 与 tkDone 必须同步重算（否则「已订进度条」勾选后不动）
    this.setData({ tickets, tkDone: doneN, tkPct: tickets.length ? Math.round(doneN / tickets.length * 100) : 0 });
  },

  goToday() { wx.switchTab({ url: "/pages/today/today" }); },

  /* ---- v1.7：证件与出行必备清单 ---- */
  // v1.12 UI 减法：文档进度条百分比预计算，避免 WXML 内除法表达式
  _syncDocPct() {
    const d = this.data;
    this.setData({ docPct: d.docList.length ? Math.round(d.docDone / d.docList.length * 100) : 0 });
  },
  onDocTap(e) {
    const k = e.currentTarget.dataset.k;
    if (!k) return;
    T.togglePrepCheck(k);
    const checks = T.getPrepChecks();
    const docList = (this.data.docList || []).map(x => Object.assign({}, x, { done: !!checks[x.k] }));
    this.setData({ docList: docList, docDone: docList.filter(x => x.done).length });
    this._syncDocPct();
  },

  /* ---- 应急电话直拨 ---- */
  onCall(e) {
    const tel = String(e.currentTarget.dataset.tel || "");
    if (!tel) return;
    wx.makePhoneCall({ phoneNumber: tel, fail: () => {} });
  }
});
