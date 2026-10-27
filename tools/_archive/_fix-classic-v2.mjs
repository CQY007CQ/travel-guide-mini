// 修复「纯就近贪心让当地头牌景点整条被跳过」的问题（v1.19.9 第二版）。
// 背景：第一版给编辑精选前 6 名硬减 300（km）距离，量级荒唐且名次取自「大景点已被 splice 剔除后」
// 的池子 → 西安行程变成秦岭登山游、市中心经典全丢。本版改为「每日经典锚点」。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const edits = [
  {
    from: ` // v1.19.9：记录编辑精选名次（pool 顺序=重要度，越靠前越经典），供 nearest() 给经典景点距离折扣
 pool.forEach((e, i) => { if (e && typeof e === "object" && e._rank === undefined) e._rank = i; });`,
    to: ` // v1.19.9 经典景点保障：编辑精选名次必须取自 city.experiences 的原始顺序（人工编排，越靠前越经典），
 // 且要在 pool 被大景点/必玩 splice 之前取；写在 pool 上还会污染源数据对象，故用局部 Map。
 const _edRank = new Map();
 (city.experiences || []).forEach((e, i) => { if (e && e.name && !_edRank.has(e.name)) _edRank.set(e.name, i); });
 // 纯「就近贪心」的硬伤：每天从市中心出发只挑最近的，会一直在最密的街区打转，
 // 永远轮不到 20km 外的当地头牌（太原晋祠 20.2km、西安兵马俑 32km 都曾被整条行程跳过）。
 // 做法：取前 4 个在池的经典景点，按地理位置分组（相邻 ≤15km 归一组），一组占一天，
 // 当天从该组出发 → 其余景点自然围绕它连成一条线；最近的组排前几天、最远的组排最后一天，
 // 远郊组自动成为「远郊/一日游」，首日（抵达日）保持市区。
 const _ancGroups = [];
 {
  const cands = pool.filter(e => e && e.name && _edRank.get(e.name) < 4)
   .map(e => ({ e, c: spotC(e.name) })).filter(x => x.c)
   .map(x => ({ e: x.e, lat: x.c.lat, lon: x.c.lon, d: cityAnchor ? haversine(x.c, cityAnchor) : 0 }))
   .sort((a, b) => a.d - b.d);
  cands.forEach(x => {
   const g = _ancGroups[_ancGroups.length - 1];
   if (g && x.d - g.maxD <= 15) { g.items.push(x); g.maxD = x.d; }
   else _ancGroups.push({ items: [x], maxD: x.d });
  });
 }
 const _isTransferDay = !!(opts && opts.lastMode === "transfer") && days > 1;
 const anchorForDay = {};
 for (let gi = 0; gi < _ancGroups.length; gi++) {
  let day = days - _ancGroups.length + gi;
  if (day < 0) day = 0;
  if (day === days - 1 && _isTransferDay) day = Math.max(0, days - 2);
  const first = _ancGroups[gi].items[0];
  anchorForDay[day] = { lat: first.lat, lon: first.lon };
 }`,
  },
  {
    from: `   // v1.19.9：前 6 名是当地最该去的地方，给距离折扣，避免远郊头号景点（如太原晋祠）被就近优化永久跳过
   if (typeof e._rank === "number" && e._rank < 6) d -= 300;
`,
    to: "",
  },
  {
    from: `  cursor = cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null; // 每天从市中心出发`,
    to: `  // 每天从当天的经典锚点出发（无锚点的天仍从市中心出发）：锚点距游标 0km，会被当天优先选中
  const _anc = anchorForDay[i];
  cursor = _anc ? {lat: _anc.lat, lon: _anc.lon} : (cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null);`,
  },
];

let ok = true;
for (const [k, ed] of edits.entries()) {
  const n = s.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，整体放弃写入"); ok = false; break; }
}
if (ok) {
  for (const ed of edits) s = s.replace(ed.from, ed.to);
  fs.writeFileSync(F, s, "utf8");
  console.log("✓ 三处均已写入");
}
