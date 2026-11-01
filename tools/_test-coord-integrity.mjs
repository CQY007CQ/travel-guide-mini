// v1.19.173 坐标完整性自检单测：
//  1) 当前真实数据（全量合并后）应 0 越界；
//  2) 注入一个明显越界的点（0,0 落到北京）应被自检发现（返回 ≥1）；
//  3) 还原后再次自检应恢复 0。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  ✗ " + msg); failures++; } else console.log("  ✓ " + msg); };

// 1) 当前真实数据应 0 越界
const n0 = D.checkCoordIntegrity();
ok(n0 === 0, "真实数据坐标自检 = 0 个越界 (实际 " + n0 + ")");

// 2) 注入探针：在已知城市（取第一个有中心坐标的城市）插入 (0,0) 必越界
const city = Object.keys(D.CITY_COORDS).find(c => Array.isArray(D.CITY_COORDS[c]) && D.CITY_COORDS[c].length >= 2);
const arr = D.SPOT_COORDS[city] || (D.SPOT_COORDS[city] = []);
const probe = ["__自检探针__", 0, 0];
arr.push(probe);
const n1 = D.checkCoordIntegrity();
ok(n1 >= 1, "注入越界探针后自检应发现 ≥1 (实际 " + n1 + ")");
arr.pop(); // 还原

// 3) 还原后恢复 0
const n2 = D.checkCoordIntegrity();
ok(n2 === 0, "移除探针后自检恢复 0 (实际 " + n2 + ")");

console.log(failures ? ("坐标自检单测失败 " + failures + " 项") : "坐标自检单测全部通过");
process.exit(failures ? 1 : 0);
