// subpkg/assistant/ab-runs.js —— ai-brain 拆分模块③：只读场景处理器
//
// 全部为「读本机离线知识库 → 组装回答 + 直达按钮」，零写操作、零网络、零伪造。
// 写操作见 ab-write.js；分发顺序与意图表见 ai-brain.js 的 NEW_INTENTS。
// 成员为原文件逐字节搬运，唯一改动：runFollowup 由直接调 _dispatch 改为注入 dispatch（防循环依赖）。

const T = require("../../utils/travel.js");
const DATA = require("../../utils/data.js");
const EMERGENCY = require("../../utils/emergency.js");
const RECOMMEND = require("../../utils/recommend.js");   // 本地离线推荐引擎（零网络）
const CORE = require("./ab-core.js");
const WRITE = require("./ab-write.js");
const act = CORE.act;
const parseDays = CORE.parseDays;
const generatePlan = WRITE.generatePlan;   // 生成行程属写操作，落在 ab-write；此处仅调用

function runGenerate(text, city, ctx) {
  const c = city || (ctx && ctx.city) || "";
  if (!c) {
    return { text: "先告诉我去哪个城市，比如「帮我生成成都 3 天行程」，我直接排好带你去。", actions: [act("pages/index/index", "打开生成攻略 →", {}, "tab")], intent: "generate" };
  }
  // v1.20.19：findCity 对编造城市也返回 generic 模板城，旧判据 `if (T.findCity(c))`
  // 恒真 → 这层「离线库里还没有」的拦截从未生效。改用 T.realCity（排除 generic）。
  let found = false;
  try {
    const hit = T.realCity ? T.realCity(c) : (T.findCity ? T.findCity(c) : null);
    found = !!(hit && hit.id !== "generic");
  } catch (e) {}
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
function runFollowup(text, ctx, dispatch) {
  const c = ctx.city || "";
  if (!c) return null;
  for (let i = 0; i < FOLLOWUP_ROUTES.length; i++) {
    const rt = FOLLOWUP_ROUTES[i];
    if (!rt.re.test(text)) continue;
    let inner = null;
    try { inner = dispatch(rt.q(c), Object.assign({}, ctx, { __followup: false })); } catch (e) {}
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
  // v1.20.19：未收录城市从 findCity 拿到的是 generic（气候写死 temperate），
  // 旧实现拿它调 dressForMonth / cityBrief，等于拿模板冒充离线气候库 —— 零伪造红线。
  let real = null;
  try { real = c ? (T.realCity ? T.realCity(c) : (T.findCity ? T.findCity(c) : null)) : null; }
  catch (e) { real = null; }
  if (real && real.id === "generic") real = null;
  if (real) {
    try { if (T.dressForMonth) d = T.dressForMonth(real, (ctx && ctx.plan && ctx.plan.depart) || ""); } catch (e) {}
    try { if (T.cityBrief) brief = T.cityBrief(c); } catch (e) {}
  }
  const lines = ["🧥 " + (c ? c + " " : "") + "穿衣与随身建议" + (real ? "（离线气候库，非实时天气）" : "")];
  if (!real) {
    lines.push("· 离线气候库暂未收录「" + c + "」，说个具体城市（如「成都 11 月穿什么」）再给建议。");
  } else if (d) {
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

/* 其余场景：以「一句话介绍 + 直达按钮」把用户带到对应页（这些页本身已是专业工具，AI 负责入口与语境） */
function runLens() { return { text: "用「拍照识物」对着建筑/植物/招牌拍一张，云端多模态模型会识别并讲讲它的故事（需联网；离线时本机不做图像识别，只给真实地点对照）。", actions: [act("subpkg/lens/lens", "打开拍照识物 →")], intent: "lens" }; }
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
  // 测控说明（勿"统一"掉）：联网通道（LLM）被禁止输出任何报价，是因为它会编；
  // 这里是确定性通道，票价取自 App 本地真实收录，且下文有「以上为 App 本地真实收录」的出处声明。
  // 两者不是口径冲突，是能力差异 —— 把这里也改成"以景区公告为准"会白丢真实数据。
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

module.exports = {
  runGenerate: runGenerate,
  runFood: runFood,
  runPlanOptimize: runPlanOptimize,
  runToday: runToday,
  runPrep: runPrep,
  runSpotSearch: runSpotSearch,
  runDeep: runDeep,
  runLedger: runLedger,
  runEmergency: runEmergency,
  runFollowup: runFollowup,
  runLandmarks: runLandmarks,
  runDress: runDress,
  runRoute: runRoute,
  runLens: runLens,
  runTravelSvc: runTravelSvc,
  runToolkit: runToolkit,
  runGuide: runGuide,
  runSettings: runSettings,
  runRecommend: runRecommend,
  runBestTime: runBestTime,
  runSpotExplain: runSpotExplain,
  runReview: runReview,
  extractSpot: extractSpot,
  fmtMonths: fmtMonths
};
