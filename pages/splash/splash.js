// splash：冷启动开机画面（品牌仪式感 + 短时长自动进入首页，点按可跳过）
// 仅冷启动出现（微信热启动回到上次页面，不会走到这里），时长 ~1.3s 内完成，
// 避免拖慢「打开」。onHide 取消定时器，防止 E2E/切后台时意外抢跳转。
//
// ⚠️ v1.19.82「黑屏」根治 · 两处改动：
//   1) 底色跟随主题（浅色主题用浅底，不再无条件糊深色）——见 splash.wxss。
//   2) 三级跳转失败后不再「静默停住」：起看门狗持续重试，直到页面真的被卸载。
//      此前三级都失败时既不重试也不提示，用户不点就永远停在这一屏。
//      注意：**不要用 onHide 判定已离开**（启动瞬间微信常触发一次假 onHide，
//      会误判成已离开从而停止重试）——只用 onUnload。
const T = require("../../utils/travel.js");
const app = getApp();
const KEEP_MS = 1250;   // 入场动画 0~0.95s，留缓冲后自动进入
const WD_MS = 700;      // 看门狗重试间隔

Page({
  onShareAppMessage() {
    const n = (T.D && T.D.CITIES && T.D.CITIES.length) || 0;
    return { title: n + " 城旅行攻略生成，离线免注册", path: "/pages/index/index" };
  },

  data: {
    v: T.APP_VER || "1.8.2",   // 跟随 APP_VER，避免发版后此处残留旧版本号
    dark: false                // 仅当用户确实处于暗色主题时才用深色开屏
  },

  onLoad() {
    this._syncTheme();
    // v1.19.66：开机页**既不等数据、也不触发数据加载**，固定 KEEP_MS 后进首页。
    this._arm();
  },
  // 双保险：onLoad 若被异常打断，onReady / onShow 再兜一次，保证跳转一定会被排上
  onReady() { this._arm(); },
  onShow() { this._syncTheme(); this._arm(); },

  // themeMode() 只读本地 store + 当前时间，**不依赖任何数据加载**，可安全同步调用
  _syncTheme() {
    let isDark = false;
    try { isDark = T.themeMode() === "dark"; } catch (e) { isDark = false; }
    if (isDark !== this._darkNow) {
      this._darkNow = isDark;
      try { this.setData({ dark: isDark }); } catch (e) {}
    }
  },

  _arm() {
    if (this._gone || this._t) return;
    try { this._t = setTimeout(() => this.enter(), KEEP_MS); } catch (e) { this.enter(); }
  },

  // 页面确实被卸载（= 已跳走）才停手。onHide 不可靠，刻意不用。
  onUnload() { this._left = true; this._clear(); },
  // ⚠️ 故意**不在 onHide 清定时器**：小程序启动瞬间常会触发一次 onHide，
  //    一旦把跳转定时器清掉，开机页就永远停在这里 —— 观感就是「黑屏」。

  _clear() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._wd) { clearInterval(this._wd); this._wd = null; }
  },

  enter() {
    this._clear();
    if (this._gone) return;
    this._gone = true;
    this._leave();
  },

  _leave() {
    if (this._left) return;
    const self = this;
    const go = (method) => new Promise((res) => {
      try {
        const opt = { url: "/pages/index/index", success: () => res(true), fail: () => res(false) };
        if (method === "switchTab") wx.switchTab(opt); else wx.reLaunch(opt);
      } catch (e) { res(false); }
    });
    (async () => {
      for (const m of ["switchTab", "reLaunch", "reLaunch"]) {
        if (self._left) return;
        if (await go(m)) return;   // 已跳走：由 onUnload 标记 _left
        await new Promise((r) => setTimeout(r, 150));
      }
      // 三级都失败：起看门狗持续重试，绝不静默停在开屏页
      self._watch();
    })();
  },

  // v1.19.82 看门狗：只要本页还没被卸载，就每 WD_MS 重试一次 reLaunch。
  // 内容始终可见（见 wxss 的 opacity 兜底），用户点按也能立刻再试。
  _watch() {
    if (this._left || this._wd) return;
    const self = this;
    this._wd = setInterval(() => {
      try {
        if (self._left) { clearInterval(self._wd); self._wd = null; return; }
        wx.reLaunch({ url: "/pages/index/index" });
      } catch (e) {}
    }, WD_MS);
  },

  // 点按任意处：重置 _gone 让"跳页失败后"也能再试一次，绝不点了没反应
  skip() { this._gone = false; this._clear(); this.enter(); }
});
