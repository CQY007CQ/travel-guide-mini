// v1.19.182 分享深链出发日边界单测：clampDepart 的「过期顺延今天」语义
//   过去日期 → 今天；今天/未来 → 原样；非法/缺失 → null
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

let fails = 0;
const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); fails++; } else console.log("  ✓ " + m); };
const today = new Date(); today.setHours(0, 0, 0, 0);
const todayS = ymd(today);
const future = new Date(today.getTime() + 30 * 86400000); const futureS = ymd(future);
const past = new Date(today.getTime() - 30 * 86400000); const pastS = ymd(past);

ok(T.clampDepart(pastS) === todayS, "过期出发日顺延到今天 (" + pastS + " → " + T.clampDepart(pastS) + ")");
ok(T.clampDepart(todayS) === todayS, "今天出发日原样返回");
ok(T.clampDepart(futureS) === futureS, "未来出发日原样返回 (" + futureS + ")");
ok(T.clampDepart("2020-13-40") === null, "非法日期返回 null");
ok(T.clampDepart("") === null && T.clampDepart(null) === null && T.clampDepart(undefined) === null, "缺失/空/undefined 返回 null");
ok(typeof T.clampDepart(futureS) === "string" && /^\d{4}-\d{2}-\d{2}$/.test(T.clampDepart(futureS)), "返回 YYYY-MM-DD 格式");

if (fails) { console.error("\n❌ clampDepart 单测 " + fails + " 项失败"); process.exit(1); }
console.log("✅ 分享过期日期边界单测全部通过");
