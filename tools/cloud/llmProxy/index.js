// 云函数 llmProxy —— LLM 代理（Key 只放云函数环境变量，绝不下发小程序 / 网页端）
//
// 为什么需要它：小程序不能直接调第三方 LLM（域名白名单 + Key 暴露双重限制）；
// 网页版也最好别把 Key 写进前端。统一由云函数代理，Key 存「云函数环境变量」，
// 前端只传 prompt / messages，云函数回传文本。
//
// 配置（云函数 → 环境变量，不在代码里写死）：
//   LLM_BASE_URL  例如 https://api.openai.com/v1/chat/completions
//   LLM_API_KEY   你的 Key
//   LLM_MODEL     例如 gpt-4o-mini
//
// 体验版说明：个人主体体验版内，云函数可正常调用（不触发「面向公众服务」前提）。
//   仍建议回答里标注「AI 生成」，且正式对外生成式 AI 类目须个体户 + 算法备案。

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const https = require("https");
const url = require("url");

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
      timeout: timeoutMs || 20000
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

exports.main = async (event) => {
  const base = process.env.LLM_BASE_URL || "";
  const key = process.env.LLM_API_KEY || "";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  if (!base || !key) return { ok: false, err: "llm-not-configured" };
  const messages = (event && event.messages) || null;
  const prompt = (event && event.prompt) || "";
  if (!messages && !prompt) return { ok: false, err: "empty-input" };
  const payload = {
    model: model,
    messages: messages || [
      { role: "system", content: "你是旅行攻略生成器的内置助手，基于用户提供的本地上下文，用简体中文简洁作答。" },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 800
  };
  try {
    const j = await postJSON(base, payload, key, 20000);
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content)
      || (j && j.raw) || "";
    if (!text) return { ok: false, err: "empty-response" };
    return { ok: true, text: String(text) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
};
