// 回归：模糊 POI 坐标补录（v1.19.172）
// 校验 4 个此前 geocode 30001 跳过、长期「已知未解」的地标，现已按权威坐标补入 SPOT_COORDS，
// 且坐标归属正确城市、与公开坐标一致（容差 1km）。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

// [城市, 景点名, 权威lat, 权威lon]
const EXPECT = [
  ["巴彦淖尔", "纳林湖", 40.532227, 106.64907],
  ["苏州", "网师园", 31.298021, 120.633654],
  ["贵港", "九凌湖", 22.966533, 109.474596],
  ["玉树", "新寨嘉那嘛呢石经城", 33.018206, 97.059472]
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

// 反例：模糊重名地标不应被臆造补入
ok("广化寺(重名)未臆造补入", !D.SPOT_COORDS["莆田"] || !D.SPOT_COORDS["莆田"].some(r => r[0] === "广化寺"));
ok("石龙山(重名)未臆造补入", !D.SPOT_COORDS["七台河"] || !D.SPOT_COORDS["七台河"].some(r => r[0] === "石龙山"));

console.log(fail ? ("\n✗ 模糊POI坐标单测失败 " + fail + " 项") : "\n✓ 模糊POI坐标单测全部通过");
process.exit(fail ? 1 : 0);
