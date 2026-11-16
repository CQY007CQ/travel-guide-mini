/**
 * 全场景 AI 速达「一键直达」真机运行时验证（不进 allcheck，需 IDE + automator）
 * NODE_PATH=~/wxauto/node_modules node tools/dev/e2e-scenario-nav.cjs
 */
const path = require("path");
const automator = require("miniprogram-automator");

const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const PROJ = path.resolve(__dirname, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log("  ✓ " + n + (e ? " → " + e : "")); } else { fail++; console.log("  ✗ " + n + (e ? " → " + e : "")); } };

(async () => {
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJ, timeout: 180000 });
  const errors = [];
  mp.on && mp.on("console", m => { if (m && m.type === "error") errors.push(String(m.args || "").slice(0, 200)); });
  mp.on && mp.on("exception", e => errors.push(String(e && (e.message || e.stack) || e).slice(0, 200)));

  const routes = async () => mp.evaluate(() => (getCurrentPages() || []).map(p => p.route));
  const tapLabel = async (label) => {
    const page = await mp.currentPage();
    const els = await page.$$(".scene");
    for (const el of els) {
      let t = "";
      try { t = String(await el.text()); } catch (e) {}
      if (t.indexOf(label) >= 0) { await el.tap(); return true; }
    }
    return false;
  };

  try {
    await sleep(5000);
    for (const [label, expect] of [
      ["必吃美食", "subpkg/food/food"],
      ["生成行程", "pages/index/index"],
      ["设置偏好", "pages/more/more"],
      ["拍照识物", "subpkg/lens/lens"]
    ]) {
      await mp.reLaunch("/subpkg/assistant/assistant");
      await sleep(1800);
      const tapped = await tapLabel(label);
      if (!tapped) { ok(label + " tile 可点击", false, "未找到 tile"); continue; }
      await sleep(2200);
      const rs = await routes();
      ok(label + " tile 一键直达", rs[rs.length - 1] === expect, rs.join(" > "));
    }

    // 结果卡上的「直达对应页」按钮：从分包内发起的相对路径也必须补根斜杠
    await mp.reLaunch("/subpkg/assistant/assistant");
    await sleep(1800);
    await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      p.setData({ lastQuery: '直达测试', lastResult: '测试直达按钮', actions: [{ label: "打开美食页 →", path: "subpkg/food/food", query: { city: "杭州" }, mode: "push" }] });
    });
    await sleep(400);
    const btn = await (await mp.currentPage()).$(".act-btn");
    if (btn) { await btn.tap(); await sleep(2000); const rs = await routes(); ok("结果卡直达按钮可用", rs[rs.length - 1] === "subpkg/food/food", rs.join(" > ")); }
    else ok("结果卡直达按钮可用", false, "按钮未渲染");

    console.log("\n运行时异常：" + (errors.length ? errors.slice(0, 4).join(" | ") : "无"));
    console.log("结果：" + pass + " 通过 / " + fail + " 失败");
  } catch (e) {
    console.error("E2E 异常：" + (e && e.stack || e));
    fail++;
  } finally {
    try { await mp.close(); } catch (e) {}
    process.exit(fail === 0 ? 0 : 1);
  }
})();
