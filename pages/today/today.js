const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// today：「今天」行程态卡片（行前待办 / 途中速览+快捷记账 / 结束回顾）
const T = require("../../utils/travel.js");
const Cloud = require("../../utils/cloud.js");   // 云端 AI（llmProxy 强模型网关，fail-closed）
const AIAgent = require("../../utils/ai-agent.js");

// 主动建议缓存：15 分钟内同行程不重复打云端（避免 onShow 频繁触发）
let _proactiveCache = { key: "", ts: 0, tip: "" };
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
    quote: null,
    // AI 今日建议（云端强模型优先 · 离线规则库兜底）
    aiText: "", aiSource: "", aiLoading: false, aiErr: "",
    proactiveTip: "", proactiveLoading: false, proactiveOffline: false
  },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：主题或刷新任一环节抛错都不该白屏
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() { onShowRender(this, "today"); this._loadProactive(); },
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
        // 2026-10-29：与主清单去重（墨镜 / 防晒 / 雨具 / 饮用水 等两边都会出现）
        // 第三参：穿衣卡文本也参与去重（润唇膏 / 保湿霜 在主清单与穿衣卡里都可能出现）
        const _dressTxt = out.dress
          ? [].concat(out.dress.lines || [], [out.dress.weather || ""]).join(" ")
          : "";
        out.cliAdd = co ? T.climateAddOnsFiltered(co.climate, out.packGroups, _dressTxt) : [];
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
      // v1.20.7：今天页补「动线 / 步行量」——与行程页共用 T.dayMove（真实坐标 + 强度估计），
      // 不另造口径、不伪造坐标；无精确坐标时 legs=0，只给步行强度估计。
      try {
        const mv = T.dayMove(day, cityName);
        if (mv) out.walk = {
          km: mv.km, steps: mv.steps, legs: mv.legs,
          txt: (mv.legs > 0 ? "动线约 " + mv.km + " km · " : "") + "预计步行 " + mv.steps + " 步"
        };
      } catch (e) { out.walk = null; }
      // 进行中 / 即将开始：now 的时段序等于当前时段 → 正在玩；大于当前时段 → 还没开始
      const cur = T.currentPeriodOrder();
      const ord = p => (T.D.PERIOD_ORDER && T.D.PERIOD_ORDER[p] != null ? T.D.PERIOD_ORDER[p] : 99);
      out.nowTag = now ? (ord(now.period) <= cur ? "正在玩" : "接下来") : "";
      out.spent = Math.round(T.todaySpent());
      const bAmt = plan.customAmt > 0 ? "自定义 ¥" + plan.customAmt : "¥" + T.budgetDaily(plan.budget);
      out.budgetTxt = (plan.people > 1 ? plan.people + " 人 · " : "") + "预算 " + bAmt + "/人·天";
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

  // ── AI 今日建议（云端强模型优先 · 离线兜底 · 零白屏） ──
  askTodayAI() {
    if (this.data.aiLoading) return;
    const self = this;
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程", icon: "none" }); return; }
    const v = this.data.view || {};
    const detail = [];
    if (this.data.state === "before") {
      detail.push("阶段：行前，距出发 " + (v.daysLeft != null ? v.daysLeft : "?") + " 天。");
      if (v.prepItems && v.prepItems.length) detail.push("行前待办完成 " + (v.prepDone || 0) + "/" + v.prepItems.length + "。");
      if (v.packTotal) detail.push("行李清单已勾选 " + (v.packDone || 0) + "/" + v.packTotal + " 项。");
    } else if (this.data.state === "during") {
      detail.push("阶段：行程中，第 " + (v.dayNo || "?") + "/" + (v.total || "?") + " 天。");
      if (v.now) detail.push("当前：" + v.now.name + "（" + (v.now.time || v.now.period || "") + "）。");
      if (v.next) detail.push("接下来：" + v.next.name + "（" + (v.next.time || v.next.period || "") + "）。");
      if (v.walk && v.walk.txt) detail.push(v.walk.txt + "。");
      if (v.budgetTxt) detail.push(v.budgetTxt + "。");
      if (v.theme) detail.push("今日主题：" + v.theme + "。");
    } else {
      detail.push("阶段：行程已结束。");
    }
    const q = "结合本地上下文里的真实行程信息，给我今天最实用的 3 条建议（动线/时间、穿搭或装备、预算或体力各一条），每条一句话，别写套话。";
    let ctx = "";
    try { ctx = Cloud.aiContextOf(plan, "今天页") + "\n" + detail.join("\n"); } catch (e) { ctx = detail.join("\n"); }
    self.setData({ aiLoading: true, aiErr: "" });
    if (typeof Cloud.cloudEnabled !== "function" || !Cloud.cloudEnabled()) { self._aiTodayOffline(plan); return; }
    AIAgent.ask("today", q, ctx)
      .then((r) => {
        if (r && r.ok && r.text) self.setData({ aiText: r.text, aiSource: r.source || "ai", aiLoading: false, aiErr: "" });
        else self._aiTodayOffline(plan);
      })
      .catch(() => { self._aiTodayOffline(plan); });
  },

  _aiTodayOffline(plan) {
    let r;
    try { r = T.askAssistant("今天安排", plan); } catch (e) { r = { text: "" }; }
    const txt = (r && r.text) || "离线模式：按行程顺序走，留意体力与预算节奏；详情看「行程」页。";
    this.setData({ aiText: txt, aiSource: "", aiLoading: false, aiErr: "" });
  },

  // ── 主动 AI 建议：打开「今天」页即基于真实行程状态推 1 条（强模型优先 · 离线回落规则提示）──
  _loadProactive(force) {
    const self = this;
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    const key = (plan.cityName || "") + "|" + (plan.depart || "");
    const now = Date.now();
    // 15 分钟内同行程直接复用缓存，避免 onShow 频繁打云端（手动「换一条」可强制忽略缓存）
    if (!force && _proactiveCache.key === key && now - _proactiveCache.ts < 15 * 60 * 1000 && _proactiveCache.tip) {
      self.setData({ proactiveTip: _proactiveCache.tip, proactiveOffline: _proactiveCache.offline || false, proactiveLoading: false });
      return;
    }
    if (self.data.proactiveLoading) return;
    const v = this.data.view || {};
    const detail = [];
    if (this.data.state === "before") { if (v.daysLeft != null) detail.push("阶段：行前，距出发 " + v.daysLeft + " 天。"); }
    else if (this.data.state === "during") {
      if (v.dayNo != null) detail.push("阶段：行程中，第 " + v.dayNo + "/" + (v.total || "?") + " 天。");
      if (v.budgetTxt) detail.push(v.budgetTxt + "。");
      if (v.walk && v.walk.txt) detail.push(v.walk.txt + "。");
    } else detail.push("阶段：行程已结束。");
    const offlineTip = function () {
      let t = "";
      try { const ck = T.planCheckup(plan); if (ck && ck.tips && ck.tips.length) t = ck.tips[0]; } catch (e) {}
      return t || "离线模式：按行程顺序走，留意体力与预算节奏。";
    };
    const q = "结合上面真实的本机行程信息，给我今天最值得注意的 1 条建议（一句话，具体到这座城 / 这天 / 这个节奏），不要套话。";
    let ctx = "";
    try { ctx = Cloud.aiContextOf(plan, "今天页·主动建议") + "\n" + detail.join("\n"); } catch (e) { ctx = detail.join("\n"); }
    if (!Cloud.cloudEnabled()) {
      const t = offlineTip();
      _proactiveCache = { key: key, ts: now, tip: t, offline: true };
      self.setData({ proactiveTip: t, proactiveOffline: true, proactiveLoading: false });
      return;
    }
    self.setData({ proactiveLoading: true });
    AIAgent.ask("today-proactive", q, ctx)
      .then((r) => {
        const tip = (r && r.ok && r.text) ? r.text : offlineTip();
        _proactiveCache = { key: key, ts: now, tip: tip, offline: !(r && r.ok) };
        self.setData({ proactiveTip: tip, proactiveOffline: !(r && r.ok), proactiveLoading: false });
      })
      .catch(() => {
        const t = offlineTip();
        _proactiveCache = { key: key, ts: now, tip: t, offline: true };
        self.setData({ proactiveTip: t, proactiveOffline: true, proactiveLoading: false });
      });
  },

  // v1.20.7：手动「换一条」——清空 15 分钟缓存并强制重新拉取主动建议（忽略缓存）
  proactiveRefresh() {
    if (this.data.proactiveLoading) return;
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程", icon: "none" }); return; }
    _proactiveCache = { key: "", ts: 0, tip: "" };
    this._loadProactive(true);
  },

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
  },

  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
  aiClearChat() {
    try { AIAgent.clearHistory("today"); } catch (e) {}
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
}));
