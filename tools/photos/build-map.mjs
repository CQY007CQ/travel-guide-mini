// tools/photos/build-map.mjs —— 把 manifest + 上传结果编译成 utils/spot-photos.js
//
// 用法：
//   node tools/photos/build-map.mjs --prefix "cloud://env.bucket"             // 生成但保持关闭
//   node tools/photos/build-map.mjs --prefix "cloud://env.bucket" --enable     // 生成并启用
//   node tools/photos/build-map.mjs --enable                                  // 已有 uploaded.json 时用真实 fileID
//
// fileID 优先级：uploaded.json（自动上传得到的真实 ID） > --prefix 拼接 > 跳过该条（绝不编造 ID）。
// 生成后自动 node --check 校验；失败则保留原文件不动。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(OUT, "../..");
const TARGET = path.join(ROOT, "utils", "spot-photos.js");
const MANIFEST = path.join(OUT, "manifest.json");
const UPLOADED = path.join(OUT, "uploaded.json");

function arg(name, def) {
  const p = process.argv.find(a => a.startsWith("--" + name + "="));
  return p ? p.split("=").slice(1).join("=") : def;
}
const PREFIX = String(arg("prefix", "")).replace(/\/+$/, "");
const ENABLE = process.argv.includes("--enable");
function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return def; } }

const manifest = readJSON(MANIFEST, []);
const uploaded = readJSON(UPLOADED, {});
if (!manifest.length) { console.error("manifest.json 为空：先跑 fetch-commons.mjs"); process.exit(1); }

const lines = [];
const lic = {};
let used = 0, noId = 0;
for (const m of manifest) {
  const real = uploaded[m.file] || "";
  const fileID = real || (PREFIX ? PREFIX + "/spots/" + m.file : "");
  if (!fileID) { noId++; continue; }
  if (real && !/^cloud:\/\//.test(real)) { noId++; continue; }
  if (!/^cloud:\/\//.test(fileID)) { noId++; continue; }
  const key = String(m.name || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const city = String(m.city || "");
  const mapKey = city ? key + "|" + city.replace(/"/g, '\\"') : key;
  const credit = String(m.credit || "Wikimedia Commons").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const license = String(m.license || "").replace(/"/g, '\\"');
  const src = String(m.src || m.page || "").replace(/"/g, '\\"');
  lines.push('  "' + mapKey + '": { f: "' + fileID + '", credit: "' + credit + '", license: "' + license + '", src: "' + src + '" }');
  lic[license] = (lic[license] || 0) + 1;
  used++;
}

const out =
  '// utils/spot-photos.js —— 真实景点照片映射（由 tools/photos/build-map.mjs 生成，勿手改）\n' +
  '//\n' +
  '// 图源：Wikimedia Commons，仅收录 CC0 / CC BY / CC BY-SA / Public Domain 许可图片。\n' +
  '// 每条附 credit / license / src，展示端必须显示署名（见 plan.wxml 图片署名入口）。\n' +
  '// 用 cloud:// fileID 而非 https 外链：境外图源域名无法备案、不能进 downloadFile 白名单；\n' +
  '// 随包会撑爆主包（1528KB / 1536KB 线）；云存储域名自动白名单且不占包体。\n' +
  '// 云未开通或图片被删时，渲染层 binderror 兜底回退渐变示意图，零白屏。\n' +
  '\n' +
  'const ENABLED = ' + (ENABLE ? 'true' : 'false') + ';\n' +
  '\n' +
  'const PHOTOS = {\n' + lines.join(',\n') + (lines.length ? '\n' : '') + '};\n' +
  '\n' +
  'function enabled() { return ENABLED; }\n' +
  '\n' +
  'function photoOf(name, city) {\n' +
  '  if (!ENABLED) return null;\n' +
  '  try {\n' +
  '    const n = String(name || "").trim();\n' +
  '    const c = String(city || "").trim();\n' +
  '    if (!n) return null;\n' +
  '    const p = PHOTOS[n + "|" + c] || PHOTOS[n] || null;\n' +
  '    if (!p || !p.f) return null;\n' +
  '    return { fileID: p.f, credit: p.credit || "", license: p.license || "", src: p.src || "" };\n' +
  '  } catch (e) { return null; }\n' +
  '}\n' +
  '\n' +
  'module.exports = { enabled, photoOf, PHOTOS };\n';

// 先写临时文件做语法检查，通过才替换目标（失败不留半成品）
const tmp = path.join(OUT, "_spot-photos.tmp.js");
fs.writeFileSync(tmp, out);
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
} catch (e) {
  fs.unlinkSync(tmp);
  console.error("生成产物语法检查失败，原文件保持不变");
  process.exit(1);
}
fs.copyFileSync(tmp, TARGET);
fs.unlinkSync(tmp);

console.log("manifest " + manifest.length + " 条 → 写入 " + used + " 条映射 | 无 fileID 跳过 " + noId);
console.log("ENABLED = " + (ENABLE ? "true（已启用）" : "false（关闭，真机确认后再 --enable）"));
console.log("许可分布：" + JSON.stringify(lic));
console.log("产物：" + TARGET);
