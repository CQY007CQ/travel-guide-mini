// v1.19.174 稀疏县景点补全单测：
//  1) 12 个经核实补录景点均已在对应城市 SPOT_COORDS 中（按名幂等、不重复）。
//  2) 黄龙由 6 → 9 个真实景点（直接消解压测红项「黄龙 D4 空天」）。
//  3) 补录坐标均通过坐标自检规则（<300km 同省 / 不跨省 / 不超 1200km），不会触发 checkCoordIntegrity 告警。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

let failures = 0;
const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); };

const WANT = {
  黄龙: ["牟尼沟", "扎嘎瀑布", "松潘古城"],
  酉阳: ["酉阳桃花源"], 奉节: ["白帝城"], 武隆: ["天生三桥", "仙女山"],
  荔波: ["小七孔"], 兴义: ["万峰林"], 那拉提: ["那拉提草原"],
  茫崖: ["茫崖翡翠湖"], 抚远: ["东极广场"]
};
let hit = 0, miss = [];
for (const c in WANT) for (const n of WANT[c]) {
  if ((D.SPOT_COORDS[c] || []).some(r => r[0] === n)) hit++;
  else { miss.push(c + "·" + n); }
}
ok(hit === 12 && miss.length === 0, "稀疏县补录 12 个景点全部命中 (实际 " + hit + (miss.length ? " 缺失:" + miss.join(",") : "") + ")");

ok((D.SPOT_COORDS["黄龙"] || []).length >= 9, "黄龙 SPOT_COORDS 由 6 → " + (D.SPOT_COORDS["黄龙"] || []).length + " (≥9)");

// 补录坐标应通过坐标自检（不新增越界）
const bad = D.checkCoordIntegrity();
ok(bad === 0, "补录后坐标自检越界数 = " + bad + " (应 0)");

console.log(failures ? ("稀疏县补录单测失败 " + failures + " 项") : "稀疏县补录单测全部通过");
process.exit(failures ? 1 : 0);
