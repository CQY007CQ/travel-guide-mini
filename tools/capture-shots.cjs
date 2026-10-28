/**
 * tools/capture-shots.cjs —— 真机界面截图（可复现的取证脚本）
 *
 * 用途：用微信开发者工具官方自动化通道抓真实运行截图，供 PPT / 计划书使用。
 *       截图是产品真实界面，不是示意图，评委可对照 App 复核。
 *
 * 前置（只做一次，且**不要装进小程序工程**，避免 node_modules 被当成源码打包）：
 *   mkdir -p ~/wxauto && cd ~/wxauto && npm init -y
 *   npm i miniprogram-automator --registry=https://registry.npmmirror.com
 *
 * 用法：
 *   NODE_PATH=~/wxauto/node_modules node tools/capture-shots.cjs
 *
 * 产物：../screenshots/01-home.png / 02-recommend.png / 03-more.png / 04-datanote-modal.png
 *
 * 注意（踩过的坑）：
 *   · pages/more 是 tabBar 页，必须用 switchTab；reLaunch 到 tabBar 页不会跳转（会静默停在原页）。
 *   · page 上没有 evaluate()，只有 data()/setData()/callMethod()；evaluate 在 MiniProgram 实例上。
 *   · 截图接口按文件路径缓存，同一 session 内改动文件后要换输出文件名或另存副本再渲染。
 */
const fs = require("fs");
const path = require("path");

let automator;
try {
  automator = require("miniprogram-automator");
} catch (e) {
  console.error("缺少 miniprogram-automator。请按文件头部说明先在工程外安装，再带 NODE_PATH 运行。");
  process.exit(2);
}

const CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const PROJ = path.resolve(__dirname, "..");
const OUT = path.resolve(PROJ, "../screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(mp, name) {
  const p = path.join(OUT, name);
  await mp.screenshot({ path: p });
  console.log("  ✓ " + name + " (" + Math.round(fs.statSync(p).size / 1024) + "KB)");
}
async function scroll(mp, top) {
  try { await mp.pageScrollTo({ scrollTop: top, duration: 0 }); return true; }
  catch (e) { try { await mp.callWxMethod("pageScrollTo", { scrollTop: top, duration: 0 }); return true; } catch (e2) { return false; } }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.launch({ cliPath: CLI, projectPath: PROJ, timeout: 150000 });
  console.log("自动化已连接");

  try {
    // ① 首页：等数据就绪（cities 非空即认为分包数据已到位）
    await sleep(3500);
    const home = await mp.currentPage();
    const d = await home.data();
    console.log("  首页数据 prov=" + (d.provinces || []).length + " cities=" + (d.cities || []).length);
    await scroll(mp, 0); await sleep(600);
    await shot(mp, "01-home.png");

    // ② 触发智能推荐并截图结果
    await home.setData({ recText: "古镇 人少 三天" });
    await sleep(300);
    await home.callMethod("onRecRun");
    await sleep(1400);
    const d2 = await home.data();
    console.log("  推荐条数=" + (d2.recList || []).length);
    await scroll(mp, 420); await sleep(700);
    await shot(mp, "02-recommend.png");

    // ③ 更多页（tabBar 页必须 switchTab）
    await mp.switchTab("/pages/more/more");
    await sleep(2200);
    const more = await mp.currentPage();
    if (more && more.path.indexOf("more") >= 0) {
      await scroll(mp, 0); await sleep(500);
      await shot(mp, "03-more.png");
      await more.callMethod("onDataNote");
      await sleep(1200);
      await shot(mp, "04-datanote-modal.png");
    } else {
      console.log("  未进入更多页，跳过");
    }
  } catch (e) {
    console.log("抓图出错:", e && e.message);
  }

  try { await mp.close(); } catch (e) {}
  console.log("完成，产物在 " + OUT);
  process.exit(0);
})();
