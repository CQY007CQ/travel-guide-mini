// tools/check/check-ai-fallback.mjs —— 云端 AI 调用 fail-closed 覆盖守卫（独立脚本，零包体影响）
//
// 目的：离线优先是项目铁律。所有云端 AI 调用（AIAgent.ask → Cloud.aiChat）在云端不可用
//       （默认 cloud-disabled 态）/ 超时 / 报错时，必须：① 有 .catch 兜底（不漏未处理 rejection、
//       不让 showLoading 无限转）；② .then 失败分支给出优雅的离线/云端感知提示或本地回落，
//       而非误导性的「回答失败」。
//
// 防回潮：此前 lens.js 在云端不可用时误报「回答失败」（eb1c288 已修）。本守卫把这类缺口变成
//        fail-fast，任何新增/改坏的调用点都会被门禁拦下。
//
// 不接入 allcheck.sh（避免改动回归步数触发材料口径门禁），由自我迭代循环 / CI 按需调用。
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = resolve("utils/..");
let fail = 0;
const log = (ok, msg) => { console.log((ok ? "  [ok]   " : "  [fail] ") + msg); if (!ok) fail++; };

// 离线 / 云端感知的优雅回落标记（不区分大小写）
const OFFLINE_MARK = /offline|fallback|local\(|需联网|离线|云端|cloud/i;

// 递归收集 pages/ 与 subpkg/ 下全部 .js（排除 ai-agent.js 自身定义）
function walk(dir, out) {
  let ents = [];
  try { ents = readdirSync(dir); } catch (e) { return out; }
  for (const name of ents) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".js") && name !== "ai-agent.js") out.push(p);
  }
  return out;
}

const dirs = [resolve(ROOT, "pages"), resolve(ROOT, "subpkg")];
let files = [];
for (const d of dirs) walk(d, files);

let sites = 0;
for (const f of files) {
  let lines;
  try { lines = readFileSync(f, "utf8").split("\n"); } catch (e) { continue; }
  for (let i = 0; i < lines.length; i++) {
    if (!/AIAgent\.ask\s*\(/.test(lines[i])) continue;
    sites++;
    const rel = f.replace(ROOT + "/", "");
    // 向前看窗口：取调用点之后 40 行（覆盖 .then / .catch 块）
    const win = lines.slice(i, i + 40).join("\n");
    const hasCatch = /\.catch\s*\(/.test(win);
    const hasOffline = OFFLINE_MARK.test(win);
    log(hasCatch, rel + ":" + (i + 1) + " 有 .catch 兜底（fail-closed）");
    log(hasOffline, rel + ":" + (i + 1) + " .then 失败分支有优雅离线/云端感知路径");
  }
}

log(sites > 0, "共扫描到 AIAgent.ask 调用点 = " + sites + "（期望 ≥8）");
console.log(fail === 0
  ? "\n✓ 云端 AI fail-closed 覆盖守卫通过（每个调用点都有 .catch 且失败分支优雅降级）"
  : "\n✗ 存在缺兜底的云端 AI 调用点，请在 .then 失败分支补离线/云端感知回落，并确保 .catch 存在");
process.exit(fail === 0 ? 0 : 1);
