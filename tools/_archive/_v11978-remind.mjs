// v1.19.78：行程页接「出发提醒」（本地队列 + 日历兜底 + 订阅消息可选）
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const P = (p) => path.join(ROOT, p);

function once(file, needle, repl, label) {
  const abs = P(file);
  let s = fs.readFileSync(abs, "utf8");
  const n = s.split(needle).length - 1;
  if (n !== 1) {
    console.error(`✗ [${label}] 命中 ${n} 次（期望 1 次）→ ${file}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(abs, s.replace(needle, repl));
  console.log(`✓ [${label}] ${file}`);
}

// ── 1. 引入 remind ──
once(
  "pages/plan/plan.js",
  `const A = require("../../utils/aicontent.js");`,
  `const A = require("../../utils/aicontent.js");\nconst R = require("../../utils/remind.js");`,
  "plan.js/require"
);

// ── 2. 进页后检查到点提醒 ──
once(
  "pages/plan/plan.js",
  "    this.__animOn = true;   // v1.19.77：进页才放错落入场动效\n    this._render(plan);\n   } catch (e) {",
  "    this.__animOn = true;   // v1.19.77：进页才放错落入场动效\n    this._render(plan);\n    this._checkDueRemind();\n   } catch (e) {",
  "plan.js/call"
);

// ── 3. 方法 ──
once(
  "pages/plan/plan.js",
  ` onDeep() {`,
  ` // v1.19.78：出发提醒 —— 没有服务端时，唯一真能响铃的通道是「加入手机日历」，
 // 所以那个选项永远排第一；订阅消息只在真的配置了模板 ID + 云开发后才出现。
 _remindItem(plan) {
  const d = (plan.days && plan.days[0] && String(plan.days[0].date) || "").slice(0, 10);
  if (!d) return null;
  const city = plan.cityName || (plan.province ? plan.province + " 全省" : "目的地");
  return {
   planId: String(plan.id || "") || city + d,
   date: d,
   city: city,
   title: city + " · 出发当天",
   note: (plan.totalDays || plan.days.length) + " 天行程，出发前再把证件和预约确认一遍"
  };
 },
 onRemind() {
  try {
   const plan = app.globalData && app.globalData.plan;
   const item = plan && this._remindItem(plan);
   if (!item) { wx.showToast({ title: "行程还没有出发日期", icon: "none" }); return; }
   const items = ["加入手机日历（离线，到点响铃）"];
   const itemsUse = R.subscribeAvailable() ? items.concat(["订阅微信服务通知"]) : items;
   wx.showActionSheet({
    itemList: itemsUse,
    success: (r) => {
     const idx = Number(r && r.tapIndex);
     if (idx === 0) {
      R.addToCalendar(item).then((okd) => {
       R.add(Object.assign({}, item, { via: "calendar" }));
       wx.showToast({ title: okd ? "已加入手机日历" : "日历写入失败，可改用自己手机日历手动添加", icon: "none" });
      });
     } else if (idx === 1) {
      R.requestSubscribe().then(() => {
       R.scheduleCloud(item).then((okd) => {
        R.add(Object.assign({}, item, { via: okd ? "cloud" : "local" }));
        wx.showToast({ title: okd ? "已预约，出发当天微信会提醒你" : "预约失败，已改为站内提醒", icon: "none" });
       });
      });
     }
    },
    fail: () => {}
   });
  } catch (e) {
   wx.showToast({ title: "设置提醒失败", icon: "none" });
  }
 },
 // 站内轻提醒：到点（含已过）且没弹过的，进行程页时弹一次
 _checkDueRemind() {
  try {
   const due = R.dueToday();
   if (!due.length) return;
   const it = due[0];
   R.ack(it.id);
   if (R.cloudReady()) return;   // 云端会发，不必再打扰
   wx.showModal({
    title: "出发提醒",
    content: it.title + "（" + it.date + "）" + (it.note ? "\\n" + it.note : ""),
    confirmText: "知道了",
    showCancel: false
   });
  } catch (e) {}
 },

 onDeep() {`,
  "plan.js/methods"
);

// ── 4. 工具行加按钮 ──
once(
  "pages/plan/plan.wxml",
  `      <view class="tool" catchtap="onShareImg"><image class="ic" src="/images/icons/export.png"/>生成分享图</view>`,
  `      <view class="tool" catchtap="onShareImg"><image class="ic" src="/images/icons/export.png"/>生成分享图</view>
      <view class="tool" catchtap="onRemind"><image class="ic" src="/images/icons/clock.png"/>出发提醒</view>`,
  "plan.wxml/tool"
);
