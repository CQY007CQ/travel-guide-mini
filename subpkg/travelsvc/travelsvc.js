const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// 旅客服务中心：AI 行程助手 / 动态提醒 / 离线能力 / 多语言多币种 / 安全与合规
// 全部离线、零网络、零新增依赖；不可做项如实标注，不夸大、不伪造。
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");
const EL = require("../../utils/errlog.js");
const SVC = require("../utils/travel-service.js");
const app = getAppSafe();

const CURRENCIES = Object.keys(SVC.DEFAULT_RATES).filter(k => k !== "CNY");
const LANG_KEY = "svcLangV1", RATE_KEY = "svcRatesV1", SNAP_KEY = "svcWxSnapV1";

// 预计算三态标识（离线 / 需联网 / 不适用），WXML 不做嵌套三元
function offlineView(lang) {
  return SVC.OFFLINE_ITEMS.map(function (x) {
    return Object.assign({}, x, {
      badgeTx: x.mode === "offline" ? SVC.t("offlineBadge", lang)
        : (x.mode === "online" ? SVC.t("onlineBadge", lang) : SVC.t("naBadge", lang)),
      tagCls: x.mode === "offline" ? "ok" : (x.mode === "online" ? "mid" : "no")
    });
  });
}

function readWeatherCache() {
  try {
    if (typeof wx === "undefined" || !wx.getStorageSync) return null;
    const idx = wx.getStorageSync("wxcacheIdxV1") || [];
    if (!idx.length) return null;
    const k = idx[idx.length - 1] && idx[idx.length - 1].k;
    if (!k) return null;
    const o = wx.getStorageSync("wxcacheV1." + k);
    return (o && o.v && typeof o.v === "object") ? o.v : null;
  } catch (e) { return null; }
}

Page(SafePage({
  data: {
    fz: 1, td: false,
    lang: "zh",
    tx: {},                 // 当前语言文案（由 _applyLang 填）
    privacy: SVC.PRIVACY_SECTIONS,
    offline: [],
    crowd: SVC.CROWD_HINTS,
    phrases: SVC.PHRASES,
    wxDeltas: [], wxNote: "", fcUpdates: [], fcNote: "",
    statPlan: 0, statWish: 0, statSpent: 0,
    cny: "", curIdx: 0, curNames: [], curKey: "", curRate: "", convResult: "",
    rates: SVC.DEFAULT_RATES, rateEdit: "", rateOpen: false
  },

  onLoad() {
    this.__boot = T.ready().catch(() => null);
    // 恢复本机偏好（语言 / 自定义汇率），失败一律回落默认，绝不阻断启动
    let lang = "zh", rates = SVC.DEFAULT_RATES;
    try {
      lang = S.get(LANG_KEY, "zh") === "en" ? "en" : "zh";
      const saved = S.get(RATE_KEY, null);
      if (saved && typeof saved === "object") rates = Object.assign({}, SVC.DEFAULT_RATES, saved);
    } catch (e) { try { EL.push("travelsvc.onLoad", e); } catch (_) {} }
    this.setData({ rates });
    this._applyLang(lang);
  },
  onShow() { onShowRender(this, "travelsvc", null, () => { this._refresh(); }); },
  _renderShow() { try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {} },

  _applyLang(lang) {
    const tx = {};
    Object.keys(SVC.I18N.zh).forEach(k => { tx[k] = SVC.t(k, lang); });
    this.setData({
      lang, tx, offline: offlineView(lang),
      curNames: CURRENCIES.map(k => SVC.CUR_NAMES[k] + " (" + k + ")"),
      crowdNote: SVC.t("crowdNote", lang)
    });
  },
  toggleLang() {
    const lang = this.data.lang === "zh" ? "en" : "zh";
    try { S.set(LANG_KEY, lang); } catch (e) { try { EL.push("travelsvc.lang", e); } catch (_) {} }
    this._applyLang(lang); this._refresh();
  },

  _refresh() {
    // ① 天气变化：直接用天气模块已落盘的缓存，零网络
    const cache = readWeatherCache();
    const keys = cache ? Object.keys(cache).sort() : [];
    let deltas = [], note = "";
    if (keys.length >= 2) {
      deltas = SVC.weatherDelta(cache[keys[0]], cache[keys[1]]);
      if (!deltas.length) note = this.data.lang === "zh" ? "近两日天气变化不大，按原计划走即可。" : "Little change in the next two days.";
    } else {
      note = this.data.lang === "zh"
        ? "暂无两天的预报缓存；去「行程」页加载一次天气后回来即可看到变化提醒。"
        : "No cached two-day forecast yet. Load weather on the Plan page first.";
    }
    // ①b 预报更新：与上次落盘的同一天预报对比；首次只记录，不虚报
    let fcUpdates = [], fcNote = "";
    try {
      if (keys.length) {
        const today = cache[keys[0]];
        const snap = S.get(SNAP_KEY, null);
        if (snap && snap.date === keys[0]) fcUpdates = SVC.forecastDelta(snap.day, today);
        else fcNote = this.data.lang === "zh" ? "已记录本次预报，下次打开可对比预报更新。" : "Forecast saved; revisit to see updates.";
        S.set(SNAP_KEY, { date: keys[0], day: today });
      }
    } catch (e) { try { EL.push("travelsvc.forecast", e); } catch (_) {} }
    // ② 本地数据统计（真实读取，不编造）
    let plan = 0, wish = 0, spent = 0;
    try { const p = app.globalData && app.globalData.plan; plan = (p && p.days && p.days.length) || 0; } catch (e) { try { EL.push("travelsvc.statPlan", e); } catch (_) {} }
    try { wish = (T.getWish() || []).length; } catch (e) { try { EL.push("travelsvc.statWish", e); } catch (_) {} }
    try { spent = Math.round(T.totalSpent()); } catch (e) { try { EL.push("travelsvc.statSpent", e); } catch (_) {} }
    this.setData({ wxDeltas: deltas, wxNote: note, fcUpdates, fcNote, statPlan: plan, statWish: wish, statSpent: spent });
    this._convert();
  },

  goIndex() { try { wx.switchTab({ url: "/pages/index/index" }); } catch (e) {} },
  goMore() { try { wx.switchTab({ url: "/pages/more/more" }); } catch (e) {} },

  doBackup() {
    let s = "";
    try { s = T.exportBackup(); } catch (e) { s = ""; try { EL.push("travelsvc.export", e); } catch (_) {} }
    if (!s) { wx.showToast({ title: "导出失败", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: s, success: () => wx.showToast({ title: "备份已复制", icon: "none" }) });
    } catch (e) { try { EL.push("travelsvc.clipboard", e); } catch (_) {} wx.showToast({ title: "复制失败", icon: "none" }); }
  },

  // 多币种参考换算（汇率可改，非实时、不参与记账）
  onCny(e) { this.setData({ cny: e.detail.value }, () => this._convert()); },
  onCur(e) { this.setData({ curIdx: Number(e.currentTarget.dataset.i) || 0 }, () => this._convert()); },
  onCurChange(e) { this.setData({ curIdx: Number(e.detail.value) || 0 }, () => this._convert()); },
  _convert() {
    const cur = CURRENCIES[this.data.curIdx] || CURRENCIES[0];
    const v = SVC.convert(this.data.cny, cur, this.data.rates);
    this.setData({
      convResult: v, curKey: cur,
      curRate: String(this.data.rates[cur]),
      rateEdit: String(this.data.rates[cur])
    });
  },
  toggleRate() { this.setData({ rateOpen: !this.data.rateOpen }); },
  onRateInput(e) { this.setData({ rateEdit: e.detail.value }); },
  saveRate() {
    const cur = CURRENCIES[this.data.curIdx] || CURRENCIES[0];
    const n = parseFloat(this.data.rateEdit);
    if (!(n > 0)) { wx.showToast({ title: "汇率须为正数", icon: "none" }); return; }
    const rates = Object.assign({}, this.data.rates);
    rates[cur] = n;
    try { S.set(RATE_KEY, rates); } catch (e) { try { EL.push("travelsvc.saveRate", e); } catch (_) {} }
    this.setData({ rates, rateOpen: false }, () => this._convert());
    wx.showToast({ title: "已更新（仅本机参考）", icon: "none" });
  },

  onShareAppMessage() {
    return { title: "旅客服务中心：离线能力 · 隐私合规 · 境外旅客参考", path: "/pages/index/index" };
  }
}));
