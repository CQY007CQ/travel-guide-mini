// 页面结构 + 事件处理器配对静态校验
// 1) app.json 声明的页面四件套(js/wxml/wxss/json)齐全；页面 JSON 可解析
// 2) 每个页面 WXML 里 bind*/catch* 引用的处理器，在对应 js 的 Page({...}) 顶层有定义
// 用法：cd 项目根 && node tools/check/check-handlers.mjs
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const ROOT_PATH = path.resolve(ROOT);
let pass = 0, fail = 0;
const errs = [];

const ok = (n) => { pass++; console.log("  ✓ " + n); };
const bad = (n, d) => { fail++; console.log("  ✗ FAIL: " + n + (d ? " → " + d : "")); errs.push(n + (d ? " → " + d : "")); };

/* ---------- 1. app.json 页面四件套 ---------- */
console.log("== 1. 页面四件套 / JSON 合法性 ==");
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf-8"));
const pages = appJson.pages || [];
if (!pages.length) { bad("app.json.pages", "无页面"); process.exit(1); }
for (const p of pages) {
  const base = path.join(ROOT, p);
  const trio = ["js", "wxml", "wxss"].map(ext => base + "." + ext);
  const miss = trio.filter(f => !fs.existsSync(f));
  if (miss.length) { bad("页面文件齐全 " + p, "缺 " + miss.map(m => path.basename(m)).join(", ")); continue; }
  const cfg = base + ".json";
  if (fs.existsSync(cfg)) {
    try { JSON.parse(fs.readFileSync(cfg, "utf-8")); }
    catch (e) { bad("页面 JSON 解析 " + p, e.message); continue; }
  }
  ok(p);
}
// 反向：磁盘上有页面目录但 app.json 未注册（孤儿页面）
const orphans = [];
for (const d of fs.readdirSync(path.join(ROOT, "pages"))) {
  const key = "pages/" + d + "/" + d;
  if (fs.existsSync(path.join(ROOT, key + ".js")) && !pages.includes(key)) orphans.push(key);
}
if (orphans.length) bad("无孤儿页面", orphans.join(", ")); else ok("无孤儿页面");

/* ---------- 2. 事件处理器配对 ---------- */
console.log("== 2. WXML 事件处理器 ↔ Page 顶层方法 ==");

function skipString(src, i) {
  const q = src[i];
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (src[k] === q) return k;
  }
  return src.length;
}
function skipLineComment(src, i) {
  const nl = src.indexOf("\n", i + 2);
  return nl < 0 ? src.length : nl;
}
function skipBlockComment(src, i) {
  const end = src.indexOf("*/", i + 2);
  return end < 0 ? src.length : end + 2;
}
// 跳过正则字面量（/.../）：处理转义与字符类 [..] 内含的 /（简易启发式，足够覆盖本工程）
function skipRegex(src, i) {
  let j = i + 1, inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "]") { inClass = false; j++; continue; }
    if (c === "/" && !inClass) return j;
    j++;
  }
  return src.length - 1;
}

// 提取 Page({...}) / Component({...}) 顶层与 methods 内 key（支持 key:value 与 key(){} 简写）
// 兼容自定义组件：组件用 Component({...}) 且处理器写在 methods 内（深度 2）。
function pageTopKeys(src) {
  let pi = src.indexOf("Page(");
  if (pi < 0) pi = src.indexOf("Component(");
  if (pi < 0) return null;
  const oi = src.indexOf("{", pi);
  if (oi < 0) return null;
  const keys = new Set();
  let depth = 0;
  for (let i = oi; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i) - 1; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1 && depth !== 2) continue;
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === ":" || src[k] === "(") keys.add(word);
      i = j - 1;
    }
  }
  return keys;
}

const EVENT_RE = /(?:bind|catch)(?::?[a-zA-Z][a-zA-Z-]*)?="([A-Za-z_$][A-Za-z0-9_$]*)"/g;

const wxmlFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "node_modules" && f !== ".git") walk(p); }
    else if (f.endsWith(".wxml")) wxmlFiles.push(p);
  }
})(ROOT);

let checked = 0;
for (const wf of wxmlFiles) {
  const rel = path.relative(ROOT, wf);
  const jsFile = wf.replace(/\.wxml$/, ".js");
  if (!fs.existsSync(jsFile)) continue;
  const wsrc = fs.readFileSync(wf, "utf-8").replace(/<!--[\s\S]*?-->/g, "");
  const used = new Set();
  let m;
  EVENT_RE.lastIndex = 0;
  while ((m = EVENT_RE.exec(wsrc))) used.add(m[1]);
  if (!used.size) { ok("无事件处理器 " + rel); continue; }
  const keys = pageTopKeys(fs.readFileSync(jsFile, "utf-8"));
  if (!keys) { bad("Page 对象解析 " + rel, "js 中找不到 Page({...})"); continue; }
  const miss = [...used].filter(n => !keys.has(n));
  checked++;
  if (miss.length) bad("事件配对 " + rel, "缺处理器: " + miss.join(", "));
  else ok("事件配对 " + rel + " (" + used.size + " 个)");
}
if (!checked) ok("（无带事件处理器的 wxml）");

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
if (errs.length) { console.log("问题明细:"); errs.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("页面结构与事件配对全部正确");
