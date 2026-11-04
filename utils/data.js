// v1.20 数据拆分包：data-packed.js（约 1.4MB base64）已移入 subdata/data/，
// 主包不再携带这份大头。微信端用 require.async 异步加载；Node（allcheck/工具链）同步读分包文件。
// 页面侧统一在 travel.js 的 ready() 之后使用数据；planner.js 因模块顶层解构 data.js，
// 由 travel.js 惰性 require（数据就绪后才加载），避免拿到空数据。
const pako = require("./pako-inflate.js");
// v1.19.171 扩展酒店住宿区域：额外的「城市级住哪儿区域指引」静态数据，加载时并入 CITIES[].areas。
// 与 data.js 同目录（utils/），不被 build-min 压缩；try/catch 保证缺失时不影响数据加载。
let HA = {};
try { HA = require("./hotel-areas.js"); } catch (e) { HA = {}; }

const DATA = {
  CITIES: [], SPOT_COORDS: {}, CITY_COORDS: {}, PROVINCE_CITIES: {}, PROVINCES: [],
  CITY2PROV: {}, SPOT_INFO: {}, FOOD_SPOTS: {}, GENERIC_SPOT_WORDS: [], BUDGETS: {}, BUDGET_STYLE: {},
  BIG_SPOT_DAYS: [], SUNRISE_SPOTS: [], PREP_CHECKLIST: []
};
DATA.__dataReady = false;

// v1.19.166 坐标修正覆盖层：修正若干被误地理编码的景点。
// 这些景点原坐标落在别的城市/省份，距所属城市中心 98~1116km，明显错误（地图标点错位、行程距离计算失真）。
// 覆盖在 applyPacked 之后、对所有消费方（行程生成/地图/景点检索）统一生效；不改动打包基数据，零重打包风险。
// 坐标均为各景点所属城市内的合理落点（SAR/小城 ±1km 级、漠河远郊也落在正确县域），远优于原 100~1100km 错位。
const SPOT_COORD_FIX = {
  "澳门": {
    "郑家大屋": [22.1906, 113.5385],   // 亚婆井前地·岗顶，原 [31.413,109.071] 落到湖北/重庆
    "北帝庙": [22.1975, 113.5410],     // 澳门半岛（大三巴/大炮台一带），原 [23.891,112.876] 落到广东清远
    "海事博物馆": [22.1819, 113.5319]  // 妈阁庙前地，原 [23.079,113.505] 落到广东广州
  },
  "香港": {
    "大澳渔村": [22.2526, 113.8636],   // 大屿山·大澳，原坐标落到广东阳江（209km）
    "大馆": [22.2820, 114.1540]        // 中环·大馆（荷李活道），原坐标落到广东清远（170km）
  },
  "漠河": {
    "黑龙江源头": [53.480, 121.480],    // 漠河西北·龙江第一湾/源头，原 [45.742,126.662] 落到牡丹江/延边（857km）
    "北极林海观音": [53.294, 122.204]  // 漠河观音山一带，原 [48.446,129.441] 落到佳木斯（698km）
  }
};
function applyCoordFix() {
  for (const city in SPOT_COORD_FIX) {
    const list = DATA.SPOT_COORDS[city];
    if (!Array.isArray(list)) continue;
    const m = SPOT_COORD_FIX[city];
    for (const row of list) {
      if (Array.isArray(row) && m[row[0]]) { row[1] = m[row[0]][0]; row[2] = m[row[0]][1]; }
    }
  }
}

// v1.19.172 模糊 POI 坐标补录：纳林湖 / 网师园 / 九凌湖 / 新寨嘉那嘛呢石经城 此前因 geocode 30001（POI 非地址）
// 整体跳过、长期挂在「已知未解」。现以公开权威坐标（腾讯/高德/维基/政府文档交叉确认）经城市归属校验后补入，
// 使地图/检索/行程引用时落到真实位置而非城市中心。仅补坐标（不编造景点文案、不擅自塞进行程库），
// 符合本项目「只加经核实数据、勿臆造」铁律。
// 广化寺（莆田南山广化寺 / 北京什刹海广化寺重名）、石龙山（多地重名）原按「勿臆造」跳过；
// v1.19.184 经用户授权「按最优解」定归属——广化寺→福建莆田（南山广化寺，全国重点汉传寺院、福建四大丛林之一，
// 旅游 POI 权重远高于北京城区小众寺），石龙山→黑龙江七台河（石龙山国家森林公园，国家级、AA 级，是最具权威命名的「石龙山」景区）。
// 坐标均经腾讯/维基/政府文档交叉核验，距所属城心 <300km 且省份一致，通过坐标自检规则；若用户后续指定其他城市可改此归属。
const SPOT_COORD_ADD = [
  ["巴彦淖尔", "纳林湖", 40.532227, 106.64907],
  ["苏州", "网师园", 31.298021, 120.633654],
  ["贵港", "九凌湖", 22.966533, 109.474596],
  ["玉树", "新寨嘉那嘛呢石经城", 33.018206, 97.059472],
  ["莆田", "广化寺", 25.425115, 118.98896],            // v1.19.184 莆田南山广化寺（腾讯 25.425115,118.98896 / 维基 25.42833,118.98472 一致）
  ["七台河", "石龙山国家森林公园", 45.648653, 131.246159] // v1.19.184 黑龙江七台河石龙山国家森林公园（腾讯 45.648653,131.246159）
];
let _spotCoordAdded = 0;
function applySpotCoordAdd() {
  for (const [city, name, lat, lon] of SPOT_COORD_ADD) {
    if (!DATA.SPOT_COORDS[city]) DATA.SPOT_COORDS[city] = [];
    const arr = DATA.SPOT_COORDS[city];
    if (arr.some(r => r[0] === name)) continue; // 幂等：已存在不重复加（多分块重复调用安全）
    arr.push([name, lat, lon]);
    _spotCoordAdded++;
  }
  if (_spotCoordAdded) console.warn("[data] 模糊 POI 坐标补录 " + _spotCoordAdded + " 个");
}

// v1.19.174 稀疏县景点补全：给数据稀疏、行程易出空天的旅游小城追加经公开权威核实的真实景点坐标。
// 目的：直接消解压测红项「黄龙 D4 空天」（黄龙 6→9 个真实景点，提升可填天数与行程密度），并整体提升
// 酉阳/奉节/武隆/荔波/兴义/那拉提/茫崖/抚远等知名稀疏县的地图标点与行程素材。
// 合规：仅补经核实坐标（WebSearch 交叉核验腾讯地图/维基/政府文档），不编造景点文案、不塞臆造数据；
// 所有点距所属城心均 <300km 且落点省份一致，通过 v1.19.156 坐标自检规则。幂等：按景点名去重。
const SPOT_ENRICH = [
  ["黄龙", "牟尼沟", 32.5925, 103.5563],
  ["黄龙", "扎嘎瀑布", 32.5618, 103.5025],
  ["黄龙", "松潘古城", 32.6375, 103.5983],
  ["酉阳", "酉阳桃花源", 28.8520, 108.7529],
  ["奉节", "白帝城", 31.0346, 109.5897],
  ["武隆", "天生三桥", 29.4328, 107.8036],
  ["武隆", "仙女山", 29.4983, 107.7408],
  ["荔波", "小七孔", 25.2670, 107.6896],
  ["兴义", "万峰林", 25.0099, 104.9249],
  ["那拉提", "那拉提草原", 43.2401, 84.0234],
  ["茫崖", "茫崖翡翠湖", 38.0793, 90.9967],
  ["抚远", "东极广场", 48.4611, 135.8722]
];
let _spotEnriched = 0;
function applySpotEnrich() {
  for (const [city, name, lat, lon] of SPOT_ENRICH) {
    if (!DATA.SPOT_COORDS[city]) DATA.SPOT_COORDS[city] = [];
    const arr = DATA.SPOT_COORDS[city];
    if (arr.some(r => r[0] === name)) continue; // 幂等：已存在不重复追加（多分块重复调用安全）
    arr.push([name, lat, lon]);
    _spotEnriched++;
  }
  if (_spotEnriched) console.warn("[data] 稀疏县景点补全 " + _spotEnriched + " 个");
}

// v1.19.182 美食富信息扩城：把「非试点 20 城」的热门旅游城，补上经公开资料核验的
// 真实老字号 / 招牌菜 / 参考价 / 编辑点评（menu/rep/note），补齐富信息覆盖空白。
// 合规：仅补经核验数据、不臆造；menu 价写「参考价」、rep 取自白名单、note 为编辑点评。
// 增量合并：按「城市 + 店名」定位 —— 若 base 已存在同名店则补 menu/rep/note（不覆盖已有），否则新增，幂等安全。
// 数据来源（公开探店 / 老字号资料交叉核验）：天津（登瀛楼/耳朵眼/桂发祥/红旗饭庄）、
// 哈尔滨（老厨家/马迭尔/秋林里道斯/华梅）、兰州（马子禄/吾穆勒/磨沟沿）。后续城按同管线续补。
const FOOD_ENRICH = [
  ["天津", "登瀛楼饭庄", [["罾蹦鲤鱼", 68], ["八珍豆腐", 48], ["老爆三", 42]], "老字号", "1913 年创立的津鲁菜代表，罾蹦鲤鱼带鳞炸透浇糖醋汁，外酥里嫩"],
  ["天津", "耳朵眼炸糕", [["炸糕", 3]], "老字号", "津门三绝之一，糯米皮现炸外酥里糯，豆沙绵密"],
  ["天津", "桂发祥十八街麻花", [["夹馅麻花", 25]], "老字号", "1927 年创号，国家级非遗技艺，伴手礼首选"],
  ["天津", "红旗饭庄", [["罾蹦鲤鱼", 68], ["独面筋", 42]], "老字号", "1925 年开业，津菜活化石，八大碗非遗传承基地"],
  ["哈尔滨", "老厨家", [["锅包肉", 48], ["得莫利炖鱼", 85]], "老字号", "1910 年创立，锅包肉发源地，第四代传人主理"],
  ["哈尔滨", "马迭尔冷饮厅", [["原味冰棍", 5]], "游客打卡", "1906 年传承，中央大街地标冷饮，纯奶香无添加"],
  ["哈尔滨", "秋林里道斯", [["红肠", 30]], "老字号", "俄式熏肠本土代表，果木熏烤蒜香浓郁，可真空作伴手礼"],
  ["哈尔滨", "华梅西餐厅", [["罐焖牛肉", 68], ["红菜汤", 38]], "老字号", "1925 年俄式西餐老字号，罐焖牛肉酥皮封口"],
  ["兰州", "马子禄牛肉面", [["牛肉面(二细)", 12]], "老字号", "1915 年百年中华老字号，游客求稳首选，一清二白三红四绿五黄"],
  ["兰州", "吾穆勒蓬灰牛肉面", [["厚切牛肉面", 18]], "本地人常去", "蓬灰和面更筋道，厚切卤牛肉比硬币还厚"],
  ["兰州", "磨沟沿老字号", [["牛肉面(二细)", 16]], "本地人常去", "凌晨 4 点牛骨羊脊骨鸡架三吊 18 小时，汤清亮如琥珀"]
];
const FOOD_REP_OK = new Set(["老字号", "本地人常去", "游客打卡", "市井烟火", "宴请名店"]);
let _foodEnriched = 0;
function applyFoodEnrich() {
  for (const [city, name, menu, rep, note] of FOOD_ENRICH) {
    if (!DATA.FOOD_SPOTS[city]) DATA.FOOD_SPOTS[city] = [];
    const arr = DATA.FOOD_SPOTS[city];
    let shop = arr.find(s => s && s.shop === name);
    if (!shop) { shop = { shop: name }; arr.push(shop); _foodEnriched++; }
    if (!Array.isArray(shop.menu) || !shop.menu.length) {
      shop.menu = (menu || []).map(m => ({ n: m[0], p: typeof m[1] === "number" ? "¥" + m[1] : m[1] }));
    }
    if (!shop.rep) shop.rep = rep;
    if (!shop.note) shop.note = note;
  }
  if (_foodEnriched) console.warn("[data] 美食富信息扩城 " + _foodEnriched + " 家（增量合并）");
}

// v1.19.182 团队合并入口：由 tools/_merge-team-enrich.mjs 把 7 人分区采集结果注入 TEAM_FOOD_ENRICH。
// 与 applyFoodEnrich 同口径：按「城市 + 店名」定位，缺失字段才补，幂等安全。
// >>>TEAM_FOOD_START>>>
const TEAM_FOOD_ENRICH = {"杭州":[{"shop":"杭州酒家","rep":"老字号","menu":[{"n":"西湖醋鱼","p":"参考¥68"},{"n":"龙井虾仁","p":"参考¥58"}],"note":"杭州老牌杭帮菜馆，西湖醋鱼、龙井虾仁是招牌，本地人宴客常选。"},{"shop":"楼外楼","rep":"老字号","menu":[{"n":"西湖醋鱼","p":"参考¥88"},{"n":"宋嫂鱼羹","p":"参考¥48"}],"note":"西湖孤山百年老字号，醋鱼名气大、游客多；价位偏高但地标意义强。"},{"shop":"知味观(湖滨店)","rep":"老字号","menu":[{"n":"东坡肉","p":"参考¥28"},{"n":"片儿川","p":"参考¥22"}],"note":"杭州老字号点心与面点，东坡肉、片儿川经典，湖滨位置方便。"},{"shop":"奎元馆","rep":"老字号","menu":[{"n":"虾爆鳝面","p":"参考¥38"}],"note":"杭州百年面馆，虾爆鳝面、片儿川都是老底子味道。"},{"shop":"新丰小吃","rep":"市井烟火","menu":[{"n":"虾肉小笼","p":"参考¥15"},{"n":"牛肉粉丝","p":"参考¥8"}],"note":"杭州平民小吃连锁，虾肉小笼、牛肉粉丝性价比高，市井烟火气足。"}],"苏州":[{"shop":"松鹤楼","rep":"老字号","menu":[{"n":"松鼠桂鱼","p":"参考¥258"},{"n":"响油鳝糊","p":"参考¥68"}],"note":"苏州老字号苏帮菜，松鼠桂鱼代表店之一，观前街地标。"},{"shop":"得月楼","rep":"老字号","menu":[{"n":"清溜手剥虾仁","p":"参考¥88"},{"n":"松鼠桂鱼","p":"参考¥168"}],"note":"苏州老字号，讲究时令，清溜手剥虾仁、松鼠桂鱼都地道。"},{"shop":"黄天源","rep":"老字号","menu":[{"n":"定胜糕","p":"参考¥15"}],"note":"苏州百年糕团老店，定胜糕、猪油年糕应季而售。"},{"shop":"朱鸿兴","rep":"本地人常去","menu":[{"n":"焖肉面","p":"参考¥22"}],"note":"苏州面馆老字号，焖肉面是头汤面代表，本地人常去。"}],"南京":[{"shop":"鸡鸣汤包(老门东店)","rep":"老字号","menu":[{"n":"菊叶汤包","p":"参考¥28"}],"note":"南京老门东汤包名店，菊叶汤包清润，游客与本地人都排。"},{"shop":"绿柳居","rep":"老字号","menu":[{"n":"素菜包","p":"参考¥12"},{"n":"素烧鹅","p":"参考¥18"}],"note":"南京百年素菜老字号，素菜包、素烧鹅口碑稳。"},{"shop":"韩复兴","rep":"老字号","menu":[{"n":"桂花盐水鸭","p":"参考¥38/盒"}],"note":"南京盐水鸭老字号，桂花盐水鸭咸香入味，常作伴手礼。"},{"shop":"李记清真馆","rep":"本地人常去","menu":[{"n":"牛肉锅贴","p":"参考¥14/两"}],"note":"南京打钉巷清真老店，牛肉锅贴现煎爆汁，本地人常去。"},{"shop":"莲湖糕团店","rep":"老字号","menu":[{"n":"赤豆元宵","p":"参考¥12"}],"note":"夫子庙老字号，赤豆元宵、糕团甜糯，南京人从小吃到大的味道。"}],"上海":[{"shop":"老正兴菜馆","rep":"老字号","menu":[{"n":"油爆河虾","p":"参考¥88"},{"n":"草头圈子","p":"参考¥58"}],"note":"上海本帮菜老字号，油爆河虾、草头圈子浓油赤酱地道。"},{"shop":"上海老饭店","rep":"老字号","menu":[{"n":"八宝鸭","p":"参考¥128"},{"n":"油爆河虾","p":"参考¥78"}],"note":"豫园旁本帮老店，八宝鸭、油爆河虾经典，宴客体面。"},{"shop":"南翔馒头店(豫园店)","rep":"老字号","menu":[{"n":"鲜肉小笼","p":"参考¥45"}],"note":"豫园南翔小笼地标店，鲜肉小笼皮薄汁多，游客必打卡。"},{"shop":"大壶春","rep":"老字号","menu":[{"n":"清水生煎","p":"参考¥18"}],"note":"上海生煎老字号，清水生煎底脆汁鲜，讲究老法。"},{"shop":"小杨生煎","rep":"游客打卡","menu":[{"n":"鲜肉生煎","p":"参考¥25"}],"note":"上海生煎连锁代表，鲜肉生煎个大汤多，游客打卡款。"}]};
// <<<TEAM_FOOD_END<<<
let _teamFoodAdded = 0;
function applyTeamFoodEnrich() {
  for (const city in TEAM_FOOD_ENRICH) {
    const shops = TEAM_FOOD_ENRICH[city];
    if (!Array.isArray(shops) || !shops.length) continue;
    if (!DATA.FOOD_SPOTS[city]) DATA.FOOD_SPOTS[city] = [];
    const arr = DATA.FOOD_SPOTS[city];
    for (const sh of shops) {
      if (!sh || !sh.shop) continue;
      let shop = arr.find(s => s && s.shop === sh.shop);
      if (!shop) { shop = { shop: sh.shop }; arr.push(shop); _teamFoodAdded++; }
      if (sh.lat != null) shop.lat = sh.lat;
      if (sh.lon != null) shop.lon = sh.lon;
      if (sh.price) shop.price = sh.price;
      if (!Array.isArray(shop.menu) || !shop.menu.length) {
        shop.menu = (sh.menu || []).map(m => ({ n: m.n, p: (typeof m.p === "number" ? "¥" + m.p : m.p) }));
      }
      if (!shop.rep) shop.rep = sh.rep;
      if (!shop.note) shop.note = sh.note;
    }
  }
  if (_teamFoodAdded) console.warn("[data] 团队美食合并 " + _teamFoodAdded + " 家（增量合并）");
}

// v1.19.167 景点去重：同城 SPOT_COORDS 内出现完全同名的重复副本（仙桃/天门/潜江 等，
// 单城同一景点被录入 41 次、坐标完全一致），导致地图/行程中同一景点重复出现 40+ 次。
// 加载时按「城市 + 景点名 + 坐标」去重，仅移除逐字节相同的副本、保留首个，零信息损失。
let _dedupRemoved = 0;
function dedupeSpots() {
  for (const city in DATA.SPOT_COORDS) {
    const list = DATA.SPOT_COORDS[city];
    if (!Array.isArray(list)) continue;
    const seen = Object.create(null);
    const out = [];
    for (const row of list) {
      if (!Array.isArray(row)) { out.push(row); continue; }
      const key = JSON.stringify([row[0], row[1], row[2]]);
      if (seen[key]) { _dedupRemoved++; continue; }
      seen[key] = 1; out.push(row);
    }
    DATA.SPOT_COORDS[city] = out;
  }
  if (_dedupRemoved) console.warn("[data] 同城重复景点去重移除 " + _dedupRemoved + " 条副本");
}

// v1.19.169 气候派生补齐 best 季节字段：打包基数据里部分城市缺 best（约 331 城），
// 导致「适宜时节 / 最佳季 / 今日正当时」对这批城只能回退到泛化的「四季皆宜」，推荐信息稀薄。
// 按气候带给出稳定的季节描述（离线、确定性、可复现），调高推荐信息密度，不触碰打包基数据（零重打包风险）。
// 月份写法沿用 bestMonths 解析约定（"5-10月" 区间、"11-次年4月" 跨年），让「今日正当时」能正确命中。
const BEST_BY_CLIMATE = {
  plateau: "5-10月最佳，夏季凉爽宜避暑",
  temperate: "4-5月与9-10月，春秋气候宜人",
  cold: "冬季冰雪与夏季避暑，12-2月、6-8月",
  dry: "春秋最佳，4-5月、9-10月避开酷暑风沙",
  hot: "春、秋最舒适，3-5月、9-11月避开盛夏",
  tropical: "11-次年4月旱季最佳，避开雨季",
  subtropical: "3-5月与10-11月，春秋舒适",
  alpine: "6-9月宜游，冬季雪景壮美",
  temperate_continental: "6-9月温暖少风，最佳出行期"
};
let _bestFilled = 0;
function fillBestSeason() {
  for (const c of DATA.CITIES) {
    if (!c || c.best) continue;
    const v = BEST_BY_CLIMATE[c.climate] || BEST_BY_CLIMATE["temperate"];
    if (v) { c.best = v; _bestFilled++; }
  }
  if (_bestFilled) console.warn("[data] 气候派生补齐 best 季节字段 " + _bestFilled + " 城");
}

// v1.19.171 扩展酒店住宿区域：把 utils/hotel-areas.js 的 HOTEL_AREAS_EXTRA（约 60 个热门旅游城市，
// 每城 3-4 个「商圈/地标/交通枢纽」住哪儿区域指引，含参考价区间）按城市名并入 CITIES[].areas，
// 既给 46 城精选区「追加更多选择」，又把覆盖扩到更多旅游城市（原本走通用三片区）。
// 合规：区域级指引，不臆造酒店门牌号；价格一律「参考价区间」，非实时报价、非交易。
// 幂等：按片区名去重，多数据分块重复调用 applyPacked 也不会重复追加。
let _hotelAreasMerged = 0;
function applyHotelAreasExtra() {
  const EX = (HA && HA.HOTEL_AREAS_EXTRA) || {};
  const keys = Object.keys(EX);
  if (!keys.length) return;
  for (const c of DATA.CITIES) {
    const ex = EX[c.name];
    if (!ex || !Array.isArray(ex) || !ex.length) continue;
    if (!Array.isArray(c.areas)) c.areas = [];
    const have = new Set(c.areas.map(a => (a && a.name) || ""));
    for (const a of ex) {
      if (a && a.name && !have.has(a.name)) {
        c.areas.push({ name: a.name, note: a.note || "", price: a.price || "" });
        have.add(a.name); _hotelAreasMerged++;
      }
    }
  }
  if (_hotelAreasMerged) console.warn("[data] 扩展酒店住宿区域并入 " + _hotelAreasMerged + " 条");
}

// v1.19.183 逐酒店 + 房型扩展：把 utils/hotel-areas.js 的 HOTEL_LIST_EXTRA（公开常识级具名真酒店种子）
// 与 TEAM_HOTEL_LIST_ENRICH（7 人分区采集，含房型）按城市名并入 CITIES[].hotels，
// 闭环原始需求「酒店的位置、价格、所开房型」。
// 合规：具名真实、房价写参考价区间、房型为通用类别；坐标真实优先，空则运行时回退城市中心。
// 幂等：按酒店名去重，多数据分块重复调用 applyPacked 也不重复追加。
let _hotelListMerged = 0;
function findCityByName(cn) {
  let c = DATA.CITIES.find(x => x && x.name === cn);
  if (!c && typeof cn === "string" && cn.endsWith("市")) c = DATA.CITIES.find(x => x && x.name === cn.slice(0, -1));
  return c;
}
function applyHotelListExtra() {
  const SRC = (HA && HA.HOTEL_LIST_EXTRA) || {};
  const TEAM = (HA && HA.TEAM_HOTEL_LIST_ENRICH) || {};
  const mergeFrom = (map) => {
    if (!map || typeof map !== "object") return;
    for (const cn in map) {
      const arr = map[cn];
      if (!Array.isArray(arr) || !arr.length) continue;
      const c = findCityByName(cn);
      if (!c) continue;
      if (!Array.isArray(c.hotelList)) c.hotelList = [];
      const have = new Set(c.hotelList.map(h => (h && h.name) || ""));
      for (const h of arr) {
        if (!h || !h.name || have.has(h.name)) continue;
        c.hotelList.push({
          name: String(h.name),
          addr: h.addr || "",
          price: h.price || "",
          rooms: Array.isArray(h.rooms) ? h.rooms.map(r => ({ type: String(r && r.type || ""), price: (r && r.price) || "" })).filter(r => r.type) : [],
          lat: (h.lat != null && h.lat !== "") ? +h.lat : null,
          lon: (h.lon != null && h.lon !== "") ? +h.lon : null,
          note: h.note || "",
          collected: h.collected || ""
        });
        have.add(h.name); _hotelListMerged++;
      }
    }
  };
  mergeFrom(SRC);
  mergeFrom(TEAM);
  if (_hotelListMerged) console.warn("[data] 逐酒店+房型并入 " + _hotelListMerged + " 家");
}

function b64ToBytes(b64) {
  try {
    if (typeof wx !== "undefined" && wx.base64ToArrayBuffer) {
      return new Uint8Array(wx.base64ToArrayBuffer(b64));
    }
  } catch (e) {}
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(b64 || "").replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor(s.length * 3 / 4) + 2);
  let p = 0;
  for (let i = 0; i < s.length; i += 4) {
    const rem = s.length - i;
    const a = chars.indexOf(s[i]);
    const b = rem > 1 ? chars.indexOf(s[i + 1]) : 0;
    const c = rem > 2 ? chars.indexOf(s[i + 2]) : -1;
    const d = rem > 3 ? chars.indexOf(s[i + 3]) : -1;
    const n = ((a & 63) << 18) | ((b & 63) << 12) | ((c < 0 ? 0 : c & 63) << 6) | (d < 0 ? 0 : d & 63);
    out[p++] = (n >> 16) & 255;
    if (c >= 0) out[p++] = (n >> 8) & 255;
    if (d >= 0) out[p++] = n & 255;
  }
  return out.subarray(0, p);
}
function utf8Decode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 0x80) out.push(b1);
    else if (b1 < 0xe0) out.push(((b1 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b1 < 0xf0) out.push(((b1 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b1 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      out.push(0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff));
    }
  }
  let s = "";
  const CH = 8192;
  for (let k = 0; k < out.length; k += CH) s += String.fromCharCode.apply(null, out.slice(k, k + CH));
  return s;
}

// v1.19.173 坐标完整性自检（只读、零重打包风险）：用 v1.19.156 已验证规则扫描全量景点坐标，
// 凡「距所属城心 >300km 且落点省份≠城市所在省，或距城心 >1200km」者，视为错位并 console.warn。
// 仅告警、不做任何改写；目的是让未来的坐标回归（重新打包误伤、数据更新引入错点、合并脚本回潮）
// 在加载期即可暴露，而不是等用户线上报「地图标点跑到别的省」才后知后觉。
// 无违规时不输出任何内容、不增体积、不拖性能：热路径每点仅一次距离计算，
// 仅 300~1200km 的少数远景点才反查落点省份（绝大多数景点 dOwn≤300 直接短路退出）。
function _hav(la1, lo1, la2, lo2) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(la2 - la1), dLon = toR(lo2 - lo1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
let _coordWarn = 0;
function checkCoordIntegrity() {
  const cc = DATA.CITY_COORDS || {};
  const c2p = DATA.CITY2PROV || {};
  // 预建「所有城市中心」索引，用于反查落点省份（仅在需要时才扫描）
  const centers = [];
  for (const c in cc) {
    const v = cc[c];
    if (Array.isArray(v) && v.length >= 2) centers.push([v[0], v[1], c2p[c]]);
  }
  let bad = 0;
  for (const city in DATA.SPOT_COORDS) {
    const cc0 = cc[city];
    if (!Array.isArray(cc0) || cc0.length < 2) continue;
    const cityProv = c2p[city];
    const list = DATA.SPOT_COORDS[city];
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const lat = +row[1], lon = +row[2];
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const dOwn = _hav(lat, lon, cc0[0], cc0[1]);
      if (dOwn > 1200) { bad++; if (console && console.warn) console.warn("[data] 坐标疑似越界: " + city + "·" + row[0] + " 距城心" + Math.round(dOwn) + "km(>1200)"); continue; }
      if (dOwn <= 300) continue; // 热路径：绝大多数景点在此退出，无需反查省份
      // 仅 300~1200km 的少数远景点才反查落点省份
      let prov = null, bd = 1e9;
      for (const [la, lo, p] of centers) { const d = _hav(lat, lon, la, lo); if (d < bd) { bd = d; prov = p; } }
      if (prov && prov !== cityProv) { bad++; if (console && console.warn) console.warn("[data] 坐标疑似越界: " + city + "·" + row[0] + " 距城心" + Math.round(dOwn) + "km 落点省=" + prov + " 城市省=" + cityProv); }
    }
  }
  _coordWarn += bad;
  if (bad) console.warn("[data] 坐标完整性自检: 发现 " + bad + " 个疑似越界坐标，请核查 SPOT_COORD_FIX / pack-data 规则");
  return bad;
}

// v1.20.x：支持「多数据分包」——把城市数据切成多个 chunk 文件（subdata/subdata2…），
// 各自独立 2MB 上限、懒加载。合并语义：对象键按城市名并集、数组去重拼接、其余覆盖。
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function mergeInto(target, src) {
  for (const k of Object.keys(src)) {
    const sv = src[k], tv = target[k];
    if (isObj(sv) && isObj(tv)) mergeInto(tv, sv);
    else if (Array.isArray(sv) && Array.isArray(tv)) {
      const seen = new Set(tv.map(x => JSON.stringify(x)));
      for (const it of sv) { const j = JSON.stringify(it); if (!seen.has(j)) { tv.push(it); seen.add(j); } }
    } else target[k] = sv;
  }
  return target;
}
// v1.20.x 键别名还原：打包时 tools/pack-data.mjs 把高频 schema 键别名成 "@X"（如 name→@A），
// 并在「每个」数据分块内附带正向映射 __A。加载时据此把短键还原为长键，运行时(planner.js/travel.js)
// 完全无感、无需改动。每块独立还原，故多分包也安全。
function _invertKeyMap(map) { const inv = {}; for (const k in map) inv[map[k]] = k; return inv; }
function _expandAliasKeys(o, inv) {
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) _expandAliasKeys(o[i], inv); return; }
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      if (k === "__A") continue;
      const v = o[k];
      if (Object.prototype.hasOwnProperty.call(inv, k)) { const nk = inv[k]; o[nk] = v; delete o[k]; _expandAliasKeys(v, inv); }
      else _expandAliasKeys(v, inv);
    }
  }
}
function applyPacked(packed) {
  const parsed = JSON.parse(utf8Decode(pako.inflate(b64ToBytes(packed))));
  if (parsed && parsed.__A) {
    _expandAliasKeys(parsed, _invertKeyMap(parsed.__A));
    delete parsed.__A;
  }
  mergeInto(DATA, parsed);
  applyCoordFix();
  applySpotCoordAdd();
  applySpotEnrich(); // v1.19.174 稀疏县景点补全
  applyFoodEnrich(); // v1.19.182 美食富信息扩城（加载期增量合并，不进打包基数据）
  applyTeamFoodEnrich(); // v1.19.182 团队美食合并（7 人分区采集，加载期增量合并）
  dedupeSpots();
  fillBestSeason();
  applyHotelAreasExtra();
  applyHotelListExtra(); // v1.19.183 逐酒店 + 房型并入 CITIES[].hotels
  checkCoordIntegrity(); // v1.19.173 只读自检：加载期暴露坐标回归，零改写零重打包风险
  DATA.__dataReady = true;
  return DATA;
}

// 数据分块路径解析（v1.20.x 多数据分包）：
//  - 测试态：DATA_CHUNKS 环境变量注入逗号分隔的自定义多块路径（_test-multichunk 用）
//  - 微信生产：读 subdata/data/_manifest.js（由 tools/pack-data.mjs 生成，列出全部数据分块相对路径）
//  - 兜底：单个默认分块
function resolveChunkPaths() {
  if (typeof process !== "undefined" && process.env && process.env.DATA_CHUNKS) {
    return process.env.DATA_CHUNKS.split(",").map(s => s.trim()).filter(Boolean);
  }
  try {
    const manifest = require("../subdata/data/_manifest.js");
    if (Array.isArray(manifest) && manifest.length) return manifest;
  } catch (e) {}
  return ["../subdata/data/data-packed.js"];
}
const CHUNK_PATHS = resolveChunkPaths();

// ⚠️✖️ 微信「分包异步化」硬约束（= 线上首页白屏 / 「无法加载完整数据内容」的真根因）：
//   require.async() 的实参必须是「唯一的静态字符串字面量」，**不能是变量**！
//   传变量时微信无法在编译/运行期解析目标分包 → 数据块永远不加载 →
//   首页拿不到城市数据 → 白屏（审核实测复现）。
//   故此处必须把每个数据分块的路径「逐条字面量」直接写出，禁止 for 循环拼接变量。
//   分块数变化时须同步增删下面这几条；tools/pack-data.mjs 内置断言会在
//   「产物分块」与「此处字面量」不一致时直接 fail-fast，防止再次退化成变量。
// 限时推进：分包下载卡住时不把 ready() 拖死（到点先返回；晚到的分块仍会自行 applyPacked）
function _sleep(ms) { return new Promise((r) => { try { setTimeout(r, ms); } catch (e) { r(); } }); }

let _ready = null;
let _loadErr = false; // v1.19.60：上次加载有失败分块 → 允许再次 initData 重试（供首页「重试加载」）
function initData() {
  if (_ready && !_loadErr) return _ready;
  _ready = (async () => {
    let lastErr = null;
    if (typeof require.async === "function") {
      // 微信端：分包异步化。↓↓↓ 每条都必须是静态字面量（勿用变量）↓↓↓
      // v1.19.64：先给每条挂 applyPacked（无论多晚拿到都应用，绝不丢数据），
      // 再用 Promise.race 限时推进 —— 分包慢/卡时也不至于让 ready() 永不 resolve（黑屏）。
      const _jobs = [
        require.async("../subdata/data/data-packed.js").then((m) => { applyPacked((m && m.default) || m); }).catch((e) => { lastErr = e; })
      ];
      await Promise.race([Promise.all(_jobs), _sleep(9000)]);
    } else {
      // Node / 测试端：无 require.async，直接同步 require（可用变量；微信那条约束不适用）
      for (const p of CHUNK_PATHS) {
        try { applyPacked(require(p)); } catch (e) { lastErr = e; }
      }
    }
    _loadErr = !!lastErr;
    DATA.__dataReady = true;
    if (lastErr && typeof console !== "undefined" && console.warn) console.warn("[data] 数据分块加载失败:", lastErr && lastErr.message);
    return DATA;
  })();
  return _ready;
}
DATA.initData = initData;
DATA.checkCoordIntegrity = checkCoordIntegrity; // v1.19.173 暴露给单测：返回越界坐标数

// Node / 测试环境（没有 require.async）：模块加载即同步就绪，保证 allcheck/tools 照常同步 require
if (typeof require.async !== "function") {
  for (const p of CHUNK_PATHS) {
    try { applyPacked(require(p)); } catch (e) { /* 数据缺失时保留空兜底 */ }
  }
  DATA.__dataReady = true;
}

module.exports = DATA;
