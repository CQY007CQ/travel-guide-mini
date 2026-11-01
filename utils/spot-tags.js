/* 景点多维标签词库（utils/spot-tags.js）
 *
 * 这是「按标签找景点」体系的共享词库，构建期标注器（tools/build-spot-tags.mjs）与
 * 运行时检索（utils/spotsearch.js）都依赖它，保证「标注用的词」与「解析用户 query 用的词」
 * 是同一套，杜绝"标了 A 但搜不到 A"的语义漂移。
 *
 * 设计（30 年检索视角）：
 *  - 维度化：主题 / 活动 / 人群 / 季节 / 氛围 / 时长 / 票价 七维，覆盖"去哪类地方、玩什么、
 *    和谁、什么时候、什么心情、逛多久、花多少"。
 *  - 每个标签带 words（用户口语同义词，用于解析 query）+ re（景点语料正则，用于标注）。
 *    标注用 re 刻意写得"具体"，避免「林/海/寺」这类字面误伤（与 recommend.js 同源思路）。
 *  - w 为匹配权重（经验值，可单测锁定）；season 类由结构化字段派生而非纯正则。
 *
 * 纯数据 + 正则，无 Node / 小程序平台专属 API，两端通用。
 */

const DIM_LABELS = {
  theme: "主题",
  activity: "活动",
  audience: "人群",
  season: "季节",
  mood: "氛围",
  duration: "时长",
  price: "票价",
};

/* 标签词典
 * key      : 稳定标识（随包下发、倒排索引键）
 * label    : 中文展示名
 * dim      : 维度（见 DIM_LABELS）
 * w        : 匹配权重
 * words    : 用户可能说出的词（解析 query 用）
 * re       : 景点语料命中正则（标注用）；为空表示由 special 逻辑派生
 * special  : 特殊派生类型（season=季节结构化派生 / quiet=小众派生） */
const TAGS = [
  // ── 主题 ──
  { key: "oldtown", label: "古镇古城", dim: "theme", w: 8, words: ["古镇", "古城", "老街", "水乡", "古街", "老城", "古建", "古村镇", "老城厢", "古县城", "千年古镇"], re: "古镇|古城|古街|老街|古村落|古县城|西栅|东栅|南浔|同里" },
  { key: "watertown", label: "江南水乡", dim: "theme", w: 7, words: ["水乡", "江南水乡", "枕水", "小桥流水"], re: "水乡|枕水|乌镇|西塘|南浔|同里|周庄" },
  { key: "nature", label: "山水自然", dim: "theme", w: 6, words: ["山水", "自然", "风景", "自然风光", "看风景"], re: "自然风光|青山|碧水|峡谷|瀑布|森林|湿地|溪|溶洞" },
  { key: "mountain", label: "山岳名峰", dim: "theme", w: 6, words: ["山", "山峰", "名山", "登山", "爬山", "岳"], re: "[^假火荒坡脚区间地寨]山|峰|岳|岭|崮|主峰" },
  { key: "forest", label: "森林秘境", dim: "theme", w: 5, words: ["森林", "林海", "原始森林", "森林公园", "徒步"], re: "森林|林海|林场|森林公园|原始森林" },
  { key: "canyon", label: "峡谷天坑", dim: "theme", w: 6, words: ["峡谷", "大峡谷", "峡", "天坑"], re: "峡谷|大峡谷|天坑|地缝" },
  { key: "waterfall", label: "瀑布飞瀑", dim: "theme", w: 6, words: ["瀑布", "飞瀑", "大瀑布"], re: "瀑布|飞瀑|叠水" },
  { key: "cave", label: "溶洞暗河", dim: "theme", w: 6, words: ["溶洞", "钟乳洞", "地下河", "龙宫"], re: "溶洞|钟乳|地下河|龙宫|暗河" },
  { key: "lake", label: "江湖湖泊", dim: "theme", w: 5, words: ["湖", "江", "游船", "漂流", "泛舟", "湖光", "湖边"], re: "湖|江|游船|漂流|泛舟|竹筏|湖光|湖畔" },
  { key: "sea", label: "海滨海岛", dim: "theme", w: 8, words: ["海", "海边", "海岛", "沙滩", "看海", "赶海", "海滨", "海岸", "海岛游"], re: "海滨|海边|海滩|沙滩|海岛|岛屿|海岸|滨海|赶海|看海|浴场|海湾" },
  { key: "island", label: "离岛小岛", dim: "theme", w: 7, words: ["海岛", "岛屿", "离岛", "小岛", "无人岛"], re: "岛|岛屿|列岛|离岛" },
  { key: "grassland", label: "草原牧场", dim: "theme", w: 8, words: ["草原", "牧场", "骑马", "草甸", "大草原"], re: "草原|牧场|草甸|骑马|那拉提|草原天路|呼伦贝尔" },
  { key: "desert", label: "沙漠戈壁", dim: "theme", w: 9, words: ["沙漠", "戈壁", "荒漠", "沙丘", "大漠"], re: "沙漠|戈壁|荒漠|沙丘|鸣沙|雅丹|沙山|大漠" },
  { key: "snowmtn", label: "高原雪山", dim: "theme", w: 6, words: ["高原", "雪山", "冰川", "高海拔", "雪峰", "高原反应"], re: "雪山|冰川|高原|雪峰|冰川湖|垭口|藏区" },
  { key: "hotspring", label: "温泉泡汤", dim: "theme", w: 9, words: ["温泉", "泡汤", "汤泉", "温泉度假", "泡温泉"], re: "温泉" },
  { key: "ski", label: "滑雪冰雪", dim: "theme", w: 9, words: ["滑雪", "冰雪", "看雪", "雪场", "滑冰", "滑雪场"], re: "滑雪|冰雪|雪场|冰雕|雪乡|亚布力|滑冰" },
  { key: "history", label: "历史人文", dim: "theme", w: 6, words: ["历史", "文化", "古迹", "人文", "古都", "遗址", "古建", "木构", "唐代", "宋代", "明代", "明清", "宫殿", "皇家", "帝王陵", "斗拱", "榫卯", "古塔", "古寺", "古城墙"], re: "遗址|纪念|故居|石窟|陵|城墙|古建|碑|殿|阁|皇宫|王陵|衙署" },
  { key: "museum", label: "博物馆艺术", dim: "theme", w: 8, words: ["博物馆", "展览", "艺术", "美术馆", "看展", "文艺", "画廊"], re: "博物|美术馆|展览馆|画廊|艺术馆|故宫" },
  { key: "religious", label: "宗教寺庙", dim: "theme", w: 6, words: ["寺庙", "烧香", "祈福", "佛教", "道教", "教堂", "清真寺", "禅修"], re: "寺|庙|庵|观|教堂|清真寺|道观|禅|佛" },
  { key: "red", label: "红色记忆", dim: "theme", w: 6, words: ["红色", "革命", "烈士", "红色旅游", "党史"], re: "红色|革命|烈士|苏维埃|抗战|旧址|根据地" },
  { key: "folk", label: "民俗风情", dim: "theme", w: 6, words: ["民俗", "少数民族", "风情", "非遗", "民族"], re: "民俗|民族|非遗|风情|寨" },
  { key: "modern", label: "现代都市", dim: "theme", w: 5, words: ["都市", "摩天", "地标", "天际线", "CBD", "现代城市", "城市观光"], re: "CBD|摩天|天际线|环球中心|国金|金融街|地标|综合体|商圈" },
  { key: "amusement", label: "游乐园", dim: "theme", w: 8, words: ["游乐园", "乐园", "主题公园", "欢乐谷", "迪士尼"], re: "乐园|游乐园|主题公园|欢乐谷|方特|迪士尼" },
  { key: "zoo", label: "动物园海洋", dim: "theme", w: 7, words: ["动物园", "看动物", "野生动物", "海洋馆", "水族馆"], re: "动物园|野生动物|海洋馆|海洋世界|水族" },
  { key: "botanical", label: "园林植物", dim: "theme", w: 5, words: ["植物园", "园林", "盆景", "园艺"], re: "植物园|园林|盆景|园艺|古典园林" },
  { key: "flower", label: "赏花花海", dim: "theme", w: 5, words: ["赏花", "花海", "樱花", "油菜花", "桃花", "荷花", "梅花", "花展", "薰衣草"], re: "花海|樱花|油菜花|桃花|荷花|梅花|赏花|花卉|薰衣草|郁金香|向日葵" },

  // ── 活动 ──
  { key: "hike", label: "徒步栈道", dim: "activity", w: 5, words: ["徒步", "健步", "栈道", "徒步游"], re: "徒步|健步|栈道|步道|古道" },
  { key: "climb", label: "登山攀岩", dim: "activity", w: 5, words: ["登山", "爬山", "攀岩", "攀山"], re: "登山|爬山|攀岩|缆车|索道" },
  { key: "boating", label: "游船泛舟", dim: "activity", w: 5, words: ["游船", "泛舟", "竹筏", "划船", "摇橹"], re: "游船|泛舟|竹筏|划船|摇橹|帆船" },
  { key: "cycling", label: "骑行绿道", dim: "activity", w: 4, words: ["骑行", "自行车", "绿道", "骑游"], re: "骑行|自行车|绿道|骑游|单车" },
  { key: "camping", label: "露营营地", dim: "activity", w: 5, words: ["露营", "营地", "帐篷", "房车"], re: "露营|营地|帐篷|房车|星空" },
  { key: "photo", label: "摄影出片", dim: "activity", w: 5, words: ["拍照", "出片", "摄影", "网红", "打卡", "日落", "日出", "夜景", "机位"], re: "观景|全景|日落|日出|夜景|风光|出片|摄影|打卡|机位|倒影" },
  { key: "birdwatching", label: "观鸟自然", dim: "activity", w: 4, words: ["观鸟", "鸟类", "候鸟", "拍鸟"], re: "观鸟|鸟类|候鸟|鸟岛|湿地" },

  // ── 人群 ──
  { key: "family", label: "亲子带娃", dim: "audience", w: 8, words: ["亲子", "带娃", "孩子", "小朋友", "儿童", "遛娃"], re: "乐园|动物园|海洋馆|科技馆|亲子|水族|欢乐谷|游乐园|儿童|科普" },
  { key: "couple", label: "情侣浪漫", dim: "audience", w: 4, words: ["情侣", "约会", "二人", "蜜月"], re: "情侣|约会|浪漫|二人世界|蜜月" },
  { key: "elderly", label: "适老慢游", dim: "audience", w: 4, words: ["老人", "适老", "长辈", "慢游", "康养"], re: "康养|疗养|慢游|适老|敬老|养生" },
  { key: "friends", label: "朋友聚会", dim: "audience", w: 3, words: ["朋友", "聚会", "闺蜜", "团建", "轰趴"], re: "聚会|团建|轰趴|酒吧|好友" },

  // ── 季节（由 best/period/note 结构化派生，也接受用户口语）──
  { key: "spring", label: "春季适宜", dim: "season", w: 4, words: ["春天", "春季", "春游", "踏青", "三四月"], special: "season" },
  { key: "summer", label: "夏季适宜", dim: "season", w: 4, words: ["夏天", "夏季", "避暑", "玩水", "七八月"], special: "season" },
  { key: "autumn", label: "秋季适宜", dim: "season", w: 4, words: ["秋天", "秋季", "红叶", "赏秋", "九十月"], special: "season" },
  { key: "winter", label: "冬季适宜", dim: "season", w: 4, words: ["冬天", "冬季", "冰雪", "滑雪季", "一两月"], special: "season" },

  // ── 氛围 ──
  { key: "quiet", label: "人少小众", dim: "mood", w: 5, words: ["人少", "小众", "冷门", "不挤", "安静", "秘境"], special: "quiet" },
  { key: "lively", label: "热闹市井", dim: "mood", w: 3, words: ["热闹", "夜市", "市井", "烟火气"], re: "夜市|市井|热闹|烟火|人声鼎沸" },
  { key: "healing", label: "治愈放松", dim: "mood", w: 4, words: ["治愈", "放松", "疗愈", "禅意"], re: "治愈|疗愈|放松|禅意|静心" },
  { key: "romantic", label: "浪漫氛围", dim: "mood", w: 3, words: ["浪漫", "告白", "求婚", "约会"], re: "浪漫|告白|求婚|心动" },
  { key: "literary", label: "文艺腔调", dim: "mood", w: 3, words: ["文艺", "小资", "腔调", "书店"], re: "文艺|小资|腔调|书店|美术馆|独立" },

  // ── 时长 ──（re 刻意收紧：只认明确时长表述，避免"一日游"之类泛词把全城景点都打上标）
  { key: "halfday", label: "半日可逛", dim: "duration", w: 2, words: ["半日", "半天", "快闪", "2小时"], re: "半日|半天|2小时|一小时|半天左右|小半天" },
  { key: "fullday", label: "一日深度", dim: "duration", w: 2, words: ["一日", "整天", "全天", "大半天"], re: "一整天|大半天|玩一天|需一日|全天游玩|建议安排一天|整日" },

  // ── 票价 ──
  { key: "free", label: "免费开放", dim: "price", w: 5, words: ["免费", "不花钱", "0元", "免票", "免费景点"], re: "免费|免票|0元|不收门票|无需门票" },
  { key: "cheap", label: "平价实惠", dim: "price", w: 3, words: ["平价", "实惠", "性价比高", "不贵"], re: "平价|实惠|免费|不贵|亲民" },
];

const TAG_BY_KEY = {};
for (let i = 0; i < TAGS.length; i++) TAG_BY_KEY[TAGS[i].key] = TAGS[i];

/* 预编译正则（避免每次 new RegExp） */
const _reCache = {};
function reOf(t) {
  if (!t.re) return null;
  if (!_reCache[t.key]) _reCache[t.key] = new RegExp(t.re, "g");
  return _reCache[t.key];
}

/* 解析用户 query → 命中标签 key 列表（与标注同一套词库，保证语义一致）
 * 关键修正（30 年检索经验）：词重叠抑制。
 *   "雪山" 同时命中 snowmtn(词「雪山」) 与 mountain(词「山」)，若不处理会把无关的"山"也拉进来，
 *   导致"带娃 雪山"召回一堆假山/公园。规则：若某标签的最长命中词是另一标签命中词的子串，
 *   则去掉更"泛"的那个，只保留最具体的标签（雪山→snowmtn，而非 mountain）。 */
function parseQueryTags(text) {
  const s = String(text || "");
  const best = {}; // key -> 最长命中词（越长越具体）
  for (let i = 0; i < TAGS.length; i++) {
    const t = TAGS[i];
    if (!t.words || !t.words.length) continue;
    let bw = "";
    for (let j = 0; j < t.words.length; j++) {
      if (s.indexOf(t.words[j]) >= 0 && t.words[j].length > bw.length) bw = t.words[j];
    }
    if (bw) best[t.key] = bw;
  }
  const keys = Object.keys(best);
  if (keys.length <= 1) return keys;
  const drop = new Set();
  for (let a = 0; a < keys.length; a++) {
    for (let b = 0; b < keys.length; b++) {
      if (a === b) continue;
      const wa = best[keys[a]], wb = best[keys[b]];
      // wa 是 wb 的子串且更短 → wa 更"泛"，抑制
      if (wa.length < wb.length && wb.indexOf(wa) >= 0) drop.add(keys[a]);
    }
  }
  return keys.filter(k => !drop.has(k));
}

/* 在一段景点语料上跑所有"正则型"标签，返回命中的 key 列表 */
function matchTagsInText(text) {
  const s = String(text || "");
  const out = [];
  for (let i = 0; i < TAGS.length; i++) {
    const re = reOf(TAGS[i]);
    if (!re) continue;
    re.lastIndex = 0;
    if (re.test(s)) out.push(TAGS[i].key);
  }
  return out;
}

/* 单个景点的多维标签向量（纯函数，两端通用）。
 * 输入：景点 exp={name,period,note} + 所属 city={best,limited,...}
 * 输出：标签 key 数组。
 *   · 正则型标签：name+period+note 跑词库
 *   · 季节：只用景点自身 period/note 的强信号（不继承城市，避免整城同季）
 *   · 小众：城市覆盖有限 或 景点语料含冷门信号
 * 构建期标注器与运行时检索引擎共用此函数，保证"标注"与"检索"同源。 */
function tagSpot(exp, city) {
  const corpus = [exp && exp.name || "", exp && exp.period || "", exp && exp.note || ""].join(" ");
  const tags = new Set(matchTagsInText(corpus));
  const seasons = deriveSeasons("", (exp && exp.period) || "", (exp && exp.note) || "");
  for (let i = 0; i < seasons.length; i++) tags.add(seasons[i]);
  if (city && (city.limited || /冷门|秘境|小众|人少|原生态|私藏|冷僻|未开发|人迹罕至/.test(corpus))) {
    tags.add("quiet");
  }
  return Array.from(tags);
}

/* 季节结构化派生：从城市 best + 景点 period + note 推断适宜季节
 * 思路：① 关键词（避暑/红叶/冰雪/踏青…）② 月份数字（3-4月→春，9-10月→秋…）
 * 返回 ["spring"] 之类子集。可命中多季（如"春秋皆宜"）。 */
function deriveSeasons(best, period, note) {
  const blob = [best || "", period || "", note || ""].join(" ");
  const out = new Set();
  // 关键词
  if (/避暑|玩水|盛夏|海滨盛夏|清凉/.test(blob)) out.add("summer");
  if (/红叶|赏秋|金秋|秋色|银杏|枫叶/.test(blob)) out.add("autumn");
  if (/冰雪|滑雪|温泉|暖冬|冰瀑/.test(blob)) out.add("winter");
  if (/踏青|春柳|春花|樱花|油菜花|春游|初春/.test(blob)) out.add("spring");
  // 月份数字：截取所有 "N月" 与 "N-N月" 区间
  const months = new Set();
  let m;
  const reMonth = /(\d{1,2})\s*[-~—到至]\s*(\d{1,2})\s*月|(\d{1,2})\s*月/g;
  while ((m = reMonth.exec(blob))) {
    if (m[2]) { const a = +m[1], b = +m[2]; for (let x = a; x <= b; x++) months.add(x); }
    else if (m[3]) months.add(+m[3]);
  }
  months.forEach(function (mo) {
    if (mo >= 3 && mo <= 5) out.add("spring");
    else if (mo >= 6 && mo <= 8) out.add("summer");
    else if (mo >= 9 && mo <= 11) out.add("autumn");
    else if (mo === 12 || mo <= 2) out.add("winter");
  });
  return Array.from(out);
}

module.exports = {
  DIM_LABELS: DIM_LABELS,
  TAGS: TAGS,
  TAG_BY_KEY: TAG_BY_KEY,
  reOf: reOf,
  parseQueryTags: parseQueryTags,
  matchTagsInText: matchTagsInText,
  deriveSeasons: deriveSeasons,
  tagSpot: tagSpot,
};
