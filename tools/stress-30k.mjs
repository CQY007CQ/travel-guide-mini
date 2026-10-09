// 30000 轮高强度随机压测 · 质量体检
// 用法: node tools/stress-30k.mjs [用例数] > /tmp/stress.json
// 目的：把「用户视角的坏体验」量化成可优化清单（缺陷类 + 覆盖率类）
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

const N = parseInt(process.argv[2], 10) || 30000;
const DEP = "2026-10-01";

// 真实景点判定：以 App 自己的 isFrameName 为准（它认识全部框架/填充文案，如「去小吃街扫街 + 慢慢逛」），
// 早期用自写正则漏判这批填充句，导致重复/统计被污染。
const hasFrame = typeof T.isFrameName === "function";
const FRAME = /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/;
const ACT = /^\+?\s*(登山|索道|上行|下行|徒步|漂流|骑行|泡汤|换乘)/;
const isReal = n => {
  if (!n) return false;
  if (ACT.test(n)) return false;
  if (hasFrame) return !T.isFrameName(n);
  if (FRAME.test(n)) return false;
  return !/自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/.test(n);
};

const cities = (D.CITIES || []).map(c => c.name).filter(Boolean);
const provs = T.provinces();
const PACES = ["leisure", "balance", "rush"];
const BUDGETS = ["low", "mid", "high"];

// 坐标表：SPOT_COORDS[城]=[[名,lat,lng]]
const coordMap = {};
function coordOfSpot(city, name) {
  const list = D.SPOT_COORDS && D.SPOT_COORDS[city];
  if (!Array.isArray(list)) return null;
  if (!coordMap[city]) {
    const m = {};
    for (const it of list) if (it && it[0]) m[it[0]] = [+it[1], +it[2]];
    coordMap[city] = m;
  }
  const clean = T.cleanSpotName(name);
  let c = coordMap[city][clean] || coordMap[city][name];
  if (c) return c;
  for (const k in coordMap[city]) { if (clean && (clean.indexOf(k) >= 0 || k.indexOf(clean) >= 0)) return coordMap[city][k]; }
  return null;
}
const nm = (a, b) => {
  const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
  const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const ticketDict = D.SPOT_TICKETS || {};
const detailDict = D.SPOT_DETAILS || {};
function hasTicket(name) {
  if (ticketDict[name]) return true;
  const cn = T.cleanSpotName(name);
  if (ticketDict[cn]) return true;
  for (const k in ticketDict) { if (name.indexOf(k) >= 0 || (cn && cn.indexOf(k) >= 0)) return true; }
  return false;
}
function hasDetail(name) {
  if (detailDict[name]) return true;
  const cn = T.cleanSpotName(name);
  if (detailDict[cn]) return true;
  for (const k in detailDict) { if (name.indexOf(k) >= 0 || (cn && cn.indexOf(k) >= 0)) return true; }
  return false;
}

// ── 统计容器 ──
const cnt = {};                 // 类别 -> 次数
const samples = {};             // 类别 -> 样例数组(最多5)
const hit = (tag, msg) => { cnt[tag] = (cnt[tag] || 0) + 1; const a = samples[tag] || (samples[tag] = []); if (a.length < 5) a.push(msg); };
// 覆盖率类：去重景点名 + 出现频次
const noTicket = new Map();     // 出现在行程里但没有票价的景点 -> 次数
const noDetail = new Map();
const noCoord = new Map();
const genericNote = new Map();
const bump = (m, k, seen) => { m.set(k, (m.get(k) || 0) + 1); if (seen) seen.add(k); };

const GENERIC_NOTE = [
  "公园绿地，适合散步慢逛", "园林景观，早晚更舒服", "本地景点，可灵活安排半天",
  "当地去处，按顺路安排即可", "古街古镇，适合边逛边吃", "老街街区，慢慢走更有味",
  "自然景观，需步行或爬升", "山地峡谷景观，穿好走的鞋", "人文古迹，留意开放时间",
  "古建或宗教场所，着装得体", "水景，傍晚光线更好", "水岸景观，适合傍晚散步",
  "室内展馆，建议留 1-2 小时", "展馆类，室内为主，雨天可安排", "历史遗址，看点偏人文",
  "人文遗址，配讲解更值", "体验类项目，建议预留半天", "玩乐项目，人多时先预约"
];

let cases = 0, crash = 0;
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function inspectPlan(plan, tagCtx) {
  if (!Array.isArray(plan)) { hit("plan-非数组", tagCtx); return; }
  if (!plan.length) { hit("plan-空结果", tagCtx); return; }
  const seenNames = new Set();
  plan.forEach((d, di) => {
    const items = d.items || [];
    if (!items.length) { hit("day-无条目", tagCtx + " D" + (di + 1)); return; }
    // 大景点一日游会被拆成「出发前往「X」/深度游览「X」/继续深度游览「X」」多行叙事，
    // cleanSpotName 会把它们收成同一个 X —— 那是一次到访，不能算重复。这里先折成「到访单位」。
    const visits = [];
    {
      let lastKey = null;
      for (const it of items) {
        const n = String(it.name || "");
        if (!isReal(n)) continue;
        const q = /「([^」]+)」/.exec(n);
        const key = q ? q[1] : T.cleanSpotName(n);
        if (key === lastKey) continue;
        visits.push({ key, name: n, note: it.note });
        lastKey = key;
      }
    }
    const reals = visits;
    if (!reals.length) { hit("day-空天无真实景点", tagCtx + " D" + (di + 1)); }
    // 天内重复
    const daySeen = new Set();
    reals.forEach(v => {
      if (daySeen.has(v.key)) hit("day-同天重复景点", tagCtx + " D" + (di + 1) + " " + v.key);
      daySeen.add(v.key);
    });
    // 跨天重复（行程内）
    reals.forEach(v => {
      const cn = v.key;
      if (seenNames.has(cn)) hit("trip-跨天重复景点", tagCtx + " " + cn);
      seenNames.add(cn);
      // 名称质量
      const n = String(v.name || "");
      if (n.length > 26) hit("name-超长" , tagCtx + " " + n.slice(0, 24));
      const open = (n.match(/[（(]/g) || []).length, close = (n.match(/[)）]/g) || []).length;
      if (open !== close) hit("name-括号不配对", tagCtx + " " + n.slice(0, 26));
      if (/[|｜]{2,}|--|,,|。。/.test(n)) hit("name-残留符号", tagCtx + " " + n.slice(0, 26));
      // 覆盖率
      if (!hasTicket(cn)) bump(noTicket, cn);
      if (!hasDetail(cn)) bump(noDetail, cn);
      const city = d.cityName || "";
      if (city && !coordOfSpot(city, cn)) bump(noCoord, city + "·" + cn);
      const note = String(v.note || "").trim();
      if (!note) bump(genericNote, cn + " ||<无备注>");
      else if (GENERIC_NOTE.indexOf(note) >= 0) bump(genericNote, cn + " ||" + note);
    });
    // 动线跳距（相邻真实景点直线距离）
    for (let i = 1; i < reals.length; i++) {
      const city = d.cityName || "";
      const a = coordOfSpot(city, reals[i - 1].key);
      const b = coordOfSpot(city, reals[i].key);
      if (!a || !b) continue;
      const km = nm(a, b);
      // 省内多城串游本来就要换城，「跨100km」是合理的；同城/多站段内跳远才是动线问题
      const kind = /省\//.test(tagCtx) ? "prov" : (tagCtx.indexOf("multi:") === 0 ? "multi" : "city");
      if (kind !== "prov" && km > 60) hit("route-同城跳距>60km", tagCtx + " D" + (di + 1) + " " + Math.round(km) + "km " + reals[i - 1].name + "→" + reals[i].name);
      else if (kind !== "prov" && km > 30) hit("route-同城跳距>30km", tagCtx + " D" + (di + 1) + " " + Math.round(km) + "km");
    }
    // 每天景点数极端
    if (reals.length > 8) hit("day-景点过多>8", tagCtx + " D" + (di + 1) + " 共" + reals.length);
    if (reals.length === 1 && plan.length >= 3) hit("day-仅1个景点", tagCtx + " D" + (di + 1));
  });
  return plan;
}

const top5Of = {};
function coreNotIncluded(cityName, plan) {
  const c = (D.CITIES || []).find(x => x.name === cityName);
  if (!c || !c.experiences || c.experiences.length < 8) return;
  if (!top5Of[cityName]) top5Of[cityName] = (c.experiences || []).slice(0, 5).map(e => T.cleanSpotName(e.name || e.t));
  const top = top5Of[cityName];
  const all = [];
  (plan || []).forEach(d => (d.items || []).forEach(it => { const cn = T.cleanSpotName(it.name); if (isReal(it.name)) all.push(cn); }));
  if (!all.length) return;
  const inter = top.filter(t => all.some(a => a.indexOf(t) >= 0 || t.indexOf(a) >= 0));
  if (!inter.length) hit("quality-未含城市核心景点", cityName);
}

const t0 = Date.now();
while (cases < N) {
  cases++;
  const r = Math.random();
  try {
    if (r < 0.45) {
      // 单城
      const city = rnd(cities);
      const days = rndInt(1, Math.min(10, T.cityDayCap(city, "balance") || 6));
      const out = T.buildPlan({ city, days, depart: DEP, budget: rnd(BUDGETS), pace: rnd(PACES) });
      const got = inspectPlan(out, city + "/" + days + "天");
      if (got && Array.isArray(out)) {
        if (out.length !== days) hit("plan-天数不符", city + " 请求" + days + " 实得" + out.length);
        coreNotIncluded(city, out);
      }
    } else if (r < 0.72) {
      // 全省
      const pv = rnd(provs);
      const days = rndInt(1, 15);
      const out = T.buildProvPlan({ province: pv, days, depart: DEP, budget: rnd(BUDGETS), pace: rnd(PACES) });
      if (!Array.isArray(out) || !out.length) { hit("prov-空结果", pv + "/" + days); continue; }
      if (days <= 40 && out.length !== days) hit("prov-天数不符", pv + " 请求" + days + " 实得" + out.length);
      inspectPlan(out, pv + "省/" + days + "天");
    } else if (r < 0.9) {
      // 多站（对齐 App 真实调用：{route,depart,...} → 返回 {days,segments,totalDays}）
      const route = [];
      const k = rndInt(2, 4);
      for (let i = 0; i < k; i++) {
        const c = rnd(cities);
        if (route.every(s => s.name !== c)) {
          const cap = T.cityDayCap(c, "balance") || 5;
          route.push({ name: c, province: (D.CITY2PROV || {})[c] || "", days: rndInt(1, Math.max(1, Math.min(5, cap))) });
        }
      }
      if (route.length < 2) continue;
      const lbl = "multi:" + route.map(s => s.name).join("+");
      let res;
      try {
        res = T.buildMultiPlan({
          route, depart: DEP, budget: rnd(BUDGETS), pace: rnd(PACES),
          people: rndInt(1, 4), picksPerStation: {}, pickOnly: false, bias: ""
        });
      } catch (e) { hit("multi-崩溃", lbl + ": " + (e && e.message)); continue; }
      if (!res || !Array.isArray(res.days) || !res.days.length) { hit("multi-空结果", lbl); continue; }
      const want = route.reduce((a, s) => a + s.days, 0);
      if (res.days.length !== want) hit("multi-天数不符", lbl + " 请求" + want + " 实得" + res.days.length);
      if (res.segments && res.segments.length !== route.length) hit("multi-段数不符", lbl + " 期望" + route.length + " 实得" + res.segments.length);
      // 想去的位置顺序应与段顺序一致
      res.days.forEach((d, i) => {
        const sg = (res.segments || []).find(s => i >= s.startDay && i <= s.endDay);
        if (sg && d.cityName && sg.cityName !== d.cityName) hit("multi-城市串段", lbl + " D" + (i + 1) + " " + d.cityName + "≠" + sg.cityName);
      });
      inspectPlan(res.days, lbl);
    } else {
      // fuzz 边界
      const mode = rndInt(0, 4);
      const city = rnd(cities);
      if (mode === 0) {
        const out = T.buildPlan({ city, days: 1, depart: DEP, budget: "mid", pace: "rush", pickOnly: false, picks: [] });
        inspectPlan(out, city + "/1天rush");
      } else if (mode === 1) {
        const out = T.buildPlan({ city, days: 30, depart: DEP, budget: "low", pace: "leisure" });
        if (Array.isArray(out) && out.length > 30) hit("fuzz-days超上限", city + " 请求30 实得" + out.length);
        inspectPlan(out, city + "/30天");
      } else if (mode === 2) {
        const c = (D.CITIES || []).find(x => x.name === city);
        const picks = (c && c.experiences || []).slice(0, 3).map(e => e.name || e.t);
        const out = T.buildPlan({ city, days: 3, depart: DEP, budget: "mid", pace: "balance", picks, pickOnly: true });
        inspectPlan(out, city + "/只玩勾选");
      } else if (mode === 3) {
        const out = T.buildPlan({ city, days: 2, depart: DEP, budget: "mid", pace: "balance", bias: "自然风光" });
        inspectPlan(out, city + "/自然偏好");
      } else {
        // 同一城市连生成两次，检查稳定性（不应抛错、不应空）
        const a = T.buildPlan({ city, days: 3, depart: DEP, budget: "mid", pace: "balance" });
        const b = T.buildPlan({ city, days: 3, depart: DEP, budget: "mid", pace: "balance" });
        const ja = JSON.stringify(a && a.map(d => (d.items || []).map(i => i.name)));
        const jb = JSON.stringify(b && b.map(d => (d.items || []).map(i => i.name)));
        if (ja !== jb) hit("fuzz-同参数不稳定", city);
        inspectPlan(a, city + "/稳定A");
      }
    }
  } catch (e) {
    crash++;
    hit("crash-" + String(e.message || e).slice(0, 40), "cases@" + cases);
  }
}

const sec = ((Date.now() - t0) / 1000).toFixed(1);
const topN = (m, n) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
const report = {
  meta: { cases, crash, seconds: sec, cities: cities.length, provinces: provs.length },
  defects: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(k => ({ tag: k, n: cnt[k], samples: samples[k] })),
  coverage: {
    noTicket: { unique: noTicket.size, total: Array.from(noTicket.values()).reduce((a, b) => a + b, 0), top: topN(noTicket, 30) },
    noDetail: { unique: noDetail.size, total: Array.from(noDetail.values()).reduce((a, b) => a + b, 0), top: topN(noDetail, 30) },
    noCoord: { unique: noCoord.size, total: Array.from(noCoord.values()).reduce((a, b) => a + b, 0), top: topN(noCoord, 30) },
    genericNote: { unique: genericNote.size, total: Array.from(genericNote.values()).reduce((a, b) => a + b, 0), top: topN(genericNote, 10) }
  }
};
console.log(JSON.stringify(report, null, 1));
