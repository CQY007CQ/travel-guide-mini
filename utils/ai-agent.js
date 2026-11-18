// utils/ai-agent.js —— 统一 AI Agent 内核（多轮记忆 + 行程意图解析 + 参数白名单）
//
// 设计原则（与全项目一致）：
//   · 零伪造：AI 永远不产出景点/路线/坐标/票价。行程意图解析只产出「参数」，
//     真实行程一律由本地 T.buildPlan 生成；参数全部经白名单 + clamp 校验。
//   · fail-closed：云未开 / 超时 / 返回非法 → 返回 null 或 {ok:false}，调用方回落离线引擎。
//   · 前端零 Key：所有请求经 Cloud.aiChat → 云函数 llmProxy。
//
// 与 utils/cloud.js 的分工：
//   cloud.js = 通道层（单次调用 / 超时 / 回落）
//   ai-agent.js = 能力层（会话记忆 / 意图解析 / 结构化约束），页面优先用本模块。

const Cloud = require("./cloud.js");
const DATA = require("./data.js");
const S = require("./store.js");
const EL = require("./errlog.js");   // 记忆落盘失败必须留痕：静默吞掉会表现为「AI 突然不记得上一句」

// 主包内置「压缩版」强模型纪律协议：仅通用作战协议（零伪造 / 思维链 / 多链投票 / 不越界 / 安全），约 0.7KB，守主包红线。
// 完整 10 套场景提示词置于 subpkg/assistant/ai-prompts.js（不占主包）；assistant 自由聊天经 ask() 第 4 参注入完整版。
const AI_MASTER =
`你是「晨的旅行助手」强模型（离线优先 App）。铁律：①复述确认：一句复述需求与已知条件，写在结论首句。②思维链：厘清意图→推理→结论，不跳步。③多链投票：多方案独立想≥2条比优劣，取最自洽结论；分歧如实说。④检索增强：事实优先基于随附「本机上下文」（行程/预算/花费/天气缓存/想去/自检分），标明来源段落；未覆盖的标「公开常识」。⑤零伪造：不编景点/坐标/医院/实时天气/评分；不编造票价/门票索道进山费/房价/人均/机票车费，也不给这类区间或「约X元」，被问这类只答「以App内对应页为准」；上下文或用户已给的金额（预算/已花/剩余）须如实复述；禁引具体政府公告、政策文号、文件名称、法规条款号与发文日期，政策只作方向性描述；缺数据说「暂无数据」；涉及政策/价格/开放时间等易变信息才用2025年后口径并标年份，没有就不提年份。⑥不越界：生成行程/订票/支付引导去App内功能。⑦安全：急症第一句拨120/呼救，不替代医生；不给具体药品名/剂量/用法，涉药只引导咨询医师或药师。⑧自我修正：输出前查错别字/前后矛盾/数据一致性，发现问题就地改。格式：结论→依据→共识度→提示四段顺序固定、标题独立成行，复述并入结论首句；简体中文、分点、≤400字（结论≤80/依据最多3条每条≤50/共识度≤50/提示≤50），超了先删依据条数；建议可操作。`;
// 选 system：优先用调用方传入的完整版（assistant 分包），否则回退主包压缩版，保证强模型永远有纪律。
function aiSystemOf(scene, override) {
  return override || AI_MASTER;
}

const MAX_TURNS = 6;                 // 每场景保留最近 6 轮（12 条消息）
const MEM_KEY = "aiAgentMemV1";
const TS_KEY = "aiAgentTsV1";        // 场景 -> 最近一次用户提问时间戳（跨页衔接时效基准，必须落盘）
const MAX_SCENES = 11;               // 全站实有 11 个 scene；storage 10MB 非瓶颈，不足会静默淘汰他页记忆
                                     // 场景清单由 ask() 字面量跨行正则数出（含 today-proactive），勿用单行 grep
const SAVE_CHARS = 600;              // 落盘单条上限（内存里仍 1200）
// scene -> { q, p }：同一场景同一时刻只跑一趟云端请求（防并发污染会话记忆）。
// v1.20.15：原来存的是 true，第二次调用直接回 {ok:false,err:"inflight"}；
//   但 11 处调用点对「非 ok」一律降级到离线答案 → 用户连点两下就看到「AI 变笨了」，
//   而云端那一趟其实还在路上、答案随后被丢弃。现在改成存 Promise：
//   同一句话 → 复用同一趟请求（零额外 token，两人拿到同一个答案）；
//   换了问题 → 排队等前一趟收尾再发（并发会让 user/assistant 落记忆的顺序错乱）。
const _inflight = Object.create(null);
const _sceneTs = Object.create(null);  // scene -> 最近一次用户提问时间（内存态；首次 _load 时从 TS_KEY 恢复）
let _mem = null;                     // scene -> [{role, content}]，首次访问时懒加载

// ── 通道熔断：连续传输层失败（超时/网络/云函数未就绪）时短期不再发起请求 ──
// 为什么需要：弱网下每进一次页面就陪云端干等 21s（AI_TEXT_TIMEOUT_MS），拿到的仍是同一份离线答案。
// 为什么是「连续 2 次」而不是 1 次：单次超时可能只是模型这次慢（21s 没答完），立刻熔断会把
//   本来能出结果的下一问也判掉。连续两次 = 已经白等了 42s，通道确实不通，此时熔断只赚不亏。
// 只认 transport 标记（cloud.js 在 withTimeout 超时/调用被 reject 时置位），
//   云端返回的业务错误（如模型空输出）不算通道不通，不熔断。
const _BREAK_AFTER = 2;
const _BREAK_MS = 60 * 1000;
let _netFail = 0;
let _breakUntil = 0;
// v1.20.22：熔断状态只读出口。第二视角 / 网页 AI 等「旁路云端调用」也走同一个通道，
// 但原先它们各自直连 Cloud.aiChat，绕过主回答的熔断：弱网下主回答 1ms 回落离线，
// 页面却仍被 Promise.all 里的第二视角拖 21s（客户端 AI_TEXT_TIMEOUT_MS）——熔断形同虚设。
// 这里只暴露状态、不改判定：业务错误仍不熔断，60s 到期自动恢复，口径全在主链路这一处。
function channelCooling() { return Date.now() < _breakUntil; }

// ── 答案缓存：同一句话在同一份上下文下重复提问，直接复用上次答案 ──
// 为什么需要：AI 延迟 ≈ 输出长度 ÷ 70 字/秒（实测一问 8~12 秒），而用户会反复问同一句 ——
//   换页回来再问一遍、手滑重发、同一趟行程隔几分钟又想确认。现在每次都全额再等一轮并再烧一次 token。
//   命中缓存 = 0ms 落屏，且不发请求。
//
// 命中条件必须**三条全等**：scene 相同 + 问题完全相同 + 上下文完全相同。
//   只看问题是不够的：「有什么好吃的」在吉安和北京答案不同，而城市与行程就在 context 里；
//   因此把 context 整串一起比对（≤1200 字，原生字符串比较，成本可忽略）。
//   宁可少命中，也不能串城市、串行程 —— 那是"看似聪明实则胡说"的典型来源。
//
// 排除实时/易变类问题：含天气、气温、下雨、人流、排队、今天、现在、票价、路况…任一关键词
//   就既不读也不写缓存。这类答案随时间变化，缓存会在 10 分钟内吐出过期的"实时"信息，比慢更糟。
//
// 只存内存、不落盘：进程被回收即失效。宁可多问一次，也不让陈旧答案跨会话存活。
// 容量 LRU 40 条（单条 ≤1200 字，上限约 48KB），超出淘汰最久未用的那条。
const _cache = Object.create(null);   // key -> { ctx, text, ts, used }
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 40;
// 保守判据：只要沾一点"答案会随时间变"的边就不缓存（宁可多问一次）
const CACHE_LIVE = /(天气|气温|温度|下雨|雨|雪|风|空气|雾霾|实时|现在|今天|明天|后天|人流|排队|拥挤|开门|营业|闭馆|票价|余票|堵车|路况|航班|延误)/;
/* v1.20.27：缓存键做「不影响语义」的归一化。原来只做原串比较，于是
 *   「北京有什么好玩的」「北京有什么好玩的？」「北京 有什么好玩的」
 * 被当成三个不同问题，各占一条缓存、各打一次云端 —— 用户感觉「刚问过怎么又要等」。
 * 这里只裁掉空白与标点、英文转小写，**不做同义改写、不去数字**（数字常是语义的一部分：
 * 「3 天」「2 人」）。归一化后为空（用户只发了标点）则回退原串，避免所有纯标点问题撞一条。 */
function _normQ(q) {
  const raw = String(q == null ? "" : q);
  const n = raw
    .replace(/[\s\u3000]+/g, "")
    .replace(/[。，、；：？！…—－·「」『』（）《》〈〉“”‘’"'?!.,;:()\[\]{}<>~`@#$%^&*_+=|\\\/\-]+/g, "")
    .toLowerCase();
  return n || raw.trim();
}
function _cacheKey(scene, q) { return String(scene || "default") + "\u0001" + _normQ(q); }
function _cacheGet(scene, q, ctx) {
  const e = _cache[_cacheKey(scene, q)];
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { delete _cache[_cacheKey(scene, q)]; return null; }
  if (String(e.ctx) !== String(ctx || "")) return null;   // 换城市 / 换行程 → 不命中
  e.used = Date.now();
  return e.text;
}
function _cachePut(scene, q, ctx, text) {
  if (!text || typeof text !== "string") return;
  const k = _cacheKey(scene, q);
  _cache[k] = { ctx: String(ctx || ""), text: text, ts: Date.now(), used: Date.now() };
  const keys = Object.keys(_cache);
  if (keys.length <= CACHE_MAX) return;
  let oldest = keys[0];
  for (let i = 1; i < keys.length; i++) {
    if ((_cache[keys[i]].used || 0) < (_cache[oldest].used || 0)) oldest = keys[i];
  }
  delete _cache[oldest];
}
// 清空会话时必须连带清缓存：否则用户以为"清空了"，再问同一句却立刻弹回旧答案
function cacheClear() { Object.keys(_cache).forEach(function (k) { delete _cache[k]; }); }
// 只读出口（单测 / 门禁断言用，不参与业务）
function cacheStats() { return { size: Object.keys(_cache).length, ttl: CACHE_TTL, max: CACHE_MAX }; }

// 时间戳为什么要落盘：_sceneTs 早期是纯内存，小程序被后台回收后它归零 →
// 他页取到 0 → now-0 恒大于 10 分钟 TTL → 跨页提示「永不注入」。
// 症状是「隔天/被回收后再问就接不上」，而 TTL 与注入逻辑本身都是好的，极难定位。
// 落盘只恢复时效基准，TTL 口径不变（隔天的问题依旧不串台）。
function _load() {
  if (_mem) return _mem;
  _mem = Object.create(null);
  try {
    const v = S.get(MEM_KEY, null);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.keys(v).slice(-MAX_SCENES).forEach(function (k) {
        if (Array.isArray(v[k])) _mem[k] = v[k].slice(-MAX_TURNS * 2);
      });
    }
    // 复用同一个 try（不新增 catch，避免抬高空 catch 基线）；失败留痕后按空记忆继续。
    const tv = S.get(TS_KEY, null);
    if (tv && typeof tv === "object" && !Array.isArray(tv)) {
      Object.keys(tv).forEach(function (k) {
        const t = Number(tv[k]);
        if (t > 0 && t > (_sceneTs[k] || 0)) _sceneTs[k] = t; // 内存为准，取较大值
      });
    }
  } catch (e) { EL.note("ai-mem", e, "会话记忆读取失败 → 按空记忆继续（多轮上下文会丢）"); }
  return _mem;
}
function _save() {
  try {
    const m = _load();
    const out = {};
    Object.keys(m).slice(-MAX_SCENES).forEach(function (k) {
      out[k] = m[k].slice(-MAX_TURNS * 2).map(function (x) {
        return { role: x.role, content: String(x.content || "").slice(0, SAVE_CHARS) };
      });
    });
    S.set(MEM_KEY, out);
    // 时间戳随记忆一起落盘，键集与 out 对齐（天然受 MAX_SCENES 约束，不会无限增长）
    const ts = {};
    Object.keys(out).forEach(function (k) { if (_sceneTs[k]) ts[k] = _sceneTs[k]; });
    S.set(TS_KEY, ts);
  } catch (e) { EL.note("ai-mem", e, "会话记忆/时效基准落盘失败 → 冷启动后跨页衔接失效"); }
}

function historyOf(scene) {
  try { return (_load()[scene || "default"] || []).slice(-MAX_TURNS * 2); }
  catch (e) { return []; }
}
function remember(scene, role, text) {
  try {
    const k = scene || "default";
    const m = _load();
    if (!m[k]) m[k] = [];
    m[k].push({ role: role === "assistant" ? "assistant" : "user", content: String(text || "").slice(0, 1200) });
    if (role !== "assistant") { _sceneTs[k] = Date.now(); _crossTs = 0; } // 新提问使跨页缓存失效
    if (m[k].length > MAX_TURNS * 2) m[k] = m[k].slice(-MAX_TURNS * 2);
    // 键顺序即淘汰顺序：把刚用过的场景挪到末尾（详见 check-ai-fallback 断言）。
    const cur = m[k]; delete m[k]; m[k] = cur;
    _save();
  } catch (e) { EL.note("ai-mem", e, "记入会话记忆失败 → 本轮回答不写回上下文"); }
}
function clearHistory(scene) {
  try {
    const m = _load();
    if (scene) { delete m[scene]; delete _sceneTs[scene]; }
    else { Object.keys(m).forEach(k => delete m[k]); Object.keys(_sceneTs).forEach(k => delete _sceneTs[k]); }
    _crossTs = 0; // 清空会话后跨页缓存立即失效，不吐 30 秒内的旧问题
    cacheClear();  // 答案缓存同理：否则「清空会话」后同一句立刻弹回旧答案，等于没清
    _save();
  } catch (e) { EL.note("ai-mem", e, "清空会话失败 → 旧记忆可能仍在（用户以为已清）"); }
}

// 跨页衔接：把「其它场景最近 2 条用户提问」附进本次 context，让「那换成室内的呢」
// 在 food 页也能接上 today 页的上下文。只注入、不写回记忆、不进 messages。
// 时效 10 分钟 + 只取 user 问题（不取回答，避免长文本串台与 token 浪费）。
// 时效基准 _sceneTs 随记忆落盘（TS_KEY），否则进程被回收后跨页提示恒不注入；
// 缓存本身仍是纯内存快照（30s），失败返回空串，绝不阻断主流程。
const CROSS_SCENE_TTL = 10 * 60 * 1000;
let _crossTs = 0, _crossCache = "";
function crossSceneHints(current) {
  try {
    const now = Date.now();
    if (now - _crossTs < 30000 && _crossCache) return _crossCache; // 30s 内复用，避免每次全表扫描
    const m = _load();
    const lines = [];
    Object.keys(m).forEach(function (k) {
      if (k === current || !Array.isArray(m[k])) return;
      if (now - (_sceneTs[k] || 0) > CROSS_SCENE_TTL) return; // 超过 10 分钟不串台
      const qs = m[k].filter(function (x) { return x && x.role === "user" && x.content; })
        .slice(-2).map(function (x) { return "· " + String(x.content).slice(0, 60); });
      if (qs.length) lines.push("【" + k + "页最近问过】\n" + qs.join("\n"));
    });
    const out = lines.slice(0, 3).join("\n");
    _crossTs = now; _crossCache = out;
    return out;
  } catch (e) { return ""; }
}

// 多轮问答：自动带上该场景最近对话 + 本地上下文；成功后才写入记忆（失败不污染上下文）。
// systemOverride：调用方（assistant 分包）可传入完整场景提示词；缺省用主包压缩版纪律协议。
function ask(scene, question, context, systemOverride) {
  const q = String(question || "").trim();
  if (!q) return Promise.resolve({ ok: false, err: "empty-question" });
  // 云未开：直接回落（调用方已做离线兜底），不白费算力拼 system / 不触发云通道
  if (!Cloud.cloudEnabled()) return Promise.resolve({ ok: false, err: "cloud-disabled" });
  const k = scene || "default";
  // 先看并发：已经有一趟在跑时不能被熔断抢先判掉（那趟还有机会成功）
  const busy = _inflight[k];
  if (busy) {
    // 同一句话连点：复用同一趟请求，答案与首问完全一致（不额外烧 token）
    if (busy.q === q) return busy.p;
    // 换了问题：排队。等前一趟结算完（记忆已落）再重新走 ask，顺序与用户输入一致。
    return busy.p.then(function () { return ask(scene, question, context, systemOverride); });
  }
  // 答案缓存：同一 scene + 同一句话 + 同一份上下文，10 分钟内直接复用（0ms、零 token）
  if (!CACHE_LIVE.test(q)) {
    const hit = _cacheGet(k, q, context);
    if (hit) {
      // 命中也要写回记忆：否则下一问的 history 里缺这一轮，
      // 用户紧接着问「那还有别的吗」会失去指代对象。
      remember(scene, "user", q);
      remember(scene, "assistant", hit);
      return Promise.resolve({ ok: true, text: hit, cached: true });
    }
  }
  if (Date.now() < _breakUntil) return Promise.resolve({ ok: false, err: "cooldown" });
  return _run(k, scene, q, context, systemOverride);
}

// 真正发起一趟请求。抽出来只为一件事：把「这一趟的 Promise」放进 _inflight，
// 让并发调用能拿到同一个对象去复用 / 排队，而不是各自再发一次。
function _run(k, scene, q, context, systemOverride) {
  const msgs = historyOf(scene).concat([{ role: "user", content: q }]);
  const sys = aiSystemOf(k, systemOverride);
  const hint = crossSceneHints(k);
  const fullCtx = hint ? (String(context || "") + "\n\n【跨页上下文 · 仅供理解指代，勿当成该页事实】\n" + hint) : context;
  const p = Cloud.aiChat({ messages: msgs, context: fullCtx || null, system: sys }).then(function (r) {
    if (r && r.ok && r.text) {
      _netFail = 0; _breakUntil = 0;   // 通道恢复：清掉熔断计数，下一次照常走云端
      remember(scene, "user", q);
      remember(scene, "assistant", r.text);
      // 实时类问题不写缓存（下次仍要走云端拿最新答案）
      if (!CACHE_LIVE.test(q)) _cachePut(k, q, context, r.text);
    } else if (r && r.transport) {
      // 只有传输层失败才计入熔断（cloud.js 置 transport 标记）
      _netFail++;
      if (_netFail >= _BREAK_AFTER && Date.now() >= _breakUntil) {
        _breakUntil = Date.now() + _BREAK_MS;
        EL.note("ai", "cooldown", "云端通道连续 " + _netFail + " 次超时/断网 → 暂停 " + (_BREAK_MS / 1000) + "s 直接回落离线，避免每次进页白等");
      }
    }
    return r;
  }).catch(function (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }).then(function (r) {
    // 只清自己这一条：排队路径可能在等待期间已置入新的 in-flight
    if (_inflight[k] && _inflight[k].p === p) delete _inflight[k];
    return r;
  });
  _inflight[k] = { q: q, p: p };
  return p;
}

// 记忆占用（供设置页展示 / 全局清空），返回 { scenes, turns, chars }
function memoryStats() {
  const m = _load();
  let turns = 0, chars = 0;
  Object.keys(m).forEach(function (k) {
    turns += Math.ceil((m[k].length || 0) / 2);
    (m[k] || []).forEach(function (x) { chars += String(x.content || "").length; });
  });
  return { scenes: Object.keys(m).length, turns, chars };
}

const PLAN_SYS =
  "你是旅行攻略生成器的「行程参数解析器」。把用户的一句话解析成结构化参数。" +
  "只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。\n" +
  '可用字段（全部可选；无法判断的字段就不要出现）：' +
  '{"city":"城市名","days":整数1-14,"budget":"low|mid|high","pace":"leisure|balance|speed",' +
  '"travelMode":"|family|couple|solo|elder","people":整数1-10,"bias":"|history|nature"}\n' +
  "映射规则：\n" +
  "· city：中国城市名（去掉「市」后缀也行）。绝不编造地名；判断不出就不给。\n" +
  "· budget：省钱/穷游/经济→low，舒适/适中→mid，高端/豪华/不差钱→high；" +
  "给了总金额时按「人均每天」估算：<300→low，<600→mid，否则→high。\n" +
  "· pace：轻松/慢/休闲/度假→leisure，特种兵/赶行程/多打卡→speed，其余→balance。\n" +
  "· travelMode：亲子/带小孩→family，情侣/蜜月→couple，一个人/独行→solo，带老人/父母→elder。\n" +
  "· bias：历史/古迹/博物馆/古镇→history，自然/山水/海边/爬山→nature。\n" +
  "· days：出现「几天/天/N日游」就取该数字；没提就不给。\n" +
  "严禁输出景点名、路线、坐标、价格数字作为内容；只输出上面的参数 JSON。";

function extractJSON(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : t;
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch (e) { return null; }
}

function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  return (isFinite(n) && n >= lo && n <= hi) ? n : def;
}

// 城市名校验：必须命中本地真实 CITIES，杜绝 AI 编造地名。返回规范名或 ""。
// 城市名数组懒缓存（423+ 城，避免每次调用都 .map 全量重建）。
let _cityNames = null;
function _cityNameList() {
  if (_cityNames) return _cityNames;
  const list = (DATA && Array.isArray(DATA.CITIES)) ? DATA.CITIES : [];
  _cityNames = list.map(c => (c && c.name) || "").filter(Boolean);
  return _cityNames;
}
function resolveCity(name) {
  const raw = String(name || "").trim();
  if (!raw || raw.length > 20) return "";
  const n = raw.replace(/[市地区县]$/, "");
  const names = _cityNameList();
  if (names.indexOf(raw) >= 0) return raw;
  if (names.indexOf(raw + "市") >= 0) return raw + "市";
  if (names.indexOf(n) >= 0) return n;
  if (names.indexOf(n + "市") >= 0) return n + "市";
  const hit = names.find(x => x.indexOf(n) === 0 || n.indexOf(x) === 0);
  return hit || "";
}

// 行程意图解析（本地离线版）：纯关键字/正则抽取，零网络、零云依赖。
// 与云端版互补：云端未配置时仍能把「成都 3 天亲子穷游」拆成结构化参数，喂给本地 T.buildPlan。
// 只产出参数，绝不产出景点/路线/价格（内容一律由本地生成器出，零伪造）。
const PLAN_CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function parsePlanIntentLocal(text) {
  const q = String(text || "").trim();
  if (!q) return null;
  const out = {};
  const city = resolveCity(q);
  if (city) out.city = city;
  // 天数
  const dm = q.match(/(\d+|[一二两三两四五六七八九十])\s*(?:天|日|晚|天\d|日游)/);
  if (dm) { const n = parseInt(dm[1], 10) || PLAN_CN_NUM[dm[1]]; if (n) out.days = Math.max(1, Math.min(14, n)); }
  // 预算
  if (/穷游|省钱|便宜|经济|低预算|预算有限|不贵|省一点|学生|低消费/.test(q)) out.budget = "low";
  else if (/奢华|高端|豪华|不差钱|高预算|精品|贵一点|高消费/.test(q)) out.budget = "high";
  else if (/舒适|适中|中档|中等预算/.test(q)) out.budget = "mid";
  // 节奏
  if (/轻松|慢|躺平|休闲|放松|不赶|度假|佛系/.test(q)) out.pace = "leisure";
  else if (/特种兵|紧凑|赶|暴走|多玩|效率|满满|压满/.test(q)) out.pace = "speed";
  // 人群
  if (/亲子|带娃|孩子|小朋友|儿童|一家三口/.test(q)) out.travelMode = "family";
  else if (/情侣|蜜月|两个人?.*浪漫|约会/.test(q)) out.travelMode = "couple";
  else if (/一个人|独行|\bsolo\b|自己一个人| solo/.test(q)) out.travelMode = "solo";
  else if (/带老人|父母|长辈|老年|爷爷奶奶/.test(q)) out.travelMode = "elder";
  // 人数
  const pm = q.match(/(\d+)\s*人/);
  if (pm) { const n = parseInt(pm[1], 10); if (n >= 1 && n <= 10) out.people = n; }
  // 偏好主题
  if (/历史|古迹|博物馆|古镇|人文|文化|古都|遗址/.test(q)) out.bias = "history";
  else if (/自然|山水|海边|爬山|雪山|草原|风光|看海|海岛/.test(q)) out.bias = "nature";
  return Object.keys(out).length ? out : null;
}

// 行程意图解析：返回 { city, days, budget, pace, travelMode, people, bias }（只含可确认字段）或 null。
// 注意：这里不产出任何行程内容，首页拿到参数后交给本地 T.buildPlan 生成。
// 云端可用时优先用强模型（更准），不可用/出错时回落本地关键字解析，保证离线也能量化拆参。
function parsePlanIntent(text) {
  const q = String(text || "").trim();
  const local = parsePlanIntentLocal(q);
  if (!q) return Promise.resolve(local);
  if (!Cloud.cloudEnabled()) return Promise.resolve(local);
  return Cloud.aiChat({ prompt: q, system: PLAN_SYS, max_tokens: 300, temperature: 0.2, timeoutMs: 8000 })
    .then(function (r) {
      if (!r || !r.ok || !r.text) return local;
      const o = extractJSON(r.text);
      if (!o || typeof o !== "object" || Array.isArray(o)) return local;
      const out = {};
      const city = resolveCity(o.city);
      if (city) out.city = city;
      if (o.days != null) out.days = clampInt(o.days, 1, 14, 0) || undefined;
      if (o.budget != null) out.budget = oneOf(o.budget, ["low", "mid", "high"], "");
      if (o.pace != null) out.pace = oneOf(o.pace, ["leisure", "balance", "speed"], "");
      if (o.travelMode != null) out.travelMode = oneOf(o.travelMode, ["", "family", "couple", "solo", "elder"], "");
      if (o.people != null) out.people = clampInt(o.people, 1, 10, 0) || undefined;
      if (o.bias != null) out.bias = oneOf(o.bias, ["", "history", "nature"], "");
      // 清掉空值 / undefined，避免污染表单
      Object.keys(out).forEach(k => { if (out[k] === "" || out[k] === undefined || out[k] === null) delete out[k]; });
      return Object.keys(out).length ? out : (local || null);
    })
    .catch(function () { return local; });
}

module.exports = {
  ask: ask,
  historyOf: historyOf,
  remember: remember,
  clearHistory: clearHistory,
  memoryStats: memoryStats,
  parsePlanIntent: parsePlanIntent,
  resolveCity: resolveCity,
  channelCooling: channelCooling,
  cacheStats: cacheStats,
  cacheClear: cacheClear
};
