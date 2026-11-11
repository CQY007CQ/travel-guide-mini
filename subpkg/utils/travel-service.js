// subpkg/utils/travel-service.js —— 旅客服务能力层（分包内，不占主包；纯离线、零网络、零新增依赖）
//
// 边界（重要）：
//   · 本模块不提供「实时订单状态 / 支付」：个人主体小程序无支付与交易权限，本 App 也从未接入订单系统。
//   · 不提供「实时景点拥挤度」：无合规客流数据源，绝不伪造；只给基于时段/类别的经验提示并明确标注。
//   · 汇率为用户可编辑的参考值，非实时、不参与记账（记账仍只记人民币，见 subpkg/ledger）。

/* ── ① 隐私与合规（审核可直接引用） ── */
const PRIVACY_SECTIONS = [
  {
    t: "数据存在哪",
    b: "行程、账本、想玩清单、待办、手记、偏好与设置全部存在你本机的小程序 storage 中。没有账号体系、不收集手机号、不要求注册登录。"
  },
  {
    t: "会不会上传",
    b: "默认完全离线，不上传任何数据。云同步是可选增强项：只有你主动配置云环境 ID 并点击「上传行程」后才会写入你自己的云开发环境；未开启时所有云能力自动关闭（fail-closed）。"
  },
  {
    t: "第三方服务",
    b: "天气（和风）与地图展示仅在已配置本人账号密钥时按需请求；请求只带城市/坐标，不带身份信息。AI 问答经云函数代理，密钥只存在云函数环境变量，前端不含任何密钥。"
  },
  {
    t: "支付与交易",
    b: "本 App 不含支付、下单、预订、交易功能，不收集银行卡或支付信息。价格均为「参考价」文本，点击酒店/门票只提供搜索词或跳转，不在 App 内成交。"
  },
  {
    t: "权限分级",
    b: "本地数据仅本小程序可读写。云同步按 uid 隔离：配对同步码 / 匿名标识 / openid 三选一作为归属键，未配对的用户之间数据互不可见。云端集合建议设为「仅创建者可读写」。"
  },
  {
    t: "你的权利",
    b: "可随时在「更多 → 数据与隐私」清空全部本地数据，或用「备份到剪贴板」导出后自行保存。卸载小程序即删除本机数据。"
  }
];

/* ── ② 离线能力清单（如实描述，不夸大） ── */
const OFFLINE_ITEMS = [
  { t: "离线行程", d: "攻略生成、每日行程、调整顺序、换景点全部本地计算，无需联网", mode: "offline" },
  { t: "离线账本", d: "记账、AA 分摊、预算对比全部存本机", mode: "offline" },
  { t: "离线百科 / 速查", d: "景点资料、城市名片、美食清单、应急分诊随包下发", mode: "offline" },
  { t: "离线路线坐标", d: "景点坐标与当天连线随包固化，可离线查看点位与顺序", mode: "offline" },
  { t: "地图瓦片", d: "底图瓦片由微信地图组件在线加载；断网时点位与连线仍在，但底图可能空白", mode: "online" },
  { t: "天气 / AI 问答", d: "需联网；断网自动回落本地规则库与既有缓存，不白屏", mode: "online" },
  { t: "订单 / 支付", d: "本 App 无订单与支付系统（个人主体合规边界）", mode: "na" }
];

/* ── ③ 动态提醒：相邻两天预报变化（纯计算，零网络） ── */
function weatherDelta(a, b) {
  const out = [];
  if (!a || !b) return out;
  const d = (x, y) => (typeof x === "number" && typeof y === "number") ? y - x : null;
  const hi = d(a.tmax, b.tmax), lo = d(a.tmin, b.tmin);
  if (hi !== null && hi <= -5) out.push({ k: "cool", t: "明天降温 " + Math.abs(hi) + "℃，记得加件外套" });
  else if (hi !== null && hi >= 5) out.push({ k: "warm", t: "明天升温 " + hi + "℃，注意减衣防晒" });
  if (lo !== null && lo <= -5) out.push({ k: "cool", t: "明晨最低温再降 " + Math.abs(lo) + "℃，早起看日出多穿点" });
  const rainy = x => !!(x && (x.isRain || x.isSnow || x.isThunder || (typeof x.code === "number" && x.code >= 51)));
  if (!rainy(a) && rainy(b)) {
    const kind = b.isSnow ? "有雪" : b.isThunder ? "雷雨" : "有雨";
    out.push({ k: "rain", t: "明天转" + kind + "，带伞 / 把室内景点排前面" });
  } else if (rainy(a) && !rainy(b)) {
    out.push({ k: "sun", t: "明天转晴，适合户外与拍照" });
  }
  if (b && typeof b.tmax === "number" && b.tmax >= 34) out.push({ k: "hot", t: "明天高温 " + b.tmax + "℃，避开正午户外" });
  if (b && typeof b.wind === "number" && b.wind >= 40) out.push({ k: "wind", t: "明天大风，注意缆车/轮渡班次" });
  return out.slice(0, 4);
}

// 时段 × 类别经验提示：明确「非实时客流」，不伪装成实时拥挤度
const CROWD_HINTS = [
  { p: "清晨", t: "多数景区刚开门、团队客未到，古镇/山景/机位通常最松；热门博物馆需看预约时段。", tag: "经验" },
  { p: "上午", t: "亲子与团队客集中，室内展馆、主题乐园排队开始变长；可先走户外线。", tag: "经验" },
  { p: "午后", t: "一天中人流与日晒的高峰，建议安排室内/午休/长距离转场。", tag: "经验" },
  { p: "傍晚", t: "日落机位与夜市人多，但排队型景点通常回落；适合散步与拍夜景。", tag: "经验" },
  { p: "夜间", t: "夜游/演出散场时段交通最挤，提前约车或预留步行时间。", tag: "经验" }
];
const CROWD_DISCLAIMER = "以上为离线经验提示，不是实时客流数据；本 App 无合规客流数据源，不提供实时拥挤度。";

/* ── ④ 多币种参考换算（用户可改汇率，非实时，不参与记账） ── */
const DEFAULT_RATES = {
  CNY: 1, USD: 0.14, EUR: 0.13, JPY: 20.5,
  HKD: 1.09, TWD: 4.5, KRW: 195, GBP: 0.11, THB: 5.0, SGD: 0.19
};
const CUR_NAMES = {
  CNY: "人民币", USD: "美元", EUR: "欧元", JPY: "日元", HKD: "港元（中国香港）",
  TWD: "新台币（中国台湾）", KRW: "韩元", GBP: "英镑", THB: "泰铢", SGD: "新加坡元"
};
// rates[cur] = 1 CNY 可兑换多少该币种；换算：amount CNY → amount * rates[to]
function convert(cny, to, rates) {
  const r = (rates || DEFAULT_RATES)[to];
  const n = parseFloat(cny);
  if (!isFinite(n) || !isFinite(r)) return "";
  const v = n * r;
  return (Math.round(v * 100) / 100).toFixed(2);
}

/* ── ⑤ 多语言（关键短语，中英；全站文案逐步覆盖） ── */
const I18N = {
  zh: {
    title: "旅客服务中心", sub: "离线优先 · 零支付 · 数据只在你本机",
    s1: "AI 行程助手", s2: "动态提醒", s3: "离线能力", s4: "境外旅客", s5: "安全与合规",
    aiNote: "首页已上线：说一句话即可解析预算 / 天数 / 兴趣，行程由本地离线库真实生成。",
    goIndex: "去生成攻略", wxTitle: "天气变化提醒", crowdTitle: "景点时段经验", crowdNote: CROWD_DISCLAIMER,
    noOrder: "订单状态提醒：本 App 无订单 / 支付系统（个人主体合规边界），不提供此类提醒。",
    offlineTitle: "本地数据", backup: "导出备份", backupTip: "在「更多」页可备份到剪贴板 / 从剪贴板恢复",
    lang: "语言", currency: "参考换算", rateTip: "离线参考汇率，非实时；汇率可自行修改。仅供参考，不参与记账。",
    privacy: "隐私协议", clear: "清空本地数据", clearTip: "在「更多 → 数据与隐私」执行，不可恢复",
    amount: "金额（¥）", target: "换算为", result: "参考金额",
    phrase: "常用短语（中 / 英）", offlineBadge: "离线可用", onlineBadge: "需联网", naBadge: "不适用"
  },
  en: {
    title: "Traveller Services", sub: "Offline-first · No payments · Data stays on your device",
    s1: "AI Trip Planner", s2: "Live-ish Alerts", s3: "Offline Capabilities", s4: "International Visitors", s5: "Privacy & Compliance",
    aiNote: "Available on the home page: describe your budget, days and interests in one sentence; the itinerary is generated from the built-in offline dataset.",
    goIndex: "Plan a trip", wxTitle: "Weather change", crowdTitle: "Timing hints", crowdNote: "Offline experience-based hints, NOT live crowd data. No live crowding data is available.",
    noOrder: "Order-status alerts: this app has no order or payment system and does not offer such alerts.",
    offlineTitle: "Local data", backup: "Export backup", backupTip: "Use More → Backup to clipboard / Restore from clipboard",
    lang: "Language", currency: "Reference conversion", rateTip: "Offline reference rates, not live. Editable. For reference only; never used in the ledger.",
    privacy: "Privacy policy", clear: "Clear local data", clearTip: "Run from More → Data & Privacy. Cannot be undone.",
    amount: "Amount (CNY)", target: "Convert to", result: "Reference amount",
    phrase: "Useful phrases (ZH / EN)", offlineBadge: "Offline", onlineBadge: "Online", naBadge: "N/A"
  }
};
const PHRASES = [
  { zh: "请问地铁站在哪里？", en: "Where is the nearest metro station?" },
  { zh: "这个能吃辣吗？", en: "Is this dish spicy?" },
  { zh: "我对花生过敏。", en: "I am allergic to peanuts." },
  { zh: "请帮我叫救护车。", en: "Please call an ambulance." },
  { zh: "可以刷卡吗？", en: "Do you accept cards?" },
  { zh: "票价以官方当日公告为准。", en: "Ticket prices are subject to the official notice on the day." }
];
function t(key, lang) { return (I18N[lang] || I18N.zh)[key] || I18N.zh[key] || key; }

module.exports = {
  PRIVACY_SECTIONS, OFFLINE_ITEMS, CROWD_HINTS, CROWD_DISCLAIMER,
  DEFAULT_RATES, CUR_NAMES, PHRASES, I18N,
  weatherDelta, convert, t
};
