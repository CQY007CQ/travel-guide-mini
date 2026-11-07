// tools/web/smoke.mjs —— 网页版引擎冒烟：不启浏览器，验证模块链与核心算法
//
// 目的：构建产物里最常见的故障是「require 路径解析不到」「data 分块没注册」，
// 这些在浏览器里表现为白屏，很难定位。这里在 node 里把 web/lib 的模块表原样
// 执行一遍，确认 travel / planner / recommend 都能拿到数据并产出正确结果。
//
// 用法：node tools/web/smoke.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = path.join(ROOT, "web/lib");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : "")); }
};

// 模拟浏览器全局（页面逻辑里到处有 typeof wx 守卫，这里给最小实现）
const g = globalThis;
g.window = g;
g.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; },
  };
})();

function runFile(f) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(LIB, f), "utf8"));
}

console.log("== 1. 模块表加载 ==");
runFile("modules.js");
ok("modules.js 定义了 __require", typeof g.__require === "function");
runFile("data.js");
ok("data.js 注册了数据分包", !!g.__M["subdata/data/data-packed.js"]);

console.log("== 2. 核心模块可解析 ==");
let T = null, err = "";
try { T = g.__require("__entry__", "./utils/travel.js"); } catch (e) { err = e.message; }
ok("utils/travel.js 可加载", !!T, err);
ok("模块缺失时给出明确报错", (() => {
  try { g.__require("__entry__", "./utils/__nope__.js"); return false; }
  catch (e) { return /模块缺失/.test(e.message); }
})());

if (T) {
  console.log("== 3. 数据就绪 ==");
  await T.ready();
  const D = T.D || {};
  ok("城市数 > 0", Array.isArray(D.CITIES) && D.CITIES.length > 0, String(D.CITIES && D.CITIES.length));
  ok("数据就绪标记", D.__dataReady === true);

  console.log("== 4. 生成一份行程 ==");
  const bj = (D.CITIES || []).find((c) => c.name === "北京");
  ok("找得到北京", !!bj);
  const dep = new Date(Date.now() + 7 * 86400000);
  const depStr = dep.getFullYear() + "-" + String(dep.getMonth() + 1).padStart(2, "0") + "-" + String(dep.getDate()).padStart(2, "0");
  let days = [];
  try { days = T.buildPlan({ city: bj, days: 4, depart: depStr, pace: "balance" }) || []; } catch (e) { err = e.message; }
  ok("北京 4 天行程生成", days.length === 4, err || String(days.length));
  ok("每天都有景点", days.every((d) => d.items && d.items.length > 0));
  ok("行程无脏值", !days.some((d) => d.items.some((i) => /undefined|NaN/.test(String(i.name)))));

  console.log("== 5. 推荐引擎（同一份算法）==");
  const R = g.__require("__entry__", "./utils/recommend.js");
  let rec = [];
  try { rec = R.recommend("沙漠戈壁 摄影 四天", { month: 11, topN: 5 }) || []; } catch (e) { err = e.message; }
  const recList = (rec && rec.list) || [];
  ok("推荐模块可独立加载", recList.length > 0, err || JSON.stringify(Object.keys(rec || {})).slice(0, 120));
  if (recList.length) console.log("    榜首:", recList[0].name || recList[0].city || JSON.stringify(recList[0]).slice(0, 70));

  console.log("== 6. 页面模板 ==");
  runFile("tpl.js");
  const pages = Object.keys(g.__TPL || {});
  ok("模板数量 = 17", pages.length === 17, String(pages.length));
  // 与 runtime 一致的作用域代理：WXML 里引用 data 中不存在的字段时必须返回 undefined，
  // 不能让 with 抛 ReferenceError（pages/splash 曾直接炸在 dark is not defined）
  const scopeOf = (d) => new Proxy(d, {
    has: () => true,
    get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : (k in g ? g[k] : undefined))),
  });
  const h = (tag, props, children) => ({ tag, props, children });
  const c = (...a) => a;
  const t = (s) => ({ text: s });
  const pick = (m, v, el) => el;
  // 与 runtime 同签名：安全成员访问（WXML 的 a.b 在 a 为 undefined 时返回 undefined）
  const m = (o, ...keys) => keys.reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), o);
  g.__h = h; g.__c = c; g.__t = t; g.__pick = pick; g.__m = m;
  let rendered = 0; const renderErrs = [];
  for (const p of pages) {
    try {
      const out = g.__TPL[p](h, c, t, pick, scopeOf({ fz: 1, td: false, list: [], groups: [], open: "" }));
      if (out !== undefined) rendered++;
    } catch (e) {
      if (renderErrs.length < 3) renderErrs.push(p + ": " + e.message);
    }
  }
  ok("17 个模板均可在空数据下渲染不抛错", rendered === pages.length, renderErrs.join(" ｜ "));
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
if (fail) process.exit(1);
