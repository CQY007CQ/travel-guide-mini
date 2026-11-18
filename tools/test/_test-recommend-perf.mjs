/**
 * _test-recommend-perf.mjs —— 推荐引擎「零回查」行为断言（v1.20.35）
 *
 * 为什么不是「断言源码里有 city 参数」这种字串检查：
 * 项目已踩过三次「源码有某串字 ≠ 行为正确」。这里装垫片让 findCity 必被计数，
 * 真跑推荐后读回计数 —— 有人把 heatOf/scoreCity 改回 `T.valueScoreOf(city.name)`，
 * 全表 751 城会各查一次 findCity，计数立刻爆掉，门禁判红。
 *
 * 同时验等价性：把 valueScoreOf 强制退回「丢掉 cityObj、按名字查」的旧路径，
 * 比对两次榜单逐项一致 —— 提速不能改变推荐结果。
 */
import { installWxShim } from "./_wx-shim.mjs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
installWxShim();

const { createRequire } = await import("module");
const require = createRequire(process.cwd() + "/");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = require(path.join(ROOT, "utils/travel.js"));
const RC = require(path.join(ROOT, "utils/recommend.js"));
await T.ready();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? " → " + extra : "")); }
};

const texts = ["古镇 人少 三天", "海边亲子游 五天 舒适", "沙漠戈壁 摄影 四天"];

// ① 行为：全表打分期间不得按城市名回查 findCity
const realFind = T.findCity;
let findN = 0;
T.findCity = function (...args) { findN++; return realFind.apply(this, args); };
for (const t of texts) RC.recommend(t, { month: 11, topN: 5 });
T.findCity = realFind;
ok("推荐全表打分零 findCity 回查", findN === 0,
  "实测 " + findN + " 次（751 城逐个查名 → 每次推荐多耗约 7ms）");

// ② 等价性：新旧取数路径的榜单逐项一致
const realValue = T.valueScoreOf;
const signature = () => texts.map((t) => {
  const r = RC.recommend(t, { month: 11, topN: 5 });
  return JSON.stringify(r.list.map((x) => [x.name, x.score, x.reasonTag, x.summary]));
}).join("\n");
const fast = signature();
T.valueScoreOf = function (name) { return realValue(name); };   // 旧行为：丢掉第二参
const legacy = signature();
T.valueScoreOf = realValue;
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
ok("新旧取数路径榜单逐项一致", fast === legacy, sha(fast) + " vs " + sha(legacy));

// ③ 向后兼容：外部单参调用仍可用
ok("valueScoreOf 单参调用仍有效", realValue("成都") > 0 && realValue("成都") <= 100,
  "实测 " + realValue("成都"));

console.log(`\n推荐性能守卫：${pass} 项通过${fail ? " / " + fail + " 项失败" : ""}`);
process.exit(fail ? 1 : 0);
