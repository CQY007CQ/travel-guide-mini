// pages/plan/p-render.js —— 行程页渲染与视图态（从 plan.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./plan-ctx.js");
const { app, T, S, A, W, EL, Cloud, AIAgent, AN, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

module.exports = {
 _render(plan) {
  const fmt = s => { const p = String(s).split("-"); return p.length === 3 ? p[1] + "月" + p[2] + "日" : s; };
  // v1.19.2：空数组也是真值 → segs[0] 为 undefined → `.cityName` 抛 TypeError；必须连长度一起判
  const segs = (Array.isArray(plan.segments) && plan.segments.length) ? plan.segments : null;
  // 路段索引映射：segByDay[i] = 该天属于第几个 segment
  const segByDay = segs ? new Array(plan.days.length).fill(0).map((_, di) => {
   for (let s = 0; s < segs.length; s++) if (di >= segs[s].startDay && di <= segs[s].endDay) return s;
   return 0;
  }) : null;
  // v1.19.77：入场动效只在「进入页面」那一次放；__animOn 由 _renderShow 置位，渲染即消费掉
  const anim = this.__animOn === true;
  this.__animOn = false;
  const view = plan.days.map((d, di) => ({
   di,
   anim: anim ? "fx-stagger" : "",
   ads: (anim && di > 0) ? ("animation-delay:" + Math.min(di, 5) * 60 + "ms") : "",
   dateText: fmt(d.date),
   theme: d.theme || "",
   meal: d.meal || "",
   segName: segs ? segs[segByDay[di]].cityName : "",
   segIndex: segs ? segByDay[di] : -1,
   dayTag: T.themeTagOf(d),
   isRainy: d.isRainy ? 1 : 0,          // v1.19.182：天气联动 —— 当天有雨/雪时日卡挂雨标
   rainyHint: d.rainyHint || "",        // v1.19.182：雨天日优先室内/展馆的引导文案
   route: T.routeAdvice(plan, di),
   load: T.dayLoad(plan, di),   // v1.8.4 B12：单日参考时长 / 超时预警
   mv: (!plan.isProv) ? T.dayMove(d, segs ? segs[segByDay[di]].cityName : (plan.cityName || "")) : null,
   items: (d.items || []).map((it, ix) => {
    const _th = thumbFor(it.name, it.img, plan.cityName);
    return {
    ix,
    period: it.period || "",
    name: it.name || "",
    disp: T.showDisp(it.name, segs ? segs[segByDay[di]].cityName : (plan.cityName || "")),
    clean: T.cleanSpotName(it.name),
    note: T.spotNoteDisp(it.note),
    f: isFrame(it.name),
    wished: T.wishHit(it.name),
    visited: T.isVisited(it.name),
    fnote: T.getFootNote(it.name),
    effort: T.P.spotEffort ? T.P.spotEffort(it.name) : 0,
    // v1.11：体力档位文案预计算（WXML 里原本是两层嵌套三元，每个条目渲染都要判一遍）
    effortTx: ["轻走", "徒步", "费腿"][T.P.spotEffort ? T.P.spotEffort(it.name) : 0] || "轻走",
    hour: T.P.spotHours ? T.P.spotHours(it.name) || "" : "",
    // v1.20.8：缩略图（生成配图 / 真实照片字段透传）
    thumbBg: _th.thumbBg, thumbIcon: _th.thumbIcon, img: _th.img, coverLabel: _th.coverLabel, coverBadge: _th.coverBadge, coverCat: _th.coverCat
   };
  })
  }));
  let spots = 0;
  try { spots = T.P.countPlanStats(plan.days).spots; } catch (e) {}
  // v1.20.20：历史脏档的城市名是 URL 编码串（%E5%90%89%E5%AE%89）。渲染层用解码后的名字
  // 做展示与真实数据查询，但**不改存档**（里面的打卡/花费是用户数据，一个字都不能动）。
  // 只影响标题/城市速览/季节徽章；收藏、想玩、打卡等按原键匹配，避免误改用户状态。
  const dispCity = plan.__staleCity ? T.decQuery(plan.cityName) : plan.cityName;
  const city = plan.isProv
   ? (T.P.buildProvinceCity ? T.P.buildProvinceCity(plan.cityName) : null) // 全省游：以省为对象的伪城市（气候/美食/住宿取省会基调）
   : (T.findCity(dispCity) || null);
  let clothText = "", stayText = "", goText = "";
  if (city) {
    // 2026-10-29 去重：clothAdvice 里混进了「适宜时节」和天气整句，
  // 而这两项在顶部 chips 与下方「城市速览」已经各说一次（共三处重复）。
  // 这里只保留「怎么穿」，气候与最佳季节交给城市速览。
  const _bf = (T.cityBrief ? T.cityBrief(dispCity) : null) || {};
  const _dupLines = [String(_bf.climateTxt || "").trim(), String(_bf.best || "").trim()].filter(Boolean);
  clothText = String(T.clothAdvice(city, plan.depart ? +String(plan.depart).slice(5, 7) : 0) || "")
    .split("\n")
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (t.indexOf("适宜时节") === 0) return false;              // 与城市速览「最佳季节」重复
      for (const d of _dupLines) { if (t === d) return false; }   // 与城市速览气候句完全相同
      return true;
    })
    .join("\n");
    stayText = T.stayAdvice(city);   // 变量保留（其余位置可能引用），仅不再在 guide 展示
    goText = T.goAdvice(city);
  }

  /* ---- 头部元信息（对齐网页 banner） ---- */
  const chips = [];
  const dep = String(plan.depart || "").split("-").map(Number);
  if (dep.length === 3) {
   const d0 = new Date(dep[0], dep[1] - 1, dep[2]);
   const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d0.getDay()];
   const end = new Date(d0); end.setDate(end.getDate() + plan.days.length - 1);
   const dstr = s => (s.getMonth() + 1) + "月" + s.getDate() + "日";
   chips.push(dstr(d0) + "（" + wd + "）— " + dstr(end));
  }
  if (segs) {
   chips.unshift(segs.map(s => s.cityName + s.days + "天").join(" → ") + " · 共 " + plan.days.length + " 天");
  } else {
   if (plan.isProv) chips.unshift("全省精华游 · " + plan.cityName);
  }
  if (plan.travelMode && MODE_LABEL[plan.travelMode]) chips.push(MODE_LABEL[plan.travelMode]);
  if (plan.customAmt > 0) chips.push("自定义总预算 ¥" + plan.customAmt);
  else if (plan.budget) chips.push(T.budgetLabel(plan.budget));

  const bo = T.budgetTotalObj(plan);
  let budgetLine = "";
  if (bo) {
   budgetLine = "花费：人均 ¥" + bo.daily + "/天 × " + bo.people + "人 × " + bo.days + "天 = ¥" + bo.totalBudget +
    "（住宿 " + bo.hotel + " · 餐饮 " + bo.food + " · " + bo.note + "）";
  }
  // 想玩命中提示
  const wish = T.getWish().filter(x => !x.city || x.city === plan.cityName || (segs && segs.some(s => s.cityName === x.city)));
  const arranged = new Set((plan.days || []).reduce((a, d) => a.concat((d.items || []).map(i => i.name)), []));
  const hit = wish.filter(x => arranged.has(x.name)).map(x => x.name);
  const miss = wish.filter(x => !arranged.has(x.name)).map(x => x.name);

  const summaryText = segs ? segs.map(s => s.cityName).join(" → ") + " · " + plan.days.length + "天" + (plan.days.length - 1) + "晚"
   : (dispCity + " · " + plan.days.length + "天" + (plan.days.length - 1) + "晚" + (plan.isProv ? " · 全省精华游" : ""));
  // v1.9：构成统计文案（山水×N · 人文×N …）
  let mixTxt = "";
  try {
   const mx = T.mixStat(plan);
   if (mx.length && !plan.isProv) mixTxt = mx.map(r => r.cat + "×" + r.n).join(" · ");
  } catch (e) {}
  // v1.9：最佳季节徽章
  if (!segs && !plan.isProv && plan.depart) {
   try {
    const sh = T.bestSeasonHit(dispCity, String(plan.depart));
    if (sh && sh.hit) chips.push("正值" + (String(plan.depart).slice(5, 7) | 0) + "月最佳季");
   } catch (e) {}
  }

  // 方案序号跟随本次行程重置（页面实例可能被复用）
  const paces = ["leisure", "balance", "speed"];
  const paceIdx = paces.indexOf(plan.pace);
  const altIdx = paceIdx >= 0 ? paceIdx : 1;

  const ov = T.tripOverview(plan);
  // v1.8.5 C5：顶部天数导航（主题 + 分段城市 + 今日角标）
  const topDays = plan.days.map((d, di) => ({
   i: di, n: di + 1,
   theme: String(d.theme || "").slice(0, 6),
   seg: segs ? segs[segByDay[di]].cityName : "",
   today: String(d.date || "") === ymdLocal()
  }));
  this.setData({
   view,
   summary: summaryText,
   // v1.19.146：精简 stats —— 标题已含「N天M晚」、foot 已含景点总数，
   // 只留 城数·日均·节奏（逻辑抽到 T.tripStatsText，可单测）
   stats: T.tripStatsText(ov, spots),
   // v1.11：体检卡标题文案预计算（WXML 里原本是两层嵌套三元）
   tripCheck: (() => {
    const c = this._checkMerge(plan);
    if (!c) return null;
    const n = Array.isArray(c.items) ? c.items.length : 0;
    return Object.assign({}, c, { lvTx: c.level === "ok" ? "一切正常" : (c.level === "warn" ? "有 " + n + " 条待处理" : "还能更好") });
   })(),
   overview: ov,
   segs,
   sampleTip: !!plan.isSample, // 2026-11-09（#482）：示例行程标识
   metaChips: chips, budgetLine, mixTxt,
   modeTxt: plan.travelMode ? MODE_LABEL[plan.travelMode] || "" : "",
   pickTxt: plan.pickOnly ? "本次按「只玩勾选」生成 · 未勾选的推荐已跳过" : "",
   clothText, stayText, goText,
   open: -1, detailText: "", detailName: "", detailTags: [], timing: null, routeOpen: -1, offlineHow: "",
   altIdx,
   isProv: !!plan.isProv,
   // 有限数据层城市（limited）：诚实提示内容收集中，已生成抵达/返程框架，真实景点待补充
   limitedNotice: !!(city && city.limited && !plan.isProv),
   // v1.20.19：旧版本用未解码的城市名生成过 generic 假城行程，存档被 app.js 打标后
   // 在这里给诚实提示（不静默删用户已有打卡/花费），并提供重生成入口。
   staleCity: !!plan.__staleCity,
   gauge: T.budgetGauge(plan),
   foot: T.tripFoot(plan),
   // v1.17.10：省域行程用「省级速览」（按全省真实景点数算建议天数、必吃取具体菜名）；
   // 旧实现一律 cityBrief(plan.cityName)，而省名会被 findCity 兜成 generic 城 → 建议 2 天 + 泛化必吃
   brief: segs ? null : (plan.isProv ? T.provBrief(plan.province) : T.cityBrief(dispCity)),
   // v1.19.145：酒店门户（单城行程才有具体城市的比价搜索词；多城/全省不展示）
   hotelPortals: (!segs && !plan.isProv && plan.cityName) ? T.hotelPortals(plan.cityName, plan) : [],
   countdown: T.tripCountdown(plan),
   isFav: (segs || plan.isProv) ? false : T.isFaved(plan.cityName), favReady: true,
   wishAll: wish.length, wishPlan: hit.map(n => ({ name: n, on: true })), wishMiss: miss.map(n => ({ name: n, on: false })),
   // v1.8.4 A1/B17：人流提示 + 城市经验
   hints: T.dateHintsForPlan(plan).map(h => Object.assign({}, h, { dateTx: String(h.date || "").slice(5) })),
   cityNote: (segs || plan.isProv) ? null : T.getCityNote(plan.cityName),
   cnOpen: false,
   cnToggleTx: ((segs || plan.isProv) ? null : T.getCityNote(plan.cityName)) ? "编辑 ▾" : "去打分 ▾",
   topDays,
   // v1.19.188：攻略自评分（算法 v1.19.177）落地 UI —— 把 plan.evaluation 透传视图，
   // 并把中文 grade 映射成安全英文 class（WXSS 中文 class 选择器不稳），缺评则整体收起。
   evaluation: (() => {
    const ev = plan && plan.evaluation;
    if (!ev) return null;
    const gmap = { "优秀": "excellent", "良好": "good", "尚可": "fair", "待优化": "weak", "—": "na" };
    return Object.assign({}, ev, { gcls: gmap[ev.grade] || "na" });
   })()
  });
  this._maybeLoadWx(plan);
  this._loadDeep(plan);
 },

  _renderShow() {
   // v1.20.3：消费首页磁贴的定位意图（酒店/百科/天气），在任何分支前先读并清除，避免空行程回首页后残留再误触发
   this._applyFocus();
   try { this._theme(); } catch (e) {}
   try {
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) {
     // 2026-11-17：改成「空态卡片 + CTA」，不再 toast + 1.2 秒后自动 switchTab。
     // 原实现（v1.19.2 起）虽然写了原因，但用户先看到的是 1.2 秒空壳页面
     // （hasPlan 当时只控制底部保存条，summary/chips/日卡照样用空数据渲染），
     // 深色底上就是「黑屏」，接着又被弹走 —— 观感像页面坏了。
     // 现在与 today / map 两页统一：留下可读的空态，跳不跳由用户点。
     this.setData({ hasPlan: false });
     return;
    }
    if (!this.data.hasPlan) this.setData({ hasPlan: true });
    // v1.19.179：回显「已保存」状态（按 城市/天数/首日均 签名匹配本地行程存档库）
    try {
      const sig = this._planSig(plan);
      const hit = (T.listSavedPlans() || []).find(p => p && p.sig === sig);
      if (hit) { if (this.data.savedId !== hit.id) this.setData({ savedId: hit.id, savedAt: hit.ts || 0 }); }
      else if (this.data.savedId) this.setData({ savedId: "", savedAt: 0 });
    } catch (e) {}
    this.__animOn = true;   // v1.19.77：进页才放错落入场动效
    this._render(plan);
    this._checkDueRemind();
    // v1.19.88：后台惰性生成 5:4 转发卡片图（延后 900ms 不抢首屏；供 onShareAppMessage.imageUrl）
    setTimeout(() => { try { this._ensureShareCard(); } catch (e) {} }, 900);
   } catch (e) {
    wx.showToast({ title: "行程加载异常，请重试", icon: "none" });
   }
  },

 /* ---- 按想玩重新生成（只玩勾选 / 保持默认两档，对齐网页 pickOnly） ---- */
 rebuild(e) {
  const plan = app.globalData.plan;
  if (!plan) return;
  if (plan.segments) { wx.showToast({ title: "多站行程暂不支持想玩重排（按站浏览地图/美食）", icon: "none" }); return; }
  if (plan.isProv) { wx.showToast({ title: "全省游按省内地标自动编排，暂不支持想玩重排", icon: "none" }); return; }
  const only = e.currentTarget.dataset.only === "1";
  const picks = T.getWish().filter(x => !x.city || x.city === plan.cityName).map(x => x.name);
  if (only && !picks.length) { wx.showToast({ title: "还没有勾选想玩的景点", icon: "none" }); return; }
  wx.showLoading({ title: "重新生成中…", mask: true });
  try {
   const daysArr = T.buildPlan({
    city: { name: plan.cityName, province: plan.province || "" },
    days: plan.days.length,
    depart: plan.depart,
    budget: plan.budget,
    pace: plan.pace,
    travelMode: plan.travelMode,
    people: plan.people,
    stayMountain: plan.stayMountain !== false,
    picks, pickOnly: only
   });
   app.setPlan({ ...plan, days: daysArr, totalDays: daysArr.length, pickOnly: only, savedAt: Date.now() });
   wx.hideLoading();
   this._render(app.globalData.plan);
   wx.pageScrollTo ? wx.pageScrollTo({ scrollTop: 0, duration: 200 }) : null;
   } catch (err) {
    wx.hideLoading();
   wx.showToast({ title: "生成失败，试试清空想玩清单", icon: "none" });
  }
 },

 // v1.19.78：深度玩法 —— 从「主城 + 各站」里挑第一座有内容的城市，展示 3 条速览
 // 设计原则：内容是增强项，加载失败 / 城市未收录都静默降级为不显示，绝不阻塞行程本身
 _planCities(plan) {
  const out = [];
  const push = (v) => {
   const s = String(v == null ? "" : v).trim();
   if (s && out.indexOf(s) < 0) out.push(s);
  };
  try { push(plan.cityName); } catch (e) {}
  try {
   const ss = plan.segments || [];
   for (let i = 0; i < ss.length; i++) push(ss[i].city || ss[i].cityName || ss[i].name);
  } catch (e) {}
  return out;
 },

 // 行程指纹：用于丢弃「已切走」的异步结果（城市/天数/首日/站点串）
 _planSig(plan) {
  try {
   const days = (plan && plan.days) || [];
   const d0 = (days[0] && days[0].date) || "";
   return String((plan && plan.cityName) || "") + "|" + days.length + "|" + String(d0).slice(0, 10) + "|" + this._planCities(plan).join(",");
  } catch (e) { return ""; }
 },

 /* ---- 手动调整 ---- */
 _firstReal(di) {
  const plan = app.globalData.plan;
  return (plan.days[di].items || []).findIndex(it => !isFrame(it.name));
 },

 // 复用 onJumpDay 的滚动算法（createSelectorQuery 在微信端和网页端 shim 下语义一致）
 _scrollTo(sel) {
  const q = wx.createSelectorQuery().in(this);
  q.select(sel).boundingClientRect();
  q.selectViewport().scrollOffset();
  q.exec(res => {
    const r = res && res[0], v = res && res[1];
    if (!r) return;
    const top = (v && v.scrollTop || 0) + r.top - 110;
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 300 });
  });
 },

 // v1.20.3：首页磁贴「酒店/百科/天气」直达后自动定位到行程页对应区块。
 // 用「存储意图」而非 query（runtime.cleanUrl 会吞掉 ?focus=x，且不想污染共享路由解析）。
 // 读后即清除，避免来回切 tab 重复触发。
 _applyFocus() {
  let f = "";
  try { f = (S.get("miniFocusV1", "") || "").toString().trim(); } catch (e) {}
  if (!f) return;
  try { S.set("miniFocusV1", ""); } catch (e) {}   // 消费即清除
  const self = this;
  // 等 WXML 把新数据画完再滚动/展开，避免节点还没生成就 scrollTo 失效
  setTimeout(() => {
    try {
      if (f === "hotel") {
        self._scrollTo(".bf-hotel, .hotelPortals");
      } else if (f === "weather") {
        self._scrollTo(".wx-card, .wx-off");
      } else if (f === "baike") {
        // 百科是逐景点详情面板：打开首日第一条真实景点的详情，并滚到当天
        const plan = app.globalData && app.globalData.plan;
        let di = 0, ix = -1;
        if (plan && plan.days && plan.days[0] && plan.days[0].items) {
          for (let k = 0; k < plan.days[0].items.length; k++) {
            if (!isFrame(plan.days[0].items[k].name)) { ix = k; break; }
          }
        }
        if (ix >= 0) { try { self.onToggle({ currentTarget: { dataset: { di: 0, ix: ix } } }); } catch (_) {} }
        self._scrollTo("#d0");
      }
    } catch (e) {}
  }, 360);
 },

 // v1.8.5 C5：点击顶部天条 → 滚动到对应天卡（sticky 天条不遮内容）
 onJumpDay(e) {
  const i = Number(e.currentTarget.dataset.i);
  if (isNaN(i)) return;
  this.setData({ dsActive: i });
  const q = wx.createSelectorQuery().in(this);
  q.select("#d" + i).boundingClientRect();
  q.selectViewport().scrollOffset();
  q.exec(res => {
   const r = res && res[0], v = res && res[1];
   if (!r) return;
   const top = (v && v.scrollTop || 0) + r.top - 130;
   wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 260 });
  });
 },

 onPhotoCredit(e) {
  const d = e.currentTarget.dataset || {};
  wx.showModal({
    title: "照片来源",
    content: "摄影/作者：" + (d.credit || "Wikimedia Commons") +
      "\n许可：" + (d.license || "CC") +
      "\n图源：Wikimedia Commons（云存储托管）",
    showCancel: false,
    confirmText: "知道了"
  });
 },

 /* ---- 真实照片：加载失败兜底回退示意图 / 署名 ---- */
 onImgError(e) {
  const d = e.currentTarget.dataset || {};
  const di = Number(d.di), i = Number(d.i);
  if (!isFinite(di) || !isFinite(i)) return;
  const patch = {};
  patch["view[" + di + "].items[" + i + "].img"] = "";
  try { this.setData(patch); } catch (err) {}
 },

 /* ---- v1.19.135：已打卡景点写个人评价（方便下次选择） ---- */
 onFootNote(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const it = plan.days[di].items[ix];
  if (!it || isFrame(it.name)) return;
  const cityName = T.segCityOfDay(plan, di) || plan.cityName || "";
  // 评价依附于足迹：未打卡先打卡，保证 city 与时间齐全
  if (!T.isVisited(it.name)) T.markVisited(it.name, cityName, true);
  const cur = T.getFootNote(it.name) || "";
  wx.showModal({
   title: "对「" + (T.cleanSpotName(it.name) || it.name) + "」的评价",
   editable: true,
   placeholderText: "比如：二刷必去，夜景绝了",
   content: cur,
   confirmText: cur ? "保存" : "记下",
   success: (r) => {
    if (!r || !r.confirm) return;
    const v = (r.content || "").trim();
    T.setFootNote(it.name, v);
    wx.showToast({ title: v ? "已保存评价" : "已清除评价", icon: "none" });
    this._render(plan);
   }
  });
 },

 /* ---- v1.15：复制行程体检摘要 ---- */
 onHealthCopy() {
  const plan = app.globalData.plan;
  const h = T.tripHealth(plan);
  if (!h || !h.text) { wx.showToast({ title: "暂无可复制内容", icon: "none" }); return; }
  wx.setClipboardData({
   data: h.text,
   success: () => wx.showToast({ title: "已复制出行前体检摘要", icon: "none" })
  });
 },

 // v1.7：展开/收起当天交通建议
 onRoute(e) {
  const di = Number(e.currentTarget.dataset.di);
  this.setData({ routeOpen: this.data.routeOpen === di ? -1 : di });
 },

 // 当天卡片「地图」→ 跳到地图页并定位到该天（多站行程由地图页按 di 归属段城市）
 jumpMap(e) {
  const di = Number(e.currentTarget.dataset.di);
  if (Number.isNaN(di) || di < 0) return;
  wx.navigateTo({ url: "/subpkg/map/map?di=" + di });
 },

 // v1.8.5 C1/C2/C4：行程体检融合（门票预估 / 天数偏长 / 预算体检 → 并入既有 check 卡，避免新增卡片）
 _checkMerge(plan) {
  const base = T.tripCheck(plan);
  const ins = [];
  const ts = T.ticketSumOf(plan);
  if (ts && ts.n > 0) ins.push({ t: "门票", x: ts.n + " 个景点按挂牌价 ¥" + ts.fee + "，旺季与园内交通会浮动，以预约页为准", lv: "info" });
  const single = !plan.segments || plan.segments.length <= 1;
  if (single) {
   const lh = T.cityLongHint(plan);
   if (lh) {
    const cands = (lh.next || []).map(x => x.name).join("、");
    ins.push({
     t: "这座城建议 " + lh.rec + " 天，你排了 " + lh.n + " 天",
     x: "时间富余是好事，但同城连玩会重样" + (cands ? "，更丰富可以顺路加 " + cands : "") + "；想紧凑可在「出发」页重生成",
     lv: lh.over >= 3 ? "warn" : "info"
    });
   }
  }
  const bc = T.budgetCheckOf(plan);
  if (bc && bc.lv !== "fit" && bc.lv !== "na") ins.push({ t: "预算体检", x: bc.txt, lv: bc.lv === "tight" ? "warn" : "info" });
  // v1.9：周一闭馆 / 需预约 / 返程预留（并入体检，不加新卡）
  try {
   const mc = T.mondayClashOf(plan);
   if (mc.length) {
    const names = mc.slice(0, 3).map(m => m.name).join("、");
    ins.push({ t: "碰上周一闭馆", x: names + (mc.length > 3 ? " 等" : "") + " 多在周一闭馆，建议把这一天让给街巷或调个顺序", lv: "warn" });
   }
  } catch (e) {}
  try {
   const br = T.bookRemindOf(plan);
   if (br.length) {
    const one = br[0];
    ins.push({ t: "热门场馆需预约", x: (br.length > 1 ? one.name + " 等 " + br.length + " 处" : one.name) + "：" + one.adv, lv: "info" });
   }
  } catch (e) {}
  if (single) {
   try {
    const et = T.endTripTip(plan);
    if (et) ins.push({ t: "返程留足余量", x: et.txt, lv: "info" });
   } catch (e) {}
  }
  if (!base) return ins.length ? { level: ins.some(x => x.lv === "warn") ? "warn" : "info", needSlim: false, items: ins.slice(0, 7) } : null;
  if (base.level === "ok" && ins.length) {
   // 去掉「没什么可挑」占位，换成真实洞察
   return { level: ins.some(x => x.lv === "warn") ? "warn" : "info", needSlim: base.needSlim, items: ins.slice(0, 7) };
  }
  const items = base.items.concat(ins).slice(0, 7);
  const hasWarn = items.some(x => x.lv === "warn");
  return { level: hasWarn ? "warn" : base.level, needSlim: base.needSlim, items: items };
 },
};
