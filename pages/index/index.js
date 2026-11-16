const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// index：目的地选择 → 生成攻略
// 对齐网页版：城市搜索选择器 / 出行模式 / 想玩景点池自选 / 收藏目的地 / 总预算语义
// 2026-09 首页高端化：三段玩法切换（城市/全省精华/多站）、高级设置折叠、想玩池折叠、去 slogan
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一存储封装（失败有提示，不再静默丢数据）
const R = require("../../utils/recommend.js");   // 智能推荐引擎（端侧计算，纯本地，不联网）
const app = getAppSafe();
//
// T4：原本 1409 行的单文件按职责拆到同目录 4 个模块 + 1 个共享上下文，本文件只留
//   「页面数据 + 生命周期 + 首次进入的省份索引钳制」。
//   方法体原样搬运（tools/dev/page-split.mjs），this 语义与 WXML 绑定名一字未变；
//   成员集合与逐方法体由 tools/dev/_page-members-snapshot.mjs 的快照比对兜住。
//   按源码文本断言的门禁改走 tools/lib/page-src.mjs（页面 + 同目录模块），强度不减。
const C = require("./index-ctx.js");
const M_GEN = require("./m-generate.js");
const M_CONFIG = require("./m-config.js");
const M_FORM = require("./m-form.js");
const M_TILE = require("./m-tile.js");
const { PACE_TXT, MODE_TXT, iso, _uniqRecent } = C;

Page(SafePage(Object.assign({

  data: {
    fz: 1,
    td: false,
    ver: T.APP_VER,
    provinces: [], provIdx: 0, provName: "",
    cities: [], cityIdx: 0, cityName: "", isGuide: false,
    tiles: [],   // v1.7：首页快捷入口
    // 智能推荐：一句话需求 → 候选城市（端侧推荐引擎计算，不发起任何网络请求）
    recText: "", recBusy: false, recTried: false, recList: [],
    recMode: "intent", recNoIntent: false, recExtremeNote: "",
    recExamples: ["人少的古镇 三天", "海边亲子 五天", "沙漠摄影 四天", "温泉放松 周末两天"],
    destLabel: "",
    // 城市搜索选择器（目的地/出发地 共用弹层）
    showPicker: false, pickMode: "", pickTitle: "", pickList: [], pickKw: "", pickProv: "",
    days: 4, daysText: "4 天", dayPresets: [3, 5, 7],
    // v1.19.77：模板路线 —— 热门城市 + 建议天数（数据均已在库，城市名与 CITIES 完全一致）
    tpls: [
      { city: "西安", days: 4, tag: "古都" },
      { city: "成都", days: 4, tag: "慢生活" },
      { city: "重庆", days: 3, tag: "山城" },
      { city: "北京", days: 5, tag: "京城" },
      { city: "杭州", days: 3, tag: "西湖" },
      { city: "厦门", days: 3, tag: "海岛" },
      { city: "大理", days: 4, tag: "风花雪月" },
      { city: "桂林", days: 4, tag: "山水" },
      { city: "青岛", days: 3, tag: "海滨" },
      { city: "敦煌", days: 3, tag: "丝路" }
    ],
    depart: "", departMin: "",
    paceIdx: 1,
    paces: ["轻松休闲", "平衡舒适", "特种兵打卡"],
    paceVals: ["leisure", "balance", "speed"],
    // v1.15：攻略风格偏好（历史古迹 / 自然风光 / 默认）
    biasIdx: 0,
    biasVals: ["", "history", "nature"],
    biasTxts: ["不偏好", "偏历史古迹", "偏自然风光"],
    // 出行模式（对齐网页版：不指定/亲子/情侣/独行/带老人）
    travelModeIdx: 0,
    travelModes: ["不指定", "亲子游", "情侣游", "独行", "带老人"],
    travelModeVals: ["", "family", "couple", "solo", "elder"],
    budgetIdx: 0,
    budgets: ["经济型", "舒适型", "高端型", "自定义总预算"],
    budgetKeys: ["low", "mid", "high", "custom"],
    showCustom: false, customAmt: "", budgetHint: "", customHint: "", paceHint: "", fromHint: "",
    people: 2,
    stayMtn: true,
    fromIdx: 0, fromNames: [], fromList: [], fromCityObj: null, defFromIdx: -1, fromTxt: "",
    // 想玩景点池
    pool: [], poolFiltered: [], poolCount: 0, poolOn: 0, poolMore: 0, pickOnly: true, pickKw2: "", poolTag: "", poolTagList: [],
    hasOld: false, loading: false, btnTx: "生成我的攻略",
    recents: [],
    favs: [], isFav: false,
    // v1.19.58：行程草稿（保存 / 恢复首页配置）
    drafts: [], showDraft: false, draftCount: 0,
    // v1.9：假期提醒 / 同省顺路 / 行前一句
    holi: null, sibs: [], pkLine: "",
    // 多站路线（≤4 站，对齐网页 generateMulti）
    multiMode: false, multiRoute: [], multiDaysTotal: 0,
    // 全省 · 省内精华游（目的地 = 整省，镜像网页版 __all）
    provMode: false,
    // ---- 2026-09 首页 UI 状态 ----
    segIdx: 0,               // 0 城市 / 1 全省精华 / 2 多站
    advOpen: false,          // 高级设置折叠
    advChips: [],            // 已自定义项摘要
    advHintTx: "节奏 / 模式 / 预算 / 人数",  // 预计算：折叠栏副文案（避免 WXML 嵌套三元）
    poolOpen: false,         // 想玩景点池折叠
    poolSubTx: "不勾选则全自动推荐",  // 预计算：想玩池副文案
    discoverOpen: false,     // v1.19 P0-1：发现灵感区块折叠（默认收起，减负首屏）
    quickCollapsed: false,   // v1.19.1 减法：快捷入口对老用户默认折叠，减负首屏
    prevCity: null,          // 进入全省模式前记住的城市（便于切回）
    provTitle: "", provSub: "", provCityN: 0, provDayCap: 14, provSugDays: 0,
    // ---- 2026-09 v1.8.4 ----
    blindOpen: false, blind3: [],   // A8 目的地盲盒
    remind: null,                  // B18 预约横幅
    guideSeen: false,              // v1.18：首访引导看过即不再常驻（一次性轻提示）
  },
  onLoad(options) {
    this.__boot = T.ready().catch(() => null);
    let provs = [];
    try { provs = T.provinces() || []; } catch (e) { provs = []; }
    let last = null;
    try { last = S.get("fromV1", null) || app.globalData.from || null; } catch (e) { last = (app.globalData && app.globalData.from) || null; }
    let provIdx = 0;
    if (last && provs.includes(last.province)) provIdx = provs.indexOf(last.province);
    // v1.19.2：首页是冷启动唯一入口，_initFrom/_fillProv 里任一环（省表/城市表/存储）解析失败
    // 都会直接抛出 → 用户看到白屏。这里整体兜底并降级为「仅日期可用」的最小状态。
    try {
      this._initFrom();
      this.setData({
        // 2026-11-09：默认出发日从 +7 改为 +3 —— 和风免费档只有未来 7 天(today..+6)，
        // 默认 +7 会让「按默认日期生成」的行程整段落在预报窗口外，天气卡永远显示不可用。
        depart: iso(new Date(new Date().getTime() + 3 * 86400000)),
        departMin: iso(new Date()),
        hasOld: !!(app.globalData && app.globalData.plan && app.globalData.plan.days),
        recents: _uniqRecent(T.getRecent()),
        favs: T.getFavs(),
        pickOnly: T.getWish() && this._pickOnlyStored(),
        guideSeen: !!(S.get("miniGuideSeenV1", 0))
      });
      this._fillProv(provIdx, last && last.city && last.province === (provs[provIdx] || "") ? last.city : "");
      this._syncAdv();
      this._syncHoli();
      this._applyDeepLink(options);
      this._applyPrefs(options);
    } catch (e) {
      try {
        this.setData({
          // 2026-11-09：默认出发日从 +7 改为 +3 —— 和风免费档只有未来 7 天(today..+6)，
        // 默认 +7 会让「按默认日期生成」的行程整段落在预报窗口外，天气卡永远显示不可用。
        depart: iso(new Date(new Date().getTime() + 3 * 86400000)),
          departMin: iso(new Date()),
          provinces: provs
        });
        wx.showToast({ title: "初始化降级，仍可使用", icon: "none" });
        // v1.20.8（T1）：界面已提示，但「哪一步降级了」此前完全无痕 —— 用户报「首页少了东西」时查不到原因。
        // note() 自身保证不抛错，故不再套一层 try/catch（多一层空 catch 反而增加静默面）。
        require("../../utils/errlog.js").note("index", e, "首页初始化降级");
      } catch (_) {}
    }
  },
  /* ---- 目的地省 / 市 ---- */
  _fillProv(idx, pickCity) {
    const provs = T.provinces();
    // v1.19.197 修复：idx 可能来自草稿 / 深链 / 历史记录，越界或 NaN 会让
    // provName 变成 undefined，触发「Setting data field "provName" to
    // undefined is invalid」并把省份选择器打空。此处统一钳制并给空串兜底
    // （与 _rebuildFromData 里的 prov || "" 保持一致）。
    let i = Number(idx);
    if (!isFinite(i) || i < 0 || i >= provs.length) i = 0;
    const prov = provs[i] || "";
    const cities = T.citiesOf(prov);
    let cityIdx = 0;
    if (pickCity) { const k = cities.findIndex(c => c.name === pickCity); if (k >= 0) cityIdx = k; }
    this.setData({ provinces: provs, cities, provIdx: i, provName: prov, cityIdx });
    this._applyCity(cityIdx);
  },
  // 180ms 防抖定时器在页面卸载后仍会触发 _filterPool → 对已卸载实例 setData，
  // 小程序报「setData on unloaded page」，网页版则会多一次无谓的整页重绘。
  onUnload() {
    if (this._kwTimer) { clearTimeout(this._kwTimer); this._kwTimer = null; }
  },
  onShareAppMessage() {
    const n = (T.D && T.D.CITIES && T.D.CITIES.length) || 0;
    // 2026-10-29：用户要求下线「今日正当时」，分享标题回到通用文案
    return {
      title: "旅行攻略生成器 · " + n + " 城可玩：景点路线住宿美食记账，离线免注册",
      path: "/pages/index/index"
    };
  },
  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); T.applyTabBar(); },
  onShow() { onShowRender(this, "index", () => this._ensureForm(), () => this.maybeShowGuideModal()); },
}, M_GEN, M_CONFIG, M_FORM, M_TILE)));
