// splash：冷启动开机画面（品牌仪式感 + 短时长自动进入首页，点按可跳过）
// 仅冷启动出现（微信热启动回到上次页面，不会走到这里），时长 ~1.3s 内完成，
// 避免拖慢「打开」。onHide 取消定时器，防止 E2E/切后台时意外抢跳转。
const T = require("../../utils/travel.js");
const app = getApp();
const KEEP_MS = 1250;   // 入场动画 0~0.95s，留缓冲后自动进入
const FADE_MS = 200;    // 离场淡出时长

Page({
  onShareAppMessage() {
    const n = (T.D && T.D.CITIES && T.D.CITIES.length) || 0;
    return { title: n + " 城旅行攻略生成，离线免注册", path: "/pages/index/index" };
  },

  data: {
    out: false,          // 离场淡出态
    v: T.APP_VER || "1.8.2"   // 跟随 APP_VER，避免发版后此处残留旧版本号
  },

  onLoad() {
    // v1.19.66：开机页**既不等数据、也不触发数据加载**，固定 KEEP_MS 后进首页。
    this._arm();
  },
  // 双保险：onLoad 若被异常打断，onReady / onShow 再兜一次，保证跳转一定会被排上
  onReady() { this._arm(); },
  onShow() { this._arm(); },
  _arm() {
    if (this._gone || this._t) return;
    try { this._t = setTimeout(() => this.enter(), KEEP_MS); } catch (e) { this.enter(); }
  },

  onUnload() { this._clear(); },
  // ⚠️ 故意**不在 onHide 清定时器**：小程序启动瞬间常会触发一次 onHide，
  //    一旦把跳转定时器清掉，开机页就永远停在这里 —— 观感就是「黑屏」。

  _clear() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._hard) { clearTimeout(this._hard); this._hard = null; }
  },

  enter() {
    this._clear();
    if (this._gone) return;
    this._gone = true;
    // ⚠️ v1.19.69：绝**不**先把内容置透明（sp-out = opacity:0）。
    //    「透明内容 + 深色页底 #0a0f1c」= 纯黑屏（这正是此前卡在 splash 却全黑的原因）。
    //    改为：先把页面跳走，**跳成功才淡出**；跳不动就保持内容可见，用户可点按重试。
    const self = this;
    const go = (method) => new Promise((res) => {
      try {
        const opt = { url: "/pages/index/index", success: () => res(true), fail: () => res(false) };
        if (method === "switchTab") wx.switchTab(opt); else wx.reLaunch(opt);
      } catch (e) { res(false); }
    });
    (async () => {
      for (const m of ["switchTab", "reLaunch", "reLaunch"]) {
        if (await go(m)) { try { self.setData({ out: true }); } catch (e) {} return; }
        await new Promise((r) => setTimeout(r, 150));
      }
      // 三级都失败：内容保持可见（绝不黑屏），点按可再次重试
    })();
  },

  // 点按任意处：重置 _gone 让"跳页失败后"也能再试一次，绝不点了没反应
  skip() { this._gone = false; this._clear(); this.enter(); }
});
