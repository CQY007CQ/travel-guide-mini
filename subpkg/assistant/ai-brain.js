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

/* 与 ai-intent 同款 action 构造器（assistant.onAction 消费 path/query/mode） */
function act(path, label, query, mode) { return { label: label, path: path, query: query || {}, mode: mode || "push" }; }

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
  myguides: { p: "pages/myguides/myguides", tab: false }
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
  { key: "settings",       page: "more",       label: "设置偏好", icon: "home.png",   sample: "设置",                desc: "主题/字体/偏好/数据管理" }
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

/* 其余场景：以「一句话介绍 + 直达按钮」把用户带到对应页（这些页本身已是专业工具，AI 负责入口与语境） */
function runLens() { return { text: "用「拍照识景」对着建筑/招牌拍一张，我会识别并讲讲它的故事（离线识别，无需联网）。", actions: [act("subpkg/lens/lens", "打开拍照识景 →")], intent: "lens" }; }
function runTravelSvc() { return { text: "「出行服务」页集合了订票、打车、机场/车站、值机等常用入口，按城市自动匹配。", actions: [act("subpkg/travelsvc/travelsvc", "打开出行服务 →")], intent: "travelsvc" }; }
function runToolkit() { return { text: "「旅行百宝箱」有汇率换算、时差、单位换算、证件清单等小工具，离线可用。", actions: [act("subpkg/toolkit/toolkit", "打开百宝箱 →")], intent: "toolkit" }; }
function runGuide() { return { text: "「我的攻略」里保存着你生成过的行程，可随时翻看、复用、再编辑。", actions: [act("pages/myguides/myguides", "打开我的攻略 →")], intent: "guide" }; }
function runSettings() { return { text: "「更多」页里有主题（深/浅色）、字体大小、偏好、数据管理等设置。", actions: [act("pages/more/more", "打开更多设置 →", {}, "tab")], intent: "settings" }; }

/* ───────── 扩展意图表（顺序：更具体者优先） ───────── */
const NEW_INTENTS = [
  { key: "help-emergency", kw: /医院|急救|受伤|骨折|出血|中暑|高原反应|晕倒|胸痛|急诊|食物.*(中毒|过敏)|不舒服|拉肚子|发烧|过敏/, run: runEmergency },
  { key: "planOptimize",   kw: /行程.*(合理|问题|体检|优化|挑毛病|太赶|调整|改一下|有没有|顺不顺)|挑毛病|体检.*行程|排得.*(太|不)/, run: runPlanOptimize },
  { key: "generate",       kw: /生成|做一份|排一份|安排一下|帮我排|来一份|规划|日游|几天|怎么安排|定制行程|排个行程|出个行程/, run: runGenerate },
  { key: "food",           kw: /吃什么|吃啥|美食|必吃|好吃的|当地菜|特色菜|餐厅|馆子|小吃|夜市/, run: runFood },
  { key: "today",          kw: /今天.*(安排|干嘛|干什么|玩什么|还剩|花了多少|去哪)|今天去哪|下一站|明天去哪|倒计时|还有几天出发|出发还有|今天行程/, run: runToday },
  { key: "prep",           kw: /带什么|行李|准备什么|打包|出行前|要准备|必备|收拾/, run: runPrep },
  { key: "ledger",         kw: /花了多少|记账|预算|超支|账本|花费|消费了多少|今天.*花/, run: runLedger },
  { key: "deep",           kw: /深度玩法|机位|避坑|当地人|小众玩法|citywalk|city walk|冷门玩法/, run: runDeep },
  { key: "spotsearch",     kw: /找.*景点|按标签|标签.*景点|亲子.*(景点|游)|小众.*景点|冷门.*景点|适合的景点/, run: runSpotSearch },
  { key: "lens",           kw: /拍照识别|识景|拍照识|扫一下|拍一下认|这是什么建筑|识别景点/, run: runLens },
  { key: "travelsvc",      kw: /出行服务|订票|打车|机场|车站|值机|航班/, run: runTravelSvc },
  { key: "toolkit",        kw: /工具箱|百宝箱|换算|时差|计算器|工具/, run: runToolkit },
  { key: "guide",          kw: /我的攻略|收藏的攻略|保存的攻略|历史攻略|我的行程列表|攻略列表/, run: runGuide },
  { key: "settings",       kw: /设置|偏好|主题|夜间模式|深色模式|浅色|字号|字体大小|账号管理/, run: runSettings }
];

/* ───────── 主入口：与 ai-intent 完全一致的契约 ───────── */
function handle(text, ctx) {
  text = (text || "").trim();
  if (!text) return null;
  ctx = ctx || {};
  // ① 先委派 ai-intent（photo/near/cityinfo/spot/nav/sync），零回归
  try {
    const delegated = AI_INTENT.handle(text, ctx);
    if (delegated) return delegated;
  } catch (e) { /* ai-intent 异常不应阻断扩展场景 */ }
  const city = (AI_INTENT.cityOf ? AI_INTENT.cityOf(text, ctx.city) : (ctx.city || "")) || (ctx.city || "");
  // ② 走扩展场景，首个命中即返回
  for (let i = 0; i < NEW_INTENTS.length; i++) {
    const sc = NEW_INTENTS[i];
    if (sc.kw.test(text)) {
      try {
        const r = sc.run(text, city, ctx);
        if (r) return r;
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
  generatePlan: generatePlan,
  topicReply: topicReply,
  scenarioCard: scenarioCard,
  topicLabel: scenarioLabel,
  scenarioFor: scenarioFor,
  pageSuggestions: pageSuggestions,
  allScenarios: allScenarios,
  SCENARIOS: SCENARIOS,
  PAGE_ROUTE: PAGE_ROUTE,
  // 兼容 ai-intent 既有导出
  cityOf: AI_INTENT.cityOf,
  pageActions: AI_INTENT.pageActions,
  detectNav: AI_INTENT.detectNav
};
