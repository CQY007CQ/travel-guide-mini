// 截图脚本：为 mp 后台「图片预览」生成真实界面图（列表/卡片形态，规避"对话/AI"印象）
// 用法：NODE_PATH=... node tools/shots.cjs
const automator = require("miniprogram-automator");
const path = require("path");
const fs = require("fs");

const ROOT = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel";
// 截图输出到项目外（outputs/shots），避免 PNG 被打进小程序包（微信会把项目内图片资源都算进包体）
const OUT = path.join(path.dirname(ROOT), "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const T = require(path.join(ROOT, "utils/travel.js"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(mp, name) {
  const p = path.join(OUT, name);
  await mp.screenshot({ path: p });
  const sz = fs.statSync(p).size;
  console.log("  shot:", name, "(" + sz + "B)");
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
  const cur = await mp.currentPage();
  console.log("connected, current page:", cur.path);

  // 1. 首页（选目的地 + 生成按钮）
  await mp.switchTab("/pages/index/index");
  await sleep(800);
  await shot(mp, "1-index.png");

  // 生成「北京 3 日」示例行程并注入 globalData + storage
  const daysArr = T.buildPlan({
    city: "北京", days: 3, depart: "2026-10-01", budget: "mid",
    pace: "balance", people: 2, stayMountain: true, picks: [], pickOnly: false
  });
  const plan = {
    cityName: "北京", province: "北京市", totalDays: daysArr.length,
    depart: "2026-10-01", days: daysArr, budget: "mid", people: 2,
    pace: "balance", travelMode: "", pickOnly: false, isMulti: false,
    from: { province: "山西省", city: "太原" }, savedAt: Date.now()
  };
  const injected = await mp.evaluate(function (p) {
    try { getApp().setPlan(p); return getApp().globalData.plan.cityName; }
    catch (e) { return "ERR:" + (e && e.message); }
  }, plan);
  console.log("inject plan ->", injected);

  // 2. 行程页（逐日时间线）
  await mp.switchTab("/pages/plan/plan");
  await sleep(800);
  await shot(mp, "2-plan.png");

  // 3. 地图导引页
  await mp.navigateTo("/subpkg/map/map");
  await sleep(600);
  await shot(mp, "3-map.png");
  await mp.navigateBack();
  await sleep(500);

  // 4. 本地速查页（8 个一键查卡片）
  await mp.navigateTo("/subpkg/assistant/assistant");
  await sleep(600);
  await shot(mp, "4-assistant.png");
  await mp.navigateBack();
  await sleep(500);

  // 5. 旅行百宝箱（57 工具）
  await mp.navigateTo("/subpkg/toolkit/toolkit");
  await sleep(600);
  await shot(mp, "5-toolkit.png");

  await mp.disconnect();
  console.log("ALL DONE");
  process.exit(0);
}

main().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
