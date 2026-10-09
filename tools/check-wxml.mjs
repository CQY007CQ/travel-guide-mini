// WXML 静态校验：标签闭合 / 属性引号 / wx:for 与 wx:key 配对
// 用途：IDE 登录态失效跑不了 preview 时，用它兜底确认模板结构没写坏
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== "node_modules" && f !== ".git") walk(p); }
    else if (f.endsWith(".wxml")) files.push(p);
  }
})(ROOT);

const VOID_TAGS = new Set(["image", "input", "icon", "import", "include", "wxs", "br", "hr"]);
let pass = 0, fail = 0;
const errs = [];

for (const f of files) {
  const src = fs.readFileSync(f, "utf-8");
  const rel = path.relative(ROOT, f);
  // 去注释
  const clean = src.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, bad = 0;
  while ((m = re.exec(clean))) {
    const closing = m[1] === "/";
    const tag = m[2];
    const attrs = m[3] || "";
    const selfClose = m[4] === "/";
    // 属性引号配对
    const q = (attrs.match(/"/g) || []).length;
    if (q % 2 !== 0) { errs.push(rel + ": 属性引号不闭合 <" + tag + " …>"); bad++; }
    if (selfClose || VOID_TAGS.has(tag) || tag === "block" && false) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        errs.push(rel + ": 标签错配，期望 </" + top + "> 实际 </" + tag + ">");
        bad++;
        // 尝试恢复
        if (top) stack.push(top);
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) { errs.push(rel + ": 未闭合标签 " + stack.join(",")); bad++; }
  if (bad) fail++; else pass++;
  console.log((bad ? "  ✗ " : "  ✓ ") + rel + (bad ? " (" + bad + " 处)" : ""));

  // wx:for 必须有 wx:key（除 wx:for-item 显式指定且数据简单外，仅提示）
  const forRe = /wx:for="\{\{([^}]+)\}\}"/g;
  let fm;
  while ((fm = forRe.exec(clean))) {
    const seg = clean.slice(fm.index, fm.index + 220);
    if (seg.indexOf("wx:key") < 0) errs.push(rel + ": wx:for 缺 wx:key → " + fm[1]);
  }
}

// 检查引用的图标文件是否存在
const iconRe = /\/images\/icons\/([a-zA-Z0-9_-]+)\.png/g;
const missing = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf-8");
  let m;
  while ((m = iconRe.exec(src))) {
    const p = path.join(ROOT, "images/icons", m[1] + ".png");
    if (!fs.existsSync(p)) missing.add(m[1]);
  }
}
// 动态图标（{{}} 拼接）需人工确认
if (missing.size) errs.push("缺失图标: " + Array.from(missing).join(", "));

console.log("\n结果: " + pass + " 个文件通过 / " + fail + " 个文件有问题");
if (errs.length) { console.log("问题明细:"); errs.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("WXML 结构全部正确");
