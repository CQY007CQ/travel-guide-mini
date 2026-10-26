#!/usr/bin/env node
// tools/pre-upload.mjs —— 上传前发布门禁（P3.8）
// 在微信开发者工具「上传」之前跑这道关，把最危险的「静默灾难」挡在上传之前：
//   1) 先重新 build-min，确保产物与 _src-backup 真源一致（防止改了源码忘了压缩）；
//      terser 未装（如本机沙盒）时退化为直接同步版本号到产物，不阻塞门禁。
//   2) 再跑 verify-release，确保数据分包随包发布（不会被 ignoreUploadUnusedFiles 静默剥离成 10KB 残包）。
// 任一不通过 → 退出码 1，禁止上传。
// 用法: node tools/pre-upload.mjs
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
const ROOT = process.cwd();
function runBuild() {
  console.log("\n▶ build-min（同步产物到真源）");
  try {
    execFileSync(process.execPath, ["tools/build-min.mjs"], { stdio: "inherit", cwd: ROOT });
    return true;
  } catch (e) {
    // terser 未装时退化为直接同步 APP_VER 到产物（版本号单一真源不被破坏）
    try {
      const v = readFileSync(ROOT + "/tools/_src-backup/travel.js", "utf8").match(/APP_VER\s*=\s*["']([\d.]+)["']/)[1];
      const outPath = ROOT + "/utils/travel.js";
      let out = readFileSync(outPath, "utf8");
      out = out.replace(/APP_VER\s*=\s*["'][\d.]+["']/, 'APP_VER="' + v + '"');
      writeFileSync(outPath, out, "utf8");
      console.log("⚠️ build-min 失败（terser 未安装），已退化为直接同步版本号 " + v + " 到产物");
      return true;
    } catch (e2) {
      console.error("✗ build-min 失败且无法退化同步:", e2 && e2.message);
      return false;
    }
  }
}
function runVerify() {
  console.log("\n▶ verify-release（数据分包必随包发布）");
  try {
    execFileSync(process.execPath, ["tools/verify-release.mjs"], { stdio: "inherit", cwd: ROOT });
    return true;
  } catch (e) {
    console.error("✗ verify-release 失败");
    return false;
  }
}
if (!runBuild()) process.exit(1);
if (!runVerify()) {
  console.error("\n❌ 发布门禁未通过 —— 禁止上传！先修复上面的问题再点「上传」。");
  process.exit(1);
}
console.log("\n✅ 发布门禁通过 —— 可安全在微信开发者工具点「上传」。");
process.exit(0);

