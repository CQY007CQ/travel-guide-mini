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

// 主包内置「压缩版」强模型纪律协议：仅通用作战协议（零伪造 / 思维链 / 多链投票 / 不越界 / 安全），约 0.7KB，守主包红线。
// 完整 10 套场景提示词置于 subpkg/assistant/ai-prompts.js（不占主包）；assistant 自由聊天经 ask() 第 4 参注入完整版。
const AI_MASTER =
`你是「晨的旅行助手」强模型（离线优先 App）。铁律：①思维链先厘清意图再答。②多链投票：多方案想≥2条比优劣再给结论。③检索增强：事实优先基于随附「本机上下文」（行程/预算/花费/天气缓存/想去/自检分）并标来源。④零伪造：不编景点/票价/坐标/医院/实时天气，缺数据说「以App内对应页为准」。⑤不越界：生成行程/订票/支付引导去App内功能。⑥安全：急症第一句拨120/呼救。简体中文分点。`;
// 选 system：优先用调用方传入的完整版（assistant 分包），否则回退主包压缩版，保证强模型永远有纪律。
function aiSystemOf(scene, override) {
  return override || AI_MASTER;
}

const MAX_TURNS = 6;                 // 每场景保留最近 6 轮（12 条消息）
const MEM_KEY = "aiAgentMemV1";
const MAX_SCENES = 4;                // 落盘最多 4 个场景，防止 storage 膨胀
const SAVE_CHARS = 600;              // 落盘单条上限（内存里仍 1200）
const _inflight = Object.create(null); // scene -> true，防止同场景重复点击并发请求
let _mem = null;                     // scene -> [{role, content}]，首次访问时懒加载

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
  } catch (e) {}
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
  } catch (e) {}
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
    if (m[k].length > MAX_TURNS * 2) m[k] = m[k].slice(-MAX_TURNS * 2);
    _save();
  } catch (e) {}
}
function clearHistory(scene) {
  try {
    const m = _load();
    if (scene) delete m[scene];
    else Object.keys(m).forEach(k => delete m[k]);
    _save();
  } catch (e) {}
}

// 多轮问答：自动带上该场景最近对话 + 本地上下文；成功后才写入记忆（失败不污染上下文）。
// systemOverride：调用方（assistant 分包）可传入完整场景提示词；缺省用主包压缩版纪律协议。
function ask(scene, question, context, systemOverride) {
  const q = String(question || "").trim();
  if (!q) return Promise.resolve({ ok: false, err: "empty-question" });
  // 云未开：直接回落（调用方已做离线兜底），不白费算力拼 system / 不触发云通道
  if (!Cloud.cloudEnabled()) return Promise.resolve({ ok: false, err: "cloud-disabled" });
  const k = scene || "default";
  if (_inflight[k]) return Promise.resolve({ ok: false, err: "inflight" });
  _inflight[k] = true;
  const msgs = historyOf(scene).concat([{ role: "user", content: q }]);
  const sys = aiSystemOf(k, systemOverride);
  return Cloud.aiChat({ messages: msgs, context: context || null, system: sys }).then(function (r) {
    if (r && r.ok && r.text) {
      remember(scene, "user", q);
      remember(scene, "assistant", r.text);
    }
    return r;
  }).catch(function (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }).then(function (r) {
    delete _inflight[k];
    return r;
  });
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
function resolveCity(name) {
  const raw = String(name || "").trim();
  if (!raw || raw.length > 20) return "";
  const n = raw.replace(/[市地区县]$/, "");
  const list = (DATA && Array.isArray(DATA.CITIES)) ? DATA.CITIES : [];
  const names = list.map(c => (c && c.name) || "").filter(Boolean);
  if (names.indexOf(raw) >= 0) return raw;
  if (names.indexOf(raw + "市") >= 0) return raw + "市";
  if (names.indexOf(n) >= 0) return n;
  if (names.indexOf(n + "市") >= 0) return n + "市";
  const hit = names.find(x => x.indexOf(n) === 0 || n.indexOf(x) === 0);
  return hit || "";
}

// 行程意图解析：返回 { city, days, budget, pace, travelMode, people, bias }（只含可确认字段）或 null。
// 注意：这里不产出任何行程内容，首页拿到参数后交给本地 T.buildPlan 生成。
function parsePlanIntent(text) {
  const q = String(text || "").trim();
  if (!q) return Promise.resolve(null);
  if (!Cloud.cloudEnabled()) return Promise.resolve(null);
  return Cloud.aiChat({ prompt: q, system: PLAN_SYS, max_tokens: 300, temperature: 0.2 })
    .then(function (r) {
      if (!r || !r.ok || !r.text) return null;
      const o = extractJSON(r.text);
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
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
      return Object.keys(out).length ? out : null;
    })
    .catch(function () { return null; });
}

module.exports = {
  ask: ask,
  historyOf: historyOf,
  remember: remember,
  clearHistory: clearHistory,
  memoryStats: memoryStats,
  parsePlanIntent: parsePlanIntent,
  resolveCity: resolveCity
};
