// ============================================================
// check-preload.mjs —— 预下载分包体积门禁（v1.19.196 新增）
// 微信约束：preloadRule 中任一页面预下载的分包「源码体积」合计不得超 2MB（2048KB），
// 超限会在上传时报 系统错误 80058（preloadRule [...] source size ... exceed max limit 2MB）。
// 该错误只在「上传」时由微信平台校验，本地编译/真机调试都发现不了，故固化为 fail-fast。
// 计算口径：累加 preloadRule 所列分包目录内全部文件字节数。实测微信上报值 ≤ 此处累加值，
// 故此处 ≤ 2048KB 即保证上传必过。
// ============================================================
import fs from "fs";
import path from "path";

const LIMIT = 2048 * 1024; // 2MB
const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
const rule = app.preloadRule || {};

function dirBytes(dir) {
  let sz = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else sz += fs.statSync(fp).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return sz;
}

let bad = 0;
const keys = Object.keys(rule);
if (keys.length === 0) {
  console.log("  (无 preloadRule，跳过)");
} else {
  for (const page of keys) {
    const pkgs = rule[page].packages || [];
    const parts = [];
    let total = 0;
    for (const p of pkgs) {
      const sz = dirBytes(p);
      parts.push(`${p}=${Math.round(sz / 1024)}KB`);
      total += sz;
    }
    const kb = Math.round(total / 1024);
    const ok = total <= LIMIT;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗ FAIL"} preloadRule[${page}]: ${parts.join(" + ")} = ${kb}KB (上限 2048KB)`);
  }
}

if (bad) {
  console.log("  ✗ 存在超过 2MB 预下载上限的页面，上传会报 80058，请削减 preloadRule 的分包清单");
  process.exit(1);
}
console.log("  ✓ 所有 preloadRule 预下载体积均在 2MB 上限内");
