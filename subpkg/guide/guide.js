const { SafePage } = require("../../utils/app.js");
// guide：使用指南 —— 「分组速查条」
// 演进：① 初版 4 tab / 14 卡 / 3886 字 → 用户反馈"字太多看不下去"；
//       ② 砍到 9 条一行式 → 覆盖不全（深度玩法/工具箱/体检/足迹都没提）；
//       ③ 本版：默认全部收起（首屏只是标题行，条数由 total 动态统计，不硬编码），但条目补足到覆盖功能地图，
//          说明给到 40-70 字 —— 用户只展开自己要看的那条，不多看一个字。
const T = require("../../utils/travel.js");
// 离线数据规模：v1.20.6 从「旅途应急」页迁入（数据透明说明属「了解本 App」，不属急救场景）
const CP = require("../../utils/corpus.js");

// k = 唯一键（展开态用它判断）；url = 可直达的页面
const GROUPS = [
  {
    // 用户最关心的新能力置顶：AI 全场景问答 + 拍照识物（云端多模态）。
    // 能力描述严格属实：识物需联网、天气需 Key，不做「离线识别」等夸大承诺。
    g: "AI 助手 · 拍照识物（重点）",
    items: [
      { k: "x1", t: "AI 助手：像旅行搭子一样问", d: "首页胶囊「问问 AI 助手（含拍照识物）」、每页的 AI 入口，都能直接问：成都吃什么、第三天怎么排省力、这趟花了多少。它读得到你本机真实的行程、账本、打卡和当前城市，不会瞎编；复杂问题还会并列给一条独立审慎视角供你判断。云端强模型优先，断网时回落本地知识库并明确标注。", url: "/subpkg/assistant/assistant" },
      { k: "x2", t: "拍照识物（识图）", d: "在「AI 助手」页点「AI 识物 · 拍照识图」，拍植物 / 地标 / 招牌（或从相册选，最多 3 张多角度），云端多模态模型识别后给科普与真实地点对照。需联网；断网时本机不做图像识别，只列收录的真实地点供你自行对照，绝不编造名称。", url: "/subpkg/lens/lens" },
      { k: "x3", t: "一句话生成行程", d: "在 AI 助手里说「成都 3 天亲子穷游」这类描述，它直接拆出目的地、天数、偏好并生成行程，带你过去改。不想自己挑目的地时最好用。", url: "/subpkg/assistant/assistant" },
      { k: "x4", t: "从当前页问，答案更贴场景", d: "从哪个页点进 AI，它就带着那页的真实上下文（当前城市、当天行程、天气/美食/账本状态）作答，只在本机内存里短暂保存、不落盘。例如从「行程」页问「帮我体检」，它会就着真实安排提建议。", url: "/subpkg/assistant/assistant" },
    ],
  },
  {
    g: "先看这三条",
    items: [
      { k: "a1", t: "生成一份行程", d: "「出发」页选目的地和天数，点生成即出逐日安排。目的地可单城、整省，或 2–4 城串联。", url: "/pages/index/index" },
      { k: "a2", t: "改到合心意", d: "「行程」页点任一行展开：换景点（面板里可指定本城景点 / 我的想玩收藏 / 随机，只列当天城市避免跨城乱换）、上下调序、按住右侧手柄拖动、移到其他天、删掉。", url: "/pages/plan/plan" },
      { k: "a3", t: "出发前备什么", d: "「今天」页按离出发的天数给待办：订车票酒店 → 抢预约门票 → 收拾行李。", url: "/pages/today/today" },
    ],
  },
  {
    g: "在路上",
    items: [
      { k: "b1", t: "今天怎么走", d: "「今天」页是当天速览：时段安排、步行量、随手记账；行程结束后自动变成回顾页。", url: "/pages/today/today" },
      { k: "b2", t: "点景点直接导航", d: "绝大多数景点带真实坐标，点「导航」直接调起地图；只精确到城市级的点标「≈」，退到城心当锚点，不出现假点。" },
      { k: "b3", t: "吃什么", d: "「美食」页有必吃清单与地道名店。点某个菜名，会筛出做这道菜的店；也能按早餐/正餐/夜宵筛。", url: "/subpkg/food/food" },
      { k: "b4", t: "受伤或不舒服", d: "「更多」→ 旅途应急：先给 120，再说该挂什么科，并按距离列就近医院。只收录核验过的具名真实医院，未收录的城市自动降级为「地图搜附近医院」，绝不编造机构名。", url: "/pages/help/help" },
      { k: "b5", t: "花了多少钱", d: "「行程」页随手记账，「旅行账本」看分类统计与预算对比，支持 AA 分账、CSV 导出、出境汇率换算。", url: "/subpkg/ledger/ledger" },
      // v1.20.35：v1.20.33 起和风改成「Key + 专属 API Host」两件套，旧文案只说填 Key —— 按旧说法配完调不通，
      //           用户会以为功能坏了。这是「配置指引必须与实现同步」的硬要求，不是文案润色。
      { k: "b6", t: "天气与离线", d: "天气要两件套：和风 Key + 控制台「设置 → API Host」里的专属域名。在「更多 → 合规与密钥」分两步填入（存本机），再把该域名加进微信公众平台「服务器域名」的 request 合法域名，才会联网取逐日预报。不填则天气卡不显示，其余功能照常，攻略 / 地图 / 清单本身完全离线。" },
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
      { k: "c5", t: "工具箱", d: "旅行百宝箱、行程增强、AI 助手 · 拍照识物都收在「更多」页，首页快捷入口也能直达。", url: "/pages/more/more" },
      { k: "c6", t: "旅行档案", d: "「更多」页有旅行档案：去过/打卡城市、成就徽章、足迹热力图（已结束的历史行程城市也会点亮，不只算打卡）。", url: "/pages/more/more" },
      { k: "c7", t: "打包清单", d: "按目的地与天数自动生成要带的物品，可逐项打勾，出门前照着收。", url: "/subpkg/prep/prep" },
      { k: "c8", t: "分享与存档", d: "「每日行程」页可生成攻略长图存相册或转发好友；也能把当前行程存进「我的攻略」，或从「更多」页导出备份。", url: "/pages/plan/plan" },
      { k: "c9", t: "数据在哪", d: "行程、账本、想玩、手记、偏好全部存在本机 storage，没有账号、不上传。可在「更多」页备份到剪贴板 / 从剪贴板恢复，或清空全部本地数据；卸载小程序即删除。", url: "/pages/more/more" },
      { k: "c11", t: "示例行程", d: "首页「看看示例行程」可一键载入成都 5 天的精排示例（会先把你现有行程存入存档槽，不覆盖），适合先看效果再自己生成。", url: "/pages/index/index" },
      { k: "c12", t: "离线数据规模", d: "本页底部「关于数据」可看随包知识库的真实体量：城市/景点/美食城/具名医院与气候、区域分布，全部离线、数字实时统计。" },
    ],
  },
  {
    // v1.20.35 新增组：把「容易被误解的地方」集中摆出来。
    // 用户最容易产生的四个误判——缩略图是照片、数据是实时的、什么都能在这里办完、AI 一定对——
    // 都是「不说破就等于默许」。每条都只写本产品真实边界，不做免责式套话堆砌。
    g: "注意事项与边界",
    items: [
      { k: "d1", t: "景点旁的方图不是照片", d: "那是按景点类型生成的图形标识（山 / 湖 / 古镇 / 塔 / 温泉 / 城墙…），配色跟类别走，全站零外链、断网也在。语料里纯行政命名的景点（如「XX 生态旅游景区」）不猜类别，统一用定位标记兜底。" },
      { k: "d2", t: "数据是离线快照", d: "随包数据整理更新至 " + ((T.dataCutoffTx && T.dataCutoffTx()) || "最近一次采集") + "，不随时间自动更新；门票、开放时间、班次与人流以官方当日公示为准，本 App 不做实时抓取。" },
      { k: "d3", t: "这里办不了的事", d: "没有支付、下单、预订与订单状态，价格只是参考文本，点酒店/门票只给搜索词或官方入口；没有实时客流数据，只给时段经验提示。行程与推荐是通用建议，不替代官方安全与交通提示。" },
      { k: "d4", t: "AI 会出错", d: "AI 问答优先走云端强模型、断网回落本地规则库，复杂问题另给一条独立审慎视角，但仍可能出错；拍照识物需联网且有多条判断不一致的情况，涉及食用/药用/有毒物种请以专业鉴定为准。同一问题重复问会复用上次答案以更快出结果。" },
      { k: "d5", t: "会用到哪些系统能力", d: "只在导航、拍照识物、天气与 AI 请求时调用地图 / 相机 / 相册 / 网络，请求只带城市与坐标，不带身份信息；没有账号体系，不收集手机号与位置轨迹，云端未配置时相关能力整体关闭。" },
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
    corpus: null,
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
  onShow() {
    this.setData({ fz: T.fontScale() });
    (this.__boot || Promise.resolve()).then(() => {
      try { this._theme(); } catch (e) {}
      try { this.setData({ corpus: CP.corpusStats() }); } catch (e) {}
    });
  },

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
