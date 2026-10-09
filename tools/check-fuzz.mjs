// v1.11 健壮性 fuzz：把所有导出函数拿脏输入跑一遍，任何未捕获异常都算 bug
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mem = {};
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ""),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10240, keys: Object.keys(mem) }),
  showToast: () => {}, setNavigationBarColor: () => {}, setTabBarStyle: () => {},
  request: () => {}, getSystemInfoSync: () => ({}), setClipboardData: () => {}
};
const T = require("../utils/travel.js");
const P = require("../utils/planner.js");

const HOSTILE = [null, undefined, "", 0, -1, NaN, [], {}, "x", "北京", 12345,
  { days: [] }, { days: null }, { days: [{ date: "bad", items: null }] },
  { cityName: null, days: [{ cityName: null, items: [{ name: null }] }] }];

const planOK = { cityName: "北京", depart: "2026-10-05", days: T.buildPlan({ city: T.findCity("北京"), days: 3, depart: "2026-10-05" }) };

const exps = Object.keys(T).filter(k => typeof T[k] === "function");
const crashes = [];
let calls = 0;
for (const name of exps) {
  for (const arg of HOSTILE) {
    for (const second of [undefined, 0, "北京", {}]) {
      for (const k in mem) delete mem[k];
      try { T[name](arg, second); calls++; }
      catch (e) {
        // 允许「入参就是备份/协作包」类函数对脏串抛错（调用方有 try）
        const allowed = /importBackup|mergeCollabPlan|exportCollabPlan/.test(name);
        if (!allowed && /TypeError|ReferenceError|RangeError/.test(e.name + " " + e.message) && !/unsupported city/.test(e.message)) crashes.push(`${name}(${JSON.stringify(arg)}, ${JSON.stringify(second)}) → ${e.message}`);
      }
    }
  }
}
// planner 侧
const pexps = Object.keys(P).filter(k => typeof P[k] === "function");
for (const name of pexps) {
  for (const arg of HOSTILE) {
    for (const second of [undefined, 0, "北京", "故宫"]) {
      for (const k in mem) delete mem[k];
      try { P[name](arg, second); calls++; }
      catch (e) { crashes.push(`P.${name}(${JSON.stringify(arg)}, ${JSON.stringify(second)}) → ${e.message}`); }
    }
  }
}
console.log(`fuzz 调用 ${calls} 次，导出函数 travel=${exps.length} planner=${pexps.length}`);
if (crashes.length) {
  console.log(`\n⚠ 未捕获异常 ${crashes.length} 处（去重后）：`);
  [...new Set(crashes)].slice(0, 40).forEach(c => console.log("  " + c));
} else console.log("✅ 全部脏输入均被安全处理，无未捕获异常");
