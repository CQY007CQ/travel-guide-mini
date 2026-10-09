// 分包体积体检：按微信「每个分包独立 2MB 红线」逐包核算 gzip 体积。
// 旧版 allcheck 把全项目（含 1.7MB 数据分包）累加成一个数去比对 2MB，
// 必然误报；真实约束是【主包 + 每个分包各自 ≤ 2MB 压缩后】，总包体可超 20MB。
// 用法：node tools/check-pkgsize.mjs
import fs from "fs";
import path from "path";
import zlib from "zlib";

const EXC = new Set(["tools", "shots", ".qr", "outputs", "node_modules", ".git", ".workbuddy"]);
// 真正会进微信包的源码扩展名（文档/脚本/配置不计入包体）
const SRC_EXT = /\.(js|wxml|wxss|json|wxs|png|jpe?g|gif|svg|ttf|woff2?)$/i;

const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
const subs = (app.subPackages || app.subpackages || []).map((s) => s.root.replace(/\/+$/, ""));
const isSub = (p) => subs.some((r) => p === r || p.startsWith(r + "/"));
const subOf = (p) => subs.find((r) => p === r || p.startsWith(r + "/"));

const pkgs = { __main__: { raw: 0, gzip: 0 } };
subs.forEach((r) => (pkgs[r] = { raw: 0, gzip: 0 }));

function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "." || e.name === "..") continue;
    if (EXC.has(e.name)) continue;
    const p = path.join(d, e.name);
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { walk(p, r); continue; }
    if (!SRC_EXT.test(e.name)) continue; // 只统计真正进包的源码
    if (e.name === "project.config.json") continue; // 不上传进包
    const b = fs.statSync(p).size;
    const g = zlib.gzipSync(fs.readFileSync(p)).length;
    const key = isSub(r) ? subOf(r) : "__main__";
    pkgs[key].raw += b;
    pkgs[key].gzip += g;
  }
}
walk(process.cwd(), "");

const HARD = 2048; // 微信每包压缩后 2MB 硬上限
const WARN = 1850; // 黄色预警区
let bad = 0;
const order = ["__main__", ...subs];
for (const k of order) {
  const g = Math.round(pkgs[k].gzip / 1024);
  const raw = Math.round(pkgs[k].raw / 1024);
  const tag = k === "__main__" ? "主包" : "分包 " + k;
  if (g > HARD) {
    console.log(`  [fail] ${tag} gzip=${g}KB / raw=${raw}KB 超 ${HARD}KB 红线!`);
    bad++;
  } else if (g > WARN) {
    console.log(`  [warn] ${tag} gzip=${g}KB / raw=${raw}KB 进入黄色区(> ${WARN}KB)`);
  } else {
    console.log(`  [ok]   ${tag} gzip=${g}KB / raw=${raw}KB`);
  }
}
if (bad) {
  console.log(`  ✗ ${bad} 个包超红线`);
  process.exit(2);
}
console.log("  ✓ 全部包体在 2MB 红线内");
