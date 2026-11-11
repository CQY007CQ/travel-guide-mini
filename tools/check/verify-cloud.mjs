// tools/check/verify-cloud.mjs —— 云部署自检 + 部署清单（零网络、零凭据、可随时跑）
//
// 用法：node tools/check/verify-cloud.mjs
//
// 只做静态自检：云函数结构、启动桥接、网页 SDK、配置状态。
// 不连云端、不读任何密钥、不打印密钥值。配置未填只 warn，不算失败。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const P = (...a) => path.join(ROOT, ...a);
const exists = p => fs.existsSync(P(p));
const read = p => fs.readFileSync(P(p), "utf8");

let errors = 0;
const ok = m => console.log("  [ok]   " + m);
const warn = m => console.log("  [warn] " + m);
const info = m => console.log("  [info] " + m);
const bad = m => { console.log("  [FAIL] " + m); errors++; };

console.log("════ 云部署自检 ════\n");

// 1) cloudfunctionRoot
let cfg = {};
try { cfg = JSON.parse(read("project.config.json")); } catch (e) { bad("project.config.json 解析失败"); }
const cfr = String(cfg.cloudfunctionRoot || "").replace(/\/+$/, "");
if (cfr === "tools/cloud") ok("cloudfunctionRoot = tools/cloud/（开发者工具可右键部署云函数）");
else bad("cloudfunctionRoot 缺失或错误（当前：" + (cfr || "未设置") + "）→ 云函数无法右键部署");

// 2) 5 个云函数
const FUNCS = ["llmProxy", "syncPlan", "recommend", "pullContent", "sendRemind"];
let funcOK = 0;
for (const f of FUNCS) {
  const dir = "tools/cloud/" + f;
  const idx = dir + "/index.js";
  const pkg = dir + "/package.json";
  if (!exists(idx) || !exists(pkg)) { bad(f + " 缺 index.js 或 package.json"); continue; }
  try {
    JSON.parse(read(pkg));
    execFileSync(process.execPath, ["--check", P(idx)], { stdio: "pipe" });
    funcOK++;
  } catch (e) { bad(f + " 语法 / package.json 校验失败：" + String(e.message || e).slice(0, 120)); }
}
if (funcOK === FUNCS.length) ok(FUNCS.length + " 个云函数齐全且语法通过：" + FUNCS.join(" / "));

// 3) 小程序启动桥接
const appjs = exists("app.js") ? read("app.js") : "";
if (/require\(["']\.\/utils\/cloud\.js["']\)\.init\(\)/.test(appjs)) ok("app.js onLaunch 调用 Cloud.init()（wx.cloud 已初始化）");
else bad("app.js 未调用 Cloud.init() → 所有云能力永久 fail-closed");

// 4) 网页适配器 + SDK
const sdk = "web/lib/cloudbase-sdk.js";
if (exists(sdk)) {
  const kb = Math.round(fs.statSync(P(sdk)).size / 1024);
  if (kb > 100) ok("网页 CloudBase SDK 已打包（" + kb + "KB）");
  else bad("cloudbase-sdk.js 过小（" + kb + "KB），可能打包失败");
} else bad("缺 web/lib/cloudbase-sdk.js → 网页版云互通不可用（跑 tools/web/build.mjs 重生成）");
const cw = exists("web/lib/cloud-web.js") ? read("web/lib/cloud-web.js") : "";
if (/signInAnonymously|__cloudbase\s*=/.test(cw)) ok("网页适配器含匿名登录 + __cloudbase 挂载（fail-closed）");
else bad("网页云适配器不完整");

// 5) CSP 放行 CloudBase 域名
const html = exists("web/index.html") ? read("web/index.html") : "";
if (/connect-src[^"]*tcloudbaseg\.com/.test(html) && /tcloudbaseapp\.com/.test(html)) ok("网页 CSP 已放行 CloudBase 端点");
else warn("网页 CSP 可能未放行全部 CloudBase 端点（网页云互通会被拦）");

// 6) 配置状态（只警告）
const keys = exists("utils/keys.js")
  ? read("utils/keys.js").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n")  // 滤注释行，避免被示例字符串误判
  : "";
const envFilled = /cloudEnv:\s*["'][^"']+["']/.test(keys);
if (!envFilled) warn("utils/keys.js 的 cloudEnv 未填 → 当前全链路 fail-closed（离线可用，属预期；填入环境 ID 后自动启用）");
else ok("cloudEnv 已配置（值不打印）");

// 7) AI / 照片管线状态
const cloudJs = exists("utils/cloud.js") ? read("utils/cloud.js") : "";
if (/withTimeout\(callFunction\("llmProxy"/.test(cloudJs)) ok("aiChat / aiVision 有超时保护（挂起自动回落离线）");
else bad("aiChat / aiVision 缺超时保护");
const photos = exists("utils/spot-photos.js") ? read("utils/spot-photos.js") : "";
const enabled = /const ENABLED\s*=\s*true/.test(photos);
info("真实照片映射 ENABLED=" + (enabled ? "true" : "false（未启用，零回归）"));
let manifest = [];
try { manifest = JSON.parse(read("tools/photos/manifest.json")); } catch (e) {}
const cacheDir = P("tools/photos/cache");
const cacheN = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => /\.jpg$/i.test(f)).length : 0;
info("照片管线：manifest " + manifest.length + " 条 / cache " + cacheN + " 张");

// ── 部署清单 ──
console.log("\n──── 部署清单（需你在云开发控制台操作） ────");
console.log("云函数（在 tools/cloud/<名>/ 右键「上传并部署：云端安装依赖」）：");
FUNCS.forEach(f => console.log("   · " + f));
console.log("\n环境变量（云函数 llmProxy → 配置 → 环境变量；Key 绝不放前端）：");
[
  ["LLM_PROVIDER", "openai / deepseek / qwen / moonshot（预设，自动补 base+model）"],
  ["LLM_MODEL", "强模型名；识物必须多模态：gpt-4o 或 qwen-vl-max"],
  ["LLM_API_KEY", "你的 Key（唯一存放处，禁止进 git / 前端）"],
  ["LLM_BASE_URL", "可选；显式指定则覆盖预设，须为 OpenAI 兼容 /chat/completions"],
  ["TMPL_ID", "sendRemind 订阅消息模板 ID（不用提醒可不填）"]
].forEach(([k, v]) => console.log("   " + k.padEnd(16) + v));
console.log("\n数据库集合（4 个，权限建议「仅创建者可读写」，按 owner 键隔离）：");
["plans（行程跨端同步）", "prefs（偏好）", "meta（内容拉取）", "reminds（提醒）"].forEach(c => console.log("   · " + c));
console.log("\n云存储目录：");
console.log("   · spots/   真实景点照片（tools/photos/upload-cloud.mjs 上传目标）");
console.log("   · lens/    拍照识物临时图（小程序端自动上传，可设生命周期清理）");
console.log("\n真实照片两条通道：");
console.log("   A) 可访问 Commons：node tools/photos/fetch-commons.mjs --limit 120");
console.log("   B) Commons 不可达：把已获授权图片放 tools/photos/inbox/，");
console.log("      node tools/photos/import-local.mjs --credit \"作者\" --license \"CC BY-SA 4.0\"");
console.log("      两条通道后续都走 upload-cloud.mjs → build-map.mjs --prefix ... --enable");
console.log("\n网页版额外一步：云开发 → 环境 → 安全配置 → 开启「匿名登录」，否则 __cloudbase 不挂载（fail-closed）。");
console.log("\n本地启用：wx.setStorageSync(\"__app_keys__\", { cloudEnv: \"你的环境ID\" }) 或填 utils/keys.js（勿提交）。");

console.log("\n════ 结果：" + (errors ? errors + " 项结构性问题" : "结构全通过") + " ════");
process.exit(errors ? 1 : 0);
