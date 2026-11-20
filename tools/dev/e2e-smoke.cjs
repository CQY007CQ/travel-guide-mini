/**
 * tools/dev/e2e-smoke.cjs —— 真机运行环境冒烟（微信开发者工具自动化通道）
 *
 * 为什么要有它：
 *   allcheck 的 61 步全在 Node 里跑，覆盖不到「微信运行时真的把分块下载并合并了吗」。
 *   v1.20.7 把团队美食数据（227KB）搬到 subdata3 分包、改成第 3 个 require.async 分块加载，
 *   Node 侧数据完全正确 —— 但 Node 走的是同步 require，跑不到微信的异步分包路径。
 *   如果分块没下载、或被上传器当「未使用文件」剥掉，线上表现是「店少了但页面不报错」，
 *   属于典型的静默降级，静态门禁全绿也发现不了。
 *   探针取「茫崖」：该城 5 家店**只存在于 subdata3**，基数据里连键都没有。
 *   分块没加载 → 茫崖店数 0；加载了 → >0。二值判定，不受渲染过滤影响。
 *
 * 不接入 allcheck.sh 的两个原因：
 *   ① 回归步数 61 已被「材料口径」门禁锁定，加减步骤会连带改交付材料；
 *   ② 需要 IDE + 图形会话，CI 的 headless 环境跑不了。
 *
 * 前置（一次性，装在工程外，避免 node_modules 被打包进小程序）：
 *   mkdir -p ~/wxauto && cd ~/wxauto && npm init -y
 *   npm i miniprogram-automator --registry=https://registry.npmmirror.com
 *
 * 用法：
 *   NODE_PATH=~/wxauto/node_modules node tools/dev/e2e-smoke.cjs
 *   退出码 0 = 全部通过；1 = 有失败项；2 = 环境缺失
 */
const path = require("path");

let automator;
try {
  automator = require("miniprogram-automator");
} catch (e) {
  console.error("缺少 miniprogram-automator。请按文件头部说明先在工程外安装，再带 NODE_PATH 运行。");
  process.exit(2);
}

const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const PROJ = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 探针城市：只存在于 subdata3 团队数据里，用来证明第 3 个分块真的加载了
const PROBE_CITY = "茫崖";
const PROBE_MIN = 1;   // 基数据里没有这个键，所以只要 >0 就说明分块生效

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  「" + extra + "」" : "")); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  「" + extra + "」" : "")); }
}

(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJ, timeout: 180000 });
  console.log("自动化已连接：" + PROJ);

  // 收集运行时错误：任何 console.error / 未捕获异常都要在最后摊开，
  // 否则「页面看着正常但底层报错」又会被漏掉。
  const errors = [];
  try {
    mp.on("console", (msg) => {
      if (msg && msg.type === "error") errors.push("[console] " + String(msg.args || "").slice(0, 300));
    });
    mp.on("exception", (e) => errors.push("[exception] " + String((e && (e.message || e.stack)) || e).slice(0, 300)));
  } catch (e) { /* 低版本 automator 无事件接口，不阻断 */ }

  try {
    /* ── ① 首屏：数据包真的解出来了吗 ── */
    console.log("\n【① 首屏与数据就绪】");
    await sleep(4500);                       // 启动遮罩 + 分包下载 + 解压
    const home = await mp.currentPage();
    const hd = await home.data();
    const cityN = (hd.cities || []).length;
    const provN = (hd.provinces || []).length;
    ok("首页城市列表非空（白屏检测）", cityN > 0, "城市 " + cityN + " / 省 " + provN);

    /* ── ② subdata3 分块生效（v1.20.7 的核心风险点） ── */
    console.log("\n【② subdata3 团队美食分块】");
    // 注入的行程必须是**结构合法**的（days 是数组、items 非空），否则各页 refresh() 会因
    // 拿到畸形 plan 抛错 —— 那是测试脚本自己的锅，不能记成产品缺陷（本次调试踩过）。
    // v1.20.41：补 date + 动态今天。旧夹具只有 items、depart 写死 2026-12-01 ——
    // 任何按日期判状态的页面（todayState / 天气 7 天窗口）都会走空态分支，
    // 而「有内容」类断言常常被空态文案骗过去（真机抓拍时发现 sweep 就中过）。
    await mp.evaluate((city) => {
      const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const t0 = ymd(new Date());
      const app = getApp();
      app.globalData.plan = {
        cityName: city,
        budget: "mid",
        depart: t0,
        people: 1,
        days: [{ date: t0, cityName: city, items: [{ name: "抵达" + city, period: "上午" }] }]
      };
      return true;
    }, PROBE_CITY);
    await mp.reLaunch("/subpkg/food/food");
    await sleep(3000);
    const food = await mp.currentPage();
    const fd = await food.data();
    const shopN = Number(fd.shopN || 0);
    const foodN = Number(fd.foodN || 0);
    ok("美食页确已进入渲染（不是假空态）", fd.hasPlan === true, "hasPlan=" + fd.hasPlan);
    ok("美食页渲染未抛异常（无「先去生成攻略」误判）", fd.cityName === PROBE_CITY, "cityName=" + fd.cityName);
    ok(
      "仅存在于 subdata3 的探针城市有数据（第 3 分块真的加载了）",
      shopN + foodN >= PROBE_MIN,
      PROBE_CITY + " 店 " + shopN + " / 菜 " + foodN
    );

    /* ── ③ tabBar 主干页可达 ── */
    console.log("\n【③ 主干页可达】");
    await mp.switchTab("/pages/more/more");
    await sleep(2000);
    const more = await mp.currentPage();
    ok("更多页可进入", !!more && more.path.indexOf("more") >= 0, more && more.path);

    await mp.switchTab("/pages/index/index");
    await sleep(1600);
    const back = await mp.currentPage();
    ok("返回首页正常", !!back && back.path.indexOf("index") >= 0, back && back.path);

    /* ── ④ 攻略页不崩 ── */
    console.log("\n【④ 攻略页】");
    await mp.reLaunch("/pages/plan/plan");
    await sleep(2500);
    const plan = await mp.currentPage();
    ok("攻略页可进入", !!plan && plan.path.indexOf("plan") >= 0, plan && plan.path);
  } catch (e) {
    fail++;
    console.log("  ✗ FAIL: 冒烟过程异常 → " + (e && e.message));
  }

  /* ── ⑤ 运行时错误汇总 ── */
  console.log("\n【⑤ 运行时错误】");
  ok("无 console.error / 未捕获异常", errors.length === 0, errors.length ? errors.slice(0, 5).join(" ｜ ") : "0 条");

  try { await mp.close(); } catch (e) {}
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
