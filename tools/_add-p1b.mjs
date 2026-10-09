// P1 留存批（逻辑层）：勋章成就 / 年度旅行报告 / 点亮中国数据 / 交通住宿预估参考
import fs from "fs";

const F = "tools/_src-backup/travel.js";
let s = fs.readFileSync(F, "utf8");

const block = `
/* ============ 新功能 P1 留存批（v1.19.13+） ============ */
// 勋章成就：基于本地足迹/行程/记账统计解锁
const BADGE_RULES = [
  { id: "first", name: "出发啦", desc: "生成第一份行程", test: (s2) => s2.plans >= 1 },
  { id: "plan10", name: "攻略老手", desc: "累计生成 10 份行程", test: (s2) => s2.plans >= 10 },
  { id: "city5", name: "五城足迹", desc: "点亮 5 座城市", test: (s2) => s2.cities >= 5 },
  { id: "city20", name: "走遍半个中国", desc: "点亮 20 座城市", test: (s2) => s2.cities >= 20 },
  { id: "prov10", name: "跨省达人", desc: "足迹覆盖 10 个省份", test: (s2) => s2.provs >= 10 },
  { id: "ledger", name: "精打细算", desc: "记过 10 笔账", test: (s2) => s2.bills >= 10 },
  { id: "foot", name: "打卡狂魔", desc: "打卡过 30 个景点", test: (s2) => s2.foots >= 30 },
  { id: "day14", name: "长途旅行家", desc: "生成过 14 天以上行程", test: (s2) => s2.long >= 1 },
];
function badgesOf() {
  const st = { plans: 0, cities: 0, provs: 0, bills: 0, foots: 0, long: 0 };
  try {
    const saved = store.get("planSlotsV1", []) || [];
    st.plans = saved.length;
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) { st.cities = Object.keys(foot.cities || {}).length; st.provs = Object.keys(foot.provs || {}).length; st.foots = Object.keys(foot.spots || {}).length; }
    const ledger = getLedger();
    st.bills = Array.isArray(ledger) ? ledger.length : 0;
    if (saved.some(p => p && p.days && p.days.length >= 14)) st.long = 1;
  } catch (e) {}
  return BADGE_RULES.map(r => ({ id: r.id, name: r.name, desc: r.desc, got: r.test(st) }));
}

// 年度旅行报告：聚合当年足迹/账本/行程
function yearReport(year) {
  const y = String(year || new Date().getFullYear());
  const out = { year: y, cities: 0, days: 0, bills: 0, total: 0, provs: 0, top: "" };
  try {
    const saved = store.get("planSlotsV1", []) || [];
    const cityCnt = new Map();
    saved.forEach(p => {
      const ds = (p && p.days) || [];
      if (!ds.length) return;
      const firstDate = String((ds[0] && ds[0].date) || "").slice(0, 4);
      if (firstDate !== y) return;
      out.days += ds.length;
      const cnm = (p && p.cityName) || (ds[0] && ds[0].cityName) || "";
      if (cnm) cityCnt.set(cnm, (cityCnt.get(cnm) || 0) + 1);
    });
    out.cities = cityCnt.size;
    let topCity = "", topN = 0;
    cityCnt.forEach((v, k) => { if (v > topN) { topN = v; topCity = k; } });
    out.top = topCity;
    const led = getLedger().filter(x => String(x.date || "").slice(0, 4) === y);
    out.bills = led.length;
    out.total = led.reduce((a, x) => a + (Number(x.amt) || 0), 0);
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) out.provs = Object.keys(foot.provs || {}).length;
  } catch (e) {}
  return out;
}

// 点亮中国：足迹省份 + 城市（供可视化色块图用）
function chinaLite() {
  const out = { provs: [], cities: [] };
  try {
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) {
      out.provs = Object.keys(foot.provs || {});
      out.cities = Object.keys(foot.cities || {});
    }
  } catch (e) {}
  return out;
}

// 交通住宿预估参考（静态估算，非实时）：返回两城间高铁/住宿参考
const _RAIL_EST = { // 常用干线：城市对 → [小时, 二等座参考价]
  "北京-上海": [4.5, 553], "北京-广州": [8, 862], "北京-深圳": [8.5, 944], "上海-杭州": [1, 73],
  "上海-南京": [1.3, 135], "广州-深圳": [0.5, 75], "成都-重庆": [1.2, 154], "西安-郑州": [2.2, 239],
  "武汉-长沙": [1.3, 165], "杭州-苏州": [1.2, 117], "北京-西安": [4.5, 516], "上海-北京": [4.5, 553]
};
function transportEstimate(cityA, cityB) {
  const a = String(cityA || ""), b = String(cityB || "");
  if (!a || !b) return null;
  const k1 = a + "-" + b, k2 = b + "-" + a;
  const hit = _RAIL_EST[k1] || _RAIL_EST[k2];
  if (!hit) return null;
  const h = hit[0];
  return { railHours: h, railText: (h < 2 ? Math.round(h * 60) + " 分钟" : h + " 小时左右"), price: "二等座约 ¥" + hit[1], hotel: "连锁酒店 ¥200-450/晚（参考）" };
}
`;

const anchor = "module.exports = {";
const n = s.split(anchor).length - 1;
if (n !== 1) { console.log("✗ anchor 命中 " + n); process.exit(1); }
s = s.replace(anchor, block + "\n" + anchor);

const expFrom = "module.exports = {\n ready, planCheckup, swapSpotFor, askTrip,\n routeAdvicePlus, highlightOf, crowdTipOf, packExtra,";
const expTo = "module.exports = {\n ready, planCheckup, swapSpotFor, askTrip,\n routeAdvicePlus, highlightOf, crowdTipOf, packExtra,\n badgesOf, yearReport, chinaLite, transportEstimate,";
const n2 = s.split(expFrom).length - 1;
if (n2 !== 1) { console.log("✗ exports 命中 " + n2); process.exit(1); }
s = s.replace(expFrom, expTo);
fs.writeFileSync(F, s, "utf8");
console.log("✓ P1 留存批 4 函数已写入并导出");
