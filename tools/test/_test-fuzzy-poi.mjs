// 回归：模糊 POI 坐标补录（v1.19.172 起，v1.19.184 扩）
// 校验此前 geocode 30001 跳过、长期「已知未解」的地标，现已按权威坐标补入 SPOT_COORDS，
// 且坐标归属正确城市、与公开坐标一致（容差 1km）。
// v1.19.184：广化寺（莆田/北京重名）、石龙山（多地重名）经用户授权「按最优解」定归属后合法补录
// （莆田南山广化寺 / 黑龙江七台河石龙山国家森林公园），坐标经腾讯/维基/政府文档交叉核验。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

// [城市, 景点名, 权威lat, 权威lon]
const EXPECT = [
  ["巴彦淖尔", "纳林湖", 40.532227, 106.64907],
  ["苏州", "网师园", 31.298021, 120.633654],
  ["贵港", "九凌湖", 22.966533, 109.474596],
  ["玉树", "新寨嘉那嘛呢石经城", 33.018206, 97.059472],
  ["莆田", "广化寺", 25.425115, 118.98896],                 // v1.19.184 莆田南山广化寺（腾讯/维基一致）
  ["七台河", "石龙山国家森林公园", 45.648653, 131.246159]     // v1.19.184 黑龙江七台河石龙山国家森林公园（腾讯）
];

let fail = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n); if (!c) fail++; };
const near = (a, b, km) => Math.abs(a - b) * 111 <= km; // 纬度 1°≈111km 粗估

for (const [city, name, lat, lon] of EXPECT) {
  const list = D.SPOT_COORDS[city];
  ok(city + " 在 SPOT_COORDS 中", Array.isArray(list));
  const row = Array.isArray(list) && list.find(r => r[0] === name);
  ok(city + "·" + name + " 已补录", !!row);
  if (row) {
    ok(city + "·" + name + " 纬度一致(≤1km)", near(row[1], lat, 1));
    ok(city + "·" + name + " 经度一致(≤1km)", near(row[2], lon, 1));
    ok(city + "·" + name + " 坐标为有效数字", typeof row[1] === "number" && typeof row[2] === "number");
  }
}

// v1.19.184：广化寺/石龙山 经用户授权「按最优解」定归属后已合法补录（莆田 / 七台河），
// 校验：未向其他重名候选城市臆造扩散（仅落于选定归属城市、且坐标经核验）。
ok("广化寺 未向北京(重名候选)臆造扩散", !(D.SPOT_COORDS["北京"] && D.SPOT_COORDS["北京"].some(r => r[0] === "广化寺")));
ok("石龙山国家森林公园 未向其它城市臆造扩散", Object.keys(D.SPOT_COORDS).filter(c => c !== "七台河").every(c => !(D.SPOT_COORDS[c] || []).some(r => r[0] === "石龙山国家森林公园")));

console.log(fail ? ("\n✗ 模糊POI坐标单测失败 " + fail + " 项") : "\n✓ 模糊POI坐标单测全部通过");
process.exit(fail ? 1 : 0);
