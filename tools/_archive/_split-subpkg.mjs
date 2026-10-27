// 一次性脚本：把 7 个非 tab 页拆进 subpkg/ 分包
// 步骤：
//  1. 移动 pages/{map,food,ledger,prep,assistant,guide,toolkit} -> subpkg/
//  2. 改 app.json（pages 保留主包页，新增 subPackages）
//  3. 改被拆页 JS 的 require("../../utils/...") -> require("../../../utils/...")
//  4. 全局改跳转路径 /pages/{被拆页} -> /subpkg/{被拆页}
//  5. 校验：所有被拆页引用路径都更新，主包页路径不变
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SUB = ["map", "food", "ledger", "prep", "assistant", "guide", "toolkit"];
const errors = [];

function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
function write(p, s) { fs.writeFileSync(path.join(ROOT, p), s, "utf8"); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

// 1) 移动目录
for (const p of SUB) {
  const src = path.join(ROOT, "pages", p);
  const dst = path.join(ROOT, "subpkg", p);
  if (exists(path.join("subpkg", p))) {
    console.log("已存在:", "subpkg/" + p);
    continue;
  }
  if (!exists(path.join("pages", p))) { errors.push("缺页面目录 pages/" + p); continue; }
  fs.mkdirSync(path.join(ROOT, "subpkg"), { recursive: true });
  fs.renameSync(src, dst);
  console.log("移动:", "pages/" + p, "->", "subpkg/" + p);
}

// 2) app.json
const appPath = path.join(ROOT, "app.json");
const app = JSON.parse(read("app.json"));
const mainPages = app.pages.filter(p => {
  const m = p.match(/^pages\/([^/]+)\//);
  return m && SUB.includes(m[1]) ? false : true;
});
const subPages = SUB.map(p => p + "/" + p);
app.pages = mainPages;
app.subPackages = [{ root: "subpkg", pages: subPages }];
write("app.json", JSON.stringify(app, null, 2) + "\n");
console.log("app.json 主包页:", app.pages.length, "| 分包页:", subPages.length);

// 3) 被拆页 require 路径
for (const p of SUB) {
  const f = path.join("subpkg", p, p + ".js");
  if (!exists(f)) { errors.push("缺文件 " + f); continue; }
  const s = read(f);
  const n = s.replace(/require\("\.\.\/\.\.\/utils\//g, 'require("../../../utils/');
  if (n !== s) {
    write(f, n);
    console.log("require 更新:", f);
  } else if (s.includes('require("../../utils/')) {
    errors.push(f + " 有未替换的 require ../../utils");
  }
}

// 4) 全局跳转路径
const allFiles = [];
function walk(dir) {
  if (!exists(dir)) return;
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/\.(js|wxml|json)$/.test(ent.name)) allFiles.push(full);
  }
}
walk("pages");
walk("subpkg");
if (exists("app.js")) allFiles.push("app.js");
const pathMap = {};
for (const p of SUB) {
  pathMap["/pages/" + p + "/" + p] = "/subpkg/" + p + "/" + p;
  pathMap['"/pages/' + p + '/' + p + '"'] = '"/subpkg/' + p + '/' + p + '"';
}
for (const f of allFiles) {
  if (!exists(f)) continue;
  const s = read(f);
  let n = s;
  let hits = 0;
  for (const [from, to] of Object.entries(pathMap)) {
    if (from.startsWith("/pages") && !from.startsWith('"')) {
      // 裸路径替换（WXML data-url 等）
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const m = n.match(re);
      if (m) hits += m.length;
      n = n.replace(re, to);
    }
  }
  if (n !== s) {
    write(f, n);
    console.log("跳转更新:", f, "(+", hits, "处)");
  }
}

// 5) 校验：主包页面不得引用分包 require（检查主包 js 是否 require 了 subpkg）
const mainJs = [];
walk("pages");
for (const f of mainJs) {
  if (f.endsWith(".js")) {
    const s = read(f);
    const bad1 = s.includes("require(\"../../subpkg");
    const bad2 = s.includes("require(\"./subpkg");
    const bad3 = s.includes("require(\"../subpkg");
    if (bad1 || bad2 || bad3) {
      errors.push(f + " 主包页面 require 分包资源（不允许）");
    }
  }
}
// 校验：残留旧路径
for (const f of allFiles) {
  const s = read(f);
  for (const p of SUB) {
    if (s.includes("/pages/" + p + "/")) errors.push(f + " 残留旧路径 /pages/" + p + "/");
  }
}
// 校验：app.json 合法
try { JSON.parse(read("app.json")); } catch (e) { errors.push("app.json JSON 解析失败: " + e.message); }

if (errors.length) {
  console.error("\n❌ 拆包发现 " + errors.length + " 个问题：");
  errors.forEach(e => console.error("  -", e));
  process.exit(1);
}
console.log("\n✅ 拆包完成，校验通过");
