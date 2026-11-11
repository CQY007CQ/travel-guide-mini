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

const MAX_TURNS = 6;                 // 每场景保留最近 6 轮（12 条消息）
const _mem = Object.create(null);    // scene -> [{role, content}]

function historyOf(scene) {
  try { return (_mem[scene || "default"] || []).slice(-MAX_TURNS * 2); }
  catch (e) { return []; }
}
function remember(scene, role, text) {
  try {
    const k = scene || "default";
    if (!_mem[k]) _mem[k] = [];
    _mem[k].push({ role: role === "assistant" ? "assistant" : "user", content: String(text || "").slice(0, 1200) });
    if (_mem[k].length > MAX_TURNS * 2) _mem[k] = _mem[k].slice(-MAX_TURNS * 2);
  } catch (e) {}
}
function clearHistory(scene) {
  try { if (scene) delete _mem[scene]; else Object.keys(_mem).forEach(k => delete _mem[k]); }
  catch (e) {}
}

// 多轮问答：自动带上该场景最近对话 + 本地上下文；成功后才写入记忆（失败不污染上下文）。
function ask(scene, question, context) {
  const q = String(question || "").trim();
  if (!q) return Promise.resolve({ ok: false, err: "empty-question" });
  const msgs = historyOf(scene).concat([{ role: "user", content: q }]);
  return Cloud.aiChat({ messages: msgs, context: context || null }).then(function (r) {
    if (r && r.ok && r.text) {
      remember(scene, "user", q);
      remember(scene, "assistant", r.text);
    }
    return r;
  });
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
  clearHistory: clearHistory,
  parsePlanIntent: parsePlanIntent,
  resolveCity: resolveCity
};
