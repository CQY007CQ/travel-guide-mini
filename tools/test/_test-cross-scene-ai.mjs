/**
 * _test-cross-scene-ai.mjs —— 跨页 AI 衔接单测（零依赖、不联网）
 * 验证：① 其他页最近问题注入 context ② 只注入不写回 ③ 10 分钟时效
 *       ④ 清空会话立即失效 ⑤ 不重复当前场景 ⑥ 云未开不拼装
 *       ⑦ 进程被回收（冷启动）后时效基准仍在 —— 时间戳落盘前这条恒失败
 *       ⑧ 冷启动但已超 TTL 依旧不串台（落盘不放宽时效）
 *       ⑨ 11 个场景全量落盘（MAX_SCENES 不足会静默淘汰他页记忆）
 * 用法：node tools/test/_test-cross-scene-ai.mjs
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";

const require = createRequire(import.meta.url);
const ROOT = resolve("utils/..");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("== 跨页 AI 衔接 ==");

// 用 vm 加载 ai-agent.js，注入可控的 Cloud / store / data，观测 aiChat 收到的 context
const src = readFileSync(resolve(ROOT, "utils/ai-agent.js"), "utf8");
function loadAgent(opts) {
  const o = opts || {};
  let clock = o.clock || 1000000;
  // o.store：传入同一个 Map 可模拟「进程被回收但 storage 还在」（冷启动）；
  // 不传则每个实例一份独立 storage（同一次运行内）。
  const store = o.store || new Map();
  const calls = [];
  const sandbox = {
    module: { exports: {} }, exports: {},
    require(name) {
      if (name === "./cloud.js") return {
        cloudEnabled: () => o.cloud !== false,
        aiChat: (p) => { calls.push(p); return Promise.resolve({ ok: true, text: "答" }); }
      };
      if (name === "./store.js") return {
        get: (k) => store.get(k), set: (k, v) => store.set(k, v)
      };
      if (name === "./data.js") return { CITIES: [] };
      throw new Error("unexpected require " + name);
    },
    Date: { now: () => clock },
    console
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(src, sandbox, { filename: "ai-agent.js" });
  return {
    api: sandbox.module.exports,
    calls, store,
    now() { return clock; },
    tick(ms) { clock += ms; }
  };
}

(async () => {
  // 先在 today 页问一次，记忆落下来
  const a = loadAgent();
  a.api.remember("today", "user", "今天下雨怎么办");
  a.api.remember("today", "assistant", "带伞，改室内景点");

  // 切到 food 页提问 —— 应带上 today 的问题，但不带回答
  await a.api.ask("food", "那推荐室内吃的", "本地上下文");
  const ctx = a.calls[0].context || "";
  ok("其他页最近问题注入 context", ctx.indexOf("今天下雨怎么办") >= 0);
  ok("只注入问题不注入回答（控 token）", ctx.indexOf("带伞，改室内景点") < 0);
  ok("标注跨页上下文用途", ctx.indexOf("跨页上下文") >= 0 && ctx.indexOf("勿当成该页事实") >= 0);
  ok("保留原页面本地上下文", ctx.indexOf("本地上下文") >= 0);
  ok("messages 仍只含本场景（不污染对话历史）",
    a.calls[0].messages.filter(m => m.role === "user").length === 1);

  // 10 分钟时效
  const b = loadAgent();
  b.api.remember("today", "user", "旧问题");
  b.tick(11 * 60 * 1000);
  await b.api.ask("food", "新问题", "c");
  ok("超过 10 分钟不串台", (b.calls[0].context || "").indexOf("旧问题") < 0);

  // 清空会话立即失效（缓存也不留）
  const c = loadAgent();
  c.api.remember("today", "user", "将被清空的问题");
  await c.api.ask("food", "q1", "c");
  ok("清空前确实注入了", (c.calls[0].context || "").indexOf("将被清空的问题") >= 0);
  c.api.clearHistory();
  await c.api.ask("food", "q2", "c");
  ok("清空会话后不再注入旧问题", (c.calls[1].context || "").indexOf("将被清空的问题") < 0);

  // 不重复当前场景自己的历史（ask 已通过 messages 带上）
  const d = loadAgent();
  d.api.remember("food", "user", "当前页自己的问题");
  await d.api.ask("food", "新问题", "c");
  ok("不重复当前场景自己的历史", (d.calls[0].context || "").indexOf("当前页自己的问题") < 0);

  // 云未开：不拼装跨页上下文，也不调用 aiChat
  const e = loadAgent({ cloud: false });
  e.api.remember("today", "user", "不该被拼装");
  const r = await e.api.ask("food", "q", "c");
  ok("云未开直接回落（不拼装、不调用）", r.ok === false && e.calls.length === 0);

  // ⑦ 冷启动：同一份 storage、全新实例（_sceneTs 归零），10 分钟后仍应注入。
  // 这正是「隔天/被系统回收后再问就接不上」的真实场景；时间戳不落盘时这条恒失败。
  const shared = new Map();
  const f1 = loadAgent({ store: shared });
  f1.api.remember("today", "user", "进程被杀前问过的问题");
  const f2 = loadAgent({ store: shared, clock: f1.now() + 2 * 60 * 1000 });
  await f2.api.ask("food", "那推荐室内吃的", "c");
  ok("冷启动后时效基准仍在（跨页提示照常注入）",
    (f2.calls[0].context || "").indexOf("进程被杀前问过的问题") >= 0);
  ok("时间戳已落盘（aiAgentTsV1 有 today）",
    String(f2.store.get("aiAgentTsV1") && f2.store.get("aiAgentTsV1").today || "").length > 0);

  // ⑧ 冷启动但已超 TTL：不能因为「落了盘」就把隔天的问题也串进来
  const f3 = loadAgent({ store: shared, clock: f1.now() + 11 * 60 * 1000 });
  await f3.api.ask("food", "q", "c");
  ok("冷启动且超 10 分钟不串台（落盘不放宽时效）",
    (f3.calls[0].context || "").indexOf("进程被杀前问过的问题") < 0);

  // ⑨ 全站场景全量落盘：MAX_SCENES 若小于实有 scene 数，会静默淘汰他页记忆
  const g = loadAgent();
  // 真实 11 个 scene（由 ask() 字面量跨行正则数出，含 today-proactive；单行 grep 会漏掉它）
  const SCENES = ["assistant", "food", "help", "lens", "plan", "prep", "review", "spot", "today", "today-proactive", "toolkit"];
  SCENES.forEach((s) => g.api.remember(s, "user", "q-" + s));
  const saved = g.store.get("aiAgentMemV1") || {};
  ok("实有 " + SCENES.length + " 个场景全量落盘（不被 MAX_SCENES 截断）",
    Object.keys(saved).length === SCENES.length);
  ok("时间戳键集与记忆键集对齐（不会无限增长）",
    Object.keys(g.store.get("aiAgentTsV1") || {}).length === Object.keys(saved).length);

  console.log("\n" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
