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

/* ── 7. 浏览器降级能力 + 两端同源文案（静态护栏） ──
   runtime.js 依赖 DOM，node 里跑不起来；但「静默 fail」「点了没反应」这类倒退
   完全可以从源码形状拦住。网页版优化后这些能力必须真实存在，不许回潮。 */
console.log("== 7. 浏览器降级能力（静态护栏） ==");
{
  const rt = fs.readFileSync(path.join(LIB, "runtime.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "web/shell.css"), "utf8");
  const plan = fs.readFileSync(path.join(ROOT, "pages/plan/plan.js"), "utf8");
  ok("addPhoneCalendar 不再静默 fail，走 .ics 导出",
    /addPhoneCalendar:\s*function/.test(rt) && /downloadICS\(o\)/.test(rt) && !/addPhoneCalendar:\s*function\s*\(\s*o\s*\)\s*\{\s*o\s*&&\s*o\.fail/.test(rt));
  ok(".ics 是标准 VCALENDAR / VEVENT / VALARM",
    ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:", "DTEND:", "BEGIN:VALARM", "END:VCALENDAR"].every((k) => rt.includes(k)));
  ok("重复日程导出带 RRULE", /RRULE:FREQ=/.test(rt) && /repeat:\s*true/.test(rt));
  ok("createMapContext 已实现（地图页不再缺 API）",
    /createMapContext:\s*function/.test(rt) && /function webMapContext/.test(rt) && /includePoints: noop/.test(rt));
  ok("地图占位说明：讲清不画底图、下方照常可用",
    css.includes("网页版不加载在线地图底图") && css.includes("逐条导航") && css.includes("data-page"));
  ok("地图：真实坐标示意图（散点+连线，替代空占位）",
    rt.includes("function __schematic") && rt.includes("map-schem") && css.includes("the-map.map-schem"));
  ok("订阅消息不支持时有可见提示", /requestSubscribeMessage:\s*function[\s\S]{0,220}showToast/.test(rt));
  ok("图片下载后有成功反馈", rt.includes("图片已保存到下载目录"));
  ok("日历文案两端分流：网页版不承诺「已加入手机日历」",
    plan.includes("已下载日历文件（.ics）") && /getAccountInfoSync/.test(plan));
  // 只扫代码行：注释里解释「不再甩暂无介绍」也会被字面命中（项目踩过同款误伤）
  const planCode = plan.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("详情无简介时给出已收录信息，不再甩「暂无介绍」",
    !planCode.includes("暂无介绍") && plan.includes("已收录标签") && plan.includes("hasRealDetail = false"));
  // 网页端「更丰富跳转」：首页磁贴真源须含酒店/百科/天气入口（且带定位意图），防回潮
  const travel = fs.readFileSync(path.join(ROOT, "tools/_src-backup/travel.js"), "utf8");
  ok("首页磁贴含酒店住宿入口", /k:\s*"hotel"/.test(travel) && /"酒店住宿"/.test(travel) && /focus:\s*"hotel"/.test(travel));
  ok("首页磁贴含景点百科入口", /k:\s*"baike"/.test(travel) && /"景点百科"/.test(travel) && /focus:\s*"baike"/.test(travel));
  ok("首页磁贴含天气参考入口", /k:\s*"weather"/.test(travel) && /"天气参考"/.test(travel) && /focus:\s*"weather"/.test(travel));
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
if (fail) process.exit(1);
