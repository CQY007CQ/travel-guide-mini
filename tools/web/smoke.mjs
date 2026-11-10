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
// 2026-11-10：浏览器没有 require.async，utils/data.js 会 require(_manifest.js)；
// 清单若被 build.mjs 排除，resolveChunkPaths() 静默退回单块，chunk2 永远不加载。
ok("数据分块清单 _manifest.js 已注册进模块表", !!g.__M["subdata/data/_manifest.js"]);
runFile("data.js");
let manifest = [];
try { manifest = g.__require("__entry__", "./subdata/data/_manifest.js") || []; } catch (e) {}
const chunks = (Array.isArray(manifest) ? manifest : []).map((p) => String(p).replace(/^\.\.\//, ""));
ok("清单列出数据块", chunks.length > 0, String(chunks.length));
ok("清单里每一块都已在 data.js 注册", chunks.length > 0 && chunks.every((p) => !!g.__M[p]), chunks.join(","));
ok("清单含第二块 data-packed2.js", chunks.some((p) => /data-packed2\.js$/.test(p)), chunks.join(","));

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
  // 只注册第 1 块时这两项为 0：它们是 chunk2 里的内容，能同时守住「注册」和「真被 applyPacked 加载」
  ok("chunk2 资料卡真实进入运行时（SPOT_CARDS_BY_CITY）",
    Object.keys(D.SPOT_CARDS_BY_CITY || {}).length > 0,
    String(Object.keys(D.SPOT_CARDS_BY_CITY || {}).length));
  ok("chunk2 城市详情真实进入运行时（SPOT_DETAILS_BY_CITY）",
    Object.keys(D.SPOT_DETAILS_BY_CITY || {}).length > 0,
    String(Object.keys(D.SPOT_DETAILS_BY_CITY || {}).length));

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
  // 2026-11-09：模板数量改为跟随 app.json（主包 + 各分包页面数），以后新增页面不必再改测试
  const _app = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
  const _expect = (_app.pages || []).length
    + (_app.subPackages || []).reduce((n, p) => n + ((p.pages || []).length), 0);
  ok("模板数量 = app.json 页面数（" + _expect + "）", pages.length === _expect, String(pages.length));
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
  ok(pages.length + " 个模板均可在空数据下渲染不抛错", rendered === pages.length, renderErrs.join(" ｜ "));

  console.log("== 6b. 全站页面清单（网页导航 / AI 跳转同源） ==");
  runFile("nav.js");
  const nav = g.__WEB_NAV || [];
  ok("nav.js 生成了页面清单", Array.isArray(nav) && nav.length >= 10, String(nav.length));
  ok("清单每项含 path / title / group", nav.every((x) => x && x.p && x.t && x.g));
  ok("清单里每个页面都有可渲染模板", nav.every((x) => !!g.__TPL[x.p]));
  ok("清单不含分包 keep 占位页", !nav.some((x) => /\/keep\/keep$/.test(x.p)));
  ok("4 个 tab 页被正确标记", nav.filter((x) => x.tab).length === 4, String(nav.filter((x) => x.tab).length));
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

  // ── 2026-11-10 网页端「数据补齐 / 路由 / 降级 / 全站 AI」防回潮 ──
  const appJs = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  const wxmlSrc = fs.readFileSync(path.join(ROOT, "tools/web/wxml.mjs"), "utf8");
  const aiSrc = fs.readFileSync(path.join(ROOT, "web/ai-assistant.js"), "utf8");
  ok("网页端 getApp() 具备 app.setPlan（首页生成 / AI 生成行程的前提）",
    /APP\s*=\s*Object\.assign\(\{\},\s*appConfig/.test(rt));
  ok("路由 query 透传到 onLoad",
    rt.includes("__mountPage = function (pagePath, query)") && rt.includes("query: lastQuery"));
  ok("wx.request GET 参数拼 URL",
    rt.includes('url.indexOf("?") >= 0') && rt.includes("encodeURIComponent(k)"));
  ok("fields({node:true}) 返回真实 DOM 节点", rt.includes("if (t.opts && t.opts.node) out.node = node"));
  ok("selector picker 生成 option 并回填选中项",
    rt.includes('document.createElement("option")') && rt.includes("el.selectedIndex"));
  ok("date/time picker 事件转到真正可操作的 input", rt.includes("if (el.__ev) input.__ev = el.__ev"));
  ok("地图标点点击委托还原 markerId",
    rt.includes('closest(".map-mk[data-mid]")') && rt.includes("markerId: markerId"));
  ok("WXML 编译器补 markertap / touchcancel 映射",
    /markertap:\s*"markertap"/.test(wxmlSrc) && /touchcancel:\s*"touchcancel"/.test(wxmlSrc));
  ok("app.js 全站导航 + 带参跳转 + 页面变化事件",
    ["__WEB_NAV", "goQuery", "web:pagechange"].every((k) => appJs.includes(k)));
  ok("AI 具备全站上下文 / 站点状态 / 行程生成 / 对外 API",
    ["function context()", "function siteStatus(", "function generatePlan(", "APP.__webAI", "web:pagechange"]
      .every((k) => aiSrc.includes(k)));

  // ── 2026-11-10 桌面自适应（横屏）防回潮 ──
  const shell = fs.readFileSync(path.join(ROOT, "web/shell.css"), "utf8");
  const htmlSrc = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
  // 只取真正的 --rpx 声明：注释里解释「旧版是 min(100vw,1024px)/750」会被字面量误伤
  const rpxDecl = (shell.match(/--rpx:\s*([^;]+);/g) || []).join(" ");
  ok("rpx 刻度与容器宽度解耦（不再随屏宽把正文放大到 38px）",
    /clamp\(/.test(rpxDecl) && !/min\(100vw/.test(rpxDecl));
  ok("宽屏两列 / 超大屏三列 + 手动强制多列与单列",
    /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(shell) && /repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(shell) &&
    /body\.force-wide/.test(shell) && /body\.single-col/.test(shell));
  ok(">=1100px 左侧常驻侧栏并隐藏底部 tabBar",
    /#webSidebar\s*\{/.test(shell) && /#tabbar\s*\{\s*display:\s*none\s*!important/.test(shell));
  ok("scroll-view 横向滚动降级（防多列下内容溢出到相邻列）",
    /w-sx/.test(wxmlSrc) && /#app \.w-sx/.test(shell) && /overflow-x:\s*auto/.test(shell));
  ok("工具条默认折叠，不再压住内容",
    htmlSrc.includes("webToolsToggle") && /#webTools\.hidden/.test(htmlSrc));
  ok("桌面侧栏与布局切换由 app.js 驱动",
    ["buildSidebar", "toggleLayout", "force-wide", "webToolsToggle"].every((k) => appJs.includes(k)));
}

/* ── 8. 内置 AI 全站智能体：真的跑一遍（不是只看源码形状） ──
   用最小 DOM stub 满足 ai-assistant.js 的 buildUI()，再直接调 __webAI.reply()，
   验证它读的是同一份离线知识库、能写入真实 plan、能带 di 跳页、不编造数据。 */
console.log("== 8. 内置 AI 全站智能体（真实离线数据） ==");
{
  const fakeEl = () => ({
    className: "", id: "", innerHTML: "", textContent: "", value: "", checked: false,
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {}, remove() {},
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
  });
  const oldDoc = g.document;
  g.document = {
    readyState: "complete", body: fakeEl(), createElement: fakeEl,
    getElementById: () => null, addEventListener() {},
  };
  const appStub = { globalData: {}, setPlan(p) { this.globalData.plan = p; } };
  g.getApp = () => appStub;
  g.__APP_CONFIG = appStub;
  g.__webSplitHash = () => ({ path: "pages/index/index", query: {} });
  g.__webCurrent = () => null;
  g.goQuery = () => {};
  g.go = () => {};
  let loadErr = "";
  try { (0, eval)(fs.readFileSync(path.join(ROOT, "web/ai-assistant.js"), "utf8")); }
  catch (e) { loadErr = e.message; }
  const AI = g.__webAI;
  ok("AI 脚本可在浏览器形态下加载", !!AI, loadErr);
  if (AI) {
    const r1 = AI.reply("成都吃什么", AI.context());
    ok("美食问答返回库内真实店铺", /ai-row/.test(r1.html) && r1.html.includes("成都"), r1.html.slice(0, 90));
    ok("美食回答带「直达美食页」动作", (r1.actions || []).some((a) => a.path === "subpkg/food/food"));
    const r2 = AI.reply("帮我生成成都3天行程", AI.context());
    const madePlan = appStub.globalData.plan;
    ok("一句话生成行程并写入 globalData",
      r2.auto === "pages/plan/plan" && !!madePlan && madePlan.cityName === "成都" &&
      madePlan.days && madePlan.days.length === 3,
      JSON.stringify({ auto: r2.auto, city: madePlan && madePlan.cityName, days: madePlan && madePlan.days && madePlan.days.length }));
    const r3 = AI.reply("打开美食页", AI.context());
    ok("显式导航一步切到目标页", r3.auto === "subpkg/food/food", String(r3.auto));
    const r4 = AI.reply("看第2天地图", AI.context());
    ok("地图按天跳转带 di=1（0-based）",
      r4.auto === "subpkg/map/map" && !!r4.query && r4.query.di === 1, JSON.stringify(r4.query || {}));
    const r5 = AI.reply("行程体检", AI.context());
    ok("站点状态问答读到真实行程", /行程体检/.test(r5.html) && /ai-row/.test(r5.html), r5.html.slice(0, 90));
    const r6 = AI.reply("今天花了多少", AI.context());
    ok("站点状态问答读到真实账本",
      /¥/.test(r6.html) && (r6.actions || []).some((a) => a.path === "subpkg/ledger/ledger"));
    const r7 = AI.reply("你好", AI.context());
    ok("问候带当前页面上下文", /生成攻略/.test(r7.html));
    ok("context() 反映当前页面", AI.context().title === "生成攻略", AI.context().title);
  }
  g.document = oldDoc;
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
if (fail) process.exit(1);
