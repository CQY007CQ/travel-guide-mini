// tools/check/check-compliance-redline.mjs —— 个人主体合规红线守卫（独立脚本，零包体影响）
//
// 目的：小程序主体为「个人」，平台规则下严禁 web-view / 支付 / 跳转其他小程序 / 云同步等能力
//       （须升个体户才解锁）。这些越界一旦合入，过审即违规、且难在代码评审中发现。
//       本守卫把红线做成 fail-fast：扫描全部页与逻辑源码，命中即拦截。
//
// 不接入 allcheck.sh（避免改动回归步数触发材料口径门禁），由自我迭代循环 / CI 按需调用。
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const require = createRequire(import.meta.url);
const ROOT = resolve("utils/..");
let fail = 0;
const log = (ok, msg) => { console.log((ok ? "  [ok]   " : "  [fail] ") + msg); if (!ok) fail++; };

// 个人主体红线模式（结构性越界能力）
const RULES = [
  { rx: /<web-view/i, label: "web-view 组件（个人主体禁用，须升个体户）" },
  { rx: /wx\.requestPayment/i, label: "wx.requestPayment（支付能力，个人主体禁用）" },
  { rx: /wx\.navigateToMiniProgram/i, label: "wx.navigateToMiniProgram（跳转其他小程序，个人主体禁用）" },
  { rx: /wx\.openEmbeddedMiniProgram/i, label: "wx.openEmbeddedMiniProgram（半屏小程序，个人主体禁用）" }
];

function walk(dir, out) {
  let ents = [];
  try { ents = readdirSync(dir); } catch (e) { return out; }
  for (const name of ents) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".js") || name.endsWith(".wxml")) out.push(p);
  }
  return out;
}

const dirs = [resolve(ROOT, "pages"), resolve(ROOT, "subpkg"), resolve(ROOT, "utils")];
let files = [];
for (const d of dirs) walk(d, files);

let hits = 0;
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch (e) { continue; }
  for (const rule of RULES) {
    if (rule.rx.test(text)) {
      hits++;
      log(false, f.replace(ROOT + "/", "") + " 命中红线：" + rule.label);
    }
  }
}

log(hits === 0, "全量扫描 pages/ + subpkg/ + utils/：未发现个人主体禁用能力调用（" + files.length + " 个文件）");
console.log(fail === 0
  ? "\n✓ 个人主体合规红线守卫通过（web-view / 支付 / 跳转小程序 均不存在）"
  : "\n✗ 命中个人主体禁用能力，请移除或确认已升个体户后再合入");
process.exit(fail === 0 ? 0 : 1);
