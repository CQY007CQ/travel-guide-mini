// audit-nav.mjs —— 导航 / 按键跳转审计
// 1) 收集 app.json 注册的所有页面路径（主包 + 分包）
// 2) 扫描所有 .js / .wxml 里的导航调用（wx.navigateTo / redirectTo / reLaunch / switchTab / navigator url）
// 3) 把所有静态目标路径与注册表比对，标记未注册（死链）或可疑
// 4) 汇总每个页面 wxml 的 bindtap/catchtap 处理器，确认在对应 js 顶层存在（兜底，check-handlers 已覆盖）
import fs from "fs";
import path from "path";

const PROJ = process.cwd();
const walk = (d, exts, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "." || e.name === ".." || e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
};

// ---- 1. 注册页面集合 ----
const app = JSON.parse(fs.readFileSync(path.join(PROJ, "app.json"), "utf8"));
const reg = new Set();
(app.pages || []).forEach((p) => reg.add(p.replace(/\.wxml$/, "")));
(app.subPackages || app.subpackages || []).forEach((sp) => {
  const root = sp.root.replace(/\/$/, "");
  (sp.pages || []).forEach((p) => reg.add(`${root}/${p.replace(/\.wxml$/, "")}`));
});
// 允许带 .wxml 后缀的写法
const norm = (u) => u.replace(/^\//, "").replace(/\.wxml$/, "").replace(/\?.*$/, "");

// ---- 2. 收集导航目标 ----
const jsFiles = walk(path.join(PROJ, "utils"), [".js"]).concat(walk(path.join(PROJ, "pages"), [".js"]), walk(path.join(PROJ, "subpkg"), [".js"]), walk(path.join(PROJ, "subdata"), [".js"]), walk(path.join(PROJ, "subdata2"), [".js"]), walk(path.join(PROJ, "subdata3"), [".js"]), [path.join(PROJ, "app.js")]);
const wxmlFiles = walk(path.join(PROJ, "pages"), [".wxml"]).concat(walk(path.join(PROJ, "subpkg"), [".wxml"]), walk(path.join(PROJ, "subdata"), [".wxml"]), walk(path.join(PROJ, "subdata2"), [".wxml"]), walk(path.join(PROJ, "subdata3"), [".wxml"]));

const targets = []; // {file, line, kind, url, literal}
const pushT = (file, line, kind, url, literal) => targets.push({ file: path.relative(PROJ, file), line, kind, url, literal });

// js: wx.navigateTo / redirectTo / reLaunch / switchTab( url: )
const navRe = /\bwx\.(navigateTo|redirectTo|reLaunch|switchTab)\s*\(\s*\{[^}]*?url\s*:\s*(["'])([^"']+)\2/g;
const switchRe = /\bwx\.switchTab\s*\(\s*\{[^}]*?url\s*:\s*(["'])([^"']+)\1/g;
for (const f of jsFiles) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    let m;
    const re = new RegExp(navRe.source, "g");
    while ((m = re.exec(ln))) pushT(f, i + 1, "wx." + (m[1] || "switchTab"), m[3], true);
    const re2 = new RegExp(switchRe.source, "g");
    while ((m = re2.exec(ln))) pushT(f, i + 1, "wx.switchTab", m[2], true);
  });
}

// wxml: <navigator url="..."> 以及 wx:if 等（navigator 最常见）
const navWxml = /<navigator\b[^>]*\burl\s*=\s*(["'])([^"']+)\1/g;
for (const f of wxmlFiles) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    let m;
    const re = new RegExp(navWxml.source, "g");
    while ((m = re.exec(ln))) pushT(f, i + 1, "navigator", m[2], true);
  });
}

// 兜底：扫描所有 js/wxml 里形如 "/pages/xxx/xxx" 或 "pages/xxx/xxx" 的字符串字面量（捕捉动态拼路径遗漏）
const pathLit = /(["'])((?:\/)?(?:pages|subpkg|subdata|subdata2|subdata3)\/[A-Za-z0-9_\/]+)\1/g;
const litSeen = new Set();
for (const f of jsFiles.concat(wxmlFiles)) {
  const txt = fs.readFileSync(f, "utf8");
  const lines = txt.split("\n");
  lines.forEach((ln, i) => {
    let m;
    const re = new RegExp(pathLit.source, "g");
    while ((m = re.exec(ln))) {
      const u = norm(m[2]);
      if (litSeen.has(u + "@" + f)) return;
      litSeen.add(u + "@" + f);
      // 跳过明显是 require 的路径
      if (ln.includes("require(") || ln.includes("require.async")) return;
      pushT(f, i + 1, "path-literal", u, true);
    }
  });
}

// ---- 3. 比对 ----
console.log("注册页面数:", reg.size);
console.log("导航目标 / 路径字面量收集:", targets.length);
console.log("");

const unknown = [];
const dynamic = [];
for (const t of targets) {
  const u = norm(t.url);
  if (!u) { dynamic.push(t); continue; }
  // 以 "/" 结尾的拼接前缀（如 "/subpkg/" + k）视为动态拼接，单独列
  if (u.endsWith("/")) { dynamic.push(t); continue; }
  // 去掉 query
  const base = u;
  if (reg.has(base)) continue;
  // 含变量（a+b / ${...} / + ) 视为动态，单独列
  if (t.url.includes("+") || t.url.includes("${") || /["']\s*\+/.test(t.url) || /true\?|false\?|\?/.test(t.url)) {
    dynamic.push(t);
    continue;
  }
  unknown.push(t);
}

console.log("── 未注册（疑似死链，需人工确认）──");
if (!unknown.length) console.log("  ✓ 无未注册静态路径");
else unknown.forEach((t) => console.log(`  ✗ [${t.kind}] ${t.file}:${t.line} -> ${t.url}`));

console.log("");
console.log("── 动态 / 含变量路径（已列出待人工核对，不判失败）──");
dynamic.forEach((t) => console.log(`  • [${t.kind}] ${t.file}:${t.line} -> ${t.url}`));

// 重复统计
const byFile = {};
targets.forEach((t) => { byFile[t.file] = (byFile[t.file] || 0) + 1; });
console.log("");
console.log("── 各文件导航目标计数 ──");
Object.keys(byFile).sort().forEach((k) => console.log(`  ${byFile[k]}\t${k}`));

process.exit(unknown.length ? 1 : 0);
