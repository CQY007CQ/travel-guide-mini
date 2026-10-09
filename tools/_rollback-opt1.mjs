// 紧急回滚：批次1 中误用了已存在的 CAP 对象（它是「存储配额表」，键是 storage key，
// 不含 FOOT_SPOTS/NOTES），导致 CAP.FOOT_SPOTS === undefined：
//   - keys.length > undefined 恒为 false → 足迹永不裁剪（无限增长）
//   - list.slice(-undefined) = slice(NaN) → 手记被清空（数据丢失）
// 这里改回内联常量，但保留「足迹超限时真正裁剪」的逻辑修正（原三元两侧相同，等于没裁剪）。
import fs from "fs";

const file = "tools/_src-backup/travel.js";
let s = fs.readFileSync(file, "utf8");

const pairs = [
  // 足迹：超限时先置空再回填（原代码三元两侧都是 sp，超限并没有真正裁剪）
  [`  const foot = { spots: keys.length > CAP.FOOT_SPOTS ? {} : sp, cities: o.foot.cities || {} };`,
   `  // v1.19.8：原写法 spots 三元两侧都是 sp，超限并没有真正裁剪；改为超限时先置空再回填最近 2000 条\n  const foot = { spots: keys.length > 2000 ? {} : sp, cities: o.foot.cities || {} };`],
  [`  if (keys.length > CAP.FOOT_SPOTS) {`, `  if (keys.length > 2000) {`],
  [`  if (ks.length > CAP.FOOT_SPOTS) {`, `  if (ks.length > 2000) {`],
  // 手记：恢复为 200（slice(-undefined) 会清空数组，属数据丢失）
  [`  store.set(NOTES_KEY, list.slice(-CAP.NOTES));`, `  store.set(NOTES_KEY, list.slice(-200));`]
];

let ok = 0, miss = 0;
for (const [from, to] of pairs) {
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log(`命中 ${n} 次(期望1) → 跳过: ${from.slice(0, 60)}`); miss++; continue; }
  s = s.replace(from, to);
  ok++;
}
fs.writeFileSync(file, s, "utf8");
console.log(`\n回滚完成：${ok} 处修正，${miss} 处跳过`);

// 自检：文件中不得再出现误用常量
const left = (s.match(/CAP\.(FOOT_SPOTS|NOTES|LEDGER|IOU|IMPORT_MAX|WISH|RECENT)/g) || []);
console.log(left.length ? "❌ 仍有残留: " + [...new Set(left)].join(",") : "✅ 无残留误用常量");
process.exit(left.length ? 1 : 0);
