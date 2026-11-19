const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const S = require("../../utils/store.js");   // v1.20.4 #81：统一存储出口
const T = require("../../utils/travel.js");
const app = getAppSafe();
// plan：每日行程浏览 + 详情 + 导航/百科/想玩 + 手动调整 + 按想玩重新生成
//
// T4：原本 1708 行的单文件按职责拆到同目录 5 个模块 + 1 个共享上下文，本文件只留
//   「页面数据 + 生命周期 + 组装」。方法体原样搬运（tools/dev/page-split.mjs），
//   所以 this 语义与 WXML 绑定名一字未变；成员集合与逐方法体由
//   tools/dev/_page-members-snapshot.mjs 的快照比对兜住。
//   门禁里那些「按源码文本断言」的检查（onBaike / 分享卡 / 提醒）改走
//   tools/lib/page-src.mjs：断言面是「页面 + 同目录模块」，强度不减。
const C = require("./plan-ctx.js");
const P_RENDER = require("./p-render.js");
const P_EDIT = require("./p-edit.js");
const P_SVC = require("./p-svc.js");
const P_SHARE = require("./p-share.js");
const P_NOTE = require("./p-note.js");
const { _preloadSubMods, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

Page(SafePage(Object.assign({

 data: {
    fz: 1,
  td: false,
  view: [], summary: "", stats: "", mixTxt: "",
  metaChips: [], budgetLine: "", modeTxt: "", pickTxt: "",
  clothText: "", stayText: "", goText: "", guideOpen: false,
  open: -1, detailText: "", detailName: "", detailTags: [], timing: null, routeOpen: -1, offlineHow: "",
  isFav: false, favReady: false,
  wishMiss: [], wishAll: 0, wishPlan: [],
  // P2：方案切换（leisure / balance / speed 循环）
  altIdx: 1,
  altNames: ["轻松休闲", "平衡舒适", "特种兵打卡"],
  hasPlan: true,
  altPaces: ["leisure", "balance", "speed"],
  // 全省 · 省内精华游（isProv 时隐藏单城专属控件）
  isProv: false,
  // 行程天气卡（和风天气；失败静默隐藏）
  wxShow: false, wxList: [], wxOff: false, wxIsMulti: false, wxLoading: false,
  // v1.19.153：天气失败态可辨识（不再一律「天气暂不可用」）
  wxErrType: "", wxErrTitle: "", wxErrMsg: "", wxErrRetry: false,
  // 雨雪天备选：目的地有雨/雪时推荐室内或雨/雪景友好景点
  rainyShow: false, rainySpots: [], rainyKinds: [], rainyKindsTx: "",
  wxLongTripHint: false, // v1.19.182：行程 >7 天，仅前 7 天有预报的兜底提示
  // v1.6：城市速览 / 倒计时
  brief: null, briefOpen: false, countdown: null,
  // v1.18：天气卡 / 想玩未排上列表默认收起（减法：首屏更轻）
  wxOpen: true, wishOpen: false,
  // v1.8.4 A1/B12/B17：人流提示 / 单日卡点 / 城市打分贴士
  hints: [], cityNote: null, cnOpen: false, cnScore: 0, cnTips: "", cnToggleTx: "去打分 ▾",
  // v1.8.5 C5：顶部天数快速导航
  topDays: [], dsActive: -1,
  // v1.19.77：拖动排序（dragSh 为逐条预计算的 transform 字符串，WXML 只做数组取值）
  dragOn: false, dragDi: -1, dragI: -1, dragSh: [],
  // 2026-11-09：换景点选择面板 / 移到其他天
  swapOpen: false, swapDi: -1, swapIx: -1, swapCur: "", swapList: [], swapWish: [],
  moveOpen: false, moveDi: -1, moveIx: -1, moveDays: [],
  // v1.19.78：城市深度玩法（随 subai 分包懒加载；未收录城市保持 null → UI 自动不显示）
  deep: null,
  // v1.19.179：「我的攻略」本地库——当前行程是否已保存到库（命中签名则回显「已保存」）
  savedId: "", savedAt: 0,
  // 行程页 AI 答疑（云端强模型优先，离线规则引擎兜底）
  aiOpen: false, aiInput: "", aiAnswer: "", aiLoading: false, aiSource: "", aiErr: ""
 },
  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：onShow 是行程页唯一入口，任何异常都不得导致白屏（无数据时优雅回首页）
  onLoad() { this.__boot = T.ready().catch(() => null); _preloadSubMods(); },
  onShow() { onShowRender(this, "plan"); },
  // v1.19.179：「保存到我的攻略」——复用既有本地行程存档(miniPlansV1)，下次从「更多 → 我的行程」或「我的攻略」库打开
  onSavePlan() {
    try {
      const plan = app.globalData && app.globalData.plan;
      if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "暂无行程可保存", icon: "none" }); return; }
      const wasSaved = !!this.data.savedId;
      const r = T.savePlanSlot(plan);   // 同 sig 自动覆盖，不堆积
      if (!r) { wx.showToast({ title: "保存失败", icon: "none" }); return; }
      this.setData({ savedId: r.id });
      wx.showToast({ title: wasSaved ? "已更新我的攻略" : "已保存到我的攻略", icon: "none" });
    } catch (e) { wx.showToast({ title: "保存失败，请重试", icon: "none" }); }
  },
 toggleGuide() { this.setData({ guideOpen: !this.data.guideOpen }); },
}, P_RENDER, P_EDIT, P_SVC, P_SHARE, P_NOTE)));
