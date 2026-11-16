// pages/plan/p-edit.js —— 行程手动调整（拖拽/换景点/移到其他天/增删天/想玩标记）（从 plan.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./plan-ctx.js");
const { app, T, S, A, W, EL, Cloud, AIAgent, AN, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

module.exports = {
 /* ---- 详情 ---- */
 onToggle(e) {
  if (this._suppressTap) return;   // v1.19.77：刚拖完排序，别顺手把详情展开了
  const di = Number(e.currentTarget.dataset.di);
  const ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const it = plan.days[di].items[ix];
  if (!it || isFrame(it.name)) return;
  if (this.data.open === ix + di * 100) { this.setData({ open: -1, detailText: "", detailName: "", timing: null, offlineHow: "" }); return; }
  // 多站行程：详情按当天归属城市取（否则整串「北京 → 西安」查不到介绍）
  const city = T.segCityOfDay(plan, di) || plan.cityName;
  // v1.15：详情展示景点标签，点标签可换一个同标签的当地景点
  const detailTags = it.custom ? [] : T.spotTagOf(it.name, city);
  // v1.16：地图 POI 返回的真实开放时间/评分/人均/地址（没有就不显示，不编造）
  const infoTx = it.custom ? "" : (T.spotInfoText(it.name) || "");
  const timing = it.custom ? null : T.spotTiming(it.name);
  // 离线百科（SPOT_DETAILS）：spotDetailText 没有时，用离线简介兜底，避免大量经典景点只剩「点百科看更多」
  const lookup = it.custom ? null : T.spotLookup(it.name, city);
  // 自己加的点（库里没有）不编百科式介绍，避免「随便输一个也有介绍」的假内容
  let txt, offlineHow = "", hasRealDetail = true;
  if (it.custom) {
    txt = "这是你自己加的点，暂未收录介绍。点「百科」可搜索，或换成本市经典景点。";
  } else {
    const base = T.spotDetailText(it.name, city);
    if (base) txt = base;
    else if (lookup && lookup.intro) { txt = lookup.intro; offlineHow = lookup.how || ""; }
    else {
      // v1.20.1：没文字简介时别只甩一句「暂无介绍」——展开面板里其实还有标签、
      // 最佳时段、评分/人均，把它们点出来，用户才知道下一步能做什么。
      const bits = [];
      if (detailTags.length) bits.push("已收录标签 " + detailTags.slice(0, 3).join(" / "));
      if (timing && timing.best) bits.push("建议 " + timing.best + " 去");
      txt = bits.length
        ? "这个点还没收录文字简介，先给你已有的实用信息：" + bits.join("；") + "。点「百科」可搜索更多，或点标签换同类景点。"
        : "这个点还没收录文字简介。点「百科」可搜索更多，也可以点「换一个」换成同市经典景点。";
      hasRealDetail = false;
    }
  }
  this.setData({
    open: ix + di * 100, detailText: txt, detailName: it.name, detailTags,
    infoTx, showInfo: !!infoTx, hasRealDetail, timing, offlineHow
  });
 },

 /* ---- 导航 / 百科 / 想玩 ---- */
 onNav(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items || !plan.days[di].items[ix]) {
   wx.showToast({ title: "这条没有定位信息", icon: "none" }); return;
  }
  const n = T.cleanSpotName(plan.days[di].items[ix].name);
  const t = T.navTarget(n, T.segCityOfDay(plan, di) || plan.cityName);
  if (!t) { wx.showToast({ title: "框架安排无需导航", icon: "none" }); return; }
  if (t.type === "coord") wx.openLocation({ latitude: t.lat, longitude: t.lon, name: t.name, scale: 16 });
  else if (t.type === "city") {
   // v1.14：城锚兜底 —— 真实城市中心坐标，打开地图后用户在地图内搜该景点定位
   wx.showModal({
    title: "定位到" + (t.city || "") + "？",
    content: "「" + t.name + "」暂无精确收录点。将打开「" + (t.city || "") + "」地图（市中心），你在地图里直接搜景点名即可导航到达。",
    confirmText: "打开地图",
    success: (r) => { if (r.confirm) wx.openLocation({ latitude: t.lat, longitude: t.lon, name: t.city || t.name, address: t.name + "（打开后请在地图内搜索该景点）", scale: 13 }); }
   });
  }
  else wx.showModal({
   title: t.name,
   content: "暂未收录该点的定位信息。到当地后打开「更多 → 地图导引」定位当天行程，或打车/问路到「" + t.keyword + "」即可到达。",
   showCancel: false,
   confirmText: "知道了"
  });
 },

 onWish(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items || !plan.days[di].items[ix]) return;
  const it = plan.days[di].items[ix];
  // 命中已有想玩（含合并条目/别名）→ 逐条取消；否则以条目原样加入
  const hits = T.wishHitsOf(it.name);
  if (hits.length) {
   hits.forEach(h => T.toggleWish(h.name, ""));
   wx.showToast({ title: "已取消想玩", icon: "none" });
  } else {
   // 存清洗名（去掉「深度游览…」等前缀/时长括号），与景点池名字精确匹配，重排才能命中
   const nm = T.cleanSpotName(it.name) || it.name;
   if (!T.isWished(nm)) T.toggleWish(nm, T.segCityOfDay(plan, di) || plan.cityName);
   wx.showToast({ title: "已加入想玩（重新生成时优先）", icon: "none" });
  }
  this._render(plan);
 },

 /* ---- 足迹打卡：标记/取消「已去过」，点亮城市（more 页可看统计） ---- */
 onVisited(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const it = plan.days[di].items[ix];
  if (!it || isFrame(it.name)) return;  // 抵达/出发等框架条目不打卡（原 it.f 取的是渲染字段，原始 item 上不存在 → 拦截失效）
  const cityName = T.segCityOfDay(plan, di) || plan.cityName || "";
  const on = !T.isVisited(it.name);
  const st = T.markVisited(it.name, cityName, on);
  wx.showToast({ title: on ? "已打卡 · 点亮 " + cityName : "已取消打卡", icon: "none" });
  this._render(plan);
 },

 /* ---- 想玩面板：移除某条未排上的想玩（点 ）---- */
 removeWish(e) {
  const n = e.currentTarget.dataset.name;
  const plan = app.globalData.plan;
  if (!n) return;
  T.toggleWish(n, plan && plan.cityName);
  wx.showToast({ title: "已移出想玩", icon: "none" });
  if (plan) this._render(plan); // 防御：plan 未加载时不渲染，避免空引用（生产环境 plan 必存在）
},

 toggleWish() { this.setData({ wishOpen: !this.data.wishOpen }); },

 /* ---- 收藏目的地 ---- */
 onFav() {
  const plan = app.globalData.plan;
  if (!plan) return;
  if (plan.isProv) { wx.showToast({ title: "全省游暂不支持收藏，试试收藏具体城市", icon: "none" }); return; }
  const list = T.toggleFav(plan.cityName);
  this.setData({ isFav: T.isFaved(plan.cityName) });
  wx.showToast({ title: T.isFaved(plan.cityName) ? "已收藏" : "已取消收藏", icon: "none" });
 },

 /* ---- 复制全文 / 结束行程 ---- */
 onCopy() {
  const plan = app.globalData.plan;
  const txt = T.copyPlanText(plan);
  if (!txt) { wx.showToast({ title: "暂无内容可复制", icon: "none" }); return; }
  wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: "已复制完整攻略", icon: "success" }) });
 },

 // v1.19.145：复制酒店比价搜索词到剪贴板（个人主体不内嵌预订，引导去平台 App 比价）
 copyPortal(e) {
  const t = e.currentTarget.dataset.term;
  const p = e.currentTarget.dataset.platform;
  if (!t) return;
  wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制，去" + p + "比价", icon: "none" }) });
 },

 // v1.19 P0-3：行程体检默认收起（只留标题+风险等级，点开看明细）
 toggleCheck() { this.setData({ checkOpen: !this.data.checkOpen }); },

 toggleBrief() { this.setData({ briefOpen: !this.data.briefOpen }); },

 // v1.18：天气卡 / 想玩未排上列表默认收起，点击标题展开
 toggleWx() { this.setData({ wxOpen: !this.data.wxOpen }); },

 // 2026-11-09（#482）：示例行程 → 回「出发」页生成自己的
 onLeaveSample() { try { wx.switchTab({ url: "/pages/index/index" }); } catch (e) {} },

 _save() {
  const plan = app.globalData.plan;
  app.setPlan({ ...plan, days: plan.days });
  this._render(plan);
 },

 /* ---- P2：方案切换（leisure / balance / speed 循环）---- */
 onSwitchAlt() {
  const plan = app.globalData.plan;
  if (!plan) return;
  if (plan.isProv) { wx.showToast({ title: "全省游按城市顺序自动编排，暂不支持换方案", icon: "none" }); return; }
  if (plan.segments) { wx.showToast({ title: "多站行程暂不支持方案切换", icon: "none" }); return; }
  const idx = (this.data.altIdx + 1) % 3;
  const pace = this.data.altPaces[idx];
  const city = T.findCity(plan.cityName, plan.province);
  // 换方案时仍保留「想玩优先」的勾选集合，但不再强制只玩（用户可再用想玩面板重排）
  const picks = T.getWish().filter(x => !x.city || x.city === plan.cityName).map(x => x.name);
  try {
   const daysArr = T.buildPlan({
    city,
    days: plan.days.length,
    depart: plan.depart,
    budget: plan.budget,
    pace,
    travelMode: plan.travelMode,
    people: plan.people,
    stayMountain: plan.stayMountain !== false,
    picks,
    pickOnly: false
   });
   // v1.19.2：换方案前若用户开着「只玩勾选」，rebuild 仍会按 picks 生成，
     // 这里不再把 pickOnly 静默改成 false（否则勾选偏好被无提示清掉，与 rebuild 行为也不一致）
   app.setPlan({ ...plan, days: daysArr, pace, altIdx: idx, pickOnly: plan.pickOnly !== false });
   this.setData({ altIdx: idx });
   this._render(app.globalData.plan);
   wx.pageScrollTo ? wx.pageScrollTo({ scrollTop: 0, duration: 200 }) : null;
   wx.showToast({ title: "已切换 · " + this.data.altNames[idx], icon: "none" });
   } catch (e) {
    wx.showToast({ title: "切换失败", icon: "none" });
  }
 },

 closeSwap() { this.setData({ swapOpen: false, swapDi: -1, swapIx: -1, swapList: [], swapWish: [] }); },

 /* ---- 2026-11-09：换一个景点改为「弹面板选择」——本城候选 / 我的想玩收藏 / 随机 ---- */
 onSwap(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const it = plan.days[di].items[ix];
  if (!it || isFrame(it.name)) { wx.showToast({ title: "这条换不了（抵达/返程等框架安排）", icon: "none" }); return; }
  const cands = T.swapCandidates(plan, di, ix) || [];
  const curKey = T.cleanSpotName(String(it.name || ""));
  // 我的想玩/收藏：排除本行程已排过的与当前点，避免换出重复景点
  const used = {};
  (plan.days || []).forEach(d => (d.items || []).forEach(x => { const k = T.cleanSpotName(x && x.name); if (k) used[k] = 1; }));
  let wish = [];
  try {
   // 2026-11-09：只换「当天这座城」的想玩/收藏，避免把外城景点塞进当天（地理一致性）
   const dayCity = (T.segCityOfDay ? T.segCityOfDay(plan, di) : "") || plan.cityName || "";
   wish = (T.getWish() || [])
    .filter(w => {
     const wc = String((w && w.city) || "");
     return !wc || !dayCity || wc === dayCity; // 老数据无 city 的保留（无法判定，别一刀切隐藏）
    })
    .map(w => String((w && w.name) || "").trim())
    .filter(n => n && T.cleanSpotName(n) !== curKey && !used[T.cleanSpotName(n)]);
  } catch (err) { wish = []; }
  this.setData({
   swapOpen: true, swapDi: di, swapIx: ix,
   swapCur: curKey || String(it.name || ""),
   swapList: cands.slice(0, 80),
   swapWish: Array.from(new Set(wish)).slice(0, 80)
  });
 },

 onSwapRandom() {
  const list = this.data.swapList || [];
  if (!list.length) { wx.showToast({ title: "本城没有更多可换景点", icon: "none" }); return; }
  this._applySwap(list[Math.floor(Math.random() * list.length)]);
 },

 onSwapPick(e) {
  const name = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || "");
  if (name) this._applySwap(name);
 },

 /* ---- v1.15：详情里点标签 → 换一个同标签的当地景点 ---- */
 onTagSwap(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const tag = String(e.currentTarget.dataset.tag || "");
  const plan = app.globalData.plan;
  if (!plan || !plan.days[di] || !tag) return;
  const r = T.swapSpotByTag(plan, di, ix, tag);
  if (!r) { wx.showToast({ title: "这座城没有更多「" + tag + "」类景点啦", icon: "none" }); return; }
  this.setData({ open: -1, detailText: "", detailName: "", detailTags: [] });
  this._save();
  wx.showToast({ title: "已换成同类「" + r.name + "」", icon: "none", duration: 1600 });
 },

 /* ---- v1.6：彻底删掉这一条（区别于「变自由活动」） ---- */
 onDelSpot(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days[di]) return;
  const r = T.dayRemoveSpot(plan, di, ix);
  if (!r) { wx.showToast({ title: "这条删不掉（抵达/返程等框架安排）", icon: "none" }); return; }
  this.setData({ open: -1, detailText: "", detailName: "" });
  this._save();
  wx.showToast({ title: "已删掉「" + r.name + "」· 当天还剩 " + r.left + " 个点", icon: "none", duration: 1800 });
 },

 onDel(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData && app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const items = plan.days[di].items;
  const it = items[ix];
  if (!it) return;
  if (/自由活动|留白/.test(it.name)) { wx.showToast({ title: "这一条已经是自由活动了", icon: "none" }); return; }
  // v1.15.1：一天只允许一个「留白」，且不与其他自由活动撞同一时段（避免下午一个、晚上一个或两个晚上）
  const isBlank = n => /自由活动|留白/.test(String(n || ""));
  const hadBlank = items.some(x => isBlank(x && x.name));
  if (hadBlank) {
    items.splice(ix, 1);   // 已有留白 → 直接删掉，不再生成第二个
  } else {
    const taken = items.filter((x, i) => i !== ix && String(x.period || "") === String(it.period || "")).length;
    let period = it.period;
    if (taken > 0) {
      const free = ["上午", "下午", "晚上"].find(p => !items.some((x, i) => i !== ix && String(x.period || "") === p));
      period = free || it.period;
    }
    items[ix] = { name: "自由活动 · 第" + (di + 1) + "天留白", period: period, note: "已移除原安排，这段时间自由支配" };
  }
  try { T.normalizeDayItems(items); } catch (e) {} // 移除后行文归一：防止「继续深度游览」等前缀悬在段首
  this._save();
 },

 onMove(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const dir = Number(e.currentTarget.dataset.dir);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const items = plan.days[di].items;
  const it = items[ix];
  if (!it || isFrame(it.name)) return;  // 抵达/返程等框架不可调序
  let j = ix + dir;
  if (j < 0 || j >= items.length) return;
  while (j >= 0 && j < items.length && isFrame(items[j].name)) j += dir;
  if (j < 0 || j >= items.length) { wx.showToast({ title: "抵达/返程等框架不能调序", icon: "none" }); return; }
  const a = items[ix], b = items[j];
  const p = a.period; a.period = b.period; b.period = p;
  const t = items[ix]; items[ix] = items[j]; items[j] = t;
  const ord = q => (T.D.PERIOD_ORDER && T.D.PERIOD_ORDER[q.period] != null ? T.D.PERIOD_ORDER[q.period] : 99);
  items.sort((x, y) => ord(x) - ord(y));
  T.normalizeDayItems(items); // 行文归一：按新顺序重写「深度/继续/抵达」前缀，避免病句
  this._save();
 },

 closeMove() { this.setData({ moveOpen: false, moveDi: -1, moveIx: -1, moveDays: [] }); },

 /* ---- 2026-11-09：把这个点移到别的天（第2天 → 第3天） ---- */
 onMoveTo(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const it = plan.days[di].items[ix];
  if (!it || isFrame(it.name)) { wx.showToast({ title: "这条移不了（抵达/返程等框架安排）", icon: "none" }); return; }
  if ((plan.days || []).length < 2) { wx.showToast({ title: "只有一天，没法移动", icon: "none" }); return; }
  const moveDays = [];
  plan.days.forEach((d, i) => {
   if (i === di) return;
   moveDays.push({ i: i, label: "第" + (i + 1) + "天" + (d && d.date ? " · " + String(d.date).slice(5) : "") });
  });
  this.setData({ moveOpen: true, moveDi: di, moveIx: ix, moveDays: moveDays });
 },

 onMovePick(e) {
  const to = Number(e.currentTarget.dataset.i);
  const plan = app.globalData.plan;
  const di = this.data.moveDi, ix = this.data.moveIx;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[to] || di === to) { this.closeMove(); return; }
  const src = plan.days[di], tgt = plan.days[to];
  const it = src.items && src.items[ix];
  if (!it) { this.closeMove(); return; }
  src.items.splice(ix, 1);
  const ords = ["上午", "下午", "晚上"];
  const used = {};
  try { (T.daySpots(tgt) || []).forEach(x => { const p = String((x && x.period) || ""); if (p) used[p] = 1; }); } catch (err) {}
  let period = ords.find(p => !used[p]) || "下午";
  const hasReturn = (tgt.items || []).some(x => /返程|前往/.test(String((x && x.name) || "")));
  if (hasReturn && period === "晚上") period = "下午";
  const newItem = Object.assign({}, it, { period: period });
  let at = -1;
  (tgt.items || []).forEach((x, i) => { if (!isFrame(x && x.name)) at = i; });
  if (at >= 0) tgt.items.splice(at + 1, 0, newItem); else tgt.items.push(newItem);
  try { T.normalizeDayItems(src.items); T.normalizeDayItems(tgt.items); } catch (err) {}
  const sync = d => { try { const n = T.daySpots(d).length; d.spotCount = n; d.pace = n <= 2 ? "轻松" : (n <= 3 ? "适中" : "紧凑"); } catch (err) {} };
  sync(src); sync(tgt);
  this.closeMove();
  this.setData({ open: -1, detailText: "", detailName: "" });
  this._save();
  wx.showToast({ title: "已把「" + (T.cleanSpotName(String(it.name || "")) || it.name) + "」移到第" + (to + 1) + "天", icon: "none", duration: 1800 });
 },

 /* ---- v1.6：一键减负 —— 把景点 ≥6 个的天删到 5 个（从最后一条开始删） ---- */
 onSlim() {
  const plan = app.globalData.plan;
  if (!plan || !plan.days) return;
  let n = 0;
  plan.days.forEach((d, di) => {
   let guard = 0;
   while (T.daySpots(d).length >= 6 && guard++ < 12) {
    let last = -1;
    (d.items || []).forEach((it, i) => { if (!T.isFrameName(it.name)) last = i; });
    if (last < 0) break;
    if (!T.dayRemoveSpot(plan, di, last)) break;
    n++;
   }
  });
  if (!n) { wx.showToast({ title: "没有排得太满的天", icon: "none" }); return; }
  this._save();
  wx.showToast({ title: "已减掉 " + n + " 个景点 · 节奏更舒服", icon: "none", duration: 2000 });
 },

 onDragStart(e) {
  try {
   const di = Number(e.currentTarget.dataset.di);
   const i = Number(e.currentTarget.dataset.i);
   const day = this.data.view[di];
   if (!day || !day.items || day.items.length < 2) return;
   if (day.items[i] && day.items[i].f) { wx.showToast({ title: "抵达 / 返程不能调序", icon: "none" }); return; }
   const q = wx.createSelectorQuery().in(this);
   q.selectAll(".dd" + di).boundingClientRect();
   q.exec(res => {
    try {
     let rects = (res && res[0]) || [];
     if (!Array.isArray(rects)) rects = [];
     rects = rects.filter(r => r && typeof r.top === "number");
     if (rects.length !== day.items.length) return;   // 量不准就干脆不开始，避免错位
     // 起点优先取 touchstart 的手指位置；拿不到就退化成「首次 move 时为 0」（差一帧，不影响）
     const y0 = (e.touches && e.touches[0] && typeof e.touches[0].clientY === "number") ? e.touches[0].clientY : 0;
     this._drag = { di, from: i, to: i, rects, started: !!y0, startY: y0, lastSh: "" };
     this.setData({ dragOn: true, dragDi: di, dragI: i, dragSh: rects.map(() => "") });
     try { wx.vibrateShort({ type: "light" }); } catch (_) {}
    } catch (err) { this._drag = null; this.setData({ dragOn: false, dragDi: -1, dragI: -1, dragSh: [] }); }
   });
  } catch (err) { this._drag = null; }
 },

 onDragMove(e) {
  const d = this._drag;
  if (!d) return;
  try {
   const t = e.touches && e.touches[0];
   if (!t || typeof t.clientY !== "number") return;
   const y = t.clientY;
   if (!d.started) { d.startY = y; d.started = true; }
   const dy = y - d.startY;
   const rects = d.rects, from = d.from, n = rects.length;
   const myMid = rects[from].top + (rects[from].height || 0) / 2;
   let to = from;
   for (let k = from + 1; k < n; k++) { if (myMid + dy > rects[k].top + (rects[k].height || 0) / 2) to = k; }
   if (to === from) { for (let k = from - 1; k >= 0; k--) { if (myMid + dy < rects[k].top + (rects[k].height || 0) / 2) to = k; } }
   d.to = to;
   const sh = [];
   for (let j = 0; j < n; j++) {
    let v = 0;
    if (j === from) v = dy;
    else if (to > from && j > from && j <= to) v = rects[j - 1].top - rects[j].top;
    else if (to < from && j >= to && j < from) v = rects[j + 1].top - rects[j].top;
    sh.push(v ? "transform:translateY(" + v.toFixed(1) + "px)" : "");
   }
   const key = sh.join("|");
   if (key !== d.lastSh) { d.lastSh = key; this.setData({ dragSh: sh }); }
  } catch (err) { this.onDragEnd(); }
 },

 onDragEnd() {
  const d = this._drag;
  this._drag = null;
  this.setData({ dragOn: false, dragDi: -1, dragI: -1, dragSh: [] });
  if (!d) return;
  this._suppressTap = true;
  setTimeout(() => { this._suppressTap = false; }, 400);
  const from = d.from, to = d.to, di = d.di;
  if (!d.started || to === from) return;
  try {
   const plan = app.globalData.plan;
   if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
   const items = plan.days[di].items;
   const n = items.length;
   if (from < 0 || to < 0 || from >= n || to >= n) return;
   if (isFrame(items[from].name) || isFrame(items[to].name)) { wx.showToast({ title: "抵达 / 返程不能调序", icon: "none" }); return; }
   const periods = items.map(x => x.period);          // 时段跟着坑位走
   const arr = items.slice();
   arr.splice(to, 0, arr.splice(from, 1)[0]);
   for (let k = 0; k < n; k++) { arr[k].period = periods[k]; items[k] = arr[k]; }
   try { T.normalizeDayItems(items); } catch (_) {}
   this._save();
   try { wx.vibrateShort({ type: "light" }); } catch (_) {}
   wx.showToast({ title: "已移到第 " + (to + 1) + " 位", icon: "none" });
  } catch (err) { wx.showToast({ title: "调序失败，展开后用 ↑↓ 也行", icon: "none" }); }
 },

 onEnd() {
  const plan = app.globalData.plan;
  if (!plan) return;
  wx.showModal({
   title: "结束这趟行程？",
   content: "将清空当前「" + plan.cityName + "」行程回到出发页；账单 / 想玩 / 待办会保留，可随时重新生成。",
   confirmText: "结束行程",
   confirmColor: "#d4a94e",
   success: (res) => {
    if (!res.confirm) return;
    app.clearPlan();
    wx.reLaunch({ url: "/pages/index/index" });
   }
  });
 },

 /* ---- v1.13：往这天随机加一个当地景点（不再让用户自己输/选） ---- */
 onDayAdd(e) {
  const di = Number(e.currentTarget.dataset.di);
  const plan = app.globalData.plan;
  if (!plan || !plan.days[di]) return;
  const cands = T.dayAddCandidates(plan, di, plan.bias || "");
  if (!cands.length) {
   wx.showToast({ title: "这座城的景点都排进来啦", icon: "none" });
   return;
  }
  // 从候选里随机挑一个（取前 8 个经典景点随机，兼顾质量与随机性）
  const pick = cands[Math.floor(Math.random() * Math.min(cands.length, 8))];
  const r = T.dayAddSpot(plan, di, pick);
  if (!r) return;
  this._save();
  wx.showToast({ title: "已加入 D" + (di + 1) + "：" + r.name, icon: "none", duration: 1800 });
 },

 // 复制当天安排为纯文本（发微信 / 记事本随手用）
 onDayCopy(e) {
  const di = Number(e.currentTarget.dataset.di);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di]) return;
  const d = plan.days[di];
  const segs = Array.isArray(plan.segments) ? plan.segments : null;
  let segName = "";
  if (segs && segs.length > 1) {
   for (let k = 0; k < segs.length; k++) {
    if (di >= segs[k].startDay && di <= segs[k].endDay) { segName = segs[k].cityName; break; }
   }
  }
  const fmt = s => { const p = String(s).split("-"); return p.length === 3 ? p[1] + "月" + p[2] + "日" : s; };
  const L = [];
  L.push("【D" + (di + 1) + " · " + fmt(d.date) + (d.theme ? " · " + d.theme : "") + (segName ? " · " + segName : "") + "】");
  (d.items || []).forEach(it => {
   const nm = String(it.name || "");
   const show = T.isFrameName(nm) ? nm : T.cleanSpotName(nm);
   L.push((it.period ? "[" + it.period + "] " : "") + show + (T.spotNoteDisp(it.note) ? "（" + T.spotNoteDisp(it.note) + "）" : ""));
  });
  wx.setClipboardData({
   data: L.join("\n"),
   success: () => wx.showToast({ title: "已复制第 " + (di + 1) + " 天安排", icon: "none" })
  });
 },

 // 真正执行替换：保留原条目的时段/结构，只换核心景点名（可来自本城候选或想玩收藏）
 _applySwap(name) {
  const plan = app.globalData.plan;
  const di = this.data.swapDi, ix = this.data.swapIx;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items || !name) { this.closeSwap(); return; }
  const it = plan.days[di].items[ix];
  if (!it) { this.closeSwap(); return; }
  const oldRaw = String(it.name || "");
  const curKey = T.cleanSpotName(oldRaw);
  const newName = (curKey && oldRaw.indexOf(curKey) >= 0) ? oldRaw.replace(curKey, name) : name;
  plan.days[di].items[ix] = Object.assign({}, it, { name: newName });
  try { T.normalizeDayItems(plan.days[di].items); } catch (err) {}
  this.closeSwap();
  this.setData({ open: -1, detailText: "", detailName: "" });
  this._save();
  wx.showToast({ title: "已换成「" + name + "」", icon: "none", duration: 1800 });
 },
};
