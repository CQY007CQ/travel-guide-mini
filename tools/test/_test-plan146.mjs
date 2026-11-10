// 回归：plan 页 summary 卡精简（v1.19.146）
// 覆盖：tripStatsText 去掉与标题重复的「N 天」、与 foot 重复的「X 个景点」；
//       tripCountdown 新增不带城市的 label（给 plan 页用），tip 不再重复大数字（首页 sub 仍含城市）。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

let fail = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n); if (!c) fail++; };

// 1) 单城：ov.text = "4 天 · 7 个景点 · 日均 1.8 个" → 去掉「4 天」与「7 个景点」
const s1 = T.tripStatsText({ text: "4 天 · 7 个景点 · 日均 1.8 个", level: "轻松休闲" }, 7);
ok("单城 stats 去掉『N 天』与『X 个景点』", s1 === "日均 1.8 个 · 轻松休闲");

// 2) 多城：ov.text = "4 天 · 3 城 · 7 个景点 · 日均 1.8 个" → 保留「3 城」，去掉天与景点数
const s2 = T.tripStatsText({ text: "4 天 · 3 城 · 7 个景点 · 日均 1.8 个", level: "节奏紧凑" }, 7);
ok("多城 stats 保留城数、去掉天与景点数", s2 === "3 城 · 日均 1.8 个 · 节奏紧凑");

// 3) 无 ov：退回景点数兜底文案
const s3 = T.tripStatsText(null, 7);
ok("无 ov 退回兜底文案", s3 === "7 个具体景点");

// 4) 倒计时 before 阶段：label 不含城市、sub 仍含城市（首页依赖）、tip 不重复大数字
//    动态算一个约一年后的日期，避免写死日期导致将来失效（todayState 依赖 days[].date）
const ymd = d => d.toISOString().slice(0, 10);
const fut = ymd(new Date(Date.now() + 365 * 86400000));
const plan = { cityName: "北京", depart: fut, days: [{ date: fut, items: [{ name: "故宫" }] }] };
const cd = T.tripCountdown(plan);
ok("倒计时 before 返回 label=后出发", cd && cd.phase === "before" && cd.label === "后出发");
ok("倒计时 before sub 仍含城市(供首页)", cd && /北京/.test(cd.sub));
ok("倒计时 before tip 不再重复『还有 N 天/倒计时 N 天』", cd && !/还有\s*\d+\s*天|倒计时\s*\d+\s*天/.test(cd.tip));

// 5) 不变量：任意倒计时 tip 都不应出现旧式「第 N 天 / 共 N 天」冗余（before 已验证，这里做形态守门）
ok("倒计时 tip 不含『第 N 天 / 共 N 天』残留", cd && !/第\s*\d+\s*天\s*\/\s*共/.test(cd.tip));

console.log(fail ? ("\n✗ plan146 单测失败 " + fail + " 项") : "\n✓ plan146 单测全部通过");
process.exit(fail ? 1 : 0);
