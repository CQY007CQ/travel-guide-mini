// pages/plan/p-note.js —— 行程页笔记与提醒（城市打分 / 景点百科 / 到点提醒）（从 plan.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./plan-ctx.js");
const { app, T, S, A, W, EL, Cloud, AIAgent, AN, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

module.exports = {
  /* ---- v1.8.4 B17：城市打分 + 避坑小贴士（自存，下次来这座城会回显） ---- */
  // v1.12 UI 减法：打分入口文案预计算，避免 WXML 内嵌套三元
  _syncCnTx() {
   const d = this.data;
   this.setData({ cnToggleTx: d.cnOpen ? "收起 ▴" : (d.cityNote ? "编辑 ▾" : "去打分 ▾") });
  },

  onCnToggle() {
   const plan = app.globalData.plan;
   if (!plan || plan.isProv || (Array.isArray(plan.segments) && plan.segments.length > 1)) return;
   const open = !this.data.cnOpen;
   this.setData({ cnOpen: open,
    cnScore: this.data.cityNote ? this.data.cityNote.score : 0,
    cnTips: this.data.cityNote ? (this.data.cityNote.tips || []).join("\n") : "" });
   this._syncCnTx();
  },

  onCnScore(e) { this.setData({ cnScore: Number(e.currentTarget.dataset.s) || 0 }); },

  onCnTips(e) { this.setData({ cnTips: e.detail.value }); },

  onCnSave() {
   const plan = app.globalData.plan;
   if (!plan || !plan.cityName) return;
   const tips = String(this.data.cnTips || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 8);
   T.saveCityNote(plan.cityName, this.data.cnScore, tips);
   this.setData({ cnOpen: false, cityNote: T.getCityNote(plan.cityName) });
   this._syncCnTx();
   wx.showToast({ title: "已记下这座城的经验", icon: "none" });
  },

  onCnDel() {
   const plan = app.globalData.plan;
   if (!plan) return;
   T.delCityNote(plan.cityName);
   this.setData({ cityNote: null, cnOpen: false });
   this._syncCnTx();
   wx.showToast({ title: "已删除", icon: "none" });
  },

 // v1.8.4 B15：旅行拼图（canvas 每日卡片拼贴墙 → 保存相册）
 onBaike(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const plan = app.globalData && app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items || !plan.days[di].items[ix]) return;
  const it = plan.days[di].items[ix];
  const city = (T.segCityOfDay ? T.segCityOfDay(plan, di) : "") || plan.cityName || "";
  const info = T.baikeInfo ? T.baikeInfo(it.name, city) : null;
  // 2026-11-09：按用户要求，弹窗展示的同时把「景点网址」也复制到剪贴板（恢复原有习惯）。
  // 静默复制（不弹 toast，避免与弹窗抢层），改为在弹窗正文末尾提示"已复制网址"。
  let copied = false;
  try {
   const kw = T.baikeKeyword ? T.baikeKeyword(it.name) : "";
   // 注意：这里不用 /'/g 正则 —— check-handlers 的简易 tokenizer 会把单引号当字符串起点而吞掉后续代码。
   const url = kw ? ("https://baike.baidu.com/search/word?word=" + encodeURIComponent(kw).split("'").join("%27")) : "";
   if (url) { wx.setClipboardData({ data: url }); copied = true; }
  } catch (err) {}
  if (!info || info.has === false || !info.text) {
   wx.showToast({ title: "该地点暂未收录百科" + (copied ? "，网址已复制" : ""), icon: "none" });
   return;
  }
  const content = info.text + (copied ? "\n\n（景点网址已复制，可粘贴到浏览器打开）" : "");
  wx.showModal({
   title: info.title || it.name, content: content,
   confirmText: "知道了", showCancel: false
  });
 },

 onRemind() {
  try {
   const plan = app.globalData && app.globalData.plan;
   const item = plan && this._remindItem(plan);
   if (!item) { wx.showToast({ title: "行程还没有出发日期", icon: "none" }); return; }
   const items = ["加入手机日历（离线，到点响铃）"];
   const itemsUse = C.R.subscribeAvailable() ? items.concat(["订阅微信服务通知"]) : items;
   wx.showActionSheet({
    itemList: itemsUse,
    success: (r) => {
     const idx = Number(r && r.tapIndex);
     if (idx === 0) {
      C.R.addToCalendar(item).then((okd) => {
       C.R.add(Object.assign({}, item, { via: "calendar" }));
       if (okd) { wx.showToast({ title: "已加入手机日历", icon: "none" }); return; }
       // 2026-11-09：小程序没有写系统日历的 API → 直接给 .ics 文件（发送到聊天，点开即可导入）
       this._shareICS(plan);
      });
     } else if (idx === 1) {
      C.R.requestSubscribe().then(() => {
       C.R.scheduleCloud(item).then((okd) => {
        C.R.add(Object.assign({}, item, { via: okd ? "cloud" : "local" }));
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
   const due = C.R.dueToday();
   if (!due.length) return;
   const it = due[0];
   C.R.ack(it.id);
   if (C.R.cloudReady()) return;   // 云端会发，不必再打扰
   wx.showModal({
    title: "出发提醒",
    content: it.title + "（" + it.date + "）" + (it.note ? "\n" + it.note : ""),
    confirmText: "知道了",
    showCancel: false
   });
  } catch (e) {}
 },

 // v1.19.78：出发提醒 —— 没有服务端时，唯一真能响铃的通道是「加入手机日历」，
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
};
