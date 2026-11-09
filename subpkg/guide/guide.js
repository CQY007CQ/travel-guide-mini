const { SafePage } = require("../../utils/app.js");
// guide：使用指南 —— 「分组速查条」
// 演进：① 初版 4 tab / 14 卡 / 3886 字 → 用户反馈"字太多看不下去"；
//       ② 砍到 9 条一行式 → 覆盖不全（深度玩法/工具箱/体检/足迹都没提）；
//       ③ 本版：默认全部收起（首屏只是标题行，条数由 total 动态统计，不硬编码），但条目补足到覆盖功能地图，
//          说明给到 40-70 字 —— 用户只展开自己要看的那条，不多看一个字。
const T = require("../../utils/travel.js");

// k = 唯一键（展开态用它判断）；url = 可直达的页面
const GROUPS = [
  {
    g: "先看这三条",
    items: [
      { k: "a1", t: "生成一份行程", d: "「出发」页选目的地和天数，点生成即出逐日安排。目的地可单城、整省，或 2–4 城串联。", url: "/pages/index/index" },
      { k: "a2", t: "改到合心意", d: "「行程」页点任一行展开：换景点（可指定本城景点 / 从收藏里挑 / 随机）、上下调序、按住右侧手柄拖动、移到其他天、删掉。", url: "/pages/plan/plan" },
      { k: "a3", t: "出发前备什么", d: "「今天」页按离出发的天数给待办：订车票酒店 → 抢预约门票 → 收拾行李。", url: "/pages/today/today" },
    ],
  },
  {
    g: "在路上",
    items: [
      { k: "b1", t: "今天怎么走", d: "「今天」页是当天速览：时段安排、步行量、随手记账；行程结束后自动变成回顾页。", url: "/pages/today/today" },
      { k: "b2", t: "点景点直接导航", d: "绝大多数景点带真实坐标，点「导航」直接调起地图；没有精确坐标会退到城市锚点，不出现假点。" },
      { k: "b3", t: "吃什么", d: "「美食」页有必吃清单与地道名店。点某个菜名，会筛出做这道菜的店；也能按早餐/正餐/夜宵筛。", url: "/subpkg/food/food" },
      { k: "b4", t: "受伤或不舒服", d: "「更多」→ 旅途应急：先给 120，再说该挂什么科，并按距离列就近医院。只收录核验过的具名真实医院，未收录的城市自动降级为「地图搜附近医院」，绝不编造机构名。", url: "/pages/help/help" },
      { k: "b5", t: "花了多少钱", d: "「行程」页随手记账，「旅行账本」看分类统计与预算对比，支持 AA 分账、CSV 导出、出境汇率换算。", url: "/subpkg/ledger/ledger" },
      { k: "b6", t: "天气与离线", d: "天气已内置、免配置：出发日在未来 7 天内可看逐日预报；超出预报期会明确提示「出发日超出 7 天预报」。攻略、地图、清单本身完全离线。" },
      { k: "b7", t: "门票与预约", d: "「行前准备」按行程景点列出票价、是否需提前预约与官方入口；可勾选已订、定预约日、写放票备注，并按人数汇总门票预算。", url: "/subpkg/prep/prep" },
    ],
  },
  {
    g: "值得知道的功能",
    items: [
      { k: "c1", t: "没想好去哪", d: "「出发」页点「换个目的地」，一次随机给 3 座城市；挑中一座直接生成。", url: "/pages/index/index" },
      { k: "c2", t: "一句话找城市", d: "首页输入「人少的古镇 三天」这类描述，端上引擎按偏好打分给候选城市并附推荐理由；季节只做时令微调，不会把主题不符的城市顶上来。", url: "/pages/index/index" },
      { k: "c3", t: "行程体检", d: "一键检查：超出建议天数、该预约没订、周一闭馆、转场日没留白、预算偏紧 —— 可一键减负。", url: "/subpkg/toolkit/toolkit" },
      { k: "c4", t: "城市深度玩法", d: "热门城市有本地节奏、避坑清单、取景机位、顺手加一日（人工整理、离线可看）。行程目的地收录了才出现入口；未收录的城会在深度页列出已收录城市供切换。", url: "/subai/deep/deep" },
      { k: "c5", t: "工具箱", d: "旅行百宝箱、行程增强、随身问答都收在「更多」页，首页快捷入口也能直达。", url: "/pages/more/more" },
      { k: "c6", t: "旅行档案", d: "「更多」页有旅行档案：去过/打卡城市、成就徽章、足迹热力图（已结束的历史行程城市也会点亮，不只算打卡）。", url: "/pages/more/more" },
      { k: "c7", t: "打包清单", d: "按目的地与天数自动生成要带的物品，可逐项打勾，出门前照着收。", url: "/subpkg/prep/prep" },
      { k: "c8", t: "分享与存档", d: "「每日行程」页可生成攻略长图存相册或转发好友；也能把当前行程存进「我的攻略」，或从「更多」页导出备份。", url: "/pages/plan/plan" },
      { k: "c9", t: "数据在哪", d: "行程数据可在「更多」页导出备份或清空。", url: "/pages/more/more" },
      { k: "c10", t: "换景点与收藏", d: "换景点时弹出选择面板：本城可换景点、我的想玩/收藏（只列当天城市，避免跨城乱换）、随机换一个。", url: "/pages/plan/plan" },
      { k: "c11", t: "示例行程", d: "首页「看看示例行程」可一键载入成都 5 天的精排示例（会先把你现有行程存入存档槽，不覆盖），适合先看效果再自己生成。", url: "/pages/index/index" },
      { k: "c12", t: "离线数据规模", d: "「帮助」页底部可看随包知识库的真实体量：城市/景点/美食城/具名医院与气候、区域分布，全部离线、数字实时统计。", url: "/pages/help/help" },
    ],
  },
];

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "3 分钟学会用它生成专属旅行攻略", path: "/pages/index/index" };
  },

  data: {
    td: false,
    // 阅读字号三档（1 标准 / 2 大 / 3 特大），与其余页面共用全局设置
    fz: 1,
    open: "",          // 当前展开条目的 k；空串 = 全部收起
    groups: GROUPS,
    total: 0,
    ver: T.APP_VER || "",   // 版本号动态跟随 APP_VER，杜绝静态文案漂移
  },

  // v1.11：任何取值异常都不能拖垮整个指南页（静态文档页最不该白屏）
  onLoad() {
    this.__boot = T.ready().catch(() => null);
    // 字号只读全局 T.fontScale()。此前 onLoad 读页面私有键、_setFz 却写全局键，
    // 导致本页调完字号再进来会闪回旧档 —— 已收敛为单一真源。
    const total = GROUPS.reduce((s, g) => s + g.items.length, 0);
    try { this.setData({ fz: T.fontScale(), total }); }
    catch (e) { this.setData({ fz: 1, total }); }
  },

  _theme() {
    try { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); } catch (e) {}
  },
  onShow() { this.setData({ fz: T.fontScale() }); (this.__boot || Promise.resolve()).then(() => { try { this._theme(); } catch (e) {} }); },

  // 点标题展开/收起（单开：不会因为多点几下又变回长文档）
  onTopic(e) {
    const k = String(e.currentTarget.dataset.k || "");
    if (!k) return;
    this.setData({ open: this.data.open === k ? "" : k });
  },

  // 全局字号：与「更多」页共用同一份设置，改完所有页即时生效
  _setFz(v) {
    const fz = T.setFontScale(v);
    this.setData({ fz });
  },
  fzMinus() { this._setFz(this.data.fz - 1); },
  fzPlus() { this._setFz(this.data.fz + 1); },

  // 指南内直达入口：tab 页用 switchTab，子页 navigateTo（从 guide 返回仍回首页）
  // 导航失败给出可见提示；子页 navigateTo 栈满退回 redirectTo
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const isTab = ["/pages/plan/plan", "/pages/today/today", "/pages/more/more", "/pages/index/index"].indexOf(url) >= 0;
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
        fail: (err) => {
          wx.redirectTo({
            url,
            success: () => wx.hideLoading(),
            fail: () => { wx.hideLoading(); wx.showToast({ title: "打开失败：" + ((err && err.errMsg) || "未知错误"), icon: "none" }); }
          });
        }
      });
    }
  }
}));
