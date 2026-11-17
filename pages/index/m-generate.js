// pages/index/m-generate.js —— 首页生成链路（读表单 → 生成攻略 / 盲盒 / 最近玩过回填 / 降级重试）（从 index.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./index-ctx.js");
const { app, AN, T, S, R, PACE_TXT, MODE_TXT, iso, _uniqRecent } = C;

module.exports = {
  generate() {
    if (this.data.loading) return;
    if (!this.data.depart || this.data.depart < this.data.departMin) {
      wx.showToast({ title: "出发日期不能早于今天", icon: "none" }); return;
    }
    // 预算：自定义 = 全行程总预算（元），按 days×people 分摊映射酒店档位
    let budgetKey = this.data.budgetKeys[this.data.budgetIdx] || "mid";
    let customAmt = 0;
    if (budgetKey === "custom") {
      customAmt = parseFloat(this.data.customAmt);
      if (!(customAmt > 0)) { wx.showToast({ title: "请输入全行程总预算（元）", icon: "none" }); return; }
      const totalDays = (this.data.multiMode && this.data.multiRoute.length)
        ? this.data.multiRoute.reduce((a, s) => a + (s.days || 1), 0)
        : this.data.days;
      const perDayPer = customAmt / Math.max(1, totalDays) / Math.max(1, this.data.people);
      // 与网页版共用档位推导：<300/人天=经济，<600=舒适，其余=高端（planner.tierOfPerDay）
      budgetKey = T.P.tierOfPerDay ? T.P.tierOfPerDay(perDayPer) : (perDayPer < 300 ? "low" : perDayPer < 600 ? "mid" : "high");
    }
    this.setData({ loading: true });
    this._syncUi();
    // v1.19.2：生成是同步计算，大城 / 全省 14 天会明显停顿；补全屏 loading 给出明确反馈
    try { wx.showLoading({ title: "正在生成攻略…", mask: true }); } catch (e) {}
    // 自动存档当前行程（多行程管理：换计划不丢行程，more 页可恢复）
    try {
      const oldPlan = app.globalData.plan;
      if (oldPlan && oldPlan.days && oldPlan.days.length) T.savePlanSlot(oldPlan);
    } catch (e) {}
    try {
      const fromObj = this.data.fromCityObj || null;
      const from = fromObj ? { province: fromObj.province, city: fromObj.name } : { province: "山西省", city: "太原" };
      const pace = this.data.paceVals[this.data.paceIdx];
      const tm = this.data.travelModeVals[this.data.travelModeIdx];
      const bias = this.data.biasVals[this.data.biasIdx] || "";

      if (this.data.multiMode && this.data.multiRoute.length) {
        // 多站串联：每站一城，分别按段生成
        const route = this.data.multiRoute.slice(0, 4);
        const picksPerStation = {};
        route.forEach(s => {
          picksPerStation[s.name] = T.getWish().filter(x => !x.city || x.city === s.name).map(x => x.name);
        });
        const out = T.buildMultiPlan({
          route,
          depart: this.data.depart,
          budget: budgetKey, pace,
          travelMode: tm,
          people: this.data.people,
          stayMountain: this.data.stayMtn,
          picksPerStation,
          pickOnly: this.data.pickOnly,
          bias
        });
        app.globalData.from = { province: route[0].province, city: route[0].name };
        try {
          S.set("fromV1", { province: route[0].province, city: route[0].name });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: route.map(s => s.name).join(" → "),
          province: route[0].province,
          totalDays: out.totalDays,
          depart: this.data.depart,
          days: out.days,
          segments: out.segments,
          route: out.route,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: this.data.pickOnly,
          isMulti: true,
          from, savedAt: Date.now(),
          bias
        });
        T.pushRecent({ province: route[0].province, city: route[0].name, days: out.totalDays, depart: this.data.depart });
        this.setData({ recents: _uniqRecent(T.getRecent()) });
      } else if (this.data.provMode) {
        // 全省 · 省内精华游：目的地 = 整省（跨城串联，酒店随城市变动；镜像网页版 __all）
        const provName = this.data.provName;
        if (!provName) { wx.showToast({ title: "请先选择目的地省份", icon: "none" }); return; }
        const daysArr = T.buildProvPlan({
          province: provName,
          days: this.data.days,
          depart: this.data.depart,
          budget: budgetKey,
          pace, travelMode: tm,
          stayMountain: this.data.stayMtn,
          bias
        });
        // v1.12.3 兜底：landmark 有限，实际天数可能少于所选，明确告知而非静默缩水
        if (daysArr.length < this.data.days) {
          wx.showToast({ title: provName + " 精华景点有限，本次生成 " + daysArr.length + " 天", icon: "none" });
        }
        app.globalData.from = { province: provName, city: "" };
        try {
          S.set("fromV1", { province: provName, city: "" });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: provName,
          province: provName,
          totalDays: daysArr.length,
          depart: this.data.depart,
          days: daysArr,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: false,
          isMulti: false,
          isProv: true,
          from,
          savedAt: Date.now(),
          bias
        });
        // 全省游不进「最近记录」（恢复需省名特判，v1 从简）
      } else {
        // 单城（既有逻辑）
        const c = this.data.cities[this.data.cityIdx];
        if (!c) { wx.showToast({ title: "请选择目的地城市", icon: "none" }); return; }
        const picks = T.getWish().filter(x => !x.city || x.city === c.name).map(x => x.name);
        const pickOnly = this.data.pickOnly && picks.length > 0;
        const daysArr = T.buildPlan({
          city: c,
          days: this.data.days,
          depart: this.data.depart,
          budget: budgetKey, pace, travelMode: tm,
          people: this.data.people,
          stayMountain: this.data.stayMtn,
          picks, pickOnly,
          bias
        });
        app.globalData.from = { province: this.data.provName, city: c.name };
        try {
          S.set("fromV1", { province: this.data.provName, city: c.name });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: c.name,
          province: this.data.provName,
          totalDays: daysArr.length,
          depart: this.data.depart,
          days: daysArr,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: pickOnly,
          isMulti: false,
          from,
          savedAt: Date.now(),
          bias
        });
        T.pushRecent({ province: this.data.provName, city: c.name, days: daysArr.length, depart: this.data.depart });
        this.setData({ recents: _uniqRecent(T.getRecent()) });
      }
      // v1.13.1：新行程落地前重置行李清单勾选（上一程的打包进度不带进新程）
      // v1.15.3：换目的地后，订往返票/订酒店/过流程/请假 等「绑定本次行程」的准备项一并重置
      T.resetTripPrep();
      // 埋点：生成成功（含类型维度，区分单城/多站/全省）
      try { AN.track("plan_generate", { ok: 1, mode: this.data.multiMode ? "multi" : (this.data.isGuide ? "prov" : "city"), days: this.data.days }); } catch (e) {}
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (err) {
      // v1.20.6：把被吞的真实异常透出来，否则「生成失败」永远是无头案。
      // 与 web/lib/runtime.js 的 handler 错误日志保持一致（属错误上报，非调试噪音）。
      try { console.error("[generate] 生成攻略真实异常：", err); } catch (e) {}
      // 埋点：生成失败（这是最该盯的指标——主路径走不通，其他优化都是白费）
      try { AN.track("plan_generate", { ok: 0 }); } catch (e) {}
       // v1.11：生产包不留 console.log（错误已通过 toast 告知用户）
       // v1.19.49：单城生成失败多为瞬时异常，提示「稍后重试」比「换个路线」更准确，避免误以为目的地有问题
       wx.showToast({ title: "生成失败，请稍后重试", icon: "none" });
    } finally {
      try { wx.hideLoading(); } catch (e) {}
      try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) {}
      this.setData({ loading: false });
      this._syncUi();
    }
  },

  // v1.19.60：数据就绪自愈 —— onLoad 内的省/市填充是同步执行的，若冷启动分包数据尚未到位
  // （或上次加载被吞错），选择器会渲染为空且 onShow._renderShow 不重填 → 永久空白误判白屏。
  // 此处待 ready() 后主动重填；仍为空才置 dataFailed 展示重试卡片。已选 provIdx/cityIdx 合法则保留。
  _ensureForm() {
    let provs = [];
    try { provs = T.provinces() || []; } catch (e) { provs = []; }
    if (!provs.length) { this.setData({ dataFailed: true }); return; }
    // v1.20.10：冷启动时数据未就绪，onLoad 里「依赖城市数据那一轮」被挂起，这里是唯一重入点。
    // 顺序关键：先补跑（内部可能改写 provIdx/cityIdx，例如深链/偏好指定的城市），
    // 再按「当前」provIdx/cityIdx 重算选择器 —— 反过来会把深链选中的城市盖回默认值。
    // 数据仍未就绪时不消费标记，留给「重试加载」后的下一次 _ensureForm。
    if (this.__needIndexInit) {
      this.__needIndexInit = false;
      this._initIndexData();
    }
    this.setData({ dataFailed: false });
    let provIdx = this.data.provIdx || 0;
    if (provIdx < 0 || provIdx >= provs.length) provIdx = 0;
    const prov = provs[provIdx];
    let cities = [];
    try { cities = T.citiesOf(prov) || []; } catch (e) { cities = []; }
    let cityIdx = this.data.cityIdx || 0;
    if (cityIdx < 0 || cityIdx >= cities.length) cityIdx = 0;
    try { this._initFrom(); } catch (e) {}   // from 表依赖 PROVINCE_CITIES，需随数据就绪重算
    this.setData({ provinces: provs, cities, provIdx, provName: prov || "", cityIdx });
    try { this._applyCity(cityIdx); } catch (e) {}
    try { this._syncAdv(); } catch (e) {}
    try { this._syncHoli(); } catch (e) {}
  },

  // 收集当前首页全部配置（目的地 + 设置），用于存草稿
  _collectCfg() {
    const d = this.data;
    return {
      segIdx: d.segIdx,
      provMode: d.provMode,
      multiMode: d.multiMode,
      provIdx: d.provIdx,
      provName: d.provName,
      cityIdx: d.cityIdx,
      cityName: d.cityName,
      multiRoute: (d.multiRoute || []).map(s => ({ name: s.name, province: s.province, days: s.days })),
      days: d.days,
      depart: d.depart,
      paceIdx: d.paceIdx,
      biasIdx: d.biasIdx,
      travelModeIdx: d.travelModeIdx,
      budgetIdx: d.budgetIdx,
      showCustom: d.showCustom,
      customAmt: d.customAmt,
      people: d.people,
      stayMtn: d.stayMtn,
      fromIdx: d.fromIdx,
      pickOnly: d.pickOnly
    };
  },

  _blindGen(it) {
    try {
      const depart = this.data.depart || iso(new Date(Date.now() + 7 * 86400000));
      const daysArr = T.buildPlan({
        city: it.name, province: it.province, days: it.days || 3, depart,
        budget: this.data.budgetKeys[this.data.budgetIdx], pace: this.data.paceVals[this.data.paceIdx],
        people: this.data.people,
        bias: this.data.biasVals[this.data.biasIdx] || ""
      });
      const p = {
        cityName: it.name, province: it.province, totalDays: daysArr.length,
        depart, days: daysArr, budget: this.data.budgetKeys[this.data.budgetIdx],
        people: this.data.people, pace: this.data.paceVals[this.data.paceIdx],
        bias: this.data.biasVals[this.data.biasIdx] || "",
        isMulti: false, savedAt: Date.now()
      };
      T.resetTripPrep(); // v1.13.1 + v1.15.3：盲盒生成的也是新行程，行李清单与行程绑定项一并重置
      getApp().setPlan(p);
      wx.showToast({ title: "已生成「" + it.name + "」攻略", icon: "none" });
      setTimeout(() => wx.switchTab({ url: "/pages/plan/plan" }), 700);
    } catch (err) {
      wx.showToast({ title: "生成失败：" + (err.message || ""), icon: "none" });
    }
  },

  // 2026-11-09（#482 示例行程）：一键载入「成都 5 天」精排示例，复用正常生成路径（离线可出）
  onSample() {
    try {
      const c = T.findCity ? T.findCity("成都") : null;
      if (!c) { wx.showToast({ title: "示例城市暂未收录", icon: "none" }); return; }
      // 示例行程用 +2 出发：5 天正好落在和风 7 天预报窗口(today..+6)内，演示能直接看到天气
      const d = new Date(); d.setDate(d.getDate() + 2);
      const depart = iso(d);   // 复用本文件已有的 iso()，去掉重复的日期拼接
      const oldPlan = app.globalData && app.globalData.plan;
      if (oldPlan && oldPlan.days && oldPlan.days.length) { try { T.savePlanSlot(oldPlan); } catch (e) {} }
      const daysArr = T.buildPlan({
        city: c, days: 5, depart: depart, budget: "mid", pace: "balance",
        travelMode: "", people: 2, picks: [], pickOnly: false, bias: ""
      });
      const from = { province: c.province || "", city: c.name };
      app.globalData.from = from;
      app.setPlan({
        cityName: c.name, province: c.province || "", totalDays: daysArr.length, depart: depart,
        days: daysArr, budget: "mid", customAmt: 0, people: 2, pace: "balance", travelMode: "",
        pickOnly: false, isMulti: false, from: from, savedAt: Date.now(), bias: "", isSample: true
      });
      try { T.resetTripPrep(); } catch (e) {}
      wx.showToast({ title: "已载入示例：成都 · 5 天", icon: "none" });
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (err) {
      try { wx.showToast({ title: "示例载入失败，请稍后重试", icon: "none" }); } catch (e) {}
    }
  },

  _applyDraft(cfg) {
    if (!cfg) return;
    if (cfg.provMode) {
      const pIdx = Math.max(0, (this.data.provinces || []).indexOf(cfg.provName));
      this.setData({ provIdx: pIdx, provName: cfg.provName || "", prevCity: null });
      this._enterProv(null);
      this._syncProv();
    } else if (cfg.multiMode) {
      const route = (cfg.multiRoute || []).map(s => ({ name: s.name, province: s.province, days: s.days }));
      this.setData({ multiMode: true, provMode: false, segIdx: 2, multiRoute: route, multiDaysTotal: this._sumDays(route) });
    } else {
      const pIdx = (cfg.provIdx != null && cfg.provIdx >= 0) ? cfg.provIdx : Math.max(0, (this.data.provinces || []).indexOf(cfg.provName));
      this.setData({ provMode: false, multiMode: false, segIdx: 0 });
      this._fillProv(pIdx, cfg.cityName);
    }
    this.setData({
      days: cfg.days, daysText: (cfg.days || 0) + " 天", depart: cfg.depart,
      paceIdx: cfg.paceIdx, biasIdx: cfg.biasIdx, travelModeIdx: cfg.travelModeIdx,
      budgetIdx: cfg.budgetIdx, showCustom: !!cfg.showCustom, customAmt: cfg.customAmt || "",
      people: cfg.people, stayMtn: cfg.stayMtn, fromIdx: cfg.fromIdx, pickOnly: cfg.pickOnly
    });
    this._syncAdv();
    this._syncUi();
    const c = this.data.cities[this.data.cityIdx];
    if (c && !cfg.provMode && !cfg.multiMode) this._refreshPool(c);
  },

  onRecRun() {
    if (this.data.recBusy) return;
    const text = (this.data.recText || "").trim();
    if (!text) { wx.showToast({ title: "先说一句想怎么玩", icon: "none" }); return; }
    this.setData({ recBusy: true, recTried: true });
    try {
      const res = R.recommend(text, { topN: 5 });
      if (res && res.pending) {
        this.setData({ recBusy: false, recList: [] });
        wx.showToast({ title: "数据加载中，稍后再试", icon: "none" });
        return;
      }
      const list = (res.list || []).map((x) => ({
        name: x.name,
        province: x.province || "",
        score: x.score,
        summary: x.summary || "",
        reasonTag: x.reasonTag || "",
      }));
      // 透明度：把「匹配度 / 综合热度 / 你提到的城市」模式与无意图提示透传给视图
      const mode = res.mode || "intent";
      const noIntent = !!res.noIntent;
      const extremeNote = res.extreme ? "（「最…」类诉求项目暂无年代数据，已按契合度排序，具体可实地考证）" : "";
      this.setData({
        recBusy: false,
        recList: list,
        recMode: mode,
        recNoIntent: noIntent,
        recExtremeNote: extremeNote,
      });
    } catch (err) {
      this.setData({ recBusy: false, recList: [] });
      wx.showToast({ title: "推荐失败，请重试", icon: "none" });
    }
  },

  onRecPick(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    try {
      const provs = T.provinces() || [];
      for (let p = 0; p < provs.length; p++) {
        const cs = T.citiesOf(provs[p]) || [];
        if (cs.some((c) => c.name === name)) {
          this._fillProv(p, name);   // 内部已含 _applyCity：预填城市 + 收敛天数 + 想玩池
          wx.showToast({ title: "已填好「" + name + "」", icon: "none" });
          if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 });
          return;
        }
      }
      wx.showToast({ title: "该城可在目的地里搜索", icon: "none" });
    } catch (err) {
      wx.showToast({ title: "填入失败，请手动选择", icon: "none" });
    }
  },

  useBlind(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.data.blind3[i];
    if (!it) return;
    this.setData({ blindOpen: false });
    const self = this;
    wx.showModal({
      title: "去 " + it.name + " 怎么样",
      content: "建议 " + it.days + " 天 · " + it.best + "\n" + (it.why || "") + "\n用当前预算/节奏生成一份？",
      confirmText: "生成",
      success(r) {
        if (!r.confirm) return;
        self._blindGen(it);
      }
    });
  },

  /* ---- v1.8.4 A8：目的地盲盒（3 城灵感，选中直接生成） ---- */
  onBlindRoll() {
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
    this.setData({ blind3: T.inspirePicks(3), blindOpen: true });
  },

  closeBlind() { this.setData({ blindOpen: false }); },

  goPlan() { wx.switchTab({ url: "/pages/plan/plan" }); },

  // v1.19.60：数据分包加载失败后的手动重试（重新触发数据加载并自愈）
  retryData() {
    if (this.data.loadingData) return;
    this.setData({ loadingData: true });
    const self = this;
    Promise.resolve()
      .then(() => { const D = require("../../utils/data.js"); return (D && D.initData) ? D.initData() : Promise.resolve(); })
      .then(() => { self.setData({ loadingData: false }); self._ensureForm(); })
      .catch(() => { self.setData({ loadingData: false, dataFailed: true }); });
  },

  _renderShow() {
    this._theme();
    // v1.6：已有行程时在顶部显示出发倒计时；hasOld 同步刷新（影响首访引导横幅显隐）
    try {
      const p = getApp().globalData.plan;
      // v1.19.38：快捷入口默认展开（不再对老用户自动折叠），避免「只看到头部条、点了不跳转」的误解；
      // 折叠仍可通过头部「收起」手动触发，首屏减负交给高级设置/想玩池承担。
      this.setData({ countdown: T.tripCountdown(p), tiles: T.homeTileList(), hasOld: !!(p && p.days && p.days.length), quickCollapsed: false,
        guideSeen: !!(S.get("miniGuideSeenV1", 0)),
        draftCount: (S.getDrafts() || []).length,
        // v1.8.4 B18：首页预约提醒横幅（有「需提前预约」且未勾已订的票）
        remind: T.ticketRemind(p) });
    } catch (e) { this.setData({ countdown: null, tiles: T.homeTileList(), hasOld: false, quickCollapsed: false, remind: null, guideSeen: !!(S.get("miniGuideSeenV1", 0)) }); }
    // 2026-10-29：「今日正当时」已按用户要求下线（首页不再展示）
    // 想玩池勾选态与 wish 实时同步：在行程页/更多页勾过或移出想玩后回首页，不残留旧高亮
    if (this.data.cityName && this.data.pool && this.data.pool.length) this._syncPoolFromWish();
    this._syncUi();
  },

  _allCities() {
    const provs = T.provinces();
    const out = [];
    provs.forEach(p => T.citiesOf(p).forEach(c => out.push({ name: c.name, province: p, guide: !!c.guide, limited: !!c.limited })));
    return out;
  },

  /* ---- 智能推荐：一句话需求 → 候选城市 ----
   * 引擎在端侧完成标签解析与加权排序，不联网、无随机数：同一句话永远同一结果。
   * 只把 name/province/score/summary 四个字段下发到视图，避免把内部字段带进 setData。 ---- */
  onRecInput(e) {
    this.setData({ recText: (e.detail && e.detail.value) || "" });
  },

  onRecExample(e) {
    const t = e.currentTarget.dataset.t || "";
    if (!t) return;
    this.setData({ recText: t });
    this.onRecRun();
  },
};
