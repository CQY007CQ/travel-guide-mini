#!/usr/bin/env node
/**
 * tools/check/check-ai-reach.mjs —— 「更强 AI + 全站适配」防回潮守卫（v1.20.6）
 *
 * 守住：
 *   ① 全站入口把「来源页真实数据」带进 grounding（不是只带 topic + city）
 *   ② 复杂问题真正跑独立第二视角，而不是只在提示词里喊「多链投票」
 *   ③ AI 动作必须走白名单路径 + 真实城市校验（含 generic 模板城漏洞）
 *   ④ 新增能力全在分包，主包零增长；15/17 交互页有统一入口，主包 tab 页用 inline
 *
 * 项目踩过的坑：断言查字面量会被自身注释误伤 —— 所有「不应存在」的断言先滤注释行。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const code = (s) => s.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*|<!--|#)/.test(l))
  .join("\n");

let n = 0, fail = 0;
function ck(name, cond, extra) {
  n++;
  if (cond) { console.log("  [ok]   " + name); return; }
  fail++;
  console.log("  [fail] " + name + (extra ? "  → " + extra : ""));
}

const entry = code(read("subpkg/ai-entry/ai-entry.js"));
const ctx = code(read("subpkg/assistant/ai-context.js"));
const reason = code(read("subpkg/assistant/ai-reason.js"));
const asst = code(read("subpkg/assistant/assistant.js"));
const wxml = code(read("subpkg/assistant/assistant.wxml"));
const wxss = read("subpkg/assistant/assistant.wxss");
const moreJsA = code(read("pages/more/more.js"));
const webAiJs = code(read("web/ai-assistant.js"));

/* ---------- ① 页面级 grounding ---------- */
ck("新增纯逻辑模块都在 assistant 分包（主包零增长）",
  /const AIContext = require\("\.\.\/assistant\/ai-context\.js"\)/.test(entry));
ck("AI 入口跳转前采集来源页真实上下文",
  /AIContext\.build\(this\.data\.topic/.test(entry) && /__aiPageCtx/.test(entry));
ck("上下文走内存传递且限长、5 分钟失效",
  /ts: Date\.now\(\)/.test(entry) && /5 \* 60 \* 1000/.test(asst) && /slice\(0, 1200\)/.test(asst));
ck("助手页读取来源页上下文并要求场景匹配",
  /app\.globalData\.__aiPageCtx/.test(asst) && /pc\.topic === this\._deep\.topic/.test(asst));
ck("三处 AIAgent.ask 统一经 _contextOf 注入 grounding",
  (asst.match(/this\._contextOf\(/g) || []).length >= 3,
  "调用数=" + (asst.match(/this\._contextOf\(/g) || []).length);
ck("上下文模块只声明真实数据快照与禁编造",
  /真实数据快照/.test(ctx) && /不得推测或编造/.test(ctx) && /MAX_CHARS/.test(ctx));
ck("上下文模块不联网、不落盘、不生成名称",
  !/wx\.request|Math\.random|疑似\$\{|可能是\$\{/.test(ctx));

/* ---------- ② 真·第二视角 ---------- */
ck("自由对话并发主回答与独立审慎视角",
  /Promise\.all\(\[main, alt\]\)/.test(asst) && /AIReason\.secondOpinion/.test(asst));
ck("只有复杂问题才触发第二视角（省云配额）",
  /AIReason\.needsSecondOpinion\(q\)/.test(asst) && /COMPLEX_RE/.test(reason));
ck("第二视角用独立 system 且失败只返回 null（不拖垮主回答）",
  /ALT_SYS/.test(reason) && /catch\(function \(\) \{ return null; \}\)/.test(reason));
ck("不复用 AIAgent.ask 污染记忆（第二视角走 aiChat 直调）",
  /Cloud\.aiChat\(/.test(reason) && !/AIAgent\.ask/.test(reason));
ck("双视角明确标注并列供判断，不假装投票出唯一结论",
  /另一视角/.test(wxml) && /请与主回答对照判断/.test(wxml));
ck("结果区有视角切换按钮与样式",
  /bindtap="toggleAlt"/.test(wxml) && /\.dual-tab\.on/.test(wxss));
ck("双视角区块只在云端回答时出现（离线不残留旧视角）",
  /wx:if="\{\{aiSource && dualOn\}\}"/.test(wxml));

/* ---------- ③ 白名单动作与零伪造 ---------- */
ck("主回答注入动作契约", /AIReason\.actionContract\(\)/.test(asst));
ck("模型输出经 parseActions 白名单解析后才渲染",
  /AIReason\.parseActions\(raw\)/.test(asst) && /actions: actions/.test(asst));
ck("展示前剥离动作 JSON 块", /AIReason\.stripActionBlock\(raw\)/.test(asst));
ck("动作只认 openPage 且 page 必须在 PAGE_MAP",
  /a\.type !== "openPage"/.test(reason) && /PAGE_MAP\[a\.page\]/.test(reason));
ck("城市校验以随包 CITIES 严格命中为准（不单靠 findCity）",
  /list\[i\]\.name === name/.test(reason) && /if \(!inList\) return ""/.test(reason));
ck("堵住 generic 模板城漏洞（未收录城市不得当真城市）",
  /hit\.id === "generic"/.test(reason));
ck("动作契约明确禁止景点/票价/坐标/医院",
  /严禁在动作里写景点名、票价、坐标、医院/.test(reason));
ck("动作复用 onAction 数据结构（label/path/query/mode）",
  /label: m\.label/.test(reason) && /query: query/.test(reason) && /mode: m\.tab \? "tab" : "push"/.test(reason));

/* ---------- ④ 全站入口覆盖 ---------- */
let appJson = null;
try { appJson = JSON.parse(read("app.json")); } catch (e) {}
const allPages = (appJson && Array.isArray(appJson.pages) ? appJson.pages.slice() : []);
((appJson && appJson.subPackages) || []).forEach(sp => (sp.pages || []).forEach(p => allPages.push(sp.root + "/" + p)));
const real = allPages.filter(p => !/^pages\/splash\/|^subdata\d*\/(keep|boost)\//.test(p));
const AIPAGE = /^subpkg\/(assistant\/assistant|lens\/lens)$/;
const noEntry = real.filter(p => {
  try { return !/"ai-entry"/.test(read(p + ".json")); } catch (e) { return true; }
});
ck("除 AI 能力页自身外全部交互页有统一入口",
  noEntry.length > 0 && noEntry.every(p => AIPAGE.test(p)), "无入口=" + noEntry.join(","));
ck("入口覆盖 ≥15/17", (real.length - noEntry.length) >= 15,
  (real.length - noEntry.length) + "/" + real.length);
// 主包页（含 tabBar 页）必须 inline，避免 FAB 压 tabBar（历史踩过的坑）
let inlineBad = [];
for (const p of real.filter(x => /^pages\//.test(x))) {
  let w = "";
  try { w = read(p + ".wxml"); } catch (e) { continue; }
  const tags = w.match(/<ai-entry[^>]*>/g) || [];
  if (tags.some(t => !/inline/.test(t))) inlineBad.push(p);
}
ck("主包页 AI 入口一律 inline（不压 tabBar）", inlineBad.length === 0, inlineBad.join(","));
// v1.20.7 修的真 bug：微信禁止主包页面直接使用分包内自定义组件 —— 页面 json 里写
// "../../subpkg/ai-entry/ai-entry" 时，运行期报 `Component is not found in path ...`，
// 组件**静默不渲染**（首页/更多页的 AI 胶囊从来没出现过，用户只能从九宫格 tile 进 AI）。
// 官方解法是给页面配 componentPlaceholder，组件会在分包就绪后正常挂载。
// 上面那条 inline 断言只查 wxml 属性，正好是「查字符串造成假绿」——所以这里补一条结构断言。
let phBad = [];
for (const p of real.filter(x => /^pages\//.test(x))) {
  let j = null;
  try { j = JSON.parse(read(p + ".json")); } catch (e) { continue; }
  const uc = (j && j.usingComponents) || {};
  const target = String(uc["ai-entry"] || "");
  if (!target) continue;
  const isSubPkg = /subpkg|subai|subdata/.test(target);
  const hasPh = !!(j.componentPlaceholder && j.componentPlaceholder["ai-entry"]);
  if (isSubPkg && !hasPh) phBad.push(p);
}
ck("主包页引用分包组件时已声明 componentPlaceholder", phBad.length === 0, phBad.join(","));
ck("每个入口 topic 都在场景表内",
  (function () {
    for (const p of real) {
      let w = "";
      try { w = read(p + ".wxml"); } catch (e) { continue; }
      for (const m of (w.match(/<ai-entry[^>]*>/g) || [])) {
        const t = (m.match(/topic="([^"]+)"/) || [])[1];
        if (t && !/^(generate|food|today|planOptimize|prep|spotsearch|deep|ledger|help-emergency|lens|travelsvc|toolkit|guide|settings|review|spot|map|help|plan)$/.test(t)) return false;
      }
    }
    return true;
  })());

/* ---------- ⑤ 使用指南置顶 AI / 识物重点组 ---------- */
// 用户明确要求指南重点强调 AI 与识图；防止后续改版把置顶组或直达按钮删掉。
const guideJs = code(read("subpkg/guide/guide.js"));
const guideWxml = code(read("subpkg/guide/guide.wxml"));
ck("使用指南置顶「AI 助手 · 拍照识物」重点组，含助手/识物/一句话生成/页面上下文四条",
  /g:\s*"AI 助手 · 拍照识物（重点）"/.test(guideJs) &&
  /t:\s*"AI 助手：像旅行搭子一样问"/.test(guideJs) &&
  /t:\s*"拍照识物（识图）"/.test(guideJs) &&
  /t:\s*"一句话生成行程"/.test(guideJs) &&
  /t:\s*"从当前页问，答案更贴场景"/.test(guideJs));
ck("指南有 AI 助手/识物两个一键直达按钮（不展开可见）",
  /data-url="\/subpkg\/assistant\/assistant"/.test(guideWxml) &&
  /data-url="\/subpkg\/lens\/lens"/.test(guideWxml) &&
  /class="g-ai-quick"/.test(guideWxml));

/* ---------- ⑥ 折叠状态同步 + 网页 AI 场景对齐 ---------- */
ck("更多页单组折叠后重算总开关（文案不与实际状态相反）",
  /Object\.keys\(collapsed\)\.every\(/.test(moreJsA) && /allCollapsed/.test(moreJsA));
ck("网页 AI 把「拍照识物」引导到识物页，不误答出片点",
  /识物\|识别\|认出/.test(webAiJs) && /act\("subpkg\/lens\/lens",\s*"打开拍照识物/.test(webAiJs) &&
  /intent:\s*"lens"/.test(webAiJs));
ck("网页直连未配置/失效时静默回落，不向用户弹 Base URL 技术警告",
  /if \(!base\) \{ onErr\(null\);/.test(webAiJs) && /if \(err\) pushBot/.test(webAiJs) &&
  !/onErr\("Base URL 不合法：仅支持 https/.test(webAiJs));
// 浏览器 fetch 无内建超时：网关半挂会让面板永久「思考中」，用户只能刷新。
ck("网页直连大模型有硬超时中止，且超时与跨域分开收口",
  /new AbortController\(\)/.test(webAiJs) && /signal: ac \? ac\.signal/.test(webAiJs) &&
  /aborted \?/.test(webAiJs) && /网关未回包/.test(webAiJs));

// AI 按钮在「思考中」仍然可点 → 连点会命中 AIAgent 的 scene 锁返回 inflight，
// 各页把 inflight 当失败处理 → 界面被离线答案闪替（用户以为 AI 坏了）。
// 这是一类问题：同类守卫必须横向扫全部 AI 页面，只盯报障那一个必然漏。
["pages/today/today.js", "pages/plan/plan.js", "pages/help/help.js",
 "subpkg/prep/prep.js", "subpkg/food/food.js", "subpkg/toolkit/toolkit.js",
 "subai/deep/deep.js"].forEach(function (p) {
  ck("AI 提问按钮有加载守卫（连点不命中 inflight）· " + p,
    /if \(this\.data\.aiLoading\) return;/.test(read(p)));
});

console.log("  更强 AI / 全站适配防回潮守卫: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
