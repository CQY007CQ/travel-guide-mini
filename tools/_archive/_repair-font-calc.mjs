// 修复 _apply-font-calc.mjs 的 bug：它把 `font-size: Nrpx` 替换成了「裸」的
// `calc(Nrpx * var(--fs, 1))`（少了 `font-size:` 前缀），WXSS 解析器会整体丢弃该声明。
// 本脚本给所有「不是 font-size: 值」的裸 calc(Nrpx * var(--fs, 1)) 补回 `font-size: ` 前缀。
// 幂等：已带 `font-size:` 前缀的不会重复加。
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

// 匹配裸 calc(Nrpx * var(--fs, 1))：它前面不能紧跟着 `font-size:` + 空白。
// 用负向后行断言排除已经正确写好的 `font-size: calc(...)`。
const re = /(?<!font-size:\s)calc\(([\d.]+)rpx \* var\(--fs, 1\)\)/g;

let total = 0;
for (const f of FILES) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) { console.log("缺失（跳过）:", f); continue; }
  let s = fs.readFileSync(p, "utf8");
  let n = 0;
  s = s.replace(re, (m) => {
    n++; total++;
    return "font-size: " + m;
  });
  fs.writeFileSync(p, s, "utf8");
  console.log(String(n).padStart(4), f);
}
console.log("合计修复:", total, "处裸 calc（已补回 font-size: 前缀）");
