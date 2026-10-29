const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// today：「今天」行程态卡片（行前待办 / 途中速览+快捷记账 / 结束回顾）
const T = require("../../utils/travel.js");
const app = getAppSafe();

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    // 2026-10-29：「今日正当时」已下线，分享文案回到通用版本
    return { title: "旅行途中神器：今日安排 + 待办清单 + 随手记账（离线可用）", path: "/pages/index/index" };
  },

  data: {
    fz: 1,
    td: false,
    state: null,          // phase 判定结果
    view: {},             // 渲染数据
    hasPlan: false,
    amt: "",
    cat: "餐饮",
    cats: ["餐饮", "门票", "交通", "住宿", "购物", "其他"],
    // v1.15.3：移除「今天累但很开心 / 风景绝了 / 吃到地道小吃…」这类心情感叹速写短语（用户不需要，手记直接自己写）
    // v1.8.5 C9：每日一句（无行程时陪伴文案）
    quote: null
  },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：主题或刷新任一环节抛错都不该白屏
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    try { AN.pageView("today"); } catch (e) {}
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() { try { this._theme(); this.refresh(); } catch (e) { try { wx.showToast({ title: "页面刷新异常", icon: "none" }); } catch (_) {} } },

  refresh() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) {
      // v1.8.5 C9：无行程时给一句旅行小话（按日期轮换，本地文案）
      const q = T.quoteOfDay();
      this.setData({ hasPlan: false, state: null, view: {}, quote: q });
      return;
    }
    const st = T.todayState(plan);
    if (!st) { this.setData({ hasPlan: false }); return; }
    // 多站行程显示「今天所在站」，而不是整串「北京 → 西安」
    const cityName = T.activeCityOf(plan) || plan.cityName;
    const out = { cityName, phase: st.phase, hasPlan: true };
    // v1.8.4 A2：穿衣指数卡（按行程对应月份的当地气候给参考，而非「现在」的月份）
    try {
      const cityObj = T.findCity(cityName);
      const d0 = plan.days && plan.days.length
        ? String(((plan.days[st.phase === "during" && st.idx != null ? st.idx : 0] || plan.days[0]).date || "")).slice(0, 10)
        : "";
      out.dress = T.dressForMonth(cityObj, d0);
    } catch (e) {}

    if (st.phase === "before") {
      const ph = T.prepPhaseList(st.daysLeft);
      const checks = T.getPrepChecks();
      out.daysLeft = st.daysLeft;
      out.prepTitle = ph.title;
      out.prepItems = ph.items.map(([k, t]) => ({ k, t, done: !!checks[k] }));
      out.prepDone = out.prepItems.filter(i => i.done).length;
      // v1.5 智能行李清单：按天数 / 出发季节 / 目的地气候 / 行程特色（山海古镇）生成
      const pk = T.packSmart(plan);
      out.packGroups = pk.groups;
      out.packDone = pk.done;
      out.packTotal = pk.total;
      out.packPct = pk.pct;
      out.packSeason = pk.season;
      out.days = plan.days.length;
      // v1.9：目的地气候补充提醒（高原防晒 / 热带驱蚊…）
      try {
        const co = T.findCity(cityName);
        out.cliAdd = co ? T.climateAddOns(co.climate) : [];
      } catch (e) { out.cliAdd = []; }
      // 行前预告：本次行程已把几个想玩排进去了（对齐网页版 ★ 想玩高亮；合并条目/别名也命中）
      const wishPlanNames = [];
      const seenW = new Set();
      (plan.days || []).forEach(d => (d.items || []).forEach(it => {
        if (!T.isFrameName(it.name) && T.wishHit(it.name)) {
          const c = T.cleanSpotName(it.name);
          if (c && !seenW.has(c)) { seenW.add(c); wishPlanNames.push(c); }
        }
      }));
      if (wishPlanNames.length) out.wishHitTxt = wishPlanNames.slice(0, 4).join("、");
    } else if (st.phase === "during") {
      const day = plan.days[st.idx];
      const act = T.nextActivity(day);
      const now = act.now, nx = act.next;
      const fmtIt = it => ({ name: T.showDisp(it.name, cityName), clean: T.cleanSpotName(it.name), period: it.period, time: it.time || "" });
      out.dayNo = st.dayNo; out.total = st.total; out.theme = day.theme || "";
      out.today = T.fmtLocalDate(new Date());
      out.now = now ? fmtIt(now) : null;
      out.next = nx ? fmtIt(nx) : null;
      out.left = act.left;
      // 进行中 / 即将开始：now 的时段序等于当前时段 → 正在玩；大于当前时段 → 还没开始
      const cur = T.currentPeriodOrder();
      const ord = p => (T.D.PERIOD_ORDER && T.D.PERIOD_ORDER[p] != null ? T.D.PERIOD_ORDER[p] : 99);
      out.nowTag = now ? (ord(now.period) <= cur ? "正在玩" : "接下来") : "";
      out.spent = Math.round(T.todaySpent());
      const bAmt = plan.customAmt > 0 ? "自定义 ¥" + plan.customAmt : "¥" + T.budgetDaily(plan.budget);
      out.budgetTxt = (plan.people > 1 ? plan.people + " 人 · " : "") + "预算参考 " + bAmt + "/人·天";
      out.gauge = T.budgetGauge(plan);  // 总预算进度条（账本实际花费 vs 总预算参考）
      // 想玩命中今天：金色提示（对齐网页版 ★ 想玩高亮；合并条目/别名也命中，去重）
      const hitToday = [...new Set(
        (day.items || [])
          .filter(it => !T.isFrameName(it.name) && T.wishHit(it.name))
          .map(it => T.cleanSpotName(it.name))
          .filter(Boolean)
      )];
      if (hitToday.length) out.wishHitTxt = hitToday.slice(0, 4).join("、");
      // v1.9：超支轻提醒 / 今日装备 / 明日预告
      try { out.gear = T.todayGear(plan); } catch (e) { out.gear = []; }
      try { const oh = T.todayOverHint(plan); if (oh) out.overHint = oh; } catch (e) {}
      try {
       const pk2 = T.tomorrowPeek(plan);
       if (pk2) out.peek = Object.assign(pk2, { spotsText: (pk2.spots || []).join(" → ") });
      } catch (e) {}
    } else {
      out.daysSince = st.daysSince;
      let spots = 0;
      try { spots = T.P.countPlanStats(plan.days).spots; } catch (e) {}
      out.spots = spots;
      out.totalMoney = Math.round(T.totalSpent());
    }
    this.setData({ hasPlan: true, state: st.phase, view: out });
  },

  onPrepTap(e) {
    const k = e.currentTarget.dataset.k;
    T.togglePrepCheck(k);
    this.refresh();
  },

  onCatPick(e) { this.setData({ cat: e.currentTarget.dataset.c }); },
  onAmtInput(e) {
    const v = e.detail.value;
    this.setData({ amt: v, quickParsed: T.parseQuickBill(v) });
  },

  // v1.5：一句话记账（「打车 32」→ 自动识别金额 + 分类；只输数字则按当前分类）
  quickLedger() {
    const raw = String(this.data.amt || "").trim();
    let amt = 0, name = "", cat = this.data.cat;
    const p = T.parseQuickBill(raw);
    if (p) { amt = p.amt; name = p.name; cat = p.cat; }
    else { amt = parseFloat(raw); name = ""; }
    if (!(amt > 0)) { wx.showToast({ title: "带上金额，如：打车 32", icon: "none" }); return; }
    T.addLedger(amt, cat, name);
    this.setData({ amt: "", quickParsed: null });
    wx.showToast({ title: "已记 ¥" + amt + " · " + cat, icon: "none" });
    this.refresh();
  },

  goPlan() { wx.switchTab({ url: "/pages/plan/plan" }); },
  goIndex() { wx.reLaunch({ url: "/pages/index/index" }); },

  // v1.8.5 C10：行程结束后的回顾入口
  goMore() { wx.switchTab({ url: "/pages/more/more" }); },

  /* ---- 今日手记（每天一句，存本机 miniNotesV1） ---- */
  onNoteInput(e) { this.setData({ noteInput: e.detail.value }); },
  onNoteSave() {
    const txt = String(this.data.noteInput || "").trim();
    if (!txt) { wx.showToast({ title: "先写点什么吧", icon: "none" }); return; }
    const today = T.fmtLocalDate(new Date());
    T.addNote(today, txt);
    this.setData({ noteSaved: txt, noteInput: "" });
    wx.showToast({ title: "已记下", icon: "success" });
  }
}));
