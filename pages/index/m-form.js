// pages/index/m-form.js —— 首页表单交互（城市选择器 / 想玩池 / 天数 / 交通方式 / 预算 / 多站 / 收藏与最近）（从 index.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./index-ctx.js");
const { app, AN, T, S, R, PACE_TXT, MODE_TXT, iso, _uniqRecent } = C;

module.exports = {
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

  pickClearPool() {
    const c = this.data.cities[this.data.cityIdx];
    this.data.pool.forEach(it => { if (it.on) T.toggleWish(it.name, c ? c.name : ""); });
    const full = this.data.pool.map(it => ({ name: it.name, on: false }));
    this._applyPoolList(full);
    wx.showToast({ title: "已清空想玩勾选", icon: "none" });
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

  /* ---- 想玩勾选（写入 wish，与行程页互通） ---- */
  onPickOnly(e) {
    const v = !!e.detail.value;
    S.set("pickOnlyV1", v);
    this.setData({ pickOnly: v });
    wx.showToast({ title: v ? "已开启「只玩勾选」· 生成时优先安排" : "已关闭「只玩勾选」· 全自动推荐", icon: "none" });
  },

  // v1.20.12：加 180ms 防抖，与文件下方 onPickKw2 同一套。
  // 旧实现每敲一个字都要 ① 重建城市表（旧 _allCities 无缓存，872 个对象全量分配）
  // ② 全量 filter ③ setData 全量列表 —— 低端机上连续输入会明显掉帧。
  // 关键词仍然立即回显（打字手感不变），只把「过滤 + setData」推到停下来那一帧。
  onPickKw(e) {
    const kw = e.detail.value;
    this.setData({ pickKw: kw });
    if (this._pickKwTimer) clearTimeout(this._pickKwTimer);
    this._pickKwTimer = setTimeout(() => {
      this._pickKwTimer = null;
      this._applyPickList(this._pickSrc());
    }, 180);
  },

  _pickSrc() {
    return this.data.pickMode === "from" ? this.data.fromList : this._allCities();
  },

  // v1.19.2：搜索无防抖 —— 池子动辄数百条，每敲一个字都全量 filter + setData 会明显卡顿。
  // 现在输入立即回显关键词、过滤结果做 180ms 防抖，快速连打只算最后一帧。
  onPickKw2(e) {
    const kw = e.detail.value.trim();
    this.setData({ pickKw2: kw });
    if (this._kwTimer) clearTimeout(this._kwTimer);
    this._kwTimer = setTimeout(() => { this._kwTimer = null; this._filterPool(); }, 180);
  },

  onPickProv(e) {
    const p = e.currentTarget.dataset.p || "";
    // 切省份时取消挂起的输入防抖，避免 180ms 后再用旧关键词覆盖一次
    if (this._pickKwTimer) { clearTimeout(this._pickKwTimer); this._pickKwTimer = null; }
    const src = this._pickSrc();
    this.setData({ pickProv: p, pickKw: "" });
    this._applyPickList(src);
  },

  _closePicker() { this.setData({ showPicker: false }); },

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

  // v1.8：玩几天改「－ 数字 ＋」步进 + 常用天数快捷（手机上滑杆一拖就飞，很难精准）
  onDaysMinus() { const v = Math.max(1, this.data.days - 1); this.setData({ days: v, daysText: v + " 天" }); },

  onDaysPlus() { const cap = this._dayCap(); const v = Math.min(cap, this.data.days + 1); this.setData({ days: v, daysText: v + " 天" }); },

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
    this.setData({ recents: _uniqRecent(T.delRecent(i)) });
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

  /* ---- 预算（含自定义 = 全行程总预算） ---- */
  onBudgetChange(e) {
    const i = Number(e.detail.value);
    if (i < 0 || i >= this.data.budgetKeys.length) return;
    this.setData({ budgetIdx: i, showCustom: this.data.budgetKeys[i] === "custom" });
    this._syncAdv();
  },

  onPaceChange(e) { this.setData({ paceIdx: Number(e.detail.value) }); this._syncAdv(); },

  onBiasChange(e) { this.setData({ biasIdx: Number(e.detail.value) }); this._syncAdv(); },

  onTravelModeChange(e) { this.setData({ travelModeIdx: Number(e.detail.value) }); this._syncAdv(); },

  onCustomAmt(e) { this.setData({ customAmt: e.detail.value }); this._syncAdv(); },

  /* ---- 人数 1-10（对齐网页） ---- */
  onPeopleMinus() { if (this.data.people > 1) this.setData({ people: this.data.people - 1 }); this._syncAdv(); },

  onPeoplePlus() { if (this.data.people < 10) this.setData({ people: this.data.people + 1 }); this._syncAdv(); },

  onStayMtn(e) { this.setData({ stayMtn: e.detail.value }); this._syncAdv(); },

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

  /* ---- 多站路线（≤4 站）---- */
  _sumDays(r) { return (r || []).reduce((a, s) => a + (parseInt(s.days, 10) || 1), 0); },

  /* ---- 想玩池折叠 ---- */
  onPoolTap() { this.setData({ poolOpen: !this.data.poolOpen }); },

  /* ---- v1.19 P0-1：发现灵感区块折叠 ---- */
  toggleDiscover() { this.setData({ discoverOpen: !this.data.discoverOpen }); this._syncUi(); },

  /* ---- v1.19.1 减法：快捷入口折叠（老用户默认收起） ---- */
  toggleQuick() { this.setData({ quickCollapsed: !this.data.quickCollapsed }); },

  noop() {},

  /* ---- 高级设置折叠 ---- */
  onAdvTap() { this.setData({ advOpen: !this.data.advOpen }); this._syncUi(); },
};
