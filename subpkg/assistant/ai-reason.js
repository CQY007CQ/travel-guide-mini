// ai-reason.js —— 自由对话的「更强推理」与「可执行动作」（assistant 分包，主包零增长）
//
// 背景：MASTER 提示词里写着「多链投票 / 思维链」，但 v1.20.6 前全站自由聊天实际只跑一次模型，
//       纪律停留在口号层；AI 也只能输出文字，无法把结论变成 App 内的下一步操作。
//
// 本模块提供三件事：
//   ① needsSecondOpinion / secondOpinion：复杂问题并发一条**独立审慎视角**（不同 system / 温度），
//      与主回答并列呈现，明确标注「两种视角」，绝不假装投票出唯一真理（零伪造）。
//   ② actionContract：让强模型在需要时输出结构化动作 JSON（可选，没有就不输出）。
//   ③ parseActions：白名单解析 → 只能驱动 app.json 里真实存在的页面；城市必须命中本地真实城市库；
//      动作里绝不携带景点/票价/坐标，杜绝 AI 借「动作」绕过零伪造红线。
//
// 纯函数部分（needsSecondOpinion / parseActions / stripActionBlock）可 Node 单测；
// secondOpinion 才走云通道，任何失败返回 null，绝不拖垮主回答。

const Cloud = require("../../utils/cloud.js");
const T = require("../../utils/travel.js");
const D = require("../../utils/data.js");

// 复杂问题才值得第二条独立视角：取舍 / 对比 / 体检 / 复盘 / 建议 / 长问题。
// 简单事实查询单链即可，避免无谓翻倍云配额。
const COMPLEX_RE = /怎么安排|如何安排|怎么排|对比|比较|取舍|哪个更|值不值|值不值得|要不要|该不该|体检|合理|优化|复盘|游记|建议|适不适合|划算|避坑|几天合适|选.*还是|有没有问题|值吗|值得吗/;

function needsSecondOpinion(q) {
  var t = String(q || "").trim();
  return t.length >= 24 || COMPLEX_RE.test(t);
}

// 第二视角：刻意用「审慎复核员」角色 + 更高温度，与主回答的「旅行管家」视角形成差异。
// 不复用 AIAgent.ask（避免污染多轮记忆与场景并发锁），任何失败都只返回 null。
const ALT_SYS =
  "你是「晨的旅行助手」的独立审慎复核员。只依据随附的本机真实上下文与照片/文字里可见的信息作答，" +
  "重点是主回答可能忽略的风险、前提、替代方案与不确定性；给 2-3 条简短要点，不重复客套话。" +
  "不确定就说明不确定，绝不编造景点、票价、坐标、医院或实时天气。简体中文、分点。";

function secondOpinion(q, ctx) {
  if (!Cloud.cloudEnabled()) return Promise.resolve(null);
  return Cloud.aiChat({
    prompt: String(q || "").trim(),
    system: ALT_SYS,
    context: ctx || null,
    max_tokens: 600,
    temperature: 0.6
  }).then(function (r) {
    return (r && r.ok && r.text) ? { ok: true, text: String(r.text), source: r.source || "ai" } : null;
  }).catch(function () { return null; });
}

// 只列 app.json 里真实存在的页面；tab 页必须 switchTab，否则跳转会静默失败。
const PAGE_MAP = {
  index:      { path: "/pages/index/index",                 tab: true,  label: "去生成行程" },
  today:      { path: "/pages/today/today",                 tab: true,  label: "看今天安排" },
  plan:       { path: "/pages/plan/plan",                   tab: true,  label: "看行程" },
  more:       { path: "/pages/more/more",                   tab: true,  label: "打开更多" },
  myguides:   { path: "/pages/myguides/myguides",           tab: false, label: "我的攻略" },
  help:       { path: "/pages/help/help",                   tab: false, label: "帮助与应急" },
  food:       { path: "/subpkg/food/food",                  tab: false, label: "看美食清单" },
  map:        { path: "/subpkg/map/map",                    tab: false, label: "打开地图" },
  ledger:     { path: "/subpkg/ledger/ledger",              tab: false, label: "打开账本" },
  prep:       { path: "/subpkg/prep/prep",                  tab: false, label: "行前准备" },
  guide:      { path: "/subpkg/guide/guide",                tab: false, label: "使用指南" },
  spotsearch: { path: "/subpkg/spotsearch/spotsearch",      tab: false, label: "查景点" },
  lens:       { path: "/subpkg/lens/lens",                  tab: false, label: "拍照识物" },
  toolkit:    { path: "/subpkg/toolkit/toolkit",            tab: false, label: "旅行百宝箱" },
  travelsvc:  { path: "/subpkg/travelsvc/travelsvc",        tab: false, label: "出行服务" },
  assistant:  { path: "/subpkg/assistant/assistant",        tab: false, label: "问问 AI" },
  deep:       { path: "/subai/deep/deep",                   tab: false, label: "深度玩法" }
};

const ACTION_CONTRACT =
  "\n\n【可选动作契约】仅当用户明显需要打开 App 内某功能时，才在回答末尾附一个 JSON 代码块（否则完全不要输出）。\n" +
  '```json\n{"actions":[{"type":"openPage","page":"food","city":"成都"}]}\n```\n' +
  "约束：type 只能是 openPage；page 必须取自 " + Object.keys(PAGE_MAP).join("/") + "；" +
  "city 必须是随包真实城市名；最多 2 个动作。严禁在动作里写景点名、票价、坐标、医院或任何未收录数据。";

function actionContract() { return ACTION_CONTRACT; }

function extractJSON(s) {
  var t = String(s || "");
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  var body = fence ? fence[1] : t;
  var a = body.indexOf("{"), b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch (e) { return null; }
}

// 城市必须命中本地真实城市库，杜绝 AI 借动作参数编造地名。
// 坑（实测）：T.findCity("火星城xyz") 会返回 { id:"generic", ... } 的通用模板城，
// 它是「未收录城市的降级对象」而非真实收录，绝不能单独当作真实性凭据，否则零伪造红线形同虚设。
// 口径：先要求 D.CITIES 里存在同名条目，再排除 generic 模板。
function validCity(c) {
  var name = String(c || "").trim();
  if (!name || name.length > 20) return "";
  var inList = false;
  try {
    var list = (D && Array.isArray(D.CITIES)) ? D.CITIES : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === name) { inList = true; break; }
    }
  } catch (e) {}
  if (!inList) return "";
  try {
    var hit = T.findCity && T.findCity(name);
    if (hit && hit.id === "generic") return "";
  } catch (e) {}
  return name;
}

/**
 * 把模型输出里的动作 JSON 解析成页面可直接渲染的 action 列表（复用 assistant.wxml 的 onAction）。
 * 白名单之外一律丢弃；解析失败返回空数组，绝不抛错、绝不执行未登记的路径。
 */
function parseActions(text) {
  var o = extractJSON(text);
  if (!o || !Array.isArray(o.actions)) return [];
  var out = [], seen = {};
  for (var i = 0; i < o.actions.length && out.length < 2; i++) {
    var a = o.actions[i];
    if (!a || a.type !== "openPage") continue;
    var m = PAGE_MAP[a.page];
    if (!m || seen[a.page]) continue;
    seen[a.page] = 1;
    var query = {};
    var city = validCity(a.city);
    if (city) query.city = city;
    out.push({
      label: m.label,
      path: m.path,
      query: query,
      mode: m.tab ? "tab" : "push"
    });
  }
  return out;
}

// 展示时把动作 JSON 块去掉（用户看到的是干净的回答），但保留给 parseActions 的原始文本。
function stripActionBlock(text) {
  var t = String(text || "");
  return t.replace(/```(?:json)?\s*\{[\s\S]*?"actions"[\s\S]*?\}\s*```/gi, "").trim();
}

module.exports = {
  COMPLEX_RE: COMPLEX_RE,
  PAGE_MAP: PAGE_MAP,
  needsSecondOpinion: needsSecondOpinion,
  secondOpinion: secondOpinion,
  actionContract: actionContract,
  parseActions: parseActions,
  stripActionBlock: stripActionBlock,
  validCity: validCity
};
