/**
 * tools/dev/sweep-all-pages.cjs —— 全页面真机扫描（21 页，含分包）
 *
 * 为什么要有它：
 *   allcheck 的 61 步全在 Node 里跑（静态扫描 + vm 沙箱），覆盖不到「微信真的把页面实例
 *   建起来」这一段。而下列失败形态全是**静默**的，静态门禁全绿也发现不了：
 *     · 页面路由忘了注册 → navigateTo 失败，用户点按钮毫无反应
 *     · tab 页用了 navigateTo / 非 tab 页用了 switchTab → 同样静默失败
 *     · 分包页跨包引用组件 → 组件不渲染（本仓踩过：subai/deep 引用 subpkg 的 ai-entry）
 *     · 分包数据晚到 → 页面结构在、内容空（看着像白屏）
 *     · 依赖行程的页在无行程时不给空态 → 深色底上就是黑屏
 *
 * 检查维度：
 *   ① 21 个页面逐个进入：路由是否被注册、进法对不对、页面是否真有内容
 *   ② 全程 console.error / 未捕获异常 / 未处理 Promise 拒绝 —— 必须为零
 *   ③ 清空行程后，plan/today/map 三页是否留在本页并给明确空态（而不是把人弹走或空白）
 *   ④ tabBar 四个 tab 互切（tab 之间必须走 switchTab）
 *
 * 不接入 allcheck 的原因同 e2e-smoke：需要 IDE + 图形会话，且回归步数 61 被材料门禁锁死。
 *
 * 用法：
 *   NODE_PATH=~/wxauto/node_modules node tools/dev/sweep-all-pages.cjs
 *   退出码 0 = 全部通过；1 = 有失败项；2 = 环境缺失
 */
const automator = require("miniprogram-automator");

const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const PROJ = require("path").resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  "pages/splash/splash", "pages/index/index", "pages/today/today", "pages/plan/plan",
  "pages/more/more", "pages/myguides/myguides", "pages/help/help",
  "subpkg/map/map", "subpkg/food/food", "subpkg/ledger/ledger", "subpkg/prep/prep",
  "subpkg/assistant/assistant", "subpkg/guide/guide", "subpkg/toolkit/toolkit",
  "subpkg/spotsearch/spotsearch", "subpkg/lens/lens", "subpkg/travelsvc/travelsvc",
  "subai/deep/deep"
];
// 数据加载页：只做 require.async 拉分块，不在 UI 流程里，进去没有可断言的内容
const SKIP = ["subdata/boost/boost", "subdata2/keep/keep", "subdata3/keep/keep"];
const TABS = ["pages/index/index", "pages/today/today", "pages/plan/plan", "pages/more/more"];
// splash 是开机闪屏，设计上就是「短暂展示后自动进首页」，route 变成 index 是**正确行为**，
// 不算跳转失败。不平掉它会让这条永久失败，最后整条门禁被无视（判据假红的典型）。
const SELF_REDIRECT = { "pages/splash/splash": "pages/index/index" };

let pass = 0, fail = 0;
const errors = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  「" + extra + "」" : "")); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  「" + extra + "」" : "")); }
}

/** 一个页面算「有内容」：任一非空数组 / 非空字符串（≥2 字）。按钮不算内容。 */
function richness(d) {
  const arrs = [], strs = [];
  for (const k of Object.keys(d || {})) {
    const v = d[k];
    if (Array.isArray(v) && v.length) arrs.push(k + ":" + v.length);
    else if (typeof v === "string" && v.trim().length >= 2) strs.push(k);
  }
  return { ok: arrs.length + strs.length > 0, arrs, strs };
}

(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJ, timeout: 180000 });
  console.log("自动化已连接：" + PROJ);
  mp.on("console", (m) => { if (m && m.type === "error") errors.push("console: " + String(m.args || "").slice(0, 240)); });
  mp.on("exception", (e) => errors.push("exception: " + String((e && (e.message || e.stack)) || e).slice(0, 240)));
  await sleep(5000);   // 启动遮罩 + 分包下载 + 解压

  // 注入合法行程（结构必须真的合法：days 是数组、items 非空，否则各页 refresh 会抛错，
  // 那是测试脚本自己的锅，不能记成产品缺陷）
  // v1.20.41：补 days[].date + 用今天/明天。旧夹具只有 items、depart 写死 2026-12-01：
  //   ① todayState() 首行 `if (!first) return null` → 今日页直接走空态，
  //      而 richness() 把空态的 quote 文案当「有内容」→ **今日页一直假绿**（真机抓拍才暴露）；
  //   ② 写死 depart 会随日期漂移落进 7 天窗口外，天气卡判 window，测不到真实路径。
  const fixtureDates = await mp.evaluate(() => {
    const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const t0 = ymd(new Date()), t1 = ymd(new Date(Date.now() + 86400000));
    getApp().globalData.plan = {
      cityName: "吉安", budget: "mid", depart: t0, people: 2,
      days: [
        { date: t0, cityName: "吉安", items: [{ name: "抵达吉安", period: "上午" }, { name: "青原山", period: "下午" }] },
        { date: t1, cityName: "吉安", items: [{ name: "井冈山", period: "上午" }] }
      ]
    };
    return { t0, t1 };
  });
  console.log("  行程夹具日期 " + JSON.stringify(fixtureDates));

  console.log("\n【① 21 个页面逐个进入】");
  for (const page of PAGES) {
    const isTab = TABS.includes(page);
    await mp.reLaunch("/pages/index/index");
    await sleep(900);
    const before = errors.length;
    const r = await mp.evaluate((url, isTab) => new Promise((resolve) => {
      const done = (how) => resolve({ how });
      if (isTab) wx.switchTab({ url: "/" + url, success: () => done("switchTab"), fail: (e) => done("FAIL:" + (e && e.errMsg)) });
      else wx.navigateTo({ url: "/" + url, success: () => done("navigateTo"), fail: (e) => done("FAIL:" + (e && e.errMsg)) });
    }), page, isTab);
    await sleep(1400);

    let route = "", d = null;
    try {
      const p = await mp.currentPage();
      route = p.path || p.route || "";
      d = await p.data();
    } catch (e) { /* 拿不到页面本身就是问题，下面判 */ }

    const rich = d ? richness(d) : { ok: false, arrs: [], strs: [] };
    const bad = errors.length - before;
    const wantRoute = SELF_REDIRECT[page] || page;
    const routeOk = route === wantRoute;

    ok(r.how !== "FAIL" && routeOk, page, r.how + " / route " + (route || "无") +
      (SELF_REDIRECT[page] ? "（闪屏自动进首页，属设计）" : ""));
    ok(rich.ok, page + " 有内容（非白屏）",
      rich.arrs.slice(0, 3).join(",") + (rich.strs.length ? " 文本 " + rich.strs.slice(0, 2).join(",") : ""));
    // v1.20.41：今日页必须真有行程。旧断言只看「有任一非空字符串」，
    // 空态的 quote（每天一句旅行小话）也会让它绿 —— 夹具漏 date 时整个今日页零覆盖却报通过。
    // 真判据：hasPlan===true 且 state.phase 来自 todayState()。
    if (page === "pages/today/today") {
      ok(!!(d && d.hasPlan === true && d.state && d.state.phase === "during"),
        "今日页真有行程（hasPlan=true · state.phase=during，不是空态假绿）",
        "hasPlan=" + (d && d.hasPlan) + " phase=" + (d && d.state && d.state.phase));
    }
    // 行程页时间线：真机抓拍时 pageScrollTo 静默失效，卡片始终在首屏下方拿不到截图。
    // 数据层先锁住「view[].items 非空」，避免连条目都没有却因为 view 数组非空而假绿。
    if (page === "pages/plan/plan") {
      const tl = (d && Array.isArray(d.view) ? d.view : []).reduce((n, day) =>
        n + (day && Array.isArray(day.items) ? day.items.length : 0), 0);
      ok(tl >= 2, "行程页时间线有条目（view[].items 合计 ≥2，截图取证失败时仍有据）", "条目 " + tl);
    }
    ok(bad === 0, page + " 无新增运行时错误", bad ? bad + " 条" : "");
  }

  /* ② 无行程时依赖行程的三页必须走空态 —— 三条白屏黑屏铁律的实测版 */
  console.log("\n【② 无行程时的空态】");
  await mp.evaluate(() => {
    const a = getApp();
    a.globalData.plan = null;
    try { a.clearPlan && a.clearPlan(); } catch (e) { /* 清空失败不影响本项判据 */ }
    return true;
  });
  for (const page of ["pages/plan/plan", "pages/today/today", "subpkg/map/map"]) {
    await mp.reLaunch("/pages/index/index");
    await sleep(700);
    const isTab = TABS.includes(page);
    await mp.evaluate((url, isTab) => new Promise((res) => {
      if (isTab) wx.switchTab({ url: "/" + url, success: res, fail: res });
      else wx.navigateTo({ url: "/" + url, success: res, fail: res });
    }), page, isTab);
    await sleep(1300);
    const p = await mp.currentPage();
    const d = await p.data();
    const stayed = (p.path || p.route || "") === page;
    // 铁律：不许自动 switchTab 把人弹走；必须给明确空态标志
    const emptyFlag = d && (d.hasPlan === false || d.loadErr === true || d.empty === true);
    ok(stayed && emptyFlag === true, page + " 留在本页并给空态",
      "hasPlan=" + (d && d.hasPlan) + " loadErr=" + (d && d.loadErr) + " route=" + (p.path || p.route));
  }

  /* ③ tab 之间必须 switchTab */
  console.log("\n【③ tabBar 四个 tab 互切】");
  for (const t of TABS) {
    await mp.evaluate((u) => new Promise((res) => wx.switchTab({ url: "/" + u, success: () => res("ok"), fail: (e) => res("FAIL:" + (e && e.errMsg)) })), t);
    await sleep(1000);
    const p = await mp.currentPage();
    ok((p.path || p.route) === t, "切到 " + t, p.path || p.route);
  }

  /* ④ 运行时错误总账 */
  console.log("\n【④ 运行时错误】");
  const uniq = [...new Set(errors)];
  ok(uniq.length === 0, "全程零 console.error / 零未捕获异常",
    uniq.length ? "共 " + errors.length + " 条 " + uniq.length + " 种：" + uniq.slice(0, 6).join(" | ") : "");

  console.log("\n跳过（数据加载页，不在 UI 流程）：" + SKIP.join(", "));
  console.log(fail === 0
    ? "\n全页面扫描通过：" + pass + " 项"
    : "\n全页面扫描失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("扫描器自身失败（先确认 IDE 在运行、登录态有效）:", e && (e.message || e));
  process.exit(2);
});
