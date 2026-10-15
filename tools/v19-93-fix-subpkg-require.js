// tools/v19-93-fix-subpkg-require.js
// v1.19.93：修复 7 个分包页 require 路径层级错误
// 病根：subpkg/xxx/xxx.js 写 require("../../../utils/...")（三级，从小程序根之外解析），
// 标准写法是 "../../utils/..."（两级，对齐 subpkg/rank/rank.js 与官方分包规范）。
// 后果：这些页（map/food/ledger/prep/assistant/guide/toolkit）从首页 quick-bar 和
// 「我的」页有真实入口，路径解析失败即页面白屏——「进入时无法直接进入」类缺陷。
// 微信上传工具链不报错 ≠ 运行时可解析；vm 冒烟（_test-v11993-bootsmoke）在 Node 侧证实。
const fs = require("fs");
const FILES = [
  "subpkg/map/map.js",
  "subpkg/food/food.js",
  "subpkg/ledger/ledger.js",
  "subpkg/prep/prep.js",
  "subpkg/assistant/assistant.js",
  "subpkg/guide/guide.js",
  "subpkg/toolkit/toolkit.js",
];
let totalFixed = 0, bad = 0;
FILES.forEach(f => {
  let s = fs.readFileSync(f, "utf8");
  const before = (s.match(/"\.\.\/\.\.\/\.\.\/utils\//g) || []).length;
  if (before === 0) { console.log("SKIP(无三级路径): " + f); return; }
  s = s.split(String.raw`"../../../utils/`).join(String.raw`"../../utils/`);
  const after = (s.match(/"\.\.\/\.\.\/\.\.\/utils\//g) || []).length;
  if (after !== 0) { console.error("FAIL(仍有残留): " + f); bad++; return; }
  fs.writeFileSync(f, s);
  totalFixed += before;
  console.log("FIXED " + f + " (" + before + " 处)");
});
console.log(bad ? "\n❌ 有文件修复失败" : "\n✅ 共修复 " + totalFixed + " 处路径");
process.exit(bad ? 1 : 0);
