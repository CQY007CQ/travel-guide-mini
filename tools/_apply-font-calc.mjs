// 全局字号：把每个 `font-size: Nrpx` 改写为 `calc(Nrpx * var(--fs,1))`
// 这样 .fz2 / .fz3 通过覆盖 --fs 即可整体缩放（--fs 定义在 app.wxss 的 .page / .fz* 上）。
// 幂等：已含 calc( / var(--fs 的行跳过。不处理 `page` 元素与 .page 规则（已手动写好）。
import fs from "fs";
import path from "path";

const FILES = [
  "app.wxss",
  "pages/index/index.wxss",
  "pages/more/more.wxss",
  "pages/plan/plan.wxss",
  "pages/today/today.wxss",
  "pages/splash/splash.wxss",
  "subpkg/assistant/assistant.wxss",
  "subdata/boost/boost.wxss",
  "subpkg/food/food.wxss",
  "subpkg/guide/guide.wxss",
  "subpkg/ledger/ledger.wxss",
  "subpkg/map/map.wxss",
  "subpkg/prep/prep.wxss",
  "subpkg/toolkit/toolkit.wxss"
];

// 只匹配 `font-size: <数字>rpx`（允许数字前后空白），不匹配 em / px / % / 0 / 已包 calc|var
const re = /font-size\s*:\s*([\d.]+)\s*rpx/g;

let total = 0;
for (const f of FILES) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) { console.log("缺失（跳过）:", f); continue; }
  let s = fs.readFileSync(p, "utf8");
  let n = 0;
  s = s.replace(re, (m, num) => {
    if (m.includes("var(--fs") || m.includes("calc(")) return m; // 已转换，跳过
    n++; total++;
    return "font-size: calc(" + num + "rpx * var(--fs, 1))";
  });
  fs.writeFileSync(p, s, "utf8");
  console.log(String(n).padStart(4), f);
}
console.log("合计转换:", total, "处");
