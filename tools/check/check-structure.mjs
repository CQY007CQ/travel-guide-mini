#!/usr/bin/env node
/**
 * tools/check/check-structure.mjs —— 目录结构契约门禁
 *
 * 为什么需要它：
 *   这个仓库的「整理」已经做过两轮（2026-10-19 根目录 35 个 md → docs/；2026-11-17 整仓复查）。
 *   每次都是人工清理，而人工清理的结局是**过一段时间又乱回去** —— 因为没有任何东西阻止
 *   下一个人把报告丢在 tools/ 根层、把备份留在包目录、把 .md 塞进 pages/。
 *   本门禁把「整理后的结构」写成可执行断言，让结构只能保持、不能退化。
 *
 * 判据（每条都对应一个真实踩过的坑）：
 *   ① 根目录白名单：根只放运行入口与配置。历史上根目录堆过 35 个散落文档、prompt-lab/、
 *      交付 md，导致「哪个文件是程序入口」看不出来。
 *   ② 包内目录只允许源码与资源：pages、subpkg、subdata1..3、subai、utils、images 里出现 .md/.log/.bak
 *      会被打进小程序包（包体预算 1536KB，且用户能下载到）。曾把 test 报告塞进 subpkg。
 *   ③ 全仓无系统垃圾：.DS_Store / ._* / *.bak / *.orig。macOS 的 .DS_Store 会被 git 忽略，
 *      所以它们只堆在本地、永远不会被 CI 发现，只能靠这类门禁。
 *   ④ 包内不许有空目录：空目录不进包但不代表无害 —— 它是「这层原本有东西、被删了但
 *      引用还在」的信号（components/ 空了 2 个月没人发现）。
 *   ⑤ utils/ 不许有孤儿模块：24 个模块全部必须被 require 到。孤儿 = 死代码，会诱导后来者改错文件。
 *   ⑥ docs/ 根层只放索引：文档必须落到 changelog/design/audit/qa/assessment/prompt-engineering/spoke-prompts。
 *   ⑦ tools/ 根层只放「跨子目录共用」的资产：README、6 个工具子目录、以及少量必须留根的
 *      真源/样本/凭据（_src-backup 是逻辑真源、_hospital-batch* 是禁用负数样本、
 *      geocode.key* 是本地凭据、_iter_state.json 是自动化状态）。其余一律进子目录。
 *
 * 不进 allcheck 新 step：串在既有「审计整改」step 里跑，保持 61 步口径（加减步会动考核材料）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail ? "  → " + detail : "")); }
};
const rel = (p) => path.relative(ROOT, p);
const list = (p) => { try { return fs.readdirSync(p); } catch (e) { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

/* ───────── ① 根目录白名单 ───────── */
const ROOT_FILES = new Set([
  "README.md", "allcheck.sh",
  "app.js", "app.json", "app.wxss",
  "package.json", "package-lock.json",
  "project.config.json", "project.private.config.json",
  "sitemap.json",
  ".gitignore", ".nvmrc",
]);
const ROOT_DIRS = new Set([
  "pages", "subpkg", "subai", "subdata", "subdata2", "subdata3", "utils", "images",
  "tools", "docs", "web", "node_modules",
  ".git", ".github", ".workbuddy", ".cloudbase",
]);
console.log("【① 根目录白名单】");
{
  const stray = list(ROOT).filter((n) => !ROOT_FILES.has(n) && !ROOT_DIRS.has(n));
  ok("根目录只有运行入口 / 配置 / 官方目录（多出即视为散落）", stray.length === 0,
    stray.length ? "多出: " + stray.join(", ") : "");
}

/* ───────── ② 包内目录只允许源码与资源 ───────── */
const PKG_DIRS = ["pages", "subpkg", "subdata", "subdata2", "subdata3", "subai", "utils", "images"];
const PKG_EXT = new Set([".js", ".wxml", ".wxss", ".json", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ttf", ".otf"]);
function walk(dir, out = []) {
  for (const n of list(dir)) {
    const p = path.join(dir, n);
    if (isDir(p)) walk(p, out); else out.push(p);
  }
  return out;
}
console.log("【② 包内只允许源码/资源】");
{
  const bad = [];
  for (const d of PKG_DIRS) {
    for (const f of walk(path.join(ROOT, d))) {
      if (!PKG_EXT.has(path.extname(f).toLowerCase())) bad.push(rel(f));
    }
  }
  ok("包内目录没有非源码文件（.md/.log/.bak 等会被打进包）", bad.length === 0,
    bad.slice(0, 6).join(", "));
}

/* ───────── ③ 全仓无系统垃圾 ───────── */
console.log("【③ 系统垃圾】");
{
  const JUNK = /(^|\/)(\.DS_Store|\._.*|.*\.bak|.*\.orig|.*\.rej|.*~)$/;
  const hits = [];
  const scan = (dir) => {
    for (const n of list(dir)) {
      if (n === "node_modules" || n === ".git") continue;
      const p = path.join(dir, n);
      if (isDir(p)) { scan(p); continue; }
      if (JUNK.test(p)) hits.push(rel(p));
    }
  };
  scan(ROOT);
  ok("无 .DS_Store / ._* / *.bak / *.orig（macOS 系统垃圾 git 看不见，只能靠门禁）",
    hits.length === 0, hits.slice(0, 6).join(", "));
}

/* ───────── ④ 包内不许有空目录 ───────── */
console.log("【④ 空目录】");
{
  const empty = [];
  const scan = (dir) => {
    for (const n of list(dir)) {
      const p = path.join(dir, n);
      if (!isDir(p)) continue;
      const kids = list(p);
      if (kids.length === 0) empty.push(rel(p)); else scan(p);
    }
  };
  for (const d of PKG_DIRS) scan(path.join(ROOT, d));
  ok("包内无空目录（空目录往往是「删了但引用还在」的信号）", empty.length === 0, empty.join(", "));
}

/* ───────── ⑤ utils 无孤儿模块 ───────── */
console.log("【⑤ utils 孤儿模块】");
{
  const CODE_DIRS = ["pages", "subpkg", "subdata", "subdata2", "subdata3", "subai", "utils",
    "tools/web", "tools/build", "tools/test", "tools/check", "tools/audit", "tools/data", "tools/dev", "tools/prompt"];
  const sources = [path.join(ROOT, "app.js")];
  for (const d of CODE_DIRS) for (const f of walk(path.join(ROOT, d))) {
    if (/\.(js|mjs|cjs)$/.test(f)) sources.push(f);
  }
  const text = sources.map((f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } }).join("\n");
  const orphans = list(path.join(ROOT, "utils"))
    .filter((n) => n.endsWith(".js"))
    .filter((n) => {
      // 自己引用自己不算；被任何源码/构建脚本提到即算被使用
      const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return !re.test(text);
    });
  ok("utils/*.js 全部被引用（无死模块诱导后来者改错文件）", orphans.length === 0, orphans.join(", "));
}

/* ───────── ⑥ docs 根层只放索引 ───────── */
console.log("【⑥ docs 分层】");
{
  const stray = list(path.join(ROOT, "docs")).filter((n) => n !== "README.md" && !isDir(path.join(ROOT, "docs", n)));
  ok("docs/ 根层除 README.md 外无散落文件（强制落到子目录）", stray.length === 0, stray.join(", "));
}

/* ───────── ⑦ tools 根层只放共用资产 ───────── */
console.log("【⑦ tools 根层】");
{
  const TOOLS_FILES = new Set([
    "README.md", "_iter_state.json",
    "_hospital-batch4.json", "_hospital-batch5.json", "_hospital-batch6.json",
    "geocode.key", "geocode.keys",
  ]);
  const TOOLS_DIRS = new Set([
    "audit", "build", "check", "data", "dev", "test",          // 六类工具子目录
    "cloud", "lib", "prompt", "photos", "team", "official-roster",  // 跨子目录共用的资产与管线
    "web", "_src-backup", "_archive", "_bak",                  // 真源 / 归档 / 本地快照
  ]);
  const stray = list(path.join(ROOT, "tools")).filter((n) => !TOOLS_FILES.has(n) && !TOOLS_DIRS.has(n));
  ok("tools/ 根层只有 6 个工具子目录 + 共用资产（报告/脚本请落子目录）", stray.length === 0,
    stray.length ? "多出: " + stray.join(", ") : "");
}

/* ───────── ⑧ 源码必须是纯文本：不得含裸控制字节 ───────── */
console.log("【⑧ 纯文本】");
{
  // 为什么需要：spotsearch.js 曾用「裸 NUL 字节」做去重分隔符 ——
  //   本意完全正确（`city + NUL + name` 能避免 `a|bc` 与 `ab|c` 撞成同一个 key），
  //   但源码里出现真实 0x00 会让 file(1) / grep 把整个文件判为 binary：
  //   此后任何基于 grep 的排查对该文件**静默返回空**，看起来像「这段代码不存在」。
  //   同类问题在 tools/data 也命中一处。工具链撒谎比代码出错更难发现。
  // 判据：包内源码与 tools/ 脚本里，除 \t(9) \n(10) \r(13) 外不得出现 <0x20 的控制字节；
  //   确实需要这类字符时一律写转义（"\u0000"），运行时字符串值完全相同（已验证 ===）。
  const TEXT_EXT = /\.(js|mjs|cjs|json|wxml|wxss|md)$/;
  const bad = [];
  const checkFile = (abs) => {
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { return; }
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === 0 || c < 9 || (c > 13 && c < 32)) {
        bad.push(rel(abs) + ":" + buf.slice(0, i).toString("utf8").split("\n").length + " (0x" + c.toString(16) + ")");
        return;
      }
    }
  };
  for (const d of PKG_DIRS) for (const f of walk(path.join(ROOT, d))) if (TEXT_EXT.test(f)) checkFile(f);
  for (const d of ["tools", "docs", "components"]) {
    for (const f of walk(path.join(ROOT, d))) if (TEXT_EXT.test(f)) checkFile(f);
  }
  for (const f of ["app.js", "app.json", "app.wxss", "project.config.json", "README.md"]) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) checkFile(abs);
  }
  ok("源码无裸控制字节（否则 grep 判二进制 → 排查与文本断言静默失效）", bad.length === 0,
    bad.length ? bad.slice(0, 5).join(" ; ") : "");
}

console.log("");
if (fail === 0) {
  console.log("结构契约门禁通过：" + pass + " 项（根白名单 / 包内纯净 / 无垃圾 / 无空目录 / 无孤儿 / docs 分层 / tools 分层 / 纯文本）");
  process.exit(0);
}
console.log("结构契约门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
process.exit(1);
