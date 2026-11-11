// tools/check/release-readiness.mjs —— 发版就绪度自检（发布前最后一公里，零网络）
//
// 用法：node tools/check/release-readiness.mjs
// 只做「能不能发版」的判断，不重复 allcheck 的业务回归：
//   版本三处一致 / 云函数结构 / 凭据零明文 / 微信登录态 / 上传与取码是否就绪 + 下一步指令。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const P = (...a) => path.join(ROOT, ...a);
const read = p => { try { return fs.readFileSync(P(p), "utf8"); } catch (e) { return ""; } };
const exists = p => fs.existsSync(P(p));
let bad = 0;
const ok = m => console.log("  [ok]   " + m);
const warn = m => console.log("  [warn] " + m);
const fail = m => { console.log("  [FAIL] " + m); bad++; };

console.log("════ 发版就绪度 ════\n");

// ① 版本三处一致
let VER = "";
try { VER = JSON.parse(read("project.config.json")).version || ""; } catch (e) {}
const srcVer = (read("tools/_src-backup/travel.js").match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1] || "";
const outVer = (read("utils/travel.js").match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1] || "";
if (VER && VER === srcVer && VER === outVer) ok("版本三处一致：" + VER + "（IDE / 真源 / 产物）");
else { fail("版本不一致：IDE=" + VER + " 真源=" + srcVer + " 产物=" + outVer + " → 跑 build-min"); }

// ② 云函数结构
const FUNCS = ["llmProxy", "syncPlan", "recommend", "pullContent", "sendRemind"];
let fnOK = 0;
for (const f of FUNCS) {
  if (!exists("tools/cloud/" + f + "/index.js") || !exists("tools/cloud/" + f + "/package.json")) continue;
  try { execFileSync(process.execPath, ["--check", P("tools/cloud/" + f + "/index.js")], { stdio: "pipe" }); fnOK++; }
  catch (e) {}
}
if (fnOK === FUNCS.length) ok("5 个云函数齐全且语法通过");
else fail("云函数缺文件/语法错：" + fnOK + "/" + FUNCS.length);

// ③ 凭据零明文（32 位 hex 简单扫描，排除注释占位）
const keysSrc = read("utils/keys.js").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
if (!/[0-9a-fA-F]{32}/.test(keysSrc)) ok("前端凭据文件无明文 key");
else fail("utils/keys.js 疑似含明文 key，禁止上传");

// ④ 微信登录态（只读探测，最多 10s）
let login = "unknown", loginOK = false;
try {
  const out = execFileSync("/Applications/wechatwebdevtools.app/Contents/MacOS/cli", ["islogin"],
    { encoding: "utf8", timeout: 12000, stdio: ["ignore", "pipe", "ignore"] });
  const m = out.match(/\{"login":(true|false)\}/);
  login = m ? m[1] : "unknown";
  loginOK = login === "true";
} catch (e) { login = "cli-unavailable"; }
if (loginOK) ok("微信开发者工具已登录 → 可上传 / 可取码");
else warn("微信开发者工具未登录（islogin=" + login + "）→ 上传必报 code 10、预览码无法生成");

// ⑤ 结论
console.log("\n──── 结论 ────");
if (bad) console.log("  ✗ " + bad + " 项结构性问题，先修复再发版。");
else if (!loginOK) console.log("  ⚠ 代码侧就绪，但需你本人扫码登录微信开发者工具。");
else console.log("  ✓ 可发版。");
console.log("\n  全量业务回归：./allcheck.sh");
console.log("  云部署自检  ：node tools/check/verify-cloud.mjs");
if (loginOK) {
  console.log("  一键上传+取码：./tools/dev/release-and-qr.sh " + (VER || "1.20.7") + ' "本次说明"');
} else {
  console.log("  登录后执行  ：./tools/dev/release-and-qr.sh " + (VER || "1.20.7") + ' "本次说明"');
  console.log("  体验版码    ：公众平台 → 管理 → 版本管理 → 开发版本 → 体验版（每次上传后必须重取）");
}
process.exit(bad ? 1 : 0);
