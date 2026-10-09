// 真实用户视角体验：模拟完整使用流程，检查输出质量（只读，不改数据）
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const P = req("./utils/planner.js");

const store = {};
global.wx = {
  getStorageSync: k => (k in store ? store[k] : ""),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: k => { delete store[k]; },
  showToast: () => {}, showModal: () => {}
};

function line(s) { console.log(s); }
function hr(t) { line("\n" + "=".repeat(60) + "\n【" + t + "】"); }

// 场景1：太原 3 天（用户家乡，最熟悉，最容易看出问题）
hr("场景1：太原 3 天 · 舒适 · 2人");
const city = T.findCity("太原");
line("城市: " + city.name + " | 景点池: " + city.experiences.length);
const planArr = T.buildPlan({ city, days: 3, depart: "2026-10-01", pace: "balance", people: 2, budget: "mid" });
if (Array.isArray(planArr)) {
  planArr.forEach(d => {
    line("\n--- 第" + d.dayNo + "天 " + (d.date || "") + " ---");
    (d.items || []).forEach(it => {
      const nm = typeof it === "string" ? it : (it.name || "");
      const period = (it && it.period) ? "[" + it.period + "]" : "";
      const note = (it && it.note) ? " " + String(it.note).slice(0, 40) : "";
      line("  " + period + " " + nm + note);
    });
  });
}

// 检查：相邻景点地理距离（动线是否合理）
hr("动线检查：太原第1天相邻景点距离");
try {
  const d0 = (planArr[0] && planArr[0].items) || [];
  for (let i = 0; i < d0.length - 1; i++) {
    const a = T.cleanSpotName(d0[i].name || d0[i]);
    const b = T.cleanSpotName(d0[i + 1].name || d0[i + 1]);
    const ga = P.getSpotCoord("太原", a), gb = P.getSpotCoord("太原", b);
    if (ga && gb && ga.lat && gb.lat) {
      const km = P.haversine ? P.haversine(ga, gb) : null;
      line("  " + a + " → " + b + " : " + (km != null ? km + " km" : "?") + (ga.approx === false ? "" : " (a:" + ga.approx + ")") + (gb.approx === false ? "" : " (b:" + gb.approx + ")"));
    }
  }
} catch (e) { line("  距离检查失败: " + e.message); }

// 场景2：小城市 1 天（看是否凑得出来）
hr("场景2：小城市 1 天（看内容是否单薄）");
const small = T.findCity("儋州") || T.findCity("塔城") || T.findCity("博乐");
if (small) {
  line("城市: " + small.name + " | 景点池: " + small.experiences.length);
  const p2 = T.buildPlan({ city: small, days: 1, depart: "2026-10-01", pace: "balance" });
  ((p2[0] && p2[0].items) || []).forEach(it => line("  " + (it.name || it)));
}

// 场景3：边界 —— 天数很大
hr("场景3：太原 10 天（看后期是否重复/敷衍）");
try {
  const p3 = T.buildPlan({ city: T.findCity("太原"), days: 10, depart: "2026-10-01", pace: "balance" });
  const names = [];
  p3.forEach(d => (d.items || []).forEach(it => names.push(T.cleanSpotName(it.name || it))));
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  line("总条目: " + names.length + " | 重复景点: " + [...new Set(dup)].length + " 个");
  if (dup.length) line("重复: " + [...new Set(dup)].slice(0, 8).join(" / "));
  line("第10天: " + ((p3[9] && p3[9].items) || [] || []).map(x => x.name || x).join(" → "));
} catch (e) { line("失败: " + e.message); }

// 场景4：文案自然度抽查
hr("场景4：文案自然度（是否有模板腔/生硬拼接）");
try {
  const p4 = T.buildPlan({ city: T.findCity("太原"), days: 2, depart: "2026-10-01", pace: "balance" });
  const notes = [];
  p4.forEach(d => (d.items || []).forEach(it => { if (it && it.note) notes.push(it.name + "｜" + it.note); }));
  notes.slice(0, 10).forEach(n => line("  " + n));
} catch (e) { line("失败: " + e.message); }
