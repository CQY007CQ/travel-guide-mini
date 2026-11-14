// tools/check/check-ai-scenarios.mjs —— AI 全场景覆盖防回潮守卫（独立脚本，零包体影响）
// 验证：ai-brain 的全部场景都能给出非空回答 + 直达按钮；深链 topic 与页面接线一致；
//       双端（小程序 ai-brain / 网页 ai-assistant）AI 能力对齐、写操作零伪造。
// 不接入 allcheck.sh（避免改动回归步数触发材料口径门禁），由自我迭代循环/CI 按需调用。
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);
const ROOT = resolve("utils/..");
let fail = 0;
const log = (ok, msg) => { console.log((ok ? "  [ok]   " : "  [fail] ") + msg); if (!ok) fail++; };

// 1) ai-brain 运行时校验
let AI = null;
try {
  AI = require(resolve(ROOT, "subpkg/assistant/ai-brain.js"));
} catch (e) {
  console.log("  [fail] 载入 ai-brain 失败：" + (e && e.message));
  process.exit(1);
}
const scs = AI.allScenarios();
// 数量只做下限：新增场景应自动纳入覆盖检查，而不是让硬编码期望值过期后把整份守卫变成假红
// （历史故障：新增「行程复盘」后 14→15，守卫长期报失败，反而掩盖了真实路由缺口）。
log(Array.isArray(scs) && scs.length >= 15, "ai-brain 场景数 = " + (scs && scs.length) + "（期望 ≥15）");
const badFields = scs.filter(s => !s || !s.key || !s.label || !s.page || !s.sample);
log(badFields.length === 0, "全部场景字段完整（key/label/page/sample）");

// 与 assistant._applyDeepTopic 一致的「带城市场景」查询构造（用于贴近真实深链行为）
const CITYQ = {
  generate: c => "帮我生成" + c + " 3 天行程",
  food: c => c + "吃什么",
  deep: c => c + " 深度玩法",
  spotsearch: c => c + " 亲子景点"
};
let badTopic = [];
for (const s of scs) {
  let r = null;
  try {
    if (CITYQ[s.key]) r = AI.handle(CITYQ[s.key]("杭州"), { city: "杭州", plan: null, page: "assistant" });
    else r = AI.topicReply(s.key, { city: "杭州", plan: null });
  } catch (e) { r = null; }
  // 有效结果：要么带直达按钮，要么带导航跳页（委派给 ai-intent 的场景会直接跳页）
  const ok = !!r && ((Array.isArray(r.actions) && r.actions.length) || r.jump);
  if (!ok) badTopic.push(s.key);
}
log(badTopic.length === 0, "全部场景深链/问答可解析（按钮或跳页）" + (badTopic.length ? "（失败：" + badTopic.join(",") + "）" : ""));

// 2) 页面接线校验：内容分包页 + 主包 tabBar 页（门面/枢纽）都应已引入 ai-entry 组件（topic 与场景 key 对应）
const wire = {
  "subpkg/spotsearch/spotsearch.json": "spotsearch",
  "subpkg/ledger/ledger.json": "ledger",
  "subpkg/travelsvc/travelsvc.json": "travelsvc",
  "subpkg/guide/guide.json": "guide",
  "subpkg/map/map.json": "help-emergency",
  // v1.20.7：主包三页（index 门面 / more 枢纽 / myguides 攻略库）补齐统一 AI 入口，让 AI 充满全程序
  "pages/index/index.json": "generate",
  "pages/more/more.json": "settings",
  "pages/myguides/myguides.json": "guide"
};
for (const [f, topic] of Object.entries(wire)) {
  let ok = false;
  try {
    const j = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
    ok = j.usingComponents && j.usingComponents["ai-entry"] && scs.some(s => s.key === topic);
  } catch (e) {}
  log(ok, f + " 已接入 ai-entry（topic=" + topic + "）");
}

// 3) PAGE_ROUTE 覆盖断言：所有场景目标页都登记了路由
const pages = new Set(scs.map(s => s.page));
let missing = [];
for (const p of pages) if (!AI.PAGE_ROUTE[p]) missing.push(p);
log(missing.length === 0, "全部场景目标页均有路由" + (missing.length ? "（缺：" + missing.join(",") + "）" : ""));

// 4) 强模型场景提示词守卫：ai-prompts（置于 assistant 分包）必须导出 10 套场景提示词，且覆盖 ask() 真实场景名
let PROMPTS = null;
try { PROMPTS = require(resolve(ROOT, "subpkg/assistant/ai-prompts.js")); } catch (e) {}
// 同样是下限：spot / review 等新增场景提示词不应让守卫失效；真正的覆盖由下面两道防线保证
log(!!PROMPTS && PROMPTS.count >= 12, "ai-prompts 场景提示词数 = " + (PROMPTS && PROMPTS.count) + "（期望 ≥12）");
const ASK_SCENES = ["assistant", "today", "today-proactive", "plan", "food", "prep", "deep", "help", "toolkit", "lens", "spot", "review"];
let badSys = [];
for (const s of ASK_SCENES) {
  let sys = "";
  try { sys = PROMPTS.buildSystem(s); } catch (e) {}
  if (!sys || sys.length < 50) badSys.push(s);
}
log(badSys.length === 0, "全部 ask(scene) 场景均有有效 system 提示词" + (badSys.length ? "（缺：" + badSys.join(",") + "）" : ""));

// 5) 场景漂移守卫：源码里所有 AIAgent.ask("scene") 字面量，必须都能在 ai-prompts 找到对应提示词
const ASK_SRC = [];
for (const f of ["pages/today/today.js", "pages/plan/plan.js", "pages/help/help.js", "pages/index/index.js",
  "subpkg/assistant/assistant.js", "subpkg/prep/prep.js", "subpkg/food/food.js", "subpkg/lens/lens.js",
  "subai/deep/deep.js", "subpkg/toolkit/toolkit.js"]) {
  let src = "";
  try { src = readFileSync(resolve(ROOT, f), "utf8"); } catch (e) { continue; }
  const m = src.match(/AIAgent\.ask\(\s*"([^"]+)"/g) || [];
  m.forEach(function (s) { const k = s.match(/"([^"]+)"/)[1]; if (ASK_SRC.indexOf(k) < 0) ASK_SRC.push(k); });
}
const drift = ASK_SRC.filter(function (s) { return !(PROMPTS && PROMPTS.SYSTEMS && PROMPTS.SYSTEMS[s]); });
log(drift.length === 0, "源码 ask(scene) 均已有提示词（" + ASK_SRC.length + " 处场景字面量）" + (drift.length ? "（缺失：" + drift.join(",") + "）" : ""));

// 6) 离线扩面意图守卫：新增「推荐城市 / 最佳季节」零网络意图必须可解析且接地（不依赖强模型上线）
const OFFLINE_EXTRA = [
  { q: "推荐几个适合亲子的海边城市", ctx: {}, key: "recommend" },
  { q: "杭州几月去最好", ctx: { city: "杭州" }, key: "besttime" }
];
let badOff = [];
for (const o of OFFLINE_EXTRA) {
  let r = null;
  try { r = AI.handle(o.q, o.ctx); } catch (e) { r = null; }
  // 离线引擎契约：非空文本 + 至少一个直达按钮
  if (!r || !r.text || !(Array.isArray(r.actions) && r.actions.length)) badOff.push(o.key + (r && r.intent ? ":" + r.intent : ""));
}
log(badOff.length === 0, "离线扩面意图（推荐/最佳季节）可解析且接地" + (badOff.length ? "（失败：" + badOff.join(",") + "）" : ""));

// 7) 离线命中可观测导出守卫：offlineStats 必须可用（对齐 C16 旅客服务中心 AI 接通状态思路，零云依赖）
let st = null;
try { st = AI.offlineStats && AI.offlineStats(); } catch (e) {}
log(!!st && typeof st.hits === "number" && st.byIntent && typeof st.byIntent === "object", "离线命中可观测 offlineStats 可用（hits/byIntent）");

// 8) 小程序端写操作（对齐网页版）：真写账本 / 真写想玩，且未收录景点必须拒绝。
//    Node 下 utils/store.js 走 wx.*，这里给一次性 shim，用完即恢复，不污染其它守卫。
const _oldWx = globalThis.wx;
const _mem = new Map();
globalThis.wx = {
  getStorageSync(k) { const r = _mem.get(k); return r === undefined ? "" : JSON.parse(r); },
  setStorageSync(k, v) { _mem.set(k, JSON.stringify(v)); },
  removeStorageSync(k) { _mem.delete(k); },
  showToast() {}
};
try {
  const T = require(resolve(ROOT, "utils/travel.js"));
  const before = (T.getLedger() || []).length;
  const rb = AI.handle("记一笔 打车 32", { city: "成都", plan: null });
  log(!!rb && rb.intent === "quickBill" && (T.getLedger() || []).length === before + 1,
    "小程序端「记一笔」真写入本机账本（不是只回一句话）");
  const rw = AI.handle("把西湖加入想玩", { city: "成都", plan: null });
  log(!!rw && rw.intent === "addWish" &&
    (T.getWish() || []).some(x => x.name === "西湖" && x.city === "杭州"),
    "小程序端「加入想玩」写真实景点且城市归属正确（不串城）");
  const rf = AI.handle("把不存在的景点XYZ加入想玩", { city: "成都", plan: null });
  log(!!rf && /没找到/.test(rf.text), "小程序端未收录景点拒绝写入（零伪造）");
} catch (e) {
  log(false, "小程序端写操作可解析：" + ((e && e.message) || e));
} finally {
  if (_oldWx === undefined) delete globalThis.wx; else globalThis.wx = _oldWx;
}

// 9) 双端能力对齐：网页端必须补齐小程序端已有的核心场景，并共享离线统计 / 记忆契约。
//    只匹配「声明」，不对整文件取反（注释里出现同名描述不算实现）。
let webSrc = "";
try { webSrc = readFileSync(resolve(ROOT, "web/ai-assistant.js"), "utf8"); } catch (e) {}
const WEB_REQUIRED = [
  ["function sceneEmergency(", "应急分诊"],
  ["function sceneReview(", "行程复盘/游记"],
  ["function sceneRecommend(", "离线推荐城市"],
  ["function fmtMonths(", "精准最佳季节"],
  ['var MEM_KEY = "webAIStateV1"', "多轮上下文落盘"],
  ["function sceneSystemOf(", "云端分场景提示词"],
  ["offlineStats: function", "离线命中可观测"]
];
const missWeb = WEB_REQUIRED.filter(([decl]) => webSrc.indexOf(decl) < 0).map(([, label]) => label);
log(missWeb.length === 0, "网页端已与小程序端对齐场景能力" +
  (missWeb.length ? "（缺：" + missWeb.join("、") + "）" : ""));

console.log(fail === 0 ? "\n✓ AI 全场景覆盖守卫通过" : "\n✗ AI 覆盖守卫存在 " + fail + " 项失败");
process.exit(fail === 0 ? 0 : 1);
