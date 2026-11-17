// pages/index/m-config.js —— 首页状态同步（深链进入 / 偏好回填 / 预算高级项 / 想玩池与选城联动）（从 index.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./index-ctx.js");
const { app, AN, T, S, R, PACE_TXT, MODE_TXT, iso, _uniqRecent } = C;

module.exports = {
  // v1.19.76：分享/搜索深链 —— 带 city/days 参数时，自动把出发页预填好对应城市与天数
  _applyDeepLink(options) {
    if (!options || !options.city) return;
    const cn = String(T.decQuery(options.city)).trim();
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
      // v1.19.180：接住分享方带来的生成参数，并支持 auto=1 一键复现同款行程。
      // 行程生成是确定性的（同城/同天数/同日期/同节奏 → 同一份行程），故参数齐即可复现。
      const patch = {};
      try {
        if (options.pace && Array.isArray(this.data.paceVals)) {
          const i = this.data.paceVals.indexOf(String(options.pace));
          if (i >= 0) patch.paceIdx = i;
        }
        if (options.budget && Array.isArray(this.data.budgetKeys)) {
          const i = this.data.budgetKeys.indexOf(String(options.budget));
          if (i >= 0) patch.budgetIdx = i;
        }
        // v1.19.193：自定义预算的分享方带上了总预算金额（amt），这里回填 customAmt，
        // 否则 budgetIdx=custom 但 customAmt 为空，generate() 会因金额缺失而卡住、复现失败。
        if (options.amt) {
          const amt = parseFloat(String(T.decQuery(options.amt)));
          if (amt > 0) patch.customAmt = String(amt);
        }
        if (options.mode && Array.isArray(this.data.travelModeVals)) {
          const i = this.data.travelModeVals.indexOf(String(options.mode));
          if (i >= 0) patch.travelModeIdx = i;
        }
        // 出发日：过期（早于今天）顺延今天，保证 auto=1 复现的是「今天起」的有效行程（v1.19.182）
        if (options.depart) {
          const clamped = T.clampDepart(String(T.decQuery(options.depart)));
          if (clamped) patch.depart = clamped;
        }
      } catch (e) {}
      if (Object.keys(patch).length) {
        this.setData(patch, () => { try { this._syncAdv(); } catch (e) {} });
      }
      wx.showToast({ title: "已为你填好「" + cn + "」", icon: "none" });
      // auto=1：对方是「打开别人的攻略」，直接生成同一份行程进入行程页
      if (String(options.auto) === "1") {
        this._autoGenOnce = true;
        setTimeout(() => {
          if (!this._autoGenOnce) return;
          this._autoGenOnce = false;
          try {
            const D = T.D;
            if (D && D.__dataReady === false) { this.__autoPending = true; return; }
            this.generate();
          } catch (e) { /* 自动生成失败则留在首页，用户可手动点 */ }
        }, 420);
      }
    } catch (e) { /* 深链失败静默降级，不影响首页正常使用 */ }
  },

  // v1.19.178 跨会话偏好预填：用 learnPrefs 记下的「上次生成选项」回填出发页，减少重复点选。
  // 优先级：深链(options.city/options.days)已显式指定时，对应维度以深链为准、不覆盖；其余维度仍用偏好补齐。
  // 全程 try/catch 兜底，任何异常都不影响首页正常渲染（偏好预填只是锦上添花）。
  _applyPrefs(options) {
    let p = null;
    try { p = T.getPrefs(); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return;
    const deepCity = !!(options && options.city);
    const deepDays = !!(options && options.days);
    // v1.19.180：深链若已指定节奏/预算/出行方式（来自「打开别人的攻略」），这些维度不再被偏好覆盖，
    // 否则对方看到的行程就复现不出来了。
    const deepPace = !!(options && options.pace);
    const deepBudget = !!(options && options.budget);
    const deepMode = !!(options && options.mode);
    // 城市：仅当深链未指定时才用偏好（跨省份也要正确切到偏好城市所在的省）
    if (!deepCity && p.city) {
      try {
        const provs = this.data.provinces || T.provinces();
        for (let pi = 0; pi < provs.length; pi++) {
          const cs = T.citiesOf(provs[pi]) || [];
          if (cs.some(c => c.name === p.city)) { this._fillProv(pi, p.city); break; }
        }
      } catch (e) {}
    }
    // 天数 / 节奏 / 出行方式 / 预算：用偏好补齐（深链已设天数则跳过）
    const patch = {};
    if (!deepDays && p.days && p.days > 0) { patch.days = p.days; patch.daysText = p.days + " 天"; }
    if (p.pace && !deepPace && Array.isArray(this.data.paceVals)) { const i = this.data.paceVals.indexOf(p.pace); if (i >= 0) patch.paceIdx = i; }
    if (p.travelMode && !deepMode && Array.isArray(this.data.travelModeVals)) { const i = this.data.travelModeVals.indexOf(p.travelMode); if (i >= 0) patch.travelModeIdx = i; }
    if (p.budget && !deepBudget && Array.isArray(this.data.budgetKeys)) { const i = this.data.budgetKeys.indexOf(p.budget); if (i >= 0) patch.budgetIdx = i; }
    if (Object.keys(patch).length) {
      this.setData(patch, () => { try { this._syncAdv(); } catch (e) {} });
    }
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
      low: "人均 ¥150–300 / 天（青旅或快捷酒店 + 小吃为主）",
      mid: "人均 ¥300–600 / 天（连锁酒店 + 正餐 + 打车）",
      high: "人均 ¥600–1200 / 天（四星以上 + 品质餐厅 + 包车）"
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
    // v1.20.12：渲染窗口上限 300，与同文件想玩池 poolFiltered 同一惯例。
    // 「全部省份」视图有 872 城，一次 setData 全量列表约 35KB、要渲染 872 行；
    // 只下发前 300 条并把剩余数量交给视图提示，用户继续输入或点省份即可收敛。
    // 注意 chooseFromPicker 用的是 pickList 的下标，所以必须先切片再下发，两者天然一致。
    const CAP = 300;
    const matched = list.length;
    const shown = matched > CAP ? list.slice(0, CAP) : list;
    this.setData({ pickList: shown, pickMore: Math.max(0, matched - shown.length) });
  },

  _syncPoolFromWish() {
    const c = this.data.cities[this.data.cityIdx];
    if (!c) return;
    const wished = new Set(T.getWish().filter(x => !x.city || x.city === c.name).map(x => x.name));
    this._applyPoolList(this.data.pool.map(x => ({ name: x.name, on: wished.has(x.name) })));
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

  // v1.9：出发日期假期提示
  _syncHoli() {
    let h = null;
    try { h = T.holidayHint(this.data.depart); } catch (e) { h = null; }
    this.setData({ holi: h });
    this._syncPack();
  },

  // 预计算派生文案（把 WXML 里的嵌套三元 / 字符串拼接搬到 JS，渲染层零逻辑）
  _syncUi() {
    const d = this.data;
    this.setData({
      advHintTx: d.advOpen ? "收起" : (d.advChips.length ? "已调 " + d.advChips.length + " 项" : "节奏 / 模式 / 预算 / 人数"),
      poolSubTx: d.poolOn ? d.poolOn + " 个已选 · 行程优先安排" : "不勾选则全自动推荐",
      btnTx: d.loading ? "生成中…" : (d.provMode ? "生成全省精华攻略" : d.multiMode ? "生成多站攻略" : "生成我的攻略")
    });
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
};
