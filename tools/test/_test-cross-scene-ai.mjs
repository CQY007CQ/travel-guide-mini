/**
 * _test-cross-scene-ai.mjs —— 跨页 AI 衔接单测（零依赖、不联网）
 * 验证：① 其他页最近问题注入 context ② 只注入不写回 ③ 10 分钟时效
 *       ④ 清空会话立即失效 ⑤ 不重复当前场景 ⑥ 云未开不拼装
 *       ⑦ 进程被回收（冷启动）后时效基准仍在 —— 时间戳落盘前这条恒失败
 *       ⑧ 冷启动但已超 TTL 依旧不串台（落盘不放宽时效）
 *       ⑨ 11 个场景全量落盘（MAX_SCENES 不足会静默淘汰他页记忆）
 *       ⑩ 存储坏掉不抛给调用方且留痕
 *       ⑪ 同一场景连点同一句话复用同一趟请求 ⑫ 换问题串行不并发
 *       ⑬ 连续传输失败后熔断并自动恢复 ⑭ 业务错误不熔断
 * 用法：node tools/test/_test-cross-scene-ai.mjs
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve, join as pathJoin } from "path";
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
  const notes = [];
  const sandbox = {
    module: { exports: {} }, exports: {},
    require(name) {
      if (name === "./cloud.js") return {
        cloudEnabled: () => o.cloud !== false,
        // v1.20.15：aiChat 可注入 —— 并发去重 / 熔断这类行为必须真跑才测得出来，
        // 「源码里有 _inflight[k]」这种断言对旧 bug 一样是绿的。
        aiChat: (p) => { calls.push(p); return o.aiChat ? o.aiChat(p, calls.length) : Promise.resolve({ ok: true, text: "答" }); }
      };
      if (name === "./store.js") return {
        get: (k) => store.get(k), set: (k, v) => store.set(k, v)
      };
      if (name === "./data.js") return { CITIES: [] };
      // v1.20.13：ai-agent 记忆/上下文链路补了 errlog 留痕（静默失败改为可观测），
      // 沙箱里的 require 白名单必须同步，否则会以 "unexpected require" 崩掉
      // ——这类崩溃是「实现了依赖改动、测试替身没跟上」，不是被测逻辑坏了。
      if (name === "./errlog.js") return {
        note: (scope, err, extra) => { notes.push({ scope, err, extra }); return 1; }
      };
      throw new Error("unexpected require " + name);
    },
    Date: { now: () => clock },
    console
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(src, sandbox, { filename: "ai-agent.js" });
  return {
    api: sandbox.module.exports,
    calls, store, notes,
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

  // ⑩ 存储坏掉时：不抛错、按空记忆继续，且必须留下痕迹（v1.20.13 把这里的裸空 catch 改成 errlog）。
  //    没有这条断言时，「静默吞掉 → AI 突然不记得上一句」只能靠用户投诉发现。
  const broken = { get() { throw new Error("boom-read"); }, set() { throw new Error("boom-write"); } };
  const h = loadAgent({ store: broken });
  let threw = null;
  try { h.api.remember("today", "user", "存不进去的问题"); } catch (err) { threw = err; }
  ok("存储读写异常不抛给调用方（AI 主流程不断）", threw === null);
  ok("存储异常留下痕迹（不再静默吞掉）",
    h.notes.some(n => String(n.extra || "").indexOf("会话记忆读取失败") >= 0));

  // ⑪ 同一场景连点同一句话：必须复用同一趟请求。
  //    旧实现存 true 并直接回 {err:"inflight"}，而 11 处调用点对「非 ok」一律降级离线 →
  //    用户连点两下看到的是「AI 变笨了」，云端那一趟随后才回来却被丢弃。这是可观察行为，必须真跑。
  let openFirst;
  const gated = new Promise((res) => { openFirst = res; });
  const i = loadAgent({ aiChat: () => gated });
  const pa = i.api.ask("food", "同一句话", "c");
  const pb = i.api.ask("food", "同一句话", "c");
  ok("连点同一句话只发一趟云端请求", i.calls.length === 1);
  openFirst({ ok: true, text: "真答案" });
  const [ra, rb] = await Promise.all([pa, pb]);
  ok("连点两次都拿到真实答案（不再返回 inflight 失败/降级离线）",
    ra.ok === true && rb.ok === true && ra.text === "真答案" && rb.text === "真答案");
  ok("连点不会重复写记忆（只落一轮问答）",
    (i.api.historyOf("food") || []).length === 2);

  // ⑫ 同一场景「换了问题」：排队而不是并发，也不是判失败。
  //    并发会让 user/assistant 落记忆的顺序错乱（回答先落、问题后落），多轮上下文直接串台。
  let openGate;
  const gate = new Promise((res) => { openGate = res; });
  const j = loadAgent({ aiChat: () => (j.calls.length === 1 ? gate : Promise.resolve({ ok: true, text: "第二答" })) });
  const q1 = j.api.ask("food", "问题一", "c");
  const q2 = j.api.ask("food", "问题二", "c");
  ok("换问题时不并发第二趟（同场景串行）", j.calls.length === 1);
  openGate({ ok: true, text: "第一答" });
  const [r1, r2] = await Promise.all([q1, q2]);
  ok("排队的问题仍拿到真实答案（不被判 inflight 降级）", r1.text === "第一答" && r2.ok === true && r2.text === "第二答");
  ok("第二趟带上了第一轮问答（记忆顺序正确、多轮不断）",
    !!j.calls[1] && JSON.stringify(j.calls[1].messages).indexOf("问题一") >= 0);

  // ⑬ 熔断：连续两次传输层失败后短期不再发请求（弱网下每进一页白等 21s 是主要体感问题）
  let mode = "fail";
  const k2 = loadAgent({
    aiChat: () => (mode === "fail"
      ? Promise.resolve({ ok: false, err: "timeout", transport: true })
      : Promise.resolve({ ok: true, text: "恢复" }))
  });
  await k2.api.ask("food", "q1", "c");
  await k2.api.ask("food", "q2", "c");
  const rc = await k2.api.ask("food", "q3", "c");
  ok("连续 2 次传输失败后熔断，第三次不再发请求",
    k2.calls.length === 2 && rc.ok === false && rc.err === "cooldown");
  ok("熔断留下痕迹（否则只能靠用户投诉发现「AI 一直离线」）",
    k2.notes.some(n => n.err === "cooldown"));
  k2.tick(61 * 1000);
  mode = "ok";
  const rd = await k2.api.ask("food", "q4", "c");
  ok("熔断到期后自动恢复（不需要重启小程序）", rd.ok === true && rd.text === "恢复" && k2.calls.length === 3);

  // ⑭ 业务错误不熔断：模型偶尔空输出 / 云端答了但内容不可用，不是通道不通，
  //    一次就静音一分钟会把本来能出结果的下一问也判掉。
  const m = loadAgent({ aiChat: () => Promise.resolve({ ok: false, err: "llm-empty", transport: false }) });
  await m.api.ask("food", "e1", "c");
  await m.api.ask("food", "e2", "c");
  const re = await m.api.ask("food", "e3", "c");
  ok("业务错误不触发熔断（照常发第 3 次）", m.calls.length === 3 && re.err !== "cooldown");

  // ⑮ v1.20.22：第二视角曾绕过熔断——主回答 1ms 回落，Promise.all 却仍被拖 21s。
  //    真跑：用真实 ai-agent 把通道打断，再用真实 ai-reason 调 secondOpinion，
  //    断言零请求 + 立即返回 null（不是等超时）。
  {
    const AGENT = pathJoin(ROOT, "utils/ai-agent.js");
    const REASON = pathJoin(ROOT, "subpkg/assistant/ai-reason.js");
    const agentSb = {
      module: { exports: {} }, exports: {}, console, Date,
      require(name) {
        if (name === "./cloud.js") return {
          cloudEnabled: () => true,
          aiChat: () => Promise.resolve({ ok: false, err: "timeout", transport: true })
        };
        if (name === "./store.js") return { get: () => null, set: () => {} };
        if (name === "./data.js") return { CITIES: [] };
        if (name === "./errlog.js") return { note: () => 1 };
        throw new Error("unexpected require " + name);
      }
    };
    agentSb.exports = agentSb.module.exports;
    vm.runInNewContext(readFileSync(AGENT, "utf8"), agentSb, { filename: "ai-agent.js" });
    const agentApi = agentSb.module.exports;
    await agentApi.ask("food", "b1", "c");
    await agentApi.ask("food", "b2", "c");
    ok("主链路连续失败后进入熔断", !!(agentApi.channelCooling && agentApi.channelCooling()));

    const calls = [];
    const reasonSb = {
      module: { exports: {} }, exports: {}, console, Date, JSON, Math, RegExp, Object, Array, String,
      require(name) {
        if (name === "../../utils/cloud.js") return {
          cloudEnabled: () => true,
          aiChat: (p) => { calls.push(p); return Promise.resolve({ ok: false, err: "timeout", transport: true }); }
        };
        if (name === "../../utils/ai-agent.js") return agentApi;
        if (name === "../../utils/travel.js") return { findCity: () => null };
        if (name === "../../utils/data.js") return { CITIES: [] };
        throw new Error("unexpected require " + name);
      }
    };
    reasonSb.exports = reasonSb.module.exports;
    vm.runInNewContext(readFileSync(REASON, "utf8"), reasonSb, { filename: "ai-reason.js" });
    const t0 = Date.now();
    const alt = await reasonSb.module.exports.secondOpinion("三家酒店怎么选才不踩坑对比一下", "ctx");
    ok("熔断期内第二视角零请求（Promise.all 不再被 21s 拖住）",
      alt === null && calls.length === 0, "calls=" + calls.length + " alt=" + JSON.stringify(alt));
    ok("第二视角快速返回而不是等超时（<50ms）", Date.now() - t0 < 50, (Date.now() - t0) + "ms");
  }

  /* §16 答案缓存（v1.20.24）：同一句话重复提问不再全额重等 8~12s
     为什么必须真跑：缓存的三个坑（串城市、串实时、清空后不失效）都只在行为上暴露，
     断言「源码里有 CACHE_LIVE」对错误实现一样是绿的。 */
  console.log("\n== 答案缓存 ==");
  {
    let n = 0;
    const d = loadAgent({ aiChat: () => { n++; return Promise.resolve({ ok: true, text: "答案" + n }); } });
    const r1 = await d.api.ask("food", "推荐几家本地小吃", "吉安·3天");
    const c1 = d.calls.length;
    const r2 = await d.api.ask("food", "推荐几家本地小吃", "吉安·3天");
    ok("同句同上下文第二次不再发请求", c1 === 1 && d.calls.length === 1, "calls=" + d.calls.length);
    ok("命中缓存返回同一份答案并标记 cached", r2.ok === true && r2.text === r1.text && r2.cached === true);
    ok("命中后仍写回记忆（「那还有别的吗」不会失去指代）",
      d.api.historyOf("food").filter(m => m.content === "推荐几家本地小吃").length >= 2);

    // 关键：上下文变了（换城市）绝不能命中 —— 否则吉安的答案会被当成北京的
    const r3 = await d.api.ask("food", "推荐几家本地小吃", "北京·5天");
    ok("换城市（上下文变）不命中，照常发请求", d.calls.length === 2 && r3.cached !== true,
      "calls=" + d.calls.length);

    const e2 = loadAgent();
    await e2.api.ask("today", "今天天气怎么样", "c");
    await e2.api.ask("today", "今天天气怎么样", "c");
    ok("实时类问题（含「今天/天气」）不缓存，两次都走云端", e2.calls.length === 2);

    const f3 = loadAgent();
    await f3.api.ask("food", "冷问题", "c");
    f3.tick(11 * 60 * 1000);
    await f3.api.ask("food", "冷问题", "c");
    ok("超过 10 分钟缓存失效，重新发请求", f3.calls.length === 2);

    const g3 = loadAgent();
    await g3.api.ask("food", "会被清掉的问题", "c");
    g3.api.clearHistory();
    await g3.api.ask("food", "会被清掉的问题", "c");
    ok("清空会话后缓存一并失效（不再弹回旧答案）", g3.calls.length === 2);

    const h3 = loadAgent({ aiChat: () => Promise.resolve({ ok: false, err: "empty" }) });
    await h3.api.ask("food", "失败问题", "c");
    await h3.api.ask("food", "失败问题", "c");
    ok("失败/空答案不写缓存（下次仍重试）", h3.calls.length === 2);

    const i3 = loadAgent();
    for (let i = 0; i < 45; i++) await i3.api.ask("food", "问题" + i, "c");
    ok("缓存容量守住上限 40（内存不膨胀）", i3.api.cacheStats().size <= 40,
      "size=" + i3.api.cacheStats().size);

    /* v1.20.27：缓存键归一化 —— 多一个问号/空格不该各打一次云端 */
    const j3 = loadAgent();
    await j3.api.ask("food", "北京有什么好玩的", "北京·3天");
    const jc = j3.calls.length;
    const j2 = await j3.api.ask("food", "北京有什么好玩的？", "北京·3天");
    ok("只差一个标点（问号）应命中缓存，不再发请求", jc === 1 && j3.calls.length === 1 && j2.cached === true,
      "calls=" + j3.calls.length);
    const j3r = await j3.api.ask("food", " 北京 有什么好玩的 ", "北京·3天");
    ok("只差空白应命中缓存", j3.calls.length === 1 && j3r.cached === true, "calls=" + j3.calls.length);
    // 归一化不能过头：数字是语义的一部分，不能被抹掉
    const k3 = loadAgent();
    await k3.api.ask("food", "推荐3天路线", "c");
    await k3.api.ask("food", "推荐5天路线", "c");
    ok("归一化不得抹掉数字（3 天与 5 天是不同问题，不能互相命中）", k3.calls.length === 2,
      "calls=" + k3.calls.length);
  }

  console.log("\n" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
