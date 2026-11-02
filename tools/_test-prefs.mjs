// v1.19.178 跨会话偏好学习单测：验证 learnPrefs / getPrefs / applyLearned 的记、取、回填
// 1) 记：learnPrefs(opts) 把选项写入内存缓存（Node 无 wx，走 _prefCache 退化路径，不崩）
// 2) 取：getPrefs() 返回与学习一致的偏好对象，含 at 时间戳
// 3) 回填：applyLearned(部分 opts) 用已学偏好补齐缺失字段，但不覆盖显式传入字段
// 4) 确定性：同入参两次学习结果稳定
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");

let fails = 0;
const ok = (c, m) => { if (!c) { console.error("  ✗ " + m); fails++; } else console.log("  ✓ " + m); };

(async () => {
  await T.ready();

  // 1) 学习一组偏好（城市/天数/节奏/预算/出行方式）
  T.learnPrefs({ city: "成都", days: 4, pace: "balance", budget: "mid", travelMode: "solo" });
  const p = T.getPrefs();
  ok(p && p.city === "成都", "记: getPrefs().city === 成都");
  ok(p && p.days === 4, "记: getPrefs().days === 4");
  ok(p && p.pace === "balance", "记: getPrefs().pace === balance");
  ok(p && p.budget === "mid", "记: getPrefs().budget === mid");
  ok(p && p.travelMode === "solo", "记: getPrefs().travelMode === solo");
  ok(p && typeof p.at === "number" && p.at > 0, "记: getPrefs().at 为时间戳");

  // 2) 回填：只传城市「西安」，其余缺失项应从已学偏好补齐，且城市不被覆盖
  const back = T.applyLearned({ city: "西安" });
  ok(back.city === "西安", "回填: 显式城市不被覆盖 (西安)");
  ok(back.days === 4, "回填: days 从已学补齐 (4)");
  ok(back.pace === "balance", "回填: pace 从已学补齐");
  ok(back.budget === "mid", "回填: budget 从已学补齐");
  ok(back.travelMode === "solo", "回填: travelMode 从已学补齐");

  // 3) 不覆盖：显式传入 days:7 应保留，不回填
  const no = T.applyLearned({ city: "西安", days: 7 });
  ok(no.city === "西安" && no.days === 7, "不覆盖: 显式 days=7 保留");
  ok(no.pace === "balance" && no.budget === "mid", "不覆盖: 未传字段仍补齐");

  // 4) 多站路径也能学（route 数组）
  T.learnPrefs({ route: [{ name: "大理", days: 3 }, { name: "丽江", days: 2 }], days: 5, pace: "relax", budget: "high" });
  const p2 = T.getPrefs();
  ok(p2 && p2.pace === "relax" && p2.budget === "high", "多站: route 路径也能学 pace/budget");

  // 5) 确定性：同入参两次结果一致
  T.learnPrefs({ city: "北京", days: 3, pace: "fast", budget: "low", travelMode: "family" });
  const a = T.getPrefs();
  T.learnPrefs({ city: "北京", days: 3, pace: "fast", budget: "low", travelMode: "family" });
  const b = T.getPrefs();
  ok(JSON.stringify(a) === JSON.stringify(b), "确定性: 同入参两次学习结果稳定");

  // 6) 空/异常入参不崩
  let threw = false;
  try { T.learnPrefs(null); T.getPrefs(); T.applyLearned(undefined); } catch (e) { threw = true; }
  ok(!threw, "健壮性: null/undefined 入参不抛异常");

  if (fails) { console.error(`\n❌ ${fails} 条断言失败`); process.exit(1); }
  console.log("\n✅ 跨会话偏好学习单测全部通过");
})().catch(e => { console.error("运行异常:", e); process.exit(1); });
