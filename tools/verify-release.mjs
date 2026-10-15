#!/usr/bin/env node
// tools/verify-release.mjs
// 发布安全门禁（P0-2 落地）：把「数据分包被静默剥离 → 线上无城市残包」这条最严重的
// 静默灾难型 footgun，从「上传后人工盯尺寸表」升级为 fail-fast 自动门禁。
// 无需 IDE / 网络：纯读盘 + Node 同步加载 utils/data.js。可由 allcheck 每轮执行。
//
// 背景：project.config.json 的 ignoreUploadUnusedFiles=true 时，微信上传器会按静态分析
// 剥离「未静态引用」的文件。数据块靠 _manifest.js 的静态 require.async 提示 + utils/data.js
// 的静态字面量保命。一旦任一处回归（漏字面量 / 删提示 / 块变空），线上就会变成没有城市的
// 10KB 残包，而编译期零报错。本脚本在发布前把它拦下来。
import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`);
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? "  " + extra : ""}`); }
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// 0. 危险组合开关
let ignoreUnused = false;
try {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, "project.config.json"), "utf8"));
  ignoreUnused = !!(cfg && cfg.setting && cfg.setting.ignoreUploadUnusedFiles);
} catch (e) { ok("project.config.json 可读", false, e.message); }
console.log(`ignoreUploadUnusedFiles = ${ignoreUnused}`);

// 1. 数据清单存在且非空
const manifestPath = resolve(ROOT, "subdata/data/_manifest.js");
ok("数据清单 _manifest.js 存在", existsSync(manifestPath));
const manifestSrc = readFileSync(manifestPath, "utf8");
const mArr = manifestSrc.match(/module\.exports\s*=\s*\[([\s\S]*?)\]/);
const chunks = mArr ? (mArr[1].match(/["'][^"']+["']/g) || []).map((s) => s.slice(1, -1)) : [];
ok("manifest 列出数据分块 (≥1)", chunks.length >= 1, `块数=${chunks.length}`);

// 2. manifest 静态 require.async 提示数 == 块数
const hintCount = (manifestSrc.match(/require\.async\(/g) || []).length;
ok("manifest 含静态 require.async 提示且数量==块数", hintCount === chunks.length,
   `提示=${hintCount} 块=${chunks.length}`);
ok("ignoreUploadUnusedFiles=true 必须靠静态提示保数据", !ignoreUnused || hintCount >= 1);

// 3. utils/data.js 内 require.async 全为静态字面量，且数量 == 块数
const dataSrc = strip(readFileSync(resolve(ROOT, "utils/data.js"), "utf8"));
const literals = [...dataSrc.matchAll(/require\.async\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const stripped = dataSrc.replace(/require\.async\(\s*["'][^"']+["']\s*\)/g, "");
const hasVarCall = /require\.async\(\s*[^"'\s)]/.test(stripped);
ok("utils/data.js 的 require.async 均为静态字面量（无变量）", literals.length >= 1 && !hasVarCall,
   `字面量=${literals.length}`);
ok("data.js 字面量数 == 数据块数", literals.length === chunks.length,
   `字面量=${literals.length} 块=${chunks.length}`);

// 4. 每个数据分块文件存在且非平凡大小（>10KB，远小于此即残包/空）
let totalBytes = 0;
for (const p of chunks) {
  const fp = resolve(ROOT, "utils", p); // p 相对 utils/（与 data.js 同级）
  const ex = existsSync(fp);
  const sz = ex ? statSync(fp).size : 0;
  totalBytes += sz;
  ok(`数据分块存在且 >10KB: ${p}`, ex && sz > 10 * 1024, ex ? `${Math.round(sz / 1024)}KB` : "缺失");
}

// 5. 真在 Node 同步加载出健康数据（证明“将随包发布的数据”非残包）
try {
  const D = require(resolve(ROOT, "utils/data.js"));
  const cities = (D.CITIES || []).length;
  const exp = (D.CITIES || []).reduce((s, c) => s + (c.experiences ? c.experiences.length : 0), 0);
  ok("加载后 CITIES ≥ 232（非残包）", cities >= 232, `CITIES=${cities}`);
  ok("加载后 experiences ≥ 1300（非残包）", exp >= 1300, `experiences=${exp}`);
} catch (e) {
  ok("数据可在 Node 同步加载", false, e.message);
}

console.log(`\n数据分包体量：${(totalBytes / 1024 / 1024).toFixed(2)} MB / ${chunks.length} 块`);
if (fail) console.log("\n❌ 发布门禁失败 —— 请勿上传，先修复上面的 FAIL");
else console.log("\n✅ 发布门禁通过：数据分包确认随包发布，可放心上传");
process.exit(fail ? 1 : 0);
