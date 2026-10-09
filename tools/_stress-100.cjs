// 100 轮高强度行程压测：随机组合城市/天数/节奏/预算/日期，逐条检查用户可见的不变量。
// 退出码：0 通过；1 有异常。
global.wx = { getStorageSync: () => "", setStorageSync: () => {}, removeStorageSync: () => {} };
const T = require("/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel/utils/travel.js");
const D = T.D;

const ORDER = ["凌晨","清晨","早上","上午","中午","下午","傍晚","晚上","深夜","夜间","全天"];
const idx = s => { const i = ORDER.indexOf(s); return i < 0 ? 99 : i; };
const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续深度游览|继续游览|看日出|下山)/;
const FILLER = /自由活动|自由探索|留白|休整|早餐|晚餐|早点休息|散步|馆子|夜市|小吃|美食|休整|周边走走|慢逛|夜游|溜达|吹风|慢走|闲逛|拼一顿|夜灯|街边摊|烧烤摊|菜市场|早点铺|面食小馆|家常菜馆|苍蝇馆子|看演出|看音乐剧|看歌剧|看相声|看演艺|看舞剧|看杂技|看秀|看灯光/;

const R = (arr) => arr[Math.floor(Math.random() * arr.length)];
const CITY_NAMES = Object.keys(D.SPOT_COORDS).slice(0, 220);
const PACES = ["speed", "balance", "relax"];
const BUDGETS = ["low", "mid", "high"];
const DATES = ["2026-10-01", "2026-12-31", "2027-01-01", "2026-08-15", "2026-02-28", "2026-11-20", "2028-02-29", "2025-09-12"];

let rounds = 0, errors = [], dupCount = 0, timeInv = 0, emptyDays = 0, fillerDup = 0, spotsTotal = 0;
const seenPlans = new Map();

const TOTAL = parseInt(process.argv[2] || "100", 10);
for (let r = 0; r < TOTAL; r++) {
  const nm = R(CITY_NAMES);
  const days = R([1, 2, 3, 4, 5, 7, 10, 14]);
  const pace = R(PACES);
  const budget = R(BUDGETS);
  const depart = R(DATES);
  const pickOnly = Math.random() < 0.2;
  const bias = R(["", "history", "nature"]);
  try {
    const c = T.findCity(nm);
    if (!c) { errors.push("round" + r + ": 城市不存在 " + nm); continue; }
    let opts = { city: c, days, depart, pace, budget, bias, pickOnly };
    if (pickOnly && c.experiences && c.experiences.length) {
      const picks = c.experiences.slice(0, 2).map(e => e.name);
      opts.pickSpots = picks;
    }
    const p = T.buildPlan(opts);
    if (!Array.isArray(p) || p.length !== days) { errors.push("round" + r + ": 返回非数组/天数不符 " + nm + "/" + days); continue; }
    rounds++;
    const planKey = nm + "/" + days + "/" + pace + "/" + budget + "/" + depart + "/" + pickOnly + "/" + bias;
    seenPlans.set(planKey, (seenPlans.get(planKey) || 0) + 1);

    const names = [];
    p.forEach((d, di) => {
      const items = d.items || [];
      if (!items.length) emptyDays++;
      let last = -1;
      items.forEach(it => {
        const name = String(it.name || "");
        const note = String(it.note || "");
        spotsTotal++;
        // 1) 占位符/异常值
        if (/undefined|NaN|\[object|null/.test(name + " " + note)) {
          errors.push(nm + " D" + (di + 1) + " 占位符: " + (name || note).slice(0, 60));
        }
        // 2) 时段倒挂（不处理 全天/凌晨 特殊项）
        const k = idx(it.period);
        if (k !== 99 && k !== 9 && k < last) timeInv++;
        if (k !== 99 && k !== 9) last = k;
        // 3) 跨天重复的“真实景点”（跳过专线框架与填充文案）
        if (!FRAME.test(name) && !FILLER.test(name) && name.length >= 3) {
          names.push(name.replace(/[「」（）()]/g, ""));
        }
      });
    });
    // 同行程内重复真实景点
    const seen = new Set();
    for (const n of names) { if (seen.has(n)) dupCount++; seen.add(n); }
    // 填充文案跨天重复（含 专线日 的休整项）
    const fillers = [];
    p.forEach(d => (d.items || []).forEach(it => { if (FILLER.test(it.name || "") && (it.name || "").length >= 5) fillers.push(it.name); }));
    const fset = new Set();
    for (const f of fillers) { if (fset.has(f)) fillerDup++; fset.add(f); }
  } catch (e) {
    errors.push("round" + r + " " + nm + "/" + days + "/" + pace + " 抛错: " + e.message);
  }
}

console.log("===== " + TOTAL + " 轮高强度压测结果 =====");
console.log("成功轮数:", rounds + "/" + TOTAL);
console.log("生成景点条目:", spotsTotal);
console.log("同行程重复真实景点:", dupCount);
console.log("填充文案跨天重复:", fillerDup);
console.log("时段倒挂:", timeInv);
console.log("空日:", emptyDays);
console.log("异常:", errors.length);
errors.slice(0, 20).forEach(x => console.log("  ⚠️ " + x));
// 确定性检查：相同参数两次生成结果应一致（无随机漂移）
let detBad = 0;
for (let i = 0; i < 8; i++) {
  const nm = CITY_NAMES[i], days = 3;
  const c = T.findCity(nm);
  const o = { city: c, days, depart: "2026-10-01", pace: "balance" };
  const a = JSON.stringify(T.buildPlan(o));
  const b = JSON.stringify(T.buildPlan(o));
  if (a !== b) detBad++;
}
console.log("同参数两次生成不一致:", detBad + "/8");
process.exit(errors.length || dupCount || timeInv || emptyDays ? 1 : 0);
