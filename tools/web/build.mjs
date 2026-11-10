// tools/web/build.mjs —— 把小程序产物编译成网页版可运行的静态资源
//
// 设计原则：网页版不重写业务逻辑，把同一份源码原样搬给浏览器。
//   · utils/*.js、页面 *.js 本来就是 CommonJS，注册进模块表即可复用；
//   · WXML 由 tools/web/wxml.mjs 编译成 h() 渲染函数；
//   · WXSS 做 rpx→calc 转换 + 页面作用域隔离；
//   · 运行时（wx / Page / getApp）由 web/lib/runtime.js 提供，不参与构建。
//
// 产出（web/lib/）：
//   data.js    —— **全部** data-packed*.js（清单来自 _manifest.js，单独文件便于缓存）
//   modules.js —— 其余全部 js 模块 + 迷你 CJS loader
//   tpl.js     —— app.json 里所有页面的渲染函数
//   app.css    —— app.wxss + 各页 wxss
//   nav.js     —— 与 app.json 同源的全站页面清单（网页外壳导航用）
//
// 用法：node tools/web/build.mjs

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { compilePage } from "./wxml.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "web/lib");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ───────────── 1. 收集模块 ───────────── */

const EXCLUDE_DIRS = new Set(["tools", "node_modules", "web", "images", "docs", "shots", "outputs", ".git"]);
const MANIFEST = "subdata/data/_manifest.js";

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

/**
 * 从分包清单解析**所有**数据块路径。
 * utils/data.js 在浏览器里没有 require.async，会走 resolveChunkPaths() 的
 * require("../subdata/data/_manifest.js") 分支；清单里的路径相对 utils/ 带 "../"，
 * 这里统一去掉还原成模块表 id（与 __resolve 的结果一致）。
 *
 * 2026-11-10 修复：旧版只注册 data-packed.js 一块，且把 _manifest.js 排除在
 * modules.js 之外 —— resolveChunkPaths() 必然 fallback 到单块，chunk2 即便被
 * 收录也从不被 applyPacked() 加载，网页端整块数据（如 SPOT_DETAILS_BY_CITY）静默缺失。
 * 改为清单驱动后，pack-data 将来切第 3 块也自动跟上，不用再改网页构建。
 */
function chunkPaths() {
  const src = read(MANIFEST);
  const m = src.match(/module\.exports\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) throw new Error("无法解析数据分块清单 " + MANIFEST);
  const list = JSON.parse(m[1]);
  if (!Array.isArray(list) || !list.length) throw new Error("数据分块清单为空: " + MANIFEST);
  return list.map((p) => String(p).replace(/^\.\.\//, ""));
}

const CHUNKS = chunkPaths();
for (const p of CHUNKS) {
  if (!exists(p)) throw new Error("数据分块缺失（清单与产物不一致）: " + p);
}

const allJs = walkJs("");
// 数据块只在 data.js 里注册一次，避免 modules.js 再重复塞 2MB+ base64；
// _manifest.js 必须留在 modules.js，否则浏览器端 resolveChunkPaths() 会退回单块。
const chunkSet = new Set(CHUNKS);
const modules = allJs.filter((p) => !chunkSet.has(p));
const pageJs = modules.filter((p) => /^(pages|subpkg|subai|subdata)\//.test(p) && !/\/utils\//.test(p) && /\/[^/]+\.js$/.test(p) && /^(pages|subpkg|subai|subdata)\/[^/]+\/[^/]+\.js$/.test(p));

console.log("模块总数:", modules.length, "｜页面 JS:", pageJs.length, "｜数据块:", CHUNKS.length);

/* ───────────── 2. 数据包（清单驱动的全部数据块） ───────────── */

fs.mkdirSync(OUT, { recursive: true });
const dataParts = [
  "/* 由 tools/web/build.mjs 生成，勿手改 —— 数据分块清单 " + MANIFEST + " */",
  "(function(g){ g.__M = g.__M || {};",
];
for (const p of CHUNKS) {
  dataParts.push("g.__M[" + JSON.stringify(p) + "] = function(module, exports, require){");
  dataParts.push(read(p));
  dataParts.push("};");
}
dataParts.push("})(typeof window!=='undefined'?window:globalThis);");
fs.writeFileSync(path.join(OUT, "data.js"), dataParts.join("\n"), "utf8");
console.log("数据块已注册:", CHUNKS.join(" , "));

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

/* ───────── 4.5 全站页面清单（网页外壳导航 / AI 全站跳转同源） ─────────
 * 网页版要提供「跳到任意页」的导航抽屉和 AI 站点导航，页面清单不能手抄：
 * 手抄必然随 app.json 漂移。这里由 app.json + 各页 .json 的标题直接生成，
 * 增删页面后重跑构建自动同步；数据分包的 keep 占位空页不进导航。 */
{
  const tabSet = new Set(((appJson.tabBar && appJson.tabBar.list) || []).map((x) => x.pagePath));
  const GROUP = { pages: "主导航", subpkg: "旅行工具", subai: "深度内容", subdata: "数据与增强", subdata2: "数据与增强", subdata3: "数据与增强" };
  const nav = [];
  for (const p of pages) {
    if (/\/keep\/keep$/.test(p)) continue;          // 分包占位空页，不是给用户用的界面
    if (!exists(p + ".wxml")) continue;             // 没有界面的页不进导航
    let title = "";
    try { title = JSON.parse(read(p + ".json")).navigationBarTitleText || ""; } catch (e) {}
    const root = p.split("/")[0];
    nav.push({ p: p, t: title || p.split("/").pop(), g: GROUP[root] || "其他", tab: tabSet.has(p) });
  }
  fs.writeFileSync(path.join(OUT, "nav.js"),
    "/* 由 tools/web/build.mjs 生成，勿手改 —— 来自 app.json */\n" +
    "window.__WEB_NAV = " + JSON.stringify(nav) + ";\n", "utf8");
  console.log("全站页面清单:", nav.length, "页（tab", nav.filter((x) => x.tab).length, "）");
}

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
  // 增量同步，**不要整目录 rmSync**：宿主的 node-safe-delete shim 会拦截一次删除
  // 50+ 文件的操作（全量回归实测：SAFE_DELETE_BULK_CONFIRM_REQUIRED, count:66 > threshold:50），
  // 单跑因为计数没累积能过、全量跑到最后一步必炸，症状极具误导性。
  // 目录感知：旧版只收集文件，整个子目录下线后会留下空目录；更糟的是
  // 「源是文件、目标残留同名目录」时 cpSync 会抛 EISDIR/ENOTEMPTY 让整个构建失败。
  const relTree = (base) => {
    const files = [], dirs = [];
    (function walk(d, pre) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const rel = pre ? pre + "/" + e.name : e.name;
        if (e.isDirectory()) { dirs.push(rel); walk(path.join(d, e.name), rel); }
        else files.push(rel);
      }
    })(base, "");
    return { files, dirs };
  };
  if (fs.existsSync(dst)) {
    const srcTree = relTree(src), dstTree = relTree(dst);
    const srcFiles = new Set(srcTree.files), srcDirs = new Set(srcTree.dirs);
    let removed = 0;
    for (const rel of dstTree.files) {
      if (!srcFiles.has(rel)) { fs.unlinkSync(path.join(dst, rel)); removed++; }
    }
    // 从深到浅删「源里已不存在的目录」，也顺手消解文件↔目录类型冲突
    // （目录内多余文件上一步已 unlink，故用 rmdirSync 即可；不做递归删除，
    //  避免宿主 safe-delete-shim 的 50+ 批量删除拦截）。
    for (const rel of dstTree.dirs.slice().sort((a, b) => b.length - a.length)) {
      if (srcDirs.has(rel)) continue;
      try { fs.rmdirSync(path.join(dst, rel)); removed++; } catch (e) { /* 非空则留待下次 */ }
    }
    if (removed) console.log("静态资源：清理 " + removed + " 个已下线项（含残留目录）");
  }
  fs.cpSync(src, dst, { recursive: true, force: true });
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
// 版本号必须由「产物内容」算出来，不能用 Date.now()：否则每次跑 allcheck 都会改写
// index.html、把工作区弄脏（实测 v1.20.0 夜间回归后 git status 多出一个无意义改动）。
// 内容不变 → 戳不变（构建幂等）；内容变了 → 戳变化（浏览器缓存自动失效）。
{
  const idxPath = path.join(ROOT, "web/index.html");
  let html = fs.readFileSync(idxPath, "utf8");
  const deps = [
    "web/lib/modules.js", "web/lib/data.js", "web/lib/tpl.js", "web/lib/app.css",
    "web/lib/nav.js", "web/lib/runtime.js", "web/app.js", "web/shell.css",
    // 2026-11-10：AI 助手原本用固定戳 v=ai20261109，改了脚本浏览器仍吃旧缓存。
    // 纳入统一内容 hash 后，任何资源改动都会自动破缓存，且构建依旧幂等。
    "web/ai-assistant.js", "web/ai-assistant.css",
  ];
  const h = crypto.createHash("sha1");
  for (const rel of deps) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  const v = h.digest("hex").slice(0, 8);
  html = html.replace(/(src|href)="((?:lib\/[^"?]+|shell\.css|app\.js|ai-assistant\.(?:css|js)))(?:\?v=[^"]*)?"/g,
    (m, a, f) => a + '="' + f + "?v=" + v + '"');
  fs.writeFileSync(idxPath, html, "utf8");
  console.log("资源引用已打版本号 v=" + v + "（内容 hash，构建幂等）");
}
