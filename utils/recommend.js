/* 个性推荐引擎（utils/recommend.js）
 *
 * ── 为什么单独一个文件，而不是写进 travel.js ──
 * travel.js / planner.js 是构建期压缩产物（单行 minified），手改会被下次构建覆盖，
 * 也无法维护。故这里做成「独立模块 + 只依赖既有导出」：
 *   · 复用 T.bestMonths（季节判定，与行程生成同一套解析）
 *   · 复用 T.valueScoreOf（性价比）
 *   · 复用 T.findCity / T.D.CITIES（城市语料）
 * 不复制任何业务规则 —— 同一条规则全项目只有一处实现（避免"改一处忘另两处"的回归债）。
 *
 * ── 它到底做了什么（答辩口径）──
 * 这是一个**基于内容的推荐（content-based recommendation）**：
 *   1) 自然语言需求 → 兴趣标签：先用 18 类词典做主匹配，再并入「按标签找景点」共享的 50 维词库
 *      （utils/spot-tags.js，含 autumn/免费/海岛/森林/峡谷…18 类覆盖不到的意图），纯前端匹配、无网络
 *   2) 每座城市在真实语料（景点名/点评/区域/美食）上做标签命中计数；
 *      对 50 维词库特有的意图（如 秋天/红叶/免费/海岛），改用「真实景点标签命中数」计分 ——
 *      比语料正则更准（正则会把"黄山"这类字面含"海"的误伤，景点标签不会）
 *   3) 加权线性打分：相关性（绝对量 + 密度 双因子）＋ 季节 ＋ 成熟度先验 ＋ 预算 ＋ 性价比 ＋ 天数
 *   4) 输出 Top-N，每条附**可解释理由**（命中哪类、命中几处、密度多少、举例景点）
 * 没有随机数、没有云端、没有生成式模型 —— 同一输入永远同一输出，可单测、可复现、可逐条解释。
 *
 * ── 为什么相关性要「绝对量 + 密度」双因子（实测踩过的坑）──
 *   · 只看绝对量：「博物馆」会把 西安(41)/北京(40)/广州(38) 顶上来 —— 对；
 *     但「古镇」会把 重庆(38) 顶上来，压过真正"整城就是古镇"的 平遥(11) —— 错。
 *   · 只看密度：「古镇」给出 平遥/凤凰 —— 对；
 *     但「博物馆」会推出 太原/朝阳（城里恰好有几座馆，占比高）—— 错。
 *   故两者加权：绝对量保证"大而全"的城市不吃亏，密度保证"小而专"的城市能冒头。
 *
 * ── 权重为什么要单独抽成 W ──
 * 手调权重是本引擎唯一的"主观部分"。把它显式写成一张表、并在单测里锁定黄金用例，
 * 才能保证：① 答辩时能逐项解释；② 以后调权重不会悄悄改变既有行为。
 */

const T = require("./travel.js");
const D = T.D;
// 复用「按标签找景点」的 50 维共享词库（utils/spot-tags.js）：让「智能推荐」与「标签检索」同源，
// 既扩展意图识别（雪山/红叶/免费/海岛/森林…），又把城市相关性建立在「真实景点标签」上（比语料正则更准）。
const ST = require("./spot-tags.js");

/* 18 类主词典与 50 维词库的「同义键」：同一意图被两套词典各自表达（snowmt↔snowmtn 高原雪山、
 * grass↔grassland 草原）。若同时出现在 prefs.tags，必须只让 18 类主路径计分（黄金用例契约所在），
 * ST 补充路径跳过该键 —— 否则"雪山"会被 snowmt(语料正则) 与 snowmtn(真实景点标签) 重复加权，
 * 凭空把高原雪山类城市抬得过高。其余同名键（oldtown/sea/lake…）本来就只在主路径计分，不受影响。 */
const ST_SYNONYM_OF = { snowmtn: "snowmt", grassland: "grass" };

/* ── 权重表（唯一的主观参数，全部可解释、可调）── */
const W = {
  base: 14,          // 基分：保证每城非零起点，排序稳定
  relevanceMax: 44,  // 相关性满分（主导项，须显著大于其他项之和）
  relevanceNorm: 14, // 相关性归一化分母：sum(w*combo) 达到 14 视为满分相关
  absW: 0.40,        // 绝对命中量权重
  densW: 0.60,       // 密度权重（略高于绝对量：让"整城就是古镇"的小城能冒头）
  absCap: 40,        // 绝对量上限
  absPow: 0.6,       // 绝对量幂次：>0 且 <1。曾用 log，压缩过狠导致
                     // 北京/西安与黄山/漳州的绝对差距被抹平 → 排序由性价比决定；
                     // 幂函数保留更多差距，又不会让超大城垄断。
  coreFloor: 0.30,   // 密度为 0 时的"核心度"下限
  coreSpan: 0.70,    // 核心度增量
  coreSat: 0.60,     // 密度达到 0.60 即视为"核心"（饱和）
  hitBonus: 2,       // 命中 ≥4 处的"含量高"奖励
  hitBonusAt: 4,
  promMax: 6,        // 成熟度先验上限（刻意远低于相关性）
  // 季节只做「同主题城市之间的时令微调」，绝不能压过主题命中差距。
  // v1.19.201：原 +12/-5（摆幅 17）大于强弱命中的相关性差，导致 11 月
  //「沙漠戈壁 摄影 四天」把南昌/张家口推上榜首、敦煌掉到第 7（现场演示风险）。
  seasonHit: 6,         // 正值最佳季节（有主题诉求时还会按命中强度缩放）
  seasonMiss: -2,       // 非最佳季节
  seasonAllYear: 3,     // 四季皆宜
  // 无意图（"随便逛逛"）时季节本就是主排序信号之一，保留原幅度，
  // 否则 Top5 会因通用分过于集中而全部取整成同一个分数（11 月实测全 41 分）。
  seasonHitIdle: 12,
  seasonMissIdle: -5,
  seasonAllYearIdle: 6,
  noHitPenalty: -12,    // 有主题诉求但零命中 → 不得靠成熟度/热度挤进 Top
  weakHitDensity: 0.03, // 核心标签命中密度低于此值 → 疑似字面误命中
  weakHitCombo: 0.30,   // 且 combo 低于此值（双门槛，避免误伤小而精目的地）
  weakHitPenalty: -8,   // 「仅零星提及」降权
  budgetMatch: 7,
  budgetNear: 2,
  budgetMiss: -7,
  valueDiv: 12,      // 性价比映射除数 (val-60)/div（只作微调，约 -3..+3）
  daysThin: -5,      // 景点偏少
  daysRich: -2,      // 景点太多需取舍
  quietSmall: 5,     // 人少小众：景点数少 → 加分
  quietBig: -3,      // 人少小众：景点数多 → 减分
  limited: -25,      // 数据覆盖有限
  missWeight: -10,   // 每个"必需标签"未命中的扣分
  missTagMin: 6,     // 权重 ≥ 该值的标签视为"必需"（用户明确要的核心诉求）
  heatMax: 16,        // 综合热度先验上限（让无意图时也能给出有区分度的"热门目的地"排序）
  provinceBoost: 10,  // 显式点名省份 → 该省城市加权（"浙江的古镇"优先浙江）
  extremeBoost: 8,    // "最…"类诉求 → 强化已命中标签维度
  // 50 维共享词库（spot-tags.js）特有的意图（autumn/免费/海岛/森林…）用"真实景点标签命中数"计分。
  // 它是 18 类主相关性的「补充信号」：上限刻意低于相关性满分(44)，不喧宾夺主；
  // 但当一条 query 的意图只能被 50 维词库表达（如"秋天 红叶"）时，它就成为相关性主驱动力。
  relevanceSTNorm: 12, // 50 维补充相关性归一化分母：sum 达到 12 视为满分
  relevanceSTMax: 14,  // 50 维补充相关性满分
};

/* ── 兴趣标签词典 ──
 * words：用户可能说出的词（解析需求用）
 * re   ：在城市真实语料里命中的正则（打标签用）。刻意写"具体"，
 *        避免「林海 / 花海 / 海洋世界」这类字面含"海"却与海滨无关的假阳性；
 *        也避免「艺术」这类过于宽泛、会把大量普通景点算进"博物馆"的词。
 * w    ：命中权重（经验值，可调） */
const TAGS = [
  { key: "oldtown",   label: "古镇古城",   w: 8, words: ["古镇", "古城", "老街", "水乡", "古街", "老城", "古建", "古村镇", "老城厢", "古县城", "千年古镇"], re: /古镇|古城|古街|老街|水乡|古城墙|古建筑|古村落|西栅|东栅/g },
  { key: "nature",    label: "山水自然",   w: 6, words: ["山水", "自然", "风景", "爬山", "登山", "徒步", "峡谷", "瀑布", "森林", "湿地"], re: /山|峰|峡谷|瀑布|森林|湿地|溪|溶洞/g },
  { key: "sea",       label: "海滨海岛",   w: 8, words: ["海", "海边", "海岛", "沙滩", "看海", "赶海"], re: /海滨|海边|海滩|沙滩|海岛|岛屿|海岸|滨海|赶海|看海|浴场|岛|湾/g },
  { key: "lake",      label: "江湖游船",   w: 5, words: ["湖", "江", "游船", "漂流", "泛舟"], re: /湖|江|游船|漂流|泛舟|竹筏/g },
  { key: "snowmt",    label: "高原雪山",   w: 6, words: ["高原", "雪山", "冰川", "高海拔"], re: /雪山|冰川|高原|雪峰|冰川湖/g },
  { key: "grass",     label: "草原牧场",   w: 8, words: ["草原", "牧场", "骑马"], re: /草原|牧场|草甸|骑马|那拉提|草原天路/g },
  { key: "desert",    label: "沙漠戈壁",   w: 9, words: ["沙漠", "戈壁", "荒漠", "沙丘"], re: /沙漠|戈壁|荒漠|沙丘|鸣沙|雅丹|沙山/g },
  { key: "hotspring", label: "温泉泡汤",   w: 9, words: ["温泉", "泡汤", "汤泉"], re: /温泉/g },
  { key: "ski",       label: "滑雪冰雪",   w: 9, words: ["滑雪", "冰雪", "看雪", "雪场"], re: /滑雪|冰雪|雪场|冰雕|雪乡|亚布力/g },
  { key: "food",      label: "美食小吃",   w: 5, words: ["美食", "吃", "小吃", "吃货", "觅食", "火锅", "烧烤", "串串", "串", "面", "粉", "小吃街", "苍蝇馆子", "地道", "老字号", "早点", "夜宵", "特色菜", "苍蝇馆"], re: null, foodsMin: 5 },
  { key: "history",   label: "历史人文",   w: 6, words: ["历史", "文化", "古迹", "人文", "古都", "遗址", "古建", "古建筑", "木构", "木结构", "唐代", "宋代", "明代", "明清", "宫殿", "皇家", "帝王陵", "地上古建筑", "斗拱", "榫卯", "古塔", "古寺", "古城墙", "古建筑群"], re: /博物|遗址|寺|塔|纪念|故居|石窟|陵|庙|城墙|古建|碑/g },
  { key: "museum",    label: "博物馆艺术", w: 8, words: ["博物馆", "展览", "艺术", "美术馆", "看展", "文艺"], re: /博物|美术馆|展览馆|画廊|故宫/g },
  { key: "family",    label: "亲子带娃",   w: 8, words: ["亲子", "带娃", "孩子", "小朋友", "儿童"], re: /乐园|动物园|海洋馆|海洋世界|科技馆|亲子|水族|欢乐谷|游乐园/g },
  { key: "night",     label: "夜生活",     w: 6, words: ["夜", "夜市", "夜景", "酒吧", "夜游"], re: /夜市|夜景|夜游|酒吧|灯光秀/g },
  { key: "photo",     label: "摄影出片",   w: 5, words: ["拍照", "出片", "摄影", "网红", "打卡", "花", "赏花", "花海", "樱花", "油菜花", "桃花", "花市", "花卉", "拍花"], re: /观景|全景|日落|日出|夜景|风光|花海|观景台/g },
  { key: "folk",      label: "民俗风情",   w: 6, words: ["民俗", "少数民族", "红色", "风情"], re: /民俗|民族|红色|革命|纪念|非遗/g },
  { key: "slow",      label: "休闲慢游",   w: 4, words: ["慢", "休闲", "躺平", "度假", "放松"], re: /度假|休闲|温泉|海滨|康养/g },
  { key: "quiet",     label: "人少小众",   w: 5, words: ["人少", "小众", "冷门", "不挤", "安静"], re: null, special: "quiet" },
];

const BUDGET_WORDS = {
  low: ["穷游", "省钱", "便宜", "低价", "学生", "经济", "低预算", "预算有限", "不贵", "省一点", "省点", "省些", "节约", "实惠"],
  mid: ["舒适", "中档", "适中", "中等预算", "正常预算"],
  high: ["高端", "奢华", "豪华", "不差钱", "高预算", "精品"],
};
const PACE_WORDS = {
  leisure: ["轻松", "慢", "躺平", "休闲", "放松", "不赶"],
  speed: ["特种兵", "紧凑", "赶", "暴走", "多玩", "效率"],
};
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
// 中文月份映射（含 11/12，避免"十一月"被拆成"十"→10）
const CN_MONTH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

/* 从自然语言解析出行月份（"3月"/"3月份"/"三月"/"十一月"）。
 * 仅当文本显式提到月份才返回，否则 0（交由后续回退当前月）；
 * 带"个"的"一个月"等时长表述不会误中（正则要求数字/汉字紧邻"月"，"1个月"的"个"会打断匹配）。 */
function parseMonthFromText(s) {
  const num = s.match(/(\d{1,2})\s*月/);
  if (num) { const m = parseInt(num[1], 10); if (m >= 1 && m <= 12) return m; }
  const cn = s.match(/([一二三四五六七八九十]+)\s*月/);
  if (cn) { const m = CN_MONTH[cn[1]]; if (m) return m; }
  return 0;
}

/* 否定前缀识别（仅作用于预算/节奏这种直接翻转打分权重的软意图）：
 * 关键词紧邻前 1–2 字构成否定时，视为「用户未表达该意图」。
 * 真实 bug：「别特种兵」当前会被 indexOf("特种兵") 命中 → pace=speed（恰好相反）；
 * 「不便宜 / 别豪华 / 不要省钱」也会误判为对应偏好。这里纠正。
 * 说明：仅覆盖最常见的紧邻否定（1–2 字）；"不喜欢便宜"等否定词离关键词更远的情况暂不处理，
 * 属已知残余边界，留待后续（避免过度扩大改动面）。quiet 标签的「不挤」是正向"人少"信号，不在这里否定。 */
const NEG_PREFIX = ["不", "别", "勿", "莫", "不想", "不愿", "不要", "别去", "千万别"];
function hasIntentWord(s, w) {
  let i = s.indexOf(w);
  while (i >= 0) {
    const prev1 = i >= 1 ? s.charAt(i - 1) : "";
    const prev2 = i >= 2 ? s.slice(i - 2, i) : "";
    let neg = false;
    for (let k = 0; k < NEG_PREFIX.length; k++) {
      const n = NEG_PREFIX[k];
      if (n.length === 1 ? prev1 === n : prev2 === n) { neg = true; break; }
    }
    if (!neg) return true; // 首个非否定命中即视作有效意图
    i = s.indexOf(w, i + w.length); // 否则跳到下一处（处理"不要便宜但省钱"之类的极端输入）
  }
  return false;
}

/* ── 语料缓存：每座城市只拼一次 ── */
const _corpusCache = new Map();
function corpusOf(city) {
  const key = (city && city.id) || (city && city.name) || "";
  if (_corpusCache.has(key)) return _corpusCache.get(key);
  const parts = [city.name || ""];
  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  for (let i = 0; i < exps.length; i++) parts.push((exps[i] && exps[i].name) || "", (exps[i] && exps[i].note) || "");
  const areas = Array.isArray(city.areas) ? city.areas : [];
  for (let i = 0; i < areas.length; i++) parts.push((areas[i] && areas[i].name) || "", (areas[i] && areas[i].note) || "");
  if (Array.isArray(city.foods)) parts.push(city.foods.join(" "));
  parts.push(city.foodNote || "", city.stayTip || "");
  const s = parts.join(" ");
  _corpusCache.set(key, s);
  return s;
}

/* ── 城市真实景点标签聚合（复用 50 维共享词库 utils/spot-tags.js）──
 * 比 corpusOf + 正则更准：corpusOf 是在"整城拼起来的大字符串"上跑正则，会把字面含"海"的
 * 黄山/海藻/上海路之类误伤成海滨；而这里对每座城市的「每一个真实景点」单独跑 ST.tagSpot，
 * 统计每个标签被多少个真实景点携带。返回 map: tagKey -> { count, examples:[景点名] }。
 * 仅当 query 含 50 维词库特有意图时才被调用（scoreCity 里按需触发），平时零开销。 */
const _spotTagCache = new Map();
function citySpotTags(city) {
  const key = (city && city.id) || (city && city.name) || "";
  if (_spotTagCache.has(key)) return _spotTagCache.get(key);
  const out = {};
  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  for (let i = 0; i < exps.length; i++) {
    const keys = ST.tagSpot(exps[i], city);
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      if (!out[k]) out[k] = { count: 0, examples: [] };
      out[k].count++;
      if (out[k].examples.length < 2 && exps[i] && exps[i].name) out[k].examples.push(exps[i].name);
    }
  }
  _spotTagCache.set(key, out);
  return out;
}

/* ── 游玩成熟度：用真实评级（D.SPOT_INFO）作质量先验 ──
 * 权重上限只有 10 分：评级覆盖率不均（403/751 城），
 * 它是"微调次序"的先验，不是"决定胜负"的主项。 */
const _qualityCache = new Map();
function qualityOf(city) {
  const key = (city && city.id) || (city && city.name) || "";
  if (_qualityCache.has(key)) return _qualityCache.get(key);
  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  const info = D.SPOT_INFO || {};
  let rated = 0, sum = 0;
  for (let i = 0; i < exps.length; i++) {
    const nm = exps[i] && exps[i].name;
    const it = nm ? info[nm] : null;
    if (it && it.rating) { const v = parseFloat(it.rating); if (isFinite(v)) { rated++; sum += v; } }
  }
  const avg = rated ? sum / rated : 0;
  const exp = exps.length;
  const prom = Math.max(0, Math.min(1,
    0.45 * Math.min(1, rated / 10) +
    0.30 * Math.min(1, exp / 100) +
    0.25 * Math.max(0, Math.min(1, (avg - 4.0) / 1.0))
  ));
  const q = { rated: rated, avg: avg, exp: exp, prom: prom };
  _qualityCache.set(key, q);
  return q;
}

/* ── 综合热度：用真实语料做"知名度/成熟度"代理（无外部流量数据，纯离线派生）──
 * 维度：景点规模(对数压缩防超大城垄断) 0.40 + 评级覆盖 0.25 + 均分 0.20 + 性价比 0.15。
 * 用途：① 无明确意图时给出有区分度的"热门目的地"排序（不再全城同分）；
 *       ② 有意图时作为轻微先验破平。与质量先验(q.prom)解耦——prom 只作微调次序，
 *       heat 才主导"这座城整体值不值得去"的宏观排序。 */
function heatOf(city) {
  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  const n = exps.length;
  const q = qualityOf(city);
  const expN = Math.min(1, Math.log10(1 + n) / Math.log10(1 + 400)); // 400 景点≈满
  const ratedN = Math.min(1, q.rated / 15);
  const avgN = Math.max(0, Math.min(1, (q.avg - 4.0) / 1.0));        // 4.0→0, 5.0→1
  const val = safeCall(function () { return T.valueScoreOf(city.name); }, 60);
  const valN = Math.max(0, Math.min(1, (val - 50) / 40));            // 50→0, 90→1
  return Math.max(0, Math.min(1, 0.40 * expN + 0.25 * ratedN + 0.20 * avgN + 0.15 * valN));
}

/* 省份集合缓存（从真实城市语料去重，避免"海南"误命中"海口"等短串） */
let _provinceCache = null;
function provinceSet() {
  if (_provinceCache) return _provinceCache;
  const s = new Set();
  const _c = (D && D.CITIES) || [];
  for (let i = 0; i < _c.length; i++) { const p = (_c[i] && _c[i].province) || ""; if (p) s.add(p); }
  _provinceCache = s;
  return s;
}

function hitCount(corpus, re) {
  if (!re) return 0;
  const m = corpus.match(re);
  return m ? m.length : 0;
}
function hitExamples(city, re, n) {
  const out = [];
  if (!re) return out;
  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  for (let i = 0; i < exps.length && out.length < (n || 2); i++) {
    const name = (exps[i] && exps[i].name) || "";
    if (!name) continue;
    re.lastIndex = 0;
    if (re.test(name)) out.push(name);
  }
  return out;
}

/* ── 需求解析：一句话 → 结构化偏好 ──
 * 例："想找个人少的古镇，三天，预算省一点" →
 *     { tags:["oldtown","quiet"], days:3, budget:"low", pace:"balance", month:当前月 } */
function extractPrefs(text, opts) {
  const o = opts || {};
  const s = String(text || "");
  const tags = [];
  for (let i = 0; i < TAGS.length; i++) {
    const t = TAGS[i];
    for (let j = 0; j < t.words.length; j++) {
      if (s.indexOf(t.words[j]) >= 0) { tags.push(t.key); break; }
    }
  }
  /* 并入 50 维共享词库（spot-tags.js）能识别、但 18 类主词典覆盖不到或覆盖不准的意图
   * （秋天/红叶→autumn、免费→free、海岛→island、森林→forest、峡谷/瀑布/雪山(snowmtn)…）。
   * 词重叠抑制已在 ST.parseQueryTags 内处理（"雪山"→snowmtn 而非 mountain），
   * 故直接并入即可，无需再二次抑制。去重避免与 18 类同名词（oldtown/sea/…）重复。 */
  const stKeys = ST.parseQueryTags(s);
  for (let i = 0; i < stKeys.length; i++) {
    if (tags.indexOf(stKeys[i]) < 0) tags.push(stKeys[i]);
  }
  let days = 0;
  const dm = s.match(/(\d+)\s*[天日]/);
  if (dm) days = Math.max(1, Math.min(30, parseInt(dm[1], 10)));
  else {
    const cm = s.match(/([一两二三四五六七八九十])\s*[天日]/);
    if (cm) days = CN_NUM[cm[1]] || 0;
  }
  let budget = "";
  for (const k in BUDGET_WORDS) {
    for (let i = 0; i < BUDGET_WORDS[k].length; i++) if (hasIntentWord(s, BUDGET_WORDS[k][i])) { budget = k; break; }
    if (budget) break;
  }
  let pace = "balance";
  for (const k in PACE_WORDS) {
    for (let i = 0; i < PACE_WORDS[k].length; i++) if (hasIntentWord(s, PACE_WORDS[k][i])) { pace = k; break; }
    if (pace !== "balance") break;
  }
  // 月份来源优先级：调用方显式给的 month > 文本里解析出的月份 > 当前月。
  // 此前 month 完全不读文本，导致"三月去赏花"被按当前月（如 11 月）评分，季节匹配失真。
  let month = 0;
  if (o.month) month = Math.max(1, Math.min(12, parseInt(o.month, 10) || 0));
  if (!month) { const mt = parseMonthFromText(s); if (mt) month = mt; }
  if (!month) { try { month = new Date().getMonth() + 1; } catch (e) { month = 0; } }

  /* 最高级词：最老/最大/最高…——项目无"建成年代"数据，无法据此真排序，
   * 但记下意图，前端提示「具体排序需实地考证」，并强化已命中标签的权重感。 */
  const EXT = [
    ["最古老", "oldest"], ["最老", "oldest"], ["最早", "oldest"],
    ["最大", "biggest"], ["最高", "highest"], ["最小", "smallest"], ["最低", "lowest"],
    ["最美", "mostbeautiful"], ["最有名", "famous"], ["最出名", "famous"],
  ];
  let extreme = "";
  for (let i = 0; i < EXT.length; i++) { if (s.indexOf(EXT[i][0]) >= 0) { extreme = EXT[i][1]; break; } }

  /* 城市名提取：query 显式含某已知城市 → 该城作锚点（用户想要它或「像它」的城）。
   * 取最长匹配，避免短名误命中；这是内容推荐的"硬意图"，优先级高于软标签。 */
  let namedCity = "";
  const _cities = (D && D.CITIES) || [];
  let _bestLen = 0;
  for (let i = 0; i < _cities.length; i++) {
    const nm = (_cities[i] && _cities[i].name) || "";
    if (nm && nm.length > 1 && s.indexOf(nm) >= 0 && nm.length > _bestLen) { namedCity = nm; _bestLen = nm.length; }
  }

  /* 省份提取：query 显式含某已知省份 → 该省城市加权（"浙江的古镇"优先浙江）。
   * 取最长匹配，避免短名误命中。 */
  let province = "";
  const _pset = provinceSet();
  let _pbest = 0;
  _pset.forEach(function (p) {
    if (p.length > 1 && s.indexOf(p) >= 0 && p.length > _pbest) { province = p; _pbest = p.length; }
  });

  return { text: s, tags: tags, days: days, budget: budget, pace: pace, month: month, extreme: extreme, namedCity: namedCity, province: province };
}

/* ── 相关性：绝对量 + 密度 双因子（relevanceOf 与 relevanceOfSpot 共用）──
 * combo = absW * min(1, hits/absSat^absPow) + densW * (coreFloor + coreSpan*min(1, density/coreSat))
 * 前者让"馆藏量大"的大城市不吃亏，后者让"整城就是古镇"的小城能冒头。
 * 抽成纯函数，两处复用，避免双份公式日后悄悄走形。 */
function comboScore(hits, expCount, w) {
  const density = hits / Math.max(6, expCount);
  const absCore = Math.min(1, Math.pow(hits / W.absCap, W.absPow)); // 幂刻度，保留大城之间差距
  const densCore = W.coreFloor + W.coreSpan * Math.min(1, density / W.coreSat);
  const combo = W.absW * absCore + W.densW * densCore;
  const val = w * combo; // 浮点，与原始 `d = def.w * combo` 一致：sum 不取整（W 权重据此锁定，取整会漂排序）
  return {
    density: density,
    combo: combo,
    val: val,
    delta: Math.round(val) + (hits >= W.hitBonusAt ? W.hitBonus : 0), // 仅展示用取整
  };
}

function relevanceOf(city, tagKeys, expCount, corpus) {
  let sum = 0;
  const detail = [];
  let matched = 0;
  let required = 0;        // 用户明确要的"核心诉求"标签数（w >= missTagMin）
  let matchedRequired = 0; // 其中命中的个数
  for (let i = 0; i < tagKeys.length; i++) {
    const def = tagOf(tagKeys[i]);
    if (!def || def.special === "quiet") continue;
    const isReq = def.w >= W.missTagMin;
    if (isReq) required++;
    let hits = 0;
    if (def.foodsMin) hits = (Array.isArray(city.foods) ? city.foods.length : 0) >= def.foodsMin ? 1 : 0;
    else hits = hitCount(corpus, def.re);
    if (hits <= 0) continue;

    const sc = comboScore(hits, expCount, def.w);
    sum += sc.val; // 浮点累加（与原始一致）；hitBonus 已含于 delta 仅展示用，故此处不再加
    matched++;
    if (isReq) matchedRequired++;
    detail.push({
      key: def.key, label: def.label, hits: hits,
      density: Math.round(sc.density * 1000) / 1000,
      combo: Math.round(sc.combo * 100) / 100,
      delta: sc.delta,
      examples: def.foodsMin ? (city.foods || []).slice(0, 2) : hitExamples(city, def.re, 2),
    });
  }
  return { sum: sum, matched: matched, required: required, matchedRequired: matchedRequired, detail: detail };
}

/* ── 50 维共享词库补充相关性：用「真实景点标签命中数」计分（比语料正则更准）──
 * 只处理 18 类主词典覆盖不到、或覆盖不准的意图（autumn/免费/海岛/森林/峡谷/瀑布/雪山(snowmtn)…）。
 * 与 relevanceOf 同构（绝对量 + 密度 双因子，复用同一套 W 常量），但 hits 来源是 citySpotTags
 * 的真实景点标签计数，而非在全文语料上跑正则。返回结构与 relevanceOf 一致。
 * 注意：这里只做「正向加分」，不做 missWeight 的 AND 语义扣分 —— 50 维意图多为"锦上添花"的
 * 维度（如秋天/免费），扣分会过度惩罚；其区分度由「命中即加成、未命中不加」自然体现。 */
function relevanceOfSpot(city, stTagKeys, expCount) {
  const map = citySpotTags(city);
  let sum = 0;
  const detail = [];
  let matched = 0;
  for (let i = 0; i < stTagKeys.length; i++) {
    const def = ST.TAG_BY_KEY[stTagKeys[i]];
    if (!def) continue;
    const info = map[stTagKeys[i]];
    if (!info || info.count <= 0) continue;
    const hits = info.count;
    const sc = comboScore(hits, expCount, def.w);
    sum += sc.val; // 浮点累加（与原始一致）；hitBonus 仅含于展示用 delta
    matched++;
    detail.push({
      key: def.key, label: def.label, hits: hits,
      density: Math.round(sc.density * 1000) / 1000,
      combo: Math.round(sc.combo * 100) / 100,
      delta: sc.delta,
      examples: info.examples.slice(0, 2),
    });
  }
  return { sum: sum, matched: matched, detail: detail };
}

/* ── 单城打分 ──
 * 所有 delta 均为可解释整数，求和即分数；_raw 为未取整值，用于稳定破平。 */
function scoreCity(city, prefs, month) {
  const p = prefs || {};
  const m = month || p.month || (function () { try { return new Date().getMonth() + 1; } catch (e) { return 0; } })();
  const reasons = [];
  const push = function (label, delta, note) {
    if (delta) reasons.push({ label: label, delta: Math.round(delta), note: note || "" });
  };

  const exps = Array.isArray(city.experiences) ? city.experiences : [];
  const expCount = exps.length;
  const corpus = corpusOf(city);
  const q = qualityOf(city);
  const tagKeys = (p.tags && p.tags.length) ? p.tags : [];

  let raw = W.base;

  /* ① 相关性（主导项）：18 类主词典 + 50 维共享词库补充信号 */
  // 50 维补充意图：在 18 类中查不到(TAG_BY_KEY 有、tagOf 无)的标签，才走"真实景点标签命中数"路径；
  // 与 18 类同名的标签（oldtown/sea/…）仍由主路径处理，保证既有黄金用例不变。
  // 同义键（snowmtn↔snowmt / grassland↔grass）：主路径已覆盖该意图，补充路径跳过，避免同一意图被重复加权。
  const stKeys = tagKeys.filter(function (k) {
    if (!ST.TAG_BY_KEY[k] || tagOf(k)) return false;          // 主路径已处理的（同名键）
    const syn = ST_SYNONYM_OF[k];
    if (syn && tagOf(syn)) return false;                      // 同义键：主路径已计分，跳过防重复加权
    return true;
  });
  const rel = relevanceOf(city, tagKeys, expCount, corpus);
  if (rel.sum > 0) {
    const relNorm = Math.min(1, rel.sum / W.relevanceNorm);
    raw += relNorm * W.relevanceMax;
    for (let i = 0; i < rel.detail.length; i++) {
      const d = rel.detail[i];
      push(d.label, d.delta, "命中 " + d.hits + " 处（密度 " + Math.round(d.density * 100) + "%）" + (d.examples.length ? "，如 " + d.examples.join("、") : ""));
    }
  }
  // 50 维补充相关性（真实景点标签命中数）：仅当 query 含补充意图时才有值，平时 sum=0 不影响
  const relST = stKeys.length ? relevanceOfSpot(city, stKeys, expCount) : { sum: 0, matched: 0, detail: [] };
  if (relST.sum > 0) {
    const stNorm = Math.min(1, relST.sum / W.relevanceSTNorm);
    raw += stNorm * W.relevanceSTMax;
    for (let i = 0; i < relST.detail.length; i++) {
      const d = relST.detail[i];
      push(d.label, d.delta, "「" + d.hits + " 个景点」符合（密度 " + Math.round(d.density * 100) + "%）" + (d.examples.length ? "，如 " + d.examples.join("、") : ""));
    }
  }

  /* ② 季节匹配：复用既有 bestMonths
   * v1.19.201 护栏：用户明确说出主题（沙漠/古镇/海边…）时，季节不该成为主排序信号。
   *   · 正值最佳季节的加成按「主题命中强度」缩放 —— 只零星提到关键词的城市
   *     不能靠「这个月去正好」拿满额加分；
   *   · 无意图（"随便逛逛"）时 tagKeys 为空，季节仍是综合热度榜的有效信号，不缩放；
   *   · 非最佳季节只失去加成、轻微扣分，不再倒扣到把真目的地挤出榜单。
   */
  const hasTheme = tagKeys.length > 0;
  const relStrength = hasTheme
    ? Math.min(1, (rel.sum + relST.sum) / W.relevanceNorm)
    : 1;
  const HIT = hasTheme ? W.seasonHit : W.seasonHitIdle;
  const MISS = hasTheme ? W.seasonMiss : W.seasonMissIdle;
  const ALLY = hasTheme ? W.seasonAllYear : W.seasonAllYearIdle;
  let seasonNote = "";
  if (expCount > 0) {
    const months = safeCall(function () { return T.bestMonths(city.best); }, null);
    if (months && months.length) {
      if (months.indexOf(m) >= 0) {
        const bonus = Math.round(HIT * relStrength);
        raw += bonus;
        push("正值最佳季节", bonus, m + " 月在其最佳月 " + months.join("/") + " 内");
      } else {
        raw += MISS; push("非最佳季节", MISS, "最佳月：" + months.join("/"));
      }
      seasonNote = "最佳 " + months.join("/") + " 月";
    } else {
      const bonus = Math.round(ALLY * relStrength);
      raw += bonus; push("四季皆宜", bonus, "无明显季节限制");
      seasonNote = "四季皆宜";
    }
  }

  /* ③ 成熟度先验（上限 10，只微调次序） */
  if (expCount > 0) {
    const pd = Math.round(q.prom * W.promMax);
    if (pd) {
      raw += pd;
      if (pd >= 4) push("游玩成熟度", pd, q.rated + " 个评级景点" + (q.avg ? "，均分 " + q.avg.toFixed(1) : ""));
    }
  }

  /* ④ 预算匹配 */
  const want = p.budget, have = city.cost || "mid";
  if (want) {
    if (want === have) { raw += W.budgetMatch; push("预算吻合", W.budgetMatch, budgetLabel(have)); }
    else if (adjacentBudget(want, have)) { raw += W.budgetNear; push("预算接近", W.budgetNear, "你偏好" + budgetLabel(want) + "，该城为" + budgetLabel(have)); }
    else { raw += W.budgetMiss; push("预算不符", W.budgetMiss, "你偏好" + budgetLabel(want) + "，该城为" + budgetLabel(have)); }
  }

  /* ⑤ 性价比：复用既有 valueScoreOf（0-100） */
  const val = safeCall(function () { return T.valueScoreOf(city.name); }, 60);
  const vd = Math.round((val - 60) / W.valueDiv);
  if (vd) { raw += vd; if (Math.abs(vd) >= 4) push("性价比", vd, "综合 " + val + "/100"); }

  /* ⑥ 天数适配 */
  if (p.days && expCount > 0) {
    if (expCount < p.days * 3) { raw += W.daysThin; push("景点偏少", W.daysThin, expCount + " 个景点，" + p.days + " 天略紧"); }
    else if (expCount > p.days * 14) { raw += W.daysRich; push("可玩点多", W.daysRich, expCount + " 个景点需取舍"); }
  }

  /* ⑦ 人少小众（特例）：以景点数作"热门度"代理 */
  if (tagKeys.indexOf("quiet") >= 0 && expCount > 0) {
    if (expCount < 40) { raw += W.quietSmall; push("小众非热门", W.quietSmall, expCount + " 个景点，热度不高"); }
    else { raw += W.quietBig; push("偏热门", W.quietBig, expCount + " 个景点，旺季人多"); }
  }

  /* ⑧ 覆盖诚实 */
  const limited = !!city.limited || expCount === 0;
  if (limited) { raw += W.limited; push("数据覆盖有限", W.limited, "该城景点资料较少，建议结合官方渠道确认"); }

  /* ⑨ 必选项语义：用户明确要的核心诉求（如"海边"+"亲子"）应当同时满足。
   * 纯求和会让"只是亲子强、但不是海边"的城市挤进榜单（实测重庆进过海边榜），
   * 故对每个未命中的必需标签扣分，把 OR 语义纠正为 AND 语义。 */
  const missingReq = rel.required - rel.matchedRequired;
  if (missingReq > 0) {
    const pen = W.missWeight * missingReq;
    raw += pen;
    push("核心条件不全", pen, "缺少 " + missingReq + " 项你明确要的要素");
  }

  /* ⑬ 核心标签「仅零星提及 / 字面误命中」降权（v1.19.201）
   * 语料里存在「厚田沙漠」「大观区沙漠洲生态公园」「洋沙山海滨乐园」这类
   * 名字含关键词、但整城并非该主题目的地的景点。此前仅凭 1–2 处弱命中
   * 就能拿主题分 + 满额时令加成，11 月「沙漠戈壁 摄影 四天」把南昌/安庆/
   * 宁波推进 Top5，敦煌反而掉到第 7。
   * 判据用「密度 + combo」双门槛：真正小而精的目的地（阿拉善盟密度 52%）
   * 不受影响；只有两个指标同时极低的字面巧合才降权，理由对用户可见。
   */
  if (hasTheme) {
    let weakRequired = 0;
    for (let i = 0; i < rel.detail.length; i++) {
      const d = rel.detail[i];
      const def = tagOf(d.key);
      if (!def || def.w < W.missTagMin) continue;   // 只约束用户明确要的核心要素
      if (d.density < W.weakHitDensity && d.combo < W.weakHitCombo) weakRequired++;
    }
    if (weakRequired > 0) {
      const pen = W.weakHitPenalty * weakRequired;
      raw += pen;
      push("仅零星提及", pen, "有 " + weakRequired + " 项核心要素只在个别景点名中出现，非典型目的地");
    }
  }

  /* ⑭ 有主题诉求但「零命中」的城市不得靠通用分挤进榜（v1.19.201）
   * 50 维词库意图（秋天/红叶/免费/海岛…）的相关性上限只有 14，低于
   * 成熟度 + 热度的通用分。11 月「秋天 看红叶 小众 五天」Top5 全是零命中的
   * 「综合热度」城，本溪（真有秋季适宜内容）反而掉出榜。这里给零命中城一个
   * 可解释的降权，让命中的城回到榜上；无意图路径（tagKeys 为空）不受影响。
   */
  if (hasTheme && (rel.sum + relST.sum) <= 0) {
    raw += W.noHitPenalty;
    push("未命中偏好", W.noHitPenalty, "未找到与你描述相符的内容，按综合热度兜底");
  }

  /* 城市名锚点：query 显式提到该城 → 强提权（用户想要它或「像它」的城）。
   * 用 +50 确保压过同类软标签排序；理由显式标注，避免黑箱。 */
  let isNamed = false;
  if (p.namedCity && p.namedCity === city.name) {
    raw += 50;
    isNamed = true;
    push("你提到的城市", 50, "已按你点名的目的地优先");
  }

  /* ⑩ 综合热度先验（离线派生知名度/成熟度代理）：无意图时给出有区分度的"热门目的地"
   * 排序（不再全城同分）；有意图时作为轻微先验破平（上限 16 < 相关性 44，不喧宾夺主）。 */
  const heat = heatOf(city);
  raw += heat * W.heatMax;

  /* ⑪ 省份定向：query 显式含某省份 → 该省城市加权（"浙江的古镇"优先浙江）。 */
  if (p.province && p.province === city.province) {
    raw += W.provinceBoost;
    push("本省优先", W.provinceBoost, "你提到了" + p.province + "，优先推荐该省目的地");
  }

  /* ⑫ 最高级诉求强化："最…"类诉求 → 已命中维度再提一档，让"最大/最老"的城更靠前。 */
  if (p.extreme && rel.sum > 0) {
    raw += W.extremeBoost;
    push("突出核心诉求", W.extremeBoost, "「最…」类诉求，已强化你点名的维度");
  }

  const score = Math.max(1, Math.min(99, Math.round(raw)));

  reasons.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  const top = reasons.slice(0, 5);

  /* 主因标签（透明化）：点名 > 最强"内容命中"标签(18 类 ∪ 50 维) > 综合热度。
   * 取 rel.detail 与 relST.detail 合并后 |delta| 最大者 —— 即用户意图中"证据最强"的那类，
   * 而非数组里的第一个 18 类键（"森林 徒步 秘境"此前会误显示泛化的"山水自然"，现优先显示"森林秘境"）。
   * 注意：只用内容命中（detail），不混入季节/预算/成熟度等加成理由，避免 reasonTag 被"正值最佳季节"抢走。 */
  let reasonTag = "";
  if (isNamed) reasonTag = "你提到的城市";
  else {
    const contentTags = rel.detail.concat(relST.detail);
    if (contentTags.length) {
      contentTags.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
      reasonTag = contentTags[0].label;
    } else reasonTag = "综合热度";
  }

  /* 无明确意图时，summary 不再伪装成「命中理由」，直接说明是综合热度推荐 */
  const hasIntent = (rel.sum > 0 || relST.sum > 0) || isNamed;
  const summary = hasIntent ? summarize(top) : "综合热度推荐（未识别到具体偏好，已按景点规模·评级·性价比·季节综合排序）";

  return {
    name: city.name,
    province: city.province || "",
    region: city.region || "",
    score: score,
    _raw: Math.round(raw * 100) / 100,
    limited: limited,
    expCount: expCount,
    seasonNote: seasonNote,
    relevance: Math.round((rel.sum + relST.sum) * 100) / 100,
    reasonTag: reasonTag,
    tagHits: rel.detail,
    tagHitsST: relST.detail,
    reasons: top,
    summary: summary,
  };
}

/* ── 主入口：一句话 → Top-N 城市 ──
 * opts = { month, topN=5, minScore=0, includeLimited=false } */
function recommend(text, opts) {
  const o = opts || {};
  const prefs = extractPrefs(text, o);
  // 注意：不能用 `parseInt(o.topN,10) || 5` —— 传 topN:0 时 0 是 falsy，会被当成"没传"而
  // 回退到默认 5，与"夹到 [1,20]"的意图不符。改为先判 NaN 再夹取（_fuzz-recommend 抓到此 bug）。
  const _rawTop = parseInt(o.topN, 10);
  const topN = isFinite(_rawTop) ? Math.max(1, Math.min(20, _rawTop)) : 5;
  const minScore = typeof o.minScore === "number" ? o.minScore : 0;
  const includeLimited = !!o.includeLimited;

  if (!D || !D.__dataReady || !Array.isArray(D.CITIES) || !D.CITIES.length) {
    return { list: [], prefs: prefs, month: prefs.month, total: 0, matched: 0, pending: true };
  }

  const scored = [];
  for (let i = 0; i < D.CITIES.length; i++) {
    const c = D.CITIES[i];
    if (!c || !c.name) continue;
    const r = scoreCity(c, prefs, prefs.month);
    if (!includeLimited && r.limited) continue;
    if (r.score < minScore) continue;
    scored.push(r);
  }
  // 主键：取整分；次键：原始分（连续，破平）；末键：城名（保证确定性）
  scored.sort(function (a, b) {
    return (b.score - a.score) || (b._raw - a._raw) || a.name.localeCompare(b.name);
  });

  return {
    list: scored.slice(0, topN),
    prefs: prefs,
    month: prefs.month,
    total: D.CITIES.length,
    matched: scored.length,
    pending: false,
    // 透明度字段：前端据此切换「匹配度 / 综合热度 / 你提到的城市」文案与提示
    mode: prefs.namedCity ? "city" : (prefs.tags.length ? "intent" : "overall"),
    noIntent: !prefs.tags.length && !prefs.namedCity,
    extreme: !!prefs.extreme,
    namedCity: prefs.namedCity || "",
  };
}

/* 单城解释（详情页 / 答辩演示单点用） */
function explain(cityName, text, opts) {
  if (!D || !D.__dataReady) return { pending: true };
  const prefs = extractPrefs(text, opts);
  // 注意：不能走 T.findCity —— 它对未知城名会**合成一个只有 1 个景点的占位城市**
  // （planner 的兜底逻辑），导致传不存在的城名也被判为"找到了"。
  // explain 的契约是"解释真实城市"，故只在 D.CITIES 里精确查找。
  const city = (D.CITIES || []).filter(function (c) { return c && c.name === cityName; })[0];
  if (!city) return { pending: false, found: false, name: cityName };
  const r = scoreCity(city, prefs, prefs.month);
  r.found = true;
  r.prefs = prefs;
  return r;
}

/* ── 小工具 ── */
function tagOf(key) {
  for (let i = 0; i < TAGS.length; i++) if (TAGS[i].key === key) return TAGS[i];
  return null;
}
function budgetLabel(k) { return k === "low" ? "经济型" : k === "high" ? "高端型" : "舒适型"; }
function adjacentBudget(a, b) {
  const order = { low: 0, mid: 1, high: 2 };
  if (!(a in order) || !(b in order)) return false;
  return Math.abs(order[a] - order[b]) === 1;
}
function safeCall(fn, fb) { try { return fn(); } catch (e) { return fb; } }
function summarize(reasons) {
  const pos = reasons.filter(function (r) { return r.delta > 0; }).slice(0, 2);
  if (!pos.length) return "综合条件一般";
  return pos.map(function (r) { return r.label; }).join(" · ");
}

module.exports = {
  W: W,
  TAGS: TAGS,
  extractPrefs: extractPrefs,
  relevanceOf: relevanceOf,
  relevanceOfSpot: relevanceOfSpot,
  citySpotTags: citySpotTags,
  scoreCity: scoreCity,
  qualityOf: qualityOf,
  heatOf: heatOf,
  provinceSet: provinceSet,
  recommend: recommend,
  explain: explain,
  corpusOf: corpusOf,
};
