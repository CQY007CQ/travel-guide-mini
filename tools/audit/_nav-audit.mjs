// tools/audit/_nav-audit.mjs
// 30 年测工视角：导航死链 + 跳转合规性静态审计
//   - 收集 app.json 注册的全部页面（主包 + 分包 root 拼接）
//   - 扫描所有 .js 的 wx.navigateTo / redirectTo / reLaunch / switchTab 的 url
//   - 判定：① 目标是否注册（死链）② switchTab 是否只指向 tabBar 页 ③ 动态 url（变量）列出人工复核
// 用法：node tools/audit/_nav-audit.mjs
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const app = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));

// 1) 合法页面集合（绝对路径形态：pages/... 与 subpkg/... 等）
const valid = new Set();
app.pages.forEach(p => valid.add(p));
for (const sp of app.subPackages || []) {
  for (const p of sp.pages) valid.add((sp.root.replace(/\/+$/, "") + "/" + p).replace(/\/+/g, "/"));
}
const tabPages = new Set((app.tabBar && app.tabBar.list || []).map(t => t.pagePath));

// 2) 扫描 .js 的导航调用
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "node_modules" && f !== ".git") walk(p, out); }
    else if (f.endsWith(".js")) out.push(p);
  }
}
const jsFiles = [];
walk(ROOT, jsFiles);

const calls = []; // {file, line, api, url, dynamic}
const NAV_RE = /wx\.(navigateTo|redirectTo|reLaunch|switchTab)\s*\(\s*\{[^}]*?url\s*:\s*([^,}\n]+)/g;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  NAV_RE.lastIndex = 0;
  while ((m = NAV_RE.exec(src))) {
    const api = m[1];
    let urlRaw = m[2].trim();
    const line = src.slice(0, m.index).split("\n").length;
    // 去掉尾部逗号/括号
    urlRaw = urlRaw.replace(/,\s*$/, "").replace(/\)$/, "").trim();
    const dynamic = !/^["']/.test(urlRaw) || /[`$\\]/.test(urlRaw);
    let literal = null;
    if (!dynamic) literal = urlRaw.replace(/^["']|["']$/g, "");
    calls.push({ file: path.relative(ROOT, f), line, api, raw: urlRaw, literal, dynamic });
  }
}

// 3) 判定
let dead = 0, badSwitch = 0, dyn = 0;
const issues = [];
const dynamicList = [];
for (const c of calls) {
  if (c.dynamic) { dyn++; dynamicList.push(c); continue; }
  let u = c.literal.replace(/^\//, "").split("?")[0].replace(/\/+$/, "");
  // 去掉前导根
  if (!valid.has(u)) {
    // 尝试带/前缀
    if (!valid.has("/" + u)) {
      dead++;
      issues.push(`死链 ${c.api} → "${c.literal}" @ ${c.file}:${c.line}（未注册页面）`);
      continue;
    }
    u = "/" + u;
  }
  if (c.api === "switchTab" && !tabPages.has(u)) {
    badSwitch++;
    issues.push(`switchTab 非 tabBar 页 → "${c.literal}" @ ${c.file}:${c.line}（tabBar 仅: ${[...tabPages].join(", ")}）`);
  }
}

console.log("== 导航审计 ==");
console.log(`  扫描 js 文件: ${jsFiles.length}`);
console.log(`  导航调用总数: ${calls.length}（navigateTo/redirectTo/reLaunch/switchTab）`);
console.log(`  静态可校验 : ${calls.length - dyn}`);
console.log(`  动态 url    : ${dyn}（需人工复核，见下）`);
console.log("");
if (dead === 0 && badSwitch === 0) console.log("  ✓ 无死链 / 无 switchTab 误用");
else {
  console.log(`  ✗ 问题 ${dead + badSwitch} 处：`);
  issues.forEach(i => console.log("    - " + i));
}
console.log("");
if (dyn) {
  console.log("  动态 url 人工复核清单：");
  dynamicList.forEach(c => console.log(`    - ${c.api} url=${c.raw} @ ${c.file}:${c.line}`));
}

const okAll = dead === 0 && badSwitch === 0;
console.log("\n导航审计结论: " + (okAll ? "PASS（无死链/无违规跳转）" : "FAIL（存在死链或违规跳转）"));
process.exit(okAll ? 0 : 1);
