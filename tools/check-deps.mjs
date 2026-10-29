/**
 * tools/check-deps.mjs —— 依赖完整性检查（防止"移文件移断管线"）
 *
 * 起因（真实事故）：清理仓库时把 v193-spots-list.json 移出 tools/，check-v112 立刻
 * 报 MODULE_NOT_FOUND，但只有跑到那一步才发现。这类错误靠人记不住。
 *
 * 做法：
 *   1. 扫描全仓 JS（tools/、pages/、subpkg/、utils/、app.js）里的相对引用
 *      require("./x") / require("../x") / import ... from "./x" / require.async("./x")
 *   2. 按 Node 解析规则尝试补后缀（.js/.mjs/.cjs/.json/目录 index.js）判断是否存在
 *   3. 缺失即失败；但允许 ALLOW 名单（这些是 try/catch 包裹的"可选补丁"，缺失属正常）
 *
 * 为什么要有 ALLOW：项目里多处用 `try { require("./v20x-xxx.js") } catch {}` 加载可选数据补丁，
 * 缺失是设计允许的。若一律判失败，检查会长期误报，最后被人忽略——那比没有检查更糟。
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// 已知可选依赖（被 try/catch 包裹，缺失不影响运行）。新增可选补丁时在此追加。
const ALLOW = new Set([]);

const SCAN_DIRS = ["tools", "pages", "subpkg", "utils", "subai"];
// 备份/真源目录不扫：_src-backup 里的 require.async 是给 utils/ 运行时用的路径，
// 相对基准与本目录不同，扫了必然误报；_bak-* 只是历史备份，不参与运行。
const SKIP_PATH = /(^|\/)(_src-backup|_bak-[^/]+)(\/|$)/;
const SCAN_ROOT = ["app.js"];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (SKIP_PATH.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
}

const files = [];
SCAN_DIRS.forEach((d) => walk(d, files));
SCAN_ROOT.forEach((f) => { if (fs.existsSync(f)) files.push(f); });

const RE = /(?:require\s*\(\s*|require\.async\s*\(\s*|from\s+)["'](\.{1,2}\/[^"']+)["']/g;

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const cands = [base, base + ".js", base + ".mjs", base + ".cjs", base + ".json",
    path.join(base, "index.js"), path.join(base, "index.mjs")];
  return cands.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

const missing = [];
let checked = 0;
for (const f of files) {
  let src = "";
  try { src = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
  // 去掉注释，避免文档示例（如 require("./x")）被当作真实依赖
  src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    const spec = m[1];
    checked++;
    if (resolves(f, spec)) continue;
    const rel = path.relative(ROOT, f);
    const key = rel + " -> " + spec;
    if (!ALLOW.has(spec) && !ALLOW.has(key)) missing.push(key);
  }
}

console.log("  扫描 " + files.length + " 个 JS 文件，" + checked + " 处相对引用");
if (missing.length) {
  console.log("  ✗ 缺失依赖 " + missing.length + " 处：");
  missing.slice(0, 25).forEach((x) => console.log("    " + x));
  if (missing.length > 25) console.log("    …另有 " + (missing.length - 25) + " 处");
  process.exit(1);
}
console.log("  ✓ 所有相对引用均可解析");
