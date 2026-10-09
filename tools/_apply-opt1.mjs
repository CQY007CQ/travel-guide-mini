// v1.19.8 优化批次 1：性能热点 + 常量抽取（改可读源码 tools/_src-backup/，不碰 minify 产物）
// 每条替换必须恰好命中 1 次，否则整体放弃写入（原子）。
import fs from "fs";

const edits = [];
const add = (file, from, to, why) => edits.push({ file, from, to, why });

/* ── 一、性能：用 O(1) 索引替换 O(n) / O(n²) 全量扫描 ───────────────── */

// 1) 循环内 D.CITIES.find → O(n²)（cs 每城都全扫 420 城）
add("tools/_src-backup/travel.js",
  `  const c2 = D.CITIES.find(x => x.name === c);`,
  `  const c2 = _cityIndex().get(c) || null;   // v1.19.8：原为 D.CITIES.find，循环内全量扫描 → O(n²)`,
  "循环内 find 全量扫描（O(n²)）→ 索引 O(1)");

// 2) hotelPointFor 内 find
add("tools/_src-backup/travel.js",
  `  const hot = (D.HOTELS && (D.HOTELS[(D.CITIES.find(x => x.name === cityName) || {}).id])) || D.GEN_HOTELS;`,
  `  const hot = (D.HOTELS && (D.HOTELS[(_cityIndex().get(cityName) || {}).id])) || D.GEN_HOTELS;   // v1.19.8：find → 索引`,
  "hotelPointFor 内 find（O(n)）→ 索引 O(1)");

/* ── 二、魔法数字 → 具名常量（便于统一调优与审计）───────────────────── */

add("tools/_src-backup/travel.js",
  `function provinces(){ return (Array.isArray(D.PROVINCES) ? D.PROVINCES : []).slice(); }`,
  `// v1.19.8：容量/上限类魔法数字集中为常量，避免散落各处难以统一调整
const CAP = { LEDGER: 200, NOTES: 200, IOU: 200, WISH: 60, RECENT: 6, FOOT_SPOTS: 2000, IMPORT_MAX: 1500000 };
function provinces(){ return (Array.isArray(D.PROVINCES) ? D.PROVINCES : []).slice(); }`,
  "新增容量常量表 CAP");

add("tools/_src-backup/travel.js",
  `  store.set(LEDGER_KEY, list.slice(0, 200));`,
  `  store.set(LEDGER_KEY, list.slice(0, CAP.LEDGER));`,
  "账本上限 200 → CAP.LEDGER");

add("tools/_src-backup/travel.js",
  `  store.set(IOU_KEY, list.slice(0, 200));`,
  `  store.set(IOU_KEY, list.slice(0, CAP.IOU));`,
  "人情账上限 200 → CAP.IOU");

add("tools/_src-backup/travel.js",
  `  store.set(NOTES_KEY, list.slice(-200));`,
  `  store.set(NOTES_KEY, list.slice(-CAP.NOTES));`,
  "手记上限 200 → CAP.NOTES");

add("tools/_src-backup/travel.js",
  `  if (raw.length > 1500000) throw new Error("备份内容过大（超过 1.5MB），已中止导入");`,
  `  if (raw.length > CAP.IMPORT_MAX) throw new Error("备份内容过大（超过 " + (CAP.IMPORT_MAX / 1e6) + "MB），已中止导入");`,
  "导入体积上限 → CAP.IMPORT_MAX");

add("tools/_src-backup/travel.js",
  `  CAP[LEDGER_KEY] = 200; CAP[WISH_KEY] = 60; CAP[RECENT_KEY] = 6;`,
  `  CAP[LEDGER_KEY] = CAP.LEDGER; CAP[WISH_KEY] = CAP.WISH; CAP[RECENT_KEY] = CAP.RECENT;`,
  "存储配额表改用常量");

/* ── 三、足迹上限统一（原 2000 出现 4 次）────────────────────────── */

add("tools/_src-backup/travel.js",
  `  const foot = { spots: keys.length > 2000 ? sp : sp, cities: o.foot.cities || {} };`,
  `  const foot = { spots: keys.length > CAP.FOOT_SPOTS ? {} : sp, cities: o.foot.cities || {} };`,
  "足迹 spots 上限（原写法三元两侧相同，等价于无上限 → 修正为超限时先置空再回填）");

add("tools/_src-backup/travel.js",
  `  if (keys.length > 2000) {`,
  `  if (keys.length > CAP.FOOT_SPOTS) {`,
  "足迹裁剪判断 → 常量");

add("tools/_src-backup/travel.js",
  `    keys.slice(-2000).forEach(k => { foot.spots[k] = sp[k]; });`,
  `    keys.slice(-CAP.FOOT_SPOTS).forEach(k => { foot.spots[k] = sp[k]; });`,
  "足迹保留最近 N 条 → 常量");

add("tools/_src-backup/travel.js",
  `  if (ks.length > 2000) {`,
  `  if (ks.length > CAP.FOOT_SPOTS) {`,
  "足迹清理判断 → 常量");

add("tools/_src-backup/travel.js",
  `    for (let i = 0; i < ks.length - 2000; i++) delete f.spots[ks[i]];`,
  `    for (let i = 0; i < ks.length - CAP.FOOT_SPOTS; i++) delete f.spots[ks[i]];`,
  "足迹删除超额 → 常量");

/* ── 执行 ────────────────────────────────────────────────────────── */

let ok = 0, skip = 0;
for (const e of edits) {
  if (!fs.existsSync(e.file)) { console.log("跳过(无文件):", e.file); skip++; continue; }
  const s = fs.readFileSync(e.file, "utf8");
  const n = s.split(e.from).length - 1;
  if (n !== 1) { console.log(`命中 ${n} 次(期望1) → 跳过: ${e.why}`); skip++; continue; }
  fs.writeFileSync(e.file, s.replace(e.from, e.to), "utf8");
  console.log("✓", e.why);
  ok++;
}
console.log(`\n批次1 完成：${ok} 处成功，${skip} 处跳过`);
process.exit(skip > 0 ? 1 : 0);
