// 补丁自检：字段完整性 + 跨城重名 + 时段合法性 + 坐标键合法性
// 用法: node tools/check-patch.js tools/v199-capital-spots-h.js [...]
const req = require;
const D = require("../utils/data.js");
const files = process.argv.slice(2);
if (!files.length) { console.log("用法: node tools/check-patch.js <patch.js> [...]"); process.exit(1); }
const OK_PERIOD = /^(上午|下午|傍晚|晚上|全天|清晨|早上|中午|深夜|夜间|凌晨)$/;
const all = {};
const ownNames = {};
for (const c of D.CITIES) {
  ownNames[c.name] = new Set((c.experiences || []).map(e => e.name));
  for (const e of (c.experiences || [])) (all[e.name] = all[e.name] || []).push(c.name);
}
const citySet = new Set(D.CITIES.map(c => c.name));
// 城市 → 省份（含补丁 CITY2PROV_ADD 的新城）
const provMap = Object.assign({}, D.CITY2PROV);
const provOf = c => provMap[c] || "";
let problems = 0;
for (const f of files) {
  let P;
  try { P = req(process.cwd() + "/" + f); } catch (e) { console.log("✗ 无法载入", f, e.message); problems++; continue; }
  console.log("\n=== " + f + " ===");
  // v1.17.7：本补丁可能新增城市（CITIES_ADD）→ 先把新城名并入合法城市名集合，
  // 否则 COORDS_ADD/CITY2PROV_ADD 用新城名会被误判为「键非城市名」。
  (P.CITIES_ADD || []).forEach(c => {
    if (c && c.name) { citySet.add(c.name); if (!ownNames[c.name]) ownNames[c.name] = new Set(); }
    if (c && c.name) (c.experiences || []).forEach(e => { if (e && e.name) (all[e.name] = all[e.name] || []).push(c.name); });
  });
  Object.assign(provMap, P.CITY2PROV_ADD || {});
  // EXP_REPLACE
  // v1.17.9：CITIES_ADD 里新城自带的 experiences 也要参与检查 —— 否则新城的跨省重名会漏网
  //（如曲阜的「石门山」与天水的「石门山」重名，之前因只查 EXP_REPLACE 而未被发现）。
  const expCheck = {};
  for (const cn of Object.keys(P.EXP_REPLACE || {})) expCheck[cn] = P.EXP_REPLACE[cn] || [];
  (P.CITIES_ADD || []).forEach(c => {
    if (!c || !c.name) return;
    expCheck[c.name] = (expCheck[c.name] || []).concat((c.experiences || []).map(e => ({ from: "", to: e })));
  });
  for (const city of Object.keys(expCheck)) {
    if (!citySet.has(city)) { console.log("  ✗ 城名不在 CITIES:", city); problems++; }
    const seen = new Set();
    for (const it of expCheck[city]) {
      const nm = it.to && it.to.name;
      if (!nm || !it.to.period || !it.to.note) { console.log("  ✗ 字段缺失:", city, JSON.stringify(it)); problems++; continue; }
      if (!OK_PERIOD.test(it.to.period)) { console.log("  ✗ 非法时段:", city, nm, it.to.period); problems++; }
      if (seen.has(nm)) { console.log("  ✗ 批内重名:", city, nm); problems++; }
      seen.add(nm);
      const owners = (all[nm] || []).filter(o => o !== city);
      if (owners.length) {
        // v1.17.8：同省重名容忍 —— 同一景点被同省两地收录是合理的（如「平遥古城」同时出现在
        // 「晋中」与「平遥」、「婺源篁岭」在「上饶」与「婺源」）。同省内 getSpotCoord 先查本城，
        // 不会错配；只有跨省重名才会破坏省域优先断言，仍按错误处理。
        const myProv = provOf(city);
        const crossProv = owners.filter(o => provOf(o) !== myProv || !myProv);
        if (crossProv.length) { console.log("  ✗ 跨省重名:", city + "·" + nm, "已在", crossProv.join(",")); problems++; }
        else console.log("  · 同省同名（允许）:", city + "·" + nm, "已在", owners.join(","));
      }
      // 本城已有同名：EXP_REPLACE 的 from 为空时会静默跳过，导致"补了却没进库"，必须提前发现
      const ownSet = ownNames[city] || new Set();
      if (ownSet.has(nm) && it.from !== nm) { console.log("  ✗ 本城已有同名（会被静默跳过，需改用 EXP_REMOVE 清理或改名）:", city + "·" + nm); problems++; }
      if (it.to.note.length < 8) { console.log("  ⚠ note 过短:", city, nm, it.to.note); problems++; }
    }
  }
  // COORDS_ADD / COORDS_SET
  for (const tbl of ["COORDS_ADD", "COORDS_SET"]) {
    for (const city of Object.keys(P[tbl] || {})) {
      if (!citySet.has(city)) { console.log("  ✗ " + tbl + " 键非城市名:", city); problems++; }
      for (const s of P[tbl][city]) {
        if (!s || !s[0] || typeof s[1] !== "number" || typeof s[2] !== "number") { console.log("  ✗ 坐标格式错误:", city, JSON.stringify(s)); problems++; continue; }
        if (s[1] < 3 || s[1] > 54 || s[2] < 73 || s[2] > 136) { console.log("  ✗ 坐标越界(非中国境内):", city, s[0], s[1], s[2]); problems++; }
      }
    }
  }
}
console.log("\n" + (problems ? "✗ 共 " + problems + " 处问题" : "✅ 全部通过"));
process.exit(problems ? 1 : 0);
