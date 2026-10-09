// v1.19.77 模板路线回归：从 index.js 抽出真实 tpls 数据 + onTplPick，用真 travel.js 跑。
// 校验：① 10 条热门城市都在库 ② 点一下能落到正确省份 ③ 天数被城市上限正确收敛
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const T = require(path.join(ROOT, "utils/travel.js"));
const idxSrc = fs.readFileSync(path.join(ROOT, "pages/index/index.js"), "utf8");

/* 抽 tpls 数组 */
const m = /tpls: \[([\s\S]*?)\n    \],/.exec(idxSrc);
if (!m) { console.error("✗ 抽不到 tpls"); process.exit(1); }
const tpls = vm.runInNewContext("[" + m[1] + "]");
console.log("模板条目数:", tpls.length);

/* 抽 onTplPick 源码 */
const a = idxSrc.indexOf("  onTplPick(e) {");
const b = idxSrc.indexOf("  /* ---- 高级设置折叠 ---- */");
if (a < 0 || b <= a) { console.error("✗ 抽不到 onTplPick"); process.exit(1); }
const fnSrc = idxSrc.slice(a, b).replace(/,\s*$/, "");

let toast = [], pass = 0, bad = 0;
const ck = (n, c, e) => { if (c) { pass++; console.log("✔ " + n); } else { bad++; console.log("✗ " + n + (e ? " → " + e : "")); } };

const sandbox = { T, wx: { showToast: (o) => toast.push(o.title) }, console, Number, Math, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent };
vm.createContext(sandbox);
vm.runInContext(`var page = { data: { tpls: ${JSON.stringify(tpls)}, days: 4, daysText: "4 天" },
  setData(o){ Object.assign(this.data, o); },
  _fillProv(idx, pickCity){
    const provs = T.provinces(); const cities = T.citiesOf(provs[idx]);
    let cityIdx = 0;
    if (pickCity) { const i = cities.findIndex(c => c.name === pickCity); if (i >= 0) cityIdx = i; }
    this.data.cities = cities; this.data.provIdx = idx; this.data.provName = provs[idx]; this.data.cityIdx = cityIdx;
    this.data.cityName = (cities[cityIdx] || {}).name || "";
  },
  _capOf(cityName){ try { return T.cityDayCap(cityName, "balance") || 14; } catch(e){ return 14; } },
  _dayCap(){ return this._capOf(this.data.cityName); },
  _syncAdv(){}
};
page.__fn = ${fnSrc.replace(/^  onTplPick/, "function onTplPick")};
`, sandbox);

const page = sandbox.page;
const onTplPick = sandbox.page.__fn.bind(page);

/* 真·城市表 */
const provs = T.provinces();
const city2prov = new Map();
for (const p of provs) for (const c of (T.citiesOf(p) || [])) city2prov.set(c.name, p);

for (const t of tpls) {
  toast = [];
  page.data.days = 4; page.data.cityName = "";
  onTplPick({ currentTarget: { dataset: { i: String(tpls.indexOf(t)) } } });
  const gotProv = page.data.provName;
  const wantProv = city2prov.get(t.city);
  const okCity = page.data.cityName === t.city;
  const okProv = gotProv === wantProv;
  const cap = page._dayCap();
  const okDays = page.data.days === Math.min(cap, t.days) && page.data.daysText === page.data.days + " 天";
  ck(`「${t.city}」→ ${wantProv} / ${page.data.days}天（模板 ${t.days}，上限 ${cap}）`, okCity && okProv && okDays,
    `city=${page.data.cityName} prov=${gotProv} days=${page.data.days}`);
}

/* 非法下标不炸 */
toast = [];
let threw = false;
try { onTplPick({ currentTarget: { dataset: { i: "999" } } }); } catch (e) { threw = true; }
ck("越界下标不抛错", !threw);
try { onTplPick({}); } catch (e) { threw = true; }
ck("缺 dataset 不抛错", !threw);

console.log(`\n${pass} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
