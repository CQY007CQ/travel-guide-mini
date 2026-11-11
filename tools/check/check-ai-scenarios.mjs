// tools/check/check-ai-scenarios.mjs —— AI 全场景覆盖防回潮守卫（独立脚本，零包体影响）
// 验证：ai-brain 的 14 个场景都能给出非空回答 + 直达按钮；深链 topic 与页面接线一致。
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
log(Array.isArray(scs) && scs.length === 14, "ai-brain 场景数 = " + (scs && scs.length) + "（期望 14）");

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
log(!!PROMPTS && PROMPTS.count === 10, "ai-prompts 场景提示词数 = " + (PROMPTS && PROMPTS.count) + "（期望 10）");
const ASK_SCENES = ["assistant", "today", "today-proactive", "plan", "food", "prep", "deep", "help", "toolkit", "lens"];
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

console.log(fail === 0 ? "\n✓ AI 全场景覆盖守卫通过" : "\n✗ AI 覆盖守卫存在 " + fail + " 项失败");
process.exit(fail === 0 ? 0 : 1);
