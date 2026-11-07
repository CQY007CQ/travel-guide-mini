const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");
// 「按标签找景点」：用 utils/spot-tags.js 的 50 维词库标注全部景点，
// 由 utils/spotsearch.js 的倒排索引 + IDF 加权检索，从用户目标词条高效精确锁定景点。
const T = require("../../utils/travel.js");
const ST = require("../../utils/spot-tags.js");
const SS = require("../utils/spotsearch.js");
const app = getAppSafe();

const DIM_ORDER = ["theme", "activity", "audience", "season", "mood", "duration", "price"];
const EXAMPLES = [
  { t: "人少的古镇", q: "人少的古镇" },
  { t: "带娃看海", q: "带娃 海边" },
  { t: "雪山秘境", q: "雪山 小众" },
  { t: "免费海岛", q: "免费 海岛" },
  { t: "秋天红叶", q: "秋天 看红叶" },
  { t: "滑雪温泉", q: "滑雪 温泉" }
];

Page(SafePage({
  onShareAppMessage() {
    return { title: "按标签找景点：说想怎么玩，精确锁定目的地", path: "/pages/index/index" };
  },

  data: {
    fz: 1, td: false,
    qText: "",
    dimGroups: [],          // [{dim,label,chips:[{key,label,on}]}]
    activeTags: [],         // 当前选中的 tag key
    scope: "all",
    scopeType: "all",       // all | city | prov
    scopeOptions: [{ k: "all", t: "全部城市", type: "all" }],
    results: [],
    stat: "",
    mode: "empty",
    hint: "点上方标签，或输入想找的景点名 / 关键词，如：雪山 / 古镇 / 免费",
    showClear: false,
    examples: EXAMPLES
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() {
    this.__boot = T.ready().catch(() => null);
    this._buildDimGroups();
  },

  onShow() {
    try { AN.pageView("spotsearch"); } catch (e) {}
    this.setData({ fz: T.fontScale() });
    (this.__boot || Promise.resolve()).then(() => {
      try {
        this._theme();
        // 后台预热倒排索引，首次搜索秒回
        try { SS.prefetch(T.D); } catch (e) {}
        // 行程范围快捷筛选：有单城行程则提供"仅看该城"
        const plan = app.globalData && app.globalData.plan;
        const opts = [{ k: "all", t: "全部城市", type: "all" }];
        if (plan) {
          if (plan.cityName && !plan.isProv) opts.push({ k: plan.cityName, t: "仅看 " + plan.cityName, type: "city" });
          else if (plan.isProv && plan.province) opts.push({ k: plan.province, t: "仅看 " + plan.province + "省", type: "prov" });
        }
        this.setData({ scopeOptions: opts });
      } catch (e) {}
    });
  },

  _buildDimGroups() {
    const byDim = {};
    for (let i = 0; i < ST.TAGS.length; i++) {
      const t = ST.TAGS[i];
      (byDim[t.dim] = byDim[t.dim] || []).push(t);
    }
    const groups = [];
    for (let i = 0; i < DIM_ORDER.length; i++) {
      const d = DIM_ORDER[i];
      if (!byDim[d]) continue;
      groups.push({
        dim: d,
        label: ST.DIM_LABELS[d] || d,
        chips: byDim[d].map(t => ({ key: t.key, label: t.label, on: false }))
      });
    }
    this.setData({ dimGroups: groups });
  },

  onInput(e) { this.setData({ qText: e.detail.value || "" }); },

  onSearch() {
    const t = String(this.data.qText || "").trim();
    if (!t && !this.data.activeTags.length) {
      wx.showToast({ title: "先选标签或输入关键词", icon: "none" });
      return;
    }
    this._runSearch();
  },

  onExample(e) {
    const q = e.currentTarget.dataset.q || "";
    this.setData({ qText: q });
    this._runSearch();
  },

  onTagTap(e) {
    const key = e.currentTarget.dataset.key || "";
    if (!key) return;
    const cur = this.data.activeTags;
    const next = cur.indexOf(key) >= 0 ? cur.filter(k => k !== key) : cur.concat([key]);
    this.setData({ activeTags: next });
    this._syncChips();
    this._runSearch();
  },

  _syncChips() {
    const act = new Set(this.data.activeTags);
    const groups = this.data.dimGroups.map(g => ({
      dim: g.dim, label: g.label,
      chips: g.chips.map(c => ({ key: c.key, label: c.label, on: act.has(c.key) }))
    }));
    this.setData({ dimGroups: groups, showClear: act.size > 0 || !!this.data.qText });
  },

  onScope(e) {
    const k = e.currentTarget.dataset.k || "all";
    const type = e.currentTarget.dataset.type || "all";
    if (k === this.data.scope) return;
    this.setData({ scope: k, scopeType: type });
    if (this.data.results.length || this.data.activeTags.length || this.data.qText) this._runSearch();
  },

  _runSearch() {
    let D = null;
    try { D = T.D; } catch (e) {}
    if (!D || !D.CITIES || !D.CITIES.length) {
      wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" });
      return;
    }
    const r = SS.searchSpots({
      text: this.data.qText,
      tags: this.data.activeTags,
      city: this.data.scopeType === "city" ? this.data.scope : null,
      province: this.data.scopeType === "prov" ? this.data.scope : null,
      D: D,
      limit: 80
    });
    this.setData({
      results: r.results,
      stat: r.mode === "empty" ? "" : (r.total ? ("为你锁定 " + r.total + " 个最贴合的景点") : ""),
      mode: r.mode,
      hint: r.hint,
      showClear: this.data.activeTags.length > 0 || !!this.data.qText
    });
  },

  onLocate(e) {
    const d = e.currentTarget.dataset;
    if (d && d.lat && d.lon) {
      wx.openLocation({
        latitude: Number(d.lat), longitude: Number(d.lon),
        name: d.name || "", address: (d.city || "") + " · " + (d.name || ""), scale: 15
      });
    } else {
      wx.showToast({ title: "该景点暂无坐标，用地图搜名字吧", icon: "none" });
    }
  },

  onCopy(e) {
    const n = e.currentTarget.dataset.name || "";
    if (!n) return;
    wx.setClipboardData({
      data: n,
      success: () => wx.showToast({ title: "已复制：" + n, icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" })
    });
  },

  onClear() {
    this.setData({ qText: "", activeTags: [] });
    this._syncChips();
    this.setData({ results: [], stat: "", mode: "empty", hint: "点上方标签，或输入想找的景点名 / 关键词，如：雪山 / 古镇 / 免费" });
  }
}));
