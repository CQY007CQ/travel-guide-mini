/**
 * tools/_test-emergency.mjs —— 旅途应急模块回归
 *
 * 这类功能的风险不在"跑不起来"，而在"给错科室"或"数据错位"。
 * 因此断言分三组：分诊正确性、数据完整性、以及"不得出现医疗断言"的红线。
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../utils/emergency.js");
const D = require("../utils/emergency-data.js");

let bad = 0, n = 0;
function ok(desc, cond, detail) {
  n++;
  if (cond) return;
  bad++;
  console.log("  ✗ " + desc + (detail ? "  → " + detail : ""));
}

/* ── 一、分诊正确性（口语说法必须命中对科室）── */
console.log("【分诊】");
const CASES = [
  ["腿摔了站不起来", "骨科"],
  ["脚崴了肿了", "骨科"],
  ["开水烫到手", "烧伤科"],
  ["狗咬了", "狂犬"],
  ["头撞到墙 恶心", "神经外科"],
  ["吃坏肚子", "消化内科"],
  ["眼睛进沙子", "眼科"],
  ["胸闷喘不上气", "心血管"],
  ["发烧38度5", "发热门诊"],
  ["喝水呛到 咳嗽", "内科"],
];
for (const [q, want] of CASES) {
  const r = E.triage(q);
  const hit = r.some((x) => x.dept.indexOf(want) >= 0);
  ok("「" + q + "」应命中「" + want + "」", hit, r.map((x) => x.dept).join("/") || "未识别");
}

/* 空输入与无关文本必须返回空，不能瞎猜 */
ok("空输入返回空数组", E.triage("").length === 0);
ok("无关文本返回空数组", E.triage("我想去海边玩三天").length === 0);
ok("急症条目排在非急症之前", (() => {
  const r = E.triage("发烧 而且腿摔了");
  if (r.length < 2) return false;
  return r[0].er >= r[1].er;
})());

/* ── 二、数据完整性 ── */
console.log("【数据】");
ok("规则数 ≥15", D.TRIAGE.length >= 15, D.TRIAGE.length);
for (const r of D.TRIAGE) {
  ok("规则字段完整：" + r.dept, Array.isArray(r.kw) && r.kw.length > 0 && !!r.dept && !!r.tip && (r.er === 0 || r.er === 1));
  ok("规则提示不得为空：" + r.dept, String(r.tip || "").trim().length >= 8);
}

let hosp = 0, cityN = 0;
for (const c in D.HOSPITALS) {
  cityN++;
  const list = D.HOSPITALS[c] || [];
  ok("城市「" + c + "」至少 1 家医院", list.length >= 1);
  for (const h of list) {
    hosp++;
    ok("医院字段完整：" + c + "/" + h.n, !!h.n && typeof h.lat === "number" && typeof h.lon === "number" && !!h.lv);
    // 中国境内粗略边界，防止坐标写反（lat/lon 互换会落在境外）
    ok("坐标在中国境内：" + c + "/" + h.n, h.lat > 18 && h.lat < 54 && h.lon > 73 && h.lon < 135, h.lat + "," + h.lon);
    ok("距城中心 ≤25km：" + c + "/" + h.n, h.kmc > 0 && h.kmc <= 25, String(h.kmc));
  }
}
ok("覆盖城市 ≥10", cityN >= 10, cityN);
ok("医院总数 ≥12", hosp >= 12, hosp);

/* 排序是纯几何（距城中心升序），不是主观推荐 */
ok("医院按距城中心升序", (() => {
  const l = E.hospitalsOf(Object.keys(D.HOSPITALS)[0]);
  for (let i = 1; i < l.length; i++) if (l[i - 1].kmc > l[i].kmc) return false;
  return true;
})());

/* ── 三、红线：不得出现医疗断言/医院推荐 ── */
console.log("【红线】");
const BANNED = ["擅长", "最好", "首选", "推荐去", "权威", "专治", "包治", "治愈"];
const allText = JSON.stringify(D);
for (const w of BANNED) {
  ok("数据中不得出现断言性措辞「" + w + "」", allText.indexOf(w) < 0);
}

console.log("");
if (bad) { console.log("emergency 回归失败：" + bad + " 项"); process.exit(1); }
console.log("emergency 回归通过：" + n + " 项");
