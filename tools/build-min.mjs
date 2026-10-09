// 主包瘦身：把 utils/ 下的逻辑 JS 用 terser 压缩（保留原文件到 tools/_src-backup/）
// 背景：微信主包上限 2048KB，data-packed.js 是硬大头改不动，只能从源码侧挤空间。
// 安全性：terser 默认不 mangle module.exports 对象的属性名，页面 T.xxx 调用不受影响。
//         allcheck.sh 会在压缩后全量回归，能验证功能无损。
// 用法：node tools/build-min.mjs        （幂等：每次都从 _src-backup 源码重新压缩）
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const terser = req("terser");

const TARGETS = ["travel", "planner", "pako-inflate", "weather", "store", "toolkit-groups"];

async function main() {
  let saved = 0;
  for (const name of TARGETS) {
    const srcPath = path.join("tools", "_src-backup", name + ".js");
    const dstPath = path.join("utils", name + ".js");
    if (!fs.existsSync(srcPath)) {
      console.log("跳过（无备份源码）:", name);
      continue;
    }
    const src = fs.readFileSync(srcPath, "utf8");
    const res = await terser.minify(src, { compress: true, mangle: true, format: { comments: false } });
    if (res.error) {
      console.error("压缩失败:", name, res.error.message);
      process.exit(1);
    }
    const before = Buffer.byteLength(src, "utf8");
    const after = Buffer.byteLength(res.code, "utf8");
    saved += before - after;
    fs.writeFileSync(dstPath, res.code, "utf8");
    console.log(
      name.padEnd(16),
      (before / 1024).toFixed(0) + "K -> " + (after / 1024).toFixed(0) + "K  省 " + ((before - after) / 1024).toFixed(0) + "K"
    );
  }
  console.log("合计节省: " + (saved / 1024).toFixed(0) + "K");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
