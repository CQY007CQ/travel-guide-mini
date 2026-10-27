// v1.19.2 修复：wx.showToast 在 icon:"success" 下最多显示约 7 个汉字，含变量的长文案必被截断。
// 统一改为 icon:"none"（无图标时可完整显示多行文本）。
// 严格断言：每条替换必须恰好命中 1 次，否则整体放弃写入，避免误改。
import fs from "fs";

const EDITS = {
  "pages/ledger/ledger.js": [
    ['{ title: "已加入 " + n, icon: "success" }', '{ title: "已加入 " + n, icon: "none" }'],
    ['{ title: "已记 ¥" + cny + " · " + p.cat, icon: "success" }', '{ title: "已记 ¥" + cny + " · " + p.cat, icon: "none" }'],
    ['? "已记 借出 ¥" + amt : "已记 借入 ¥" + amt, icon: "success" }', '? "已记 借出 ¥" + amt : "已记 借入 ¥" + amt, icon: "none" }'],
    ['{ title: "已记一笔（¥" + cny + "）", icon: "success" }', '{ title: "已记一笔（¥" + cny + "）", icon: "none" }']
  ],
  "pages/more/more.js": [
    ['{ title: "已生成，去看看吧", icon: "success" }', '{ title: "已生成，去看看吧", icon: "none" }'],
    ['{ title: "已恢复行程与 " + r.count + " 组数据 ✓", icon: "success" }', '{ title: "已恢复行程与 " + r.count + " 组数据 ✓", icon: "none" }'],
    ['{ title: "已并入 " + addN + " 个想玩", icon: "success" }', '{ title: "已并入 " + addN + " 个想玩", icon: "none" }']
  ],
  "pages/index/index.js": [
    ['{ title: "已生成「" + it.name + "」攻略", icon: "success" }', '{ title: "已生成「" + it.name + "」攻略", icon: "none" }']
  ],
  "pages/plan/plan.js": [
    ['{ title: "已记下这座城的经验", icon: "success" }', '{ title: "已记下这座城的经验", icon: "none" }'],
    ['{ title: "已复制第 " + (di + 1) + " 天安排", icon: "success" }', '{ title: "已复制第 " + (di + 1) + " 天安排", icon: "none" }'],
    ['{ title: "已复制出行前体检摘要", icon: "success" }', '{ title: "已复制出行前体检摘要", icon: "none" }']
  ],
  "pages/today/today.js": [
    ['{ title: "已记 ¥" + amt + " · " + cat, icon: "success" }', '{ title: "已记 ¥" + amt + " · " + cat, icon: "none" }']
  ]
};

let failures = [];
const out = {};
for (const [file, pairs] of Object.entries(EDITS)) {
  let src = fs.readFileSync(file, "utf8");
  let hits = 0;
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    if (n !== 1) { failures.push(`${file}: 期望命中 1 次，实际 ${n} 次 → ${from.slice(0, 45)}`); continue; }
    src = src.replace(from, to);
    hits++;
  }
  out[file] = src;
  console.log(`${file}: ${hits}/${pairs.length} 处替换`);
}

if (failures.length) {
  console.error("\n❌ 存在未命中项，已放弃全部写入：");
  failures.forEach(f => console.error("   " + f));
  process.exit(1);
}
for (const [file, src] of Object.entries(out)) fs.writeFileSync(file, src);
console.log("\n✅ 全部替换成功并写入");
