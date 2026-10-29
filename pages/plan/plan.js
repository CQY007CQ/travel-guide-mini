const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// plan：每日行程浏览 + 详情 + 导航/百科/想玩 + 手动调整 + 按想玩重新生成
const T = require("../../utils/travel.js");
const W = require("../../utils/weather.js");
const A = require("../../utils/aicontent.js");
const R = require("../../utils/remind.js");
const PP = require("../../utils/plan-poster.js");   // v1.19.109：分享海报/卡片绘制隔离到独立模块
const app = getAppSafe();

function isFrame(n) { return T.isFrameName(n); }
const MODE_LABEL = { family: "亲子游", couple: "情侣游", solo: "独行", elder: "带老人" };
function getSeason(month) {
 if (month >= 3 && month <= 5) return { name: "春", emoji: "" };
 if (month >= 6 && month <= 8) return { name: "夏", emoji: "" };
 if (month >= 9 && month <= 11) return { name: "秋", emoji: "" };
 return { name: "冬", emoji: "" };
}
// v1.8.5 C5：本地今日 YMD（对比天卡 date 用）
function ymdLocal() {
 const d = new Date();
 return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Page(SafePage({
 data: {
    fz: 1,
  td: false,
  view: [], summary: "", stats: "", mixTxt: "",
  metaChips: [], budgetLine: "", modeTxt: "", pickTxt: "",
  clothText: "", stayText: "", goText: "", guideOpen: true,
  open: -1, detailText: "", detailName: "", detailTags: [], timing: null, routeOpen: -1, offlineHow: "",
  isFav: false, favReady: false,
  wishMiss: [], wishAll: 0, wishPlan: [],
  // P2：方案切换（leisure / balance / speed 循环）
  altIdx: 1,
  altNames: ["轻松休闲", "平衡舒适", "特种兵打卡"],
  hasPlan: true,
  altPaces: ["leisure", "balance", "speed"],
  // 全省 · 省内精华游（isProv 时隐藏单城专属控件）
  isProv: false,
  // 行程天气卡（open-meteo；失败静默隐藏）
  wxShow: false, wxList: [], wxOff: false, wxIsMulti: false,
  // v1.6：城市速览 / 倒计时
  brief: null, briefOpen: false, countdown: null,
  // v1.18：天气卡 / 想玩未排上列表默认收起（减法：首屏更轻）
  wxOpen: false, wishOpen: false,
  // v1.8.4 A1/B12/B17：人流提示 / 单日卡点 / 城市打分贴士
  hints: [], cityNote: null, cnOpen: false, cnScore: 0, cnTips: "", cnToggleTx: "去打分 ▾",
  // v1.8.5 C5：顶部天数快速导航
  topDays: [], dsActive: -1,
  // v1.19.77：拖动排序（dragSh 为逐条预计算的 transform 字符串，WXML 只做数组取值）
  dragOn: false, dragDi: -1, dragI: -1, dragSh: [],
  // v1.19.78：城市深度玩法（随 subai 分包懒加载；未收录城市保持 null → UI 自动不显示）
  deep: null
 },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：onShow 是行程页唯一入口，任何异常都不得导致白屏（无数据时优雅回首页）
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    try { AN.pageView("plan"); } catch (e) {}
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() {
   try { this._theme(); } catch (e) {}
   try {
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) {
     // v1.19.2：原实现「toast + reLaunch」把用户直接踢回首页且无解释，新手会以为页面坏了。
     // 现在说清原因、用 switchTab 正常切到出发页（保留 tab 栈，不再销毁页面）。
     this.setData({ hasPlan: false });
     wx.showToast({ title: "还没有行程，先去「出发」选个城市", icon: "none", duration: 2000 });
     setTimeout(() => { try { wx.switchTab({ url: "/pages/index/index" }); } catch (_) {} }, 1200);
     return;
    }
    if (!this.data.hasPlan) this.setData({ hasPlan: true });
    this.__animOn = true;   // v1.19.77：进页才放错落入场动效
    this._render(plan);
    this._checkDueRemind();
    // v1.19.88：后台惰性生成 5:4 转发卡片图（延后 900ms 不抢首屏；供 onShareAppMessage.imageUrl）
    setTimeout(() => { try { this._ensureShareCard(); } catch (e) {} }, 900);
   } catch (e) {
    wx.showToast({ title: "行程加载异常，请重试", icon: "none" });
   }
  },

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
   route: T.routeAdvice(plan, di),
   load: T.dayLoad(plan, di),   // v1.8.4 B12：单日参考时长 / 超时预警
   mv: (!plan.isProv) ? T.dayMove(d, segs ? segs[segByDay[di]].cityName : (plan.cityName || "")) : null,
   items: (d.items || []).map((it, ix) => ({
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
    hour: T.P.spotHours ? T.P.spotHours(it.name) || "" : ""
   }))
  }));
  let spots = 0;
  try { spots = T.P.countPlanStats(plan.days).spots; } catch (e) {}
  const city = plan.isProv
   ? (T.P.buildProvinceCity ? T.P.buildProvinceCity(plan.cityName) : null) // 全省游：以省为对象的伪城市（气候/美食/住宿取省会基调）
   : (T.findCity(plan.cityName) || null);
  let clothText = "", stayText = "", goText = "";
  if (city) {
    // 2026-10-29 去重：clothAdvice 里混进了「适宜时节」和天气整句，
  // 而这两项在顶部 chips 与下方「城市速览」已经各说一次（共三处重复）。
  // 这里只保留「怎么穿」，气候与最佳季节交给城市速览。
  const _bf = (T.cityBrief ? T.cityBrief(plan.cityName) : null) || {};
  const _dupLines = [String(_bf.climateTxt || "").trim(), String(_bf.best || "").trim()].filter(Boolean);
  clothText = String(T.clothAdvice(city) || "")
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
   const daysLeft = Math.round((d0 - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
   chips.push("距出发 " + Math.max(0, daysLeft) + " 天");
   const sn = getSeason(dep[1]);
   chips.push(sn.name + "季出行");
  }
  if (segs) {
   chips.unshift(segs.map(s => s.cityName + s.days + "天").join(" → ") + " · 共 " + plan.days.length + " 天");
  } else {
   if (plan.isProv) chips.unshift("全省精华游 · " + plan.cityName);
   if (city && city.best) chips.push("最佳：" + city.best);
  }
  if (plan.travelMode && MODE_LABEL[plan.travelMode]) chips.push(MODE_LABEL[plan.travelMode]);
  if (plan.customAmt > 0) chips.push("自定义总预算 ¥" + plan.customAmt);
  else if (plan.budget) chips.push(T.budgetLabel(plan.budget));

  const bo = T.budgetTotalObj(plan);
  let budgetLine = "";
  if (bo) {
   budgetLine = "预计花费：人均约 ¥" + bo.daily + "/天 × " + bo.people + "人 × " + bo.days + "天 ≈ ¥" + bo.totalBudget +
    "（住宿 " + bo.hotel + " · 餐饮 " + bo.food + " · " + bo.note + "）";
  }
  // 想玩命中提示
  const wish = T.getWish().filter(x => !x.city || x.city === plan.cityName || (segs && segs.some(s => s.cityName === x.city)));
  const arranged = new Set((plan.days || []).reduce((a, d) => a.concat((d.items || []).map(i => i.name)), []));
  const hit = wish.filter(x => arranged.has(x.name)).map(x => x.name);
  const miss = wish.filter(x => !arranged.has(x.name)).map(x => x.name);

  const summaryText = segs ? segs.map(s => s.cityName).join(" → ") + " · " + plan.days.length + "天" + (plan.days.length - 1) + "晚"
   : (plan.cityName + " · " + plan.days.length + "天" + (plan.days.length - 1) + "晚" + (plan.isProv ? " · 全省精华游" : ""));
  // v1.9：构成统计文案（山水×N · 人文×N …）
  let mixTxt = "";
  try {
   const mx = T.mixStat(plan);
   if (mx.length && !plan.isProv) mixTxt = mx.map(r => r.cat + "×" + r.n).join(" · ");
  } catch (e) {}
  // v1.9：最佳季节徽章
  if (!segs && !plan.isProv && plan.depart) {
   try {
    const sh = T.bestSeasonHit(plan.cityName, String(plan.depart));
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
   stats: ((ov ? ov.text + " · " + ov.level : spots + " 个具体景点") + " · 出发 " + (plan.depart || "")),
   // v1.11：体检卡标题文案预计算（WXML 里原本是两层嵌套三元）
   tripCheck: (() => {
    const c = this._checkMerge(plan);
    if (!c) return null;
    const n = Array.isArray(c.items) ? c.items.length : 0;
    return Object.assign({}, c, { lvTx: c.level === "ok" ? "一切正常" : (c.level === "warn" ? "有 " + n + " 条待处理" : "还能更好") });
   })(),
   overview: ov,
   segs,
   metaChips: chips, budgetLine, mixTxt,
   modeTxt: plan.travelMode ? MODE_LABEL[plan.travelMode] || "" : "",
   pickTxt: plan.pickOnly ? "本次按「只玩勾选」生成 · 未勾选的推荐已跳过" : "",
   clothText, stayText, goText,
   open: -1, detailText: "", detailName: "", detailTags: [], timing: null, routeOpen: -1, offlineHow: "",
   altIdx,
   isProv: !!plan.isProv,
   // 有限数据层城市（limited）：诚实提示内容收集中，已生成抵达/返程框架，真实景点待补充
   limitedNotice: !!(city && city.limited && !plan.isProv),
   gauge: T.budgetGauge(plan),
   foot: T.tripFoot(plan),
   // v1.17.10：省域行程用「省级速览」（按全省真实景点数算建议天数、必吃取具体菜名）；
   // 旧实现一律 cityBrief(plan.cityName)，而省名会被 findCity 兜成 generic 城 → 建议 2 天 + 泛化必吃
   brief: segs ? null : (plan.isProv ? T.provBrief(plan.province) : T.cityBrief(plan.cityName)),
   countdown: T.tripCountdown(plan),
   isFav: (segs || plan.isProv) ? false : T.isFaved(plan.cityName), favReady: true,
   wishAll: wish.length, wishPlan: hit.map(n => ({ name: n, on: true })), wishMiss: miss.map(n => ({ name: n, on: false })),
   // v1.8.4 A1/B17：人流提示 + 城市经验
   hints: T.dateHintsForPlan(plan).map(h => Object.assign({}, h, { dateTx: String(h.date || "").slice(5) })),
   cityNote: (segs || plan.isProv) ? null : T.getCityNote(plan.cityName),
   cnOpen: false,
   cnToggleTx: ((segs || plan.isProv) ? null : T.getCityNote(plan.cityName)) ? "编辑 ▾" : "去打分 ▾",
   topDays
  });
  this._maybeLoadWx(plan);
  this._loadDeep(plan);
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
 _loadDeep(plan) {
  const cands = this._planCities(plan);
  if (!cands.length) return;
  try {
   A.initDeep().then(() => {
    let hit = null;
    for (let i = 0; i < cands.length; i++) {
     if (A.hasDeep(cands[i])) { hit = cands[i]; break; }
    }
    if (!hit) return;
    const raw = A.deepOf(hit);
    if (!raw) return;
    let total = 0;
    const bs = raw.blocks || [];
    for (let i = 0; i < bs.length; i++) total += ((bs[i].items || []).length + (bs[i].trips || []).length);
    const teasers = (raw.teaser || []).slice(0, 3);
    // 渲染期可能已切走 / 已生成新行程，用 try 包住避免异步落地时页面已卸载
    try {
     this.setData({
      deep: { city: hit, updated: A.updatedAt(), total: total, teasers: teasers }
     });
    } catch (e) {}
   }).catch(() => {});
  } catch (e) {}
 },
 // v1.19.78：出发提醒 —— 没有服务端时，唯一真能响铃的通道是「加入手机日历」，
 // 所以那个选项永远排第一；订阅消息只在真的配置了模板 ID + 云开发后才出现。
 _remindItem(plan) {
  const d = (plan.days && plan.days[0] && String(plan.days[0].date) || "").slice(0, 10);
  if (!d) return null;
  const city = plan.cityName || (plan.province ? plan.province + " 全省" : "目的地");
  return {
   planId: String(plan.id || "") || city + d,
   date: d,
   city: city,
   title: city + " · 出发当天",
   note: (plan.totalDays || plan.days.length) + " 天行程，出发前再把证件和预约确认一遍"
  };
 },
 onRemind() {
  try {
   const plan = app.globalData && app.globalData.plan;
   const item = plan && this._remindItem(plan);
   if (!item) { wx.showToast({ title: "行程还没有出发日期", icon: "none" }); return; }
   const items = ["加入手机日历（离线，到点响铃）"];
   const itemsUse = R.subscribeAvailable() ? items.concat(["订阅微信服务通知"]) : items;
   wx.showActionSheet({
    itemList: itemsUse,
    success: (r) => {
     const idx = Number(r && r.tapIndex);
     if (idx === 0) {
      R.addToCalendar(item).then((okd) => {
       R.add(Object.assign({}, item, { via: "calendar" }));
       wx.showToast({ title: okd ? "已加入手机日历" : "日历写入失败，可改用自己手机日历手动添加", icon: "none" });
      });
     } else if (idx === 1) {
      R.requestSubscribe().then(() => {
       R.scheduleCloud(item).then((okd) => {
        R.add(Object.assign({}, item, { via: okd ? "cloud" : "local" }));
        wx.showToast({ title: okd ? "已预约，出发当天微信会提醒你" : "预约失败，已改为站内提醒", icon: "none" });
       });
      });
     }
    },
    fail: () => {}
   });
  } catch (e) {
   wx.showToast({ title: "设置提醒失败", icon: "none" });
  }
 },
 // 站内轻提醒：到点（含已过）且没弹过的，进行程页时弹一次
 _checkDueRemind() {
  try {
   const due = R.dueToday();
   if (!due.length) return;
   const it = due[0];
   R.ack(it.id);
   if (R.cloudReady()) return;   // 云端会发，不必再打扰
   wx.showModal({
    title: "出发提醒",
    content: it.title + "（" + it.date + "）" + (it.note ? "\n" + it.note : ""),
    confirmText: "知道了",
    showCancel: false
   });
  } catch (e) {}
 },

 onDeep() {
  const d = this.data.deep;
  if (!d || !d.city) return;
  try {
   wx.navigateTo({ url: "/subai/deep/deep?city=" + encodeURIComponent(d.city) });
  } catch (e) {}
 },

 // v1.8.5 C1/C2/C4：行程体检融合（门票预估 / 天数偏长 / 预算体检 → 并入既有 check 卡，避免新增卡片）
 _checkMerge(plan) {
  const base = T.tripCheck(plan);
  const ins = [];
  const ts = T.ticketSumOf(plan);
  if (ts && ts.n > 0) ins.push({ t: "门票预估", x: ts.n + " 个景点按挂牌价约 ¥" + ts.fee + "，旺季与园内交通会浮动，以预约页为准", lv: "info" });
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

 // 行程天气（open-meteo；同行程只拉一次，失败静默隐藏天气卡）
 _maybeLoadWx(plan) {
  const segs = Array.isArray(plan.segments) && plan.segments.length > 1;
  const d0 = plan.days && plan.days[0] ? String(plan.days[0].date) : "";
  const sig = (plan.cityName || "") + "|" + (plan.days ? plan.days.length : 0) + "|" + d0;
  if (this._wxSig === sig && (this.data.wxShow || this.data.wxOff)) return;
  this._wxSig = sig;
  if (this.data.wxShow) this.setData({ wxShow: false });
  W.fetchPlanWeather(plan, list => {
   if (!list || !list.length) { this.setData({ wxOff: true, wxShow: false, wxList: [] }); return; }
   const today = T.fmtLocalDate(new Date());
   const wxList = list.map((w, wi) => {
    const p = String(w.date).split("-");
    // v1.11 UI 减法：湿度/UV/风 + 日出日落 原本是两行、且在 WXML 里靠三元拼字符串，
    // 现在合成一行预计算文本 —— 少一层容器、少一行高度、WXML 里零逻辑。
    const meta = [];
    if (w.hum != null) meta.push("湿" + w.hum + "%");
    if (w.uv != null) meta.push("UV" + w.uv);
    if (w.wind != null) meta.push("风" + w.wind + "km");
    if (w.sunrise) meta.push("日出" + w.sunrise);
    if (w.sunset) meta.push("日落" + w.sunset);
    return Object.assign({}, w, {
     di: wi,
     dateText: p.length === 3 ? p[1] + "/" + p[2] : w.date,
     isToday: w.date === today,
     metaLine: meta.join(" · "),
     riskIcon: (w.risk && w.risk.icon) || "sun",
     riskTx: w.riskTx || "天气良好",
     tmaxTx: w.tmax != null ? w.tmax + "°" : "--",
     tminTx: w.tmin != null ? "/" + w.tmin + "°" : ""
    });
   });
   this.setData({ wxShow: true, wxOff: false, wxList, wxIsMulti: !!segs, wxLoading: false });
  });
 },

 toggleGuide() { this.setData({ guideOpen: !this.data.guideOpen }); },

 // C2：关闭「天气暂不可用」提示（本次行程记住，不再打扰）
  closeWxOff() {
    this._wxOffDismiss = this._wxSig || "";
    this.setData({ wxOff: false });
  },
  // v1.19.49：天气拉取失败（失败不写缓存）时给「重试」入口，弱网首拉失败可立即重拉
  onWxRetry() {
    const plan = app.globalData.plan;
    if (!plan) return;
    this._wxSig = "";           // 强制重新拉取（失败未缓存，重试会真实发请求）
    this.setData({ wxOff: false });
    this._maybeLoadWx(plan);
  },

  /* ---- v1.8.4 B17：城市打分 + 避坑小贴士（自存，下次来这座城会回显） ---- */
  // v1.12 UI 减法：打分入口文案预计算，避免 WXML 内嵌套三元
  _syncCnTx() {
   const d = this.data;
   this.setData({ cnToggleTx: d.cnOpen ? "收起 ▴" : (d.cityNote ? "编辑 ▾" : "去打分 ▾") });
  },
  onCnToggle() {
   const plan = app.globalData.plan;
   if (!plan || plan.isProv || (Array.isArray(plan.segments) && plan.segments.length > 1)) return;
   const open = !this.data.cnOpen;
   this.setData({ cnOpen: open,
    cnScore: this.data.cityNote ? this.data.cityNote.score : 0,
    cnTips: this.data.cityNote ? (this.data.cityNote.tips || []).join("\n") : "" });
   this._syncCnTx();
  },
  onCnScore(e) { this.setData({ cnScore: Number(e.currentTarget.dataset.s) || 0 }); },
  onCnTips(e) { this.setData({ cnTips: e.detail.value }); },
  onCnSave() {
   const plan = app.globalData.plan;
   if (!plan || !plan.cityName) return;
   const tips = String(this.data.cnTips || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 8);
   T.saveCityNote(plan.cityName, this.data.cnScore, tips);
   this.setData({ cnOpen: false, cityNote: T.getCityNote(plan.cityName) });
   this._syncCnTx();
   wx.showToast({ title: "已记下这座城的经验", icon: "none" });
  },
  onCnDel() {
   const plan = app.globalData.plan;
   if (!plan) return;
   T.delCityNote(plan.cityName);
   this.setData({ cityNote: null, cnOpen: false });
   this._syncCnTx();
   wx.showToast({ title: "已删除", icon: "none" });
  },

 // 当天卡片「地图」→ 跳到地图页并定位到该天（多站行程由地图页按 di 归属段城市）
 jumpMap(e) {
  const di = Number(e.currentTarget.dataset.di);
  if (Number.isNaN(di) || di < 0) return;
  wx.navigateTo({ url: "/subpkg/map/map?di=" + di });
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
 /* ---- 导出 .ics 日历（复制文本 → 粘贴到文件助手 / 邮件，导入系统日历） ---- */
 onExportICS() {
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  const dep = plan.depart || (plan.days[0] && plan.days[0].date) || "";
  const lastDay = plan.days[plan.days.length - 1];
  const endD = (lastDay && lastDay.date) || dep;
  const nm = plan.isProv ? plan.province : (plan.cityName || "");
  // v1.17.10：简化为一键写入手机系统日历（微信原生 API），不再要求用户复制 .ics 再手动导入
  if (typeof wx.addPhoneCalendar === "function") {
   const mk = (s, hh) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? Math.floor(new Date(+m[1], +m[2] - 1, +m[3], hh, 0, 0).getTime() / 1000) : Math.floor(Date.now() / 1000);
   };
   wx.addPhoneCalendar({
    title: (nm || "旅行") + "行程 · " + plan.days.length + " 天",
    description: "共 " + plan.days.length + " 天，出发 " + dep + (plan.days[0] && plan.days[0].theme ? " · " + plan.days[0].theme : ""),
    startTime: mk(dep, 9),
    endTime: mk(endD, 21),
    alarm: true,
    alarmOffset: 3600,
    success: () => wx.showToast({ title: "已加入手机日历", icon: "success" }),
    fail: () => this._icsCopy(plan)
   });
   return;
  }
  this._icsCopy(plan);
 },
 // 兜底：旧版微信/不支持 addPhoneCalendar 时，退回「复制 .ics」
 _icsCopy(plan) {
  const ics = T.exportICS(plan);
  if (!ics) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  wx.setClipboardData({
   data: ics,
   success: () => wx.showModal({
    title: "已复制日历文件",
    content: "共 " + plan.days.length + " 天行程 · 粘贴到微信「文件传输助手」或邮件，在手机里打开 .ics 即可加入系统日历",
    showCancel: false, confirmText: "好的"
   })
  });
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

 _save() {
  const plan = app.globalData.plan;
  app.setPlan({ ...plan, days: plan.days });
  this._render(plan);
 },

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
  // 离线百科（SPOT_DETAILS）：spotDetailText 没有时，用离线简介兜底，避免大量经典景点只剩「点百科看更多」
  const lookup = it.custom ? null : T.spotLookup(it.name, city);
  // 自己加的点（库里没有）不编百科式介绍，避免「随便输一个也有介绍」的假内容
  let txt, offlineHow = "";
  if (it.custom) {
    txt = "这是你自己加的点，暂未收录介绍。点「百科」可搜索，或换成本市经典景点。";
  } else {
    const base = T.spotDetailText(it.name, city);
    if (base) txt = base;
    else if (lookup && lookup.intro) { txt = lookup.intro; offlineHow = lookup.how || ""; }
    else txt = "暂无介绍，点百科看更多";
  }
  // v1.15：详情展示景点标签，点标签可换一个同标签的当地景点
  const detailTags = it.custom ? [] : T.spotTagOf(it.name, city);
  // v1.16：地图 POI 返回的真实开放时间/评分/人均/地址（没有就不显示，不编造）
  let infoTx = it.custom ? "" : (T.spotInfoText(it.name) || "");
  const hasRealDetail = !!txt && txt.indexOf("暂无介绍") < 0;
  this.setData({
    open: ix + di * 100, detailText: txt, detailName: it.name, detailTags,
    infoTx, showInfo: !!infoTx, hasRealDetail, timing: T.spotTiming(it.name), offlineHow
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
 // v1.7：展开/收起当天交通建议
 onRoute(e) {
  const di = Number(e.currentTarget.dataset.di);
  this.setData({ routeOpen: this.data.routeOpen === di ? -1 : di });
 },

 // v1.8.4 B15：旅行拼图（canvas 每日卡片拼贴墙 → 保存相册）
 onBaike(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData && app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items || !plan.days[di].items[ix]) return;
  const url = T.baikeUrl(plan.days[di].items[ix].name);
  if (!url) return;
  wx.setClipboardData({ data: url, success: () => wx.showToast({ title: "百科链接已复制，到浏览器打开", icon: "none" }) });
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

 /* ---- 想玩面板：移除某条未排上的想玩（点 ）---- */
 removeWish(e) {
  const n = e.currentTarget.dataset.name;
  const plan = app.globalData.plan;
  if (!n) return;
  T.toggleWish(n, plan && plan.cityName);
  wx.showToast({ title: "已移出想玩", icon: "none" });
  if (plan) this._render(plan); // 防御：plan 未加载时不渲染，避免空引用（生产环境 plan 必存在）
},

 /* ---- 手动调整 ---- */
 _firstReal(di) {
  const plan = app.globalData.plan;
  return (plan.days[di].items || []).findIndex(it => !isFrame(it.name));
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
 /* ---- 换一个景点：同城池里挑一个本行程没排过的，替换后自动重排当天行文 ---- */
 onSwap(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData.plan;
  if (!plan || !plan.days[di]) return;
  const cands = T.swapCandidates(plan, di, ix);
  if (!cands.length) {
   wx.showToast({ title: "这座城市的景点都排进来啦", icon: "none" });
   return;
  }
  const r = T.swapSpot(plan, di, ix);
  if (!r) { wx.showToast({ title: "这条换不了（抵达/返程等框架安排）", icon: "none" }); return; }
  this.setData({ open: -1, detailText: "", detailName: "" }); // 重排后顺序会变，收起详情避免指错行
  this._save();
  wx.showToast({ title: "已换成「" + r.name + "」" + (r.left > 0 ? " · 还有 " + r.left + " 个可换" : ""), icon: "none", duration: 1800 });
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
 toggleBrief() { this.setData({ briefOpen: !this.data.briefOpen }); },
 // v1.18：天气卡 / 想玩未排上列表默认收起，点击标题展开
 toggleWx() { this.setData({ wxOpen: !this.data.wxOpen }); },
 toggleWish() { this.setData({ wishOpen: !this.data.wishOpen }); },
 // v1.19 P0-3：行程体检默认收起（只留标题+风险等级，点开看明细）
 toggleCheck() { this.setData({ checkOpen: !this.data.checkOpen }); },
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

 /* ═══ v1.19.77 · 按住手柄拖动排序（同一天内） ═══
    语义与既有 onMove 保持一致：时段（上午/下午/晚上）属于「坑位」而不是景点，
    拖动只是景点换坑位，落位后把原坑位的时段贴回新顺序，再走 normalizeDayItems 归一行文。
    全程 try/catch，任何一步异常都退化为「没动过」，绝不破坏行程数据。 */
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

  onShareAppMessage() {
    const plan = app.globalData.plan;
    const city = plan ? (plan.cityName || "") : "";
    const days = plan && plan.days ? plan.days.length : 0;
    // v1.19.76：分享带 city/days 深链参数，对方点开直达「已填好该城市的出发页」，提升搜索/分享获客
    const q = [];
    if (city) q.push("city=" + encodeURIComponent(city));
    if (days) q.push("days=" + days);
    const path = "/pages/index/index" + (q.length ? "?" + q.join("&") : "");
    const ret = {
      title: (plan ? "我做了份「" + plan.cityName + "·" + days + "天攻略」，景点路线美食都排好了" : "旅行攻略生成器") + "（离线可用）",
      path: path
    };
    // v1.19.88：转发卡片换黑金分享图（_ensureShareCard 惰性生成；未生成完回退默认卡片，不阻塞分享）
    if (this.__shareImg) ret.imageUrl = this.__shareImg;
    return ret;
  },

  // v1.19.76：朋友圈/群分享长图 —— 把行程渲染成一张精美卡片，可转发图片或存相册发朋友圈
  onShareImg() {
    const that = this;
    wx.showLoading({ title: "生成中…" });
    wx.createSelectorQuery().in(this).select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) { wx.hideLoading(); wx.showToast({ title: "生成失败", icon: "none" }); return; }
      try {
        const canvas = res[0].node;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        const m = that._posterModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        that._drawPoster(ctx, m.W, m);
        wx.canvasToTempFilePath({
          canvas,
          success(r) {
            wx.hideLoading();
            const save = () => wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success() { wx.showToast({ title: "已存相册，去朋友圈发吧", icon: "none" }); },
              fail() { wx.previewImage({ urls: [r.tempFilePath], showmenu: true }); }
            });
            if (wx.showShareImageMenu) {
              wx.showShareImageMenu({ path: r.tempFilePath, fail: save });
            } else { save(); }
          },
          fail() { wx.hideLoading(); wx.showToast({ title: "生成失败", icon: "none" }); }
        });
      } catch (e) { wx.hideLoading(); wx.showToast({ title: "生成失败", icon: "none" }); }
    });
  },

  /* ---- v1.19.88：转发卡片（5:4 黑金卡） ----
     好友对话里的小程序卡片此前是纯文字+默认截图；现后台惰性生成统一视觉的分享图接到
     onShareAppMessage.imageUrl。生成失败/未完成一律静默回退（分享永不被阻塞）。 */
  _shareCardModel() {
    return PP.shareCardModel(this.data, app.globalData.plan);
  },

  _drawShareCard(ctx, cw, m) {
    PP.drawShareCard(ctx, cw, m);
  },

  _ensureShareCard() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    const stamp = (plan.savedAt || 0) + "|" + (plan.cityName || "") + "|" + plan.days.length;
    if (this.__shareStamp === stamp && this.__shareImg) return;   // 行程没变不重画
    this.__shareStamp = stamp;
    const that = this;
    wx.createSelectorQuery().in(this).select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      try {
        const canvas = res[0].node;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        const m = that._shareCardModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        that._drawShareCard(ctx, m.W, m);
        wx.canvasToTempFilePath({
          canvas,
          success(r) { that.__shareImg = r.tempFilePath; },
          fail() { that.__shareImg = null; }
        });
      } catch (e) { /* 静默：回退纯文字卡片 */ }
    });
  },

  _posterModel() {
    return PP.posterModel(this.data, app.globalData.plan);
  },

  _drawPoster(ctx, cw, m) {
    PP.drawPoster(ctx, cw, m);
  },

  _rrect(ctx, x, y, w, h, r) {
    PP.rrect(ctx, x, y, w, h, r);
  },

  _fit(ctx, text, maxW, fontPx) {
    return PP.fit(ctx, text, maxW, fontPx);
  },
}));
