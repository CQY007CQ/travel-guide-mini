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
//
// 文件结构（原单文件 784 行，离「单文件 800 行」硬线只剩 16 行，故按职责拆分；
//   依赖严格单向 ab-core → ab-write → ab-runs → 本文件，无循环 require）：
//   · ab-core.js  —— 共享依赖、action 构造、离线命中计数、日期/天数工具、页面路由表
//   · ab-write.js —— 会真实写数据的处理器（生成行程 / 一句话记账 / 想玩清单）
//   · ab-runs.js  —— 只读场景处理器（读离线库 → 回答 + 直达按钮）
//   · 本文件      —— 多轮会话状态、场景注册表、意图表与分发顺序、对外契约
// 对外导出与拆分前完全一致，调用方零改动。

const AI_INTENT = require("../../utils/ai-intent.js");
const CORE = require("./ab-core.js");
const RUNS = require("./ab-runs.js");
const WRITE = require("./ab-write.js");

const act = CORE.act;
const _bump = CORE._bump;
const offlineStats = CORE.offlineStats;
const routeOf = CORE.routeOf;
const PAGE_ROUTE = CORE.PAGE_ROUTE;
const runFollowup = RUNS.runFollowup;
const runSpotExplain = RUNS.runSpotExplain;
const runReview = RUNS.runReview;
const generatePlan = WRITE.generatePlan;
const runEmergency = RUNS.runEmergency;
const runRecommend = RUNS.runRecommend;
const runBestTime = RUNS.runBestTime;
const runDress = RUNS.runDress;
const runPlanOptimize = RUNS.runPlanOptimize;
const runRoute = RUNS.runRoute;
const runGenerate = RUNS.runGenerate;
const runFood = RUNS.runFood;
const runLandmarks = RUNS.runLandmarks;
const runToday = RUNS.runToday;
const runPrep = RUNS.runPrep;
const runLedger = RUNS.runLedger;
const runDeep = RUNS.runDeep;
const runSpotSearch = RUNS.runSpotSearch;
const runLens = RUNS.runLens;
const runTravelSvc = RUNS.runTravelSvc;
const runToolkit = RUNS.runToolkit;
const runGuide = RUNS.runGuide;
const runSettings = RUNS.runSettings;
const runQuickBill = WRITE.runQuickBill;
const runAddWish = WRITE.runAddWish;

// 会话快照落盘失败必须留痕：静默吞掉的表现是「AI 突然不记得上一句在说哪个城市」，
// 而这正是本项目已踩过的坑（v1.20.11 跨页衔接因时间戳未落盘而冷启动恒失效）。
const EL = require("../../utils/errlog.js");

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
  } catch (e) { EL.note("ai-brain", e, "会话快照读取失败 → 按空会话继续（「那…」会失去指代对象）"); }
  return _sess;
}
function _sessSave() {
  try { S.set(SESS_KEY, _sessLoad()); }
  catch (e) { EL.note("ai-brain", e, "会话快照落盘失败 → 重启后多轮上下文丢失"); }
}
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
  { key: "lens",           page: "lens",       label: "拍照识物", icon: "camera.png", sample: "拍照识物",            desc: "对着建筑/植物/招牌拍一张讲讲它的故事" },
  { key: "travelsvc",      page: "travelsvc",  label: "出行服务", icon: "bus.png",    sample: "出行服务",            desc: "订票/打车/机场车站入口" },
  { key: "toolkit",        page: "toolkit",    label: "旅行百宝箱", icon: "coin.png", sample: "工具箱",              desc: "汇率/时差/换算等小工具" },
  { key: "guide",          page: "myguides",   label: "我的攻略", icon: "star.png",   sample: "我的攻略",            desc: "保存与复用生成过的行程" },
  { key: "settings",       page: "more",       label: "设置偏好", icon: "home.png",   sample: "设置",                desc: "主题/字体/偏好/数据管理" },
  { key: "review",         page: "assistant",  label: "行程复盘", icon: "star.png",   sample: "帮我复盘这趟行程",    desc: "基于真实手记/记账/去过的地方升华成游记" }
];

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
    const fr = runFollowup(text, ctx, _dispatch);
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
    text: sc.desc + extra + "。正在带你进对应页，AI 会在那页继续帮你。",
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
