const { getAppSafe, SafePage } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// index：目的地选择 → 生成攻略
// 对齐网页版：城市搜索选择器 / 出行模式 / 想玩景点池自选 / 收藏目的地 / 总预算语义
// 2026-09 首页高端化：三段玩法切换（城市/全省精华/多站）、高级设置折叠、想玩池折叠、去 slogan
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一存储封装（失败有提示，不再静默丢数据）
const R = require("../../utils/recommend.js");   // 智能推荐引擎（端侧计算，纯本地，不联网）

// v1.19.100 修复：模块顶层 `getApp()` 在 lazyCodeLoading 下可能返回 undefined（App 尚未注册完），
// 会导致 onLoad 整段初始化被抛错跳过、且本页 10 处 handler（goPlan / generate / 回填 等）访问
// app.globalData / app.setPlan 崩 → 首页大批按键集体失灵（表现：页面渲染但点了没反应）。
// 改为惰性代理：每次访问属性才实时取 getApp()，onLoad / 各 handler 运行时 App 一定已就绪；
// 模块求值期即使为 undefined 也不抛错（get 返回 undefined，由现有 `&&` 短路或 try/catch 兜底）。
const app = getAppSafe();

const PACE_TXT = ["轻松", "平衡", "特种兵"];
const MODE_TXT = ["不指定", "亲子", "情侣", "独行", "老人"];

function iso(t) {
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    ver: T.APP_VER,
    provinces: [], provIdx: 0, provName: "",
    cities: [], cityIdx: 0, cityName: "", isGuide: false,
    tiles: [],   // v1.7：首页快捷入口
    // 智能推荐：一句话需求 → 候选城市（端侧推荐引擎计算，不发起任何网络请求）
    recText: "", recBusy: false, recTried: false, recList: [],
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
    guideSeen: false              // v1.18：首访引导看过即不再常驻（一次性轻提示）
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
        depart: iso(new Date(new Date().getTime() + 7 * 86400000)),
        departMin: iso(new Date()),
        hasOld: !!(app.globalData && app.globalData.plan && app.globalData.plan.days),
        recents: T.getRecent(),
        favs: T.getFavs(),
        pickOnly: T.getWish() && this._pickOnlyStored(),
        guideSeen: !!(S.get("miniGuideSeenV1", 0))
      });
      this._fillProv(provIdx, last && last.city && last.province === (provs[provIdx] || "") ? last.city : "");
      this._syncAdv();
      this._syncHoli();
      this._applyDeepLink(options);
    } catch (e) {
      try {
        this.setData({
          depart: iso(new Date(new Date().getTime() + 7 * 86400000)),
          departMin: iso(new Date()),
          provinces: provs
        });
        wx.showToast({ title: "初始化降级，仍可使用", icon: "none" });
      } catch (_) {}
    }
  },

  // v1.9：出发日期假期提示
  _syncHoli() {
    let h = null;
    try { h = T.holidayHint(this.data.depart); } catch (e) { h = null; }
    this.setData({ holi: h });
    this._syncPack();
  },
  // v1.9：按目的地 + 出发月给一句行前携带建议
  _syncPack() {
    const cn = this.data.cityName;
    if (!cn) { this.setData({ pkLine: "" }); return; }
    let line = "";
    try {
      const tips = T.packHintOf(cn, this.data.depart);
      if (tips.length) line = tips.slice(0, 2).join(" · ");
    } catch (e) { line = ""; }
    this.setData({ pkLine: line });
  },

  _pickOnlyStored() {
    return S.get("pickOnlyV1", true) !== false;
  },

  _initFrom() {
    const pc = T.D.PROVINCE_CITIES || {};
    const list = [];
    Object.keys(pc).forEach(prov => { (pc[prov] || []).forEach(name => list.push({ province: prov, name })); });
    const names = list.map(o => (o.province === o.name ? o.name : o.province + " · " + o.name));
    let fromIdx = -1;
    const saved = S.get("fromCityV1", ""); if (saved) fromIdx = list.findIndex(o => o.name === saved);
    if (fromIdx < 0) fromIdx = list.findIndex(o => o.name === "太原");
    if (fromIdx < 0) fromIdx = 0;
    this.setData({ fromList: list, fromNames: names, fromIdx, fromCityObj: list[fromIdx] || null, fromTxt: names[Math.max(0, fromIdx)] || "太原 · 默认出发地", defFromIdx: Math.max(0, list.findIndex(o => o.name === "太原")) });
  },

  // v1.19.76：分享/搜索深链 —— 带 city/days 参数时，自动把出发页预填好对应城市与天数
  _applyDeepLink(options) {
    if (!options || !options.city) return;
    const cn = String(decodeURIComponent(options.city)).trim();
    if (!cn) return;
    try {
      const provs = T.provinces();
      let pIdx = -1, cIdx = -1;
      for (let p = 0; p < provs.length; p++) {
        const cs = T.citiesOf(provs[p]) || [];
        const i = cs.findIndex(c => c.name === cn);
        if (i >= 0) { pIdx = p; cIdx = i; break; }
      }
      if (pIdx < 0) return;
      this._fillProv(pIdx);
      this._applyCity(cIdx);
      if (options.days) {
        let d = parseInt(options.days, 10);
        if (!isNaN(d)) {
          const cap = this._dayCap();
          d = Math.max(1, Math.min(d, cap || d));
          this.setData({ days: d, daysText: d + " 天" });
        }
      }
      wx.showToast({ title: "已为你填好「" + cn + "」", icon: "none" });
    } catch (e) { /* 深链失败静默降级，不影响首页正常使用 */ }
  },

  /* ---- 目的地省 / 市 ---- */
  _fillProv(idx, pickCity) {
    const provs = T.provinces();
    const prov = provs[idx];
    const cities = T.citiesOf(prov);
    let cityIdx = 0;
    if (pickCity) { const i = cities.findIndex(c => c.name === pickCity); if (i >= 0) cityIdx = i; }
    this.setData({ provinces: provs, cities, provIdx: idx, provName: prov, cityIdx });
    this._applyCity(cityIdx);
  },
  onProvChange(e) {
    const idx = Number(e.detail.value);
    if (this.data.provMode) {
      // 全省模式下切省份：留在全省模式，刷新精华卡片
      this.setData({ provIdx: idx, provName: this.data.provinces[idx] || "" });
      this._syncProv();
    } else {
      this._fillProv(idx);
    }
    this._closePicker();
  },

  _applyCity(i) {
    const c = this.data.cities[i];
    if (!c) return;
    const destLabel = (c.province && c.province !== c.name) ? c.province + " · " + c.name : c.name;
    const patch = {
      cityIdx: i, cityName: c.name, isGuide: !!c.guide, isFav: T.isFaved(c.name),
      provMode: false, multiMode: false, segIdx: 0, destLabel
    };
    // v1.17.5：换城后按该城真实可玩量收敛天数（景点少的城市选太多天只会生成留白空天）
    const cap = this._capOf(c.name);
    if (this.data.days > cap) {
      patch.days = cap;
      patch.daysText = cap + " 天";
      wx.showToast({ title: c.name + " 可玩约 " + cap + " 天，已自动调整", icon: "none" });
    }
    this.setData(patch);
    this._refreshPool(c);
    // v1.9：同省也值得去的精选城
    let sibs = [];
    try { sibs = T.siblingCities(c.name); } catch (e) { sibs = []; }
    this.setData({ sibs });
    this._syncPack();
  },
  // 想玩池：本城全部景点（对齐网页 pickField），勾选态 = 本城 wish
  _refreshPool(city) {
    const c = city || this.data.cities[this.data.cityIdx];
    if (!c) { this.setData({ pool: [], poolFiltered: [], poolCount: 0, poolOn: 0 }); this._syncUi(); return; }
    const pool = T.poolOfCity(T.findCity(c.name, this.data.provName) || c);
    const wished = new Set(T.getWish().filter(x => !x.city || x.city === c.name).map(x => x.name));
    const full = pool.map(n => ({ name: n, on: wished.has(n) }));
    const kw = this.data.pickKw2 || "";
    const tag = this.data.poolTag || "";
    const tagSet = new Set();
    full.forEach(x => (T.spotTagOf(x.name, c.name) || []).forEach(t => tagSet.add(t)));
    let list = full;
    if (kw) list = list.filter(x => x.name.includes(kw));
    if (tag) list = list.filter(x => T.spotTagOf(x.name, c.name).some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0));
    const matched = list.length;
    list = list.slice(0, 300);
    this.setData({
      pool: full, poolFiltered: list, poolCount: full.length,
      poolMore: Math.max(0, matched - list.length),
      poolOn: full.filter(x => x.on).length, poolTagList: Array.from(tagSet)
    });
    this._syncUi();
  },
  _syncPoolFromWish() {
    const c = this.data.cities[this.data.cityIdx];
    if (!c) return;
    const wished = new Set(T.getWish().filter(x => !x.city || x.city === c.name).map(x => x.name));
    this._applyPoolList(this.data.pool.map(x => ({ name: x.name, on: wished.has(x.name) })));
  },

  /* ================= 玩法三段切换 ================= */
  onModeTab(e) {
    const m = (e.currentTarget.dataset.mode || "city");
    if (m === "prov") {
      if (!this.data.provName) { wx.showToast({ title: "请先选择省份", icon: "none" }); return; }
      this._enterProv();
    } else if (m === "multi") {
      if (!this.data.multiMode) this.toggleMultiMode({ detail: { value: true } });
      else this.setData({ segIdx: 2 });
    } else {
      if (this.data.multiMode) this.setData({ multiMode: false });
      if (this.data.provMode) this._exitProv();
      this.setData({ segIdx: 0 });
    }
    this._syncUi();
  },
  _enterProv(prevCityOverride) {
    let prevCity = prevCityOverride;
    if (!prevCity) {
      const c = this.data.cities[this.data.cityIdx];
      prevCity = c ? { prov: this.data.provName, name: c.name } : null;
    }
    this.setData({
      prevCity, provMode: true, multiMode: false, isGuide: false, isFav: false, segIdx: 1
    });
    this._syncProv();
    this._syncUi();
  },
  _exitProv() {
    const pv = this.data.prevCity;
    const provs = this.data.provinces;
    let pIdx = this.data.provIdx;
    if (pv && pv.prov) { const i = provs.indexOf(pv.prov); if (i >= 0) pIdx = i; }
    this._fillProv(pIdx, pv && pv.prov === provs[pIdx] ? pv.name : "");
  },
  _syncProv() {
    const name = this.data.provName || "";
    const n = (T.citiesOf(name) || []).length;
    // v1.17.4：全省精华游天数上限 —— 旧实现固定 days:12 探针导致上限恒被夹在 12 天；
    // 现按「该省真实可生成天数」计算，并给出建议天数（可玩天数的 60%）。
    const pace = (this.data.paceVals && this.data.paceVals[this.data.paceIdx]) || "balance";
    const cap = name ? T.provinceDayCap(name, pace) : 14;
    const sug = name ? T.provinceSuggestedDays(name, pace) : 0;
    const sub = n > 1
      ? n + " 城串成一条线 · 建议 " + sug + " 天（最多 " + cap + " 天）· 按地理顺路排序，赶路最少"
      : "深度玩透一座城 · 建议 " + sug + " 天（最多 " + cap + " 天）· 酒店 / 美食按天就近安排";
    const patch = { provCityN: n, provTitle: name + " · 全省精华游", provSub: sub, provDayCap: cap, provSugDays: sug };
    if (this.data.days > cap) {
      patch.days = cap;
      patch.daysText = cap + " 天";
      wx.showToast({ title: name + " 精华游最多 " + cap + " 天，已自动调整", icon: "none" });
    }
    this.setData(patch);
  },

  /* ---- 城市搜索选择器弹层 ---- */
  openPicker(e) {
    const mode = e.currentTarget.dataset.mode; // dest | from | multiPick
    let base = [], title = "";
    if (mode === "dest") {
      base = this._allCities();
      title = "选择目的地：先选省份，再看省内城市 / 全省精华";
    } else if (mode === "from") {
      base = this.data.fromList.map(o => ({ name: o.name, province: o.province, guide: false }));
      title = "选择出发城市";
    } else if (mode === "multiPick") {
      base = this._allCities();
      title = "添加路线城市（≤4 站）";
    } else return;
    this.setData({ showPicker: true, pickMode: mode, pickTitle: title, pickList: base, pickKw: "", pickProv: "" });
  },
  _allCities() {
    const provs = T.provinces();
    const out = [];
    provs.forEach(p => T.citiesOf(p).forEach(c => out.push({ name: c.name, province: p, guide: !!c.guide, limited: !!c.limited })));
    return out;
  },
  // 选择器列表 = 全量源 + 当前省份过滤（省栏）+ 关键词过滤
  _applyPickList(src) {
    const prov = this.data.pickProv || "";
    const kw = (this.data.pickKw || "").trim();
    let list = (src || []).filter(x => !prov || x.province === prov);
    if (prov && this.data.pickMode !== "from" && this.data.pickMode !== "multiPick") {
      // 省份视图：头部放「全省精华」入口（点击走全省游）
      list = [{ name: prov + " · 全省精华", province: prov, guide: true, all: true }].concat(list);
    }
    if (kw) list = list.filter(x => x.name.includes(kw) || x.province.includes(kw));
    this.setData({ pickList: list });
  },
  onPickProv(e) {
    const p = e.currentTarget.dataset.p || "";
    const src = this.data.pickMode === "from" ? this.data.fromList : this._allCities();
    this.setData({ pickProv: p, pickKw: "" });
    this._applyPickList(src);
  },
  onPickKw(e) {
    const kw = e.detail.value;
    const src = this.data.pickMode === "from" ? this.data.fromList : this._allCities();
    this.setData({ pickKw: kw });
    this._applyPickList(src);
  },
  chooseFromPicker(e) {
    const i = Number(e.currentTarget.dataset.i);
    const o = this.data.pickList[i];
    if (!o) return;
    if (this.data.pickMode === "dest") {
      if (o.all) {
        // v1.12.3 修复：选「某省·全省精华」时须把 provName 切到该省（此前漏切 → 生成的是旧省/默认山西）
        const c = this.data.cities[this.data.cityIdx];
        const prevCity = c ? { prov: this.data.provName, name: c.name } : null;
        const pIdx = Math.max(0, (this.data.provinces || []).indexOf(o.province));
        this.setData({ provIdx: pIdx, provName: o.province });
        this._enterProv(prevCity);
        this._closePicker();
        return;
      }
      // 目的地城市：全国任意城市，选完自动定位省份（不再要求先选省）
      const pIdx = Math.max(0, (this.data.provinces || []).indexOf(o.province));
      this._fillProv(pIdx, o.name);
    } else if (this.data.pickMode === "from") {
      const j = this.data.fromList.findIndex(x => x.name === o.name && x.province === o.province);
      if (j >= 0) this.setData({ fromIdx: j, fromCityObj: this.data.fromList[j], fromTxt: (this.data.fromNames[j] || "") });
      this._syncAdv();
    } else if (this.data.pickMode === "multiPick") {
      this._addStation(o.name, o.province);
    }
    this._closePicker();
  },
  _closePicker() { this.setData({ showPicker: false }); },
  noop() {},

  // v1.8：玩几天改「－ 数字 ＋」步进 + 常用天数快捷（手机上滑杆一拖就飞，很难精准）
  onDaysMinus() { const v = Math.max(1, this.data.days - 1); this.setData({ days: v, daysText: v + " 天" }); },
  // v1.17.5：单城游也按真实上限（旧实现写死 14 天，景点少的城市会生成大量「留白」空天）
  _capOf(cityName) {
    const pace = (this.data.paceVals && this.data.paceVals[this.data.paceIdx]) || "balance";
    if (!cityName) return 14;
    try { return T.cityDayCap(cityName, pace) || 14; } catch (e) { return 14; }
  },
  _dayCap() {
    if (this.data.provMode) return this.data.provDayCap || 14;
    return this._capOf(this.data.cityName);
  },
  onDaysPlus() { const cap = this._dayCap(); const v = Math.min(cap, this.data.days + 1); this.setData({ days: v, daysText: v + " 天" }); },
  // v1.19.2：常用天数一键到位（步进要点 7 次；新手也不知道「几天合适」，预设覆盖多数行程）
  onDaysPreset(e) {
    const cap = this._dayCap();
    const want = Number(e.currentTarget.dataset.d) || 3;
    const v = Math.max(1, Math.min(cap, want));
    if (v !== want) wx.showToast({ title: "这城最多 " + cap + " 天，已取上限", icon: "none" });
    this.setData({ days: v, daysText: v + " 天" });
    this._syncAdv();
  },
  onDateChange(e) { this.setData({ depart: e.detail.value }); this._syncHoli(); },
  // v1.9：点同省城市直接设为目的地
  onSibPick(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const provs = this.data.provinces;
    for (let p = 0; p < provs.length; p++) {
      const cs = T.citiesOf(provs[p]);
      if (cs.some(c => c.name === name)) { this._fillProv(p, name); return; }
    }
    wx.showToast({ title: "该城可在目的地里搜索", icon: "none" });
  },

  // v1.19.77：模板路线 —— 点卡片自动填好城市 + 天数
  // 顺序很关键：先落天数再切城，_applyCity 内会按该城真实可玩量收敛 → 结果 = min(城市上限, 模板天数)
  onTplPick(e) {
    try {
      const i = Number(e.currentTarget.dataset.i);
      const t = this.data.tpls[i];
      if (!t) return;
      const provs = T.provinces();
      let pIdx = -1;
      for (let p = 0; p < provs.length; p++) {
        const cs = T.citiesOf(provs[p]) || [];
        if (cs.some(c => c.name === t.city)) { pIdx = p; break; }
      }
      if (pIdx < 0) { wx.showToast({ title: "暂未收录 " + t.city, icon: "none" }); return; }
      this.setData({ days: t.days, daysText: t.days + " 天" });
      this._fillProv(pIdx, t.city);
      const d = this.data.days;
      this._syncAdv();
      // 2026-10-29：模板路线改为「填好 + 直接生成」。
      // 起因：新用户必须先填完整张表才能看到任何内容，首页/行程/美食全是空态，是最大流失点。
      // 安全性：generate() 会先把已有行程存进存档槽（T.savePlanSlot），在「更多」页可恢复，不会丢。
      this.generate();
    } catch (err) { wx.showToast({ title: "套用失败，请手动选择", icon: "none" }); }
  },

  /* ---- 高级设置折叠 ---- */
  onAdvTap() { this.setData({ advOpen: !this.data.advOpen }); this._syncUi(); },
  // 预计算派生文案（把 WXML 里的嵌套三元 / 字符串拼接搬到 JS，渲染层零逻辑）
  _syncUi() {
    const d = this.data;
    this.setData({
      advHintTx: d.advOpen ? "收起" : (d.advChips.length ? "已调 " + d.advChips.length + " 项" : "节奏 / 模式 / 预算 / 人数"),
      poolSubTx: d.poolOn ? d.poolOn + " 个已选 · 行程优先安排" : "不勾选则全自动推荐",
      btnTx: d.loading ? "生成中…" : (d.provMode ? "生成全省精华攻略" : d.multiMode ? "生成多站攻略" : "生成我的攻略")
    });
  },
  _syncAdv() {
    const d = this.data, chips = [];
    if (d.paceIdx !== 1) chips.push("节奏·" + (PACE_TXT[d.paceIdx] || d.paces[d.paceIdx]));
    if (d.travelModeIdx !== 0) chips.push("模式·" + (MODE_TXT[d.travelModeIdx] || ""));
    if (d.budgetIdx !== 0 || d.showCustom) {
      const isCustom = d.budgetKeys[d.budgetIdx] === "custom";
      if (isCustom && parseFloat(d.customAmt) > 0) chips.push("预算·¥" + d.customAmt);
      else chips.push("预算·" + (isCustom ? "自定义" : (d.budgets[d.budgetIdx] || "")));
    }
    if (d.people !== 2) chips.push(d.people + "人");
    if (!d.stayMtn) chips.push("名山不过夜");
    if (d.defFromIdx >= 0 && d.fromIdx !== d.defFromIdx) {
      const nm = (d.fromNames[d.fromIdx] || "").split("·").pop().trim();
      if (nm) chips.push("从" + nm);
    }
    // v1.19.2：预算档位补一句金额区间 —— 新手不该靠猜「舒适型」是什么价位
    const bk = d.budgetKeys[d.budgetIdx] || "mid";
    const BUD = {
      low: "参考：人均 ¥150–300 / 天（青旅或快捷酒店 + 小吃为主）",
      mid: "参考：人均 ¥300–600 / 天（连锁酒店 + 正餐 + 打车）",
      high: "参考：人均 ¥600–1200 / 天（四星以上 + 品质餐厅 + 包车）"
    };
    // v1.19.42：自定义预算实时折算「人均 / 天」，边输入边看到分摊结果，避免生成后才发现预算档位不对
    let budgetHint = "";
    let customHint = "";
    if (bk === "custom") {
      const amt = parseFloat(d.customAmt);
      if (amt > 0) {
        const totalDays = (d.multiMode && d.multiRoute && d.multiRoute.length)
          ? d.multiRoute.reduce((a, s) => a + (s.days || 1), 0)
          : (d.days || 1);
        const perDayPer = amt / Math.max(1, totalDays) / Math.max(1, d.people);
        customHint = "约 ¥" + Math.round(perDayPer) + " /人·天（总 ¥" + amt + " · " + totalDays + " 天 × " + d.people + " 人）";
      } else {
        customHint = d.days + " 天 × " + d.people + " 人 自动分摊";
      }
    } else {
      budgetHint = BUD[bk] || "";
    }
    // v1.19.2：节奏用「轻松/平衡/特种兵」三个词对新手不可解，补一句具体差别
    const PACE_HINT = [
      "每天 2–3 个景点，午后留出休息和闲逛时间",
      "每天 3–5 个景点，游玩与休息大致对半，适合大多数人",
      "每天 5 个以上、早出晚归，适合体力好、想把景点刷满的人"
    ];
    const paceHint = PACE_HINT[d.paceIdx] || "";
    // v1.19.2：出发地默认是太原，外地新手未必注意到可以改，而它直接影响「怎么去」的交通建议
    const fromHint = (d.fromIdx === d.defFromIdx && d.fromIdx >= 0)
      ? "默认太原，点一下可改"
      : "";
    this.setData({ advChips: chips, budgetHint, paceHint, fromHint });
    this._syncUi();
  },
  onPaceChange(e) { this.setData({ paceIdx: Number(e.detail.value) }); this._syncAdv(); },
  onBiasChange(e) { this.setData({ biasIdx: Number(e.detail.value) }); this._syncAdv(); },
  onTravelModeChange(e) { this.setData({ travelModeIdx: Number(e.detail.value) }); this._syncAdv(); },

  /* ---- 预算（含自定义 = 全行程总预算） ---- */
  onBudgetChange(e) {
    const i = Number(e.detail.value);
    if (i < 0 || i >= this.data.budgetKeys.length) return;
    this.setData({ budgetIdx: i, showCustom: this.data.budgetKeys[i] === "custom" });
    this._syncAdv();
  },
  onCustomAmt(e) { this.setData({ customAmt: e.detail.value }); this._syncAdv(); },

  /* ---- 人数 1-10（对齐网页） ---- */
  onPeopleMinus() { if (this.data.people > 1) this.setData({ people: this.data.people - 1 }); this._syncAdv(); },
  onPeoplePlus() { if (this.data.people < 10) this.setData({ people: this.data.people + 1 }); this._syncAdv(); },
  onStayMtn(e) { this.setData({ stayMtn: e.detail.value }); this._syncAdv(); },

  /* ---- 多站路线（≤4 站）---- */
  _sumDays(r) { return (r || []).reduce((a, s) => a + (parseInt(s.days, 10) || 1), 0); },
  toggleMultiMode(e) {
    const on = !!(e && e.detail && e.detail.value);
    if (on) {
      if (!this.data.multiRoute.length) {
        const c = this.data.cities[this.data.cityIdx];
        if (!c) { wx.showToast({ title: "请先选目的地城市", icon: "none" }); return; }
        const route = [{ name: c.name, province: this.data.provName, days: this.data.days }];
        this.setData({ multiMode: true, provMode: false, segIdx: 2, multiRoute: route, multiDaysTotal: this._sumDays(route) });
      } else {
        this.setData({ multiMode: true, provMode: false, segIdx: 2 });
      }
    } else {
      this.setData({ multiMode: false, segIdx: this.data.provMode ? 1 : 0 });
    }
    this._syncUi();
  },
  _addStation(name, province) {
    if (this.data.multiRoute.length >= 4) { wx.showToast({ title: "最多 4 站", icon: "none" }); return; }
    if (this.data.multiRoute.some(s => s.name === name)) { wx.showToast({ title: "已在路线中", icon: "none" }); return; }
    const route = this.data.multiRoute.slice();
    // v1.17.5：默认天数按该城真实可玩量推荐（旧实现写死 3 天：景点少的城会留白，多的城玩不够）
    let dft = 3;
    try { dft = Math.max(1, Math.min(7, this._capOf(name))); } catch (e) {}
    route.push({ name, province: province || (T.D.CITY2PROV && T.D.CITY2PROV[name]) || "", days: dft });
    this.setData({ multiRoute: route, multiMode: true, multiDaysTotal: this._sumDays(route) });
    this._syncUi();
  },
  onStationDel(e) {
    const i = Number(e.currentTarget.dataset.i);
    const route = this.data.multiRoute.slice(); route.splice(i, 1);
    this.setData({ multiRoute: route, multiMode: route.length > 0, multiDaysTotal: this._sumDays(route) });
    if (!route.length) this.setData({ segIdx: 0 });
    this._syncUi();
  },
  onStationDays(e) {
    const i = Number(e.currentTarget.dataset.i);
    const dir = Number(e.currentTarget.dataset.dir);
    const route = this.data.multiRoute.slice();
    const cur = parseInt(route[i].days, 10) || 1;
    // v1.17.5：上限改用该城真实可玩量（旧实现写死 7 天）
    let cap = 7;
    try { cap = Math.max(1, Math.min(14, this._capOf(route[i].name))); } catch (e) {}
    const next = Math.max(1, Math.min(cap, cur + dir));
    route[i] = Object.assign({}, route[i], { days: next });
    this.setData({ multiRoute: route, multiDaysTotal: this._sumDays(route) });
  },

  /* ---- 想玩池折叠 ---- */
  onPoolTap() { this.setData({ poolOpen: !this.data.poolOpen }); },

  /* ---- v1.19 P0-1：发现灵感区块折叠 ---- */
  toggleDiscover() { this.setData({ discoverOpen: !this.data.discoverOpen }); this._syncUi(); },

  /* ---- v1.19.1 减法：快捷入口折叠（老用户默认收起） ---- */
  toggleQuick() { this.setData({ quickCollapsed: !this.data.quickCollapsed }); },

  /* ---- 想玩勾选（写入 wish，与行程页互通） ---- */
  onPickOnly(e) {
    const v = !!e.detail.value;
    S.set("pickOnlyV1", v);
    this.setData({ pickOnly: v });
    wx.showToast({ title: v ? "已开启「只玩勾选」· 生成时优先安排" : "已关闭「只玩勾选」· 全自动推荐", icon: "none" });
  },
  // 统一把池子变更同步到「搜索过滤视图」，保证搜索关键词下点击也有即时高亮
  _applyPoolList(full) {
    const kw = this.data.pickKw2.trim();
    const tag = this.data.poolTag || "";
    let list = kw ? full.filter(x => x.name.includes(kw)) : full.slice();
    if (tag) list = list.filter(x => T.spotTagOf(x.name, this.data.cityName).some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0));
    this.setData({
      pool: full,
      poolOn: full.filter(x => x.on).length,
      poolMore: Math.max(0, list.length - Math.min(list.length, 300)),
      poolFiltered: list.slice(0, 300)
    });
    this._syncUi();
  },
  // v1.19.2：连续勾选是高频动作，原先每点一次弹一次 1.5s toast 会持续打断操作。
  // 改为零 toast —— 勾选反馈由 chip 高亮 + 折叠栏「已选 N 个」承担，连点不再被打断。
  togglePool(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const full = this.data.pool.map(x => (x.name === name ? { name, on: !x.on } : x));
    const c = this.data.cities[this.data.cityIdx];
    T.toggleWish(name, c ? c.name : "");
    this._applyPoolList(full);
  },
  // v1.19.2：全选会一次写入上百条想玩，误触后要一条条取消 → 批量动作补二次确认
  pickAllPool() {
    const n = (this.data.pool || []).length;
    if (!n) return;
    const run = () => {
      const c = this.data.cities[this.data.cityIdx];
      const wished = new Set(T.getWish().map(x => x.name));
      const full = this.data.pool.map(it => ({ name: it.name, on: true }));
      full.forEach(it => { if (!wished.has(it.name)) T.toggleWish(it.name, c ? c.name : ""); });
      this._applyPoolList(full);
      wx.showToast({ title: "已全选 " + full.length + " 个想玩景点", icon: "none" });
    };
    if (n < 15) { run(); return; }
    wx.showModal({
      title: "全选 " + n + " 个景点？",
      content: "会一次性加入想玩清单，生成时优先安排。之后可随时逐个取消。",
      confirmText: "全选",
      success: r => { if (r.confirm) run(); }
    });
  },
  pickClearPool() {
    const c = this.data.cities[this.data.cityIdx];
    this.data.pool.forEach(it => { if (it.on) T.toggleWish(it.name, c ? c.name : ""); });
    const full = this.data.pool.map(it => ({ name: it.name, on: false }));
    this._applyPoolList(full);
    wx.showToast({ title: "已清空想玩勾选", icon: "none" });
  },
  // v1.19.2：搜索无防抖 —— 池子动辄数百条，每敲一个字都全量 filter + setData 会明显卡顿。
  // 现在输入立即回显关键词、过滤结果做 180ms 防抖，快速连打只算最后一帧。
  onPickKw2(e) {
    const kw = e.detail.value.trim();
    this.setData({ pickKw2: kw });
    if (this._kwTimer) clearTimeout(this._kwTimer);
    this._kwTimer = setTimeout(() => { this._kwTimer = null; this._filterPool(); }, 180);
  },
  _filterPool() {
    const kw = this.data.pickKw2 || "";
    const full = this.data.pool;
    let list = kw ? full.filter(x => x.name.includes(kw)) : full.slice();
    const tag = this.data.poolTag || "";
    if (tag) list = list.filter(x => T.spotTagOf(x.name, this.data.cityName).some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0));
    this.setData({
      poolFiltered: list.slice(0, 300),
      poolMore: Math.max(0, list.length - Math.min(list.length, 300))
    });
  },
  // v1.19.2：一键清空搜索词（输入长词后要逐字删很烦）
  clearPoolKw() {
    if (this._kwTimer) { clearTimeout(this._kwTimer); this._kwTimer = null; }
    this.setData({ pickKw2: "" });
    this._filterPool();
  },
  // v1.15：想玩池按标签筛选（再次点击取消）
  onPoolTag(e) {
    const tag = String(e.currentTarget.dataset.tag || "");
    const next = this.data.poolTag === tag ? "" : tag;
    this.setData({ poolTag: next });
    const c = this.data.cities[this.data.cityIdx];
    if (c) this._refreshPool(c);
  },

  /* ---- 收藏 / 最近 ---- */
  onFavToggle() {
    const c = this.data.cityName;
    if (!c) { wx.showToast({ title: "请先选择目的地城市", icon: "none" }); return; }
    const list = T.toggleFav(c);
    this.setData({ favs: list, isFav: T.isFaved(c) });
    wx.showToast({ title: T.isFaved(c) ? "已收藏" : "已取消收藏", icon: "none" });
  },
  applyFav(e) {
    const i = Number(e.currentTarget.dataset.i);
    const c = this.data.favs[i];
    if (!c) return;
    const provs = T.provinces();
    const prov = T.D.CITY2PROV && T.D.CITY2PROV[c];
    const pIdx = prov && provs.includes(prov) ? provs.indexOf(prov) : 0;
    this._fillProv(pIdx, c);
    wx.showToast({ title: "已回填「" + c + "」，点生成即可", icon: "none" });
  },
  delFav(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = this.data.favs[i];
    this.setData({ favs: T.delFav(i), isFav: f === this.data.cityName ? false : this.data.isFav });
  },
  fillRecent(e) {
    const r = this.data.recents[Number(e.currentTarget.dataset.i)];
    if (!r) return;
    const provs = T.provinces();
    const pIdx = Math.max(0, provs.indexOf(r.province));
    this._fillProv(pIdx, r.city);
    this.setData({ days: r.days || 4, daysText: (r.days || 4) + " 天", depart: r.depart || this.data.depart });
    wx.showToast({ title: "已回填「" + r.city + "」，点生成即可", icon: "none" });
  },
  delRecent(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ recents: T.delRecent(i) });
  },

  fillExample() {
    const all = (T.D.CITIES || []).filter(c => c.id !== "from");
    const c = all[(Math.random() * all.length) | 0];
    if (!c) return;
    const days = 3 + ((Math.random() * 5) | 0);
    const provs = T.provinces();
    const pIdx = Math.max(0, provs.indexOf(c.province));
    this._fillProv(pIdx, c.name);
    const d = new Date(); d.setDate(d.getDate() + 5);
    this.setData({ days, daysText: days + " 天", depart: iso(d) });
    wx.showToast({ title: "已填入随机示例，可微调后生成", icon: "none" });
  },
  resumeOld() {
    if (!app.globalData.plan) return;
    wx.switchTab({ url: "/pages/today/today" });
  },

  generate() {
    if (this.data.loading) return;
    if (!this.data.depart || this.data.depart < this.data.departMin) {
      wx.showToast({ title: "出发日期不能早于今天", icon: "none" }); return;
    }
    // 预算：自定义 = 全行程总预算（元），按 days×people 分摊映射酒店档位
    let budgetKey = this.data.budgetKeys[this.data.budgetIdx] || "mid";
    let customAmt = 0;
    if (budgetKey === "custom") {
      customAmt = parseFloat(this.data.customAmt);
      if (!(customAmt > 0)) { wx.showToast({ title: "请输入全行程总预算（元）", icon: "none" }); return; }
      const totalDays = (this.data.multiMode && this.data.multiRoute.length)
        ? this.data.multiRoute.reduce((a, s) => a + (s.days || 1), 0)
        : this.data.days;
      const perDayPer = customAmt / Math.max(1, totalDays) / Math.max(1, this.data.people);
      // 与网页版共用档位推导：<300/人天=经济，<600=舒适，其余=高端（planner.tierOfPerDay）
      budgetKey = T.P.tierOfPerDay ? T.P.tierOfPerDay(perDayPer) : (perDayPer < 300 ? "low" : perDayPer < 600 ? "mid" : "high");
    }
    this.setData({ loading: true });
    this._syncUi();
    // v1.19.2：生成是同步计算，大城 / 全省 14 天会明显停顿；补全屏 loading 给出明确反馈
    try { wx.showLoading({ title: "正在生成攻略…", mask: true }); } catch (e) {}
    // 自动存档当前行程（多行程管理：换计划不丢行程，more 页可恢复）
    try {
      const oldPlan = app.globalData.plan;
      if (oldPlan && oldPlan.days && oldPlan.days.length) T.savePlanSlot(oldPlan);
    } catch (e) {}
    try {
      const fromObj = this.data.fromCityObj || null;
      const from = fromObj ? { province: fromObj.province, city: fromObj.name } : { province: "山西省", city: "太原" };
      const pace = this.data.paceVals[this.data.paceIdx];
      const tm = this.data.travelModeVals[this.data.travelModeIdx];
      const bias = this.data.biasVals[this.data.biasIdx] || "";

      if (this.data.multiMode && this.data.multiRoute.length) {
        // 多站串联：每站一城，分别按段生成
        const route = this.data.multiRoute.slice(0, 4);
        const picksPerStation = {};
        route.forEach(s => {
          picksPerStation[s.name] = T.getWish().filter(x => !x.city || x.city === s.name).map(x => x.name);
        });
        const out = T.buildMultiPlan({
          route,
          depart: this.data.depart,
          budget: budgetKey, pace,
          travelMode: tm,
          people: this.data.people,
          stayMountain: this.data.stayMtn,
          picksPerStation,
          pickOnly: this.data.pickOnly,
          bias
        });
        app.globalData.from = { province: route[0].province, city: route[0].name };
        try {
          S.set("fromV1", { province: route[0].province, city: route[0].name });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: route.map(s => s.name).join(" → "),
          province: route[0].province,
          totalDays: out.totalDays,
          depart: this.data.depart,
          days: out.days,
          segments: out.segments,
          route: out.route,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: this.data.pickOnly,
          isMulti: true,
          from, savedAt: Date.now(),
          bias
        });
        T.pushRecent({ province: route[0].province, city: route[0].name, days: out.totalDays, depart: this.data.depart });
        this.setData({ recents: T.getRecent() });
      } else if (this.data.provMode) {
        // 全省 · 省内精华游：目的地 = 整省（跨城串联，酒店随城市变动；镜像网页版 __all）
        const provName = this.data.provName;
        if (!provName) { wx.showToast({ title: "请先选择目的地省份", icon: "none" }); return; }
        const daysArr = T.buildProvPlan({
          province: provName,
          days: this.data.days,
          depart: this.data.depart,
          budget: budgetKey,
          pace, travelMode: tm,
          stayMountain: this.data.stayMtn,
          bias
        });
        // v1.12.3 兜底：landmark 有限，实际天数可能少于所选，明确告知而非静默缩水
        if (daysArr.length < this.data.days) {
          wx.showToast({ title: provName + " 精华景点有限，本次生成 " + daysArr.length + " 天", icon: "none" });
        }
        app.globalData.from = { province: provName, city: "" };
        try {
          S.set("fromV1", { province: provName, city: "" });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: provName,
          province: provName,
          totalDays: daysArr.length,
          depart: this.data.depart,
          days: daysArr,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: false,
          isMulti: false,
          isProv: true,
          from,
          savedAt: Date.now(),
          bias
        });
        // 全省游不进「最近记录」（恢复需省名特判，v1 从简）
      } else {
        // 单城（既有逻辑）
        const c = this.data.cities[this.data.cityIdx];
        if (!c) { wx.showToast({ title: "请选择目的地城市", icon: "none" }); return; }
        const picks = T.getWish().filter(x => !x.city || x.city === c.name).map(x => x.name);
        const pickOnly = this.data.pickOnly && picks.length > 0;
        const daysArr = T.buildPlan({
          city: c,
          days: this.data.days,
          depart: this.data.depart,
          budget: budgetKey, pace, travelMode: tm,
          people: this.data.people,
          stayMountain: this.data.stayMtn,
          picks, pickOnly,
          bias
        });
        app.globalData.from = { province: this.data.provName, city: c.name };
        try {
          S.set("fromV1", { province: this.data.provName, city: c.name });
          S.set("fromCityV1", from.city);
        } catch (e) {}
        app.setPlan({
          cityName: c.name,
          province: this.data.provName,
          totalDays: daysArr.length,
          depart: this.data.depart,
          days: daysArr,
          budget: budgetKey,
          customAmt,
          people: this.data.people,
          pace, travelMode: tm,
          pickOnly: pickOnly,
          isMulti: false,
          from,
          savedAt: Date.now(),
          bias
        });
        T.pushRecent({ province: this.data.provName, city: c.name, days: daysArr.length, depart: this.data.depart });
        this.setData({ recents: T.getRecent() });
      }
      // v1.13.1：新行程落地前重置行李清单勾选（上一程的打包进度不带进新程）
      // v1.15.3：换目的地后，订往返票/订酒店/过流程/请假 等「绑定本次行程」的准备项一并重置
      T.resetTripPrep();
      // 埋点：生成成功（含类型维度，区分单城/多站/全省）
      try { AN.track("plan_generate", { ok: 1, mode: this.data.multiMode ? "multi" : (this.data.isGuide ? "prov" : "city"), days: this.data.days }); } catch (e) {}
      wx.switchTab({ url: "/pages/plan/plan" });
    } catch (err) {
      // 埋点：生成失败（这是最该盯的指标——主路径走不通，其他优化都是白费）
      try { AN.track("plan_generate", { ok: 0 }); } catch (e) {}
       // v1.11：生产包不留 console.log（错误已通过 toast 告知用户）
       // v1.19.49：单城生成失败多为瞬时异常，提示「稍后重试」比「换个路线」更准确，避免误以为目的地有问题
       wx.showToast({ title: "生成失败，请稍后重试", icon: "none" });
    } finally {
      try { wx.hideLoading(); } catch (e) {}
      try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) {}
      this.setData({ loading: false });
      this._syncUi();
    }
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

  onShow() {
    try { AN.pageView("index"); } catch (e) {}
    this.setData({ fz: T.fontScale() });
    (this.__boot || Promise.resolve()).then(() => {
      try { this._ensureForm(); } catch (e) {}
      try { this._renderShow(); } catch (e) {}
      try { this.maybeShowGuideModal(); } catch (e) {}
    });
  },

  // v1.19.60：数据就绪自愈 —— onLoad 内的省/市填充是同步执行的，若冷启动分包数据尚未到位
  // （或上次加载被吞错），选择器会渲染为空且 onShow._renderShow 不重填 → 永久空白误判白屏。
  // 此处待 ready() 后主动重填；仍为空才置 dataFailed 展示重试卡片。已选 provIdx/cityIdx 合法则保留。
  _ensureForm() {
    let provs = [];
    try { provs = T.provinces() || []; } catch (e) { provs = []; }
    if (!provs.length) { this.setData({ dataFailed: true }); return; }
    this.setData({ dataFailed: false });
    let provIdx = this.data.provIdx || 0;
    if (provIdx < 0 || provIdx >= provs.length) provIdx = 0;
    const prov = provs[provIdx];
    let cities = [];
    try { cities = T.citiesOf(prov) || []; } catch (e) { cities = []; }
    let cityIdx = this.data.cityIdx || 0;
    if (cityIdx < 0 || cityIdx >= cities.length) cityIdx = 0;
    try { this._initFrom(); } catch (e) {}   // from 表依赖 PROVINCE_CITIES，需随数据就绪重算
    this.setData({ provinces: provs, cities, provIdx, provName: prov || "", cityIdx });
    try { this._applyCity(cityIdx); } catch (e) {}
    try { this._syncAdv(); } catch (e) {}
    try { this._syncHoli(); } catch (e) {}
  },
  // v1.19.60：数据分包加载失败后的手动重试（重新触发数据加载并自愈）
  retryData() {
    if (this.data.loadingData) return;
    this.setData({ loadingData: true });
    const self = this;
    Promise.resolve()
      .then(() => { const D = require("../../utils/data.js"); return (D && D.initData) ? D.initData() : Promise.resolve(); })
      .then(() => { self.setData({ loadingData: false }); self._ensureForm(); })
      .catch(() => { self.setData({ loadingData: false, dataFailed: true }); });
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
  _renderShow() {
    this._theme();
    // v1.6：已有行程时在顶部显示出发倒计时；hasOld 同步刷新（影响首访引导横幅显隐）
    try {
      const p = getApp().globalData.plan;
      // v1.19.38：快捷入口默认展开（不再对老用户自动折叠），避免「只看到头部条、点了不跳转」的误解；
      // 折叠仍可通过头部「收起」手动触发，首屏减负交给高级设置/想玩池承担。
      this.setData({ countdown: T.tripCountdown(p), tiles: T.homeTileList(), hasOld: !!(p && p.days && p.days.length), quickCollapsed: false,
        guideSeen: !!(S.get("miniGuideSeenV1", 0)),
        draftCount: (S.getDrafts() || []).length,
        // v1.8.4 B18：首页预约提醒横幅（有「需提前预约」且未勾已订的票）
        remind: T.ticketRemind(p) });
    } catch (e) { this.setData({ countdown: null, tiles: T.homeTileList(), hasOld: false, quickCollapsed: false, remind: null, guideSeen: !!(S.get("miniGuideSeenV1", 0)) }); }
    // 2026-10-29：「今日正当时」已按用户要求下线（首页不再展示）
    // 想玩池勾选态与 wish 实时同步：在行程页/更多页勾过或移出想玩后回首页，不残留旧高亮
    if (this.data.cityName && this.data.pool && this.data.pool.length) this._syncPoolFromWish();
    this._syncUi();
  },

  /* ---- 智能推荐：一句话需求 → 候选城市 ----
   * 引擎在端侧完成标签解析与加权排序，不联网、无随机数：同一句话永远同一结果。
   * 只把 name/province/score/summary 四个字段下发到视图，避免把内部字段带进 setData。 ---- */
  onRecInput(e) {
    this.setData({ recText: (e.detail && e.detail.value) || "" });
  },
  onRecExample(e) {
    const t = e.currentTarget.dataset.t || "";
    if (!t) return;
    this.setData({ recText: t });
    this.onRecRun();
  },
  onRecRun() {
    if (this.data.recBusy) return;
    const text = (this.data.recText || "").trim();
    if (!text) { wx.showToast({ title: "先说一句想怎么玩", icon: "none" }); return; }
    this.setData({ recBusy: true, recTried: true });
    try {
      const res = R.recommend(text, { topN: 5 });
      if (res && res.pending) {
        this.setData({ recBusy: false, recList: [] });
        wx.showToast({ title: "数据加载中，稍后再试", icon: "none" });
        return;
      }
      const list = (res.list || []).map((x) => ({
        name: x.name,
        province: x.province || "",
        score: x.score,
        summary: x.summary || "",
      }));
      this.setData({ recBusy: false, recList: list });
    } catch (err) {
      this.setData({ recBusy: false, recList: [] });
      wx.showToast({ title: "推荐失败，请重试", icon: "none" });
    }
  },
  onRecPick(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    try {
      const provs = T.provinces() || [];
      for (let p = 0; p < provs.length; p++) {
        const cs = T.citiesOf(provs[p]) || [];
        if (cs.some((c) => c.name === name)) {
          this._fillProv(p, name);   // 内部已含 _applyCity：预填城市 + 收敛天数 + 想玩池
          wx.showToast({ title: "已填好「" + name + "」", icon: "none" });
          if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 });
          return;
        }
      }
      wx.showToast({ title: "该城可在目的地里搜索", icon: "none" });
    } catch (err) {
      wx.showToast({ title: "填入失败，请手动选择", icon: "none" });
    }
  },

  /* ---- v1.8.4 A8：目的地盲盒（3 城灵感，选中直接生成） ---- */
  onBlindRoll() {
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
    this.setData({ blind3: T.inspirePicks(3), blindOpen: true });
  },
  closeBlind() { this.setData({ blindOpen: false }); },
  useBlind(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.data.blind3[i];
    if (!it) return;
    this.setData({ blindOpen: false });
    const self = this;
    wx.showModal({
      title: "去 " + it.name + " 怎么样",
      content: "建议 " + it.days + " 天 · " + it.best + "\n" + (it.why || "") + "\n用当前预算/节奏生成一份？",
      confirmText: "生成",
      success(r) {
        if (!r.confirm) return;
        self._blindGen(it);
      }
    });
  },
  _blindGen(it) {
    try {
      const depart = this.data.depart || iso(new Date(Date.now() + 7 * 86400000));
      const daysArr = T.buildPlan({
        city: it.name, province: it.province, days: it.days || 3, depart,
        budget: this.data.budgetKeys[this.data.budgetIdx], pace: this.data.paceVals[this.data.paceIdx],
        people: this.data.people,
        bias: this.data.biasVals[this.data.biasIdx] || ""
      });
      const p = {
        cityName: it.name, province: it.province, totalDays: daysArr.length,
        depart, days: daysArr, budget: this.data.budgetKeys[this.data.budgetIdx],
        people: this.data.people, pace: this.data.paceVals[this.data.paceIdx],
        bias: this.data.biasVals[this.data.biasIdx] || "",
        isMulti: false, savedAt: Date.now()
      };
      T.resetTripPrep(); // v1.13.1 + v1.15.3：盲盒生成的也是新行程，行李清单与行程绑定项一并重置
      getApp().setPlan(p);
      wx.showToast({ title: "已生成「" + it.name + "」攻略", icon: "none" });
      setTimeout(() => wx.switchTab({ url: "/pages/plan/plan" }), 700);
    } catch (err) {
      wx.showToast({ title: "生成失败：" + (err.message || ""), icon: "none" });
    }
  },
  goPlan() { wx.switchTab({ url: "/pages/plan/plan" }); },
  // v1.8.4 B18：预约提醒 → 出行准备页
  goPrep() { wx.navigateTo({ url: "/subpkg/prep/prep" }); },
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
  // v1.7：快捷入口（tabBar 页用 switchTab，其余 navigateTo）
  // v1.19.38：导航失败时给出可见提示（避免「点了没反应」无从排查）；子包页加 loading 反馈；
  // dataset 取 currentTarget，缺失时回退 target，双保险。
  goTile(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) ||
               (e && e.target && e.target.dataset) || {};
    const url = ds.url;
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
    const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
    if (dt.toDateString() === now.toDateString()) return "今天 " + hh + ":" + mm;
    return (dt.getMonth() + 1) + "月" + dt.getDate() + "日 " + hh + ":" + mm;
  },
  // 收集当前首页全部配置（目的地 + 设置），用于存草稿
  _collectCfg() {
    const d = this.data;
    return {
      segIdx: d.segIdx,
      provMode: d.provMode,
      multiMode: d.multiMode,
      provIdx: d.provIdx,
      provName: d.provName,
      cityIdx: d.cityIdx,
      cityName: d.cityName,
      multiRoute: (d.multiRoute || []).map(s => ({ name: s.name, province: s.province, days: s.days })),
      days: d.days,
      depart: d.depart,
      paceIdx: d.paceIdx,
      biasIdx: d.biasIdx,
      travelModeIdx: d.travelModeIdx,
      budgetIdx: d.budgetIdx,
      showCustom: d.showCustom,
      customAmt: d.customAmt,
      people: d.people,
      stayMtn: d.stayMtn,
      fromIdx: d.fromIdx,
      pickOnly: d.pickOnly
    };
  },
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
  openDrafts() {
    const list = (S.getDrafts() || []).map(x => Object.assign({}, x, { timeTxt: this._draftTimeTxt(x.ts) }));
    this.setData({ drafts: list, draftCount: list.length, showDraft: true });
  },
  closeDrafts() { this.setData({ showDraft: false }); },
  applyDraft(e) {
    const id = e.currentTarget.dataset.id;
    const d = (this.data.drafts || []).find(x => x && x.id === id);
    if (!d) return;
    this._applyDraft(d.cfg);
    this.setData({ showDraft: false });
    wx.showToast({ title: "已恢复草稿「" + d.name + "」", icon: "none" });
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
  _applyDraft(cfg) {
    if (!cfg) return;
    if (cfg.provMode) {
      const pIdx = Math.max(0, (this.data.provinces || []).indexOf(cfg.provName));
      this.setData({ provIdx: pIdx, provName: cfg.provName, prevCity: null });
      this._enterProv(null);
      this._syncProv();
    } else if (cfg.multiMode) {
      const route = (cfg.multiRoute || []).map(s => ({ name: s.name, province: s.province, days: s.days }));
      this.setData({ multiMode: true, provMode: false, segIdx: 2, multiRoute: route, multiDaysTotal: this._sumDays(route) });
    } else {
      const pIdx = (cfg.provIdx != null && cfg.provIdx >= 0) ? cfg.provIdx : Math.max(0, (this.data.provinces || []).indexOf(cfg.provName));
      this.setData({ provMode: false, multiMode: false, segIdx: 0 });
      this._fillProv(pIdx, cfg.cityName);
    }
    this.setData({
      days: cfg.days, daysText: (cfg.days || 0) + " 天", depart: cfg.depart,
      paceIdx: cfg.paceIdx, biasIdx: cfg.biasIdx, travelModeIdx: cfg.travelModeIdx,
      budgetIdx: cfg.budgetIdx, showCustom: !!cfg.showCustom, customAmt: cfg.customAmt || "",
      people: cfg.people, stayMtn: cfg.stayMtn, fromIdx: cfg.fromIdx, pickOnly: cfg.pickOnly
    });
    this._syncAdv();
    this._syncUi();
    const c = this.data.cities[this.data.cityIdx];
    if (c && !cfg.provMode && !cfg.multiMode) this._refreshPool(c);
  }
}));
