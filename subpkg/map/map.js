const { getAppSafe, SafePage } = require("../../utils/app.js");
// map：原生地图 + 真实坐标标点 + 编号连线 + 图层（景点 / 美食 / 住宿）
const T = require("../../utils/travel.js");
const app = getAppSafe();

// v1.19.100：MARKER_CAP = 带数字标注的地图标点数量上限（超过只显示小圆点不标号）。
// 此前该常量被 134 行引用却从未声明（基线 v1.19.77 以来一直缺失），导致 onNext/onLayer 走到该分支时
// 抛 ReferenceError: MARKER_CAP is not defined → 地图页「下一页 / 图层」两个按钮失灵。取值 20 兼顾正常天数的全标号与超长列表可读性。
const MARKER_CAP = 20;

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "行程景点全标地图，点一下直接导航（离线可用）", path: "/pages/index/index" };
  },

  data: {
    fz: 1,
    td: false,
    hasPlan: false, cityName: "",
    dayIdx: 0, dayText: "",
    layer: "spots",  // spots | food | stay
    markers: [],
    polyline: [],
    center: { latitude: 34.34, longitude: 108.93 },
    scale: 12,
    list: [],           // 景点列表
    foodList: [],       // 美食列表
    hotel: null,        // 住宿点位
    // v1.15：景点标签筛选（当天）
    tagList: [], tagFilter: "", markerNote: ""
  },

  // v1.11：参数解析异常不能拖垮 onLoad（di 可能是任意脏值）
  onLoad(options) {
    try {
      let di = -1;
      if (options && options.di !== undefined && options.di !== null) {
        const n = parseInt(options.di, 10);
        if (!isNaN(n)) di = Math.max(0, n);
      }
      this._seedDi = di;
    } catch (e) { this._seedDi = -1; }
  },

    // v1.15：当天景点按标签筛选（再次点击取消）
  // v1.17.10：拿到地图上下文后才能主动移动视野
  onReady() {
    try { this._mapCtx = wx.createMapContext("map", this); } catch (e) { this._mapCtx = null; }
  },
  // 把视野框到当天所有点（点太少时以该点为中心放大，避免过度缩放）
  _fitDay(points) {
    const pts = (points || []).filter(p => p && p.latitude && p.longitude);
    if (!pts.length) return;
    if (!this._mapCtx) { try { this._mapCtx = wx.createMapContext("map", this); } catch (e) { return; } }
    try {
      if (pts.length === 1) {
        this._mapCtx.moveToLocation({ latitude: pts[0].latitude, longitude: pts[0].longitude });
        this.setData({ center: { latitude: pts[0].latitude, longitude: pts[0].longitude }, scale: 14 });
      } else {
        // 多点时先复位缩放（否则上一天单点留下的 14 级会一直嵌在视野里），再框选全部点
        this.setData({ scale: 12 });
        this._mapCtx.includePoints({ points: pts, padding: [50, 40, 80, 40] });
      }
    } catch (e) {}
  },

  onTagFilter(e) {
    const tag = String(e.currentTarget.dataset.tag || "");
    const next = this.data.tagFilter === tag ? "" : tag;
    this.setData({ tagFilter: next });
    try {
      const plan = app.globalData && app.globalData.plan;
      if (plan && plan.days && plan.days.length) this._renderDay(plan, this.data.dayIdx || 0);
    } catch (e) {}
  },

  _theme() { try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {} },
  // v1.11：地图页依赖行程数据 + 坐标库，任一步抛错都会白屏；整体包异常兜底留空态
  // v1.19.60：原独立 onLoad() 已合并进上方（解析 di + 启动数据就绪守卫二合一）
  onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() {
    try {
      this._theme();
      const plan = app.globalData && app.globalData.plan;
      if (!plan || !plan.days || !plan.days.length) { this.setData({ hasPlan: false }); return; }
      let dayIdx = 0;
      if (this._seedDi >= 0) {
        dayIdx = Math.min(this._seedDi, plan.days.length - 1);
        this._seedDi = -1; // 仅在带参进入的那一次展示目标天，之后回落默认逻辑
      } else {
        try {
          const st = T.todayState(plan);
          if (st && st.phase === "during") dayIdx = st.idx;
        } catch (e) {}
      }
      this._renderDay(plan, dayIdx);
    } catch (e) {
      try { this.setData({ hasPlan: false, markers: [], polyline: [], list: [], foodList: [] }); } catch (_) {}
    }
  },

  _renderDay(plan, di) {
    const day = plan.days[di];
    // 多站行程：每天属于哪一段就用哪座城市的坐标/美食/住宿库；单城直接用 plan.cityName
    let cityName = plan.cityName;
    const segs = Array.isArray(plan.segments) ? plan.segments : null;
    if (segs && segs.length) {
      if (segs.length === 1) cityName = segs[0].cityName || cityName;
      else {
        let s = 0;
        for (let k = 0; k < segs.length; k++) {
          if (di >= segs[k].startDay && di <= segs[k].endDay) { s = k; break; }
        }
        cityName = segs[s].cityName || cityName;
      }
    }
    let mk = [], list = [], realCoords = [];
    let c = null;
    try {
      const anchor = T.P.getCoord(cityName);
      if (anchor) c = { latitude: anchor.lat, longitude: anchor.lon };
    } catch (e) {}
    let seq = 0;
    const seenSpot = new Set();
    (day.items || []).forEach((it, ix) => {
      if (T.isFrameName(it.name)) return;
      const n = T.cleanSpotName(it.name);
      if (n && seenSpot.has(n)) return;   // 同景点上午/下午拆分条目只标一次
      if (n) seenSpot.add(n);
      let coord = null;
      try { coord = T.P.getSpotCoord(cityName, n); } catch (e) {}
      const real = !!(coord && coord.lat && coord.lon && coord.approx === false);
      if (real) {
        seq++;
        const numbered = seq <= MARKER_CAP;
        mk.push({
          id: mk.length,
          latitude: coord.lat, longitude: coord.lon,
          width: numbered ? 32 : 20, height: numbered ? 32 : 20,
          callout: numbered ? { content: "" + seq, fontSize: 16, color: "#1a1a1a",
            bgColor: "#d4a94e", borderRadius: 16, padding: 4, display: "ALWAYS" } : undefined,
          markerType: "spots", seq: 0, name: n
        });
        realCoords.push({ latitude: coord.lat, longitude: coord.lon });
        if (!numbered) overCap++;
      }
      list.push({ name: n, period: it.period, real, seq: real ? seq : 0, tags: T.spotTagOf(n, cityName) });
    });
    // v1.15：标签筛选（当天）—— 保存全量，过滤后展示
    const allList = list.slice();
    const allMk = mk.slice();
    const allReal = realCoords.slice();
    const tagSet = new Set();
    allList.forEach(x => (x.tags || []).forEach(t => tagSet.add(t)));
    const tagList = Array.from(tagSet);
    const tagFilter = this.data.tagFilter || "";
    if (tagFilter) {
      list = list.filter(x => (x.tags || []).some(t => t === tagFilter || t.indexOf(tagFilter) >= 0 || tagFilter.indexOf(t) >= 0));
      const keep = new Set(list.map(x => x.name));
      mk = mk.filter(m => keep.has(m.name));
      realCoords = mk.filter(m => m.markerType === "spots").map(m => ({ latitude: m.latitude, longitude: m.longitude }));
    }
    const today = T.fmtLocalDate(new Date());
    const isToday = String(day.date).slice(0, 10) === today;
    // 美食 + 住宿图层（预算贴合：美食平价优先排序 / 酒店取当前档位）放入 setData
    const bKey = (plan && plan.budget) || "mid";
    const foodList = T.budgetFoodFirst(T.foodSpotsFor(cityName), bKey, false).slice(0, 18);
    const hotelAreas = T.hotelAreaPins(cityName, bKey);
    const hotelPortals = T.hotelPortals(cityName, plan);
    // 拼接图层：仅「景点」层展示标点与当天行进连线，美食/住宿层互斥显示
    const isSpotLayer = this.data.layer === "spots";
    let showMk = isSpotLayer ? mk.slice() : [];
    let showPolyline = (isSpotLayer && realCoords.length >= 2)
      ? [{ points: realCoords, color: "#d4a94e", width: 4, dottedLine: false, arrowLine: true }]
      : [];
    let showFoodList = [];
    if (this.data.layer === "food") {
      foodList.forEach(fs => {
        if (fs.lat && fs.lon) showMk.push({
          id: showMk.length, latitude: fs.lat, longitude: fs.lon,
          width: 26, height: 26,
          callout: { content: "美食 · " + (fs.shop || ""), fontSize: 12, color: "#eaeff7",
            bgColor: "rgba(125,167,212,.85)", borderRadius: 10, padding: 4, display: "BYCLICK" },
          markerType: "food", name: fs.shop || ""
        });
      });
      showFoodList = foodList;
    } else if (this.data.layer === "stay") {
      hotelAreas.forEach((h, i) => showMk.push({
        id: showMk.length, latitude: h.lat, longitude: h.lon,
        width: 28, height: 28,
        callout: { content: "住 · " + h.name, fontSize: 12, color: "#eaeff7",
          bgColor: "rgba(212,169,78,.85)", borderRadius: 10, padding: 4, display: "BYCLICK" },
        markerType: "stay", name: h.name || "", areaIdx: i
      }));
    }
    const isMultiCity = !!(segs && segs.length > 1);
    this.setData({
      hasPlan: true, cityName,
      dayIdx: di,
      dayText: "D" + (di + 1) + (isToday ? " · 今天" : "") + " " + String(day.date).slice(5) +
        (isMultiCity ? " · " + cityName : ""),
      markers: showMk,
      polyline: showPolyline,
      list, foodList, hotelAreas: hotelAreas, hotelPortals: hotelPortals,
      tagList, tagFilter,
      // v1.8.4 B11：当天动线顺路度
      route: T.routeScore(plan, di),
      center: c || { latitude: 39.9, longitude: 116.4 }
    });
    // v1.17.10：切天后主动把地图视野移到当天（旧实现只改 center 数据，地图组件不会跟随，
    // 导致每次进来都停在旧位置、用户得手动拖到自己的行程点）
    this._fitDay(realCoords);
  },

  // v1.19.2：到边界时原来静默无反应，用户以为按钮坏了 → 补一句明确提示
  onPrev() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    if (this.data.dayIdx <= 0) { wx.showToast({ title: "已经是第 1 天", icon: "none" }); return; }
    this._renderDay(plan, this.data.dayIdx - 1);
  },
  onNext() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    if (this.data.dayIdx >= plan.days.length - 1) { wx.showToast({ title: "已经是最后一天", icon: "none" }); return; }
    this._renderDay(plan, this.data.dayIdx + 1);
  },
  onLayer(e) {
    const layer = e.currentTarget.dataset.layer;
    if (layer === this.data.layer) return;
    this.setData({ layer, tagFilter: "" });
    const plan = app.globalData.plan;
    if (plan) this._renderDay(plan, this.data.dayIdx);
  },

  goNav(e) {
    const n = e.currentTarget.dataset.name;
    if (!n) return;
    this._openSpotNav(n);
  },

  // 点地图 pin / 列表行 → 有真实坐标直接进微信内置地图（可一键导航）；示意点给工具内提示
  _openSpotNav(n) {
    const t = T.navTarget(n, this.data.cityName);
    if (!t) return;
    if (t.type === "coord") {
      wx.openLocation({ latitude: t.lat, longitude: t.lon, name: t.name, scale: 16 });
    } else if (t.type === "city") {
      wx.showModal({
        title: "定位到" + (t.city || "") + "？",
        content: "「" + t.name + "」暂无精确收录点。将打开「" + (t.city || "") + "」地图，你在地图里直接搜景点名即可导航到达。",
        confirmText: "打开地图",
        success: (r) => { if (r.confirm) wx.openLocation({ latitude: t.lat, longitude: t.lon, name: t.city || t.name, address: t.name + "（打开后请在地图内搜索该景点）", scale: 13 }); }
      });
    } else {
      wx.showModal({
        title: t.name,
        content: "暂未收录该点的精确定位。到当地后，用「附近/问路」或打车到「" + t.keyword + "」即可到达（本页地图已标出当天行程范围，可先看方向）。",
        showCancel: false,
        confirmText: "知道了"
      });
    }
  },

  // 地图标点点击：直接定位/导航，不用再复制名字去别处
  onMarkerTap(e) {
    const id = e.detail && e.detail.markerId;
    const m = (this.data.markers || []).find(x => x.id === id);
    if (!m || !m.latitude || !m.longitude) return;
    if (m.markerType === "spots") {
      wx.openLocation({ latitude: m.latitude, longitude: m.longitude, name: m.name || "", scale: 16 });
    } else if (m.markerType === "food") {
      wx.openLocation({ latitude: m.latitude, longitude: m.longitude, name: m.name || "美食", scale: 16 });
    } else if (m.markerType === "stay") {
      wx.openLocation({ latitude: m.latitude, longitude: m.longitude, name: m.name || "住宿", scale: 16 });
    }
  },

  // 美食/住宿导航（list 项点击）
  goFood(e) {
    const i = Number(e.currentTarget.dataset.i);
    const fs = this.data.foodList[i];
    if (!fs || !fs.lat || !fs.lon) {
      wx.showToast({ title: "该店暂无坐标", icon: "none" }); return;
    }
    wx.openLocation({ latitude: fs.lat, longitude: fs.lon, name: fs.shop, address: fs.addr, scale: 16 });
  },
  goHotel(e) {
    const i = e.currentTarget.dataset.i;
    const list = this.data.hotelAreas || [];
    const h = (typeof i === "number" && list[i]) ? list[i] : list[0];
    if (!h) { wx.showToast({ title: "暂无酒店坐标", icon: "none" }); return; }
    wx.openLocation({ latitude: h.lat, longitude: h.lon, name: h.name, address: h.note, scale: 16 });
  },
  copyPortal(e) {
    const t = e.currentTarget.dataset.term;
    const p = e.currentTarget.dataset.platform;
    if (!t) return;
    wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制，去" + p + "比价", icon: "none" }) });
  }
}));
