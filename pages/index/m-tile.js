// pages/index/m-tile.js —— 首页磁贴与草稿（功能入口 / 草稿恢复与保存）（从 index.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./index-ctx.js");
const { app, AN, T, S, R, PACE_TXT, MODE_TXT, iso, _uniqRecent } = C;

module.exports = {
  // v1.7：快捷入口（tabBar 页用 switchTab，其余 navigateTo）
  // v1.19.38：导航失败时给出可见提示（避免「点了没反应」无从排查）；子包页加 loading 反馈；
  // dataset 取 currentTarget，缺失时回退 target，双保险。
  goTile(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) ||
               (e && e.target && e.target.dataset) || {};
    const url = ds.url;
    const focus = ds.focus;
    // v1.20.3：磁贴带定位意图时先写入存储，plan 页 onShow 读后自动滚动/展开对应区块
    if (focus) { S.set("miniFocusV1", String(focus)); }
    if (!url) { wx.showToast({ title: "该入口暂不可用", icon: "none" }); return; }
    const isTab = ["/pages/plan/plan", "/pages/today/today", "/pages/more/more"].indexOf(url) >= 0;
    if (isTab) {
      wx.switchTab({
        url,
        fail: (err) => wx.showToast({ title: "切换失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" })
      });
    } else {
      wx.showLoading({ title: "打开中" });
      wx.navigateTo({
        url,
        success: () => wx.hideLoading(),
        fail: (err) => { wx.hideLoading(); wx.showToast({ title: "打开失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" }); }
      });
    }
  },

  // 使用指南（独立页，随时可看）
  // v1.19.39：导航失败给出可见提示（避免「打不开」无从排查）；加 loading；栈满退回 redirectTo 仍尽量打开
  goGuide() {
    // v1.18：看过指南即视为已引导，首页不再常驻提示横幅（一次性轻提示）
    try { S.set("miniGuideSeenV1", 1); } catch (e) {}
    this.setData({ guideSeen: true });
    wx.showLoading({ title: "打开中" });
    wx.navigateTo({
      url: "/subpkg/guide/guide",
      success: () => wx.hideLoading(),
      fail: (err) => {
        // 导航栈满等极端情况下，退回 redirectTo 仍尽量打开指南
        wx.redirectTo({
          url: "/subpkg/guide/guide",
          success: () => wx.hideLoading(),
          fail: () => { wx.hideLoading(); wx.showToast({ title: "打开失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" }); }
        });
      }
    });
  },

  // v1.19.132：首次进入（从未打开过）自动打开「使用指南」页（真正的 18 条速查条）
  // 仅此一次：触发即写入标记，之后即便未细看也不再弹；随时可点「更多 / 使用指南」重看。
  maybeShowGuideModal() {
    if (this._guideModalShown) return;
    try { if (S.get("firstGuidePopupV1", 0)) { this._guideModalShown = true; return; } } catch (e) {}
    this._guideModalShown = true;
    try { S.set("firstGuidePopupV1", 1); } catch (e) {}
    this.goGuide();
  },

  // v1.8.4 B18：预约提醒 → 出行准备页
  goPrep() { wx.navigateTo({ url: "/subpkg/prep/prep" }); },

  saveDraftNow() {
    const cfg = this._collectCfg();
    if (!cfg.cityName && !cfg.provMode && !(cfg.multiRoute && cfg.multiRoute.length)) {
      wx.showToast({ title: "请先选好目的地再存草稿", icon: "none" }); return;
    }
    const d = { id: Date.now() + "_" + Math.floor(Math.random() * 1000), name: this._draftName(cfg), ts: Date.now(), cfg };
    const list = S.saveDraft(d);
    this.setData({ drafts: list, draftCount: list.length });
    wx.showToast({ title: "已存草稿（共 " + list.length + " 条）", icon: "none" });
  },

  delDraftItem(e) {
    const id = e.currentTarget.dataset.id;
    const self = this;
    wx.showModal({
      title: "删除这条草稿？",
      content: "删除后无法恢复",
      confirmText: "删除",
      success(r) { if (r.confirm) { const list = S.delDraft(id); self.setData({ drafts: list, draftCount: list.length }); } }
    });
  },

  applyDraft(e) {
    const id = e.currentTarget.dataset.id;
    const d = (this.data.drafts || []).find(x => x && x.id === id);
    if (!d) return;
    this._applyDraft(d.cfg);
    this.setData({ showDraft: false });
    wx.showToast({ title: "已恢复草稿「" + d.name + "」", icon: "none" });
  },

  openDrafts() {
    const list = (S.getDrafts() || []).map(x => Object.assign({}, x, { timeTxt: this._draftTimeTxt(x.ts) }));
    this.setData({ drafts: list, draftCount: list.length, showDraft: true });
  },

  closeDrafts() { this.setData({ showDraft: false }); },

  /* ---- v1.19.58：行程草稿（保存 / 恢复首页配置） ---- */
  _draftName(cfg) {
    if (cfg.provMode) return (cfg.provName || "全省") + " · 全省精华 · " + (cfg.days || 0) + " 天";
    if (cfg.multiMode) {
      const rs = (cfg.multiRoute || []).map(s => s.name).join("→");
      const tot = this._sumDays(cfg.multiRoute || []);
      return rs + " · 共 " + tot + " 天";
    }
    return (cfg.cityName || "未选城市") + " · " + (cfg.days || 0) + " 天";
  },

  _draftTimeTxt(ts) {
    if (!ts) return "";
    const dt = new Date(ts), now = new Date();
    const hhmm = S.fmtHM(dt);   // v1.20.8（T2）：收敛到 store.js 单点
    if (dt.toDateString() === now.toDateString()) return "今天 " + hhmm;
    return (dt.getMonth() + 1) + "月" + dt.getDate() + "日 " + hhmm;
  },
};
