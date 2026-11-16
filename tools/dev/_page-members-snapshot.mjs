/**
 * tools/dev/_page-members-snapshot.mjs —— 页面成员「名字 → 方法体指纹」快照
 *
 * 用途：T4 拆巨型文件时，用来逐方法证明「只是换了住所，代码一字未改」。
 * 拆分前对原文件拍一次，拆分后对「页面文件 + 同目录拆分模块」再拍一次，
 * 两份快照必须完全一致（成员集合、数量、每个方法体的 sha1 都对得上）。
 *
 * 用法：
 *   node tools/dev/_page-members-snapshot.mjs head pages/plan/plan.js > /tmp/before.txt
 *   node tools/dev/_page-members-snapshot.mjs work pages/plan/plan.js pages/plan/p-*.js > /tmp/after.txt
 *   diff /tmp/before.txt /tmp/after.txt
 */
import fs from "fs";
import crypto from "crypto";
import { execFileSync } from "child_process";

const GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const mode = process.argv[2];
const files = process.argv.slice(3);

function readTarget(f) {
  if (mode === "head") return execFileSync(GIT, ["show", "HEAD:" + f], { encoding: "utf8", maxBuffer: 1 << 28 });
  return fs.readFileSync(f, "utf8");
}

/** 直接扫「顶层对象成员」：这类文件都是 module.exports = {...} 或 Page(SafePage({...})) */
function parseMembers(s) {
  let objStart = -1;
  const sp = /SafePage\(\s*(?:Object\.assign\()?\{/.exec(s);
  if (sp) objStart = s.indexOf("{", sp.index);
  if (objStart < 0) {
    const me = /module\.exports\s*=\s*\{/.exec(s);
    if (me) objStart = s.indexOf("{", me.index);
  }
  if (objStart < 0) return [];
  let i = objStart, depth = 0, inS = null;
  const out = [];
  let lastKey = null, lastKeyOff = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inS) { if (c === "\\") { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i++; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 1 && lastKey) { out.push({ k: lastKey, text: s.slice(lastKeyOff, i + 1) }); lastKey = null; }
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) {
      const nl = s.indexOf("\n", i);
      const m = /^\s*([A-Za-z_$][\w$]*)\s*[:(]/.exec(s.slice(i, nl < 0 ? s.length : nl));
      if (m && (i === 0 || s[i - 1] === "\n" || s[i - 1] === "\r")) { lastKey = m[1]; lastKeyOff = i; }
    }
  }
  return out;
}

/** 归一化：去掉行首缩进与行尾空白、去掉分隔逗号 —— 只比代码本体，不比排版 */
function norm(t) {
  return t
    .replace(/\s*,\s*$/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");
}

const rows = [];
for (const f of files) {
  const s = readTarget(f);
  for (const m of parseMembers(s)) {
    rows.push(m.k + "\t" + crypto.createHash("sha1").update(norm(m.text)).digest("hex").slice(0, 12) + "\t" + f);
  }
}
rows.sort();
console.log(rows.join("\n"));
console.error("成员数: " + rows.length);
