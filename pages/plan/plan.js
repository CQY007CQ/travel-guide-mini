const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const S = require("../../utils/store.js");   // v1.20.4 #81：统一存储出口
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// plan：每日行程浏览 + 详情 + 导航/百科/想玩 + 手动调整 + 按想玩重新生成
const T = require("../../utils/travel.js");
const W = require("../../utils/weather.js");
const A = require("../../utils/aicontent.js");
// v1.20.3：remind / plan-poster 仅在特定用户操作（设提醒 / 生成分享图）才用到，
// 已从主包迁到分包 subpkg/utils，按需异步加载 —— 主包瘦身绕开微信「代码质量」1.5M 软线。
// 微信端走静态字面量 require.async；Node（allcheck / 单测）无 require.async，回退同步 require，保证回归照常。
let R = null, PP = null;
function _preloadSubMods() {
  if (typeof require.async === "function") {
    require.async("../../subpkg/utils/remind.js").then((m) => { R = m; }).catch(() => {});
    require.async("../../subpkg/utils/plan-poster.js").then((m) => { PP = m; }).catch(() => {});
  } else {
    try { R = require("../../subpkg/utils/remind.js"); } catch (e) {}
    try { PP = require("../../subpkg/utils/plan-poster.js"); } catch (e) {}
  }
}
const EL = require("../../utils/errlog.js");        // v1.19.199：分享图失败分阶段留痕（真机可回溯）
const Cloud = require("../../utils/cloud.js");      // 云端 AI（llmProxy 强模型网关，fail-closed）
const AIAgent = require("../../utils/ai-agent.js");
const app = getAppSafe();

function isFrame(n) { return T.isFrameName(n); }
// v1.20.8→v1.20.9：路线缩略图（零网络 / 零域名白名单 / 全量覆盖）
// 收口到 utils/travel.js 的 spotCover()：稳定渐变 + 分类图标 + 名称，真图 it.img 优先。
// 无真图时由渲染层标注「示意图」，杜绝伪装成实拍。
function thumbFor(name, img, city) {
  const cv = T.spotCover(city || "", name, img);
  return {
    thumbBg: cv.bg,
    thumbEmoji: cv.glyph,
    img: cv.img || "",            // 数据自带真图 / CC 图映射的 cloud:// fileID
    photoCredit: cv.photoCredit || "",
    photoLicense: cv.photoLicense || "",
    coverLabel: cv.label,
    coverBadge: cv.badge,
    coverCat: cv.cat
  };
}
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
  clothText: "", stayText: "", goText: "", guideOpen: false,
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
  // 行程天气卡（和风天气；失败静默隐藏）
  wxShow: false, wxList: [], wxOff: false, wxIsMulti: false, wxLoading: false,
  // v1.19.153：天气失败态可辨识（不再一律「天气暂不可用」）
  wxErrType: "", wxErrMsg: "", wxErrRetry: false,
  // 雨雪天备选：目的地有雨/雪时推荐室内或雨/雪景友好景点
  rainyShow: false, rainySpots: [], rainyKinds: [], rainyKindsTx: "",
  wxLongTripHint: false, // v1.19.182：行程 >7 天，仅前 7 天有预报的兜底提示
  // v1.6：城市速览 / 倒计时
  brief: null, briefOpen: false, countdown: null,
  // v1.18：天气卡 / 想玩未排上列表默认收起（减法：首屏更轻）
  wxOpen: true, wishOpen: false,
  // v1.8.4 A1/B12/B17：人流提示 / 单日卡点 / 城市打分贴士
  hints: [], cityNote: null, cnOpen: false, cnScore: 0, cnTips: "", cnToggleTx: "去打分 ▾",
  // v1.8.5 C5：顶部天数快速导航
  topDays: [], dsActive: -1,
  // v1.19.77：拖动排序（dragSh 为逐条预计算的 transform 字符串，WXML 只做数组取值）
  dragOn: false, dragDi: -1, dragI: -1, dragSh: [],
  // 2026-11-09：换景点选择面板 / 移到其他天
  swapOpen: false, swapDi: -1, swapIx: -1, swapCur: "", swapList: [], swapWish: [],
  moveOpen: false, moveDi: -1, moveIx: -1, moveDays: [],
  // v1.19.78：城市深度玩法（随 subai 分包懒加载；未收录城市保持 null → UI 自动不显示）
  deep: null,
  // v1.19.179：「我的攻略」本地库——当前行程是否已保存到库（命中签名则回显「已保存」）
  savedId: "", savedAt: 0,
  // 行程页 AI 答疑（云端强模型优先，离线规则引擎兜底）
  aiOpen: false, aiInput: "", aiAnswer: "", aiLoading: false, aiSource: "", aiErr: ""
 },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：onShow 是行程页唯一入口，任何异常都不得导致白屏（无数据时优雅回首页）
  onLoad() { this.__boot = T.ready().catch(() => null); _preloadSubMods(); },
  onShow() { onShowRender(this, "plan"); },
  _renderShow() {
   // v1.20.3：消费首页磁贴的定位意图（酒店/百科/天气），在任何分支前先读并清除，避免空行程回首页后残留再误触发
   this._applyFocus();
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

  // v1.19.179：行程签名——对齐 travel.js 行程存档(savePlanSlot)的 sig 算法，保证「已保存」状态可正确回显
  _planSig(plan) {
    const d0 = (plan && plan.days && plan.days[0] && plan.days[0].date) ? String(plan.days[0].date).slice(0, 10) : "";
    return ((plan && plan.cityName) || "") + "|" + ((plan && plan.days) ? plan.days.length : 0) + "|" + d0;
  },
  // v1.19.179：「保存到我的攻略」——复用既有本地行程存档(miniPlansV1)，下次从「更多 → 我的行程」或「我的攻略」库打开
  onSavePlan() {
    try {
      const plan = app.globalData && app.globalData.plan;
      if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "暂无行程可保存", icon: "none" }); return; }
      const wasSaved = !!this.data.savedId;
      const r = T.savePlanSlot(plan);   // 同 sig 自动覆盖，不堆积
      if (!r) { wx.showToast({ title: "保存失败", icon: "none" }); return; }
      this.setData({ savedId: r.id });
      wx.showToast({ title: wasSaved ? "已更新我的攻略" : "已保存到我的攻略", icon: "none" });
    } catch (e) { wx.showToast({ title: "保存失败，请重试", icon: "none" }); }
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
    thumbBg: _th.thumbBg, thumbEmoji: _th.thumbEmoji, img: _th.img, coverLabel: _th.coverLabel, coverBadge: _th.coverBadge, coverCat: _th.coverCat
   };
  })
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
   gauge: T.budgetGauge(plan),
   foot: T.tripFoot(plan),
   // v1.17.10：省域行程用「省级速览」（按全省真实景点数算建议天数、必吃取具体菜名）；
   // 旧实现一律 cityBrief(plan.cityName)，而省名会被 findCity 兜成 generic 城 → 建议 2 天 + 泛化必吃
   brief: segs ? null : (plan.isProv ? T.provBrief(plan.province) : T.cityBrief(plan.cityName)),
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
 _loadDeep(plan) {
  const cands = this._planCities(plan);
  const clear = () => { try { this.setData({ deep: null }); } catch (e) {} };
  if (!cands.length) { clear(); return; }
  const sig = this._planSig(plan);
  try {
   A.initDeep().then(() => {
    // 2026-11-09：异步落地前核对行程是否已切换 —— 否则旧城市的深度卡会贴到新行程上
    //（用户反馈：井冈山行程里显示了「太原 · 深度玩法」）。
    let cur = null;
    try { cur = app.globalData && app.globalData.plan; } catch (e) {}
    if (this._planSig(cur) !== sig) return;
    let hit = null;
    for (let i = 0; i < cands.length; i++) {
     if (A.hasDeep(cands[i])) { hit = cands[i]; break; }
    }
    // 新城市没有深度内容时必须清空，不能保留上一份行程的卡片
    if (!hit) { clear(); return; }
    const raw = A.deepOf(hit);
    if (!raw) { clear(); return; }
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
       if (okd) { wx.showToast({ title: "已加入手机日历", icon: "none" }); return; }
       // 2026-11-09：小程序没有写系统日历的 API → 直接给 .ics 文件（发送到聊天，点开即可导入）
       this._shareICS(plan);
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

 // 行程天气（和风天气 QWeather；首站城市预报，失败静默隐藏天气卡）
 _maybeLoadWx(plan) {
  const segs = Array.isArray(plan.segments) && plan.segments.length > 1;
  const segCity = plan.segments && plan.segments[0] && plan.segments[0].cityName;
  const d0 = plan.days && plan.days[0] ? String(plan.days[0].date) : "";
  const sig = (plan.cityName || "") + "|" + (plan.days ? plan.days.length : 0) + "|" + d0;
  if (this._wxSig === sig && (this.data.wxShow || this.data.wxOff)) return;
  this._wxSig = sig;
  if (this.data.wxShow) this.setData({ wxShow: false });
  this.setData({ wxLoading: true });
  // v1.19.153：回调改为 cb(list, err)；失败时按 err.type 给出可辨识文案，不再一律「天气暂不可用」
  W.fetchPlanWeather(plan, (list, err) => {
   if (err) {
     // type ∈ empty/env/no_key/nocity/quota/auth/param/api/net/window
     let msg = err.msg || "";
     if (!msg) {
       if (err.type === "empty") msg = "暂无行程，先生成一份攻略";
       else if (err.type === "env") msg = "当前环境不支持天气加载";
       else if (err.type === "nocity") msg = "未识别到行程城市";
       else if (err.type === "no_key") msg = "去「更多 → 合规与密钥」填入本人和风免费 Key，即时生效";
       else msg = "天气服务暂时异常";
     }
     // 仅「可能恢复」的失败（网络/额度/授权/服务异常/参数）才给重试；no_key/window/env/empty/nocity 重试无意义
     const recover = (err.type === "net" || err.type === "quota" || err.type === "auth" || err.type === "api" || err.type === "param");
     this.setData({ wxOff: true, wxShow: false, wxList: [], rainyShow: false, rainySpots: [], wxErrType: err.type || "api", wxErrMsg: msg, wxErrRetry: !!recover, wxLoading: false });
     return;
   }
   if (!list || !list.length) { this.setData({ wxOff: true, wxShow: false, wxList: [], rainyShow: false, rainySpots: [], wxErrType: "", wxErrMsg: "天气暂不可用", wxErrRetry: false, wxLoading: false }); return; }
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
     cityTx: w.city || "",
     dateText: p.length === 3 ? p[1] + "/" + p[2] : w.date,
     isToday: w.date === today,
     metaLine: meta.join(" · "),
     riskIcon: (w.risk && w.risk.icon) || "sun",
     riskTx: w.riskTx || "天气良好",
     tmaxTx: w.tmax != null ? w.tmax + "°" : "--",
     tminTx: w.tmin != null ? "/" + w.tmin + "°" : ""
    });
   });
   // v1.19.151：多城行程按各天所在城市预报；雨/雪天备选推「正在下雨/下雪的那座城」的室内/雨雪景
   const rainy = list.some(function (w) { return w.isRain || w.isSnow; });
   let rainySpots = [], rainyKinds = [], rainyKindsTx = "", rainyCity = "";
   if (rainy) {
     if (list.some(function (w) { return w.isSnow; })) rainyKinds.push("snow");
     if (list.some(function (w) { return w.isRain; })) rainyKinds.push("rain");
     for (let i = 0; i < list.length; i++) { if (list[i].isRain || list[i].isSnow) { rainyCity = list[i].city || ""; break; } }
     rainySpots = W.rainyDaySpots(rainyCity || segCity || plan.cityName, rainyKinds);
     if (rainyKinds.indexOf("snow") >= 0 && rainyKinds.indexOf("rain") >= 0) rainyKindsTx = "部分日期有雨 / 雪";
     else if (rainyKinds.indexOf("snow") >= 0) rainyKindsTx = "有降雪";
     else rainyKindsTx = "有降雨";
   }
   // v1.19.182：天气 × 行程联动 —— 把「雨天日」标注回日卡，并给出「优先室内/展馆」引导。
   // 不改 buildPlan 生成的行程顺序（保持 auto=1 复现确定性），仅在展示层加标注 + 引导。
   const _rainyDates = {};
   list.forEach(function (w) { if (w.isRain || w.isSnow) _rainyDates[String(w.date).slice(0, 10)] = 1; });
   const _indoorNames = (rainySpots || []).slice(0, 2).map(function (s) { return s.name; });
   const _indoorTx = _indoorNames.length ? ("雨天建议优先室内/展馆：" + _indoorNames.join("、")) : "雨天路滑，注意安全，优先安排室内景点";
   (plan.days || []).forEach(function (d, k) {
     const ds = String(d.date).slice(0, 10);
     if (_rainyDates[ds]) { d.isRainy = true; d.rainyHint = _indoorTx; }
     else { d.isRainy = false; d.rainyHint = ""; }
   });
   // 回写展示层：view 是 plan.days 的转换副本（转换段已拷贝 isRainy/rainyHint，重渲染不丢）
   if (Array.isArray(this.data.view)) {
     (plan.days || []).forEach(function (d, k) {
       if (this.data.view[k]) { this.data.view[k].isRainy = d.isRainy ? 1 : 0; this.data.view[k].rainyHint = d.rainyHint || ""; }
     }.bind(this));
   }
   const _longHint = (plan.days && plan.days.length > 7);
   // 多城/全省游：分段 >1 或同一份预报里出现不止一座城市 → 卡片标「各站按所在城市预报」并逐日显示城市
   const multi = !!segs || (wxList.length > 1 && wxList.some(function (w, i) { return i > 0 && w.city && wxList[0].city && w.city !== wxList[0].city; }));
   this.setData({ wxShow: true, wxOff: false, wxList: wxList, wxIsMulti: multi, wxLoading: false, wxErrType: "", wxErrMsg: "", wxErrRetry: false, rainyShow: rainySpots.length > 0, rainySpots: rainySpots, rainyKinds: rainyKinds, rainyKindsTx: rainyKindsTx, view: this.data.view, wxLongTripHint: _longHint });
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
  // 2026-11-09：天气未配置时给出可操作入口 —— 切到「更多」页配置和风 Key（仓库不内置明文 Key）
  goKeyConfig() {
    try { wx.switchTab({ url: "/pages/more/more" }); } catch (e) {}
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
    // 网页版把同一份日程导出成 .ics 文件下载（runtime 的 addPhoneCalendar），
    // 文案不能承诺「已加入手机日历」；用 getAccountInfoSync 区分，不碰废弃 API。
    success: () => {
     let isWeb = false;
     try { isWeb = !!(wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.appId === "web"); } catch (e) {}
     wx.showToast({ title: isWeb ? "已下载日历文件（.ics）" : "已加入手机日历", icon: "success" });
    },
    fail: () => this._shareICS(plan)
   });
   return;
  }
  this._shareICS(plan);
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

 // 2026-11-09：小程序里没有 wx.addPhoneCalendar（写系统日历）→ 生成 .ics 并调起「发送到聊天」，
  // 用户在手机上点开该文件即可导入系统日历。任何异常都退回「复制 .ics 文本」。
 _shareICS(plan) {
  let ics = "";
  try { ics = T.exportICS(plan) || ""; } catch (e) { ics = ""; }
  if (!ics) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  try {
   const fsm = wx.getFileSystemManager ? wx.getFileSystemManager() : null;
   const dir = (wx.env && wx.env.USER_DATA_PATH) || "";
   if (!fsm || !dir) return this._icsCopy(plan);
   const path = dir + "/trip_" + Date.now() + ".ics";
   fsm.writeFileSync(path, ics, "utf8");
   if (typeof wx.shareFileMessage === "function") {
    wx.shareFileMessage({
     filePath: path,
     fileName: "行程日历.ics",
     fail: () => this._icsCopy(plan)
    });
   } else {
    this._icsCopy(plan);
   }
  } catch (e) { this._icsCopy(plan); }
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

 /* ---- 真实照片：加载失败兜底回退示意图 / 署名 ---- */
 onImgError(e) {
  const d = e.currentTarget.dataset || {};
  const di = Number(d.di), i = Number(d.i);
  if (!isFinite(di) || !isFinite(i)) return;
  const patch = {};
  patch["view[" + di + "].items[" + i + "].img"] = "";
  try { this.setData(patch); } catch (err) {}
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
  const it = plan.days[di].items[ix];
  const city = (T.segCityOfDay ? T.segCityOfDay(plan, di) : "") || plan.cityName || "";
  const info = T.baikeInfo ? T.baikeInfo(it.name, city) : null;
  // 2026-11-09：按用户要求，弹窗展示的同时把「景点网址」也复制到剪贴板（恢复原有习惯）。
  // 静默复制（不弹 toast，避免与弹窗抢层），改为在弹窗正文末尾提示"已复制网址"。
  let copied = false;
  try {
   const kw = T.baikeKeyword ? T.baikeKeyword(it.name) : "";
   // 注意：这里不用 /'/g 正则 —— check-handlers 的简易 tokenizer 会把单引号当字符串起点而吞掉后续代码。
   const url = kw ? ("https://baike.baidu.com/search/word?word=" + encodeURIComponent(kw).split("'").join("%27")) : "";
   if (url) { wx.setClipboardData({ data: url }); copied = true; }
  } catch (err) {}
  if (!info || info.has === false || !info.text) {
   wx.showToast({ title: "该地点暂未收录百科" + (copied ? "，网址已复制" : ""), icon: "none" });
   return;
  }
  const content = info.text + (copied ? "\n\n（景点网址已复制，可粘贴到浏览器打开）" : "");
  wx.showModal({
   title: info.title || it.name, content: content,
   confirmText: "知道了", showCancel: false
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
 closeSwap() { this.setData({ swapOpen: false, swapDi: -1, swapIx: -1, swapList: [], swapWish: [] }); },
 onSwapRandom() {
  const list = this.data.swapList || [];
  if (!list.length) { wx.showToast({ title: "本城没有更多可换景点", icon: "none" }); return; }
  this._applySwap(list[Math.floor(Math.random() * list.length)]);
 },
 onSwapPick(e) {
  const name = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || "");
  if (name) this._applySwap(name);
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
 closeMove() { this.setData({ moveOpen: false, moveDi: -1, moveIx: -1, moveDays: [] }); },

 // ── 行程页 AI 答疑（云端强模型优先 · 离线规则引擎兜底 · 零白屏） ──
 openAI() {
  const plan = app.globalData && app.globalData.plan;
  if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程再问 AI", icon: "none" }); return; }
  this.setData({ aiOpen: true, aiErr: "" });
 },
 closeAI() { this.setData({ aiOpen: false }); },
 onAIInput(e) { this.setData({ aiInput: e.detail.value }); },
 _aiCtx() {
  try { return Cloud.aiContextOf(app.globalData && app.globalData.plan, "每日行程页"); }
  catch (e) { return ""; }
 },
 _aiOffline(q) {
  const plan = app.globalData && app.globalData.plan;
  let r;
  try { r = T.askAssistant(q, plan); } catch (e) { r = { text: "暂时答不上来，换个问法试试" }; }
  this.setData({ aiAnswer: (r && r.text) || "", aiLoading: false, aiSource: "", aiErr: "" });
 },
 sendAI() {
  const q = (this.data.aiInput || "").trim();
  if (!q) { wx.showToast({ title: "先输入问题", icon: "none" }); return; }
  const self = this;
  // 云未开启 → 直接离线，不做无谓等待
  if (typeof Cloud.cloudEnabled === "function" && !Cloud.cloudEnabled()) {
   self.setData({ aiLoading: true });
   setTimeout(() => { self._aiOffline(q); }, 0);
   return;
  }
  self.setData({ aiLoading: true, aiErr: "" });
  AIAgent.ask("plan", q, self._aiCtx())
   .then((r) => {
    if (r && r.ok && r.text) self.setData({ aiAnswer: r.text, aiLoading: false, aiSource: r.source || "ai", aiErr: "" });
    else self._aiOffline(q);
   })
   .catch(() => { self._aiOffline(q); });
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
 // 2026-11-09（#482）：示例行程 → 回「出发」页生成自己的
 onLeaveSample() { try { wx.switchTab({ url: "/pages/index/index" }); } catch (e) {} },
 toggleBrief() { this.setData({ briefOpen: !this.data.briefOpen }); },
 // v1.18：天气卡 / 想玩未排上列表默认收起，点击标题展开
 toggleWx() { this.setData({ wxOpen: !this.data.wxOpen }); },
 toggleWish() { this.setData({ wishOpen: !this.data.wishOpen }); },
 // v1.19.145：复制酒店比价搜索词到剪贴板（个人主体不内嵌预订，引导去平台 App 比价）
 copyPortal(e) {
  const t = e.currentTarget.dataset.term;
  const p = e.currentTarget.dataset.platform;
  if (!t) return;
  wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制，去" + p + "比价", icon: "none" }) });
 },
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
    // v1.19.180：再带上 depart/pace/budget/mode 与 auto=1 —— 行程生成是确定性的，
    //            参数齐了对方点开即可复现同一份行程（同款攻略），不用自己再调一遍选项。
    const q = [];
    if (city) q.push("city=" + encodeURIComponent(city));
    if (days) q.push("days=" + days);
    try {
      const d0 = plan && plan.days && plan.days[0] && plan.days[0].date;
      if (d0) q.push("depart=" + encodeURIComponent(String(d0).slice(0, 10)));
      if (plan && plan.pace) q.push("pace=" + encodeURIComponent(plan.pace));
      if (plan && plan.budget) q.push("budget=" + encodeURIComponent(plan.budget));
      // v1.19.193：自定义预算（budget=custom）必须一并带上总预算金额，否则对方 auto=1 复现时
      // 取不到 customAmt，generate() 会因「请输入全行程总预算」而卡住，复现同款行程失败。
      if (plan && plan.budget === "custom" && plan.customAmt) q.push("amt=" + encodeURIComponent(String(plan.customAmt)));
      if (plan && plan.travelMode) q.push("mode=" + encodeURIComponent(plan.travelMode));
      if (city && days) q.push("auto=1");
    } catch (e) {}
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
  // v1.19.199 真机「生成失败」修复（用户实机截图报障）：
  //   ① 旧版导出完全交给默认参数：canvas.width/height 已按 dpr 放大（如 1800×3936），
  //      而 wx.canvasToTempFilePath 的 destWidth/destHeight 默认还会再乘一次像素密度，
  //      高 dpr 安卓机直接申请超大图 → fail；同时画布 CSS 尺寸(600×2400) 与实际绘制
  //      逻辑尺寸(600×H) 不一致，默认导出区域越界。现显式给出导出矩形并把 dpr 钳到 2。
  //   ② 画布原放在 left:-10000rpx 视口外，部分真机渲染剔除导致 fields({node:true}) 拿不到节点。
  //   ③ 绘制后立刻导出，部分安卓 GPU 尚未提交会拿到空画布；现等一帧再导出。
  //   ④ 三个失败阶段全部 toast 同一句「生成失败」，无法定位；现分阶段日志 + 区分提示。
  onShareImg() {
    const that = this;
    const log = (stage, detail) => {
      try { console.warn("[shareImg] " + stage, detail || ""); } catch (e) {}
      try { EL.push("plan.onShareImg." + stage, detail); } catch (e) {}
    };
    const done = () => { that.__posterBusy = false; };
    const fail = (stage, detail, title) => {
      log(stage, detail); done();
      wx.hideLoading();
      wx.showToast({ title: title || "生成失败，请重试", icon: "none" });
    };
    wx.showLoading({ title: "生成中…" });
    that.__posterBusy = true;

    // 节点查询：首帧可能还没渲染出离屏 canvas，重试 3 次；最后一次不带 .in 兜底
    const findCanvas = (left) => {
      const q = wx.createSelectorQuery();
      const sq = left > 0 && q.in ? q.in(that) : q;
      sq.select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) return draw(node);
        if (left > 0) {
          const later = () => findCanvas(left - 1);
          if (typeof setTimeout === "function") setTimeout(later, 120); else later();
          return;
        }
        fail("node", "select #shareCanvas returned no node", "画布未就绪，请重试");
      });
    };

    const draw = (canvas, attempt) => {
      attempt = attempt || 0;
      try {
        // 高 dpr(3) 会让像素画布与输出图过大，钳到 2 兼顾清晰度与真机内存
        let dpr = 2;
        try { dpr = Math.min(2, Number((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2) || 2); } catch (e) {}
        const m = that._posterModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // 2026-11-09 真机：canvas 刚挂载/尚未绘制时部分机型会返回 null。
          // 已把 .share-canvas 从 z-index:-1 改到正层级，这里再给两次短重试兜底。
          if (attempt < 2) { setTimeout(() => draw(canvas, attempt + 1), 120); return; }
          return fail("draw", "getContext(2d) returned null after retries", "绘图失败，请重试");
        }
        // setTransform 而非 scale：共用节点时避免残留变换叠加
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else ctx.scale(dpr, dpr);
        that._drawPoster(ctx, m.W, m);
        // 导出参数三档降级，兼容基础库对 width/height 的两种单位口径（逻辑 px / 物理 px）
        const variants = [
          { x: 0, y: 0, width: m.W, height: m.H, destWidth: m.W * dpr, destHeight: m.H * dpr },
          { x: 0, y: 0, width: canvas.width, height: canvas.height, destWidth: canvas.width, destHeight: canvas.height },
          {}
        ];
        const exportAt = (i) => {
          if (i >= variants.length) return fail("export", "all canvasToTempFilePath variants failed", "导出失败，请重试");
          wx.canvasToTempFilePath(Object.assign({
            canvas,
            fileType: "png",
            success(r) {
              done(); wx.hideLoading();
              const path = r && r.tempFilePath;
              if (!path) return exportAt(i + 1);
              const save = () => wx.saveImageToPhotosAlbum({
                filePath: path,
                success() { wx.showToast({ title: "已存相册，去朋友圈发吧", icon: "none" }); },
                fail() { wx.previewImage({ urls: [path], showmenu: true }); }
              });
              if (wx.showShareImageMenu) wx.showShareImageMenu({ path: path, fail: save });
              else save();
            },
            fail(e) { log("export.variant" + i, (e && (e.errMsg || e.message)) || e); exportAt(i + 1); }
          }, variants[i]));
        };
        const next = () => exportAt(0);
        if (canvas.requestAnimationFrame) {
          try { canvas.requestAnimationFrame(next); } catch (e) { setTimeout(next, 30); }
        } else if (typeof setTimeout === "function") { setTimeout(next, 30); } else { next(); }
      } catch (e) { fail("draw", e, "绘图失败，请重试"); }
    };

    findCanvas(2);
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
    // v1.19.199：与「生成分享图」共用同一 canvas，海报绘制中让一让，避免互相覆盖
    if (this.__posterBusy) {
      if (typeof setTimeout === "function") setTimeout(() => { try { this._ensureShareCard(); } catch (e) {} }, 600);
      return;
    }
    const stamp = (plan.savedAt || 0) + "|" + (plan.cityName || "") + "|" + plan.days.length;
    if (this.__shareStamp === stamp && this.__shareImg) return;   // 行程没变不重画
    this.__shareStamp = stamp;
    const that = this;
    wx.createSelectorQuery().in(this).select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      try {
        const canvas = res[0].node;
        let dpr = 2;
        try { dpr = Math.min(2, Number((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2) || 2); } catch (e) {}
        const m = that._shareCardModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else ctx.scale(dpr, dpr);
        that._drawShareCard(ctx, m.W, m);
        // v1.19.199：显式导出矩形（同 onShareImg 根因），失败再按物理像素口径降级一次
        const exp = () => wx.canvasToTempFilePath({
          canvas,
          x: 0, y: 0,
          width: m.W, height: m.H,
          destWidth: m.W * dpr, destHeight: m.H * dpr,
          fileType: "png",
          success(r) { that.__shareImg = r.tempFilePath; },
          fail() {
            wx.canvasToTempFilePath({
              canvas,
              x: 0, y: 0,
              width: canvas.width, height: canvas.height,
              destWidth: canvas.width, destHeight: canvas.height,
              fileType: "png",
              success(r2) { that.__shareImg = r2.tempFilePath; },
              fail() { that.__shareImg = null; }
            });
          }
        });
        if (canvas.requestAnimationFrame) {
          try { canvas.requestAnimationFrame(exp); } catch (e) { exp(); }
        } else { exp(); }
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
  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
  aiClearChat() {
    try { AIAgent.clearHistory("plan"); } catch (e) {}
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
}));
