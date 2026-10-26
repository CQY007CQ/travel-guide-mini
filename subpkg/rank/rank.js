const { getAppSafe, SafePage } = require("../../utils/app.js");
// rank：旅行排行榜 —— 多档位对比 · 名次并列跳号 · 只排真实档案不造示例对手
// 数据全部来自 utils/rank.js（从记账/足迹/行程/笔记的真实记录算出）
const R = require("../../utils/rank.js");

Page(SafePage(SafePage({
  // v1.17.12 同款：定义转发才显示右上角「转发」
  onShareAppMessage() {
    return { title: "旅行排行榜 · 看看谁走得最远", path: "/subpkg/rank/rank" };
  },

  data: {
    ready: false,
    metric: R.DEFAULT_METRIC,
    metrics: [],
    list: [],
    me: null,
    total: 0,
    noData: false,
    metricName: "",
    metricUnit: "",
    metricDesc: "",
    // 新增档案
    adding: false,
    draftName: "",
    msg: "",
  },

  onLoad() {
    R.ensureMine();
    this.load();
  },

  load() {
    R.loadRanks(this.data.metric).then((r) => {
      this.setData({
        ready: true,
        metric: r.metric,
        metrics: r.allMetrics,
        list: r.list,
        me: r.me,
        total: r.total,
        noData: r.noData,
        metricName: r.metricName,
        metricUnit: r.metricUnit,
        metricDesc: r.metricDesc,
      });
    }).catch((e) => {
      this.setData({ ready: true, msg: "榜单读取失败，请下拉重试" });
    });
  },

  onShow() {
    // 从记账/足迹页返回时刷新自己的快照 —— 但只在已经载入过一次后，
    // 否则会把「刚 open 就写入」变成一种副作用。
    if (this.data.ready) this.reloadMine();
  },

  /* 只刷新自己那一份指标，别人的名次不动 —— 名次稳定性优先于「实时」 */
  reloadMine() {
    R.refreshMine();
    this.load();
  },

  onMetric(e) {
    const k = e.currentTarget.dataset.k;
    if (!k || k === this.data.metric) return;
    this.setData({ metric: k });
    this.load();
  },

  /* ── 档案管理 ── */
  onAddToggle() {
    this.setData({ adding: !this.data.adding, draftName: "", msg: "" });
  },
  onNameInput(e) {
    this.setData({ draftName: e.detail.value });
  },
  onAdd() {
    const n = (this.data.draftName || "").trim();
    if (!n) {
      // 空名字不是「随便起一个」，是让用户知道该起 —— 静默代填反而让人困惑
      this.setData({ msg: "给这份档案起个名字，比如「同行的小林」" });
      return;
    }
    // 快照取当前真实记录：新建的档案从此刻起有数据，
    // 之后要靠「刷新我的数据」跟进 —— 不假装它已经有历史。
    R.addProfile(n, R.metricsOf());
    this.setData({ adding: false, draftName: "", msg: "已加入榜单（从当前记录起算）" });
    this.load();
  },
  onRenameMe(e) {
    const v = (e.detail.value || "").trim();
    if (!v || !this.data.me) return;
    if (!R.renameProfile(this.data.me.id, v)) {
      this.setData({ msg: "改名失败，请重试" });
      return;
    }
    this.setData({ msg: "" });
    this.load();
  },
  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || "这份档案";
    if (this.data.total <= 1) {
      this.setData({ msg: "榜单至少要保留一份档案" });
      return;
    }
    const d = this.showModal("移除「" + name + "」？", "移除后它不再参与排名，已记录的数据不受影响。");
    Promise.resolve(d).then((ok) => {
      if (!ok) return;
      R.removeProfile(id);
      this.setData({ msg: "" });
      this.load();
    });
  },
  onSetMe(e) {
    const id = e.currentTarget.dataset.id;
    if (!R.setMe(id)) return;
    this.setData({ msg: "" });
    this.load();
  },
  onRefreshMine() {
    R.refreshMine();
    this.setData({ msg: "已按当前记录刷新" });
    this.load();
  },

  /* ── 名次文案 ── */
  rankText(i) {
    return i < 3 ? ["", "🥇", "🥈", "🥉"][i] || String(i + 1) : String(i + 1);
  },
  fmtVal(v) {
    const n = Number(v);
    if (!isFinite(n)) return "0";
    /* 大额（支出）不显示小数位，免得榜单列宽跳动 */
    return Math.abs(n) >= 1000 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  },

  /* 原生 modal：比自绘弹层可靠，且返回 Promise（成功 true / 取消 false） */
  showModal(title, content) {
    return new Promise((res) => {
      try {
        wx.showModal({
          title: title, content: content, showCancel: true,
          confirmColor: "#d4a94e",
          success: (r) => res(!!r.confirm),
          fail: () => res(false),
        });
      } catch (e) { res(false); }
    });
  },

  onPullDownRefresh() {
    this.reloadMine();
    setTimeout(() => { try { wx.stopPullDownRefresh(); } catch (e) {} }, 300);
  },
})));