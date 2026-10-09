// 辅助脚本：dump 指定城市的现有景点（写补丁前避重）
// 用法: node tools/tmp-dump.js 湖州 珠海 上饶
const D = require("../utils/data.js");
const m = new Map(D.CITIES.map(c => [c.name, c]));
for (const n of process.argv.slice(2)) {
  const c = m.get(n);
  if (!c) { console.log("=== " + n + " === 城市不存在"); continue; }
  const ex = c.experiences || [];
  console.log("=== " + n + " (" + ex.length + ") ===");
  console.log(ex.map(e => e.name).join("、"));
}
