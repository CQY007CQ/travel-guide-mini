/**
 * tools/_test-recommend.mjs —— 个性推荐引擎回归（utils/recommend.js）
 *
 * 为什么要有这组断言：
 *   推荐引擎里唯一的"主观部分"是 W 权重表。权重一调，排序就可能整体走样，
 *   而这种走样**不会报错** —— 只会悄悄把"海边亲子"推成合肥、把"古镇"推成淮北。
 *   所以这里锁定若干黄金用例，权重改动若破坏了底线行为，allcheck 会直接红。
 *
 * 断言分两类：
 *   ① 硬性质（绝不能破）：确定性、分数区间、理由非空、limited 不外泄、TopN 生效
 *   ② 垂类底线（改权重时必须复核）：古镇/海边/沙漠三个高置信场景的 Top1/Top3
 * 刻意不锁死具体名次 —— 那是脆断言，容易为了过测而改产品。
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const R = require("../utils/recommend.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? ("  → " + extra) : "")); }
}

/* ── ① 需求解析 ── */
console.log("【需求解析】");
{
  const p = R.extractPrefs("想找个人少的古镇，三天，预算省一点", { month: 10 });
  ok("识别古镇标签", p.tags.indexOf("oldtown") >= 0, JSON.stringify(p.tags));
  ok("识别人少标签", p.tags.indexOf("quiet") >= 0, JSON.stringify(p.tags));
  ok("识别天数=3", p.days === 3, String(p.days));
  ok("识别预算=low", p.budget === "low", p.budget);

  const p2 = R.extractPrefs("海边亲子游，五天，舒适", { month: 10 });
  ok("识别海边+亲子", p2.tags.indexOf("sea") >= 0 && p2.tags.indexOf("family") >= 0, JSON.stringify(p2.tags));
  ok("识别天数=5", p2.days === 5, String(p2.days));
  ok("识别预算=mid", p2.budget === "mid", p2.budget);

  const p3 = R.extractPrefs("随便逛逛", { month: 10 });
  ok("无标签时 tags 为空", p3.tags.length === 0, JSON.stringify(p3.tags));
  ok("未提天数时不臆造", p3.days === 0, String(p3.days));
}

/* ── ② 硬性质 ── */
console.log("【硬性质】");
{
  const q = "海边亲子游，五天";
  const a = R.recommend(q, { month: 10, topN: 5 });
  const b = R.recommend(q, { month: 10, topN: 5 });
  ok("确定性：同输入同输出", JSON.stringify(a.list) === JSON.stringify(b.list));

  ok("返回非空", a.list.length > 0, String(a.list.length));
  ok("TopN 生效", a.list.length <= 5, String(a.list.length));
  ok("分数落在 1..99", a.list.every(x => x.score >= 1 && x.score <= 99));
  ok("每条都有可解释理由", a.list.every(x => Array.isArray(x.reasons) && x.reasons.length > 0));
  ok("理由含具体命中文案", a.list.every(x => x.reasons.every(r => typeof r.label === "string" && typeof r.delta === "number")));
  ok("默认不返 limited 城", a.list.every(x => !x.limited));
  ok("排序单调不升", a.list.every((x, i) => i === 0 || a.list[i - 1].score >= x.score));

  const w = R.recommend(q, { month: 10, topN: 8, includeLimited: true });
  ok("includeLimited 可放开", w.list.length >= a.list.length, w.list.length + " vs " + a.list.length);
}

/* ── ③ 垂类底线（改 W 权重时必须复核这三组）── */
console.log("【垂类底线】");
{
  const oldtown = R.recommend("古镇 人少 三天", { month: 10, topN: 5 });
  const names = oldtown.list.map(x => x.name);
  ok("古镇：平遥进前 3", names.slice(0, 3).indexOf("平遥") >= 0, names.join(","));
  ok("古镇：命中结果非空", oldtown.list.length > 0);

  const COASTAL = ["秦皇岛", "青岛", "烟台", "威海", "三亚", "大连", "厦门", "珠海", "北海", "台州", "舟山", "温州", "汕头", "湛江", "连云港", "日照"];
  const sea = R.recommend("海边亲子游，五天，舒适", { month: 10, topN: 5 });
  const seaNames = sea.list.map(x => x.name);
  const coastalHit = seaNames.filter(n => COASTAL.indexOf(n) >= 0).length;
  ok("海边亲子：Top5 ≥4 个沿海城", coastalHit >= 4, seaNames.join(","));
  // AND 语义回归：重庆是亲子强市但不是海边，曾被"标签求和"顶进海边榜（实测出现过）
  ok("海边亲子：内陆城市不得混入", seaNames.indexOf("重庆") < 0, seaNames.join(","));

  const desert = R.recommend("沙漠戈壁 摄影 四天", { month: 10, topN: 5 });
  const dNames = desert.list.map(x => x.name);
  ok("沙漠：敦煌进前 3", dNames.slice(0, 3).indexOf("敦煌") >= 0, dNames.join(","));
}

/* ── ④ 单城解释 ── */
console.log("【单城解释】");
{
  const e = R.explain("平遥", "古镇 三天", { month: 10 });
  ok("explain 找到城市", e && e.found === true);
  ok("explain 有理由", e && Array.isArray(e.reasons) && e.reasons.length > 0);
  ok("explain 带标签命中明细", e && Array.isArray(e.tagHits) && e.tagHits.length > 0);

  const miss = R.explain("不存在的城市XYZ", "古镇", { month: 10 });
  ok("explain 未找到时不崩", miss && miss.found === false);
}

/* ── 汇总 ── */
console.log("");
if (fail === 0) {
  console.log("recommend 回归通过：" + pass + " 项");
  process.exit(0);
} else {
  console.log("recommend 回归失败：" + fail + " 项失败 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
