// 给每个页面 JS 注入：① data 里加 fz:1（默认档）② onShow 开头同步 this.setData({ fz: T.fontScale() })
// 这样从「更多 / 指南」改完字号返回任意页都会即时生效。脚本只动 Page 的 data 与 onShow 首个匹配。
import fs from "fs";
import path from "path";

const FILES = [
  "pages/index/index.js",
  "pages/today/today.js",
  "pages/plan/plan.js",
  "pages/more/more.js",
  "subpkg/assistant/assistant.js",
  "subpkg/prep/prep.js",
  "subpkg/ledger/ledger.js",
  "subpkg/map/map.js",
  "subpkg/food/food.js",
  "subpkg/toolkit/toolkit.js",
  "subdata/boost/boost.js"
];

// 仅匹配第一个 data: {（Page 的 data），避免命中函数内的 wx.request data 等
const dataRe = /data:\s*\{/;
// 匹配 onShow(...) { 开头
const showRe = /onShow\s*\([^)]*\)\s*\{/;

for (const f of FILES) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) { console.log("缺失:", f); continue; }
  let s = fs.readFileSync(p, "utf8");
  let changed = [];

  // 1) data 注入 fz:1（若已有 fz 则跳过，避免重复键）
  if (!/\bfz\s*:/.test(s)) {
    s = s.replace(dataRe, (m) => {
      changed.push("data");
      return m + "\n    fz: 1,";
    });
  }
  // 2) onShow 开头同步 fz（若已有 T.fontScale 同步则跳过）
  if (!/T\.fontScale\(\)/.test(s)) {
    s = s.replace(showRe, (m) => {
      changed.push("onShow");
      return m + "\n    this.setData({ fz: T.fontScale() });";
    });
  }
  fs.writeFileSync(p, s, "utf8");
  console.log(f.padEnd(34), changed.join("+") || "(无变化)");
}
