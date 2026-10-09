// 性能优化：① nearest() 市区/远郊计数缓存（原每次调用全量 filter → O(n²)）
// ② getSpotCoord 精确命中改用 Map 索引（原每次线性扫城市坐标表）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const edits = [
  {
    from: ` let cursor = cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null; // 当前位置，每天重置
 const nearest = (periods)=>{`,
    to: ` let cursor = cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null; // 当前位置，每天重置
 // v1.19.10：市区/远郊计数缓存（nearest 每次调用都全量 filter 一遍，实测 O(n²)）
 let _urbanN = pool.filter(e => { const c = spotC(e.name); return c && (!cityAnchor || haversine(c, cityAnchor) <= 25); }).length;
 let _farN = pool.length - _urbanN;
 const nearest = (periods)=>{`,
  },
  {
    from: `  // 远郊日判定：游标已在远郊（继续同向），或市区候选已近耗尽（≤1）而远郊≥2 → 当天从远郊开始集中游览
  const urbanCount = pool.filter(e=>{ const c = spotC(e.name); return c && (!cityAnchor || haversine(c, cityAnchor) <= 25); }).length;
  const farCount = pool.length - urbanCount;
  const cursorFar`,
    to: `  // 远郊日判定：游标已在远郊（继续同向），或市区候选已近耗尽（≤1）而远郊≥2 → 当天从远郊开始集中游览
  const urbanCount = _urbanN;
  const farCount = _farN;
  const cursorFar`,
  },
  {
    from: `  const e = pool.splice(idx,1)[0];
  const c = spotC(e.name);
  if(c) cursor = c; // 游标移到刚取出的景点
  return e;`,
    to: `  const e = pool.splice(idx,1)[0];
  const c = spotC(e.name);
  const wasFar = c && cityAnchor ? haversine(c, cityAnchor) > 25 : false;
  if (wasFar) _farN--; else _urbanN--;
  if(c) cursor = c; // 游标移到刚取出的景点
  return e;`,
  },
  {
    from: `const _coordTable = (cityName) => {
  if (_coordTab.has(cityName)) return _coordTab.get(cityName);
  const base = SPOT_COORDS[cityName];
  const patch = COORD_PATCH[cityName];
  const list = base ? (patch ? base.concat(patch) : base) : (patch || null);
  _coordTab.set(cityName, list);
  return list;
};`,
    to: `const _coordTable = (cityName) => {
  if (_coordTab.has(cityName)) return _coordTab.get(cityName);
  const base = SPOT_COORDS[cityName];
  const patch = COORD_PATCH[cityName];
  const list = base ? (patch ? base.concat(patch) : base) : (patch || null);
  _coordTab.set(cityName, list);
  return list;
};
// v1.19.10：精确命中 Map 索引（getSpotCoord 原来每次线性扫整张城市坐标表）
const _coordExactTab = new Map();
const _coordExactFor = (cityName) => {
  if (_coordExactTab.has(cityName)) return _coordExactTab.get(cityName);
  const list = _coordTable(cityName) || [];
  const m = new Map();
  for (const st of list) if (st && st[0] && !m.has(st[0])) m.set(st[0], { lat: st[1], lon: st[2] });
  _coordExactTab.set(cityName, m);
  return m;
};`,
  },
  {
    from: ` const list = _coordTable(cityName);
 const exact = (n)=>{
  for(const s of list){ if(s[0]===n) return {lat:s[1], lon:s[2]}; }
  return null;
 };`,
    to: ` const list = _coordTable(cityName);
 const exact = (n) => _coordExactFor(cityName).get(n) || null;`,
  },
];

let cur = s, ok = true;
for (const [k, ed] of edits.entries()) {
  const n = cur.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(ed.from, ed.to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ 两处性能优化已写入"); }
