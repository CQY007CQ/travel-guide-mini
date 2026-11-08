const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// more：功能聚合（分组）+ 想玩清单（内嵌可管理）
const T = require("../../utils/travel.js");
const EL = require("../../utils/errlog.js"); // v1.19.106：本地错误日志（被 SafePage / app.onError 兜住的异常）
const KEYS = require("../../utils/keys.js"); // v1.19.188：第三方密钥统一出口（含运行时注入 setKeys）
const TOOL_GROUPS = require("../../utils/toolkit-groups.js").ITEM_GROUPS;
// v1.20.3：insights 仅 more 页用到，已从主包迁到分包 subpkg/utils，按需异步加载（主包瘦身绕开微信 1.5M 软线）。
// 微信端静态字面量 require.async；Node（allcheck / 单测）无 require.async，回退同步 require。
let INS = null, PZ = null;
function _preloadMoreMods() {
  if (typeof require.async === "function") {
    require.async("../../subpkg/utils/insights.js").then((m) => { INS = m; }).catch(() => {});
    require.async("../../subpkg/utils/personalize.js").then((m) => { PZ = m; }).catch(() => {});
  } else {
    try { INS = require("../../subpkg/utils/insights.js"); } catch (e) {}
    try { PZ = require("../../subpkg/utils/personalize.js"); } catch (e) {}
  }
}
// v1.19.138：个性化目的地推荐（真实画像驱动）—— 已从主包迁到分包，随 _preloadMoreMods 异步加载
const TOOL_TOTAL = Array.isArray(TOOL_GROUPS) ? TOOL_GROUPS.reduce((s, g) => s + (g.items ? g.items.length : 0), 0) : 0;
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1, td: false, hasPlan: false, wish: [], groups: [], ver: T.APP_VER, stamp: null, persona: null, errN: 0 },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  // v1.11：more 页聚合了十余个模块，任一数据源脏都不该整体白屏
  onLoad() { this.__boot = T.ready().catch(() => null); _preloadMoreMods(); },
  onShow() {
    try { AN.pageView("more"); } catch (e) {}
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() { try { this._theme(); this.refresh(); } catch (e) { try { wx.showToast({ title: "页面刷新异常", icon: "none" }); } catch (_) {} } },

  /* ---------- v1.7 ---------- */
  // 夜间自动深色（独立于手动主题，夜间小时段强制深色）
  onNight(e) {
    const v = !!(e.detail && e.detail.value);
    const c = T.setNightCfg({ on: v });
    this.setData({ nite: c });
    this._theme();
    wx.showToast({ title: v ? "夜间自动深色已开" : "已关闭夜间自动深色", icon: "none" });
  },
  // 首页快捷入口开关
  onTile(e) {
    const k = e.currentTarget.dataset.k;
    const cur = T.homeTiles();
    const i = cur.indexOf(k);
    if (i >= 0) cur.splice(i, 1); else cur.push(k);
    T.setHomeTiles(cur);
    this.setData({
      tiles: T.HOME_TILES.map(x => ({ k: x.k, t: x.t, ic: x.ic, on: cur.indexOf(x.k) >= 0 }))
    });
  },
  // 换一个灵感目的地
  onInspire() {
    const x = T.inspire();
    this.setData({ insp: x });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  },
  // 用灵感城市直接生成行程
  useInspire() {
    const it = this.data.insp;
    if (!it) return;
    const self = this;
    wx.showModal({
      title: "去 " + it.name + " 怎么样",
      content: "建议 " + it.days + " 天 · " + it.best + "\n用默认预算生成一份行程？",
      confirmText: "生成",
      success(r) {
        if (!r.confirm) return;
        self._gen(it.name, it.province, it.days);
      }
    });
  },
  // 收藏城市串成多站行程
  genFavTrip() {
    const route = T.favRoute(4);
    if (route.length < 2) { wx.showToast({ title: "至少先收藏 2 个城市", icon: "none" }); return; }
    const self = this;
    wx.showModal({
      title: "串联收藏的城市",
      content: route.map(r => r.name).join(" → ") + "\n每站 2 天，共 " + (route.length * 2) + " 天，出发日按下周末算",
      confirmText: "生成",
      success(r) { if (r.confirm) self._genMulti(route); }
    });
  },
  _departIn(days) {
    const d = new Date(Date.now() + (days || 7) * 86400000);
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  },
  _gen(name, province, days) {
    try {
      const depart = this._departIn(7);
      const daysArr = T.buildPlan({ city: name, province: province, days: days || 3, depart: depart, budget: "mid", pace: "balance" });
      T.resetPackChecks(); // v1.13.1：新行程落地前重置行李清单勾选
      app.setPlan({
        cityName: name, province: province, totalDays: daysArr.length,
        depart: depart, days: daysArr, budget: "mid", people: 1,
        pace: "balance", isMulti: false, savedAt: Date.now()
      });
      wx.showToast({ title: "已生成，去看看吧", icon: "none" });
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (e) {
      wx.showToast({ title: "生成失败：" + (e.message || ""), icon: "none" });
    }
  },
  _genMulti(route) {
    try {
      const depart = this._departIn(7);
      const out = T.buildMultiPlan({ route: route, depart: depart, budget: "mid", pace: "balance", people: 1 });
      T.resetPackChecks(); // v1.13.1：新行程落地前重置行李清单勾选
      app.setPlan({
        cityName: route.map(s => s.name).join(" → "),
        province: route[0].province, totalDays: out.totalDays,
        depart: depart, days: out.days, segments: out.segments, route: out.route,
        budget: "mid", people: 1, pace: "balance", isMulti: true, savedAt: Date.now()
      });
      wx.showToast({ title: "已生成多站行程", icon: "success" });
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (e) {
      wx.showToast({ title: "生成失败：" + (e.message || ""), icon: "none" });
    }
  },
  // 自动化辅助：静默设置主题（不弹 toast），供双主题截图回归调用
  setThemeQuiet(m) {
    const v = (m === "dark");
    T.setThemeMode(v ? "dark" : "light");
    this.setData({ td: v, dark: v });
    T.applyNav();
  },

  refresh() {
    const p = app.globalData.plan;
    const hasPlan = !!(p && p.days && p.days.length);
    // v1.8.5 C11：想玩清单带状态（已排进当前行程 / 已打卡去过）
    const wish = T.wishStateMark(T.getWish(), p).map((x, i) => ({
      i, name: x.name, city: x.city || "", planned: !!x.planned, visited: !!x.visited
    }));
    // C1（v1.9.1）：想玩按城市分组（多优先在前；空 city 归「未标注城市」并排最后）
    const wmap = {};
    wish.forEach(x => { const k = x.city || "未标注城市"; (wmap[k] = wmap[k] || []).push(x); });
    const wishGroups = Object.keys(wmap)
      .sort((a, b) => {
        if ((a === "未标注城市") !== (b === "未标注城市")) return a === "未标注城市" ? 1 : -1;
        return (wmap[b].length - wmap[a].length) || a.localeCompare(b, "zh");
      })
      .map(city => ({ city, items: wmap[city] }));
    // 行程存档（不含当前行程本身，避免与「旅行小结」重复展示）与足迹
    const curSig = hasPlan ? ((p.cityName || "") + "|" + p.days.length + "|" + (p.days[0] && p.days[0].date ? String(p.days[0].date).slice(0, 10) : "")) : "";
    const savedPlans = T.listSavedPlans().filter(x => x.sig !== curSig);
    const foot = T.footStats();
    // v1.8.5 C14：本地数据积累提示（备份入口文案随数据量变化）
    const bkTip = (savedPlans.length || (foot && (foot.spots || foot.cities)) || T.getNotes().length || wish.length || T.getLedger().length)
      ? "已积累本地数据，换机 / 卸载前导出一份更安心" : "行程/账本/想玩/待办 全量导出";
    this.setData({
      dark: T.themeMode() === "dark",
      themePref: T.themePref(),
      review: hasPlan ? T.tripReview(p) : null,
      hasPlan,
      wish,
      wishGroups,
      savedPlans,
      planLibN: savedPlans.length,
      foot,
      notes: T.getNotes().slice(-8).reverse(),
      ach: T.achievements(),
      // v1.9：省章进度 / 旅行人格 / 想玩骰子
      stamp: T.provStamp(),
      persona: T.travelPersona(),
      // v1.7
      heat: T.footHeatmap(),
      nite: T.nightCfg(),
      tiles: T.HOME_TILES.map(x => ({ k: x.k, t: x.t, ic: x.ic, on: T.homeTiles().indexOf(x.k) >= 0 })),
      insp: T.inspire(),
      favN: T.getFavs().length,
      // v1.8.4 B13：旅行年鉴（足迹/账本/手记/存档全量聚合）
      // v1.11：城市串 / 花销串 在 JS 里拼好，WXML 不再有 .join() 与 for+if 同节点
      yearRpt: (() => {
        const r = T.yearReport() || {};
        return Object.assign({}, r, {
          citiesTx: (Array.isArray(r.cities) ? r.cities : []).join("、"),
          topCatsTx: (Array.isArray(r.topCats) ? r.topCats : [])
            .map(c => (c && c.cat ? c.cat : "") + " ¥" + (c && c.amt != null ? c.amt : 0)).join(" · ")
        });
      })(),
      backupTip: bkTip,
      insights: INS ? INS.insights() : [],   // v1.19.137：本机数据洞察（花费结构 / 月度趋势 / 出行节奏 / 省份分布）
      personalized: PZ ? PZ.personalized(5) : {},   // v1.19.138：基于真实画像的个性化目的地推荐
      errN: EL.count(), // v1.19.106：错误日志条数，随页面刷新更新
      // 减法：无行程时只留「记账(可独立用) + 通用」，地图/美食/准备/速查待生成行程后再出现，减少空转入口
      groups: hasPlan ? [
        {
          title: "旅途中",
          menus: [
            { key: "map", icon: "map", t: "地图导引", d: "每天真实坐标标点 + 导航" },
            { key: "food", icon: "food", t: "美食名店", d: "必吃清单 + 可导航的老店" },
            { key: "deep", icon: "bulb", t: "城市深度玩法", d: "本地节奏 / 避坑 / 机位 / 顺手加一日" },
            { key: "assistant", icon: "search", t: "本地速查", d: "离线速查：天气/美食/门票/预算…" },
            { key: "toolkit", icon: "sparkle", t: "旅行百宝箱", d: "体检/文案/灵感/百科等 " + TOOL_TOTAL + " 个工具" }
          ]
        },
        {
          title: "行前与账本",
          menus: [
            { key: "prep", icon: "ticket", t: "出行准备", d: "票价预约 / 酒店比价 / 团队分工" },
            { key: "boost", icon: "sparkle", t: "行程增强", d: "体检 / 问答 / 一键换景点 / 成就" },
            { key: "ledger", icon: "wallet", t: "记账 · AA", d: "随手记一笔，对比预算" }
          ]
        },
        {
          title: "通用",
          menus: [
            { key: "backupOut", icon: "export", t: "备份到剪贴板", d: bkTip },
            { key: "backupIn", icon: "import", t: "从剪贴板恢复", d: "粘贴备份内容一键还原" }
          ]
        }
      ] : [
        {
          title: "行前与账本",
          menus: [
            { key: "ledger", icon: "wallet", t: "记账 · AA", d: "还没行程也能先随手记账" },
            { key: "deep", icon: "bulb", t: "城市深度玩法", d: "本地节奏 / 避坑 / 机位 / 顺手加一日" },
            { key: "toolkit", icon: "sparkle", t: "旅行百宝箱", d: "城市灵感池随时可用" }
          ]
        },
        {
          title: "通用",
          menus: [
            { key: "backupOut", icon: "export", t: "备份到剪贴板", d: bkTip },
            { key: "backupIn", icon: "import", t: "从剪贴板恢复", d: "粘贴备份内容一键还原" }
          ]
        }
      ]
    });
  },

  /* ---- v1.9：想玩骰子（随机抽一条想玩） ---- */
  onWishDice() {
    const d = T.wishDice();
    if (!d) { wx.showToast({ title: "想玩清单还空着，先加几个", icon: "none" }); return; }
    wx.showModal({
      title: "随机抽中「" + d.name + "」",
      content: (d.city ? "在 " + d.city + (d.days ? " · 建议 " + d.days + " 天" : "") + "\n" : "") + (d.best ? "最佳时节 " + d.best : "") + "\n\n重新生成攻略时会优先安排它",
      showCancel: false,
      confirmText: "记住它了"
    });
  },

  /* ---- v1.8.5 C12/C15/C13：足迹清单复制 · 城市详情 · 关于 ---- */
  onFootCopy() {
    const txt = T.footStoryText();
    if (!txt || txt.length < 8) { wx.showToast({ title: "还没有足迹可复制", icon: "none" }); return; }
    wx.setClipboardData({
      data: txt,
      success: () => wx.showToast({ title: "足迹清单已复制", icon: "success" })
    });
  },
  onFootCity(e) {
    const c = e.currentTarget.dataset.city;
    if (!c) return;
    const d = T.footCityDetail(c);
    if (!d || !d.list.length) return;
    // v1.19.135：带个人评价（有评价的行附「景点：评价」）
    const lines = d.list.slice(0, 12).map(x => x.note ? (x.name + "：" + x.note) : x.name);
    const more = d.list.length > 12 ? ("\n…等共 " + d.list.length + " 个") : "";
    wx.showModal({
      title: "在 " + c + " 打过卡（" + d.list.length + "）",
      content: lines.join("\n") + more,
      showCancel: false,
      confirmText: "好的"
    });
  },
  onAbout() {
    wx.showModal({
      title: "关于 旅行攻略生成器",
      content: "版本 v" + T.APP_VER + "\n\n天气与地图功能需联网，其余功能随时可用。\n\n景点与票价按通用公开资料整理，请以官方最新公告为准。\n\n祝你每次都玩得尽兴。",
      showCancel: false,
      confirmText: "好的"
    });
  },

  // v1.19.179：跳转「我的攻略」本地库
  goMyGuides() { try { wx.navigateTo({ url: "/pages/myguides/myguides" }); } catch (_) {} },

  /* 数据说明与免责声明：材料里承诺的「公开资料整理 + 免责」必须在产品内可见，
   * 否则计划书与产品不一致，属于评审可当场识破的口径问题。 */
  onDataNote() {
    wx.showModal({
      title: "数据说明",
      content:
        "美食、门票与开放时间以景区或商户当日公示为准。\n\n" +
        "坐标取自开放数据，用于地图定位与路线示意，精度有限。\n\n" +
        "应急页的医院仅列出已核验机构，未收录的城市只提供地图搜索入口，不列具体医院名。\n\n" +
        "行程与推荐为通用建议，不替代官方发布的安全与交通提示。\n\n" +
        "数据整理更新至 2026 年 11 月。",
      showCancel: false,
      confirmText: "好的"
    });
  },

  /* 旅途应急：跳转应急页（分诊常识 + 就近医院，只做信息展示，不给诊疗建议） */
  onHelp() {
    wx.navigateTo({ url: "/pages/help/help", fail: () => wx.showToast({ title: "打开失败，请重试", icon: "none" }) });
  },

  /* ---- v1.19.106：本地错误日志查看（被 SafePage / app.onError 兜住的异常回溯） ---- */
  onErrLog() {
    const n = EL.count();
    if (!n) { wx.showToast({ title: "暂无异常记录 ✓", icon: "none" }); return; }
    const list = EL.recent().slice(-10).reverse();
    const pad = (x) => String(x).padStart(2, "0");
    const tx = list.map((x, i) => {
      const d = new Date(x.t || Date.now());
      const ts = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      return (i + 1) + ". " + ts + " [" + (x.label || "") + "] " + (x.msg || "");
    }).join("\n");
    wx.showModal({
      title: "运行异常日志（最近 " + n + " 条）",
      content: tx,
      confirmText: "复制日志",
      cancelText: "清空记录",
      success: (r) => {
        if (r.confirm) {
          wx.setClipboardData({ data: tx, success: () => wx.showToast({ title: "已复制日志", icon: "none" }) });
        } else if (r.cancel) {
          EL.clear();
          this.setData({ errN: 0 });
          wx.showToast({ title: "已清空日志", icon: "none" });
        }
      }
    });
  },

  go(e) {
    const k = e.currentTarget.dataset.k;
    if (k === "backupOut") { this.backupOut(); return; }
    if (k === "backupIn") { this.backupIn(); return; }
    // 无需行程也可用的入口（记账/本地速查/工具箱/深度内容/按标签找景点/今日/各 Tab）
    const noPlanOk = ["ledger", "assistant", "toolkit", "boost", "deep", "spotsearch", "today", "index", "plan", "more"];
    if (!this.data.hasPlan && noPlanOk.indexOf(k) < 0) { wx.showToast({ title: "先回「出发」页生成攻略", icon: "none" }); return; }
    // 全量路由表：tabBar 页用 switchTab，分包/主包子页用 navigateTo（统一加载反馈，避免白屏）
    const URLS = {
      map: "/subpkg/map/map", food: "/subpkg/food/food", ledger: "/subpkg/ledger/ledger",
      prep: "/subpkg/prep/prep", spotsearch: "/subpkg/spotsearch/spotsearch",
      assistant: "/subpkg/assistant/assistant", toolkit: "/subpkg/toolkit/toolkit",
      boost: "/subdata/boost/boost", deep: "/subai/deep/deep",
      today: "/pages/today/today", index: "/pages/index/index", plan: "/pages/plan/plan", more: "/pages/more/more"
    };
    const u = URLS[k];
    if (!u) { wx.showToast({ title: "该功能暂未开放", icon: "none" }); return; }
    const TABS = ["/pages/index/index", "/pages/today/today", "/pages/plan/plan", "/pages/more/more"];
    wx.showLoading({ title: "打开中" });
    if (TABS.indexOf(u) >= 0) {
      wx.switchTab({ url: u, fail: (er) => { wx.hideLoading(); wx.showToast({ title: "切换失败：" + ((er && er.errMsg) || "未知错误"), icon: "none" }); } });
    } else {
      wx.navigateTo({ url: u, success: () => wx.hideLoading(), fail: (er) => { wx.hideLoading(); wx.showToast({ title: "打开失败，请重试", icon: "none" }); } });
    }
  },

  /* ---- 合规与密钥（v1.19.188）：运行时注入本人账号申请的第三方 Key ----
     不改动源码 / 不重发版即可换成你自己的和风天气 / 高德 Key；
     经 keys.js 的 __app_keys__ storage 覆盖路径，天气取数即时生效（fail-closed 已内置）。 */
  onSetKeys() {
    wx.showModal({
      title: "配置和风天气 Key",
      content: "在 dev.qweather.com 申请免费 Key（须为你本人和风账号）。粘贴后天气即用你的 Key；留空则保持默认。",
      editable: true,
      placeholderText: "粘贴和风天气 Key",
      success: (r1) => {
        if (!r1.confirm) return;
        const qk = (r1.content || "").trim();
        const patch = {};
        if (qk) patch.qweatherKey = qk;
        wx.showModal({
          title: "配置高德 Key（可选）",
          content: "当前小程序用微信内置地图组件，无需 Key；仅当你未来自行调用高德 API 时才需要。留空跳过。",
          editable: true,
          placeholderText: "粘贴高德 Key（可选）",
          success: (r2) => {
            const ak = (r2.content || "").trim();
            if (ak) patch.amapKey = ak;
            if (!Object.keys(patch).length) { wx.showToast({ title: "未改动", icon: "none" }); return; }
            KEYS.setKeys(patch);
            wx.showToast({ title: "已保存，下次加载天气即生效", icon: "none" });
          }
        });
      }
    });
  },

  /* ---- 行程存档：恢复 / 删除 ---- */
  onRestorePlan(e) {
    const id = e.currentTarget.dataset.id;
    const plan = T.restorePlanSlot(id);
    if (!plan) { wx.showToast({ title: "存档已失效", icon: "none" }); this.refresh(); return; }
    app.setPlan(plan);
    wx.showToast({ title: "已切换到该行程", icon: "success" });
    setTimeout(() => wx.switchTab({ url: "/pages/plan/plan" }), 600);
  },
  onDelNote(e) {
    const date = e.currentTarget.dataset.date;
    T.delNote(date);
    this.refresh();
    wx.showToast({ title: "已删除手记", icon: "none" });
  },
  onDelPlan(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这份行程存档？",
      content: "删除后不可恢复（不影响当前行程）",
      confirmColor: "#cc3d3d",
      success: (r) => { if (r.confirm) { T.delPlanSlot(id); this.refresh(); wx.showToast({ title: "已删除", icon: "none" }); } }
    });
  },

  /* ---- 备份 / 恢复（剪贴板） ---- */
  backupOut() {
    let s = "";
    try { s = T.exportBackup(); } catch (e) {}
    if (!s) { wx.showToast({ title: "暂无可备份内容", icon: "none" }); return; }
    wx.setClipboardData({
      data: s,
      success: () => wx.showToast({ title: "已复制备份（" + s.length + " 字符），换机后点「恢复」", icon: "none", duration: 2600 })
    });
  },
  backupIn() {
    wx.getClipboardData({
      success: (res) => {
        try {
          const r = T.importBackup(res.data);
          if (r.hasPlan && r.plan) {
            app.setPlan(r.plan);
            wx.showToast({ title: "已恢复行程与 " + r.count + " 组数据 ✓", icon: "none" });
          } else {
            wx.showToast({ title: "已恢复 " + r.count + " 组数据（无行程）", icon: "none" });
          }
          this.refresh();
        } catch (e) {
          wx.showToast({ title: "剪贴板内容不是有效备份", icon: "none" });
        }
      },
      fail: () => wx.showToast({ title: "读取剪贴板被拒绝", icon: "none" })
    });
  },

  onShareAppMessage() {
    const p = app.globalData.plan;
    return {
      title: (p ? p.cityName + " · " + (p.totalDays || p.days.length) + " 天攻略，离线也能规划" : "旅行攻略生成器：出发前准备、旅途中都能用") + "（离线可用）",
      path: "/pages/index/index"
    };
  },

  /* ---- 想玩管理 ---- */
  delWish(e) {
    const w = this.data.wish[Number(e.currentTarget.dataset.i)];
    if (!w) return;
    T.toggleWish(w.name, w.city);
    wx.showToast({ title: "已移除", icon: "none" });
    this.refresh();
  },
  clearAll() {
    wx.showModal({
      title: "清空想玩清单？",
      content: "清空后重新生成时不再优先安排这些景点。",
      success: (res) => {
        if (!res.confirm) return;
        T.clearWish();
        this.refresh();
      }
    });
  },
  goGen() { wx.switchTab({ url: "/pages/index/index" }); },

  // v1.19.2：重度用户反复测试、或换机前想彻底重置，此前没有任何入口（只能卸载小程序）。
  // 数据全在本机，必须给显式出口，且用二次确认 + 提示先备份，避免误清。
  clearAllData() {
    wx.showModal({
      title: "清空全部本地数据？",
      content: "行程、存档、账本、想玩、待办、手记、足迹都会删除且不可恢复。建议先「备份到剪贴板」。",
      confirmText: "仍要清空",
      confirmColor: "#cc3d3d",
      success: (r) => {
        if (!r.confirm) return;
        try { wx.clearStorageSync(); } catch (e) {}
        try { app.clearPlan(); } catch (e) {}
        wx.showToast({ title: "已清空，回到初始状态", icon: "none" });
        setTimeout(() => { try { wx.reLaunch({ url: "/pages/index/index" }); } catch (_) {} }, 700);
      }
    });
  },

  /* ---- v1.8.4 B16：同行人协作包（想玩清单 + 整份行程 JSON，剪贴板） ---- */
  onMergeOut() {
    const plan = app.globalData.plan;
    if (!(plan && plan.days && plan.days.length) && !T.getWish().length) {
      wx.showToast({ title: "先有行程或想玩清单再分享", icon: "none" }); return;
    }
    let s = "";
    try { s = T.exportCollabPlan(plan || null); } catch (e) {}
    if (!s) { wx.showToast({ title: "暂无可分享内容", icon: "none" }); return; }
    wx.setClipboardData({
      data: s,
      success: () => wx.showToast({ title: "协作包已复制（含行程 + " + T.getWish().length + " 个想玩）", icon: "none", duration: 2600 })
    });
  },
  onMergeIn() {
    const self = this;
    wx.getClipboardData({
      success: (res) => {
        const text = String(res.data || "");
        // ① 新格式：协作包 JSON（想玩 + 整份行程）
        if (text.indexOf("travel-collab") >= 0) {
          try {
            const r = T.mergeCollabPlan(text);
            const parts = [];
            if (r.added) parts.push("并入想玩 " + r.added + " 个");
            if (r.existed) parts.push("TA 的行程你已有存档");
            else if (r.saved) parts.push("TA 的行程已存入「我的行程」");
            wx.showToast({ title: parts.length ? parts.join(" · ") : "内容都已在，无需合并", icon: parts.length ? "success" : "none" });
            self.refresh();
          } catch (e) {
            wx.showToast({ title: "协作包解析失败", icon: "none" });
          }
          return;
        }
        // ② 旧格式：纯想玩文本（兼容 v1.8.3 前的分享）
        try {
          if (text.indexOf("想玩清单") < 0) { wx.showToast({ title: "剪贴板内容不像协作包/想玩清单", icon: "none" }); return; }
          const ws = T.getWish();
          let addN = 0;
          text.split("\n").forEach(line => {
            if (!line || line[0] === "#") return;
            const i = line.indexOf("|");
            if (i <= 0) return;
            const c = line.slice(0, i).trim();
            const nm = line.slice(i + 1).trim();
            if (!nm || nm.length > 30) return;
            if (ws.some(w => w.name === nm)) return;
            T.toggleWish(nm, c);
            addN++;
          });
          if (!addN) { wx.showToast({ title: "没有新景点可合并（可能都在清单里了）", icon: "none" }); }
          else { wx.showToast({ title: "已并入 " + addN + " 个想玩", icon: "none" }); }
          self.refresh();
        } catch (e) { wx.showToast({ title: "解析失败，请确认复制内容", icon: "none" }); }
      },
      fail: () => wx.showToast({ title: "读取剪贴板被拒绝", icon: "none" })
    });
  },

  onTheme(e) {
    const v = !!(e.detail && e.detail.value);
    T.setThemeMode(v ? "dark" : "light");
    this.setData({ td: v, dark: v, themePref: T.themePref() });
    T.applyTabBar(); // 同步刷新原生 tabBar 配色
    wx.showToast({ title: v ? "已切换深色模式" : "已切换浅色模式", icon: "none" });
  },
  // v1.13：外观二态（浅色 / 深色，「跟随系统」已移除）
  onThemePref(e) {
    const m = e.currentTarget.dataset.m || "light";
    T.setThemePref(m);
    const d = T.themeMode() === "dark";
    this.setData({ td: d, dark: d, themePref: T.themePref() });
    T.applyNav();
    T.applyTabBar();
    wx.showToast({ title: "外观：" + (m === "dark" ? "深色" : "浅色"), icon: "none" });
  },
  // 全局阅读字号三档（标准 1 / 大 2 / 特大 3），与指南页 A⁻/A⁺ 共用同一设置
  onFontScale(e) {
    const v = Number(e.currentTarget.dataset.v) || 1;
    T.setFontScale(v);
    this.setData({ fz: T.fontScale() });
    wx.showToast({ title: (v === 1 ? "标准字号" : (v === 2 ? "大字号" : "特大字号")), icon: "none" });
  }
}));
