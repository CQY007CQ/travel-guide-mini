// v1.19.79 同名「X市」↔「X」归并回归：直接 require 真 travel.js，在 Node 跑真实代码。
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = T.D;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra !== undefined ? "  [" + extra + "]" : "")); }
};

// 1) 用真实数据程序化验证：所有「X市」零景点、且短名「X」有数据的，findCity 必须归并到「X」
const hasData = (n) => { const c = D.CITIES.find((x) => x.name === n); return !!(c && Array.isArray(c.experiences) && c.experiences.length); };
let mergedCount = 0, wrong = 0;
for (const c of D.CITIES) {
  if (c && !hasData(c.name) && c.name.endsWith("市")) {
    const s = c.name.slice(0, -1);
    if (D.CITIES.some((x) => x.name === s && hasData(s))) {
      mergedCount++;
      const r = T.findCity(c.name);
      if (!(r && r.name === s && hasData(s))) wrong++;
    }
  }
}
ok("「X市」零景点→「X」有数据 全部归并（共 " + mergedCount + " 个）", mergedCount > 250 && wrong === 0, "wrong=" + wrong);

// 2) 抽样若干具体城市
const cases = [
  ["安康市", "安康"], ["安庆市", "安庆"], ["安顺市", "安顺"], ["安阳市", "安阳"],
  ["鞍山市", "鞍山"], ["巴中市", "巴中"], ["白城市", "白城"], ["蚌埠市", "蚌埠"], ["百色市", "百色"],
];
for (const [inp, exp] of cases) {
  const r = T.findCity(inp);
  ok(`findCity("${inp}") → "${exp}" 且有数据`, r && r.name === exp && r.experiences.length > 0, r && r.name);
}

// 3) canonical 短名自身不变
ok('findCity("安康").name === "安康"', T.findCity("安康") && T.findCity("安康").name === "安康");

// 4) 用「X市」能真正生成行程（之前是空白）
for (const [inp, exp] of [["安康市", "安康"], ["安庆市", "安庆"]]) {
  let plan = null, err = null;
  try { plan = T.buildPlan({ city: inp, days: 3, depart: "2027-01-01", budget: "mid" }); } catch (e) { err = e.message; }
  const withSpot = Array.isArray(plan) ? plan.reduce((a, d) => a + (d.items || []).filter((it) => it && it.name && !/^(抵达|返程|休整|当地自由探索|自由活动)/.test(it.name)).length, 0) : 0;
  ok(`buildPlan("${inp}") 生成非空且有真实景点（${withSpot} 项）`, Array.isArray(plan) && plan.length > 0 && withSpot > 0, err || ("withSpot=" + withSpot));
}

// 5) citiesOf 选择器不再出现死城「X市」（当「X」存在时）
let dupInPicker = 0;
for (const prov of Object.keys(D.PROVINCE_CITIES || {})) {
  const list = T.citiesOf(prov).map((o) => o.name);
  const seen = new Set();
  for (const n of list) {
    const cn = T.canonCityName ? T.canonCityName(n) : n;
    if (seen.has(cn)) dupInPicker++;
    seen.add(cn);
  }
  // 抽样：安徽不应含「安庆市」
  if (prov === "安徽") ok('citiesOf("安徽") 不含死城「安庆市」', !list.includes("安庆市") && list.includes("安庆"), list.filter((n) => n === "安庆" || n === "安庆市").join("/"));
}
ok("citiesOf 全省份无 canonical 重名", dupInPicker === 0, "dup=" + dupInPicker);

// 6) 防御性：foodSpotsFor 对「X市」与「X」返回一致
ok('foodSpotsFor("安庆市") === foodSpotsFor("安庆")', JSON.stringify(T.foodSpotsFor("安庆市")) === JSON.stringify(T.foodSpotsFor("安庆")));

// 7) 真正零景点（自治州/地区/盟）不崩：findCity 返回非 null 或 null 均可，但不抛
let crash = 0;
for (const c of D.CITIES) {
  if (c && !hasData(c.name) && !c.name.endsWith("市")) {
    try { T.findCity(c.name); } catch (e) { crash++; }
  }
}
ok("自治州/地区/盟类零景点城市 findCity 不抛异常", crash === 0, "crash=" + crash);

// 8) 易混淆反例：带「市」且有数据、且短名无数据的，应保持「X市」不误剥
//    （如不存在此类样本则跳过——只验证不破坏既有 has-data「X市」）
let kept = 0, keptWrong = 0;
for (const c of D.CITIES) {
  if (c && hasData(c.name) && c.name.endsWith("市")) {
    const s = c.name.slice(0, -1);
    const shortHas = D.CITIES.some((x) => x.name === s && hasData(s));
    if (!shortHas) {
      kept++;
      const r = T.findCity(c.name);
      if (!(r && r.name === c.name)) keptWrong++;
    }
  }
}
ok("带数据「X市」(短名无数据) 保持不误剥（共 " + kept + " 个）", keptWrong === 0, "wrong=" + keptWrong);

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
