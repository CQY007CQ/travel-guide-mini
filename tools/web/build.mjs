// tools/web/build.mjs —— 把小程序产物编译成网页版可运行的静态资源
//
// 设计原则：网页版不重写业务逻辑，把同一份源码原样搬给浏览器。
//   · utils/*.js、页面 *.js 本来就是 CommonJS，注册进模块表即可复用；
//   · WXML 由 tools/web/wxml.mjs 编译成 h() 渲染函数；
//   · WXSS 做 rpx→calc 转换 + 页面作用域隔离；
//   · 运行时（wx / Page / getApp）由 web/lib/runtime.js 提供，不参与构建。
//
// 产出（web/lib/）：
//   data.js    —— subdata/data/data-packed.js（1.8MB base64，单独文件便于缓存）
//   modules.js —— 全部 js 模块 + 迷你 CJS loader
//   tpl.js     —— 17 个页面的渲染函数
//   app.css    —— app.wxss + 各页 wxss
//
// 用法：node tools/web/build.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePage } from "./wxml.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "web/lib");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ───────────── 1. 收集模块 ───────────── */

const EXCLUDE_DIRS = new Set(["tools", "node_modules", "web", "images", "docs", "shots", "outputs", ".git"]);
const DATA_PACKED = "subdata/data/data-packed.js";

function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name) || dir === "" && EXCLUDE_DIRS.has(rel)) continue;
      if (EXCLUDE_DIRS.has(rel.split("/")[0])) continue;
      walkJs(rel, out);
    } else if (e.name.endsWith(".js")) {
      out.push(rel);
    }
  }
  return out;
}

const allJs = walkJs("");
const modules = allJs.filter((p) => p !== DATA_PACKED && !p.endsWith("_manifest.js"));
const pageJs = modules.filter((p) => /^(pages|subpkg|subai|subdata)\//.test(p) && !/\/utils\//.test(p) && /\/[^/]+\.js$/.test(p) && /^(pages|subpkg|subai|subdata)\/[^/]+\/[^/]+\.js$/.test(p));

console.log("模块总数:", modules.length, "｜页面 JS:", pageJs.length, "｜数据包:", exists(DATA_PACKED) ? "有" : "缺失");

/* ───────────── 2. 数据包 ───────────── */

const dataSrc = read(DATA_PACKED);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "data.js"),
  "/* 由 tools/web/build.mjs 生成，勿手改 —— 来自 " + DATA_PACKED + " */\n" +
  "(function(g){ g.__M = g.__M || {}; g.__M[" + JSON.stringify(DATA_PACKED) + "] = function(module, exports, require){\n" +
  dataSrc + "\n}; })(typeof window!=='undefined'?window:globalThis);\n",
  "utf8"
);

/* ───────────── 3. 模块表 ───────────── */

const parts = [];
parts.push("/* 由 tools/web/build.mjs 生成，勿手改 */");
parts.push("(function(g){");
parts.push("g.__M = g.__M || {};");
for (const p of modules) {
  const src = read(p);
  parts.push("g.__M[" + JSON.stringify(p) + "] = function(module, exports, require, __filename, __dirname){");
  parts.push(src);
  parts.push("};");
}

// 迷你 CJS loader
parts.push(`
g.__C = g.__C || {};
g.__resolve = function(from, req){
  if (req.charAt(0) !== ".") return req.replace(/^\\//, "");
  var base = from.split("/"); base.pop();
  var seg = req.split("/");
  for (var i = 0; i < seg.length; i++) {
    var s = seg[i];
    if (s === "." || s === "") continue;
    if (s === "..") base.pop(); else base.push(s);
  }
  var id = base.join("/");
  if (!/\\.js$/.test(id)) id += ".js";
  return id;
};
g.__require = function(from, req){
  var id = g.__resolve(from, req);
  if (g.__C[id]) return g.__C[id].exports;
  var def = g.__M[id];
  if (!def) throw new Error("[web] 模块缺失: " + id + "（require 来自 " + from + "）");
  var m = { exports: {} };
  g.__C[id] = m;
  var localReq = function(r){ return g.__require(id, r); };
  // 关键：浏览器里不能有 require.async，否则 data.js 会走微信分包分支
  def.call(m.exports, m, m.exports, localReq, id, id.replace(/\\/[^/]+$/, ""));
  return m.exports;
};
})(typeof window!=='undefined'?window:globalThis);
`);

fs.writeFileSync(path.join(OUT, "modules.js"), parts.join("\n"), "utf8");

/* ───────────── 4. 页面模板 ───────────── */

const appJson = JSON.parse(read("app.json"));
const pages = [...(appJson.pages || [])];
(appJson.subPackages || []).forEach((s) => (s.pages || []).forEach((p) => pages.push(s.root.replace(/\/$/, "") + "/" + p)));

const tpl = ["/* 由 tools/web/build.mjs 生成，勿手改 */", "(function(g){", "g.__TPL = {};"];
let compiled = 0;
for (const p of pages) {
  const wxml = p + ".wxml";
  if (!exists(wxml)) { console.warn("  跳过（无 wxml）:", p); continue; }
  let code;
  try {
    code = compilePage(read(wxml), p);
    // 语法自检
    new Function("__h", "__c", "__t", "__pick", "__d", "with(__d){return (" + code + ")(__h,__c,__t,__pick,__d);}");
    tpl.push("g.__TPL[" + JSON.stringify(p) + "] = " + code + ";");
    compiled++;
  } catch (e) {
    console.error("  ✗ 编译失败:", p, "—", e.message);
  }
}
tpl.push("})(typeof window!=='undefined'?window:globalThis);");
fs.writeFileSync(path.join(OUT, "tpl.js"), tpl.join("\n"), "utf8");
console.log("页面模板编译:", compiled + "/" + pages.length);

/* ───────────── 5. 样式 ───────────── */

/** @import 展开 + rpx 转换 */
function convertCss(css, seen = new Set()) {
  // @import "a.wxss";
  css = css.replace(/@import\s+["']([^"']+)["']\s*;?/g, (_, f) => {
    const rel = f.replace(/^\//, "");
    if (seen.has(rel) || !exists(rel)) return "";
    seen.add(rel);
    return convertCss(read(rel), seen);
  });
  // rpx → calc(N * var(--rpx))
  css = css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => "calc(" + n + " * var(--rpx))");
  // 小程序根选择器 page → .page-root
  // 小程序的 page 是根节点，网页里对应 #app（.page-root 没有任何元素用，规则会失效）
  // 注意要多行标志：行首的 page { 在无 m 标志时匹配不到（实测漏掉大半根规则）
  css = css.replace(/(^|[\n},])\s*page\s*\{/g, "$1\n#app{");
  return css;
}

const cssChunks = [];
cssChunks.push("/* 由 tools/web/build.mjs 生成，勿手改 */");
cssChunks.push(":root{ --rpx: calc(100vw / 750); }");
cssChunks.push("html,body{margin:0;padding:0;}");
cssChunks.push("*{box-sizing:border-box;}");

// 全局 app.wxss（不加作用域）
cssChunks.push("/* ===== app.wxss ===== */");
cssChunks.push(convertCss(read("app.wxss")));

// 页面级 wxss 加作用域前缀，避免同名类互相覆盖
let scoped = 0;
for (const p of pages) {
  const wxss = p + ".wxss";
  if (!exists(wxss)) continue;
  const raw = convertCss(read(wxss));
  const scope = '[data-page="' + p + '"]';
  // 逐条规则加前缀（含媒体查询内的规则）
  const out = raw.replace(/(^|\})\s*([^{}@\/][^{}]*?)\s*\{/g, (m, brace, sel) => {
    const sels = sel.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      if (/^(html|body|:root|@)/.test(s)) return s;
      return scope + " " + s;
    });
    return (brace || "") + "\n" + sels.join(",") + "{";
  });
  cssChunks.push("/* ===== " + p + ".wxss ===== */");
  cssChunks.push(out);
  scoped++;
}
fs.writeFileSync(path.join(OUT, "app.css"), cssChunks.join("\n"), "utf8");
console.log("样式：全局 app.wxss + " + scoped + " 个页面 wxss");

/* ───────────── 6. 体积汇报 ───────────── */

const sz = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + "KB";
console.log("产出：data.js " + sz("data.js") + " ｜ modules.js " + sz("modules.js") + " ｜ tpl.js " + sz("tpl.js") + " ｜ app.css " + sz("app.css"));

/* ───────────── 7. 静态资源 ───────────── */
// 页面的 <image src="/images/..."> 是站点绝对路径，所以把 images/ 复制到站点根下。
{
  const src = path.join(ROOT, "images");
  const dst = path.join(ROOT, "web/images");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  let n = 0, bytes = 0;
  (function cnt(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) cnt(p); else { n++; bytes += fs.statSync(p).size; }
    }
  })(dst);
  console.log("静态资源：images/ → web/images/（" + n + " 个文件，" + (bytes / 1024).toFixed(0) + "KB）");
}

/* ───────────── 8. 缓存破除 ───────────── */
// 静态站点最常见的坑：改了 css/js 但浏览器还在用旧缓存，排查时极度误导
// （本次就出现「rpx 基准已修，页面尺寸没变」）。这里给 index.html 的资源引用统一打版本号。
{
  const idxPath = path.join(ROOT, "web/index.html");
  let html = fs.readFileSync(idxPath, "utf8");
  const v = Date.now().toString(36);
  html = html.replace(/(src|href)="((?:lib\/[^"?]+|shell\.css|app\.js))(?:\?v=[^"]*)?"/g, (m, a, f) => a + '="' + f + "?v=" + v + '"');
  fs.writeFileSync(idxPath, html, "utf8");
  console.log("资源引用已打版本号 v=" + v);
}
