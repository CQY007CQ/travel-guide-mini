/**
 * tools/_fuzz-recommend.mjs —— 推荐引擎模糊测试（找真 bug，不是跑通就完事）
 *
 * 覆盖三类容易漏的缺陷：
 *   ① 单个标签组合 18×N 全跑一遍：任何异常 / NaN / 越界分数 / 排序失序
 *   ② 极端输入：空串、超长、纯数字、emoji、全角空格、HTML 片段
 *   ③ 全量城市不变量：每城 corpus 可构建、qualityOf 无 NaN、limited 不外泄
 *
 * 用法：node tools/_fuzz-recommend.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const R = require("../utils/recommend.js");

let bugs = 0;
function bad(msg) { bugs++; console.log("  ✗ BUG: " + msg); }
function okLine(msg) { console.log("  ✓ " + msg); }

// v1.19.201：不再硬编码 10 月——fuzz 也必须跑在运行时真实月份上，
// 否则「模糊测试通过」并不能说明现场那个月没问题。
const NOW = { month: new Date().getMonth() + 1, topN: 5 };

/* ── ① 每个标签单独 + 两两组合 ── */
console.log("【标签单跑与两两组合】");
const keys = R.TAGS.map((t) => t.key);
let combos = 0;
const wordsOf = (k) => {
  const t = R.TAGS.find((x) => x.key === k);
  return t && t.words.length ? t.words[0] : "";
};
for (let i = 0; i < keys.length; i++) {
  for (let j = i; j < keys.length; j++) {
    const q = wordsOf(keys[i]) + " " + wordsOf(keys[j]) + " 三天";
    combos++;
    try {
      const r = R.recommend(q, NOW);
      for (const it of r.list) {
        if (!isFinite(it.score) || it.score < 1 || it.score > 99) bad(`分数越界 ${it.score} @ ${q}`);
        if (!isFinite(it.relevance)) bad(`relevance 非数 @ ${q} / ${it.name}`);
        if (it.limited) bad(`limited 城市外泄 @ ${q} / ${it.name}`);
        if (!Array.isArray(it.reasons) || !it.reasons.length) bad(`无理由 @ ${q} / ${it.name}`);
        for (const rs of it.reasons) {
          if (!isFinite(rs.delta)) bad(`理由 delta 非数 @ ${q} / ${it.name}`);
        }
      }
      for (let k = 1; k < r.list.length; k++) {
        if (r.list[k - 1].score < r.list[k].score) bad(`排序失序 @ ${q}`);
      }
    } catch (e) {
      bad(`抛异常 @ ${q}: ${e && e.message}`);
    }
  }
}
if (!bugs) okLine(combos + " 组标签组合无异常");

/* ── ② 极端输入 ── */
console.log("【极端输入】");
const WEIRD = ["", "   ", "。", "3天", "9999999天", "天", "古镇".repeat(500),
  "😀🎉", "ｇｕｚｈｅｎ", "<script>x</script>", "null", "undefined", "三天三夜",
  "0天", "-3天", "1.5天", "古镇\r\n人少\t三天"];
for (const w of WEIRD) {
  try {
    const r = R.recommend(w, NOW);
    if (!Array.isArray(r.list)) bad(`返回结构异常 @ ${JSON.stringify(w.slice(0, 20))}`);
    if (r.prefs && r.prefs.days != null && (!isFinite(r.prefs.days) || r.prefs.days < 0 || r.prefs.days > 30)) {
      bad(`天数未收敛 ${r.prefs.days} @ ${JSON.stringify(w.slice(0, 20))}`);
    }
  } catch (e) {
    bad(`抛异常 @ ${JSON.stringify(w.slice(0, 20))}: ${e && e.message}`);
  }
}
try {
  const r = R.recommend("古镇 三天", { topN: 0 });
  if (r.list.length > 1) bad("topN=0 未收敛为 1");
} catch (e) { bad("topN=0 抛异常: " + e.message); }
try {
  const r = R.recommend("古镇 三天", { topN: 999 });
  if (r.list.length > 20) bad("topN=999 未夹到 20");
} catch (e) { bad("topN=999 抛异常: " + e.message); }
if (!bugs) okLine(WEIRD.length + " 组极端输入无异常");

/* ── ③ 全量城市不变量 ── */
console.log("【全量城市不变量】");
const T = require("../utils/travel.js");
const D = T.D;
let checked = 0, nanQ = 0;
for (const c of D.CITIES) {
  if (!c || !c.name) continue;
  checked++;
  const q = R.qualityOf(c);
  if (!isFinite(q.prom) || q.prom < 0 || q.prom > 1) { nanQ++; bad(`qualityOf 越界 ${c.name} prom=${q.prom}`); }
  try { R.corpusOf(c); } catch (e) { bad(`corpusOf 抛异常 ${c.name}`); }
  if (nanQ > 3) break;
}
if (!nanQ) okLine(checked + " 城 qualityOf / corpusOf 全部合法");

/* ── ④ 单城解释对全量城市不崩 ── */
console.log("【explain 全量】");
let exBad = 0;
for (const c of D.CITIES) {
  if (!c || !c.name) continue;
  try {
    const e = R.explain(c.name, "古镇 三天", NOW);
    if (!e || e.found !== true) { exBad++; bad(`explain 未找到真实城市: ${c.name}`); }
    if (exBad > 3) break;
  } catch (err) {
    exBad++; bad(`explain 抛异常 ${c.name}: ${err && err.message}`);
    if (exBad > 3) break;
  }
}
if (!exBad) okLine("全部真实城市 explain 正常");

/* ── ⑤ 性能 ── */
console.log("【性能】");
const t0 = Date.now();
for (let i = 0; i < 10; i++) R.recommend("古镇 人少 三天", NOW);
const per = (Date.now() - t0) / 10;
console.log("  单次 recommend 平均 " + per.toFixed(1) + " ms（751 城全量打分）");
if (per > 400) bad("单次推荐耗时过高: " + per.toFixed(0) + "ms");

console.log("");
if (bugs) { console.log("发现 " + bugs + " 个问题"); process.exit(1); }
console.log("模糊测试通过：无异常 / 无 NaN / 无越界 / 无排序失序");
process.exit(0);
