// v1.20 数据拆分包：travel.js 顶部改为惰性 planner + ready() 门。
// planner.js 模块顶层对 data.js 做了 36 个字段解构，数据分包异步加载后就绪前不能 require。
import fs from "fs";

const F = "tools/_src-backup/travel.js";
let s = fs.readFileSync(F, "utf8");

const topFrom = [
  'const D = require("./data.js");',
  'const P = require("./planner.js");',
  'const store = require("./store.js");',
  '',
  '// v1.11 修真 bug：planner.js 是从网页版抽出来的，里面 getWish/getProfile 走 localStorage，',
  '// 而小程序没有 localStorage 且那两个键常量也没定义 —— 异常被 try/catch 吞掉后',
  '// 「想玩清单里的景点优先安排」静默失效（用户勾了想玩，行程却没优先排）。',
  '// 这里把 wx 存储注入进去，让 planner 内部也能读到真实的想玩清单。',
  'if (P.setStoreAdapter) {',
  '  P.setStoreAdapter({',
  '    getItem: (k) => store.get(k, null),',
  '    setItem: (k, v) => store.set(k, v),',
  '    removeItem: (k) => store.del(k)',
  '  });',
  '}',
].join("\n");

const topTo = [
  'const D = require("./data.js");',
  'const store = require("./store.js");',
  '',
  '// v1.20 数据拆分包：data-packed.js 移入 subdata/data，主包异步加载。',
  '// planner.js 在模块顶层对 data.js 做了 36 个字段解构，必须在数据就绪后再 require，',
  '// 否则会拿到空数据且被模块缓存。这里用惰性 Proxy，首次真正调用 P.xxx 时才加载 planner。',
  'let _P = null;',
  'let _PReady = false;',
  'function planner() {',
  '  if (_PReady) return _P;',
  '  if (!D.__dataReady) throw new Error("数据尚未加载完成，请稍后重试");',
  '  _P = require("./planner.js");',
  '  // v1.11 修真 bug：planner.js 是从网页版抽出来的，里面 getWish/getProfile 走 localStorage，',
  '  // 而小程序没有 localStorage 且那两个键常量也没定义 —— 异常被 try/catch 吞掉后',
  '  // 「想玩清单里的景点优先安排」静默失效（用户勾了想玩，行程却没优先排）。',
  '  // 这里把 wx 存储注入进去，让 planner 内部也能读到真实的想玩清单。',
  '  if (_P && typeof _P.setStoreAdapter === "function") {',
  '    _P.setStoreAdapter({',
  '      getItem: (k) => store.get(k, null),',
  '      setItem: (k, v) => store.set(k, v),',
  '      removeItem: (k) => store.del(k)',
  '    });',
  '  }',
  '  _PReady = true;',
  '  return _P;',
  '}',
  'const P = new Proxy({}, { get: (_t, k) => planner()[k] });',
  '',
  '// 页面在 onLoad/onShow 先 await ready()，保证数据与迁移都完成再渲染',
  'function ready() {',
  '  const p = D.initData ? D.initData() : Promise.resolve(D);',
  '  return p.then(() => { bootData(); return D; });',
  '}',
].join("\n");

const bootFrom = [
  '// 迁移后 CITIES 不内嵌 province，省份归属在 CITY2PROV；此处回填，',
  '// 使 provinces()/citiesOf()/出发地与目的地选择按省正确分组',
  '(Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => { if (!c.province && D.CITY2PROV && D.CITY2PROV[c.name]) c.province = D.CITY2PROV[c.name]; });',
].join("\n");

const bootTo = [
  '// 迁移后 CITIES 不内嵌 province，省份归属在 CITY2PROV；此处回填，',
  '// 使 provinces()/citiesOf()/出发地与目的地选择按省正确分组。',
  '// v1.20：数据分包异步加载，迁移必须在数据就绪后执行一次（ready() 调用）。',
  'let _booted = false;',
  'function bootData() {',
  '  if (_booted) return;',
  '  _booted = true;',
  '  (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => { if (!c.province && D.CITY2PROV && D.CITY2PROV[c.name]) c.province = D.CITY2PROV[c.name]; });',
  '  const real = Array.isArray(D.PREP_CHECKLIST) ? D.PREP_CHECKLIST : null;',
  '  if (real && real.length && Array.isArray(PACK_LIST)) {',
  '    const old = PACK_LIST.join(",");',
  '    const next = real.join(",");',
  '    if (old !== next) { PACK_LIST.length = 0; real.forEach(x => PACK_LIST.push(x)); }',
  '  }',
  '}',
].join("\n");

const edits = [
  [topFrom, topTo, "顶层惰性 planner"],
  [bootFrom, bootTo, "延迟迁移"],
  [' module.exports = {\n  provinces, citiesOf, findCity, buildPlan, buildMultiPlan, buildProvPlan, provinceDayCap, provinceSuggestedDays, cityDayCap, provBrief, nearbyCityOf, D, P,',
   ' module.exports = {\n  ready, provinces, citiesOf, findCity, buildPlan, buildMultiPlan, buildProvPlan, provinceDayCap, provinceSuggestedDays, cityDayCap, provBrief, nearbyCityOf, D, P,'],
];

let cur = s, ok = true;
for (const [from, to, label] of edits) {
  const n = cur.split(from).length - 1;
  if (n !== 1) { console.log("✗ " + label + " 命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(from, to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ travel.js 三处已更新"); }
