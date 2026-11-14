// subpkg/assistant/ai-brain.js —— 小程序「AI 全场景大脑」（离线 · 零网络 · 零合规）
//
// 定位：ai-intent.js 的严格超集。保持完全相同的契约
//   handle(text, ctx) -> { text, actions, intent, jump } | null
// 让任何一个页面 / 入口都能把一句话交给它，得到贴合「这座城 · 这几天 · 这种节奏」的回答，
// 并附带「直达对应页」按钮，从而让 AI 真正覆盖整个小程序的所有使用场景。
//
// 设计边界（与全工程一致）：
//   · 所有内容来自本机离线知识库（travel.js / data.js / emergency.js），零伪造、零联网、零合规风险。
//   · 委派 ai-intent 处理其已覆盖的 6 类（photo/near/cityinfo/spot/nav/sync），未命中再走本模块扩展场景 —— 零回归。
//   · 任何 T.* / emergency.* 调用都包 try/catch 降级：出错或缺数据返回 null（交给调用方回落云端 AI / askAssistant）
//     或返回友好文本 + 跳转按钮，绝不抛错、绝不白屏。
//   · 生成行程复用 utils/app.js 里 getApp() 的真实实例（避免经 getAppSafe 代理调用 setPlan 时 this 错位覆盖 globalData）。

const T = require("../../utils/travel.js");
const DATA = require("../../utils/data.js");
const EMERGENCY = require("../../utils/emergency.js");
const AI_INTENT = require("../../utils/ai-intent.js");
const RECOMMEND = require("../../utils/recommend.js");   // 本地离线推荐引擎（零网络）：recommend(text,opts)->{list,prefs,month,...}
const S = require("../../utils/store.js");               // 多轮会话快照落盘（本地优先，fail-closed）

/* 与 ai-intent 同款 action 构造器（assistant.onAction 消费 path/query/mode） */
function act(path, label, query, mode) { return { label: label, path: path, query: query || {}, mode: mode || "push" }; }

/* ───────── 离线命中可观测（对齐 C16 旅客服务中心「AI 接通状态」思路，但零依赖云） ─────────
 * 计数离线引擎真正解答的次数，让离线 AI 的价值可被看见（无需强模型上线也能体现）。 */
let _hits = 0;
const _hitBy = Object.create(null);
function _bump(k) { _hits++; if (k) _hitBy[k] = (_hitBy[k] || 0) + 1; }
function offlineStats() { return { hits: _hits, byIntent: Object.assign({}, _hitBy) }; }

/* ───────── 离线多轮会话状态（对齐网页端 __webAI.state，落盘 + fail-closed） ─────────
 * 让「成都吃什么」→「那有什么好玩的」沿用上一轮城市，并支持「把第一个加入想玩」指代。
 * 只存可重建的轻量快照（城市 / 意图 / 最近 3 个真实景点 / 轮数），绝不存聊天正文；
 * store 不可用时自动退化为内存态，任何异常都不影响问答主流程。 */
const SESS_KEY = "aiBrainSessionV1";
const FOLLOWUP_RE = /那|这|它|呢|再|还|又|刚才|上面|同一|换成|改成|接着|第一个|第二个/;
let _sess = null;
function _sessLoad() {
  if (_sess) return _sess;
  _sess = { city: "", intent: "", spots: [], turns: 0 };
  try {
    const v = S.get(SESS_KEY, null);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      _sess = {
        city: typeof v.city === "string" ? v.city.slice(0, 20) : "",
        intent: typeof v.intent === "string" ? v.intent.slice(0, 30) : "",
        spots: Array.isArray(v.spots) ? v.spots.filter(x => typeof x === "string").slice(0, 3) : [],
        turns: Number(v.turns) || 0
      };
    }
  } catch (e) {}
  return _sess;
}
function _sessSave() { try { S.set(SESS_KEY, _sessLoad()); } catch (e) {} }
function sessionState() {
  const s = _sessLoad();
  return { city: s.city, intent: s.intent, spots: s.spots.slice(), turns: s.turns };
}
function resetSession() {
  _sess = { city: "", intent: "", spots: [], turns: 0 };
  try { if (S.del) S.del(SESS_KEY); else S.set(SESS_KEY, null); } catch (e) {}
}
// 只在实际给出回答后写入，失败 / 未命中不污染上下文（与 ai-agent 的云端记忆同一纪律）
function _remember(text, r, ctx) {
  try {
    const s = _sessLoad();
    let c = "";
    try { c = (AI_INTENT.cityOf ? AI_INTENT.cityOf(text, "") : "") || ""; } catch (e) {}
    if (!c) c = ctx.city || "";
    if (typeof c === "string" && c.length >= 2 && c.length <= 20) s.city = c;
    if (r.intent) s.intent = r.intent;
    s.turns++;
    let sp = (Array.isArray(r.spots) && r.spots.length) ? String(r.spots[0] || "") : "";
    if (!sp) { try { sp = (AI_INTENT.spotInText && AI_INTENT.spotInText(String(r.text || ""))) || ""; } catch (e) {} }
    if (sp) s.spots = [sp].concat(s.spots.filter(x => x !== sp)).slice(0, 3);
    _sessSave();
  } catch (e) {}
}

/* 本地日期 yyyy-mm-dd */
function localDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* 天数解析：中文数字 / 阿拉伯数字 + 天/日/晚，夹在 1~14 */
const NUM_CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function numOf(s) { return /^\d+$/.test(s) ? parseInt(s, 10) : (NUM_CN[s] || 0); }
function parseDays(text) {
  const m = String(text || "").match(/(\d+|[一二三四五六七八九十两])\s*(?:天|日|晚)/);
  if (!m) return 0;
  const n = numOf(m[1]);
  return n ? Math.max(1, Math.min(14, n)) : 0;
}

/* 页面 → 路由 + 是否 tab */
const PAGE_ROUTE = {
  index: { p: "pages/index/index", tab: true },
  today: { p: "pages/today/today", tab: true },
  plan: { p: "pages/plan/plan", tab: true },
  more: { p: "pages/more/more", tab: true },
  food: { p: "subpkg/food/food", tab: false },
  prep: { p: "subpkg/prep/prep", tab: false },
  spotsearch: { p: "subpkg/spotsearch/spotsearch", tab: false },
  deep: { p: "subai/deep/deep", tab: false },
  ledger: { p: "subpkg/ledger/ledger", tab: false },
  help: { p: "pages/help/help", tab: false },
  lens: { p: "subpkg/lens/lens", tab: false },
  travelsvc: { p: "subpkg/travelsvc/travelsvc", tab: false },
  toolkit: { p: "subpkg/toolkit/toolkit", tab: false },
  myguides: { p: "pages/myguides/myguides", tab: false },
  // 「行程复盘 / 游记」场景在助手页内完成（review），须登记路由，否则直达按钮会错误回落到首页
  assistant: { p: "subpkg/assistant/assistant", tab: false }
};
function routeOf(page) { return PAGE_ROUTE[page] || { p: "pages/index/index", tab: true }; }

/* ───────── 场景注册表（驱动「全场景 AI 速达」面板 / pageSuggestions / topicReply） ───────── */
const SCENARIOS = [
  { key: "generate",       page: "index",      label: "生成行程", icon: "search.png", sample: "帮我生成成都 3 天行程", desc: "选目的地和天数，离线排出逐日安排" },
  { key: "food",           page: "food",       label: "必吃美食", icon: "food.png",   sample: "成都吃什么",          desc: "按城市列出必吃清单与人均" },
  { key: "today",          page: "today",      label: "今天安排", icon: "calendar.png", sample: "今天该干嘛",        desc: "进行中行程的今日速览与花费" },
  { key: "planOptimize",   page: "plan",       label: "行程体检", icon: "ticket.png", sample: "我的行程有没有问题",  desc: "动线/节奏/重复/预算五维体检" },
  { key: "prep",           page: "prep",       label: "出行准备", icon: "home.png",   sample: "要带什么",            desc: "按行程特色生成行李清单" },
  { key: "spotsearch",     page: "spotsearch", label: "按标签找景点", icon: "search.png", sample: "杭州 亲子景点",  desc: "历史/自然/亲子/古镇等主题筛选" },
  { key: "deep",           page: "deep",       label: "深度玩法", icon: "star.png",   sample: "成都深度玩法",        desc: "机位、避坑、当地人玩法" },
  { key: "ledger",         page: "ledger",     label: "花费记账", icon: "coin.png",   sample: "今天花了多少",        desc: "本机账本累计与预算进度" },
  { key: "help-emergency", page: "help",       label: "旅途应急", icon: "shield.png", sample: "附近医院",            desc: "分诊指引 + 就近医院" },
  { key: "lens",           page: "lens",       label: "拍照识景", icon: "camera.png", sample: "拍照识别景点",        desc: "对着建筑拍一张讲讲它的故事" },
  { key: "travelsvc",      page: "travelsvc",  label: "出行服务", icon: "bus.png",    sample: "出行服务",            desc: "订票/打车/机场车站入口" },
  { key: "toolkit",        page: "toolkit",    label: "旅行百宝箱", icon: "coin.png", sample: "工具箱",              desc: "汇率/时差/换算等小工具" },
  { key: "guide",          page: "myguides",   label: "我的攻略", icon: "star.png",   sample: "我的攻略",            desc: "保存与复用生成过的行程" },
  { key: "settings",       page: "more",       label: "设置偏好", icon: "home.png",   sample: "设置",                desc: "主题/字体/偏好/数据管理" },
  { key: "review",         page: "assistant",  label: "行程复盘", icon: "star.png",   sample: "帮我复盘这趟行程",    desc: "基于真实手记/记账/去过的地方升华成游记" }
];

/* ───────── 各扩展场景处理器（返回 {text, actions, intent, jump?} 或 null） ───────── */

/* 生成行程：真正 buildPlan + 写 globalData，再切到行程页（对齐网页版 generatePlan） */
function generatePlan(cityName, days, opts) {
  opts = opts || {};
  let city = null;
  try { if (T.findCity) city = T.findCity(cityName); } catch (e) {}
  if (!city) return { ok: false, msg: "离线知识库里还没有「" + (cityName || "") + "」这座城市，换个已收录的城市（如成都、杭州、西安）试试。" };
  const n = Math.max(1, Math.min(14, parseInt(days, 10) || 3));
  const depart = opts.depart || localDate(new Date(Date.now() + 7 * 86400000));
  let daysArr = null;
  try {
    daysArr = T.buildPlan({
      city: city, days: n, depart: depart,
      budget: opts.budget || "mid", pace: opts.pace || "balance",
      travelMode: opts.travelMode || "", people: opts.people || 1,
      stayMountain: true, picks: opts.picks || [], pickOnly: !!opts.pickOnly, bias: opts.bias || ""
    });
  } catch (e) { return { ok: false, msg: "行程生成失败：" + ((e && e.message) || e) }; }
  if (!daysArr || !daysArr.length) return { ok: false, msg: "这座城市暂时排不出逐日行程，换座城市试试。" };
  const plan = {
    cityName: city.name, province: city.province || "", totalDays: daysArr.length,
    depart: depart, days: daysArr, budget: opts.budget || "mid", customAmt: 0,
    people: opts.people || 1, pace: opts.pace || "balance", travelMode: opts.travelMode || "",
    pickOnly: !!opts.pickOnly, isMulti: false, from: opts.from || { province: "", city: "" },
    savedAt: Date.now(), bias: opts.bias || ""
  };
  const g = (typeof getApp === "function") ? getApp() : null;
  try {
    if (g && typeof g.setPlan === "function") g.setPlan(plan);
    else if (g && g.globalData) g.globalData.plan = plan;
    else return { ok: false, msg: "当前运行环境拿不到 getApp()，行程无法保存。" };
  } catch (e) { return { ok: false, msg: "行程已算出但保存失败：" + ((e && e.message) || e) }; }
  return { ok: true, plan: plan };
}
function runGenerate(text, city, ctx) {
  const c = city || (ctx && ctx.city) || "";
  if (!c) {
    return { text: "先告诉我去哪个城市，比如「帮我生成成都 3 天行程」，我直接排好带你去。", actions: [act("pages/index/index", "打开生成攻略 →", {}, "tab")], intent: "generate" };
  }
  let found = false;
  try { if (T.findCity && T.findCity(c)) found = true; } catch (e) {}
  if (!found) {
    return { text: "离线库里还没有「" + c + "」，换个已收录的城市，或先在生成页选。", actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "generate" };
  }
  const days = parseDays(text) || (ctx && ctx.days) || 3;
  const r = generatePlan(c, days, { budget: ctx && ctx.budget, pace: ctx && ctx.pace, depart: ctx && ctx.depart, from: ctx && ctx.from });
  if (!r.ok) return { text: r.msg, actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "generate" };
  return {
    text: "已为你生成「" + c + "」" + r.plan.totalDays + " 天行程（离线算法）。去行程页看看，随时能改天数、节奏和偏好。",
    actions: [act("pages/plan/plan", "看每日行程 →", {}, "tab"), act("subpkg/prep/prep", "顺便看出行准备 →")],
    intent: "generate",
    jump: { path: "pages/plan/plan", query: {}, mode: "tab" }
  };
}

/* 必吃美食 */
function runFood(text, city, ctx) {
  if (!city) return null;
  let list = [];
  try { if (T.foodSpotsFor) list = T.foodSpotsFor(city) || []; } catch (e) {}
  if (!list.length) {
    return { text: "「" + city + "」的离线美食库还没收录具体店铺，可以先看城市名片，或生成行程沿途找吃的。", actions: [act("subpkg/food/food", "打开美食页 →", { city: city }), act("pages/plan/plan", "生成行程 →", {}, "tab")], intent: "food" };
  }
  let arr = list;
  try { if (T.budgetFoodFirst) arr = T.budgetFoodFirst(list, (ctx && ctx.budget) || "mid", false); } catch (e) {}
  const lines = ["🍜 " + city + " 必吃（离线库 · 前 6）："];
  arr.slice(0, 6).forEach(function (x) {
    const name = (x && (x.shop || x.name)) || "";
    const tip = (x && (x.desc || x.tip || x.special)) || "";
    if (name) lines.push("· " + name + (tip ? "：" + tip : ""));
  });
  lines.push("更多店铺和人均见「美食」页。");
  return { text: lines.join("\n"), actions: [act("subpkg/food/food", "打开美食清单 →", { city: city }), act("pages/plan/plan", "看行程 →", {}, "tab")], intent: "food" };
}

/* 行程体检 / 优化 */
function runPlanOptimize(text, city, ctx) {
  const plan = ctx && ctx.plan;
  if (!plan || !plan.days || !plan.days.length) {
    return { text: "还没有行程，先生成一份，我再帮你体检。", actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "planOptimize" };
  }
  let ck = null;
  try { if (T.planCheckup) ck = T.planCheckup(plan); else if (T.tripCheck) ck = T.tripCheck(plan); } catch (e) {}
  if (!ck) {
    return { text: "暂时没法给行程做体检，去行程页手动看看吧。", actions: [act("pages/plan/plan", "打开行程页 →", {}, "tab")], intent: "planOptimize" };
  }
  const lines = ["🩺 行程体检 · " + (plan.cityName || "") + " " + plan.days.length + " 天 · 得分 " + (ck.score != null ? ck.score : "—")];
  (ck.items || []).slice(0, 5).forEach(function (it) {
    lines.push("· " + (it.label || "") + "：" + (it.ok ? "✓" : "✗") + (it.detail ? "（" + it.detail + "）" : ""));
  });
  if (ck.tips && ck.tips.length) lines.push("建议：" + ck.tips.slice(0, 3).join("；"));
  return { text: lines.join("\n"), actions: [act("pages/plan/plan", "打开行程页 →", {}, "tab"), act("subpkg/prep/prep", "出行准备 →")], intent: "planOptimize" };
}

/* 今天 / 进行中行程速览 */
function runToday(text, city, ctx) {
  const plan = ctx && ctx.plan;
  if (!plan || !plan.days || !plan.days.length) {
    return { text: "还没有进行中的行程。生成一份，我就能告诉你今天该干嘛、花了多少。", actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "today" };
  }
  let st = null;
  try { if (T.todayState) st = T.todayState(plan); } catch (e) {}
  const lines = ["📅 今天速览 · " + (plan.cityName || "")];
  if (st) {
    if (st.phase === "before") lines.push("距出发还有 " + st.daysLeft + " 天（出发日 " + String(plan.depart || "").slice(0, 10) + "）。");
    else if (st.phase === "during") lines.push("正在进行第 " + st.dayNo + "/" + st.total + " 天。");
    else lines.push("这趟行程已结束，下次出发前随时喊我。");
  }
  let today = 0, total = 0;
  try { if (T.todaySpent) today = Math.round(Number(T.todaySpent()) || 0); } catch (e) {}
  try { if (T.totalSpent) total = Math.round(Number(T.totalSpent()) || 0); } catch (e) {}
  if (today || total) lines.push("花费：今天 ¥" + today + " · 全程累计 ¥" + total + "（账本数据）。");
  return { text: lines.join("\n"), actions: [act("pages/today/today", "打开今天 →", {}, "tab"), act("subpkg/ledger/ledger", "记账本 →")], intent: "today" };
}

/* 出行准备 / 行李 */
function runPrep(text, city, ctx) {
  const plan = ctx && ctx.plan;
  let extra = [];
  try { if (plan && T.packExtra) extra = T.packExtra(plan); } catch (e) {}
  const lines = ["🎒 出行准备" + (plan ? " · " + (plan.cityName || "") : "")];
  if (extra && extra.length) lines.push("按你行程的特色，建议带上：" + extra.join("、") + "。");
  else lines.push("通用清单已在「出行准备」页整理好（证件、药、充电宝等）。");
  lines.push("打开准备页还能生成自动行李清单。");
  return { text: lines.join("\n"), actions: [act("subpkg/prep/prep", "打开出行准备 →"), act("pages/plan/plan", "看行程 →", {}, "tab")], intent: "prep" };
}

/* 按标签找景点 */
function runSpotSearch(text, city, ctx) {
  const tagMap = [["亲子", "带娃友好"], ["历史古迹", "古迹遗址"], ["自然风光", "山水自然"], ["博物馆", "展馆研学"], ["古镇", "古巷慢游"], ["海滨", "海岛沙滩"], ["乐园", "亲子游乐"], ["徒步", "登山徒步"]];
  const lines = ["🔎 按标签找景点"];
  lines.push("试试这些主题：" + tagMap.map(function (x) { return x[0]; }).join("、") + "。");
  lines.push("直接说「成都 亲子景点」或「杭州 古镇」，我帮你筛。");
  return { text: lines.join("\n"), actions: [act("subpkg/spotsearch/spotsearch", "打开标签检索 →", city ? { city: city } : {}), act("subai/deep/deep", "城市深度玩法 →", city ? { city: city } : {})], intent: "spotsearch" };
}

/* 深度玩法 */
function runDeep(text, city, ctx) {
  if (!city) return null;
  let arr = [];
  try { if (T.photoSpotOf) arr = T.photoSpotOf(city) || []; } catch (e) {}
  const lines = ["🧭 " + city + " 深度玩法"];
  if (arr && arr.length) lines.push("出片/机位：" + arr.slice(0, 4).map(function (s) { return (s && (s.name || s)) || ""; }).filter(Boolean).join("、") + "。");
  lines.push("避坑、当地人玩法、citywalk 路线都在「深度玩法」页。");
  return { text: lines.join("\n"), actions: [act("subai/deep/deep", "打开深度玩法 →", { city: city }), act("subpkg/spotsearch/spotsearch", "按标签找景点 →", { city: city })], intent: "deep" };
}

/* 花费 / 记账 */
function runLedger(text, city, ctx) {
  let today = 0, total = 0, gauge = null;
  try { if (T.todaySpent) today = Math.round(Number(T.todaySpent()) || 0); } catch (e) {}
  try { if (T.totalSpent) total = Math.round(Number(T.totalSpent()) || 0); } catch (e) {}
  try { if (ctx && ctx.plan && T.budgetGauge) gauge = T.budgetGauge(ctx.plan); } catch (e) {}
  const lines = ["💰 花费速览"];
  lines.push("今天账本：¥" + today + " · 全程累计：¥" + total + "（来自本机账本）。");
  if (gauge && gauge.txt) lines.push("预算：" + gauge.txt + (gauge.pct != null ? "（进度 " + gauge.pct + "%）" : ""));
  lines.push("逐笔记录与分类在「记账」页。");
  return { text: lines.join("\n"), actions: [act("subpkg/ledger/ledger", "打开记账本 →"), act("pages/today/today", "打开今天 →", {}, "tab")], intent: "ledger" };
}

/* 旅途应急：分诊 + 就近医院（复用 emergency.js，零诊疗结论） */
function runEmergency(text, city, ctx) {
  let tr = [];
  try { if (EMERGENCY && EMERGENCY.triage) tr = EMERGENCY.triage(text) || []; } catch (e) {}
  const lines = ["🚑 旅途应急"];
  if (tr && tr.length) {
    tr.slice(0, 3).forEach(function (t) { lines.push("· 可能挂「" + (t.dept || "急诊") + "」：" + (t.tip || "")); });
  } else {
    lines.push("遇到急症先拨打 120；骨折/出血/中暑等常见情况的处理要点见「旅途应急」页。");
  }
  const c = city || (ctx && ctx.plan && ctx.plan.cityName) || "";
  if (c) {
    let hs = [];
    try { if (EMERGENCY && EMERGENCY.hospitalsOf) hs = EMERGENCY.hospitalsOf(c) || []; } catch (e) {}
    if (hs && hs.length) lines.push(c + " 就近医院（按距城心排序，非推荐）：" + hs.slice(0, 3).map(function (h) { return (h && (h.name || h)) || ""; }).filter(Boolean).join("、") + "。");
    else if (EMERGENCY && EMERGENCY.isApprox && EMERGENCY.isApprox(c)) lines.push(c + " 暂未收录具名医院，建议用地图搜「医院」就近就医。");
  }
  lines.push("我们只做分诊指引，不替代医生诊断。");
  return { text: lines.join("\n"), actions: [act("pages/help/help", "打开旅途应急 →"), act("subpkg/map/map", "看地图找医院 →")], intent: "help-emergency" };
}

/* ── 追问路由：本轮没点名城市时，把上一轮城市补进问题重新分发（只重入一层，防自环） ── */
const FOLLOWUP_ROUTES = [
  { re: /好吃|吃|美食|餐厅|小吃|必吃|吃什么/, q: c => c + "吃什么" },
  { re: /好玩|景点|必去|打卡|玩什么|逛|去哪/, q: c => c + "有哪些必去" },
  { re: /出片|拍照|机位|摄影|拍什么/, q: c => c + "哪里出片" },
  { re: /几月|什么时候|季节|最佳|月份/, q: c => c + "几月去最好" },
  { re: /附近|周边|顺路/, q: c => c + "附近还有哪好玩" },
  { re: /介绍|概况|名片|适合玩几天/, q: c => c + "介绍一下" },
  { re: /穿|带伞|冷|热|衣服|外套/, q: c => c + "穿什么" }
];
function runFollowup(text, ctx) {
  const c = ctx.city || "";
  if (!c) return null;
  for (let i = 0; i < FOLLOWUP_ROUTES.length; i++) {
    const rt = FOLLOWUP_ROUTES[i];
    if (!rt.re.test(text)) continue;
    let inner = null;
    try { inner = _dispatch(rt.q(c), Object.assign({}, ctx, { __followup: false })); } catch (e) {}
    if (inner) return inner;
  }
  return null;
}

/* 城市代表景点：只用 SPOT_COORDS 里的真实点位名，零伪造 */
function runLandmarks(text, city) {
  if (!city) return null;
  let arr = [];
  try { arr = (DATA && DATA.SPOT_COORDS && DATA.SPOT_COORDS[city]) || []; } catch (e) { arr = []; }
  const names = [], seen = Object.create(null);
  for (let i = 0; i < arr.length && names.length < 8; i++) {
    const it = arr[i];
    let n = Array.isArray(it) ? it[0] : (it && (it.name || it.n)) || "";
    if (typeof n !== "string" || !n) continue;
    try { n = (T.cleanSpotName ? T.cleanSpotName(n) : n) || n; } catch (e) {}
    if (seen[n]) continue;
    seen[n] = 1; names.push(n);
  }
  if (!names.length) return {
    text: "「" + city + "」暂时没有逐点资料（不编造景点名）。可以先生成行程，或去「按标签找景点」按主题筛。",
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →"), act("pages/index/index", "去生成攻略 →", {}, "tab")],
    intent: "landmark"
  };
  const lines = ["🏞 " + city + " 代表景点（离线库真实点位）："];
  names.forEach((n, i) => lines.push((i + 1) + ". " + n));
  lines.push("想排进行程、看顺路度和导航，点下面直达。");
  return {
    text: lines.join("\n"),
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →", { city }),
      act("subai/deep/deep", "城市深度玩法 →", { city }),
      act("pages/plan/plan", "看每日行程 →", {}, "tab")],
    intent: "landmark", spots: names
  };
}

/* 穿衣 / 带伞：离线气候库 + 出发月份，绝不编实时天气 */
function runDress(text, city, ctx) {
  const c = city || (ctx && ctx.plan && ctx.plan.cityName) || "";
  let d = null, brief = null;
  try {
    const obj = c && T.findCity ? T.findCity(c) : null;
    if (obj && T.dressForMonth) d = T.dressForMonth(obj, (ctx && ctx.plan && ctx.plan.depart) || "");
  } catch (e) {}
  try { if (c && T.cityBrief) brief = T.cityBrief(c); } catch (e) {}
  const lines = ["🧥 " + (c ? c + " " : "") + "穿衣与随身建议（离线气候库，非实时天气）"];
  if (d) {
    lines.push("· " + (d.season || "") + (d.weather ? "：" + d.weather : ""));
    (d.lines || []).slice(0, 3).forEach(x => { if (x) lines.push("· " + x); });
    if (d.acc) lines.push("· 配件：" + d.acc);
    if (d.tip) lines.push("· " + d.tip);
  } else if (brief && brief.climateTxt) {
    lines.push("· 气候：" + brief.climateTxt + "。");
    lines.push("· 逐月穿衣清单在「出行准备」页按出发日期生成。");
  } else {
    lines.push("· 说个具体城市（如「成都 11 月穿什么」），我按离线气候库给建议。");
  }
  lines.push("实时天气以 App 内天气页为准（联网获取），这里不编造温度与降雨。");
  return {
    text: lines.join("\n"),
    actions: [act("subpkg/prep/prep", "打开出行准备 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
    intent: "dress"
  };
}

/* 当天动线：按真实坐标估算，不编造点位与距离 */
function runRoute(text, city, ctx) {
  const plan = ctx && ctx.plan;
  if (!plan || !plan.days || !plan.days.length) return {
    text: "还没有行程动线。先说「帮我生成成都 3 天行程」，我再按真实坐标算当天走多少路。",
    actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")],
    intent: "route"
  };
  let st = null;
  try { st = T.todayState ? T.todayState(plan) : null; } catch (e) {}
  const di = (st && st.phase === "during") ? (st.idx || 0) : 0;
  const day = plan.days[di] || {};
  let mv = null;
  try { mv = T.dayMove ? T.dayMove(day, plan.cityName) : null; } catch (e) {}
  const lines = ["🧭 第 " + (di + 1) + " 天动线（按离线库真实坐标估算）"];
  if (mv) lines.push("· 全程约 " + mv.km + " km、步行约 " + mv.steps + " 步。");
  const items = (day.items || []).slice(0, 4).map(it => {
    const n = (it && (it.name || it.disp)) || "";
    try { return (T.cleanSpotName && T.cleanSpotName(n)) || n; } catch (e) { return n; }
  }).filter(Boolean);
  if (items.length) lines.push("· 当天点位：" + items.join(" → "));
  if (!mv && !items.length) lines.push("· 这一天还没排入可定位的点位，去行程页加几个景点再看动线。");
  lines.push("· 逐点导航在地图页点任意一行即可唤起。");
  return {
    text: lines.join("\n"),
    actions: [act("subpkg/map/map", "看当天地图 →", { di }),
      act("pages/plan/plan", "打开每日行程 →", {}, "tab")],
    intent: "route"
  };
}

/* ── 写操作（对齐网页版内置 AI）：一句话记账 / 把真实景点加入想玩 ──
 * 只写本机离线数据；景点名必须能在离线库里查到，绝不写没收录的名字（零伪造、不脏数据）。
 * 这两条要放在 NEW_INTENTS 最前：「记账」否则会被 ledger 的「花了多少」查询意图抢走。 */
function realSpotOf(name) {
  const nm = String(name || "").trim();
  if (nm.length < 2) return null;
  const coords = (DATA && DATA.SPOT_COORDS) || {};
  const cities = Object.keys(coords);
  // 精确优先，并带回景点真实所属城市（否则「西湖」会被记到上一轮聊的成都名下）
  for (let i = 0; i < cities.length; i++) {
    const arr = coords[cities[i]] || [];
    for (let j = 0; j < arr.length; j++) {
      const s = Array.isArray(arr[j]) ? arr[j][0] : (arr[j] && arr[j].name ? arr[j].name : arr[j]);
      if (typeof s === "string" && s === nm) return { name: s, city: cities[i] };
    }
  }
  if (DATA && DATA.SPOT_DETAILS && DATA.SPOT_DETAILS[nm]) return { name: nm, city: "" };
  return null;
}
function runQuickBill(text) {
  const m = text.match(/^(?:帮我|请|给我)?\s*(?:记一笔|记一下|记个账|记下|加一笔|记账)\s*(.+)$/);
  if (!m) return null;
  let b = null;
  try { b = T.parseQuickBill ? T.parseQuickBill(m[1]) : null; } catch (e) {}
  if (!b) return {
    text: "没从「" + m[1] + "」里识别出金额。写成「记一笔 打车 32」这种带数字的说法就行～",
    actions: [act("subpkg/ledger/ledger", "打开账本 →")], intent: "quickBill"
  };
  try {
    T.addLedger(b.amt, b.cat, b.name);
    return {
      text: "已记下 ¥" + b.amt + " · " + b.cat + " · " + b.name + "（写入本机账本；说「今天花了多少」可查，去账本页可删）。",
      actions: [act("subpkg/ledger/ledger", "打开账本核对 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
      intent: "quickBill"
    };
  } catch (e) {
    return { text: "写入账本失败：" + ((e && e.message) || e), actions: [act("subpkg/ledger/ledger", "打开账本 →")], intent: "quickBill" };
  }
}
function runAddWish(text, city, ctx) {
  const m = text.match(/(?:把|将)?\s*(.{2,24}?)\s*(?:加入|加到|放进|加进|添加进|添加到)\s*想玩/) ||
    text.match(/想玩(?:清单|列表|池)?\s*(?:里)?\s*(?:加|添加|加入)\s*(.{2,24})/);
  if (!m) return null;
  let raw = String(m[1] || "").trim();
  if (/第一个|刚才|上面|它|这个|那个/.test(raw)) return {
    text: "小程序端直接点景点行的「想玩」就好；也可以说完整的景点名，比如「把西湖加入想玩」。",
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "addWish"
  };
  raw = raw.replace(/^(?:把|将|这个|那个)\s*/, "").replace(/[，。！？!?,.]$/, "").trim();
  const real = realSpotOf(raw);
  if (!real) return {
    text: "离线景点库里没找到「" + raw + "」，我不把没收录的名字写进想玩清单。可以说得更准确些，或先问「成都有什么必去」再挑一个。",
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "addWish"
  };
  const wishCity = real.city || (ctx && ctx.plan && ctx.plan.cityName) || city || "";
  let was = false;
  try { was = !!(T.isWished && T.isWished(real.name)); } catch (e) {}
  try { T.toggleWish(real.name, wishCity); }
  catch (e) { return { text: "写入想玩清单失败：" + ((e && e.message) || e), actions: [], intent: "addWish" }; }
  return {
    text: (was ? "已从想玩清单移除" : "已加入想玩清单") + "：" + real.name +
      (wishCity ? "（" + wishCity + "）" : "") + "。再说一次可" + (was ? "重新加入" : "取消") + "；生成行程时会优先排进去。",
    actions: [act("pages/index/index", "去生成攻略 →", {}, "tab"), act("subpkg/spotsearch/spotsearch", "按标签找景点 →")],
    intent: "addWish"
  };
}

/* 其余场景：以「一句话介绍 + 直达按钮」把用户带到对应页（这些页本身已是专业工具，AI 负责入口与语境） */
function runLens() { return { text: "用「拍照识景」对着建筑/招牌拍一张，我会识别并讲讲它的故事（离线识别，无需联网）。", actions: [act("subpkg/lens/lens", "打开拍照识景 →")], intent: "lens" }; }
function runTravelSvc() { return { text: "「出行服务」页集合了订票、打车、机场/车站、值机等常用入口，按城市自动匹配。", actions: [act("subpkg/travelsvc/travelsvc", "打开出行服务 →")], intent: "travelsvc" }; }
function runToolkit() { return { text: "「旅行百宝箱」有汇率换算、时差、单位换算、证件清单等小工具，离线可用。", actions: [act("subpkg/toolkit/toolkit", "打开百宝箱 →")], intent: "toolkit" }; }
function runGuide() { return { text: "「我的攻略」里保存着你生成过的行程，可随时翻看、复用、再编辑。", actions: [act("pages/myguides/myguides", "打开我的攻略 →")], intent: "guide" }; }
function runSettings() { return { text: "「更多」页里有主题（深/浅色）、字体大小、偏好、数据管理等设置。", actions: [act("pages/more/more", "打开更多设置 →", {}, "tab")], intent: "settings" }; }

/* ───────── 离线扩面：推荐城市 / 最佳季节（补齐「离线优先」真空，零网络） ───────── */

/* 月份数组 → 紧凑区间文本：如 [3,4,5,9,10,11] → "3-5月、9-11月" */
function fmtMonths(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  if (typeof arr[0] === "number") {
    const nums = arr.slice().sort(function (a, b) { return a - b; });
    const parts = []; let s = nums[0], p = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === p + 1) { p = nums[i]; }
      else { parts.push(s === p ? (s + "月") : (s + "-" + p + "月")); s = p = nums[i]; }
    }
    parts.push(s === p ? (s + "月") : (s + "-" + p + "月"));
    return parts.join("、");
  }
  return arr.join("、");
}

/* 推荐城市：复用本地 recommend 引擎（按偏好标签打分，零网络），返回带理由的榜单 */
function runRecommend(text, city, ctx) {
  let res = null;
  try { if (RECOMMEND && RECOMMEND.recommend) res = RECOMMEND.recommend(text, { month: (ctx && ctx.month) || (new Date().getMonth() + 1), topN: 5 }); } catch (e) {}
  if (!res || res.pending || !res.list || !res.list.length) {
    return { text: "离线知识库还没法推荐，换个说法（如「推荐几个适合亲子的城市」「想去海边」）或打开「按标签找景点」。", actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "recommend" };
  }
  const hasTag = res.prefs && res.prefs.tags && res.prefs.tags.length;
  const lines = ["🌟 离线推荐" + (hasTag ? "（已按你的偏好）" : "") + "："];
  res.list.slice(0, 5).forEach(function (x, i) {
    lines.push((i + 1) + ". " + (x.name || "") + (x.province ? "（" + x.province + "）" : "") + " · " + (x.seasonNote || x.reasonTag || "综合推荐"));
  });
  lines.push("点城市名可直接生成行程；想更精准就说「海边+亲子+5天」这类组合。");
  return { text: lines.join("\n"), actions: [act("pages/index/index", "去生成攻略 →", {}, "tab"), act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "recommend" };
}

/* 最佳季节：复用 cityBrief + T.bestMonths（零网络），给"几月去最好"类问题接地回答 */
function runBestTime(text, city, ctx) {
  if (!city) return null;
  let cb = null, months = null;
  try { if (T.cityBrief) cb = T.cityBrief(city); } catch (e) {}
  try { if (T.bestMonths && cb && cb.best) months = T.bestMonths(cb.best); } catch (e) {}
  const lines = ["🗓 " + city + " 什么时候去最好"];
  if (months && months.length) lines.push("最佳月份：" + fmtMonths(months) + "。");
  else if (cb && cb.best && cb.best !== "四季皆宜") lines.push("最佳：" + cb.best + "。");
  else lines.push("四季皆宜，全年都能去。");
  if (cb && cb.climateTxt) lines.push("气候：" + cb.climateTxt + "。");
  if (cb && cb.costTxt) lines.push("花费参考：" + cb.costTxt + "。");
  lines.push("具体几天的天气以 App 内天气页为准（联网获取）。");
  return { text: lines.join("\n"), actions: [act("pages/index/index", "去生成攻略 →", {}, "tab"), act("subpkg/food/food", "看看美食 →", { city: city })], intent: "besttime" };
}

/* ───────── 扩展意图表（顺序：更具体者优先） ───────── */
const NEW_INTENTS = [
  // 明确指令的写操作优先：「记账」若落到后面会被 ledger 查询意图抢走，变成答非所问
  { key: "quickBill", kw: /^(?:帮我|请|给我)?\s*(?:记一笔|记一下|记个账|记下|加一笔|记账)\s*.+/, run: runQuickBill },
  { key: "addWish",  kw: /(?:加入|加到|放进|加进|添加进|添加到)\s*想玩|想玩(?:清单|列表|池)?\s*(?:里)?\s*(?:加|添加|加入)/, run: runAddWish },
  { key: "help-emergency", kw: /医院|急救|受伤|骨折|出血|中暑|高原反应|晕倒|胸痛|急诊|食物.*(中毒|过敏)|不舒服|拉肚子|发烧|过敏/, run: runEmergency },
  { key: "recommend",      kw: /推荐|想去|去哪.*(好|玩|合适|舒服)|哪里.*(好玩|适合|舒服)|适合.*(去|玩|城市|地方|目的地)|小众.*(目的地|城市|玩法)/, run: runRecommend },
  { key: "besttime",       kw: /几月去|什么时候去|最佳.*(季节|月份|时间)|什么.*(季节|月份).*去|避开.*(人潮|旺季)|(季节|月份).*最好|适合玩几天|最佳出行/, run: runBestTime },
  { key: "dress",          kw: /穿什么|穿衣|穿啥|带伞|带.*(外套|衣服)|冷不冷|热不热|几月穿|天气.*(穿|带)/, run: runDress },
  { key: "planOptimize",   kw: /行程.*(合理|问题|体检|优化|挑毛病|太赶|调整|改一下|有没有|顺不顺)|挑毛病|体检.*行程|排得.*(太|不)/, run: runPlanOptimize },
  { key: "route",          kw: /怎么走|动线|走多少|几公里|今天.*(路线|怎么走)|第.*天.*(路线|怎么走)|顺路吗/, run: runRoute },
  { key: "generate",       kw: /生成|做一份|排一份|安排一下|帮我排|来一份|规划|日游|几天|怎么安排|定制行程|排个行程|出个行程/, run: runGenerate },
  { key: "food",           kw: /吃什么|吃啥|美食|必吃|好吃的|当地菜|特色菜|餐厅|馆子|小吃|夜市/, run: runFood },
  { key: "landmark",       kw: /有哪些必去|必去|有什么好玩|好玩的|景点推荐|地标|玩什么|值得一去|代表景点/, run: runLandmarks },
  { key: "today",          kw: /今天.*(安排|干嘛|干什么|玩什么|还剩|花了多少|去哪)|今天去哪|下一站|明天去哪|倒计时|还有几天出发|出发还有|今天行程/, run: runToday },
  { key: "prep",           kw: /带什么|行李|准备什么|打包|出行前|要准备|必备|收拾/, run: runPrep },
  { key: "ledger",         kw: /花了多少|记账|预算|超支|账本|花费|消费了多少|今天.*花/, run: runLedger },
  { key: "deep",           kw: /深度玩法|机位|避坑|当地人|小众玩法|citywalk|city walk|冷门玩法/, run: runDeep },
  { key: "spotsearch",     kw: /找.*景点|按标签|标签.*景点|亲子.*(景点|游)|小众.*景点|冷门.*景点|适合的景点/, run: runSpotSearch },
  { key: "lens",           kw: /拍照识别|识景|拍照识|扫一下|拍一下认|这是什么建筑|识别景点/, run: runLens },
  { key: "travelsvc",      kw: /出行服务|订票|打车|机场|车站|值机|航班/, run: runTravelSvc },
  { key: "toolkit",        kw: /工具箱|百宝箱|换算|时差|计算器|工具/, run: runToolkit },
  { key: "guide",          kw: /我的攻略|收藏的攻略|保存的攻略|历史攻略|我的行程列表|攻略列表/, run: runGuide },
  { key: "settings",       kw: /设置|偏好|主题|夜间模式|深色模式|浅色|字号|字体大小|账号管理/, run: runSettings },
  /* 行程复盘/游记：基于本机真实素材（手记/记账/去过的地方）升华，零编造；关键词独立、不抢其它高频意图 */
  { key: "review",         kw: /复盘|游记|回忆一下|写篇游记|帮我写.*(游记|复盘)|旅行总结|这趟.*(总结|复盘)|回来.*(总结|复盘)|旅途.*(总结|回忆)/, run: runReview },
  /* 景点讲解：放最后（最低优先级），仅当句子是「动词+景点名」或「X的故事」且本机资料能命中该景点时才触发，不抢食/今天等高频意图 */
  { key: "spot",           kw: /^(讲讲|讲一下|介绍一下|介绍|讲解|科普|聊聊|说说|了解)\s*[一-龥A-Za-z0-9]{1,14}$|[一-龥A-Za-z0-9]{1,14}的故事$|讲讲这个|介绍这个/, run: runSpotExplain }
];

/* ───────── 景点讲解：把单个景点用 AI 讲活（离线真实库 + 云端延伸，零伪造） ─────────
 * 离线：直接复用 T.spotLookup 的真实收录（介绍/怎么玩/怎么去/门票），零网络、零编造。
 * 云端（由调用方 assistant.onSpotAI 负责）：把本地资料作 grounding 交给强模型延伸讲解，
 * 本函数只产出离线基线，绝不编造坐标/票价/年代。 */
function extractSpot(text, city) {
  text = (text || "").trim();
  if (!text || text.length > 30) return "";
  let keys = [];
  try {
    const D = DATA || {};
    if (D.SPOT_DETAILS) keys = keys.concat(Object.keys(D.SPOT_DETAILS));
    if (city && D.SPOT_DETAILS_BY_CITY && D.SPOT_DETAILS_BY_CITY[city]) keys = keys.concat(Object.keys(D.SPOT_DETAILS_BY_CITY[city]));
  } catch (e) {}
  keys.sort(function (a, b) { return b.length - a.length; });   // 长匹配优先，避免「园」类短键误命中
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] && text.indexOf(keys[i]) >= 0) return keys[i];
  }
  return "";
}
function runSpotExplain(text, city, ctx) {
  ctx = ctx || {};
  let name = (ctx.spot || "").trim();
  if (!name) {
    name = String(text || "").replace(/^(讲讲|讲一下|介绍一下|介绍|讲解|科普|聊聊|说说|了解下?|讲)\s*/i, "")
      .replace(/[？?。.！!，,~～].*$/, "").trim();
  }
  if (!name) name = extractSpot(text, city);
  if (!name) return { text: "告诉我具体哪个景点，比如「讲讲故宫」，我用 App 本地真实资料给你讲讲。", actions: [], intent: "spot" };
  let r = null;
  try { if (T.spotLookup) r = T.spotLookup(name, city); } catch (e) {}
  if (!r || !r.found) {
    return { text: "本机还没收录「" + name + "」的详细资料，换个景点名试试，或到当地随走随问。", actions: ctx.plan ? [act("pages/plan/plan", "看行程 →", {}, "tab")] : [], intent: "spot" };
  }
  const lines = ["📖 " + r.name + (r.city ? "（" + r.city + "）" : "")];
  if (r.intro) lines.push(r.intro);
  if (r.how) lines.push("怎么玩：" + r.how);
  if (r.route) lines.push("怎么去：" + r.route);
  if (r.ticket && r.ticket.known) lines.push("门票：" + (r.ticket.price || "") + (r.ticket.book ? "（需预约）" : "") + (r.ticket.where ? " · " + r.ticket.where : ""));
  if (r.booking) lines.push("预约提示：" + r.booking);
  lines.push("（离线模式：以上为 App 本地真实收录；联网后点「AI 讲解这个景点」可获取延伸讲解）");
  const acts = [act("subpkg/map/map", "地图找它 →")];
  if (ctx.plan) acts.push(act("pages/plan/plan", "看行程 →", {}, "tab"));
  return { text: lines.join("\n"), actions: acts, intent: "spot" };
}

/* ───────── 行程复盘 / 游记：基于本机真实素材（手记/记账/去过的地方）升华，零编造 ─────────
 * 离线：直接汇总真实素材给结构化复盘卡；云端（调用方 assistant.explainReview 负责）把真实素材作 grounding 让强模型写游记。
 * 本函数只产出离线基线 + ground（真实素材原文），绝不编造没去过的点/没发生的花费。 */
function runReview(text, city, ctx) {
  ctx = ctx || {};
  const plan = ctx.plan;
  if (!plan || !plan.days || !plan.days.length) {
    return { text: "还没有行程，先生成一份，旅途中记点笔记、花点钱，回来我帮你写复盘/游记。", actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "review" };
  }
  let notes = [], ledger = [], total = 0;
  try { if (T.getNotes) notes = T.getNotes() || []; } catch (e) {}
  try { if (T.getLedger) ledger = T.getLedger() || []; } catch (e) {}
  try { if (T.totalSpent) total = Math.round(Number(T.totalSpent()) || 0); } catch (e) {}
  const seen = new Set(), spots = [];
  try {
    for (const d of plan.days) {
      if (!d || !Array.isArray(d.items)) continue;
      for (const it of d.items) {
        const n = (it && (it.name || it.disp)) || "";
        if (!n || (T.isFrameName && T.isFrameName(n))) continue;
        const k = (T.cleanSpotName && T.cleanSpotName(n)) || n;
        if (seen.has(k)) continue;
        seen.add(k); spots.push(n);
        if (spots.length >= 20) break;
      }
      if (spots.length >= 20) break;
    }
  } catch (e) {}
  const ground = [];
  ground.push("行程：" + (plan.cityName || "") + "，" + plan.days.length + " 天。");
  if (spots.length) ground.push("去过的点（" + spots.length + "）：" + spots.join("、") + "。");
  if (notes.length) ground.push("旅行手记（" + notes.length + " 条）：\n" + notes.slice(0, 12).map(function (n) { return "· " + (n.date || "") + " " + (n.txt || ""); }).join("\n"));
  if (ledger.length) ground.push("记账条目 " + ledger.length + " 笔，累计 ¥" + total + "。");
  else if (total > 0) ground.push("累计花费 ¥" + total + "。");
  const lines = ["📓 行程复盘 · " + (plan.cityName || "") + " " + plan.days.length + " 天"];
if (spots.length) lines.push("去过的点：" + spots.slice(0, 12).join("、") + (spots.length > 12 ? " 等" : ""));
  if (notes.length) lines.push("记了 " + notes.length + " 条手记，最近一句：「" + ((notes[notes.length - 1] && notes[notes.length - 1].txt) || "") + "」");
  if (total > 0) lines.push("这趟累计花了 ¥" + total + "（记账 " + ledger.length + " 笔）。");
  lines.push("（离线模式：以上为本机真实素材摘要；联网点「AI 帮我写游记」可生成完整复盘）");
  const acts = [act("subpkg/ledger/ledger", "看记账本 →"), act("pages/today/today", "写手记 →", {}, "tab")];
  return { text: lines.join("\n"), actions: acts, intent: "review", ground: ground.join("\n") };
}

/* ───────── 主入口：与 ai-intent 完全一致的契约 ───────── */
function handle(text, ctx) {
  text = (text || "").trim();
  if (!text) return null;
  ctx = ctx || {};
  const sess = _sessLoad();
  // ① 追问沿用上一轮城市：本轮没点名城市、调用方也没有真实行程城市时，
  //    把上一轮城市注入 ctx，让「那有什么好玩的」「换成美食」能接着聊而不是甩泛话。
  //    调用方 ctx.city（来自真实行程）优先级始终最高，不覆盖。
  let askedCity = "";
  try { askedCity = (AI_INTENT.cityOf ? AI_INTENT.cityOf(text, "") : "") || ""; } catch (e) {}
  if (!askedCity && !ctx.city && sess.city && FOLLOWUP_RE.test(text)) {
    ctx = Object.assign({}, ctx, { city: sess.city, __followup: true });
  }
  // ② 指代消解：把「第一个 / 它 / 刚才那个」还原成最近列出的真实景点名（零伪造，只用库内名字）
  if (sess.spots.length && /想玩|讲解|介绍|讲讲/.test(text) && /第一个|刚才那|它|这个|那个/.test(text)) {
    text = text.replace(/第一个|刚才那(?:个)?|它|这个|那个/g, sess.spots[0]);
  }
  // ③ 追问路由：补上城市后重新分发一次，让「那有什么好玩的」真的给出该城景点而非泛话
  if (ctx.__followup) {
    const fr = runFollowup(text, ctx);
    if (fr) { _bump("followup"); _remember(text, fr, ctx); return fr; }
  }
  const r = _dispatch(text, ctx);
  if (r) _remember(text, r, ctx);   // 只在真给出回答后写入，未命中不污染上下文
  return r;
}

/* 真正的一轮分发（原 handle 主体，保持委派顺序与零回归契约不变） */
function _dispatch(text, ctx) {
  // ① 先委派 ai-intent（photo/near/cityinfo/spot/nav/sync），零回归
  try {
    const delegated = AI_INTENT.handle(text, ctx);
    if (delegated) { _bump(delegated.intent || "delegated"); return delegated; }
  } catch (e) { /* ai-intent 异常不应阻断扩展场景 */ }
  const city = (AI_INTENT.cityOf ? AI_INTENT.cityOf(text, ctx.city) : (ctx.city || "")) || (ctx.city || "");
  // ② 走扩展场景，首个命中即返回
  for (let i = 0; i < NEW_INTENTS.length; i++) {
    const sc = NEW_INTENTS[i];
    if (sc.kw.test(text)) {
      try {
        const r = sc.run(text, city, ctx);
        if (r) { _bump(sc.key); return r; }
      } catch (e) { /* 单个场景出错不阻断其它场景 */ }
    }
  }
  return null;
}

/* ───────── 对外辅助（驱动面板 / 深链 / 其它页面场景自感知） ───────── */
function allScenarios() { return SCENARIOS.slice(); }
function scenarioFor(page) { return SCENARIOS.filter(function (s) { return s.page === page; }); }
function scenarioLabel(key) { const s = SCENARIOS.find(function (x) { return x.key === key; }); return s ? s.label : key; }
function pageSuggestions(page) {
  const own = scenarioFor(page);
  if (own.length) return own;
  // 非场景页（如 splash/map）给两个最常用入口
  return [SCENARIOS[0], SCENARIOS[2]];
}
/* 主题深链：给定场景 key + 上下文，直接给出该场景的 AI 回答卡片（供任意页带 ?topic= 进入 assistant） */
function topicReply(topic, ctx) {
  ctx = ctx || {};
  const sc = SCENARIOS.find(function (s) { return s.key === topic; });
  if (!sc) return null;
  // noExec：仅给「描述 + 直达按钮」的速达卡，不真正执行（避免面板点一下就自动生成行程等重操作）
  if (ctx.noExec) return scenarioCard(topic, ctx);
  try {
    const r = handle(sc.sample, ctx);
    if (r) return r;
  } catch (e) {}
  // 兜底：场景没匹配到具体处理器时，给一句描述 + 直达按钮
  return scenarioCard(topic, ctx);
}

/* 速达卡：纯「描述 + 直达对应页」按钮，零副作用（驱动「全场景 AI 速达」面板） */
function scenarioCard(topic, ctx) {
  ctx = ctx || {};
  const sc = SCENARIOS.find(function (s) { return s.key === topic; });
  if (!sc) return null;
  const rt = routeOf(sc.page);
  const q = ctx.city ? { city: ctx.city } : {};
  const extra = ctx.city ? "（当前城市：" + ctx.city + "）" : "";
  return {
    text: sc.desc + extra + "。点下面的按钮直接进对应页，AI 会在那页继续帮你。",
    actions: [act(rt.p, sc.label + " →", q, rt.tab ? "tab" : "push")],
    intent: sc.key
  };
}

module.exports = {
  handle: handle,
  spotExplain: runSpotExplain,
  review: runReview,
  generatePlan: generatePlan,
  topicReply: topicReply,
  scenarioCard: scenarioCard,
  topicLabel: scenarioLabel,
  scenarioFor: scenarioFor,
  pageSuggestions: pageSuggestions,
  allScenarios: allScenarios,
  offlineStats: offlineStats,
  sessionState: sessionState,
  resetSession: resetSession,
  SCENARIOS: SCENARIOS,
  PAGE_ROUTE: PAGE_ROUTE,
  // 兼容 ai-intent 既有导出
  cityOf: AI_INTENT.cityOf,
  pageActions: AI_INTENT.pageActions,
  detectNav: AI_INTENT.detectNav
};
