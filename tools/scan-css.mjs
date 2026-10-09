// v1.12 UI 减法：死样式扫描器
// 对每个页面 wxss 提取类选择器，检查对应 wxml/js 是否引用；app.wxss 检查全站。
// 用法: node tools/scan-css.mjs
import { readFileSync, readdirSync } from "fs";
const root = process.cwd();
const pages = ["splash", "index", "today", "plan", "more", "map", "food", "ledger", "prep", "assistant", "guide", "toolkit"];

// 提取 wxss 里的类选择器名（.foo / .foo.bar / .foo .bar / .foo, .bar）
function clsOfWxss(src) {
  const out = new Set();
  // 去掉注释
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // 逐段匹配选择器：找到 { 前的选择器文本
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1];
    // 拆逗号
    for (const part of sel.split(",")) {
      // 只关心含 . 的类选择器；提取 .xxx
      for (const c of part.matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(c[1]);
    }
  }
  return out;
}

// 收集某页面引用的类名：wxml 里的 class="..." 与 js 里的字符串字面量（含三元里的 'cls'）
function usedOfPage(p) {
  const used = new Set();
  try {
    const wxml = readFileSync(`${root}/pages/${p}/${p}.wxml`, "utf8");
    for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) {
        const cc = c.trim();
        if (/^[A-Za-z_][\w-]*$/.test(cc)) used.add(cc);
      }
    }
    // {{ }} 三元里的字符串字面量（如 class="x {{cond ? 'r-bad' : 'r-ok'}}"）
    for (const m of wxml.matchAll(/\{\{[\s\S]*?\}\}/g)) {
      for (const s of m[0].matchAll(/['"]([A-Za-z_][\w-]{1,})['"]/g)) used.add(s[1]);
    }
  } catch {}
  try {
    const js = readFileSync(`${root}/pages/${p}/${p}.js`, "utf8");
    // 字符串字面量里的类名（单/双引号）
    for (const m of js.matchAll(/['"]([A-Za-z_][\w-]{2,})['"]/g)) {
      used.add(m[1]);
    }
    // 模板里的类名拼接
    for (const m of js.matchAll(/class[^'"`]*['"]([A-Za-z_][\w-]*)['"]/g)) used.add(m[1]);
  } catch {}
  return used;
}

const report = [];
// 页面级 wxss
for (const p of pages) {
  let wxss = "";
  try { wxss = readFileSync(`${root}/pages/${p}/${p}.wxss`, "utf8"); } catch { continue; }
  const defs = clsOfWxss(wxss);
  const used = usedOfPage(p);
  // app.wxss 的类也会被全局使用，稍后单独处理
  for (const c of defs) {
    if (!used.has(c)) report.push(`  [P3] pages/${p}/${p}.wxss  .${c} 未在本页 wxml/js 引用`);
  }
}
// app.wxss 全站
let awx = "";
try { awx = readFileSync(`${root}/app.wxss`, "utf8"); } catch {}
if (awx) {
  const defs = clsOfWxss(awx);
  const allUsed = new Set();
  for (const p of pages) { for (const c of usedOfPage(p)) allUsed.add(c); }
  for (const c of defs) {
    if (!allUsed.has(c)) report.push(`  [P3] app.wxss  .${c} 未在全站 wxml/js 引用`);
  }
}
console.log(`\n══════ 死样式扫描（共 ${report.length} 处候选）══════`);
report.forEach(r => console.log(r));
console.log("\n提示：需人工复核——动态拼接的类名（如 'cls-' + x）可能被误报；用字符串查找确认后再删。");
