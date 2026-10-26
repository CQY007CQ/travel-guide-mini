#!/usr/bin/env node
// tools/bump-version.mjs —— 版本号单一真源发版
// 把版本号这一件事收口到一处：改 _src-backup/travel.js 的 APP_VER → 同步 project.config.json 的 version
// → 重新 build-min 让产物 utils/travel.js 自动带上新版本号（splash / more 页的 T.APP_VER 自动跟随）。
// 用法: node tools/bump-version.mjs <x.y.z>
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
const ROOT = process.cwd();
const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+$/.test(v)) {
  console.error("用法: node tools/bump-version.mjs <x.y.z>   例如 1.19.105");
  process.exit(1);
}

// 1) 真源 _src-backup/travel.js 的 APP_VER
const srcPath = ROOT + "/tools/_src-backup/travel.js";
let s = readFileSync(srcPath, "utf8");
if (!/APP_VER\s*=/.test(s)) { console.error("未在 _src-backup/travel.js 找到 APP_VER"); process.exit(1); }
s = s.replace(/APP_VER\s*=\s*["'][\d.]+["']/, 'APP_VER = "' + v + '"');
writeFileSync(srcPath, s, "utf8");
console.log("✓ _src-backup/travel.js  APP_VER → " + v);

// 2) project.config.json 增加/更新 version（微信开发者工具上传时展示的版本号，单一真源外的同步展示）
const pcPath = ROOT + "/project.config.json";
let pc = readFileSync(pcPath, "utf8");
if (!/"version"\s*:/.test(pc)) {
  pc = pc.replace(/("projectname"\s*:\s*"[^"]*")/, '$1,\n  "version": "' + v + '"');
  writeFileSync(pcPath, pc, "utf8");
  console.log("✓ project.config.json  新增 version → " + v);
} else {
  pc = pc.replace(/"version"\s*:\s*"[\d.]+"/, '"version": "' + v + '"');
  writeFileSync(pcPath, pc, "utf8");
  console.log("✓ project.config.json  version → " + v);
}

// 3) 同步产物 utils/travel.js 的 APP_VER：优先用 build-min 全量压缩；terser 未安装时退化为直接同步版本号字符串
try {
  console.log("▶ 重新 build-min ...");
  execFileSync(process.execPath, ["tools/build-min.mjs"], { stdio: "inherit", cwd: ROOT });
} catch (e) {
  console.log("⚠️ build-min 失败（可能 terser 未安装），退化为直接同步版本号到产物 utils/travel.js");
  const outPath = ROOT + "/utils/travel.js";
  let out = readFileSync(outPath, "utf8");
  out = out.replace(/APP_VER\s*=\s*["'][\d.]+["']/, 'APP_VER="' + v + '"');
  writeFileSync(outPath, out, "utf8");
  console.log("✓ utils/travel.js  APP_VER → " + v + "（直接同步）");
}

// 4) 校验产物确实带上了新版本号
const out = readFileSync(ROOT + "/utils/travel.js", "utf8");
const ok = out.includes('APP_VER="' + v + '"') || out.includes("APP_VER='" + v + "'");
if (!ok) { console.error("⚠️ 产物 utils/travel.js 未检测到新版本号，请检查 build-min"); process.exit(1); }

console.log("✅ 版本号已统一为 " + v + "（真源 _src-backup + 产物 utils + project.config.json）");
