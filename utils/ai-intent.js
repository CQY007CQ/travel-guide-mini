// utils/ai-intent.js —— 小程序助手意图增强（对齐网页版 AI 能力 · 离线 · 零合规）
//
// 补齐小程序 assistant 一直缺失、而网页版 ai-assistant.js 已具备的能力：
//   · photo    出片点（「成都哪里出片」）          → T.photoSpotOf
//   · near     周边城市（「成都附近还有哪好玩」）   → T.nearbyCities
//   · cityinfo 城市名片（「介绍一下成都」）          → T.cityBrief
//   · spot     单景点详情（「介绍一下西湖」）        → T.spotLookup + T.baikeInfo + T.spotInfoText
//   · nav      显式导航（「打开美食页」）            → 直接切页
//   · 每条回答附带 pageActions 直达按钮，让 AI 真正服务全站（对齐网页版）
//
// 所有内容来自本机离线知识库，零伪造、零网络、零合规风险。
// 返回 { text, actions, intent, jump }；返回 null 表示不处理，调用方回落 T.askAssistant（零回归）。

const T = require("./travel.js");
const DATA = require("./data.js");   // 城市/景点名列表（与 travel.js 同源的数据真源；require 命中缓存，不重复加载）

/* 轻量意图识别（只覆盖网页版有、小程序缺的意图，不抢既有 tile / 通用意图） */
const INTENTS = [
  { key: "photo",    kw: /出片|拍照|摄影|机位|美照|取景|怎么拍|拍什么|拍照点|出片点|拍照片/ },
  { key: "near",     kw: /附近|周边|顺路|邻近|周边城市|附近城市|同省|还有哪.*(玩|去|逛)/ },
  { key: "cityinfo", kw: /介绍|概况|名片|怎么样|咋样|适合玩几天|城市简介|城市概况/ }
];
function detectIntent(text) {
  for (let i = 0; i < INTENTS.length; i++) if (INTENTS[i].kw.test(text)) return INTENTS[i].key;
  return null;
}

/* 显式导航：「打开 / 跳到 X 页」才直接切页（不抢普通问答） */
const NAV_KW = [
  { re: /美食页|必吃清单/, p: "subpkg/food/food", t: "美食" },
  { re: /地图|动线|导航页/, p: "subpkg/map/map", t: "地图导引" },
  { re: /准备页|行李清单|打包/, p: "subpkg/prep/prep", t: "出行准备" },
  { re: /速查|随身问答|百科/, p: "subpkg/assistant/assistant", t: "本地速查" },
  { re: /工具箱|百宝箱/, p: "subpkg/toolkit/toolkit", t: "旅行百宝箱" },
  { re: /找景点|按标签|标签检索/, p: "subpkg/spotsearch/spotsearch", t: "按标签找景点" },
  { re: /深度玩法|机位|避坑/, p: "subai/deep/deep", t: "城市深度玩法" },
  { re: /今天页|今日速览/, p: "pages/today/today", t: "今天" },
  { re: /行程页|每日行程/, p: "pages/plan/plan", t: "每日行程" },
  { re: /更多页|设置页/, p: "pages/more/more", t: "更多" },
  { re: /应急|医院|120|急救/, p: "pages/help/help", t: "旅途应急" },
  { re: /生成攻略|首页|规划页/, p: "pages/index/index", t: "生成攻略" }
];
function detectNav(text) {
  for (let i = 0; i < NAV_KW.length; i++) if (NAV_KW[i].re.test(text)) return NAV_KW[i];
  return null;
}

/* 城市识别：从文本里找已知城市名（SPOT_COORDS 城市级键 + CITIES 名 + PROVINCES，最长优先）；无则从 ctx.city 兜底 */
let _cityReg;
function buildCityReg() {
  if (_cityReg !== undefined) return _cityReg;   // 含 null（无数据时不再重建）
  const cities = Object.keys((DATA.SPOT_COORDS) || {}).filter(c => c && c.length >= 2);
  const cityNames = ((DATA.CITIES) || []).map(c => (c && c.name) || "").filter(Boolean);
  const provs = (DATA.PROVINCES) || [];
  const toks = cities.concat(provs, cityNames).filter(t => t && t.length >= 2);
  if (!toks.length) { _cityReg = null; return null; }
  toks.sort((a, b) => b.length - a.length);
  const esc = toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  _cityReg = new RegExp(esc.join("|"), "g");
  return _cityReg;
}
function cityOf(text, fallback) {
  const reg = buildCityReg();
  if (!reg) return ((fallback && String(fallback).length >= 2) ? String(fallback) : null);
  reg.lastIndex = 0;
  let m, found = null, fl = 0;
  while ((m = reg.exec(text)) !== null) {
    if (m[0].length > fl) { fl = m[0].length; found = m[0]; }
    if (m[0].length === 0) break;   // 防御：token≥2 不会产生零长匹配，但兜底跳出，避免任何引擎下的死循环
  }
  if (found) return found;
  return ((fallback && String(fallback).length >= 2) ? String(fallback) : null);
}

/* 单景点名识别：复用 SPOT_DETAILS 策展键（930 个具名真实景点），最长优先正则 */
let _spotReg;
function buildSpotReg() {
  if (_spotReg !== undefined) return _spotReg;
  const keys = Object.keys((DATA.SPOT_DETAILS) || {}).filter(k => k && k.length >= 2);
  if (!keys.length) { _spotReg = null; return null; }
  keys.sort((a, b) => b.length - a.length);
  const esc = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  _spotReg = new RegExp(esc.join("|"), "g");
  return _spotReg;
}
function spotInText(text) {
  const reg = buildSpotReg();
  if (!reg) return null;
  reg.lastIndex = 0;
  let m, found = null, fl = 0;
  while ((m = reg.exec(text)) !== null) {
    if (m[0].length > fl) { fl = m[0].length; found = m[0]; }
    if (m[0].length === 0) break;
  }
  return found;
}

function act(path, label, query, mode) { return { label, path, query: query || {}, mode: mode || "push" }; }

/* 通用 pageActions（对齐网页版：每条回答给「直达对应页」按钮） */
function pageActions(city, intent) {
  const cityQ = city ? { city } : {};
  const common = [act("pages/plan/plan", "看每日行程 →", {}, "tab"), act("subpkg/map/map", "看地图导引 →")];
  if (intent === "photo") return [act("subai/deep/deep", "城市深度玩法 →", cityQ), act("subpkg/spotsearch/spotsearch", "按标签找景点 →")].concat(common);
  if (intent === "near") return [act("subpkg/spotsearch/spotsearch", "按标签找景点 →"), act("pages/index/index", "换个城市生成 →", {}, "tab")];
  if (intent === "cityinfo") return [act("subpkg/food/food", "打开美食清单 →", cityQ), act("subai/deep/deep", "城市深度玩法 →", cityQ)].concat(common);
  // 单景点详情
  return [act("subpkg/spotsearch/spotsearch", "按标签找更多景点 →"), act("subai/deep/deep", "城市深度玩法 →", cityQ)].concat(common);
}

/* ── 各意图处理器 ── */
function handlePhoto(city) {
  const arr = (T.photoSpotOf ? T.photoSpotOf(city) : []) || [];
  if (!arr.length) {
    return {
      text: "「" + city + "」暂时没有整理专门的出片点。可以先生成行程沿途找机位，或看城市深度玩法。",
      actions: [act("pages/plan/plan", "去生成行程 →", {}, "tab"), act("subai/deep/deep", "城市深度玩法 →", { city })],
      intent: "photo"
    };
  }
  const lines = ["📷 " + city + " 适合出片 / 拍照的地方（离线库整理）："];
  arr.slice(0, 6).forEach(s => {
    const name = (s && typeof s === "string") ? s : (s && s.name) || "";
    const tip = (s && typeof s === "object" && (s.tip || s.desc)) || "";
    lines.push("· " + name + (tip ? "：" + tip : ""));
  });
  lines.push("清晨和黄昏光线最出片，带上相机或手机就出发～");
  return { text: lines.join("\n"), actions: pageActions(city, "photo"), intent: "photo" };
}

function handleNear(city) {
  const arr = (T.nearbyCities ? T.nearbyCities(city, 6) : []) || [];
  if (!arr.length) {
    return { text: "「" + city + "」附近暂无可推荐城市。", actions: [act("pages/plan/plan", "去生成行程 →", {}, "tab")], intent: "near" };
  }
  const lines = ["🧭 " + city + " 附近值得顺路逛的城市（按直线距离）："];
  arr.forEach(x => {
    const name = (x && (x.name || x)) || "";
    const prov = (x && x.province) || "";
    const km = (x && x.km != null) ? (" 约 " + x.km + " km") : "";
    lines.push("· " + name + (prov ? "（" + prov + "）" : "") + km);
  });
  lines.push("想看哪座？直接说城市名，我给你美食、景点和最佳月份～");
  return { text: lines.join("\n"), actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")], intent: "near" };
}

function handleCityInfo(city) {
  const cb = (T.cityBrief ? T.cityBrief(city) : null);
  if (!cb) {
    return { text: "关于「" + city + "」，离线库里没有更详细的城市名片；我可以先生成一份行程。", actions: [act("pages/plan/plan", "去生成行程 →", {}, "tab")], intent: "cityinfo" };
  }
  const lines = [];
  lines.push("🏙 " + (cb.name || city) + " · 建议玩 " + (cb.days || "?") + " 天 · " + (cb.climateTxt || "") + " · " + (cb.costTxt || ""));
  lines.push("最佳出行：" + (cb.best || "四季皆宜"));
  if (cb.foods && cb.foods.length) lines.push("招牌：" + cb.foods.slice(0, 6).join("、"));
  if (cb.areas && cb.areas.length) lines.push("热门住宿区：" + cb.areas.slice(0, 3).map(a => (a && a.name) || a).join("、"));
  if (cb.text) lines.push(cb.text);
  return { text: lines.join("\n"), actions: pageActions(city, "cityinfo"), intent: "cityinfo" };
}

function handleSpot(text, cityHint) {
  // 仅当用户明显在问「某个具体景点」时介入
  if (!/介绍|简介|怎么样|咋样|门票|开放时间|几点开|几点开放|游玩|值得去|百科|科普|攻略|是什么|讲讲|说说|详情/.test(text)) return null;
  const name = spotInText(text);
  if (!name) return null;
  try {
    const lk = (T.spotLookup ? T.spotLookup(name, cityHint || "") : null) || {};
    const bk = (T.baikeInfo ? T.baikeInfo(name, cityHint || "") : null) || { has: false };
    const city = lk.city || cityHint || "";
    const intro = lk.intro || (bk && bk.intro) || "";
    const facts = [];
    if (T.spotInfoText) { const si = T.spotInfoText(name); if (si) facts.push(si); }
    if (bk && bk.text && bk.text !== intro) facts.push(bk.text);
    if (lk.how) facts.push("怎么去：" + lk.how);
    const lines = [];
    lines.push("【" + name + "】" + (city ? "（" + city + "）" : ""));
    if (intro) lines.push(intro.length > 120 ? intro.slice(0, 120) + "…" : intro);
    if (facts.length) lines.push(facts.join("\n"));
    if (!intro && !facts.length) lines.push("离线库已收录该景点的坐标 / 交通信息，但暂未整理深度百科。可以生成行程把它排进去，或问「成都吃什么」这类周边信息。");
    return {
      text: lines.join("\n"),
      actions: [act("subpkg/spotsearch/spotsearch", "按标签找更多景点 →"), act("subai/deep/deep", "城市深度玩法 →", city ? { city } : {})],
      intent: "spot"
    };
  } catch (e) { return null; }
}

function isTab(p) {
  return ["pages/index/index", "pages/today/today", "pages/plan/plan", "pages/more/more"].indexOf(p) >= 0;
}
function numOf(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (map[s] != null) return map[s];
  const m = String(s).match(/[0-9]+/); return m ? parseInt(m[0], 10) : 0;
}

/* 主入口：返回结果对象或 null（不处理时回落 T.askAssistant） */
function handle(text, ctx) {
  text = (text || "").trim();
  if (!text) return null;
  ctx = ctx || {};
  // ① 显式导航：直接切页（不返回文本）
  const nav = detectNav(text);
  if (nav) {
    const q = {};
    const dm = text.match(/第\s*(\d+|[一二三四五六七八九十])\s*天/);
    if (nav.p === "subpkg/map/map" && dm) q.di = Math.max(0, numOf(dm[1]) - 1);
    return {
      text: "好，已切到「" + nav.t + "」。这一页的数据都来自本机离线知识库。",
      jump: { path: nav.p, query: q, mode: (nav.p.indexOf("pages/") === 0 && isTab(nav.p)) ? "tab" : "push" },
      actions: [],
      intent: "nav"
    };
  }
  const city = cityOf(text, ctx.city);
  // ② 单景点详情（优先于泛城市意图）
  const spot = handleSpot(text, city || "");
  if (spot) return spot;
  // ③ 城市级新意图（photo / near / cityinfo）
  const intent = detectIntent(text);
  if (intent === "photo" && city) return handlePhoto(city);
  if (intent === "near" && city) return handleNear(city);
  if (intent === "cityinfo" && city) return handleCityInfo(city);
  // ④ 云同步（跨端互通）：复制 / 输入同步码 + 上传 / 恢复行程
  if (/同步|云同步|多端|跨端|换手机|另一台|备份到云|云端备份|云端恢复|上传行程/.test(text)) {
    return {
      text: "云同步已就绪（本地优先，断网自动回落本机）。两端共享同一份行程，先用「同步码」关联：一端点复制同步码，另一端粘贴输入即可互通；随后可把当前行程上传到云端，或从云端恢复到本机。",
      actions: [
        act("", "复制同步码", {}, "copySync"),
        act("", "输入同步码", {}, "inputSync"),
        act("", "上传行程到云端", {}, "pushPlan"),
        act("", "从云端恢复", {}, "pullPlan")
      ],
      intent: "sync"
    };
  }
  return null;
}

module.exports = { handle, detectIntent, detectNav, cityOf, pageActions };
