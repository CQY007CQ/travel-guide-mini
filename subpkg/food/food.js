const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// food：必吃清单 + 地道名店（点击名店 → wx.openLocation 导航）
// 多站行程：顶部城市切换条，逐站看美食（默认定位到今天所在站）
// v1.20.x：必吃清单的每个菜名可点 —— 点「北京烤鸭」直接筛出做这道菜的店（utils/food-map.js）
const T = require("../../utils/travel.js");
const Cloud = require("../../utils/cloud.js");   // 云端 AI（llmProxy 强模型网关，fail-closed）
const AIAgent = require("../../utils/ai-agent.js");
const FM = require("../utils/food-map.js");
const EL = require("../../utils/errlog.js");  // v1.19.200：渲染异常留痕，不再静默伪装成「没生成攻略」
const app = getAppSafe();

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "到一个城市吃什么？必吃清单 + 地道名店一键导航", path: "/pages/index/index" };
  },

  data: {
    fz: 1, td: false, hasPlan: false, cityName: "", foods: [], note: "", shops: [], budgetTxt: "", segs: [], fIdx: 0, emptyShopTx: "", shopSrc: "",
    // v1.8.4 A3：按时段看吃什么（早 / 正餐 / 夜宵）
    slotFilter: "all", slots: [{ k: "all", t: "全部" }, { k: "early", t: "早餐" }, { k: "main", t: "正餐" }, { k: "night", t: "夜宵" }],
    // 菜名筛选：activeDish 非空时，名店列表只显示"做这道菜"的店
    activeDish: "", dishNote: "", shopHead: "",
    // AI 吃什么（云端强模型优先 · 离线兜底）
    aiText: "", aiSource: "", aiLoading: false, aiErr: "" },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  // 口碑标签 → 样式 key（与 food.wxss 的 .rep-* 对应）
  _repClass(rep) {
    if (rep === "老字号") return "old";
    if (rep === "本地人常去") return "local";
    if (rep === "游客打卡") return "tourist";
    if (rep === "市井烟火") return "street";
    if (rep === "宴请名店") return "fine";
    return "";
  },
  // v1.11：美食页依赖 FOOD_SPOTS 表，城市未收录时也要给出空态而不是崩掉
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() { onShowRender(this, "food"); },
  _renderShow() {
    let entered = false;   // 是否确已确认「有行程」并进入渲染
    try {
      this._theme();
      const plan = app.globalData && app.globalData.plan;
      // v1.17.10：省域行程的 plan 没有 cityName（只有 province），旧判断直接把美食页判成空态
      if (!plan || (!plan.cityName && !plan.isProv)) { this.setData({ hasPlan: false }); return; }
      entered = true;
      const isProv = !!plan.isProv;
      const provCities = isProv ? (T.citiesOf(plan.province) || []).map(c => c.name).filter(Boolean) : [];
      // 多站：segs 提供可切换城市列表；省域：用省内城市列表；单城保持原样
      const segs = (Array.isArray(plan.segments) && plan.segments.length > 1)
        ? plan.segments.map((s, i) => ({ i, name: s.cityName || "" })).filter(s => s.name)
        : (isProv ? provCities.map((n, i) => ({ i, name: n })) : []);
      let fIdx = 0;
      if (segs.length) {
        try {
          const cur = T.activeCityOf(plan);   // 旅途中 = 今天所在站；行前/结束后 = 首站
          const k = segs.findIndex(s => s.name === cur);
          if (k >= 0) fIdx = k;
        } catch (e) {}
      }
      this.setData({ hasPlan: true, segs, fIdx });
      const fallbackCity = isProv ? (provCities[0] || plan.province) : plan.cityName;
      this._renderCity(segs.length ? segs[fIdx].name : fallbackCity, plan.budget || "mid");
    } catch (e) {
      // v1.19.200：旧版把所有渲染异常都吞掉并 setData({hasPlan:false})，
      // 真机上表现为「行程页有攻略、美食页却说先去生成攻略」，且没有任何提示可查。
      // 现在：留痕 + 可见反馈；已确认有行程时保留 hasPlan，绝不回退成假空态。
      try { console.error("[food] 渲染失败", e); } catch (_) {}
      try { EL.push("food._renderShow", e); } catch (_) {}
      if (entered) {
        try { this.setData({ hasPlan: true }); } catch (_) {}
        try { wx.showToast({ title: "加载失败，请重试", icon: "none" }); } catch (_) {}
      } else {
        try { this.setData({ hasPlan: false }); } catch (_) {}
      }
    }
  },

  // 切换多站城市
  onCityTap(e) {
    const i = Number(e.currentTarget.dataset.i);
    const plan = app.globalData.plan;
    if (!plan || !this.data.segs[i]) return;
    // 换城市时清掉菜品筛选，避免把上一城的菜名带到下一城
    this.setData({ fIdx: i, activeDish: "", dishNote: "" });
    this._renderCity(this.data.segs[i].name, plan.budget || "mid");
  },

  _renderCity(cityName, budgetKey) {
    const city = T.findCity(cityName);
    let spots = (T.D.FOOD_SPOTS && T.D.FOOD_SPOTS[cityName]) || [];
    // v1.17.10：新城（平遥/婺源/凤凰等）暂无独立名店数据时，就近回退到所属地级市的名店
    //（晋中的「冠云平遥牛肉（古城店）」本就在平遥古城、桂林的「谢大姐啤酒鱼」本就在阳朔西街），
    // 并明确标注来源城市，避免用户以为店就在本地。
    let shopSrc = "";
    if (!spots.length) {
      const parent = T.nearbyCityOf(cityName);
      if (parent) {
        spots = (T.D.FOOD_SPOTS && T.D.FOOD_SPOTS[parent]) || [];
        if (spots.length) shopSrc = "以下为就近「" + parent + "」的名店";
      }
    }
    // 预算贴合排序（与网页版同规则：经济→平价主推 / 舒适→平价+中档 / 高端→中档+高档）
    const sorted = T.budgetFoodFirst(spots, budgetKey, true);
    // v1.8.4 A3：给名店打时段标签 + 全量缓存，_apply 负责按槽过滤展示
    const allShops = sorted.map((s, i) => {
      const o = Object.assign({
        id: i,
        food: s.food, shop: s.shop, addr: s.addr, price: s.price,
        lat: s.lat, lon: s.lon,
        band: s.bandName || "", hit: !!s.hit,
        bandKey: s.bandName === '平价' ? 'low' : s.bandName === '中档' ? 'mid' : s.bandName === '高档' ? 'high' : '',
        m: 0,
        // v1.21：菜单 / 口碑 / 编辑点评（试点热门城市；非试点店无这些字段，UI 优雅回退）
        menu: Array.isArray(s.menu) ? s.menu : [],
        rep: s.rep || "",
        // v1.19.200：_repClass 是 Page 配置里的对象方法，对象方法简写不会在词法作用域
        // 创建同名绑定，旧版裸调用必抛 ReferenceError，被 _renderShow 吞掉后整页变空态。
        // map 是箭头函数，this 继承 _renderCity 的页面实例，故用 this._repClass。
        repKey: this._repClass(s.rep),
        note: s.note || ""
      }, { slot: T.mealSlotOf((s.food || "") + " " + (s.shop || "")) });
      // 副标题预计算：food 字段全库几乎为空，直接拼会渲染出「 · 地址」这种多一个点的情况
      o.sub = s.food ? (s.food + " · " + (s.addr || "")) : (s.addr || "");
      return o;
    });
    this._allShops = allShops;
    this._allFoods = (city && city.foods) || [];
    this.setData({
      cityName,
      note: (city && city.foodNote) || "",
      shopSrc,
      // 内部排序机制不展示（用户不需要知道我们怎么排的，看结果即可）
      budgetTxt: ""
    });
    this._apply();
  },

  // v1.8.4 A3：按时段过滤必吃与名店（关键词归类；未命中归正餐）
  // v1.9：必吃项加口味小标签（辣/甜/鲜/香/爽/经典）
  // v1.20.x：菜名可点 → 名店列表收敛到「做这道菜」的店；无命中则不编造，回退本城推荐
  _apply() {
    const sf = this.data.slotFilter;
    const dish = this.data.activeDish;
    let foods, base;
    if (sf === "all") { foods = this._allFoods; base = this._allShops; }
    else {
      foods = this._allFoods.filter(f => T.mealSlotOf(f) === sf);
      base = this._allShops.filter(s => s.slot === sf);
    }
    const tagFoods = foods.map(n => ({ n, tag: T.tasteTagOf(n), on: n === dish }));

    let shops = base, dishNote = "";
    if (dish) {
      const hit = FM.shopsForDish(base, dish);
      if (hit.length) {
        shops = hit;
        dishNote = "「" + dish + "」相关 " + hit.length + " 家（按店名匹配）";
      } else {
        dishNote = "暂无店名带「" + dish + "」的店，先看本城推荐；也可点该菜名取消筛选";
      }
    }

    // v1.12 UI 减法：名店空态文案预计算，避免 WXML 内三元拼接
    const emptyShopTx = sf !== "all" ? "该时段无名店，切「全部」看看" : "本城暂无店铺数据";
    const shopHead = (dish ? "「" + dish + "」· " : "") + "点击导航 · 已按当前时段筛出 " + shops.length + " 家";
    this.setData({ foods: tagFoods, shops, foodN: tagFoods.length, shopN: shops.length, emptyShopTx, dishNote, shopHead });
  },

  onSlot(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.slotFilter) return;
    this.setData({ slotFilter: k });
    this._apply();
  },

  // 点菜名：筛选做这道菜的店；再点一次取消
  onDish(e) {
    const n = String(e.currentTarget.dataset.n || "");
    if (!n) return;
    const next = n === this.data.activeDish ? "" : n;
    this.setData({ activeDish: next });
    this._apply();
    if (next) {
      try { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 460, duration: 200 }); } catch (_) {}
    }
  },

  onShopNav(e) {
    const s = e.currentTarget.dataset;
    if (s.lat && s.lon) {
      wx.openLocation({ latitude: Number(s.lat), longitude: Number(s.lon), name: s.shop || "", address: s.addr || "", scale: 16 });
    } else {
      wx.showToast({ title: "该店暂无坐标，用地图搜店名吧", icon: "none" });
    }
  },

  // ── AI 吃什么（云端强模型优先 · 离线兜底 · 零白屏） ──
  askFoodAI() {
    if (this.data.aiLoading) return;
    const self = this;
    const plan = app.globalData && app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程", icon: "none" }); return; }
    const d = this.data;
    const lines = [];
    lines.push("当前城市：" + (d.cityName || "未知") + "。");
    const foods = (d.foods || []).slice(0, 12).map(x => x.n).filter(Boolean);
    if (foods.length) lines.push("本地必吃清单（真实离线数据）：" + foods.join("、") + "。");
    const shops = (d.shops || []).slice(0, 8).map(x => x.shop).filter(Boolean);
    if (shops.length) lines.push("本地收录名店（真实离线数据）：" + shops.join("、") + "。");
    if (d.budgetTxt) lines.push(d.budgetTxt + "。");
    if (d.activeDish) lines.push("用户当前正在看这道菜：" + d.activeDish + "。");
    if (d.slotFilter && d.slotFilter !== "all") lines.push("当前筛选时段：" + ({ early: "早餐", main: "正餐", night: "夜宵" }[d.slotFilter] || d.slotFilter) + "。");
    const q = "结合本地上下文里的真实数据，给我这顿饭最实用的 3 条建议：点什么菜、去哪类店、怎么避开踩坑（各一句话）。不要编造具体店名、价格、地址或评分；本地清单里没有的就别提。";
    let ctx = "";
    try { ctx = Cloud.aiContextOf(plan, "美食页") + "\n" + lines.join("\n"); } catch (e) { ctx = lines.join("\n"); }
    self.setData({ aiLoading: true, aiErr: "" });
    if (typeof Cloud.cloudEnabled !== "function" || !Cloud.cloudEnabled()) { self._aiFoodOffline(plan); return; }
    AIAgent.ask("food", q, ctx)
      .then((r) => {
        if (r && r.ok && r.text) self.setData({ aiText: r.text, aiSource: r.source || "ai", aiLoading: false, aiErr: "" });
        else self._aiFoodOffline(plan);
      })
      .catch(() => { self._aiFoodOffline(plan); });
  },

  _aiFoodOffline(plan) {
    let r;
    try { r = T.askAssistant("吃什么", plan); } catch (e) { r = { text: "" }; }
    this.setData({ aiText: (r && r.text) || "离线模式：从上方必吃清单挑一道，再点菜名筛出做这道菜的名店。", aiSource: "", aiLoading: false, aiErr: "" });
  },

  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },
  aiClearChat() {
    try { AIAgent.clearHistory("food"); } catch (e) {}
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
}));
