const { getAppSafe, SafePage } = require("../../utils/app.js");
// food：必吃清单 + 地道名店（点击名店 → wx.openLocation 导航）
// 多站行程：顶部城市切换条，逐站看美食（默认定位到今天所在站）
const T = require("../../utils/travel.js");
const app = getAppSafe();

Page(SafePage(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "到一个城市吃什么？必吃清单 + 地道名店一键导航", path: "/pages/index/index" };
  },

  data: {
    fz: 1, td: false, hasPlan: false, cityName: "", foods: [], note: "", shops: [], budgetTxt: "", segs: [], fIdx: 0, emptyShopTx: "", shopSrc: "",
    // v1.8.4 A3：按时段看吃什么（早 / 正餐 / 夜宵）
    slotFilter: "all", slots: [{ k: "all", t: "全部" }, { k: "early", t: "早餐" }, { k: "main", t: "正餐" }, { k: "night", t: "夜宵" }] },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  // v1.11：美食页依赖 FOOD_SPOTS 表，城市未收录时也要给出空态而不是崩掉
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() {
    this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
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
    this.setData({ fIdx: i });
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
        if (spots.length) shopSrc = "本城名店待补充，以下为就近「" + parent + "」收录的名店";
      }
    }
    // 预算贴合排序（与网页版同规则：经济→平价主推 / 舒适→平价+中档 / 高端→中档+高档）
    const sorted = T.budgetFoodFirst(spots, budgetKey, true);
    // v1.8.4 A3：给名店打时段标签 + 全量缓存，_apply 负责按槽过滤展示
    const allShops = sorted.map((s, i) => Object.assign({
      id: i,
      food: s.food, shop: s.shop, addr: s.addr, price: s.price,
      lat: s.lat, lon: s.lon,
      band: s.bandName || "", hit: !!s.hit,
      bandKey: s.bandName === '平价' ? 'low' : s.bandName === '中档' ? 'mid' : s.bandName === '高档' ? 'high' : ''
    }, { slot: T.mealSlotOf((s.food || "") + " " + (s.shop || "")) }));
    this._allShops = allShops;
    this._allFoods = (city && city.foods) || [];
    this.setData({
      cityName,
      note: (city && city.foodNote) || "",
      shopSrc,
      budgetTxt: allShops.length ? `已按「${T.budgetLabel(budgetKey)}」把贴合价位的店排在前面` : ""
    });
    this._apply();
  },

  // v1.8.4 A3：按时段过滤必吃与名店（关键词归类；未命中归正餐）
  // v1.9：必吃项加口味小标签（辣/甜/鲜/香/爽/经典）
  _apply() {
    const sf = this.data.slotFilter;
    let foods, shops;
    if (sf === "all") { foods = this._allFoods; shops = this._allShops; }
    else {
      foods = this._allFoods.filter(f => T.mealSlotOf(f) === sf);
      shops = this._allShops.filter(s => s.slot === sf);
    }
    const tagFoods = foods.map(n => ({ n, tag: T.tasteTagOf(n) }));
    // v1.12 UI 减法：名店空态文案预计算，避免 WXML 内三元拼接
    const emptyShopTx = sf !== "all" ? "该时段暂无已收录名店，看必吃清单或切「全部」" : this.data.cityName + " 暂无具体店铺数据，可参考必吃清单";
    this.setData({ foods: tagFoods, shops, foodN: tagFoods.length, shopN: shops.length, emptyShopTx });
  },

  onSlot(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.slotFilter) return;
    this.setData({ slotFilter: k });
    this._apply();
  },

  onShopNav(e) {
    const s = e.currentTarget.dataset;
    if (s.lat && s.lon) {
      wx.openLocation({ latitude: Number(s.lat), longitude: Number(s.lon), name: s.shop || "", address: s.addr || "", scale: 16 });
    } else {
      wx.showToast({ title: "该店暂无坐标，用地图搜店名吧", icon: "none" });
    }
  }
})));