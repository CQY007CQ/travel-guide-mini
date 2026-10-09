// 旅行百宝箱：灵感 / 体检 / 文案 / 打包，一键生成（v1.10 功能落地页）
const T = require("../../../utils/travel.js");
const S = require("../../../utils/store.js");
const app = getApp();

// 工具分组抽到 utils/toolkit-groups.js，与指南页共用（避免页面模块互相 require）
const ITEM_GROUPS = require("../../../utils/toolkit-groups.js").ITEM_GROUPS;
// 需要行程的工具（其输出是行程维度的，不能「加入想玩」）
const PLAN_TOOLS = ["brief", "theme", "load", "rhythm", "tips", "book", "museum", "photo", "risk", "score", "draft", "line", "long", "moments", "daytext",
  "countdown", "burn", "highlight", "rainy", "night", "crowd", "mistake", "density", "ticket2"];

// kind → 需要行程？(plan 组) 还是只要有城市即可
Page({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "旅行百宝箱：打包清单、花费换算、同行分摊等小工具", path: "/pages/index/index" };
  },

 data: {
    fz: 1, td: false, hasPlan: false, cityName: "", groups: ITEM_GROUPS, out: null,
  toolTotal: ITEM_GROUPS.reduce((s, g) => s + (g.items ? g.items.length : 0), 0),
  // v1.19 P2-9：工具结果闭环 —— 收藏 + 加入想玩
  favs: [], favOpen: false, favIdx: -1, outAddable: false },

 // v1.11：onLoad 里 theme() 尚未跑，直接 refresh 会因 setData 早于初始化报警；改为安全包裹
 onLoad() {
   this.__boot = T.ready().catch(() => null);
   // 工具 key → 标题，供收藏展示
   this._toolTitle = {};
   ITEM_GROUPS.forEach(g => (g.items || []).forEach(it => { this._toolTitle[it.k] = it.t; }));
   try { this.refresh(); } catch (e) {}
 },
 _theme() { try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {} },
 onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
 _renderShow() {
   try {
     this._theme();
     this.refresh();
     this.setData({ favs: this._loadFavs() });
   } catch (e) { try { wx.showToast({ title: "工具箱加载异常", icon: "none" }); } catch (_) {} }
 },

 // v1.19 P2-9：收藏的工具结果（与行程/想玩互通，落盘持久化）
 _loadFavs() { try { return S.get("miniToolFavV1", []) || []; } catch (e) { return []; } },

 refresh() {
  const p = app.globalData.plan;
  const hasPlan = !!(p && p.days && p.days.length);
  const planCity = hasPlan ? (p.cityName || "") : "";
  const fallback = T.findCity(planCity || this.lastCity());
  const city = fallback && fallback.experiences ? fallback : T.findCity("北京");
  this._city = city;
  this._plan = hasPlan ? p : null;
  this.setData({ hasPlan, cityName: (city && city.name) || "" });
 },

 // 无行程时回退：最近玩过的城市（miniRecentV1 简单取首条）
 lastCity() {
  try {
   const r = T.getRecent ? T.getRecent() : null;
   if (!r || !r.length) return "";
   const x = r[0];
   return typeof x === "string" ? x : (x && (x.name || x.city)) || "";
  } catch (e) { return ""; }
 },

 _now() {
  const p = this._plan;
  const arr = Array.isArray(p) ? p : (p && p.days) || [];
  return arr;
 },

 run(e) {
  const k = e.currentTarget.dataset.k;
  const city = this._city;
  const plan = this._plan;
  const arr = this._now();
  const needPlan = PLAN_TOOLS.indexOf(k) >= 0;
  if (needPlan && !arr.length) {
   wx.showToast({ title: "先回「出发」页生成攻略", icon: "none" });
   return;
  }
  let txt = "";
  const lines = a => (Array.isArray(a) ? a.join("\n") : String(a));
  switch (k) {
   case "brief": {
    const per = T.periodOf(plan), cityT = T.spanCityOf(plan).text;
    txt = "📅 " + per.label + "\n📍 " + cityT +
     "\n🏷 " + (T.themeTagsOf(plan).top.join(" / ") || "自由探索") +
     "\n⚡ " + T.effortTagOf(plan).tag + "（日均 " + T.effortTagOf(plan).avg.toFixed(1) + " 个安排）" +
     "\n⭐ " + T.tripScoreOf(plan).score + " 分：" + T.tripScoreOf(plan).comment;
    break;
   }
   case "theme": txt = lines(T.themeTagsOf(plan).top); break;
   case "load": {
    const lr = T.loadRank(plan);
    txt = lines(lr.rows.map(r => "第" + (r.di + 1) + "天 " + r.date + " · " + r.n + " 个安排" + (r.theme ? "（" + r.theme + "）" : ""))) + "\n→ 最满第 " + (lr.max.di + 1) + " 天，最闲第 " + (lr.min.di + 1) + " 天";
    break;
   }
   case "rhythm": txt = T.routeRhythm(plan); break;
   case "tips": txt = lines(T.tipsTop3(plan)); break;
   case "book": {
    const b = T.bookingByLead(plan);
    txt = b.length ? lines(b.map(x => "第" + x.di + "天 " + x.name + "：" + x.days + " @" + x.where)) : "本行程暂未检出需抢票/预约的热门点，放心出发";
    break;
   }
   case "museum": {
    const m = T.museumDiList(plan);
    txt = m.length ? lines(m.map(x => "第" + x.di + "天（" + x.date + "）" + x.names.join("、") + (x.monday ? " ← 周一，先核实开放" : ""))) : "行程里没有博物馆类安排";
    break;
   }
   case "photo": {
    const sr = T.sunriseDiList(plan), ss = T.sunsetDiList(plan);
    const one = a => a.map(x => "第" + x.di + "天 " + x.names.slice(0, 2).join("、")).join("\n");
    txt = (sr.length ? "🌅 日出/早市：\n" + one(sr) : "🌅 无日出早市安排") + "\n" + (ss.length ? "🌇 日落/夜景：\n" + one(ss) : "🌇 无夜景安排");
    break;
   }
   case "risk": txt = lines(T.riskCard(plan, city)); break;
   case "score": txt = T.tripScoreOf(plan).score + " 分：" + T.tripScoreOf(plan).comment; break;
   case "draft": txt = T.tripDraft(plan); break;
   case "line": txt = T.shareOneLine(plan); break;
   case "long": txt = T.shareLong(plan); break;
   case "moments": {
    const m = T.starMoments(plan);
    txt = m.length ? lines(m.map(x => "第" + x.di + "天 " + x.name + "：" + x.note)) : "没找到特别标注的高光，晒晒美食动线也出片";
    break;
   }
   case "daytext": txt = lines(arr.map((d, i) => "第" + (i + 1) + "天：" + T.dayPeek(d))); break;
   case "why": txt = T.cityFirstLine(city); break;
   case "gem": txt = "彩蛋推荐：" + T.gemOfCity(city); break;
   case "food": txt = lines(T.foodRouteOf(city)); break;
   case "zone": txt = T.stayZoneOf(city); break;
   case "move": txt = T.moveNote(city); break;
   case "weather": txt = T.weatherFallback(city); break;
   case "layer": {
    const d0 = this._plan && this._now()[0] && String(this._now()[0].date).slice(5, 7);
    const mo = d0 ? +d0 : (new Date().getMonth() + 1);
    txt = T.layerOf((city && city.climate) || "temperate", mo) + "（" + (city.name || "") + "·" + (city.climate || "") + "气候）";
    break;
   }
   case "spare": txt = lines(T.spareOfCity(city, 3).map((s, i) => (i + 1) + ". " + s)); break;
   case "fit": txt = T.whoFit(plan || (city ? { days: [] } : null)); break;
   case "end": txt = T.endNoteTxt(city); break;
   /* ---- v1.11 新工具 ---- */
   case "countdown": {
    const c = T.tripPhaseGuide(plan);
    txt = c.txt + "\n行前准备：" + c.prepDone + "/" + c.prepTotal + "（" + c.prepPct + "%）";
    break;
   }
   case "burn": {
    const b = T.burnRate(plan);
    txt = "已花 ¥" + b.spent + "（记账 " + b.nBills + " 笔）\n日均 ¥" + b.rate + "\n" + b.verdict;
    break;
   }
   case "cost": {
    const c = T.costBreakdown(plan);
    txt = (c.rows.length ? c.rows.map(r => r.cat + " ¥" + r.amount + "（" + r.pct + "%）").join("\n") : "还没有记账")
      + (c.warns.length ? "\n⚠ " + c.warns.join("\n⚠ ") : "");
    break;
   }
   case "highlight": {
    const di = 0;
    const h = T.dayHighlight(plan, di);
    txt = "第 1 天最值得：" + h.name + "\n为什么：" + h.why;
    break;
   }
   case "rainy": {
    const r = T.rainyDayPlan(plan, 0);
    txt = r.length ? r.join("\n") : "这一天暂时没找到明确的室内备选，建议把行程里的博物馆/展馆往前挪";
    break;
   }
   case "night": {
    const n = T.nightLifeList(plan, 0);
    txt = n.length ? "晚上可以去：\n" + n.map(x => "· " + x).join("\n") : "这一天没有夜间安排，可让「加景点」挑个夜市";
    break;
   }
   case "crowd": {
    const c = T.crowdAvoid(plan, 0);
    txt = c.length ? c.join("\n") : "没有特别拥挤的热门点，正常逛就行";
    break;
   }
   case "mistake": txt = lines(T.mistakeChecklist(plan).map((x, i) => (i + 1) + ". " + x)); break;
   case "etiquette": txt = lines(T.localEtiquette(city).map(x => "· " + x)); break;
   case "souvenir": txt = lines(T.souvenirOf(city).map(x => "· " + x)); break;
   case "nextcity": {
    const n = T.nextCitySuggest();
    txt = "已点亮 " + n.gone + "/" + n.total + " 座城\n推荐下一站：\n" + n.list.map(x => "· " + x.name + " —— " + x.why).join("\n");
    break;
   }
   case "storage": {
    const s = T.storageHealth();
    txt = s.txt + (s.rows.length ? "\n" + s.rows.map(r => r.key + " " + r.kb + "KB").join("\n") : "") + "\n" + s.tips.join("\n");
    break;
   }
   /* ---- v1.12 新工具 ---- */
   case "bestmonth": txt = "最佳出行：" + T.bestTravelMonth(city); break;
   case "season": {
    const w = T.seasonWeather(city);
    txt = w ? "春：" + w.春 + "\n夏：" + w.夏 + "\n秋：" + w.秋 + "\n冬：" + w.冬 : "暂无气候数据";
    break;
   }
   case "rain": { const r = T.rainLikely(city); txt = (r.high ? "🌧 " : "") + r.txt; break; }
   case "typhoon": { const t = T.typhoonHint(city); txt = (t.risk ? "⚠ " : "") + t.txt; break; }
   case "altitude": {
    const a = T.altitudeRisk(city);
    txt = a.txt + (a.tips ? "\n" + a.tips.map(x => "· " + x).join("\n") : "");
    break;
   }
   case "sun": { const s = T.sunBlockHint(city); txt = (s.strong ? "☀ " : "") + s.txt; break; }
   case "med": txt = lines(T.medKitList(city).map((x, i) => (i + 1) + ". " + x)); break;
   case "scam": txt = lines(T.scamAlertOf(city).map(x => "· " + x)); break;
   case "taboo": txt = lines(T.localTabooOf(city).map(x => "· " + x)); break;
   case "festival": txt = lines(T.festivalOf(city).map(x => "· " + x)); break;
   case "spicy": txt = T.spicyLevelOf(city).txt; break;
   case "foodbudget": txt = T.foodBudgetOf(city).txt; break;
   case "musteat": txt = "必吃 TOP3：\n" + T.foodTop3(city).map((x, i) => (i + 1) + ". " + x).join("\n"); break;
   case "foodstreet": {
    const fs = T.foodStreetOf(city);
    txt = fs.length ? fs.map(x => "· " + x.shop + "（" + x.food + "，人均 " + x.price + "）" + (x.addr ? " @" + x.addr : "")).join("\n") : "暂无美食街区数据，试试「必吃 TOP3」";
    break;
   }
   case "gift": txt = lines(T.giftIdea(city).map(x => "· " + x)); break;
   case "photospot": txt = lines(T.photoSpotOf(city).map(x => "· " + x)); break;
   case "nearby": {
    const nb = T.nearbyCities(city, 6);
    txt = nb.length ? "周边顺路城市：\n" + nb.map(x => "· " + x.name + "（约 " + x.km + " km）").join("\n") : "暂无周边城市数据";
    break;
   }
   case "value": txt = "性价比评分 " + T.valueScoreOf(city) + " / 100"; break;
   case "density": {
    const d = T.itineraryDensity(plan, 0);
    txt = "第 1 天安排 " + d.n + " 个点，节奏「" + d.level + "」\n" + d.txt;
    break;
   }
   case "ticket2": txt = T.ticketTotal(plan).txt; break;
   default: txt = "";
  }
  if (!txt) txt = "暂无可生成内容";
  const addable = !PLAN_TOOLS.includes(k) && !!this._city;
  this.setData({ out: { k, txt }, outAddable: addable });
  wx.showToast({ title: "已生成，可复制", icon: "none" });
 },

 copyOut() {
  const o = this.data.out;
  if (!o) return;
  wx.setClipboardData({ data: o.txt, success: () => wx.showToast({ title: "已复制", icon: "success" }) });
 },

 // v1.19 P2-9：收藏工具结果（落盘，可在「我的收藏」回看 / 复制 / 删除）
 favOut() {
  const o = this.data.out;
  if (!o) { wx.showToast({ title: "先生成一个结果", icon: "none" }); return; }
  const list = this._loadFavs();
  const entry = {
    k: o.k,
    toolT: (this._toolTitle && this._toolTitle[o.k]) || o.k,
    city: this.data.cityName || "",
    txt: o.txt,
    snippet: o.txt.replace(/\n/g, " ").slice(0, 42),
    ts: Date.now()
  };
  list.unshift(entry);
  if (list.length > 30) list.length = 30;
  try { S.set("miniToolFavV1", list); } catch (e) {}
  this.setData({ favs: list, favOpen: true, favIdx: 0 });
  wx.showToast({ title: "已收藏到我的收藏", icon: "none" });
 },
 // v1.19 P2-9：把结果里的地点名提取出来，加入想玩清单（与出发页想玩池互通，可进行程）
 addToWish() {
  const o = this.data.out;
  if (!o || !this.data.cityName) { wx.showToast({ title: "先生成结果并选择城市", icon: "none" }); return; }
  const names = this._extractNames(o.txt);
  if (!names.length) { wx.showToast({ title: "未识别到可加入的地点", icon: "none" }); return; }
  let added = 0;
  names.forEach(nm => { if (T.toggleWish(nm, this.data.cityName)) added++; });
  if (added > 0) wx.showToast({ title: "已加入想玩 " + added + " 个，去出发页勾选", icon: "none" });
  else wx.showToast({ title: "这些地点已在想玩清单", icon: "none" });
 },
 _extractNames(txt) {
  const out = [];
  const seen = new Set();
  const lines = String(txt || "").split("\n");
  for (let li = 0; li < lines.length; li++) {
    const t = lines[li].trim();
    if (!t) continue;
    let nm = "";
    const c0 = t.charAt(0);
    if (c0 === "·" || c0 === "•" || c0 === "-" || c0 === "*") {
      nm = t.slice(1).trim();
    } else if (/^\d+[.、]/.test(t)) { // 有序列表：1. / 2、 / 3.
      nm = t.replace(/^\d+[.、]/, "").trim();
    }
    if (!nm) continue;
    const ob = nm.indexOf("（"), ob2 = nm.indexOf("(");
    const cut = Math.min(ob < 0 ? Infinity : ob, ob2 < 0 ? Infinity : ob2);
    if (cut < nm.length) nm = nm.slice(0, cut);
    nm = nm.trim();
    if (nm && nm.length >= 2 && nm.length <= 20 && !seen.has(nm)) { seen.add(nm); out.push(nm); }
  }
  return out.slice(0, 20);
 },
 toggleFavList() { this.setData({ favOpen: !this.data.favOpen, favIdx: -1 }); },
 expandFav(e) {
  const i = Number(e.currentTarget.dataset.i);
  this.setData({ favIdx: this.data.favIdx === i ? -1 : i });
 },
 delFav(e) {
  const i = Number(e.currentTarget.dataset.i);
  const list = this._loadFavs();
  if (i >= 0 && i < list.length) list.splice(i, 1);
  try { S.set("miniToolFavV1", list); } catch (e2) {}
  this.setData({ favs: list, favIdx: -1 });
 }
});
