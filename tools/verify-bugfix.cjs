// 验证 bug2（全省精华跳错省）+ bug3（天数 clamp）——用正确省名简称
const automator = require("miniprogram-automator");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
  await mp.switchTab("/pages/index/index");
  await sleep(1000);

  let page = await mp.currentPage();

  // 模拟用户把天数加到 14
  await page.setData({ days: 14, daysText: "14 天" });

  // 打开目的地选择器 → 选「云南」（简称，与 UI 一致）
  await page.callMethod("openPicker", { currentTarget: { dataset: { mode: "dest" } } });
  await page.callMethod("onPickProv", { currentTarget: { dataset: { p: "云南" } } });
  const pickList = await page.data("pickList");
  console.log("pickList[0]:", JSON.stringify(pickList[0]));

  // 选「云南 · 全省精华」
  await page.callMethod("chooseFromPicker", { currentTarget: { dataset: { i: 0 } } });
  await sleep(500);

  const d = await page.data();
  console.log("\n=== 进入全省模式后 ===");
  console.log("provName:", d.provName, "（应 云南）");
  console.log("provMode:", d.provMode, "（应 true）");
  console.log("provTitle:", d.provTitle);
  console.log("provDayCap:", d.provDayCap, "（云南 balance 应 8）");
  console.log("days:", d.days, "（14 应 clamp 到 8）");

  const ok2 = d.provName === "云南" && d.provMode === true && d.provTitle.indexOf("云南") === 0;
  const ok3 = d.days === d.provDayCap;

  // 生成
  await page.callMethod("generate");
  await sleep(1500);
  const plan = await mp.evaluate(() => { try { const p = getApp().globalData.plan; return p ? p.cityName + "|" + p.totalDays + "|isProv=" + p.isProv : "null"; } catch (e) { return "ERR:" + e.message; } });
  console.log("\n生成后 plan:", plan, "（应 云南|8|isProv=true）");
  const okGen = plan.indexOf("云南|") === 0 && plan.indexOf("isProv=true") > 0;

  console.log("\n=== 结果 ===");
  console.log("bug2（跳错省）:", ok2 ? "✅" : "❌");
  console.log("bug3（天数 clamp）:", ok3 ? "✅" : "❌");
  console.log("generate 全省正确:", okGen ? "✅" : "❌");

  await mp.disconnect();
  process.exit(ok2 && ok3 && okGen ? 0 : 1);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
