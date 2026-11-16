// llmProxy 滥用防护 —— 纯逻辑、零依赖，可在 Node 下直接单测（tools/test/_test-llm-guard.cjs）。
//
// 威胁模型（说清楚能挡什么、不能挡什么）：
//   云函数多实例 => 进程内计数是「尽力而为」，换实例即可绕过频率限制，绝不宣称严格限流。
//   真正的硬防线是：单次输入上限 + 模型白名单 + max_tokens 上限 + 单实例日预算熔断。
//   这些无论攻击者怎么换实例都生效（每次调用都要过这一关）。
// 设计约束：
//   · 不引入任何 npm 依赖，package.json 不动，部署方式不变；
//   · 不改变前端协议，正常请求原样透传；异常一律返回可读 hint，不泄漏内部细节；
//   · fail-open 于身份识别（拿不到 openid 就用匿名桶），fail-closed 于资源上限。

const LIMITS = Object.freeze({
  promptChars: 8000,      // 单轮问题
  contextChars: 12000,    // 本地 grounding（前端 _contextOf 上限 1200 字，留足余量）
  systemChars: 8000,      // 场景提示词
  messages: 30,           // 对话轮数
  messageChars: 4000,     // 单条消息长度
  imageB64Chars: 3 * 1024 * 1024, // 单张图片 base64（约 2.25MB 解码后）
  imageB64Total: 6 * 1024 * 1024, // 多张合计
  images: 3,
  maxTokens: 3000,        // 硬上限（默认 1200）
  dailyGlobal: 300,       // 单实例每日调用预算
  perMinUser: 12,         // 同一 OPENID 每分钟
  perMinAnon: 20          // 匿名共享桶每分钟
});

const DEFAULTS = Object.freeze({ maxTokens: 1200, temperature: 0.7 });

function isLong(v, n) { return typeof v === "string" && v.length > n; }

// 返回问题码数组（空 = 通过）。错误码稳定，供测试与日志引用。
function validateInput(event) {
  const e = event || {}, bad = [];
  if (isLong(e.prompt, LIMITS.promptChars)) bad.push("prompt-too-long");
  if (isLong(e.context, LIMITS.contextChars)) bad.push("context-too-long");
  if (isLong(e.system, LIMITS.systemChars)) bad.push("system-too-long");

  if (e.messages != null) {
    if (!Array.isArray(e.messages)) bad.push("messages-not-array");
    else {
      if (e.messages.length > LIMITS.messages) bad.push("messages-too-many");
      for (const m of e.messages) {
        if (!m || typeof m.content !== "string") { bad.push("message-invalid"); break; }
        if (m.content.length > LIMITS.messageChars) { bad.push("message-too-long"); break; }
      }
    }
  }

  const ids = Array.isArray(e.imageFileIDs) ? e.imageFileIDs : [];
  if (ids.length > LIMITS.images) bad.push("images-too-many");
  if (e.imageFileID || e.imageBase64) {
    const n = (e.imageFileID ? 1 : 0) + ids.length + (e.imageBase64 ? 1 : 0);
    if (n > LIMITS.images) bad.push("images-too-many");
  }
  if (typeof e.imageBase64 === "string") {
    const s = e.imageBase64;
    if (s.length > LIMITS.imageB64Chars) bad.push("image-too-large");
    const all = ids.reduce((sum, x) => sum + String(x || "").length, 0) + s.length;
    if (all > LIMITS.imageB64Total) bad.push("images-total-too-large");
  }
  return bad;
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  // 负数 / 0 / 非数字一律视为无效参数回默认值：若夹到 lo=1，
  // max_tokens=1 会让用户拿到几乎空白的回答，比直接忽略参数更糟。
  if (!isFinite(n) || n <= 0) return dflt;
  return Math.min(hi, n);
}

// 调用方只能使用部署时配置的模型（或环境变量显式放行的），否则降级到配置模型。
// 这样既能防「指定怪异模型名烧钱」，也不会因为网页面板填了别的名字就报错。
function safeModel(wanted, cfgModel, visionModel, hasImage, extra) {
  const allowed = new Set();
  [cfgModel, visionModel].forEach(function (m) { if (typeof m === "string" && m.trim()) allowed.add(m.trim()); });
  String(extra || "").split(",").forEach(function (m) { if (m.trim()) allowed.add(m.trim()); });
  if (hasImage && visionModel) return visionModel;           // 识图强制走视觉模型
  if (typeof wanted === "string" && allowed.has(wanted.trim())) return wanted.trim();
  return cfgModel || wanted || "gpt-4o";
}

// 进程内滑动窗口 + 日预算。多实例下只作尽力而为，绝不当作强限流承诺。
function createLimiter(nowFn) {
  const now = typeof nowFn === "function" ? nowFn : Date.now;
  const hits = Object.create(null); // key -> { winStart, winN, dayStart, dayN }
  let dayGuardStart = 0, dayGuardN = 0;
  try { dayGuardStart = now(); } catch (e) {}

  function bucket(key) {
    const t = now();
    let b = hits[key];
    if (!b) { b = { winStart: t, winN: 0, dayStart: t, dayN: 0 }; hits[key] = b; }
    if (t - b.winStart >= 60000) { b.winStart = t; b.winN = 0; }
    if (t - b.dayStart >= 86400000) { b.dayStart = t; b.dayN = 0; }
    return b;
  }

  return {
    // 返回 true = 放行；false = 拒绝（频率/预算超限）
    allow: function (key, anonymous) {
      try {
        const t = now();
        if (t - dayGuardStart >= 86400000) { dayGuardStart = t; dayGuardN = 0; }
        if (dayGuardN >= LIMITS.dailyGlobal) return false;
        const b = bucket(key);
        const cap = anonymous ? LIMITS.perMinAnon : LIMITS.perMinUser;
        if (b.winN >= cap) return false;
        b.winN++; b.dayN++;
        dayGuardN++;
        return true;
      } catch (e) {
        return true; // 计数器异常时放行：防护层绝不能成为 AI 可用性的单点故障
      }
    },
    reset: function () {
      for (const k in hits) delete hits[k];
      dayGuardStart = now(); dayGuardN = 0;
    },
    size: function () { return Object.keys(hits).length; }
  };
}

module.exports = {
  LIMITS, DEFAULTS, validateInput, clampNum, safeModel, createLimiter
};
