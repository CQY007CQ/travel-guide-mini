#!/usr/bin/env node
// tools/_scan-undeclared-const.mjs —— 全工程"引用了但从未声明的标识符"扫描
// 抓 MARKER_CAP 这一类潜匿 bug：某标识符在某函数内被引用，但模块内从未 const/let/var/function 声明（运行到该分支才抛 ReferenceError）。
// 聚焦 UPPER_CASE（常量约定），并排除已知微信/Node 全局与本项目已声明全局。
//
// 已知解析坑（本版已修）：
//  1) 对象属性键 `KEY: value` —— KEY 是属性键不是裸引用（data.js 的 DATA={CITIES:[]}、rank.js 的 VER:、toolkit-groups.js 的 ITEM_GROUPS:）。
//  2) 逗号链解构 `const _read=..., {A:A,...}=require(...)` —— 解构块不在 const 紧跟的 { 处，旧正则漏抓（planner.js 37 处）。
import { readFileSync } from "fs";
import { execSync } from "child_process";

const ROOT = process.cwd();
// 收集所有 .js（不含 tools 构建脚本，仅运行时代码：pages / subpkg / subdata* / subai / utils）
const files = execSync(
  "find pages subpkg subdata subdata2 subdata3 subai utils -name '*.js' 2>/dev/null",
  { cwd: ROOT, encoding: "utf8" }
).split("\n").filter(Boolean);

const KNOWN_GLOBALS = new Set([
  "APP_VER", "D", "T", "S", "P", "PACK_LIST", "PREP_CHECKLIST",
  "WX", "NULL", "TRUE", "FALSE", "NAN", "INFINITY", "UNDEFINED",
  "JSON", "MATH", "OBJECT", "ARRAY", "PROMISE", "DATE", "REGEXP", "ERROR", "MAP", "SET", "STRING", "NUMBER", "BOOLEAN", "SYMBOL", "PROXY",
  "GBK", "UTF8", "RGB", "RGBA", "HTTP", "HTTPS", "URL", "ID", "API", "OK", "CSS", "HTML", "JS", "WXML", "WXSS",
]);

// 从解构串里抽出"本地绑定名"：支持 `A` / `A:B`(别名，取 B) / `A as B`(取 B)
function declFromDestructure(block) {
  const out = new Set();
  for (const item of block.split(",")) {
    const t = item.trim();
    if (!t) continue;
    const asM = t.match(/^\S+\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (asM) { out.add(asM[1]); continue; }
    const colonM = t.match(/^[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)$/);
    if (colonM) { out.add(colonM[1]); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(t)) out.add(t);
  }
  return out;
}

let findings = 0;
for (const f of files) {
  const src = readFileSync(ROOT + "/" + f, "utf8");
  const declared = new Set();
  // 1) const/let/var/function NAME
  for (const m of src.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // 2) 赋值兜底 NAME =
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
  // 3) const/let/var 紧跟解构块 { ... }
  for (const m of src.matchAll(/\b(?:const|let|var)\b[^;{]*?\{([^}]*)\}/g)) {
    for (const n of declFromDestructure(m[1])) declared.add(n);
  }
  // 4) 逗号链 / 普通解构 + require：{ ... } = require(...) 或 ({ ... } = ...)
  for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*require/g)) {
    for (const n of declFromDestructure(m[1])) declared.add(n);
  }
  // 5) 任意 `({ A, B } = ...)` / `, { A:B } = ...` 形式（无 require 也兜底）
  for (const m of src.matchAll(/[=(,]\s*\{([^}]*)\}\s*=/g)) {
    for (const n of declFromDestructure(m[1])) declared.add(n);
  }

  // 抽取 UPPER_CASE 使用点（裸引用，非对象属性访问 obj.X），先剔除字符串字面量与注释
  const used = new Map(); // token -> [{line, bare}]
  const lines = src.split("\n");
  lines.forEach((ln, i) => {
    let code = ln.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``");
    code = code.replace(/0x[0-9A-Fa-f]+/g, "0x0");
    for (const m of code.matchAll(/\b([A-Z][A-Z0-9_]{1,})\b/g)) {
      const tok = m[1];
      const idx = m.index;
      const prev = code[idx - 1];
      const bare = prev !== ".";
      // 属性键判定：标识符后面紧跟 ':'（对象字面量键 / 解构键），不算裸引用
      const after = code[idx + tok.length];
      const isKey = after === ":";
      if (!used.has(tok)) used.set(tok, []);
      used.get(tok).push({ line: i + 1, bare: bare && !isKey });
    }
  });

  const issues = [];
  for (const [tok, occ] of used) {
    if (KNOWN_GLOBALS.has(tok) || declared.has(tok)) continue;
    const bareOcc = occ.filter(o => o.bare);
    if (bareOcc.length === 0) continue; // 仅作属性访问/属性键，安全
    issues.push({ tok, line: bareOcc[0].line });
  }
  if (issues.length) {
    findings += issues.length;
    console.log("⚠️ " + f);
    for (const it of issues) console.log("   " + it.tok + "  (第" + it.line + "行裸引用，文件内未声明)");
  }
}
console.log(findings ? `\n❌ 发现 ${findings} 处可能未声明的 UPPER_CASE 标识符（需人工确认是否为真 bug）` : "\n✅ 全工程未发现「引用但从未声明」的 UPPER_CASE 标识符");
process.exit(findings ? 1 : 0);
