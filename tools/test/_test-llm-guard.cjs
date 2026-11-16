/**
 * _test-llm-guard.cjs —— llmProxy 滥用防护单测（零依赖、不联网）
 *
 * 覆盖：输入硬上限 / 模型白名单 / 参数夹紧 / 频率窗口 / 日预算熔断 / 身份分桶。
 * 强调：进程内限流在多实例下只是尽力而为，本测试只验证单实例逻辑正确，
 *       不把它当作「严格限流」的证据 —— 真正的硬防线是输入上限与预算夹紧。
 * 用法：node tools/test/_test-llm-guard.cjs
 */
const assert = require("assert");
const path = require("path");
const G = require(path.resolve(__dirname, "../cloud/llmProxy/guard.js"));

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log("  ✓ " + name); };

console.log("== llmProxy 滥用防护 ==");

// 1) 输入上限：正常请求必须放行，超限必须拦
ok("正常请求通过输入校验", G.validateInput({ prompt: "杭州三天行程", context: "x".repeat(1100) }).length === 0);
ok("超长 prompt 被拦", G.validateInput({ prompt: "x".repeat(G.LIMITS.promptChars + 1) }).indexOf("prompt-too-long") >= 0);
ok("超长 context 被拦", G.validateInput({ context: "x".repeat(G.LIMITS.contextChars + 1) }).indexOf("context-too-long") >= 0);
ok("过多对话轮被拦", G.validateInput({ messages: Array(31).fill({ role: "user", content: "hi" }) }).indexOf("messages-too-many") >= 0);
ok("超长单条消息被拦", G.validateInput({ messages: [{ role: "user", content: "x".repeat(4001) }] }).indexOf("message-too-long") >= 0);
ok("超大图片被拦", G.validateInput({ imageBase64: "x".repeat(G.LIMITS.imageB64Chars + 1) }).indexOf("image-too-large") >= 0);
ok("图片数量被拦", G.validateInput({ imageFileIDs: ["a", "b", "c", "d"] }).indexOf("images-too-many") >= 0);

// 2) 模型白名单：不在名单里一律降级，识图强制走视觉模型
ok("配置模型被允许", G.safeModel("qwen-plus", "qwen-plus", "qwen3-vl-plus", false, "") === "qwen-plus");
ok("陌生模型降级到配置模型", G.safeModel("gpt-4o", "qwen-plus", "qwen3-vl-plus", false, "") === "qwen-plus");
ok("识图强制走视觉模型", G.safeModel("qwen-plus", "qwen-plus", "qwen3-vl-plus", true, "") === "qwen3-vl-plus");
ok("环境变量可显式放行模型", G.safeModel("deepseek-chat", "qwen-plus", "", false, "deepseek-chat,other") === "deepseek-chat");

// 3) 参数夹紧
ok("max_tokens 封顶", G.clampNum(99999, 1, G.LIMITS.maxTokens, 1200) === G.LIMITS.maxTokens);
ok("temperature 越界回默认值", G.clampNum("bad", 0, 2, 0.7) === 0.7);
ok("负数 max_tokens 回默认值", G.clampNum(-5, 1, G.LIMITS.maxTokens, 1200) === 1200);

// 4) 频率与预算：同一身份每分钟有上限，匿名桶独立
let clock = 1000000;
const lim = G.createLimiter(() => clock);
let allowed = 0;
for (let i = 0; i < G.LIMITS.perMinUser + 5; i++) if (lim.allow("o:alice", false)) allowed++;
ok("同一 OPENID 每分钟不超过上限", allowed === G.LIMITS.perMinUser);
ok("超频后被拒", lim.allow("o:alice", false) === false);
ok("换身份可放行（分桶生效）", lim.allow("o:bob", false) === true);
ok("匿名桶与登录桶独立", lim.allow("anon", true) === true);

clock += 61000; // 跨过一分钟
ok("窗口滚动后重新放行", lim.allow("o:alice", false) === true);

// 5) 日预算熔断：多身份也不能突破全局上限
const lim2 = G.createLimiter(() => 2000000);
let total = 0;
for (let i = 0; i < G.LIMITS.dailyGlobal + 20; i++) if (lim2.allow("o:u" + i, false)) total++;
ok("单实例日预算熔断生效", total === G.LIMITS.dailyGlobal);

// 6) 运行时计数异常时 fail-open（防护层不能成为可用性单点故障）
let ticks = 0;
const broken = G.createLimiter(() => { if (++ticks > 1) throw new Error("clock broken"); return 3000000; });
ok("计数异常时放行（fail-open）", broken.allow("o:x", false) === true);

console.log("\n" + pass + " 项通过 / 0 失败");
