const { getAppSafe, SafePage } = require("../../utils/app.js");
// food：必吃清单 + 地道名店（点击名店 → wx.openLocation 导航）
// 多站行程：顶部城市切换条，逐站看美食（默认定位到今天所在站）
// v1.20.x：必吃清单的每个菜名可点 —— 点「北京烤鸭」直接筛出做这道菜的店（utils/food-map.js）
const T = require("../../utils/travel.js");
const FM = require("../../utils/food-map.js");
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
    activeDish: "", dishNote: "", shopHead: "" },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  // v1.11：美食页依赖 FOOD_SPOTS 表，城市未收录时也要给出空态而不是崩掉
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } });
  },
  _renderShow() {
    try {
      this._theme();
      const plan = app.globalData && app.globalData.plan;
      // v1.17.10：省域行程的 plan 没有 cityName（只有 province），旧判断直接把美食页判成空态
      if (!plan || (!plan.cityName && !plan.isProv)) { this.setData({ hasPlan: false }); return; }
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
      try { this.setData({ hasPlan: false }); } catch (_) {}
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
        m: 0
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
  }
}));
