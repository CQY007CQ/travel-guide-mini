// v1.19.2 回归校验：事件绑定完整性 / 禁用写法 / wx:key / toast 长度
// 独立于修改脚本，作为「改完之后确实没坏」的证据。
import fs from "fs";
import path from "path";

const ROOTS = ["pages", "subpkg"].filter(d => fs.existsSync(d));
const PAGES = [];
for (const root of ROOTS) {
  const dirs = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory());
  for (const d of dirs) PAGES.push({ root, name: d });
}
let problems = 0;
const say = (ok, msg) => { if (!ok) problems++; console.log(`${ok ? "  ok  " : "  ✗   "}${msg}`); };

console.log("【1】WXML 事件绑定 ↔ Page 方法 交叉校验");
for (const p of PAGES) {
  const wxml = path.join(p.root, p.name, `${p.name}.wxml`);
  const js = path.join(p.root, p.name, `${p.name}.js`);
  if (!fs.existsSync(wxml) || !fs.existsSync(js)) continue;
  const w = fs.readFileSync(wxml, "utf8");
  const j = fs.readFileSync(js, "utf8");
  const names = [...new Set([...w.matchAll(/(?:bind|catch)[a-zA-Z]*="([a-zA-Z_$][\w$]*)"/g)].map(m => m[1]))];
  const missing = names.filter(n => !new RegExp(`(^|[\\s,{])${n}\\s*[(:]`, "m").test(j));
  say(missing.length === 0, `${p.root}/${p.name}: 绑定 ${names.length} 个${missing.length ? " → 缺失 " + missing.join(", ") : ""}`);
}

console.log("\n【2】WXML 禁用写法（函数调用 / ?. / ?? / 模板字符串）");
for (const p of PAGES) {
  const wxml = path.join(p.root, p.name, `${p.name}.wxml`);
  if (!fs.existsSync(wxml)) continue;
  const w = fs.readFileSync(wxml, "utf8");
  const hits = [];
  [/\.toFixed\s*\(/, /\.join\s*\(/, /\.map\s*\(/, /\.filter\s*\(/, /\.slice\s*\(/, /\.split\s*\(/, /parseFloat\s*\(/, /\bMath\.[a-z]/, /\?\?/, /\?\./, /\$\{/].forEach(re => {
    if (re.test(w)) hits.push(re.source);
  });
  say(hits.length === 0, `${p.root}/${p.name}: ${hits.length ? "命中 " + hits.join(" | ") : "干净"}`);
}

console.log("\n【3】wx:key=\"index\" 误用（微信的 wx:key 取属性名，不是循环下标）");
let keyBad = 0;
for (const p of PAGES) {
  const wxml = path.join(p.root, p.name, `${p.name}.wxml`);
  if (!fs.existsSync(wxml)) continue;
  const w = fs.readFileSync(wxml, "utf8");
  const n = (w.match(/wx:key="index"/g) || []).length;
  keyBad += n;
}
say(keyBad === 0, `全站剩余 ${keyBad} 处`);

console.log("\n【4】wx:for 与 wx:if 同节点");
let sameNode = 0;
for (const p of PAGES) {
  const wxml = path.join(p.root, p.name, `${p.name}.wxml`);
  if (!fs.existsSync(wxml)) continue;
  const w = fs.readFileSync(wxml, "utf8");
  w.split("\n").forEach(line => {
    if (/<view[^>]*wx:for=[^>]*wx:if=|<view[^>]*wx:if=[^>]*wx:for=/.test(line)) { sameNode++; console.log("       " + p.root + "/" + p.name + ": " + line.trim().slice(0, 90)); }
  });
}
say(sameNode === 0, `全站剩余 ${sameNode} 处`);

console.log("\n【5】showToast：icon 非 none 且含中文标题可能超 7 字被截断");
let toastBad = [];
for (const p of PAGES) {
  const js = path.join(p.root, p.name, `${p.name}.js`);
  if (!fs.existsSync(js)) continue;
  fs.readFileSync(js, "utf8").split("\n").forEach((line, i) => {
    const m = /title:\s*"([^"]*)"[^}]*icon:\s*"(success|loading|error)"/.exec(line);
    if (m) {
      const cn = (m[1].match(/[\u4e00-\u9fa5]/g) || []).length;
      const hasVar = /"\s*\+/.test(line);
      if (cn > 7 && !hasVar) toastBad.push(`${p.root}/${p.name}:${i + 1} 「${m[1]}」${cn} 字`);
    }
    const m2 = /showToast\s*\(\s*\{\s*title:\s*"[^"]*"\s*\+/.exec(line);
    if (m2 && /icon:\s*"(success|loading|error)"/.test(line)) toastBad.push(`${p.root}/${p.name}:${i + 1} 拼接变量且带图标`);
  });
}
toastBad.forEach(t => console.log("       " + t));
say(toastBad.length === 0, `全站剩余 ${toastBad.length} 处`);

console.log("\n【6】app.wxss 暗色补丁是否就位");
const app = fs.readFileSync("app.wxss", "utf8");
["over-line.over", "holi-line.holi-big", "rm-t", "hint-strip.big", "day-load.load-ok", "iou-ok", "w-tag.tp"].forEach(k => say(app.includes(".td ." + k) || app.includes(".td " + k), `暗色覆盖 ${k}`));

console.log(`\n${problems === 0 ? "✅ 全部通过，0 问题" : "❌ 共 " + problems + " 项待处理"}`);
process.exit(problems === 0 ? 0 : 1);
