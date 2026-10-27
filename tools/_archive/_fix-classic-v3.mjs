// 第三版：去掉地理分组（15km 阈值会把紧凑城市的经典全并成一组，锚点被提前消耗而失效）。
// 改为「一天一个经典锚点」：取池内编辑名次最前的 min(days,4) 个，按离市中心距离升序，
// 最近的排前几天、最远的排最后一天（远郊经典自然成为最后一天的「一日游」）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = ` const _ancGroups = [];
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
 }`;

const to = ` const _isTransferDay = !!(opts && opts.lastMode === "transfer") && days > 1;
 const anchorForDay = {};
 {
  // 按编辑名次取前 min(days,4) 个仍在池里的经典景点，然后按离市中心距离升序排：
  // 最近的排前几天、最远的排最后一天，远郊经典自然成为最后一天的「一日游」。
  const _anchors = pool
   .filter(e => e && e.name && _edRank.has(e.name))
   .sort((a, b) => _edRank.get(a.name) - _edRank.get(b.name))
   .slice(0, Math.min(days, 4))
   .map(e => { const c = spotC(e.name); return c ? { lat: c.lat, lon: c.lon, d: cityAnchor ? haversine(c, cityAnchor) : 0 } : null; })
   .filter(Boolean)
   .sort((a, b) => a.d - b.d);
  for (let gi = 0; gi < _anchors.length; gi++) {
   let day = days - _anchors.length + gi;
   if (day < 0) day = 0;
   if (day === days - 1 && _isTransferDay) day = Math.max(0, days - 2);
   anchorForDay[day] = { lat: _anchors[gi].lat, lon: _anchors[gi].lon };
  }
 }`;

const n = s.split(from).length - 1;
if (n !== 1) { console.log("✗ 命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(from, to), "utf8");
console.log("✓ 已改为一天一锚点");
