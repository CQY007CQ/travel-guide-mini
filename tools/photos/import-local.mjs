// tools/photos/import-local.mjs —— 离线导入「你已有授权的」真实景点照片
//
// 用途：Wikimedia Commons 不可达时的等价通道。你把确认过授权的图片放进
//       tools/photos/inbox/，本脚本生成 cache + manifest，后续照常走
//       upload-cloud.mjs → build-map.mjs → ENABLED=true。
//
// 用法（--credit / --license 必填，缺一即拒绝，版权红线）：
//   node tools/photos/import-local.mjs --credit "张三" --license "CC BY-SA 4.0"
//   node tools/photos/import-local.mjs --credit "本人拍摄" --license "自有版权" --src "https://example.com/license"
//
// 文件名规则：
//   故宫.jpg                    → 景点「故宫」，城市留空
//   北京_故宫.jpg                → 城市「北京」，景点「故宫」
//   支持 .jpg / .jpeg / .png（png 会原样保留扩展名，云存储按原名上传）
//
// 合规：不猜测授权、不补全作者、不把「来源不明」当成可用；授权信息由你显式提供并随条目保存。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const INBOX = path.join(OUT, "inbox");
const CACHE = path.join(OUT, "cache");
const MANIFEST = path.join(OUT, "manifest.json");
const ROOT = path.resolve(OUT, "../..");

function arg(name, def) {
  const eq = process.argv.find(a => a.startsWith("--" + name + "="));
  if (eq) return eq.split("=").slice(1).join("=");
  const i = process.argv.indexOf("--" + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return def;
}
const credit = String(arg("credit", "")).trim();
const license = String(arg("license", "")).trim();
const src = String(arg("src", "")).trim();
if (!credit || !license) {
  console.error("拒绝导入：必须显式提供 --credit（作者）与 --license（授权）。");
  console.error("理由：不猜测授权、不把来源不明图片当可用；这两项会随条目保存并在 App 内署名展示。");
  process.exit(1);
}

function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return def; } }
const sha = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const files = fs.readdirSync(INBOX).filter(f => /\.(jpe?g|png)$/i.test(f));
if (!files.length) {
  console.error("inbox/ 为空：把确认过授权的图片放进来再跑（当前已创建空目录 " + path.relative(ROOT, INBOX) + "）");
  process.exit(1);
}

const manifest = readJSON(MANIFEST, []);
const have = new Set(manifest.map(m => m.key));
let added = 0, skipped = 0, bad = 0;

for (const f of files) {
  const base = f.replace(/\.(jpe?g|png)$/i, "");
  const parts = base.split("_");
  const city = parts.length > 1 ? parts.shift().trim() : "";
  const name = parts.join("_").trim();
  if (!name) { console.error("跳过（无法解析景点名）：" + f); bad++; continue; }
  const key = name + "|" + city;

  const srcPath = path.join(INBOX, f);
  const buf = fs.readFileSync(srcPath);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if ((!isJpeg && !isPng) || buf.length < 2000) { console.error("跳过（非有效图片或过小）：" + f); bad++; continue; }
  if (have.has(key)) { skipped++; continue; }

  const ext = isPng ? ".png" : ".jpg";
  const outName = sha(key) + ext;
  fs.copyFileSync(srcPath, path.join(CACHE, outName));
  manifest.push({
    key, name, city, file: outName,
    credit, license, src: src || "", page: src || "",
    origin: "local-import"
  });
  have.add(key);
  added++;
  console.log("  + " + (city ? city + " / " : "") + name + " → " + outName);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("导入完成：新增 " + added + " | 已存在跳过 " + skipped + " | 无效 " + bad);
console.log("manifest 累计 " + manifest.length + " 条 | 署名：" + credit + " / " + license);
console.log("下一步：node tools/photos/upload-cloud.mjs → node tools/photos/build-map.mjs --prefix <cloud://前缀> --enable");
