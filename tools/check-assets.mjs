/**
 * tools/check-assets.mjs —— 图片引用有效性检查
 *
 * 起因（真实缺陷）：深色模式下 tabBar 图标指向 images/tab-index.png 等 4 个文件，
 * 但项目里只有 tab-light-*.png，深色版根本不存在 → 用户看到破图。
 * 编译期不报错、WXML 也不报错，只有切到深色模式才发现。
 *
 * 做法：扫描 app.json / 所有 wxml / js 里出现的 images/xxx.png 路径，逐一校验文件存在。
 * 只查 .png（图标与图片），路径必须是相对项目根的 images/ 开头。
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(wxml|js|json)$/.test(e.name)) files.push(p);
  }
}
["app.json", "pages", "subpkg", "subai", "utils"].forEach((x) => {
  if (!fs.existsSync(x)) return;
  if (fs.statSync(x).isFile()) files.push(x);
  else walk(x);
});

// 注意：WXML 里多为 "/images/icons/xxx.png"（绝对路径），前面是斜杠不是引号，
// 初版正则漏掉了这类，导致只扫到 12 个引用（实际远不止）。
const RE = /["'(]\/?(images\/[A-Za-z0-9_\-\/]+\.png)/g;
const refs = new Map();   // path -> Set(引用它的文件)
for (const f of files) {
  let s = "";
  try { s = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    const p = m[1];
    if (!refs.has(p)) refs.set(p, new Set());
    refs.get(p).add(path.relative(ROOT, f));
  }
}

const missing = [];
for (const [p, users] of refs) {
  if (!fs.existsSync(path.join(ROOT, p))) missing.push({ p, users: [...users] });
}

console.log("  扫描 " + files.length + " 个文件，" + refs.size + " 个图片引用");
if (missing.length) {
  console.log("  ✗ 引用了不存在的图片 " + missing.length + " 个：");
  missing.forEach((x) => console.log("    " + x.p + "   ← " + x.users.slice(0, 3).join(", ")));
  console.log("  提示：这类缺失不会导致编译报错，只会在特定主题/状态下的界面上显示成破图。");
  process.exit(1);
}
console.log("  ✓ 所有图片引用均存在");
