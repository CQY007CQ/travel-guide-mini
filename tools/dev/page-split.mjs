/**
 * tools/dev/page-split.mjs —— 页面成员按职责拆分的工具（T4）
 *
 * 为什么需要它：pages/plan/plan.js 1708 行、pages/index/index.js 1409 行，
 * 认知负荷与合并冲突面都堆在单文件里。手工把几十个方法搬到别的文件，
 * 一定会出错（漏方法、丢注释、把 this 写坏），所以要靠「解析 + 原样搬运」。
 *
 * 做法：解析 `Page(SafePage({ ... }))` 里的成员边界（含紧贴其上的注释），
 * 按 spec 把成员原样搬到指定模块，并把页面文件重写成「保留成员 + 组装尾部」。
 * 方法体一个字符都不改 —— 只换住所，这样 `this` 语义、WXML 绑定名都不动。
 *
 * 用法（一次性重构脚本，不进回归链）：
 *   node tools/dev/page-split.mjs pages/plan/plan.js /tmp/spec.json
 *
 * spec.json:
 * {
 *   "pageHeader": "…页面文件新的头部…",
 *   "pageTail":   "…组装与收尾（Page(SafePage(Object.assign(...))) 的右半边）…",
 *   "drop": ["_planSig"],        // 重名死代码：删掉靠前那份（同名后者才是生效实现）
 *   "modules": [ { "file": "pages/plan/p-render.js", "header": "…", "members": ["_render", …] } ]
 * }
 */
import fs from "fs";

const PAGE = process.argv[2];
const SPEC = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const src = fs.readFileSync(PAGE, "utf8");
const lineOf = (idx) => src.slice(0, idx).split("\n").length;

/** 成员上方的连续注释行属于该成员，一起搬走（遇到空行或非注释行就停） */
function commentStart(s, keyOff, floor) {
  let p = keyOff;
  for (;;) {
    const prevNl = s.lastIndexOf("\n", p - 1);
    if (prevNl < 0) return p;
    const prevLineStart = s.lastIndexOf("\n", prevNl - 1) + 1;
    if (prevLineStart < floor) return p;
    const t = s.slice(prevLineStart, prevNl).trim();
    if (t === "" || !/^(\/\/|\/\*|\*)/.test(t)) return p;
    p = prevLineStart;
  }
}

/** 解析 `Page(SafePage({ ... }))` 的成员：名字 / 起始偏移（含注释）/ 结束偏移 */
function parseMembers(s) {
  const m0 = /SafePage\(\s*(?:Object\.assign\()?\{|Page\(\s*(?:Object\.assign\()?\{/.exec(s);
  if (!m0) throw new Error("找不到 Page(SafePage({...}))");
  const objStart = s.indexOf("{", m0.index);
  let i = objStart, depth = 0, inS = null;
  const out = [];
  let lastKey = null, lastKeyOff = 0, floor = objStart + 1;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inS) { if (c === "\\") { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i++; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 1 && lastKey) {
        out.push({ k: lastKey, start: commentStart(s, lastKeyOff, floor), end: i + 1 });
        floor = i + 1;
        lastKey = null;
      }
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

const members = parseMembers(src);
for (const m of members) {
  m.text = src.slice(m.start, m.end);
  if (!m.text.trimEnd().endsWith(",")) m.text = m.text.trimEnd() + ",";
}

const pool = new Map();            // name -> [member…]，顺序即源码顺序
for (const m of members) {
  if (!pool.has(m.k)) pool.set(m.k, []);
  pool.get(m.k).push(m);
}

/** 取走一个成员（同名多份时默认取最后一份 = 实际生效的那份） */
function take(name, which = "last") {
  const list = pool.get(name);
  if (!list || !list.length) throw new Error("成员不存在（或已被取走）: " + name);
  const m = which === "first" ? list.shift() : list.pop();
  m.taken = true;
  return m;
}

/* ── 0) 重名死代码：同名成员里靠前的那些从未生效，随拆分一起清掉 ── */
for (const name of SPEC.drop || []) {
  const list = pool.get(name) || [];
  if (list.length < 2) throw new Error("drop 要求该名字至少 2 个定义（否则不是在删死代码）: " + name);
  while (list.length > 1) {
    const dead = list.shift();
    dead.taken = true;   // 必须标记：否则死代码会被当成「未安排去处」的保留成员写回页面文件
    const why = dead.text.split("\n").length;
    console.log("  删除重名死代码 " + name + " @ 行 " + lineOf(dead.start) + "（" + why + " 行；同名后者才是生效实现）");
  }
}

/* ── 1) 写模块文件 ── */
for (const mod of SPEC.modules) {
  const parts = mod.members.map((n) => take(n).text);
  const text = [mod.header.trimEnd(), "", "module.exports = {", parts.join("\n\n"), "};", ""].join("\n");
  const lines = text.split("\n").length - 1;
  if (lines > 800) throw new Error(mod.file + " 有 " + lines + " 行，超过 800 行验收线，拆分粒度不够");
  fs.writeFileSync(mod.file, text);
  console.log("  写出 " + mod.file + "：成员 " + mod.members.length + " 个 / " + lines + " 行");
}

/* ── 2) 重写页面文件：未搬走的成员按源码顺序保留 ── */
const kept = members.filter((m) => !m.taken);
const names = kept.map((m) => m.k);
if (new Set(names).size !== names.length) throw new Error("保留区仍有重名成员：" + names.join(","));
const pageSrc = [
  SPEC.pageHeader.trimEnd(),
  "",
  kept.map((m) => m.text).join("\n"),
  SPEC.pageTail.trimEnd(),
  ""
].join("\n").replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(PAGE, pageSrc);
console.log("  重写 " + PAGE + "：" + pageSrc.split("\n").length + " 行 / 保留成员 " + kept.length + " 个");
console.log("  保留：" + names.join(" "));
