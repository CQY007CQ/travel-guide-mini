// v1.19.82 开屏页「黑屏」修复回归
// 目的：验证当 switchTab/reLaunch 三级全部失败时，splash **不会静默停住**，
//       而是起看门狗持续重试；且在页面真的被卸载(onUnload)后停止重试。
// 方式：vm 沙盒直接跑 pages/splash/splash.js 的真实代码（不复制逻辑，防漂移）。
import fs from "fs";
import vm from "vm";

const FILE = "pages/splash/splash.js";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  " + extra : "")); }
};

function buildSim() {
  const src = fs.readFileSync(FILE, "utf8");
  const calls = { switchTab: 0, reLaunch: 0, setData: [] };
  let pageObj = null;

  // —— 桩：travel.js（themeMode 不依赖数据，可同步返回）——
  const requireStub = () => ({ APP_VER: "1.19.81", themeMode: () => "light", D: { CITIES: [1, 2, 3] } });
  const getAppStub = () => ({});
  const PageStub = (o) => { pageObj = o; };

  // —— 桩：wx 导航**永远失败**（模拟最坏情况）——
  const wx = {
    switchTab: (o) => { calls.switchTab++; setTimeout(() => o.fail && o.fail({}), 0); },
    reLaunch: (o) => { calls.reLaunch++; setTimeout(() => o.fail && o.fail({}), 0); }
  };

  // 给页面对象装 setData 记录
  const sandbox = {
    require: requireStub, getApp: getAppStub, Page: PageStub, wx,
    setTimeout, setInterval, clearTimeout, clearInterval, Promise, Date, console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  // 注入 setData：真实 Page 由框架提供
  pageObj.setData = function (d) { calls.setData.push(d); Object.assign(this.data || (this.data = {}), d); };
  pageObj.data = pageObj.data || {};
  return { pageObj, calls };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\n=== v1.19.82 splash 看门狗回归 ===\n");

// —— 场景 1：三级跳转全失败 ——
{
  const { pageObj, calls } = buildSim();
  pageObj.onLoad.call(pageObj);

  ok("① 初始 data.dark = false（浅色主题不用深色开屏）", pageObj.data.dark === false,
     "实际=" + pageObj.data.dark);

  // 等待足够久：KEEP_MS 1250 → switchTab → 等150ms → reLaunch → 等150ms → reLaunch → 起看门狗
  await sleep(2300);
  const afterFirst = calls.switchTab + calls.reLaunch;
  ok("② 已尝试三级跳转 (switchTab 1 + reLaunch ≥2)", calls.switchTab === 1 && calls.reLaunch >= 2,
     `switchTab=${calls.switchTab} reLaunch=${calls.reLaunch}`);
  ok("③ 三级失败后看门狗已启动 (_wd 存在)", !!pageObj._wd);

  await sleep(1600);          // 再看门狗 WD_MS=700 → 应又重试若干次
  const total = calls.switchTab + calls.reLaunch;
  ok("④ 看门狗持续重试，跳转尝试继续增长", total > afterFirst,
     `失败后 ${afterFirst} 次 → 现在 ${total} 次`);
  ok("⑤ 全过程中从未把内容置透明 (无 out:true)", !calls.setData.some((d) => d && d.out === true),
     "setData 记录=" + JSON.stringify(calls.setData));

  // —— 场景 2：页面真的被卸载 ——
  const before = calls.switchTab + calls.reLaunch;
  pageObj.onUnload.call(pageObj);
  await sleep(1500);
  const after = calls.switchTab + calls.reLaunch;
  ok("⑥ onUnload 后停止重试（页面已跳走）", after === before,
     `卸载前 ${before} 次 → 现在 ${after} 次`);
  ok("⑦ 看门狗已清理 (_wd 置空)", !pageObj._wd);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
