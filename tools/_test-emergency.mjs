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

/* v1.19.180 数据可信度：HOSPITALS 只允许具名真实机构，禁止用「城市名+固定后缀」模板回填凑覆盖率 */
const SUFFIX = ["人民医院", "中医院", "妇幼保健院", "中心医院", "第一人民医院", "第二人民医院", "第三人民医院", "中西医结合医院"];
const TPL = (city, name) => {
  const base = city.replace(/市$/, "");
  return SUFFIX.some((s) => name === base + s || name === city + s);
};

let hosp = 0, cityN = 0, tplHit = 0;
for (const c in D.HOSPITALS) {
  cityN++;
  const list = D.HOSPITALS[c] || [];
  ok("城市「" + c + "」至少 1 家医院", list.length >= 1);
  for (const h of list) {
    hosp++;
    ok("医院字段完整：" + c + "/" + h.n, !!h.n && typeof h.lat === "number" && typeof h.lon === "number" && !!h.lv);
    // 中国境内粗略边界，防止坐标写反（lat/lon 互换会落在境外）。
    // 下界取 16：中国最南端三沙（永兴岛，约 16.8°N）属合法领土；上界 54 / 经度 73–135 仍能在坐标互换时拦截（互换后 lat∈73–135 必超 54 上界）。
    ok("坐标在中国境内：" + c + "/" + h.n, h.lat > 16 && h.lat < 54 && h.lon > 73 && h.lon < 135, h.lat + "," + h.lon);
    ok("距城中心 ≤25km：" + c + "/" + h.n, h.kmc > 0 && h.kmc <= 25, String(h.kmc));
    if (TPL(c, h.n)) { tplHit++; console.log("  ✗ 模板机构名回流：" + c + "/" + h.n); }
  }
}
ok("不得出现模板生成的机构名（v1.19.168 教训，勿回潮）", tplHit === 0, tplHit + " 条");
ok("具名医院覆盖 ≥100 城", cityN >= 100, cityN);
ok("具名医院总数 ≥140 家", hosp >= 140, hosp);

/* 降级城市：只有城中心坐标，不得含任何医院记录 */
let apN = 0;
for (const c in D.APPROX) {
  apN++;
  const p = D.APPROX[c];
  ok("降级城坐标合法：" + c, Array.isArray(p) && p.length === 2 && p[0] > 16 && p[0] < 54 && p[1] > 73 && p[1] < 135, JSON.stringify(p));
  ok("降级城不得同时含具名医院：" + c, !D.HOSPITALS[c]);
}
ok("降级城市数 ≥200", apN >= 200, apN);
ok("两集合不重叠且合成可选城市全集", (() => {
  const a = new Set(Object.keys(D.HOSPITALS)), b = new Set(Object.keys(D.APPROX));
  for (const k of b) if (a.has(k)) return false;
  const all = E.cities();
  return all.length === a.size + b.size;
})());
ok("isApprox/approxCoord 与数据一致", (() => {
  const ap = Object.keys(D.APPROX)[0];
  const vf = Object.keys(D.HOSPITALS)[0];
  return E.isApprox(ap) === true && E.isApprox(vf) === false &&
    Array.isArray(E.approxCoord(ap)) && E.approxCoord(vf) === null &&
    E.hospitalsOf(ap).length === 0 && E.hospitalsOf(vf).length > 0;
})());

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
