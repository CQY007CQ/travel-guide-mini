const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// assistant：本地攻略速查（离线 · 本地规则库 · 零网络）
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");
const EL = require("../../utils/errlog.js");   // v1.19.205：候选/收藏读取失败留痕，不再静默清空
const AI = require("./ai-brain.js"); // 全场景 AI 大脑（ai-intent 严格超集：委派 6 类 + 新增 14 场景，离线零网络）
const Cloud = require("../../utils/cloud.js");        // 云互通基座（含跨端同步码）
const AIAgent = require("../../utils/ai-agent.js");
const PROMPTS = require("./ai-prompts.js");   // 强模型场景提示词注册表（完整 10 套 + 作战协议，置于本分包不占主包）
const AIReason = require("./ai-reason.js");  // v1.20.6：双视角推理 + 白名单可执行动作（分包内，主包零增长）
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
    lastIntent: "",     // 最近一次结果的意图（如 "review"），驱动结果卡上的专属操作按钮
    spotResult: null,   // 查景点结果
    actions: [],        // 增强意图附带的「直达对应页」按钮
    planSpots: [],      // 查景点模式：当前行程里的景点（一键查）
    keepN: 0, keepsOpen: false, keeps: [],
    input: "",
    // v1.20.7：AI 一句话生成行程（自然语言 → 参数 → 直接生成并跳行程页）
    nlText: "", nlBusy: false, nlResult: "",
    aiSource: "",       // 非空表示最近一次结果来自云端强模型（显示「AI 生成」标识）
    scenarios: [],      // 全场景 AI 速达：由 ai-brain.allScenarios() 驱动
    deepTip: "",        // 深链进入时的场景提示（?topic=）
    // v1.20.6：双视角推理与页面级上下文
    altText: "",        // 独立审慎视角的回答（复杂问题才有）
    showingAlt: false,  // 当前是否展示第二视角
    dualOn: false,      // 本次回答是否有第二视角
    pageCtxOn: false    // 本次是否带入了来源页的真实数据
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

  onLoad(options) {
    this.__boot = T.ready().catch(() => null);
    // 深链：其它页带 ?topic=&city=&from= 进入，自动给出该场景的 AI 建议卡
    this._deep = {
      topic: (options && options.topic) || "",
      city: (options && options.city) || "",
      from: (options && options.from) || "",
      done: false
    };
    // v1.20.6：读取 ai-entry 在跳转前存入的「来源页真实数据快照」。
    // 纯内存、5 分钟有效、场景必须匹配；不落盘、不跨会话，避免旧数据串到新对话。
    this._pageCtx = "";
    try {
      const pc = app.globalData && app.globalData.__aiPageCtx;
      if (pc && pc.text && (Date.now() - (pc.ts || 0) < 5 * 60 * 1000) &&
          (!pc.topic || !this._deep.topic || pc.topic === this._deep.topic)) {
        this._pageCtx = String(pc.text).slice(0, 1200);
      }
    } catch (e) {}
    this.setData({ pageCtxOn: !!this._pageCtx });
  },

  // 统一 grounding 出口：本机通用上下文 + 来源页专属真实数据（三处 AIAgent.ask 共用）。
  _contextOf(plan, label) {
    let base = "";
    try { base = Cloud.aiContextOf(plan, label); } catch (e) { base = ""; }
    return this._pageCtx ? (base + "\n\n" + this._pageCtx) : base;
  },

  toggleAlt() {
    if (!this.data.altText) return;
    this.setData({ showingAlt: !this.data.showingAlt });
  },
  onShow() { onShowRender(this, "assistant", null, () => { if (this.data.mode === "spot") this._computePlanSpots(); }); },
  _renderShow() {
    try { this._theme(); this.refresh(); this._applyDeepTopic(); }
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
    // 全场景 AI 速达面板：把小程序全部能力以 AI 语境一站式带到眼前
    let scenarios = [];
    try { if (AI.allScenarios) scenarios = AI.allScenarios(); } catch (e) {}
    this.setData({ hasPlan, ctx, scenarios });
    this._syncKeeps();
  },

  // 深链进入（?topic=场景key&city=城市&from=来源）：自动给出该场景的 AI 建议卡
  _applyDeepTopic() {
    const d = this._deep;
    if (!d || !d.topic || d.done) return;
    d.done = true;
    const plan = app.globalData.plan;
    const city = d.city || (plan && (T.activeCityOf(plan) || plan.cityName)) || "";
    const label = (AI.topicLabel ? AI.topicLabel(d.topic) : d.topic) || "场景";
    // 需要城市的场景：用深链城市拼出真实查询，避免落到示例城市（如成都）
    const cityQ = {
      generate: function (c) { return "帮我生成" + c + " 3 天行程"; },
      food: function (c) { return c + "吃什么"; },
      deep: function (c) { return c + " 深度玩法"; },
      spotsearch: function (c) { return c + " 亲子景点"; }
    };
    let r = null;
    try {
      if (d.topic === "spot") { this.explainSpot(d.spot || "", d.city || city); this.setData({ deepTip: "已为你打开「景点讲解」" }); return; }
      if (city && cityQ[d.topic]) r = AI.handle(cityQ[d.topic](city), { city: city, plan: plan, page: "assistant", from: d.from });
      else if (AI.topicReply) r = AI.topicReply(d.topic, { city: city, plan: plan, page: "assistant", from: d.from });
    } catch (e) {}
    if (r) {
      if (r.jump) { this._nav(r.jump); }
      this._lastResult = r.text;
      this.setData({
        lastQuery: label, lastResult: r.text, lastTileK: "", input: "",
        actions: r.actions || [], aiSource: "", deepTip: "已为你打开「" + label + "」", lastIntent: r.intent || ""
      });
    } else {
      this.setData({ deepTip: "该场景暂不可用" });
    }
  },

  // 全场景 AI 速达：点面板任意场景，给一句 AI 语境介绍 + 直达按钮（不自动执行生成等重操作）
  onScenario(e) {
    const key = e.currentTarget.dataset.key;
    let sc = null;
    try { sc = (AI.allScenarios() || []).find(function (x) { return x.key === key; }); } catch (err) {}
    if (!sc) return;
    const plan = app.globalData.plan;
    const city = (plan && (T.activeCityOf(plan) || plan.cityName)) || this._deep.city || "";
    let r = null;
    try { if (AI.scenarioCard) r = AI.scenarioCard(key, { city: city, plan: plan, page: "assistant" }); } catch (err) {}
    if (!r) {
      const rt = (AI.PAGE_ROUTE && AI.PAGE_ROUTE[sc.page]) || { p: "pages/index/index", tab: true };
      r = { text: sc.desc + "。", actions: [{ label: sc.label + " →", path: rt.p, query: city ? { city: city } : {}, mode: rt.tab ? "tab" : "push" }], intent: sc.key };
    }
    this._lastResult = r.text;
    this.setData({ lastQuery: sc.label, lastResult: r.text, lastTileK: "", input: "", actions: r.actions || [], aiSource: "", lastIntent: sc.key });
    try { wx.showToast({ title: sc.label, icon: "none" }); } catch (_) {}
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

  /* ---- v1.20.7：AI 一句话生成行程（自然语言 → 参数 → 直接生成并跳行程页） ----
   * 走 AIAgent.parsePlanIntent：云已配 → 强模型更准地拆参；云未配/超时 → 回落本地关键字解析。
   * 零伪造：只产出参数，真实行程一律 T.buildPlan 本地生成；城市名必经 T.findCity 白名单校验。 ---- */
  onNLInput(e) { this.setData({ nlText: (e.detail && e.detail.value) || "" }); },
  onNLRun() {
    const text = (this.data.nlText || "").trim();
    if (!text) { wx.showToast({ title: "先说一句，如：成都3天亲子穷游", icon: "none" }); return; }
    if (this.data.nlBusy) return;
    this.setData({ nlBusy: true, nlResult: "" });
    AIAgent.parsePlanIntent(text)
      .then((p) => {
        this.setData({ nlBusy: false });
        if (!p || !p.city) { this.setData({ nlResult: "没识别出城市，换个说法，如：成都3天亲子穷游" }); return; }
        this._nlGenerate(p);
      })
      .catch(() => { this.setData({ nlBusy: false, nlResult: "解析失败，换个说法试试" }); });
  },
  // 解析结果 → 本地生成行程并跳转到行程页（与首页 generate 同源，零云依赖）
  _nlGenerate(p) {
    const self = this;
    let c = null;
    try {
      if (T.findCity) c = T.findCity(p.city);
      if (!c) {
        const provs = T.provinces();
        for (let pi = 0; pi < provs.length && !c; pi++) {
          const cs = T.citiesOf(provs[pi]) || [];
          c = cs.find((x) => x.name === p.city) || null;
        }
      }
    } catch (e) {}
    if (!c) { this.setData({ nlResult: "未收录「" + p.city + "」，换个城市试试" }); return; }
    const d = new Date(); d.setDate(d.getDate() + 3);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    const depart = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const budgetKey = p.budget || "mid";
    const pace = p.pace || "balance";
    const tm = p.travelMode || "";
    const people = p.people || 2;
    const bias = p.bias || "";
    const days = Math.max(1, Math.min(14, p.days || 4));
    try {
      const oldPlan = app.globalData && app.globalData.plan;
      if (oldPlan && oldPlan.days && oldPlan.days.length) T.savePlanSlot(oldPlan);
      const daysArr = T.buildPlan({ city: c, days, depart, budget: budgetKey, pace, travelMode: tm, people, stayMountain: true, picks: [], pickOnly: false, bias });
      const from = { province: c.province || "", city: c.name };
      try { T.resetTripPrep(); } catch (e) {}
      if (app.setPlan) app.setPlan({
        cityName: c.name, province: c.province || "", totalDays: daysArr.length, depart, days: daysArr,
        budget: budgetKey, customAmt: 0, people, pace, travelMode: tm, pickOnly: false, isMulti: false,
        from, savedAt: Date.now(), bias
      });
      try { T.pushRecent({ province: c.province || "", city: c.name, days: daysArr.length, depart }); } catch (e) {}
      const m1 = { family: "亲子", couple: "情侣", solo: "独行", elder: "带老人" };
      const m2 = { low: "经济", mid: "舒适", high: "高端" };
      const bits = [];
      if (p.days) bits.push(days + "天");
      if (tm && m1[tm]) bits.push(m1[tm]);
      if (budgetKey && m2[budgetKey]) bits.push(m2[budgetKey]);
      this.setData({ nlResult: "已生成「" + c.name + "」" + (bits.join(" · ") || "") + "，正在打开…" });
      wx.showToast({ title: "已生成「" + c.name + "」攻略", icon: "none" });
      setTimeout(() => { try { wx.switchTab({ url: "/pages/plan/plan" }); } catch (e) {} }, 700);
    } catch (e) {
      this.setData({ nlResult: "生成失败：" + ((e && e.message) || "请稍后重试") });
    }
  },

  _spotSearch(q) {
    let city = "";
    try { const plan = app.globalData && app.globalData.plan; if (plan) city = T.activeCityOf(plan) || plan.cityName || ""; } catch (e) {}
    let r;
    try { r = T.spotLookup(q, city); }
    catch (e) { r = { found: false }; }
    this.setData({ spotResult: r, input: "", actions: [], aiSource: "" });
    if (!r.found) wx.showToast({ title: "没查到这个景点，换个名字试试", icon: "none" });
  },

  _runQuery(q, tileK) {
    const plan = app.globalData.plan;
    const city = (plan && T.activeCityOf(plan)) || (plan && plan.cityName) || "";
    // 先走增强意图（出片/周边/城市名片/单景点详情/显式导航），不命中回落本地规则引擎（零回归）
    let ai = null;
    try { ai = AI.handle(q, { city: city, plan: plan, page: "assistant" }); }
    catch (e) { try { EL.push("assistant.ai", e); } catch (_) {} }
    if (ai) {
      if (ai.jump) this._nav(ai.jump);   // 显式导航：直接切页
      this._lastResult = ai.text;
      this.setData({ lastQuery: q, lastResult: ai.text, lastTileK: tileK, input: "", actions: ai.actions || [], lastIntent: ai.intent || "" });
      return;
    }
    // 离线意图未命中：自由查（非一键查卡片）优先走云端强模型（带本行程 grounding）；
    // 不可用（云未开 / 未配置 / 出错）一律回落本地规则引擎，零白屏、零回归。
    if (tileK === "" && Cloud.cloudEnabled()) {
      this._aiQuery(q, plan);
      return;
    }
    let r;
    try { r = T.askAssistant(q, plan); }
    catch (e) { r = { text: "查询出错了，换个关键词试试", tag: "info" }; }
    this._lastResult = r.text;
    this.setData({
      lastQuery: q, lastResult: r.text, lastTileK: tileK,
      input: "", actions: [], aiSource: "", lastIntent: ""
    });
  },

  _aiQuery(q, plan) {
    const self = this;
    try { wx.showLoading({ title: "AI 思考中", mask: false }); } catch (e) {}
    const ctx = this._contextOf(plan, "本地速查助手");
    // 主回答：完整场景纪律 + 可选动作契约；复杂问题再并发一条独立审慎视角。
    // 两链是「并列供用户判断」，不假装投票出唯一真理（零伪造）。
    const sys = PROMPTS.buildSystem("assistant") + AIReason.actionContract();
    const main = AIAgent.ask("assistant", q, ctx, sys);
    const alt = AIReason.needsSecondOpinion(q) ? AIReason.secondOpinion(q, ctx) : Promise.resolve(null);
    Promise.all([main, alt]).then(function (rs) {
      try { wx.hideLoading(); } catch (e) {}
      const r = rs[0], a = rs[1];
      if (r && r.ok && r.text) {
        const raw = String(r.text);
        const actions = AIReason.parseActions(raw);
        const text = AIReason.stripActionBlock(raw) || raw;
        self._lastResult = text;
        self.setData({
          lastQuery: q, lastResult: text, lastTileK: "", input: "", actions: actions,
          aiSource: r.source || "ai", lastIntent: "",
          altText: (a && a.ok && a.text) ? String(a.text) : "",
          showingAlt: false, dualOn: !!(a && a.ok && a.text)
        });
        return;
      }
      self._aiFallback(q, plan);
    }).catch(function () { try { wx.hideLoading(); } catch (e) {} self._aiFallback(q, plan); });
  },

  _aiFallback(q, plan) {
    const self = this;
    let r;
    try { r = T.askAssistant(q, plan); }
    catch (e) { r = { text: "查询出错了，换个关键词试试", tag: "info" }; }
    self._lastResult = r.text;
    self.setData({ lastQuery: q, lastResult: r.text, lastTileK: "", input: "", actions: [], aiSource: "", lastIntent: "" });
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

  goIndex() { wx.switchTab({ url: "/pages/index/index" }); },

  goLens() { try { wx.navigateTo({ url: "/subpkg/lens/lens" }); } catch (e) {} },

  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
  aiClearChat() {
    try { AIAgent.clearHistory("assistant"); } catch (e) {}
    try { AI.resetSession(); } catch (e) {}   // 离线多轮上下文（城市/意图/最近景点）一并清空，避免刷新后串城
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },

  // 景点结果卡上的「AI 讲解这个景点」：云端启用时把本机真实资料作 grounding 交给强模型延伸讲解；
  // 未开/出错回落本地离线收录（零编造、零白屏）。
  onSpotAI() {
    const sr = this.data.spotResult;
    if (!sr || !sr.name) { wx.showToast({ title: "先查一个景点", icon: "none" }); return; }
    const city = sr.city || (function () { try { const p = app.globalData && app.globalData.plan; return p ? (T.activeCityOf(p) || p.cityName) : ""; } catch (e) { return ""; } })();
    this.explainSpot(sr.name, city);
  },

  // 统一景点讲解（按钮 / 深链共用）：name 为景点名；云端优先，离线兜底。
  explainSpot(name, city) {
    const self = this;
    const plan = app.globalData && app.globalData.plan;
    const nm = String(name || "").trim();
    if (!nm) { wx.showToast({ title: "先查一个景点", icon: "none" }); return; }
    let offline = null;
    try { offline = AI.spotExplain(nm, { city: city, plan: plan, page: "assistant", spot: nm }); } catch (e) {}
    if (!offline) offline = { text: "这个景点暂无更详细的本地资料。", actions: [] };
    if (!Cloud.cloudEnabled()) {
      this.setData({ lastQuery: "AI 讲解这个景点", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "" });
      return;
    }
    // 组装本地真实景点资料作 grounding（强模型只能基于它延伸，不编造）
    const ground = (function () {
      try {
        const r = T.spotLookup(nm, city);
        const p = [];
        if (r && r.intro) p.push("介绍：" + r.intro);
        if (r && r.how) p.push("怎么玩：" + r.how);
        if (r && r.route) p.push("怎么去：" + r.route);
        if (r && r.ticket && r.ticket.known) p.push("门票：" + (r.ticket.price || "") + (r.ticket.book ? "（需预约）" : "") + (r.ticket.where ? " · " + r.ticket.where : ""));
        if (r && r.booking) p.push("预约提示：" + r.booking);
        return p.join("\n");
      } catch (e) { return ""; }
    })();
    const ctx = this._contextOf(plan, "景点讲解") +
      "\n\n本机真实景点资料（请以这些为准，不要编造任何资料外的事实）：\n" + (ground || "（本机暂无该景点详细收录）");
    const q = "请讲讲「" + nm + "」（" + (city || "当地") + "）";
    try { wx.showLoading({ title: "AI 讲解中", mask: false }); } catch (e) {}
    AIAgent.ask("spot", q, ctx, PROMPTS.buildSystem("spot"))
      .then(function (res) {
        try { wx.hideLoading(); } catch (e) {}
        if (res && res.ok && res.text) {
          self.setData({ lastQuery: "AI 讲解这个景点", lastResult: res.text, lastTileK: "", input: "", aiSource: res.source || "ai", actions: offline.actions || [], lastIntent: "" });
        } else {
          self.setData({ lastQuery: "AI 讲解这个景点", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "" });
        }
      })
      .catch(function () { try { wx.hideLoading(); } catch (e) {} self.setData({ lastQuery: "AI 讲解这个景点", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "" }); });
  },

  // 结果卡上的「AI 帮我写游记」：基于本机真实素材（手记/记账/去过的地方）作 grounding 交给强模型升华成游记；
  // 未开/出错回落本地离线复盘（零编造、零白屏）。
  onReviewAI() {
    const city = (function () { try { const p = app.globalData && app.globalData.plan; return p ? (T.activeCityOf(p) || p.cityName) : ""; } catch (e) { return ""; } })();
    this.explainReview(city);
  },

  // 统一行程复盘/游记（按钮 / 深链共用）：云端优先，离线兜底。
  explainReview(city) {
    const self = this;
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程", icon: "none" }); return; }
    let offline = null;
    try { offline = AI.review("帮我复盘这趟行程", { city: city, plan: plan, page: "assistant" }); } catch (e) {}
    if (!offline) offline = { text: "暂无可复盘的素材。旅途中记点笔记、花点钱，回来我帮你写复盘/游记。", actions: [] };
    if (!Cloud.cloudEnabled()) {
      this.setData({ lastQuery: "AI 帮我写游记", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "review" });
      return;
    }
    // 组装本地真实素材作 grounding（强模型只升华、不编造）
    const ground = (offline.ground || "");
    const ctx = this._contextOf(plan, "行程复盘") +
      "\n\n本机真实素材（请以这些为准，只升华不编造任何没发生的事实）：\n" + (ground || "（本机暂无详细素材）");
    const q = "请帮我写一份这趟「" + (plan.cityName || "") + "」的行程复盘/游记";
    try { wx.showLoading({ title: "AI 写游记中", mask: false }); } catch (e) {}
    AIAgent.ask("review", q, ctx, PROMPTS.buildSystem("review"))
      .then(function (res) {
        try { wx.hideLoading(); } catch (e) {}
        if (res && res.ok && res.text) {
          self.setData({ lastQuery: "AI 帮我写游记", lastResult: res.text, lastTileK: "", input: "", aiSource: res.source || "ai", actions: offline.actions || [], lastIntent: "review" });
        } else {
          self.setData({ lastQuery: "AI 帮我写游记", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "review" });
        }
      })
      .catch(function () { try { wx.hideLoading(); } catch (e) {} self.setData({ lastQuery: "AI 帮我写游记", lastResult: offline.text, lastTileK: "", input: "", aiSource: "", actions: offline.actions || [], lastIntent: "review" }); });
  },
}));
