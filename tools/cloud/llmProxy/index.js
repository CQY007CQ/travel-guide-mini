// 云函数 llmProxy —— 强模型 + 本地 grounding 代理网关
// （Key 只放云函数环境变量，绝不下发小程序 / 网页端）
//
// 为什么需要它：
//   小程序不能直接调第三方 LLM（域名白名单 + Key 暴露双重限制）；网页版也不该把 Key 写进前端。
//   统一由云函数代理，Key 存「云函数环境变量」，前端只传 prompt / messages / context，云函数回传文本。
//
// 配置（云函数 → 环境变量，不在代码里写死）：
//   LLM_BASE_URL   形如 https://api.openai.com/v1/chat/completions （OpenAI 兼容 /chat/completions 端点）
//   LLM_API_KEY    你的 Key
//   LLM_MODEL      模型名（如 gpt-4o / deepseek-chat / qwen-max）。缺省 gpt-4o（强模型，不再是 mini）
//   LLM_PROVIDER   预设厂商（openai / deepseek / qwen / moonshot），仅用于「未显式设 BASE_URL 时」自动补全
//
// 进入更强 AI 只需在云函数控制台改这把环境变量，前端代码零改动。
//
// 调用约定（前端经 Cloud.aiChat 封装，亦可直传 event）：
//   event.messages  对话历史 [{role:"user"|"assistant", content}]（不含 system）
//   event.prompt    单轮问题（与 messages 二选一，优先 messages）
//   event.system    自定义 system（可选；不传则由代理按 context 组装，并强制注入零伪造护栏）
//   event.context   本地真实上下文字符串（行程 / 景点 / 城市等），作为 grounding 注入 system
//   event.model / event.temperature / event.max_tokens  可选覆盖
//
// 返回：{ ok, text, model, source } 或 { ok:false, err }
//   source 用于前端标注「AI 生成」来自哪家（openai/deepseek/qwen/moonshot/unknown）

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const https = require("https");
const url = require("url");

// 厂商预设：未显式给 BASE_URL 时，按 LLM_PROVIDER 自动补全
const PROVIDERS = {
  openai:   { base: "https://api.openai.com/v1/chat/completions",          model: "gpt-4o" },
  deepseek: { base: "https://api.deepseek.com/v1/chat/completions",        model: "deepseek-chat" },
  qwen:     { base: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-max" },
  dashscope:{ base: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-max" },
  moonshot: { base: "https://api.moonshot.cn/v1/chat/completions",         model: "moonshot-v1-8k" }
};

// 零伪造护栏：无论调用方是否自带 system，代理都强制拼上，确保「不编造坐标 / 医院 / 票价 / 电话」
const GUARDRAIL =
  "【护栏 · 必须严格遵守】\n" +
  "1. 仅依据上方『本地上下文』与公开常识作答；绝不编造具体坐标、医院名称、票价、营业时间、电话等精确数据。\n" +
  "2. 若上下文未提供某信息，明确说明『暂未收录』并给可验证的通用建议，不要凭空生成数字。\n" +
  "3. 回答用简体中文，简洁有条理（分点优先）；可提示下一步操作（如打开某页面）。\n" +
  "4. 涉及医疗急救，提示拨打 120 / 当地急救，并说明 App 已内置应急医院查询。";

function resolveConfig() {
  const base = (process.env.LLM_BASE_URL || "").trim();
  const key = (process.env.LLM_API_KEY || "").trim();
  let model = (process.env.LLM_MODEL || "").trim();
  const prov = (process.env.LLM_PROVIDER || "").trim().toLowerCase();

  let finalBase = base;
  let finalModel = model;
  if (!finalBase && PROVIDERS[prov]) {
    finalBase = PROVIDERS[prov].base;
    if (!finalModel) finalModel = PROVIDERS[prov].model;
  }
  if (!finalModel) finalModel = "gpt-4o"; // 强模型兜底，不再是 gpt-4o-mini
  return { base: finalBase, key: key, model: finalModel };
}

function providerOf(baseUrl) {
  if (!baseUrl) return "unknown";
  const h = baseUrl.toLowerCase();
  if (h.indexOf("deepseek") >= 0) return "deepseek";
  if (h.indexOf("dashscope") >= 0 || h.indexOf("qwen") >= 0) return "qwen";
  if (h.indexOf("moonshot") >= 0) return "moonshot";
  if (h.indexOf("openai") >= 0) return "openai";
  return "unknown";
}

// 端点规整：BASE_URL 末尾无论是否带 /chat/completions 都能用
function endpointOf(baseUrl) {
  const b = baseUrl.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(b) ? b : b + "/chat/completions";
}

function postJSON(targetUrl, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = url.parse(targetUrl); } catch (e) { reject(new Error("bad-url")); return; }
    const data = JSON.stringify(payload);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (apiKey || ""),
        "Content-Length": Buffer.byteLength(data)
      },
      timeout: timeoutMs || 25000
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => body += c);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ raw: body }); }
      });
    });
    req.on("error", (e) => reject(e));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

// 兼容不同厂商的返回结构：OpenAI 标准 / 部分厂商 output 字段
function extractText(j) {
  if (!j) return "";
  try {
    if (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content)
      return String(j.choices[0].message.content);
    if (j.output) return String(j.output);            // 部分兼容网关
    if (j.text) return String(j.text);
    if (j.raw) return String(j.raw);
  } catch (e) {}
  return "";
}

function buildSystem(event, hasContext) {
  const custom = (event && event.system) || "";
  if (custom) {
    // v1.20.6 修复：旧实现在「调用方自带 system」时直接 return，把 event.context 整个丢掉。
    // 拍照识物（lens）与网页端分场景提示词都同时传 system + context，结果本地 grounding 一直没生效：
    // 模型拿不到当前城市 / 真实景点清单，识别地标时容易给出与本地库对不上的名称，联动必然落空。
    // 现在 custom 分支同样注入本地上下文，并明确其用途是「事实核对」而非创作素材（零伪造）。
    let s = custom.trim();
    if (hasContext) {
      s += "\n\n【本地上下文 · 仅用于事实核对，勿据此编造】\n" + String(event.context);
    }
    return s + "\n\n" + GUARDRAIL;
  }
  let s = "你是「晨的旅行助手」内置 AI，基于用户提供的真实本地上下文（行程 / 景点 / 美食 / 天气 / 预算等）作答。";
  if (hasContext) {
    s += "\n\n【本地上下文】\n" + String(event.context);
  }
  s += "\n\n" + GUARDRAIL;
  return s;
}

// 从云存储 fileID 下载图片并转 base64（拍照识物用；避免前端传大 payload 触发调用体积限制）
async function downloadFileBase64(fileID) {
  const res = await cloud.downloadFile({ fileID: fileID });
  const buf = res && (res.fileContent || res.buffer);
  if (!buf) throw new Error("empty-file");
  return Buffer.from(buf).toString("base64");
}

exports.main = async (event) => {
  const cfg = resolveConfig();
  if (!cfg.base || !cfg.key) return { ok: false, err: "llm-not-configured" };

  event = event || {};
  const messages = Array.isArray(event.messages) ? event.messages : null;
  const prompt = (typeof event.prompt === "string") ? event.prompt : "";
  const hasImage = !!(event.imageFileID || event.imageBase64 || (Array.isArray(event.imageFileIDs) && event.imageFileIDs.length));
  if (!messages && !prompt && !hasImage) return { ok: false, err: "empty-input" };

  // 视觉能力自检：明确已知不支持图片的模型，直接给可操作的原因，避免页面只拿到「识别失败」。
  // VISION_OK 放行含 vl/vision/4o 等视觉型号，避免误拦 deepseek-vl2 / qwen-vl-max 这类视觉模型；
  // LLM_ALLOW_VISION=1 为自定义兼容网关的逃生阀。
  const modelForCheck = (typeof event.model === "string" && event.model.trim()) ? event.model.trim() : cfg.model;
  const VISION_OK = /(vl|vision|4o|4\.1|gpt-4|claude-3|gemini)/i;
  const NO_VISION = /deepseek|qwen-(max|plus|turbo|long)|moonshot-v1|gpt-3\.5|o1-mini|text-davinci/i;
  if (hasImage && !VISION_OK.test(modelForCheck) && NO_VISION.test(modelForCheck) && process.env.LLM_ALLOW_VISION !== "1") {
    return {
      ok: false,
      err: "model-no-vision",
      hint: "当前模型 " + modelForCheck + " 不支持图片输入；拍照识物需在云函数环境变量把 LLM_MODEL 改为多模态模型（如 gpt-4o / qwen-vl-max）。",
      model: modelForCheck
    };
  }

  // 图片（可选）：优先 fileID 数组 / 单个 fileID → 云存储下载转 base64；其次直接传 base64。
  // 支持多张（最多 3 张不同角度）一并送入多模态模型，提升识别准确率。
  const imageDataUrls = [];
  const ids = Array.isArray(event.imageFileIDs) ? event.imageFileIDs.filter(Boolean).slice(0, 3) : [];
  if (ids.length) {
    for (const fid of ids) {
      try { imageDataUrls.push("data:image/jpeg;base64," + (await downloadFileBase64(fid))); }
      catch (e) { return { ok: false, err: "image-download-failed" }; }
    }
  } else if (event.imageFileID) {
    try { imageDataUrls.push("data:image/jpeg;base64," + (await downloadFileBase64(event.imageFileID))); }
    catch (e) { return { ok: false, err: "image-download-failed" }; }
  } else if (event.imageBase64) {
    const s = String(event.imageBase64);
    imageDataUrls.push(/^data:/.test(s) ? s : ("data:image/jpeg;base64," + s));
  }

  const hasContext = !!(event.context && String(event.context).trim());

  // 组装 messages：system（含护栏+上下文） + 对话历史（+ 单轮 prompt / 多模态图片）
  const finalMessages = [{ role: "system", content: buildSystem(event, hasContext) }];
  if (imageDataUrls.length) {
    finalMessages.push({
      role: "user",
      content: [
        { type: "text", text: prompt || "请识别这张（这些）图片，并给出旅途实用的小知识。" },
        ...imageDataUrls.map(function (u) { return { type: "image_url", image_url: { url: u } }; })
      ]
    });
  } else if (messages) {
    messages.forEach((m) => {
      if (m && m.role && m.content != null)
        finalMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) });
    });
  } else {
    finalMessages.push({ role: "user", content: prompt });
  }

  const model = (typeof event.model === "string" && event.model.trim()) ? event.model.trim() : cfg.model;
  const temperature = (typeof event.temperature === "number") ? event.temperature : 0.7;
  const maxTokens = (typeof event.max_tokens === "number" && event.max_tokens > 0) ? event.max_tokens : 1200;

  const payload = {
    model: model,
    messages: finalMessages,
    temperature: temperature,
    max_tokens: maxTokens
  };

  try {
    const j = await postJSON(endpointOf(cfg.base), payload, cfg.key, 25000);
    const text = extractText(j);
    if (!text) return { ok: false, err: "empty-response" };
    return { ok: true, text: text, model: model, source: providerOf(cfg.base) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
};
