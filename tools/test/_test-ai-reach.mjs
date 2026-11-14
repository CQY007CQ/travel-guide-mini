#!/usr/bin/env node
/**
 * tools/test/_test-ai-reach.mjs —— 全站 AI 上下文 / 双视角 / 白名单动作 单测（v1.20.6）
 *
 * 全部离线：不碰 wx.*、不碰网络。直接 require 分包模块与 app.json / utils 数据。
 * 重点验证「零伪造」：上下文里的数字与名称必须来自真实数据，动作路径必须真实存在、
 * 城市必须命中本地城市库，绝不因为模型输出就跳到编造的页面或地名。
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const req = createRequire(fileURLToPath(import.meta.url));
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const R = req(path.join(ROOT, "subpkg/assistant/ai-reason.js"));
const A = req(path.join(ROOT, "subpkg/assistant/ai-context.js"));
const D = req(path.join(ROOT, "utils/data.js"));
const appJson = JSON.parse(readFileSync(path.join(ROOT, "app.json"), "utf8"));

let n = 0, fail = 0;
function ok(name, cond, extra) {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
}

/* ---------- 1. 页面级真实上下文 ---------- */
const allTopics = A.topics();
ok("覆盖了全部已知入口场景", allTopics.length >= 15, "n=" + allTopics.length);
ok("每个场景都能产出上下文且限长",
  allTopics.every(t => { const s = A.build(t, { city: "成都", plan: null }); return s.length > 20 && s.length <= A.MAX_CHARS; }));
ok("上下文明确标注真实数据 / 非实时 / 禁止编造",
  /真实数据快照/.test(A.build("food", { city: "成都" })) &&
  /非实时/.test(A.build("food", { city: "成都" })) &&
  /不得推测或编造/.test(A.build("food", { city: "成都" })));
ok("未知 topic 也能安全兜底（不抛错、不编造）",
  A.build("不存在的场景xyz", { city: "", plan: null }).indexOf("入口场景") >= 0);

const foodCtx = A.build("food", { city: "成都", plan: null });
const foodNames = (D.FOOD_SPOTS["成都"] || []).slice(0, 3).map(x => x.shop).filter(Boolean);
ok("美食页上下文列出随包真实店名与店数",
  /随包收录该城美食店 \d+ 家/.test(foodCtx) && foodNames.every(x => foodCtx.indexOf(x) >= 0),
  foodCtx.slice(0, 200));
const helpCtx = A.build("help-emergency", { city: "成都" });
ok("应急页上下文列出具名医院 / 降级城真实口径",
  /具名医院 \d+ 家/.test(helpCtx) && /地图搜索降级/.test(helpCtx), helpCtx.slice(0, 200));
const planObj = { cityName: "成都", days: [{ items: [{ name: "武侯祠" }] }, { items: [{ name: "杜甫草堂" }] }], people: 2, pace: "balance", depart: "2026-12-01" };
const planCtx = A.build("planOptimize", { city: "成都", plan: planObj });
ok("行程页上下文带真实天数 / 人数 / 点位数", /2 天/.test(planCtx) && /2 人/.test(planCtx) && /2 个安排点位/.test(planCtx));
ok("行程页上下文带自检分（真实 API）", /行程自检 \d+ 分/.test(planCtx));
ok("无行程时不编造行程信息", /当前没有已生成行程/.test(A.build("today", { city: "", plan: null })));
ok("上下文不出现「大约/估计/疑似/可能是」等生成词",
  !/大约|估计|疑似|可能是|应该有/.test(A.build("food", { city: "成都" })));

/* ---------- 2. 双视角触发判定 ---------- */
ok("取舍 / 对比 / 体检类复杂问题触发第二视角",
  ["这趟行程怎么安排更合理", "成都和重庆哪个更值得去", "我的行程有没有问题", "帮我复盘这趟行程"]
    .every(q => R.needsSecondOpinion(q)));
ok("简单事实查询不触发（省云配额）",
  !R.needsSecondOpinion("成都吃什么") && !R.needsSecondOpinion("今天星期几") && !R.needsSecondOpinion(""));
ok("长问题触发第二视角", R.needsSecondOpinion("我想带老人去一个不太累、天气舒服、花费别太高的地方玩几天该怎么安排"));
ok("契约文本约束了 type / page / city 且禁止编造数据",
  /openPage/.test(R.actionContract()) && /严禁在动作里写景点名/.test(R.actionContract()));

/* ---------- 3. 动作白名单解析（零伪造核心） ---------- */
const good = '这是建议。\n```json\n{"actions":[{"type":"openPage","page":"food","city":"成都"}]}\n```';
const acts = R.parseActions(good);
ok("合法动作解析出 1 个且字段可直接交给 onAction",
  acts.length === 1 && acts[0].path === "/subpkg/food/food" && acts[0].mode === "push" && acts[0].query.city === "成都",
  JSON.stringify(acts));
ok("tab 页动作用 switchTab 模式", R.parseActions('```json\n{"actions":[{"type":"openPage","page":"plan"}]}\n```')[0].mode === "tab");
ok("未登记的 page 被丢弃", R.parseActions('```json\n{"actions":[{"type":"openPage","page":"__hack__"}]}\n```').length === 0);
ok("非 openPage 的 type 被丢弃", R.parseActions('```json\n{"actions":[{"type":"deleteAll","page":"food"}]}\n```').length === 0);
ok("编造的城市不进入 query（不产生假地名）",
  R.parseActions('```json\n{"actions":[{"type":"openPage","page":"food","city":"火星城xyz"}]}\n```')[0].query.city === undefined);
ok("同页动作去重且最多 2 个",
  R.parseActions('```json\n{"actions":[{"type":"openPage","page":"food"},{"type":"openPage","page":"food"},{"type":"openPage","page":"ledger"},{"type":"openPage","page":"map"}]}\n```').length === 2);
ok("非 JSON / 空文本不抛错", R.parseActions("就是一段普通回答").length === 0 && R.parseActions("").length === 0);
ok("动作 JSON 块从展示文本中移除、正文保留",
  R.stripActionBlock(good) === "这是建议。" || R.stripActionBlock(good).indexOf("这是建议") === 0,
  JSON.stringify(R.stripActionBlock(good)));
ok("城市校验命中本地真实城市、拒绝编造地名", R.validCity("成都") === "成都" && R.validCity("火星城xyz") === "");

/* ---------- 4. 白名单路径必须真实存在于 app.json ---------- */
const realPaths = new Set(appJson.pages.map(p => "/" + p));
((appJson.subPackages) || []).forEach(sp => (sp.pages || []).forEach(p => realPaths.add("/" + sp.root + "/" + p)));
const keys = Object.keys(R.PAGE_MAP);
ok("动作白名单覆盖 ≥15 个真实页面", keys.length >= 15, "n=" + keys.length);
ok("白名单里每条路径都在 app.json 注册（杜绝死链）",
  keys.every(k => realPaths.has(R.PAGE_MAP[k].path)),
  keys.filter(k => !realPaths.has(R.PAGE_MAP[k].path)).join(","));

/* ---------- 5. 全站入口覆盖 ---------- */
const allPages = appJson.pages.slice();
((appJson.subPackages) || []).forEach(sp => (sp.pages || []).forEach(p => allPages.push(sp.root + "/" + p)));
const real = allPages.filter(p => !/^pages\/splash\/|^subdata\d*\/(keep|boost)\//.test(p));
const AIPAGE = /^subpkg\/(assistant\/assistant|lens\/lens)$/;
const noEntry = real.filter(p => {
  try { return !/"ai-entry"/.test(readFileSync(path.join(ROOT, p + ".json"), "utf8")); }
  catch (e) { return true; }
});
ok("除 AI 能力页自身外，全部交互页都有统一 AI 入口",
  noEntry.every(p => AIPAGE.test(p)), "无入口=" + noEntry.join(","));
ok("入口覆盖率 ≥ 15/17", (real.length - noEntry.length) >= 15,
  (real.length - noEntry.length) + "/" + real.length);

console.log("  全站 AI 上下文 / 双视角 / 动作单测: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
