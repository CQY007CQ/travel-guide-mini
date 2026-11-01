// 由 tools/extract-planner.mjs 自动生成：从「旅游攻略生成器.html」vm 沙箱按引用链提取，勿手改。
// ── v1.11 存储适配器（修真 bug）────────────────────────────────
// 本文件由网页版抽取而来，残留了 localStorage 调用。小程序里既没有 localStorage，
// PROFILE_KEY / WISH_KEY 在这边也根本没定义 —— 双重 ReferenceError 全被 try/catch 吞掉，
// 后果是 buildPlanDays 里这行从来没生效过：
//     if(isWished(e.name)) d -= 400;   // 想玩清单里的景点优先安排
// 也就是说：用户在「想玩」里勾过的景点，生成行程时并没有被优先排进去。
// 改为可注入适配器，小程序侧由 travel.js 注入 wx 存储实现；网页版继续用 localStorage。
const PROFILE_KEY = "tripProfileV1";
const WISH_KEY = "miniWishV1";
let _store = (typeof localStorage !== "undefined" && localStorage) || null;
function setStoreAdapter(a) {
  if (a && typeof a.getItem === "function") _store = a;
}
const _read = (k, def) => {
  try {
    if (!_store) return def;
    const raw = _store.getItem(k);
    if (raw === null || raw === undefined || raw === "") return def;
    if (typeof raw === "object") return raw;   // 适配器直接给对象
    return JSON.parse(raw);
  } catch (e) { return def; }
};

const { BIG_EXCLUDE, BIG_SPOT_DAYS, BUDGETS, BUDGET_STYLE, CAPITAL_COORDS, CITIES, CITY2PROV, CITY_COORDS, CITY_LANDMARKS, CITY_LANDMARKS_EXTRA, CITY_LANDMARKS_EXTRA2, CITY_LANDMARKS_EXTRA3, CITY_LANDMARKS_EXTRA4, CITY_LANDMARKS_EXTRA5, CITY_LANDMARKS_EXTRA6, EXTRA_SPOTS, EXTRA_SPOTS2, EXTRA_SPOTS3, EXTRA_SPOTS4, EXTRA_SPOTS5, GENERIC_SPOT_WORDS, GEN_HOTELS, HOTELS, PROVINCE_CAPITAL, PROVINCE_CITIES, PROVINCE_CITY_FOODS, PROVINCE_INFO, PROVINCE_LANDMARKS, PROVINCE_REGION, REGION_DEFAULT, PERIOD_ORDER, SPOT_CITY_FIX, SPOT_COORDS, SPOT_DETAILS, SPOT_HIDDEN, SPOT_SEP, SUNRISE_SPOTS } = require("./data.js");

// v1.19.169 收敛地球距离计算：统一走 utils/geo.js（原 haversine 实现在此，已合并）
const { haversine } = require("./geo.js");

// —— 晚间具名演出表：避免行程里出现「看一场本地演出」这类无场馆无剧目的泛安排 ——
// 每个城市给「具体场馆 + 演出」，晚上空闲时段直接落到具名条目（在哪儿看什么）。
// 自动补坐标：行程池中地理编码(WGS84→GCJ02, OSM photon)救回的知名景点 —— 让「点一下直接导航」尽量全覆盖
// 坐标补丁：对行程池中 SPOT_COORDS 未收录但真实存在的景点，补上真实坐标（photon 地理编码 WGS84→GCJ-02；个别高置信地标人工收录）。配合 getSpotCoord 回退查询，让「点一下直接导航」尽量全覆盖。
const COORD_PATCH = {
 "阿坝": [
  ["藏家乐晚餐", 33.293962, 103.867166],
  ["达古冰川", 32.232474, 102.865736],
  ["米亚罗红叶", 32.663101, 103.139127],
  ["漳扎镇逛吃", 33.293962, 103.867166],
 ],
 "澳门": [
  ["澳门塔", 22.155400, 113.537000],
  ["氹仔夜市", 22.150637, 113.562042],
 ],
 "北京": [
  ["簋街夜市", 39.941182, 116.432630],
  ["前门北京坊", 39.897955, 116.396190],
 ],
 "成都": [
  ["成都博物馆", 30.657241, 104.063625],
  ["成都大熊猫繁育研究基地", 30.740846, 104.135457],
  ["川剧变脸演出", 30.659637, 104.080431],
  ["望江楼公园", 30.629642, 104.092525],
  ["昭觉寺", 30.707959, 104.106130],
 ],
 "重庆": [
  ["重庆动物园", 29.503902, 106.506052],
  ["罗汉寺", 29.559679, 106.581530],
  ["南滨路", 29.593955, 106.585986],
 ],
 "大理": [
  ["蝴蝶泉", 25.906299, 100.095948],
  ["寂照庵", 25.643096, 100.165137],
  ["双廊观景台", 25.915180, 100.192548],
 ],
 "大连": [
  ["大连自然博物馆", 38.870294, 121.561536],
  ["东港音乐喷泉", 38.931221, 121.674887],
  ["劳动公园", 38.910373, 121.639876],
  ["莲花山观景台", 38.879658, 121.608795],
 ],
 "敦煌": [
  ["敦煌古城影视城", 40.057095, 94.519301],
  ["敦煌夜市手作", 40.139440, 94.667430],
  ["鸣沙山露营基地", 40.084359, 94.675993],
  ["雅丹魔鬼城", 40.513325, 93.239055],
  ["月牙泉小镇", 40.125231, 94.664884],
 ],
 "广州": [
  ["光孝寺", 23.129238, 113.256518],
  ["广州动物园", 23.140281, 113.305407],
  ["花城广场", 23.119926, 113.324396],
  ["长隆野生动物世界/欢乐世界", 23.002637, 113.314688],
 ],
 "贵阳": [
  ["二七路小吃街", 26.557467, 106.707315],
  ["红枫湖", 26.483176, 106.417188],
  ["黄果树瀑布", 26.002320, 105.686395],
  ["西江千户苗寨", 26.492180, 108.174467],
 ],
 "桂林": [
  ["伏波山", 25.283743, 110.303971],
  ["南溪山公园", 25.249261, 110.287090],
  ["榕杉湖", 25.274977, 110.288550],
  ["西街夜市", 24.773606, 110.492950],
  ["正阳步行街", 25.273775, 110.297457],
 ],
 "哈尔滨": [
  ["圣索菲亚大教堂", 45.770115, 126.627208],
  ["松花江冰雪嘉年华", 45.775000, 126.616000],
 ],
 "海口": [
  ["滨海公园", 20.039466, 110.322509],
  ["海瑞墓", 20.005988, 110.295576],
  ["世纪大桥夜景", 20.048805, 110.319678],
 ],
 "杭州": [
  ["良渚博物院", 30.377288, 120.027884],
  ["太子湾公园", 30.226451, 120.142432],
  ["湘湖", 30.151214, 120.234652],
 ],
 "呼和浩特": [
  ["大青山", 41.003311, 111.443387],
  ["哈素海", 40.606030, 110.969019],
  ["希拉穆仁草原", 41.404734, 111.071181],
 ],
 "黄山": [
  ["翡翠谷", 30.105524, 118.225040],
  ["潜口民宅", 29.869409, 118.293392],
 ],
 "晋中": [
  ["常家庄园", 37.544022, 112.637138],
  ["又见平遥演出", 37.200645, 112.173902],
  ["榆次老城", 37.675991, 112.750090],
 ],
 "昆明": [
  ["斗南花卉市场", 24.902583, 102.787965],
  ["海埂公园", 24.959655, 102.660488],
  ["黑龙潭公园", 25.141919, 102.750975],
 ],
 "拉萨": [
  ["龙王潭公园", 29.657676, 91.119372],
  ["仙足岛", 29.638884, 91.132471],
 ],
 "兰州": [
  ["读者大道", 36.059112, 103.853693],
  ["黄河母亲雕塑", 36.065685, 103.798639],
  ["黄河母亲雕像", 36.065685, 103.798639],
  ["仁寿山公园", 36.130275, 103.683748],
 ],
 "丽江": [
  ["东巴谷", 27.007795, 100.262599],
  ["观音峡", 26.760362, 100.268764],
  ["泸沽湖", 27.702886, 100.790904],
 ],
 "洛阳": [
  ["老君山", 33.718635, 111.649438],
  ["牡丹园赏花", 34.656735, 112.458567],
 ],
 "漠河": [
  ["北红村", 53.504207, 123.073837],
  ["滑雪/马拉爬犁", 53.482286, 122.362269],
  ["看极光", 53.482286, 122.362269],
  ["龙江第一湾", 53.482607, 123.454936],
 ],
 "南昌": [
  ["八大山人纪念馆", 28.604353, 115.916737],
  ["八一公园", 28.679505, 115.897633],
  ["海昏侯国遗址公园", 29.044479, 115.929757],
  ["南昌舰主题园", 28.720069, 115.889069],
  ["渔舟湾湿地", 28.638591, 115.836126],
 ],
 "南京": [
  ["六朝博物馆", 32.042716, 118.799468],
  ["莫愁湖公园", 32.035137, 118.761948],
  ["南京眼步行桥", 31.996238, 118.702034],
  ["燕子矶", 32.136146, 118.821952],
 ],
 "青岛": [
  ["第一海水浴场", 36.056812, 120.342328],
  ["青岛海底世界", 36.057111, 120.335896],
 ],
 "三亚": [
  ["三亚千古情", 18.289921, 109.531598],
  ["西岛", 18.234768, 109.374679],
  ["亚特兰蒂斯水世界", 18.354467, 109.745217],
 ],
 "厦门": [
  ["白鹭洲公园", 24.472844, 118.088821],
  ["胡里山炮台", 24.428904, 118.106551],
  ["华侨博物院", 24.441916, 118.090280],
 ],
 "上海": [
  ["多伦路文化名人街", 31.262479, 121.481740],
  ["南京东路步行街", 31.229568, 121.468788],
  ["上海海洋水族馆", 31.240641, 121.501724],
  ["世纪公园", 31.216644, 121.552899],
  ["朱家角古镇", 31.114207, 121.050513],
 ],
 "深圳": [
  ["大鹏所城", 22.594993, 114.512374],
  ["华强北 + 东门老街", 22.542970, 114.086808],
 ],
 "沈阳": [
  ["沈阳科学宫", 41.761351, 123.436308],
  ["沈阳植物园", 41.853740, 123.639503],
  ["五里河公园", 41.755496, 123.470256],
  ["新乐遗址", 41.847178, 123.415370],
 ],
 "石家庄": [
  ["荣国府", 38.147908, 114.579026],
  ["天桂山", 38.255687, 113.742717],
 ],
 "苏州": [
  ["诚品书店", 31.320953, 120.709765],
  ["可园", 31.295327, 120.624878],
  ["盘门景区", 31.288597, 120.616784],
  ["狮子林", 31.320964, 120.629061],
  ["苏州中心", 31.316620, 120.677026],
  ["网师园", 31.298257, 120.633985],
  ["阳澄湖", 31.380139, 120.861542],
 ],
 "台北": [
  ["龙山寺", 25.034504, 121.503841],
  ["西门红楼", 25.042000, 121.506600],
 ],
 "天津": [
  ["北宁公园", 39.169889, 117.214784],
  ["静园", 39.123264, 117.189267],
  ["天津博物馆", 39.083963, 117.209819],
  ["天津鼓楼", 39.141640, 117.181107],
 ],
 "吐鲁番": [
  ["葡萄夜市", 43.005218, 89.243989],
  ["葡萄庄园", 43.005218, 89.243989],
  ["吐峪沟", 42.918920, 89.777987],
 ],
 "乌鲁木齐": [
  ["大巴扎夜市", 43.780168, 87.618083],
  ["神木源", 43.713595, 87.588358],
  ["天山野生动物园", 43.668015, 87.785494],
  ["乌拉泊古城", 43.642125, 87.590059],
 ],
 "武汉": [
  ["光谷步行街", 30.505142, 114.403319],
  ["吉庆街宵夜", 30.585571, 114.291519],
  ["江汉关博物馆", 30.576257, 114.297504],
  ["江滩夜景", 30.615812, 114.322838],
  ["武汉美术馆", 30.584002, 114.293006],
 ],
 "西安": [
  ["大慈恩寺", 34.217834, 108.964143],
  ["大明宫遗址公园", 34.292353, 108.963220],
  ["汉城湖", 34.304823, 108.918624],
 ],
 "西宁": [
  ["茶卡盐湖", 36.699900, 99.083700],
  ["莫家街", 36.618876, 101.786006],
  ["浦宁之珠观光塔", 36.620077, 101.749395],
  ["麒麟湾公园", 36.620645, 101.769192],
 ],
 "香港": [
  ["金紫荆广场", 22.283300, 114.173000],
  ["旺角 + 庙街夜市", 22.316558, 114.174774],
  ["香港艺术馆", 22.293600, 114.170700],
  ["K11 Musea", 22.291817, 114.179511],
 ],
 "湘西": [
  ["矮寨大桥", 28.329732, 109.601309],
  ["边城茶峒", 28.515069, 109.278265],
  ["古城墙 + 东门城楼", 28.016949, 109.603678],
  ["苗寨一日游", 28.343932, 109.587039],
 ],
 "银川": [
  ["黄沙古渡", 38.565224, 106.565217],
  ["沙坡头", 37.466108, 104.999960],
 ],
 "张家界": [
  ["《天门狐仙》演出", 29.066109, 110.476368],
  ["百龙天梯", 29.348529, 110.466179],
 ],
 "长春": [
  ["桂林路美食街", 43.866689, 125.318391],
  ["莲花山", 43.917334, 125.546618],
 ],
 "长沙": [
  ["烈士公园", 28.210564, 112.999337],  ["IFS国金中心", 28.192250, 112.978645],

 ],
};

const SHOW_TIPS = {
 北京: [
  {venue:"三庆园", show:"德云社相声", tip:"晚场约 19:30，前排互动多，建议提前 3-5 天在大麦/德云社官方渠道抢票"},
  {venue:"国家大剧院", show:"歌剧或交响音乐会", tip:"按演出季排期提前 1-2 周选座，学生票可留意半价"},
  {venue:"梨园剧场", show:"京剧经典折子戏", tip:"前门老牌京剧演出，场次固定，提前订票更稳妥"}
 ],
 上海: [
  {venue:"上海大剧院", show:"音乐剧或芭蕾舞剧", tip:"人民广场老牌剧院，按当月排期提前选座订票"},
  {venue:"天蟾逸夫舞台", show:"京昆经典", tip:"福州路百年戏院，看一场原味京昆，提前查场次"},
  {venue:"豫园·海上梨园", show:"评弹/昆曲折子", tip:"空中庭院剧场，晚场氛围好，适合第一次听曲艺"}
 ],
 广州: [
  {venue:"珠江红船码头", show:"实景粤剧《船说》", tip:"登船边游珠江边看粤剧，晚场 19:30 左右，提前购票"},
  {venue:"广州大剧院", show:"歌剧/舞剧", tip:"珠江新城地标剧院，关注学生公益票"}
 ],
 深圳: [
  {venue:"滨海演艺中心", show:"开心麻花爆笑舞台剧", tip:"前海湾区新剧院，提前在大麦查当日排期订票"}
 ],
 太原: [
  {venue:"山西大剧院", show:"晋剧或交响音乐会", tip:"长风商务区地标，晋剧《打金枝》是经典，提前查场次"},
  {venue:"山西会馆·面食博物馆", show:"面食技艺演艺", tip:"边看面艺表演边尝山西面食，晚餐+演出一站式"}
 ],
 成都: [
  {venue:"蜀风雅韵", show:"川剧变脸+吐火+手影戏", tip:"文化公园老戏台，含盖碗茶，建议订前排感受变脸扑面"},
  {venue:"芙蓉国粹·锦江剧场", show:"川剧经典", tip:"春熙路旁，折子戏+滚灯+变脸都有"}
 ],
 重庆: [
  {venue:"重庆1949大剧院", show:"大型舞台剧《重庆·1949》", tip:"磁器口旁旋转舞台剧场，声光电震撼，提前订票"},
  {venue:"重庆大剧院", show:"话剧或音乐会", tip:"江北嘴江景剧院，看完可沿江散步看夜景"}
 ],
 武汉: [
  {venue:"知音号码头", show:"长江漂移剧《知音号》", tip:"登船即入戏的沉浸式演出，晚场 19:30，建议提前 3-5 天购票"},
  {venue:"湖北剧院", show:"汉剧或楚剧", tip:"本地剧种体验，场次较少，提前在票务平台确认"}
 ],
 长沙: [
  {venue:"笑工场·湘江剧场", show:"长沙方言相声大会", tip:"大兵团队主场，爆笑解压，周末场要早抢"},
  {venue:"琴岛演艺中心", show:"歌厅文化综艺秀", tip:"长沙老牌歌厅演艺，热闹接地气"}
 ],
 西安: [
  {venue:"长安十二时辰", show:"唐风沉浸式演艺", tip:"大唐不夜城内，换装入场更有代入感，晚场人多建议错峰"},
  {venue:"易俗社文化街区", show:"秦腔夜场", tip:"百年易俗社，听一嗓子地道秦腔，街区本身也好逛"},
  {venue:"唐乐宫", show:"仿唐乐舞", tip:"含晚宴的唐代歌舞宴，适合带长辈体验"}
 ],
 杭州: [
  {venue:"岳湖水面", show:"山水实景《最忆是杭州》", tip:"G20 同款水上演出，晚场需提前购票，雨天可能取消"},
  {venue:"蝴蝶剧场", show:"小百花越剧", tip:"曙光路小百花越剧场，看一场《梁祝》式经典越剧"}
 ],
 苏州: [
  {venue:"网师园夜花园", show:"园林实景昆曲", tip:"夜游园林听昆曲，4-11 月开放，名额少需提前订"},
  {venue:"苏州文化艺术中心", show:"话剧或舞剧", tip:"金鸡湖畔剧院，可搭配湖边夜景"}
 ],
 南京: [
  {venue:"金陵戏坊", show:"昆曲或南京白局", tip:"夫子庙旁小剧场，边听曲边逛秦淮夜景"},
  {venue:"江苏大剧院", show:"歌剧或舞剧", tip:"河西新地标，关注公益票与打折场"}
 ],
 天津: [
  {venue:"名流茶馆", show:"津味相声大会", tip:"古文化街老茶馆，天津相声窝子，现场互动一绝"},
  {venue:"谦祥益文苑", show:"津味相声", tip:"估衣街百年绸缎庄改造的相声园子"}
 ],
 兰州: [
  {venue:"黄河剧院", show:"经典舞剧《丝路花雨》", tip:"敦煌题材经典舞剧，提前查驻演场次"}
 ],
 昆明: [
  {venue:"云南艺术剧院", show:"原生态歌舞《云南映象》", tip:"杨丽萍作品，看场次安排提前购票"}
 ],
 丽江: [
  {venue:"丽江千古情景区", show:"大型歌舞《丽江千古情》", tip:"含园区游览，晚场演出更震撼"},
  {venue:"丽水金沙剧场", show:"少数民族风情歌舞《丽水金沙》", tip:"市区内，纳西风情集中呈现"}
 ],
 桂林: [
  {venue:"阳朔书童山码头", show:"山水实景《印象·刘三姐》", tip:"张艺谋漓江山水实景，晚场天黑后开演，坐后排视野更好"}
 ],
 阳朔: [
  {venue:"书童山码头", show:"山水实景《印象·刘三姐》", tip:"张艺谋漓江实景演出，晚场开演，提前 1-2 天订票"}
 ],
 平遥: [
  {venue:"平遥古城西门外", show:"情境体验剧《又见平遥》", tip:"边走边看的分幕演出，动线新颖，场场爆满需提前订"}
 ],
 敦煌: [
  {venue:"又见敦煌剧场", show:"大型实景《又见敦煌》", tip:"莫高窟主题行进式演出，旺季一票难求"}
 ],
 张家界: [
  {venue:"魅力湘西大剧院", show:"湘西民俗大戏《魅力湘西》", tip:"武陵源城区，赶尸/哭嫁等湘西秘俗，含户外篝火"},
  {venue:"张家界千古情", show:"大型歌舞《张家界千古情》", tip:"武陵源景区旁，山水传说演绎"}
 ],
 拉萨: [
  {venue:"次角林·慈觉林", show:"大型实景《文成公主》", tip:"以星空为幕的藏地实景剧，海拔较高注意保暖"}
 ],
 洛阳: [
  {venue:"隋唐洛阳城应天门", show:"城门实景灯光演艺", tip:"应天门 3D 灯光秀，晚场开放，登阙楼看全城夜景更佳"}
 ],
 开封: [
  {venue:"清明上河园", show:"水上实景《大宋·东京梦华》", tip:"晚间单独售票，宋词吟唱+水上演出，配合白天游园安排"}
 ],
 郑州: [
  {venue:"只有河南·戏剧幻城", show:"沉浸式戏剧群", tip:"中牟超大剧场群，留大半天到一晚，21 个剧场任选"}
 ],
 扬州: [
  {venue:"瘦西湖", show:"夜游实景《春江花月夜》", tip:"瘦西湖夜间演出，白天游湖晚上看戏，一条龙"}
 ],
 凤凰: [
  {venue:"凤凰森林实景剧场", show:"实景剧《边城》", tip:"翠翠的故事在山水间上演，晚场记得带外套"}
 ],
 武夷山: [
  {venue:"武夷茶博园", show:"山水实景《印象大红袍》", tip:"张艺谋印象系列，旋转观众席看茶山灯火"}
 ]
};
function showListOf(cityName){
 return SHOW_TIPS[cityName] || SHOW_TIPS[String(cityName||"").replace(/市$/,"")] || null;
}

function buildPlanDays(city, days, depart, budgetKey, opts){
 // opts: {lastMode:"return"|"transfer", nextCity:"", seg:0, style:"balance"|"speed"|"leisure", pickSpots, stayMountain, travelMode}
 // v1.11：脏数据守卫（fuzz 抓到 374 处 null.city 崩溃）→ 无效 city 直接返回空行程，
 //       由上层 buildPlan 自行抛「不支持的城市」，避免双重报错 / 页面白屏。
 if (!city || typeof city !== "object" || !Array.isArray(city.experiences)) return [];
 // v1.15：非法出发日期守卫（"9999-99-99"/"2026-02-30" 会滚成 NaN 或静默跨月）→ 空行程由上层报错
 const _dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(depart || "");
 const _dv = _dm ? new Date(Number(_dm[1]), Number(_dm[2]) - 1, Number(_dm[3])) : null;
 if (!_dv || isNaN(_dv.getTime()) || _dv.getFullYear() !== Number(_dm[1]) || _dv.getMonth() + 1 !== Number(_dm[2]) || _dv.getDate() !== Number(_dm[3])) return [];
 let style = (opts && opts.style) || "balance";
 const travelMode = (opts && opts.travelMode) || "";
 // 出行模式默认节奏：亲子/带老人 → 休闲慢节奏
 if(travelMode && style === "balance" && /family|elder/.test(travelMode)) style = "leisure";
 // 出行模式景点偏好权重（就近选择时加减分）
 const modeEff = name => {
  let w = 0;
  if(travelMode === "family"){
   if(/乐园|动物园|海洋|科技馆|水族馆|公园|博物馆|恐龙|植物园/.test(name)) w -= 300;
   if(/山|峰|峡谷|徒步|栈道|长城|陵/.test(name)) w += 150;
  } else if(travelMode === "elder"){
   if(spotEffort(name) === 2) w += 500;
   if(/园林|公园|博物馆|湖|古镇|街区|寺庙|广场/.test(name)) w -= 250;
  } else if(travelMode === "couple"){
   if(/夜|演出|秀|湖|江|海|海滩|古镇|街|塔|观景台|日落|夜景|美术馆/.test(name)) w -= 200;
   if(/徒步|栈道|爬山|峰|峡谷/.test(name)) w += 100;
  }
  return w;
 };
 // v1.15：攻略风格偏好——历史古迹 / 自然风光 / 默认。在 nearest 就近评分中叠加，不改变“顺路”约束。
 const bias = (opts && opts.bias) || "";
 const biasEff = name => {
  if(bias === "history"){
   if(/古迹|遗址|古城|古镇|寺|庙|祠|陵|宫|府|塔|楼|桥|街|博物馆|纪念馆|故居|碑|石窟|长城/.test(name)) return -300;
   if(/山|湖|江|海|草原|森林|峡谷|瀑布|沙漠|公园|湿地|冰川|梯田/.test(name)) return 120;
  } else if(bias === "nature"){
   if(/山|湖|江|海|草原|森林|峡谷|瀑布|沙漠|公园|湿地|冰川|梯田|岛|滩/.test(name)) return -300;
   if(/古迹|遗址|古城|古镇|寺|庙|祠|陵|宫|府|塔|楼|桥|街|博物馆|纪念馆|故居|碑|石窟|长城/.test(name)) return 120;
  }
  return 0;
 };
 const prof = getProfile(); // 旅行画像：walk 怕累降权高体力景点、taste 重排美食
 // —— 预算 × 行程联动：按档位定酒店 + 每天餐食文案（custom 由金额推导档位；小程序可显式传 opts.budgetTier/perDay）——
 let tierKey = (opts && opts.budgetTier) || (budgetKey !== "custom" ? (budgetKey || "mid") : null);
 if(!tierKey){
  const ppd = (opts && opts.perDay) || 0;
  tierKey = ppd > 0 ? tierOfPerDay(ppd) : budgetTierKey("custom", days, (opts && opts.peopleN) || 2);
 }
 if(!BUDGET_STYLE[tierKey]) tierKey = "mid";
 const bStyle = BUDGET_STYLE[tierKey] || BUDGET_STYLE.mid;
 const tierOf = {low:"经济", mid:"舒适", high:"高端"};
 // v1.11：city 可能为 null/undefined（fuzz 抓到 Cannot read properties of null (reading 'hotels')）
 const hotelList = (city && city.hotels) || GEN_HOTELS;
 const hotel = hotelList.find(h=>h.tier===tierOf[tierKey]) || hotelList[1] || hotelList[0];
 const hotelPick = `${hotel.place}｜${hotel.brands}`;
 const foodsAdj = profileAdjustedFoods(city.foods);
 const firstFood = (foodsAdj && foodsAdj[0]) || "本地特色早餐";
 // 按食物类型选量词：面/粉/粥→碗、火锅/宴→顿、乳鸽/烧鸡→只、其余→份
 const tasteVerb = f=>{
  if(!f) return "尝一份";
  if(/火锅|宴|餐|大餐|席/.test(f)) return "尝一顿";
  if(/面|粉|粥|汤|羹|糊|馄饨|水饺|豆汁/.test(f)) return "尝一碗";
  if(/乳鸽|烧鸡|叫花鸡|白切鸡|童子鸡/.test(f)) return "尝一只";
  return "尝一份";
 };

 // 景点池：每个景点只分配一次（splice 取出）；取尽后按「具体化填充池」补充，仍不重复；
 // 留白仅作最后兜底，且每天最多 1 个、绝不出现连续整天留白
 let pool = city.experiences.slice();
 const usedNames = new Set(pool.map(e=>e.name));
 // —— 指定必玩景点（pickSpots）：用户勾选后，行程只围绕选中景点规划（选择性游玩） ——
 const pickSpots = (opts && Array.isArray(opts.pickSpots)) ? opts.pickSpots.slice() : [];
 const pickSet = new Set(pickSpots);
 const stayM = !(opts && opts.stayMountain === false); // 「名山过夜」开关：关掉后观日出名山不住山顶
 // 「只玩勾选的」开关（默认开）：关掉后 = 勾选的必去，剩余时间自动补充推荐景点
 const pickOnly = !(opts && opts.pickOnly === false);
 if(pickSpots.length && pickOnly) pool = pool.filter(e=>pickSet.has(e.name));
 // v1.19.9 语义去重：池里同时存在「锦里 + 武侯祠」和「锦里」时，一份行程会两次出现同一景点。
 // 池顺序 = 编辑名次，保留靠前的那条；但「指定必玩」的条目不参与去重（用户明确要去的不能删）。
 {
  const _kept = [];
  for(const e of pool){
   if(!e || !e.name) continue;
   if(pickSet.has(e.name)){ _kept.push(e); continue; }
   if(_kept.some(x => x.name !== e.name && spotOverlap(x.name, e.name))) continue;
   _kept.push(e);
  }
  pool = _kept;
 }
 // 取消「只玩勾选」时，pool 保留全部景点：pickQueue 会让勾选景点优先排入，其余照常补全
 // —— 大景点单独成天：面积大/徒步强度高（故宫、张家界、黄山、迪士尼…）不与小景点混排，
 //  优先分配中间天，首尾保留抵达/返程；观日出名山（华山/泰山/黄山…）需「次日清晨看日出」，
 //  只能占中间天或第一天，绝不占末日；被「指定必玩」的大景点优先拿槽位 ——
 const bigDayMap = {};
 if(days >= 2){
  const bigOnes = pool.filter(e=>bigSpotInfo(e.name)).sort((a,b)=>(pickSet.has(b.name)?1:0)-(pickSet.has(a.name)?1:0));
  // v1.19.10：同一份城市行程只保留 1 个观日出专线（14 天里排两个日出山会把
  // 「山顶晚餐/下山+早餐」框架文案重复两次，进程内压测会报景点重复）
  const sunrises = stayM ? bigOnes.filter(e=>sunriseSpotInfo(e.name)).slice(0, 1) : [];
  const others = bigOnes.filter(e=>!(stayM && sunriseSpotInfo(e.name)));
  const used = new Set();
  const takeSlot = (list)=>{ for(const s of list) if(!used.has(s)) return s; return null; };
  const mid = []; for(let i=1;i<days-1;i++) mid.push(i);
  // 1) 观日出名山：中间天优先；中间不够放第一天（i=0，次日即看日出+返程）
  for(const e of sunrises){
   let s = takeSlot(mid);
   if(s == null && !used.has(0)) s = 0;
   if(s == null) continue; // 无槽位 → 回归普通分配池（不单独成天）
   used.add(s); bigDayMap[s] = e;
  }
  // 2) 普通大景点：剩余中间天 + 末日（非转场）
  const endSlot = (!(opts && opts.lastMode === "transfer") && days > 1) ? days - 1 : null;
  for(const e of others){
   let s = takeSlot(mid);
   if(s == null && endSlot != null && !used.has(endSlot)) s = endSlot;
   if(s == null) continue;
   used.add(s); bigDayMap[s] = e;
  }
  // 从普通分配池移除已安排的大景点（避免重复出现）
  const assigned = Object.values(bigDayMap);
  bigOnes.forEach(e=>{ if(assigned.includes(e)){ const pi = pool.indexOf(e); if(pi >= 0) pool.splice(pi, 1); } });
 }
 // 指定必玩（非大景点部分）：提取到优先队列，每天各时段 slot 优先安排
 const pickQueue = [];
 pickSpots.forEach(nm=>{
  if(bigDayMap && Object.values(bigDayMap).some(e=>e.name === nm)) return; // 大景点已单独成天
  const pi = pool.findIndex(e=>e.name === nm);
  if(pi >= 0) pickQueue.push(pool.splice(pi, 1)[0]);
  else pickQueue.push({name: nm, period: "全天", note: "自选景点（景点池）"}); // 扩展景点池内景点
 });
 // —— 就近优化：每天以市中心为锚点，每次取「离当前位置最近」的下一个景点（顺路游览，避免同日折返/跨区奔波）——
 const coordMap = new Map();
 (city.experiences||[]).forEach(e=>{ const c = getSpotCoord(city.name, e.name); if(c) coordMap.set(e.name, c); });
 const spotC = name => coordMap.get(name);
 const cityAnchor = getCoord(city.name); // 市中心锚点（代表酒店/抵达地）
 // v1.19.9 经典景点保障：编辑精选名次必须取自 city.experiences 的原始顺序（人工编排，越靠前越经典），
 // 且要在 pool 被大景点/必玩 splice 之前取；写在 pool 上还会污染源数据对象，故用局部 Map。
 const _edRank = new Map();
 (city.experiences || []).forEach((e, i) => { if (e && e.name && !_edRank.has(e.name)) _edRank.set(e.name, i); });
 // 纯「就近贪心」的硬伤：每天从市中心出发只挑最近的，会一直在最密的街区打转，
 // 永远轮不到 20km 外的当地头牌（太原晋祠 20.2km、西安兵马俑 32km 都曾被整条行程跳过）。
 // 做法：取前 4 个在池的经典景点，按地理位置分组（相邻 ≤15km 归一组），一组占一天，
 // 当天从该组出发 → 其余景点自然围绕它连成一条线；最近的组排前几天、最远的组排最后一天，
 // 远郊组自动成为「远郊/一日游」，首日（抵达日）保持市区。
 const _isTransferDay = !!(opts && opts.lastMode === "transfer") && days > 1;
 const anchorForDay = {};
 {
  // 按编辑名次取前 min(days,4) 个仍在池里的经典景点，然后按离市中心距离升序排：
  // 最近的排前几天、最远的排最后一天，远郊经典自然成为最后一天的「一日游」。
  const _anchors = pool
   .filter(e => e && e.name && _edRank.has(e.name))
   .sort((a, b) => _edRank.get(a.name) - _edRank.get(b.name))
   .slice(0, Math.min(days, 4))
   .map(e => { const c = spotC(e.name); return c ? { lat: c.lat, lon: c.lon, d: cityAnchor ? haversine(c, cityAnchor) : 0 } : null; })
   .filter(Boolean)
   .sort((a, b) => a.d - b.d);
  for (let gi = 0; gi < _anchors.length; gi++) {
   let day = days - _anchors.length + gi;
   if (day < 0) day = 0;
   if (day === days - 1 && _isTransferDay) day = Math.max(0, days - 2);
   anchorForDay[day] = { lat: _anchors[gi].lat, lon: _anchors[gi].lon };
  }
 }
 let cursor = cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null; // 当前位置，每天重置
 // v1.19.10：市区/远郊计数缓存（nearest 每次调用都全量 filter 一遍，实测 O(n²)）
 let _urbanN = pool.filter(e => { const c = spotC(e.name); return c && (!cityAnchor || haversine(c, cityAnchor) <= 25); }).length;
 let _farN = pool.length - _urbanN;
 const nearest = (periods)=>{
  // 市区景点（距市中心≤25km）优先；远郊景点（长城/山区等）仅在无市区候选时取，
  // 且被取后会自然把同方向远郊景点（如明十三陵）聚到同一天 → 市区天全市区、远郊集中成「一日游」
  let bestIdx = -1, bestDist = Infinity, farIdx = -1, farDist = Infinity;
  for(let i=0;i<pool.length;i++){
   const e = pool[i];
   if(!periods.includes(e.period)) continue;
   const c = spotC(e.name);
   // 坐标防幻觉：无真实坐标的景点最后兜底（d=9999），真实坐标优先；怕累画像再给高体力景点加罚分
   let d = (c && cursor) ? haversine(c, cursor) : 9999;
   d += modeEff(e.name); // 出行模式偏好权重
   d += biasEff(e.name); // v1.15 攻略风格偏好（历史/自然）
   if(prof && prof.walk === 0 && spotEffort(e.name) === 2) d += 260;
   if(isWished(e.name)) d -= 400; // 想玩清单里的景点优先安排
   const isFar = c && cityAnchor ? haversine(c, cityAnchor) > 25 : false;
   if(isFar){ if(d < farDist){ farDist = d; farIdx = i; } }
   else if(d < bestDist){ bestDist = d; bestIdx = i; }
  }
  // 远郊日判定：游标已在远郊（继续同向），或市区候选已近耗尽（≤1）而远郊≥2 → 当天从远郊开始集中游览
  const urbanCount = _urbanN;
  const farCount = _farN;
  const cursorFar = cursor && cityAnchor ? haversine(cursor, cityAnchor) > 25 : false;
  const startFar = urbanCount <= 1 && farCount >= 2;
  const idx = (cursorFar || startFar) ? (farIdx >= 0 ? farIdx : bestIdx) : (bestIdx >= 0 ? bestIdx : farIdx);
  if(idx < 0) return null;
  const e = pool.splice(idx,1)[0];
  const c = spotC(e.name);
  const wasFar = c && cityAnchor ? haversine(c, cityAnchor) > 25 : false;
  if (wasFar) _farN--; else _urbanN--;
  if(c) cursor = c; // 游标移到刚取出的景点
  return e;
 };
 const take = (wants, allowAllDay=true)=>{
  let s = nearest(wants);
  if(s) return s;
  if(allowAllDay) return nearest(["全天"]);
  return null;
 };
 // 具体地点兜底：优先取住宿推荐区名，其次取城市名，杜绝「夜游老城区」这类无地点泛化
 const area1 = city.areas && city.areas[0] ? city.areas[0].name : (city.name || "市中心");
 const area2 = city.areas && city.areas[1] ? city.areas[1].name : area1;
 const SHOWS = showListOf(city.name); // 晚间具名演出（在哪儿看什么），未收录城市回落泛文案
 const f1 = foodsAdj && foodsAdj[0] ? foodsAdj[0] : "本地特色美食";
 const f2 = foodsAdj && foodsAdj[1] ? foodsAdj[1] : (foodsAdj ? foodsAdj[0] : "特色小吃");
 // —— v1.8.2 泛化填充治理：取消「古寺/教堂晨间参访」「夜游XX老城街区」「XX小吃街寻味」等
 //   无具体地点的类别模板（用户明确不要泛泛推荐）。
 //   空槽一律只用「真实景点（含本市 landmark 补充池）/ 具名演出」补，穷尽后当天至多 1 条留白，
 //   其余空槽直接省去 —— 宁缺毋假，绝不出现类别式推荐 ——
 const SLOT_GROUP = {凌晨:"am", 早上:"am", 上午:"am", 清晨:"am", 下午:"pm", 晚上:"eve", 傍晚:"eve", 深夜:"eve", 夜间:"eve"};
 const lmNames = (() => {          // 本市 landmark 补充池：真实有名景点（鲁迅故里/东湖…），仅当 experiences 取尽后启用
  const out = [], seen = new Set();
  const libs = [CITY_LANDMARKS, CITY_LANDMARKS_EXTRA, CITY_LANDMARKS_EXTRA2, CITY_LANDMARKS_EXTRA3, CITY_LANDMARKS_EXTRA4, CITY_LANDMARKS_EXTRA5, CITY_LANDMARKS_EXTRA6];
  libs.forEach(lib => { const arr = (lib && lib[city.name]) || []; arr.forEach(n => { const k = String(n || "").trim(); if (k && !seen.has(k)) { seen.add(k); out.push(k); } }); });
  return out;
 })();
 let lmIdx = 0;
 const refillLandmark = () => {   // 白天空槽：注入一个本市真实景点进池（与已排/组合名语义去重）；耗尽返回 false
  while (lmIdx < lmNames.length) {
   const n = lmNames[lmIdx++];
   if (usedNames.has(n)) continue;
   let dup = false;
   for (const u of usedNames) { if (u.includes(n) || (n.length > 1 && n.includes(u))) { dup = true; break; } }
   if (dup) continue;
   usedNames.add(n);
   pool.push({ name: n, period: "全天", note: "" });
   return true;
  }
  return false;
 };
 const showSeq = (Array.isArray(SHOWS) ? SHOWS : []).slice(0, 2);   // 晚间具名演出（真实场馆+剧目，不在 landmark/experience 池）
 let showN = 0;
 const nextShow = () => { while (showN < showSeq.length) { const s = showSeq[showN++]; if (s && s.venue && s.show) return s; } return null; };
 let blankToday = 0;
 const push = (items, slotLabel, wants, dayNo, slotIdx) => {
  // 晚间槽不回落「全天」景点，把白天景点留给上午/下午，保证每天至少 2 个景点
  const isEve = /晚上|傍晚|深夜|夜间/.test(slotLabel);
  // 指定必玩景点优先：匹配时段组（am/pm/eve 或全天）依次安排
  if(pickQueue.length){
   const grp = SLOT_GROUP[slotLabel];
   const pi = pickQueue.findIndex(p=>p.period === "全天" || SLOT_GROUP[p.period] === grp);
   if(pi >= 0){
    const s = pickQueue.splice(pi,1)[0];
    items.push({...s, period: slotLabel, note: (s.note ? s.note + "；" : "") + "你指定的必玩景点"});
    return;
   }
  }
  const s = take(wants, !isEve);
  if(s){
   // 坐标防幻觉标注：无坐标 → 示意提示；怕累画像选中高体力 → 省力提示
   const sc = spotC(s.name);
   let note = s.note || "";
   if(!sc) note = (note ? note + "；" : "") + "坐标示意";
   else if(prof && prof.walk === 0 && spotEffort(s.name) === 2) note = (note ? note + "；" : "") + "需爬升/台阶多，可坐索道或缆车省力";
   items.push({...s, period: slotLabel, note: note});
   return;
  }
  // 「只玩勾选的」模式：剩余时间只留一条「自由活动」，绝不塞 filler 泛化安排
  // （此前限额 blankToday<2，第 3 个空位会漏进「夜游XX/小吃街寻味」等未勾选内容）
  // 取消该开关时走正常流程，用推荐景点把剩余时间补全
  if(pickSpots.length && pickOnly){
   if(blankToday < 1){
    blankToday++;
    items.push({name:`自由活动 · 第${dayNo}天留白`, period: slotLabel, note:"自选模式下仅安排你勾选的景点，其余时间自由安排、逛吃随缘"});
   }
   return;
  }
  // 晚间兜底：排「具名演出」（有真实场馆与剧目），不用类别模板
  if(isEve){
   const sh = nextShow();
   if(sh){
    const nm = `「${sh.venue}」看${sh.show}`;
    if(!usedNames.has(nm)){
     usedNames.add(nm);
     items.push({name: nm, period: slotLabel, note: sh.tip || "提前网上订票更稳妥"});
     return;
    }
   }
  } else if(refillLandmark()){
   // 白天兜底：从本市真实 landmark 池取一个有名景点（时间充裕可加）
   const s2 = take(wants, true);
   if(s2){
    items.push({...s2, period: slotLabel, note: (s2.note ? s2.note + "；" : "") + "行程补充 · 时间充裕可加"});
    return;
   }
  }
  // 真实内容已穷尽 → 当天至多 1 条自由留白；其余空槽直接省去（宁缺毋假）
  if(blankToday < 1){
   blankToday++;
   items.push({name:`自由活动 · 第${dayNo}天留白`, period: slotLabel, note:"睡到自然醒，随心情安排，在附近逛逛也不错"});
  }
 };

 const isTransferSeg = opts && opts.lastMode === "transfer";
 const nextCity = opts ? opts.nextCity : null;
  const seg = opts && opts.seg != null ? opts.seg : 0;
 const planDays = [];
 let pendingSunrise = null; // 前一天为观日出专线 → 今天清晨注入「看日出+下山」
 let relaxCount = 0; // v1.19 P0-2：relax 填充项去重计数（单行程最多 1 条，避免「周边走走」刷屏）
 for(let i=0;i<days;i++){
  blankToday = 0;
  // 每天从当天的经典锚点出发（无锚点的天仍从市中心出发）：锚点距游标 0km，会被当天优先选中
  const _anc = anchorForDay[i];
  cursor = _anc ? {lat: _anc.lat, lon: _anc.lon} : (cityAnchor ? {lat: cityAnchor.lat, lon: cityAnchor.lon} : null);
  const d = _dm ? new Date(+_dm[1], +_dm[2]-1, +_dm[3]) : new Date(); d.setDate(d.getDate()+i);
  const isFirst = i===0, isLast = i===days-1;
  const isTransfer = isTransferSeg && isLast;
  const hadSunrise = !!pendingSunrise; // 观日出专线日的次日：上午已注入「下山+早餐」，后续不能用更早的时段
  let theme, items=[];
  // 前一天是观日出专线日 → 今天凌晨看日出 + 上午下山
  if(pendingSunrise){
   const sInfo = sunriseSpotInfo(pendingSunrise) || {};
   const view = sInfo.view || "观景台";
   items.push({name:`凌晨出发，前往「${view}」`, period:"凌晨", note:"按山顶酒店叫早时间起床，备好外套/头灯，日出前 30 分钟到位"});
   items.push({name:"看日出 · 云海", period:"清晨", note:"日出时间随季节变化（夏季约 5:00、冬季约 6:30），前一晚记得查天气"});
   items.push({name:"下山 + 早餐", period:"上午", note:"乘索道/缆车下山，回到市区吃顿热乎的早餐"});
   pendingSunrise = null;
  }
  const bigDay = bigDayMap[i];
  if(bigDay){
   // 大景点专线日：早上出发 → 上午深度 → 下午继续 → 傍晚休整 → 晚上收尾，不再排其他景点
   const bInfo = bigSpotInfo(bigDay.name) || {};
   const sInfo = stayM ? sunriseSpotInfo(bigDay.name) : null;
   theme = sInfo ? `${bigDay.name} · 山顶观日专线` : `${bigDay.name} · 专线深度日`;
   if(isFirst) items.push({name:`抵达 + 直奔「${bigDay.name}」`, period:"早上", note:"放好行李/寄存，直接开逛，预约时段别错过"});
   else items.push({name:`出发前往「${bigDay.name}」`, period: hadSunrise ? "上午" : "早上", note:"提前在官方渠道购票/预约，避开周一闭馆与周末人流"});
   items.push({name:`深度游览「${bigDay.name}」`, period:"上午", note:`大景点专属日：${bInfo.reason || "面积大、耗时长，单独一天慢慢逛"}`});
   if(sInfo){
    items.push({name:`继续游览 + 登山/索道上行`, period:"下午", note:"沿主游线往高处走，傍晚前抵达山顶"});
    items.push({name:`入住山顶酒店（近${sInfo.view}）`, period:"傍晚", note:sInfo.note});
    items.push({name:"山顶晚餐 · 早点休息", period:"晚上", note:"明早看日出，今天 22:00 前睡，保存体力"});
    pendingSunrise = bigDay.name; // 次日清晨注入看日出
   } else {
    items.push({name:`继续深度游览「${bigDay.name}」`, period:"下午", note:`官方建议游览 ${bInfo.hours || "一整天"}，不走马观花`});
    // v1.19 P0-2：relax 填充项去重轮替 —— 同义词轮换 + 单行程最多 1 条，避免「休整·周边走走」重复出现
    if (relaxCount < 1) {
      relaxCount++;
      const RELAX = ["休整 · 周边走走", "老街慢逛 · 喝杯咖啡", "近郊步道 · 散散步", "夜市逛吃 · 慢节奏"];
      const _rseed = (city.name || "") + ":" + i;
      let _rh = 0; for (let _k = 0; _k < _rseed.length; _k++) _rh = (_rh * 31 + _rseed.charCodeAt(_k)) >>> 0;
      items.push({ name: RELAX[_rh % RELAX.length], period: "傍晚", note: "充实的一天，傍晚放慢节奏放松一下" });
    } else {
      items.push(mealTail(items, "傍晚", i, city.name));
    }
    if(isLast && isTransfer) items.push({name:`前往 ${nextCity}`, period:"晚上", note:"转场到下一站，行李提前收拾好"});
    else if(isLast) items.push({name:"返程", period:"晚上", note:"预留充足时间前往机场/车站"});
    else {
     // v1.17.7：大景点专属日的晚上同样优先排「具名演出」（旧实现硬编码「当地美食+自由活动」，
     // 导致该城的 SHOW_TIPS 演出永远排不进来，如平遥《又见平遥》）
     const _sh = nextShow();
     if(_sh){
      const _nm = `「${_sh.venue}」看${_sh.show}`;
      if(!usedNames.has(_nm)){ usedNames.add(_nm); items.push({name:_nm, period:"晚上", note:_sh.tip || "提前网上订票更稳妥"}); }
      else items.push(mealTail(items, "晚上", i, city.name));
     } else items.push(mealTail(items, "晚上", i, city.name));
    }
   }
  } else if(isFirst){
   theme = days===1 ? "一日精华游" : "抵达 · 初见"+(days>2?"，先逛市区精华":"");
   items.push({name:`抵达 + 入住「${hotelPick}」`,period:"上午",note:`放好行李，先在附近吃个本地午餐（推荐尝：${firstFood}）`});
   if(style === "speed"){
    push(items, "下午", ["下午","全天"], i+1, 0);
    push(items, "傍晚", ["傍晚","下午","晚上","全天"], i+1, 1);
    push(items, "晚上", ["晚上","傍晚","深夜"], i+1, 2);
   } else if(style === "leisure"){
    push(items, "下午", ["下午","全天"], i+1, 0);
    items.push({name:"当地自由探索", period:"晚上", note:"咖啡馆/老街/江边，随心情——轻松模式不留太多安排"}); // 轻松模式晚上自由，不塞泛化景点
   } else {
    push(items, "下午", ["下午","全天"], i+1, 0);
    push(items, "晚上", ["晚上","傍晚","深夜"], i+1, 1);
   }
   if(days===1){
    if(isTransfer) items.push({name:`前往 ${nextCity}`,period:tailPeriod(items),note:"退房后转场到下一站，建议预留半天时间"});
    else items.push({name:"返程",period:tailPeriod(items),note:"预留充足时间前往机场/车站"});
   }
  } else if(isLast){
   theme = isTransfer ? "收尾 · 转场" : "收尾 · 返程";
   const hadSunrise = items.some(it => it.period === "凌晨");
   items.push({name: hadSunrise ? "回酒店退房寄存行李" : `退房寄存行李 + ${tasteVerb(firstFood)}${firstFood}`, period: hadSunrise ? "上午" : "早上", note: hadSunrise ? "看完日出下山后回住处退房寄存，轻装继续" : "收拾行李、退房寄存，用当地味道给旅程收尾"});
   push(items, "上午", ["上午","全天","下午"], i+1, 0);
   // 下午再安排一个景点，保证最后一天也有 ≥2 个具体安排；返程推迟到傍晚
   push(items, "下午", ["下午","全天","上午"], i+1, 1);
   if(isTransfer) items.push({name:`前往 ${nextCity}`,period:tailPeriod(items),note:"建议预留充足时间，乘高铁/飞机转场到下一站"});
   else items.push({name:"返程",period:tailPeriod(items),note:"预留充足时间前往机场/车站"});
  } else {
   if(style === "speed"){
    theme = "特种兵打卡 · 第"+(i+1)+"天";
    [["清晨",["清晨","上午","全天"]],["上午",["上午","全天"]],["下午",["下午","全天"]],["傍晚",["傍晚","下午","晚上","全天"]],["晚上",["晚上","傍晚","深夜","夜间"]]].filter(([l]) => !(hadSunrise && (l === "凌晨" || l === "清晨"))).forEach(([l,w],si)=>push(items,l,w,i+1,si));
   } else if(style === "leisure"){
    theme = "悠闲度假 · 第"+(i+1)+"天";
    push(items, "上午", ["上午","全天","清晨"], i+1, 0);
    push(items, "下午", ["下午","全天","上午"], i+1, 1);
    items.push({name:"当地自由探索", period:"晚上", note:"咖啡馆/老街/江边，随心情——轻松模式晚上不安排景点"}); // 轻松模式晚上固定自由，与平衡/紧凑形成明显分层
    if(items.length<2) push(items, "下午", ["全天","上午","下午"], i+1, 2);
   } else {
    theme = "深度探索 · 第"+(i+1)+"天";
    push(items, "上午", ["上午","全天","清晨"], i+1, 0);
    push(items, "下午", ["下午","全天"], i+1, 1);
    push(items, "晚上", ["晚上","傍晚","深夜","夜间"], i+1, 2);
    if(items.length<2){ push(items, "下午", ["全天","上午","下午"], i+1, 3); }
   }
  }

  const isoDate = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const title = isFirst ? "初见"+city.name : (isTransfer ? "告别"+city.name+" · 转场" : (isLast ? "告别"+city.name : "探索"+city.name));
  // 每日强度：按当天具体安排数（非框架/留白）划分 轻松/适中/紧凑

  // v1.20.x：同日项按「时段」严格有序输出（时段排序）；框架项钉头尾，其余按 PERIOD_ORDER 升序
  const _FRONT = /^(抵达|入住|出发前往|凌晨出发)/, _BACK = /^(返程|退房|回酒店)/;
  const _rank = p => (PERIOD_ORDER && PERIOD_ORDER[p] != null) ? PERIOD_ORDER[p] : 99;
  items.sort((a, b) => {
    const af = _FRONT.test(a.name || ""), bf = _FRONT.test(b.name || "");
    if (af !== bf) return af ? -1 : 1;
    const ab = _BACK.test(a.name || ""), bb = _BACK.test(b.name || "");
    if (ab !== bb) return ab ? 1 : -1;
    return _rank(a.period) - _rank(b.period);
  });
  const spotCount = items.filter(it=>!/^(抵达|退房|返程|前往)/.test(it.name) && !/留白|备选/.test(it.name)).length;
  const pace = bigDay ? "适中" : (spotCount <= 2 ? "轻松" : (spotCount <= 3 ? "适中" : "紧凑"));
  planDays.push({date: isoDate, theme, items, title, cityName: city.name, seg, pace, spotCount,
   meal: budgetMealText(bStyle, foodsAdj, i)});
 }
 // 兜底：指定必玩景点还没排完（天数少）→ 并入最后一天，保证「必进」；按核心名去重防与当天重合
 if(pickQueue.length && planDays.length){
  const last = planDays[planDays.length-1];
  const coreOf2 = n => String(n||"").replace(/^(抵达 \+ |出发前往「|深度游览「|继续深度游览「|继续游览 \+ |回酒店退房寄存|退房寄存行李|前往 )/, "").replace(/」$/, "").trim();
  const have = new Set((last.items||[]).map(it=>coreOf2(it.name)));
  pickQueue.forEach((e,qi)=>{
   const core = coreOf2(e.name);
   if(have.has(core)) return; // 已排过同名 → 跳过，避免重复
   have.add(core);
   last.items.push({...e, period: qi % 2 === 0 ? "上午" : "下午", note: (e.note ? e.note + "；" : "") + "你指定的必玩景点（天数紧凑，合并安排）"});
  });
 }
 // v1.17.5：首日空置兜底 —— 大景点各自占满整天时（如神农架：神农顶、大九湖各一天），
 // 第 1 天会只剩「抵达 + 留白」。这里从后面某天借一个「非大景点」到首日下午，避免首日空着。
 (()=>{
  if(planDays.length < 2) return;
  const _frame = n => { const s = String(n || ""); return /^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发)/.test(s) || /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/.test(s); };
  const _hasReal = d => (d.items || []).some(it => it && it.name && !_frame(it.name));
  if(_hasReal(planDays[0])) return;
  for(let k=1;k<planDays.length;k++){
   const d = planDays[k];
   const items = d.items || [];
   let mi = -1;
   for(let i=0;i<items.length;i++){
    const nm = items[i] && items[i].name;
    if(nm && !_frame(nm) && !bigSpotInfo(nm)) mi = i;   // 最后一个非大景点条目
   }
   if(mi < 0) continue;
   const moved = items.splice(mi, 1)[0];
   const items0 = planDays[0].items || (planDays[0].items = []);
   let at = 0;
   for(let i=0;i<items0.length;i++){ if(/^(抵达|入住)/.test(String(items0[i].name || ""))) at = i + 1; }
   items0.splice(at, 0, { name: moved.name, period: "下午", note: (moved.note ? moved.note + "；" : "") + "抵达后顺路先逛，时间宽裕" });
   // 移走后天若已无真实景点，补一条自由探索（不留空槽）
   if(!_hasReal(d) && !(d.items || []).some(it => /自由活动|自由探索|留白/.test(String(it.name || "")))){
    d.items.push({ name: "当地自由探索", period: "下午", note: "今天行程较松，可就近逛逛、尝点本地味道" });
   }
   break;
  }
 })();
 // v1.20.x：所有日后处理（必玩兜底并入最后一天 / 首日空置补位）完成后再做一次时段排序，
 // 确保同日严格有序——兜底的必玩项按 pickQueue 顺序 push（上午/下午交替），可能破坏同日前后置；
 // 首日补位也会把「下午」项插到「抵达」之后，故必须在此统一重排。
 for (const _dd of planDays) _sortItemsByPeriod(_dd.items || []);
 return planDays;
}

// v1.20.x：同日项按「时段」严格有序。框架「抵达/入住/出发」钉到当天开头（其时段本就最早，双保险）；
// 其余纯按 PERIOD_ORDER 升序——退房/返程依赖自身时段（退房多为早上、返程为傍晚/晚上）自然归位，
// 不再强制钉尾：此前钉尾会把「退房(早上)」顶到一天最末，既违背作者意图（退房本在最后一天清晨、先于上午景点），
// 又因 raw period 早上 < 前面下午项而触发 F-时段倒序，故删除钉尾逻辑。
function _sortItemsByPeriod(items) {
  const _FRONT = /^(抵达|入住|出发前往|凌晨出发)/;
  const _rank = p => (PERIOD_ORDER && PERIOD_ORDER[p] != null) ? PERIOD_ORDER[p] : 99;
  items.sort((a, b) => {
    const af = _FRONT.test(a.name || ""), bf = _FRONT.test(b.name || "");
    if (af !== bf) return af ? -1 : 1;
    return _rank(a.period) - _rank(b.period);
  });
  return items;
}

function countPlanStats(days){
 let spots = 0, hours = 0;
 const seen = new Set();
 (Array.isArray(days) ? days : []).forEach(d=>{
  (d.items||[]).forEach(it=>{
   const n = String(it.name||"");
   if(/^(抵达|退房|返程|前往|入住|回酒店)/.test(n)) return;
   if(/自由活动|留白|备选|晨逛|地标晨拍|船游|渡轮|晨游|逛|街区|夜景|滨水|步道|骑行|早餐|晚餐|寻味|探店|古寺|古塔|果园|茶园|古镇晨|园林晨|山湖晨|动物园晨|植物园晨|遗址晨|博物馆早|展览馆半日|伴手礼|小镇半日|乐园半日|大学城|校园/.test(n)) return;
   const h = spotHours(n);
   if(h <= 0) return;
   const core = String(n).replace(/^(出发前往「|深度游览「|继续深度游览「|继续游览 \+ |抵达 \+ 直奔「)/, "").replace(/」$/, "");
   if(!seen.has(core)){ seen.add(core); spots++; }
   hours += h;
  });
 });
 return {spots, hours: Math.round(hours*10)/10};
}

function relaxDetail(days){
 const empty = {score:60, hpd:0, spd:0, bigs:0, transfers:0, hikes:0};
 if(!Array.isArray(days) || !days.length) return empty;
 const s = countPlanStats(days);
 const n = days.length;
 let effHours = s.hours, bigs = 0;
 days.forEach(d=>{
  if(!(d.items||[]).some(it=>bigSpotInfo(it.name))) return;
  bigs++;
  let dh = 0;
  (d.items||[]).forEach(it=>{ const h = spotHours(it.name); if(h > 0) dh += h; });
  effHours -= dh * 0.4; // 专线日疲劳度打 6 折
 });
 const hpd = Math.max(0, effHours) / n;
 const spd = s.spots / n;
 const transfers = days.filter(d=>/转场/.test(d.theme||"")).length;
 const hikes = days.filter(d=>(d.items||[]).some(it=>/徒步|栈道|登山|爬/.test(it.name))).length;
 let score = 100;
 score -= Math.max(0, hpd - 2) * 9;   // 日均 2h 起扣
 score -= Math.max(0, spd - 1.2) * 6;  // 日均 1.2 景起扣
 score -= bigs * 2;
 score -= transfers * 4;
 score -= hikes * 2;
 return {
  score: Math.max(5, Math.min(98, Math.round(score))),
  hpd: Math.round(hpd*10)/10, spd: Math.round(spd*10)/10, bigs, transfers, hikes
 };
}

function relaxIndex(days){ return relaxDetail(days).score; }

function spotDetailCore(name, cityName){
 // 框架/安排类条目没有「景点介绍」：退房、抵达、返程、自由活动、看日出、休整、美食等一律不展开
 if(typeof name !== "string" || !name) return "";   // v1.11：fuzz 抓到 name.includes is not a function
 if(/^(抵达|出发前往|退房|返程|前往|入住|回酒店)/.test(name)) return "";
 if(/自由活动|自由探索|留白|备选|看日出|下山|休整|凌晨出发|早餐|晚餐|早点休息|美食/.test(name)) return "";
 let d = SPOT_DETAILS[name];
 if(!d){ for(const k in SPOT_DETAILS){ if(name.includes(k) && SPOT_DETAILS[k]){ d = SPOT_DETAILS[k]; break; } } }
 if(d){
  const open = spotOpenNote(name, cityName, true); // fromDetail=true：跳过内部递归
  return `<div class="sd-intro">${d.intro}</div>
   <div class="sd-sec">怎么去</div><div class="sd-how">${d.how}</div>
   <div class="sd-sec">推荐游览线路</div>
   <div class="sd-route">${d.route.map((r,i)=>`<span class="sd-node">${i+1}. ${r}</span>${i<d.route.length-1?'<span class="sd-arrow">→</span>':''}`).join("")}</div>
   <div class="sd-sec">⏱ 游玩时长</div><div class="sd-how">预计 ${spotHours(name)} 小时${spotHours(name)>=8 ? "（大景点，建议独占一天深度游览）" : ""}${open ? " · " + open : ""}；具体以当日人流与个人节奏为准。</div>` + spotDetailExtras(name, cityName);
 }
 // v1.15：无真实 SPOT_DETAILS 时不输出模板拼凑介绍（避免“以峰林/峡谷见长”“门票10元内”这类虚构/雷同文案），
 // 由前端统一显示「暂无介绍，点百科看更多」。
 return "";
}

function spotHours(name){
 if(!name) return 2;
 if(/^(抵达|出发前往|退房|返程|前往|入住|回酒店)/.test(name)) return 0;
 if(/自由|留白|备选/.test(name)) return 0;
 if(/凌晨出发|看日出|下山|休整|晚餐|早点休息/.test(name)) return 0;
 const bi = bigSpotInfo(name);
 if(bi && bi.hours){
  const h = bi.hours;
  if(/[0-9]\s*[-~至]\s*[0-9]+\s*天/.test(h)) return 10;   // "1-2 天" 按天算
  const m = h.match(/([0-9]+)\s*[-~至]\s*([0-9]+)\s*小时/); // "4-8 小时" 取中值（排除 10:00-21:00 营业时间）
  if(m) return Math.round((parseInt(m[1], 10) + parseInt(m[2], 10)) / 2 * 10) / 10;
  if(/一整天|全天/.test(h)) return 8;
  if(/半天/.test(h)) return 4;
  if(/日票|日有效/.test(h)) return 8;             // "门票 4 日有效" 是有效期非时长
  const n = h.match(/^([0-9]+)/);
  if(n) return parseInt(n[1], 10);
  return 6;
 }
 const t = name;
 if(/主题乐园|欢乐世界|野生动物世界|海洋王国|度假区|影视城|环球影城/.test(t)) return 7;
 if(/山|峰|岭|峡谷|栈道|徒步|长城|草原|沙漠|梯田|瀑布/.test(t) && !/公园/.test(t)) return 4; // 山类（景山公园等公园除外）
 if(/博物馆|美术馆|纪念馆|科技馆|天文馆|展览馆|艺术区|动物园|植物园|海洋馆|水族馆/.test(t)) return 2.5;
 if(/古镇|古村|古城|街区|老街|步行街|胡同|巷|文化街|街/.test(t)) return 2.5;
 if(/园林|公园|寺庙|教堂|塔|遗址|故居|学院|书院|陵/.test(t)) return 2;
 if(/演出|演艺|秀|夜游|夜景/.test(t)) return 1.5;
 if(/湖|江|河|海|海滩|岛|湾|泉/.test(t)) return 3;
 return 2;
}

// v1.11：fuzz 抓到 name 为非字符串（数字/对象）时 name.indexOf 抛错
function bigSpotInfo(name){
 if(typeof name !== "string" || !name) return null;
 if(BIG_EXCLUDE.some(x=>name.indexOf(x) >= 0)) return null;
 return bestMatch(name, BIG_SPOT_DAYS);
}

// v1.11：getSpotCoord 每次调用都要 base.concat(COORD_PATCH) 重建数组 + 线性扫描，
// 地图页/行程页一次渲染会调几十上百次。改为按城市缓存合并后的坐标表。
const _coordTab = new Map();   // 城市名 -> 合并后的坐标列表（含 null 结果的城市也缓存）
const _coordTable = (cityName) => {
  if (_coordTab.has(cityName)) return _coordTab.get(cityName);
  const base = SPOT_COORDS[cityName];
  const patch = COORD_PATCH[cityName];
  const list = base ? (patch ? base.concat(patch) : base) : (patch || null);
  _coordTab.set(cityName, list);
  return list;
};
// v1.19.10：精确命中 Map 索引（getSpotCoord 原来每次线性扫整张城市坐标表）
const _coordExactTab = new Map();
const _coordExactFor = (cityName) => {
  if (_coordExactTab.has(cityName)) return _coordExactTab.get(cityName);
  const list = _coordTable(cityName) || [];
  const m = new Map();
  for (const st of list) if (st && st[0] && !m.has(st[0])) m.set(st[0], { lat: st[1], lon: st[2] });
  _coordExactTab.set(cityName, m);
  return m;
};
// v1.11：跨城兜底用的「景点名 -> 坐标」全量索引，替代双层双重循环线性扫描
let _allCoordIdx = null;
const _allCoordIndex = () => {
  if (_allCoordIdx) return _allCoordIdx;
  _allCoordIdx = new Map();
  [SPOT_COORDS, COORD_PATCH].forEach(tbl => {
    for (const cname in tbl) {
      const cl = tbl[cname];
      if (!cl) continue;
      for (const s of cl) {
        if (!s || !s[0] || _allCoordIdx.has(s[0])) continue;
        _allCoordIdx.set(s[0], { lat: s[1], lon: s[2] });
      }
    }
  });
  return _allCoordIdx;
};

// v1.11：spotName 可能非字符串（fuzz 抓到 n.includes is not a function）
function getSpotCoord(cityName, spotName){
 if(typeof spotName !== "string" || !spotName) return null;
 const list = _coordTable(cityName);
 const exact = (n) => _coordExactFor(cityName).get(n) || null;
 const fuzzy = (n)=>{
  for(const s of list){
   const k = s[0];
   if(k.length>=2 && (n.includes(k) || k.includes(n))) return {lat:s[1], lon:s[2]};
  }
  return null;
 };
 if(list){
  const e = exact(spotName);
  if(e) return {lat:e.lat, lon:e.lon, approx:false};
  // 组合名拆分（+ / 、 · ， 和 等分隔）
  const segs = String(spotName).split(/[+＋\/、·,，和&＆]/).map(s=>s.trim()).filter(s=>s.length>=2);
  const found = [];
  segs.forEach(seg=>{
   const m = exact(seg) || fuzzy(seg);
   if(m) found.push(m);
  });
  if(found.length){
   const lat = found.reduce((a,b)=>a+b.lat,0)/found.length;
   const lon = found.reduce((a,b)=>a+b.lon,0)/found.length;
   return {lat, lon, approx:false};
  }
 }
 // 「全省游」模式：cityName 为省名（不在两表）→ 先在本省城市内精确/模糊查找，
 // 避免跨城同名错配（如 湖南·十里画廊 被误当 桂林·十里画廊，导航差数百公里）
 if(!list && cityName){
  const pv = PROVINCE_CITIES[cityName] || PROVINCE_CITIES[String(cityName).replace(/省$/, "")];
  if(pv && pv.length){
   const scanPv = (fuzzy) => {
    // v1.19.9：同城内若还存在「更长更具体」的同源名字（大连劳动公园 vs 劳动公园），
    // 说明当前命中项是通用名，先记为兜底继续扫其他城市，避免它抢在真正通用名的城市（朝阳）之前命中。
    let loose = null;
    for(const cname of pv){
     const l = (SPOT_COORDS[cname] || []).concat(COORD_PATCH[cname] || []);
     for(const s of l){
      if(fuzzy ? (s[0].length>=2 && (spotName.includes(s[0]) || s[0].includes(spotName))) : s[0] === spotName){
       const generic = !fuzzy && l.some(o => o !== s && o[0] && o[0].length > s[0].length && o[0].indexOf(s[0]) >= 0);
       if(generic){ if(!loose) loose = {lat:s[1], lon:s[2], approx:false}; continue; }
       return {lat:s[1], lon:s[2], approx:false};
      }
     }
    }
    return loose;
   };
   const e2 = scanPv(false);
   if(e2) return e2;
   const f2 = scanPv(true);
   if(f2) return f2;
  }
 }
 // 省内未命中（或非省名）→ 跨所有城市兜底（v1.11：改用全量索引，O(1) 而非 O(城市数×景点数)）
 if(!list){
  const idx = _allCoordIndex();
  const hit = idx.get(spotName);
  if(hit) return {lat:hit.lat, lon:hit.lon, approx:false};
  for(const [k, v] of idx){
   if(k.length>=2 && (spotName.includes(k) || k.includes(spotName))) return {lat:v.lat, lon:v.lon, approx:false};
  }
 }
// v1.14：城市锚点级兜底。找不到景点精确坐标时，返回所在城市的真实锚点坐标，
// 标记 approx:"city"（真坐标，但只定位到城市中心，不是景点本身）。
// 取代旧「hash 伪坐标 approx:true」——伪坐标既不能直接导航也不该被当真坐标，纯属误导。
const anchor = getCoord(cityName);
if (anchor && anchor.lat && anchor.lon) return { lat: anchor.lat, lon: anchor.lon, approx: "city" };
return null;
}

// v1.11：入参可能非坐标对象（fuzz 抓到 reading 'lat' of null）—— geo.haversine 已统一处理空/非法入参
function getCoord(cityName){
 if(CITY_COORDS[cityName]) return {lat:CITY_COORDS[cityName][0], lon:CITY_COORDS[cityName][1], approx:false};
 if(CAPITAL_COORDS[cityName]) return {lat:CAPITAL_COORDS[cityName][0], lon:CAPITAL_COORDS[cityName][1], approx:false};
 // 省名 → 省会坐标（「全省游」模式锚点/通行估算）
 const capName = PROVINCE_CAPITAL[cityName];
 if(capName){
  const cc = CITY_COORDS[capName] || CAPITAL_COORDS[capName];
  if(cc) return {lat:cc[0], lon:cc[1], approx:true};
 }
 const p = CITY2PROV[cityName];
 if(p){
  const cap = PROVINCE_CAPITAL[p];
  const c = CITY_COORDS[cap] || CAPITAL_COORDS[cap];
  if(c) return {lat:c[0], lon:c[1], approx:true};
 }
 return null;
}

function resolveBudget(budgetKey, days, peopleN){
 if(budgetKey === "custom"){
  const el = document.getElementById("customBudget");
  const amt = parseFloat(el ? el.value : "") || 0;
  return customBudgetObj(amt, days, peopleN) || BUDGETS.mid;
 }
 return BUDGETS[budgetKey] || BUDGETS.mid;
}

function buildProvinceCity(province){
 const pinfo = PROVINCE_INFO[province] || {};
 const marks = PROVINCE_LANDMARKS[province] || [];
 const periods = ["上午","下午","晚上","全天"];
 const firstCity = (PROVINCE_CITIES[province]||[])[0] || province;
 const base = findCity(firstCity, province) || {};
 const cityList = (PROVINCE_CITIES[province]||[]).slice(0,6);
 return {
  id: "province-"+province,
  name: province,
  region: base.region || "",
  climate: base.climate || "temperate",
  cost: base.cost || "mid",
  best: pinfo.best || base.best || "",
  foods: (pinfo.foods && pinfo.foods.length) ? pinfo.foods : (base.foods||["本地特色"]),
  foodNote: pinfo.foodNote || base.foodNote || "到省里走一圈，把各地招牌都尝一遍。",
  areas: cityList.map((c,i)=>({name: c, note: i===0 ? "省会/交通枢纽，住宿首选" : "省内主要城市，可高铁串联"})),
  stayTip: "全省精华游建议选省会或交通枢纽城市连住，用高铁/动车辐射周边景点，避免每天换酒店。",
  travel: pinfo.travel || base.travel || "省内城市间高铁/动车是最优选择，景点较分散可自驾或包车。",
  cityTravel: pinfo.cityTravel || base.cityTravel || "省内跨城用高铁，市区内公交/打车结合。",
  hotels: base.hotels || GEN_HOTELS,
  experiences: marks.map((lm,i)=>({
   name: lm,
   period: periods[i % periods.length],
   note: i===0 ? "全省标志性景点，建议第一站打卡" : (i===2 ? "夜晚的"+lm+"更有味道" : "省内经典去处，高铁/自驾可达")
  })),
  provinceMode: true
 };
}

function buildProvincePlanDays(province, days, depart, budgetKey, style, stayMountain, travelMode, bias){
 const stayM = stayMountain !== false; // 「名山过夜」开关：关掉后观日出名山不住山顶
 style = style || "balance";
 // v1.15：非法出发日期守卫（防 NaN 日期/静默跨月传染）
 const _dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(depart || "");
 const _dv = _dm ? new Date(Number(_dm[1]), Number(_dm[2]) - 1, Number(_dm[3])) : null;
 if (!_dv || isNaN(_dv.getTime()) || _dv.getFullYear() !== Number(_dm[1]) || _dv.getMonth() + 1 !== Number(_dm[2]) || _dv.getDate() !== Number(_dm[3])) return [];
 const marks = PROVINCE_LANDMARKS[province] || [];
 // 预算档位：custom 由输入金额推导（全省游人数按 2 估，金额档阈值见 tierOfPerDay）
 const tierKey = budgetTierKey(budgetKey || "mid", days, 2);
 const tier = {low:"经济", mid:"舒适", high:"高端"}[tierKey] || "舒适";
 const bStyle = BUDGET_STYLE[tierKey] || BUDGET_STYLE.mid;
 const capCity = PROVINCE_CAPITAL[province] || (PROVINCE_CITIES[province]||[])[0] || province;
 const cityDistKm = (a,b)=>{ const ca = getCoord(a), cb = getCoord(b); return (ca && cb) ? haversine(ca, cb) : 9999; };
 // 1. 景点 → 城市 分组（省地标用 getSpotCity 定位城市；每城高光景点直接归属本城，扩池填满每天）
 const groups = {};
 marks.forEach(m=>{
  const c = getSpotCityIn(m, province) || capCity;
  (groups[c] = groups[c] || []).push(m);
 });
 // v1.13：把每城的体验景点补进池子（每城补到 3 个左右，语义去重），
 // 解决「全省精华游每天只有一个景点 / 留白太多」
 (PROVINCE_CITIES[province] || []).forEach(cname=>{
  const fc = findCity(cname, province);
  if (!fc) return;
  const have = groups[cname] || (groups[cname] = []);
  const budget = Math.max(0, 4 - have.length);   // v1.17.4：3→4，让省内每城可玩内容更足（直接抬高全省精华游真实可玩天数）
  let added = 0;
  (fc.experiences || []).forEach(e=>{
   if (added >= budget) return;
   const nm = cleanSpotName(e && e.name);
   if (!nm || nm.length < 2) return;
   if (have.some(x => spotOverlap(x, nm))) return;   // 与省地标/已加景点语义重复
   have.push(nm);
   added++;
  });
 });
 // 2. 城市最近邻排序：从省会出发，每次取「离当前城市最近」的下一个城市 → 地理顺路不折返
 const ordered = [capCity];
 const rest = Object.keys(groups).filter(c=>c!==capCity);
 let curC = getCoord(capCity);
 while(rest.length){
  let bi=-1, bd=Infinity;
  rest.forEach((c,i)=>{ const cc = getCoord(c); if(cc && curC){ const d = haversine(cc, curC); if(d < bd){ bd = d; bi = i; } } });
  if(bi < 0) break;
  ordered.push(rest[bi]);
  curC = getCoord(rest[bi]);
  rest.splice(bi,1);
 }
 // 2b. v1.17.4：2-opt 局部搜索 —— 最近邻是贪心解，常留「交叉往返」。反复反转子路径，
 //     总里程下降就保留，把赶路里程进一步压低（起点固定在省会，故 i 从 1 开始）。
 const _legKm = (a,b)=>{ const ca=getCoord(a), cb=getCoord(b); return (ca&&cb) ? haversine(ca,cb) : 0; };
 const _pathKm = (p)=>{ let s=0; for(let i=1;i<p.length;i++) s += _legKm(p[i-1], p[i]); return s; };
 if(ordered.length >= 4){
  let bestRoute = ordered.slice(), bestKm = _pathKm(bestRoute);
  let improved = true, guard = 0;
  while(improved && guard++ < 60){
   improved = false;
   for(let i=1;i<bestRoute.length-1;i++){
    for(let j=i+1;j<bestRoute.length;j++){
     const cand = bestRoute.slice(0,i).concat(bestRoute.slice(i,j+1).reverse(), bestRoute.slice(j+1));
     const km = _pathKm(cand);
     if(km + 0.5 < bestKm){ bestRoute = cand; bestKm = km; improved = true; }
    }
   }
  }
  for(let i=0;i<bestRoute.length;i++) ordered[i] = bestRoute[i];
 }
 // 3. 平铺成地理有序的景点序列（城市顺序保证相邻景点顺路）
 // v1.15：攻略风格偏好（历史/自然）在每城内部排序，让偏好景点先进入每日分配
 if(bias === "history" || bias === "nature"){
  const histRx = /古迹|遗址|古城|古镇|寺|庙|祠|陵|宫|府|塔|楼|桥|街|博物馆|纪念馆|故居|碑|石窟|长城/;
  const natRx = /山|湖|江|海|草原|森林|峡谷|瀑布|沙漠|公园|湿地|冰川|梯田|岛|滩/;
  Object.keys(groups).forEach(c=>{
   groups[c] = (groups[c]||[]).slice().sort((a,b)=>{
    const ah = histRx.test(a)?1:0, bh = histRx.test(b)?1:0;
    const an = natRx.test(a)?1:0, bn = natRx.test(b)?1:0;
    if(bias === "history") return (bh - ah) || (an - bn);
    return (bn - an) || (bh - ah);
   });
  });
 }
 const allSpots = [];
 // v1.17.4：全局去重 —— 同一景点可能因「省地标归属城」与「该城 experiences 补池」双重来源被收录两次
 //（如雁门关同时落在忻州/朔州、应县木塔同时落在朔州/大同、天山天池同时落在乌鲁木齐/昌吉），
 // 会让同一次行程里重复出现同一景点。按景点名只保留首次出现。
 const _seenSpot = new Set();
 ordered.forEach(c=>(groups[c]||[]).forEach(s=>{
  if(!s || _seenSpot.has(s)) return;
  _seenSpot.add(s);
  allSpots.push({name:s, city:c});
 }));
 // v1.17.4：同城景点按「地理最近邻」重排（从上一城末点出发）。原始顺序会让
 // 同城但相距远的两点中间被塞进市区景点，导致本可同天的两点被拆散、徒增赶路。
 (()=>{
  const out = [];
  let i = 0;
  while(i < allSpots.length){
   let j = i;
   while(j < allSpots.length && allSpots[j].city === allSpots[i].city) j++;
   const seg = allSpots.slice(i, j);
   if(seg.length > 2){
    const pool = seg.slice();
    let cur = null;
    if(out.length){
     const pg = getSpotCoord(out[out.length-1].city, out[out.length-1].name);
     if(pg && pg.lat != null) cur = {lat:pg.lat, lon:pg.lon};
    }
    while(pool.length){
     let bi = 0, bd = Infinity;
     if(cur){
      pool.forEach((s,k)=>{
       const g = getSpotCoord(s.city, s.name);
       if(g && g.lat != null){ const d = haversine({lat:g.lat,lon:g.lon}, cur); if(d < bd){ bd = d; bi = k; } }
      });
     }
     const pick = pool.splice(bi,1)[0];
     out.push(pick);
     const g = getSpotCoord(pick.city, pick.name);
     if(g && g.lat != null) cur = {lat:g.lat, lon:g.lon};
    }
   } else {
    seg.forEach(s=>out.push(s));
   }
   i = j;
  }
  allSpots.length = 0;
  allSpots.push(...out);
 })();
 // 4. 贪心分组：每天一组，同组内最多 maxPerDay 个景点（休闲 2 个 / 平衡与特种兵 3 个），
 //  且两景点必须「同城或相邻（≤150km）」→ 不来回奔波
 const maxPerDay = style === "leisure" ? 2 : 3;
 const daySpots = [];
 let buf = [];
 for(const sp of allSpots){
  if(bigSpotInfo(sp.name)){
   // 大景点（故宫/张家界/黄山…）单独成组：不与小景点混排，避免走马观花
   if(buf.length){ daySpots.push(buf); buf = []; }
   daySpots.push([sp]);
   continue;
  }
  if(!buf.length){ buf = [sp]; continue; }
  const last = buf[buf.length-1];
  const sameCity = last.city === sp.city;
  const near = cityDistKm(last.city, sp.city) <= 150;
  // v1.17.4：光「同城」不足以判定能一天跑完 —— 阿勒泰/甘孜/呼伦贝尔这类超大地级区，
  // 同地区两景点也可能相距数百公里（禾木 vs 可可托海）。同城还需景点间直线 ≤150km。
  const spotNear = (()=>{
   const ca = getSpotCoord(last.city, last.name), cb = getSpotCoord(sp.city, sp.name);
   if(!ca || !cb || ca.lat == null || cb.lat == null) return true;   // 无坐标时不额外设限
   return haversine({lat:ca.lat, lon:ca.lon}, {lat:cb.lat, lon:cb.lon}) <= 150;
  })();
  const hasCross = buf.some((x,xi)=>xi>0 && x.city !== buf[0].city);
  if(buf.length < maxPerDay){
   if(sameCity && spotNear){ buf.push(sp); continue; }
   // v1.17.4：第二条同样要过 spotNear —— 否则「同城」会让 cityDistKm 恒为 0、near 恒真，
   // 把禾木村(87.4E) 与可可托海(89.9E) 这种相距 220km 的同地区景点塞进同一天。
   if(!hasCross && near && spotNear){ buf.push(sp); continue; }
  }
  daySpots.push(buf); buf = [sp];
 }
 if(buf.length) daySpots.push(buf);
 // 单景点组：并入相邻组（合并后 ≤maxPerDay 且 与组末城距离 ≤150km，避免跨远城奔波），否则保留（当天补自由探索）
 // 大景点组（含大景点的单组）绝不参与合并 → 保证大景点真正单独一天
 const canMerge = (target, lonely)=>{
  if(target.length + lonely.length > maxPerDay) return false;
  if(target.length === 1 && bigSpotInfo(target[0].name)) return false;
  if(lonely.length === 1 && bigSpotInfo(lonely[0].name)) return false;
  const tLast = target[target.length-1], lFirst = lonely[0];
  // v1.17.4：同城也要看景点间实际距离（超大地级区同城可相距数百公里）
  if(tLast.city === lFirst.city){
   const ca = getSpotCoord(tLast.city, tLast.name), cb = getSpotCoord(lFirst.city, lFirst.name);
   if(ca && cb && ca.lat != null && cb.lat != null){
    return haversine({lat:ca.lat, lon:ca.lon}, {lat:cb.lat, lon:cb.lon}) <= 150;
   }
   return true;
  }
  return cityDistKm(tLast.city, lFirst.city) <= 150;
 };
 for(let i=0;i<daySpots.length;){
  if(daySpots[i].length >= 2){ i++; continue; }
  const lonely = daySpots[i];
  if(i > 0 && canMerge(daySpots[i-1], lonely)){
   daySpots[i-1] = daySpots[i-1].concat(lonely);
   daySpots.splice(i,1);
   continue;
  }
  if(i < daySpots.length-1 && canMerge(daySpots[i+1], lonely)){
   daySpots[i+1] = lonely.concat(daySpots[i+1]);
   daySpots.splice(i,1);
   continue;
  }
  i++;
 }
 // 5. 天数适配：组多于 days → 截断；组少于 days → 末组拆散补天（同城连玩）
 let groupsOfDay = daySpots.slice(0, Math.max(1, days));
 if(groupsOfDay.length < daySpots.length){
  // 天数不足：被截掉的大景点组（如九寨沟）换回、顶掉末尾的普通组 → 大景点专线日优先保留
  for(let k = groupsOfDay.length; k < daySpots.length; k++){
   const g = daySpots[k];
   if(bigSpotInfo(g[0].name)){
    for(let j = groupsOfDay.length - 1; j >= 0; j--){
     if(!bigSpotInfo(groupsOfDay[j][0].name)){ groupsOfDay[j] = g; break; }
    }
   }
  }
 }
 // 观日出名山（华山/泰山/黄山…）次日需看日出，不能放末日：与前面的普通组交换（仅在开启名山过夜时）
 if(stayM && groupsOfDay.length >= 2){
  const lastG = groupsOfDay[groupsOfDay.length-1];
  if(lastG.length === 1 && sunriseSpotInfo(lastG[0].name)){
   for(let j = groupsOfDay.length-2; j >= 0; j--){
    const g = groupsOfDay[j];
    if(g.length === 1 && sunriseSpotInfo(g[0].name)) break; // 前面已是观日出组，无法安置
    if(!(g.length === 1 && bigSpotInfo(g[0].name))){ // 找普通组交换
     groupsOfDay[j] = lastG;
     groupsOfDay[groupsOfDay.length-1] = g;
     break;
    }
   }
  }
 }
 // v1.17.5：组数不足 days 时，循环拆分「景点最多的组」直到凑够天数（或无可再拆）。
 // 旧实现只把末组 3 拆成 2+1（至多补 1 天），导致直辖市/小省「要 7 天只给 5 天」的静默缩水。
 if(groupsOfDay.length < days){
  let guard = 0;
  // 拆组下限跟随节奏：休闲（每天 2 个）可拆到 1 个，平衡/特种兵（每天 3 个）拆到 2 个。
  // 否则会一路拆到「每景点一天」，上限退化成景点总数（四川会得出 60 天这种极端值）；
  // 但休闲节奏本身每天就只排 2 个，必须允许拆到 1 个，否则天数补不足。
  const splitFloor = maxPerDay <= 2 ? 1 : 2;
  while(groupsOfDay.length < days && guard++ < 400){
   let mi = -1, ml = splitFloor;
   for(let k=0;k<groupsOfDay.length;k++){
    if(groupsOfDay[k].length > ml){ ml = groupsOfDay[k].length; mi = k; }
   }
   if(mi < 0) break;
   const g = groupsOfDay[mi];
   groupsOfDay[mi] = g.slice(0, g.length - 1);
   groupsOfDay.splice(mi + 1, 0, [g[g.length - 1]]);
  }
 }
 // 6. 酒店：按城市取（跟随行程变动）
 const hotelPick = c=>{
  const fc = findCity(c, province) || {};
  const hl = fc.hotels || GEN_HOTELS;
  const h = hl.find(x=>x.tier===tier) || hl[1] || hl[0];
  return `${c} · ${h.place}｜${String(h.brands).split("·")[0]}`;
 };
 // 7. 按天生成 items（组内跨城时加「前往」转场条目）
 const planDays = [];
 let pendingSunrise = null; // 前一天为观日出专线 → 今天清晨注入「看日出+下山」
 for(let i=0;i<groupsOfDay.length;i++){
  const g = groupsOfDay[i];
  const isFirst = i===0, isLast = i===groupsOfDay.length-1;
  const firstCity = g[0].city, lastCity = g[g.length-1].city;
  const prevCity = planDays.length ? planDays[planDays.length-1].cityName : null;
  const needTransfer = !isFirst && firstCity !== prevCity;
  const twoCities = g.length === 2 && g[0].city !== g[1].city;
  const items = [];
  // 前一天是观日出专线日 → 今天凌晨看日出 + 上午下山
  if(pendingSunrise){
   const sInfo = sunriseSpotInfo(pendingSunrise) || {};
   const view = sInfo.view || "观景台";
   items.push({name:`凌晨出发，前往「${view}」`, period:"凌晨", note:"按山顶酒店叫早时间起床，备好外套/头灯，日出前 30 分钟到位"});
   items.push({name:"看日出 · 云海", period:"清晨", note:"日出时间随季节变化（夏季约 5:00、冬季约 6:30），前一晚记得查天气"});
   items.push({name:"下山 + 早餐", period:"上午", note:"乘索道/缆车下山，回到市区吃顿热乎的早餐"});
   pendingSunrise = null;
  }
  if(isFirst){
   items.push({name:`抵达 + 入住「${hotelPick(firstCity)}」`, period:"早上", note:"全省精华游开启，先安顿再出发"});
   if(style === "leisure"){
    items.push({name:`${g[0].name}（${g[0].city}）`, period:"上午", note:"第一天别赶，慢慢熟悉这座城市"});
    items.push({name:"当地自由探索", period:"晚上", note:"傍晚走走，找家本地馆子"}); 
   } else if(g.length === 1 && bigSpotInfo(g[0].name)){
    const bi = bigSpotInfo(g[0].name);
    const si = stayM ? sunriseSpotInfo(g[0].name) : null;
    if(si){
     items.push({name:`深度游览 + 登山「${g[0].name}」（${g[0].city}）`, period:"上午", note:`${bi.reason || "大景点面积大，单独一天慢慢逛"}；傍晚前抵达山顶`});
     items.push({name:`入住山顶酒店（近${si.view}）`, period:"傍晚", note:si.note});
     items.push({name:"山顶晚餐 · 早点休息", period:"晚上", note:"明早看日出，22:00 前睡，保存体力"});
     pendingSunrise = g[0].name;
    } else {
     items.push({name:`深度游览「${g[0].name}」（${g[0].city}）`, period:"上午", note:`大景点专属日：${bi.reason || "面积大，单独一天慢慢逛"}（建议 ${bi.hours || "一整天"}）`});
     items.push({name:"休整 · 当地美食", period:"晚上", note:"第一天别太赶，用当地味道收尾"});
    }
   } else {
    items.push({name:`${g[0].name}（${g[0].city}）`, period:"上午", note:"省内经典景点，安顿后直奔"});
    if(twoCities){
     items.push({name:`前往 ${g[1].city}${cityLegTxt(g[0].city, g[1].city)}`, period:"下午", note:"相邻城市，转场顺路"});
     items.push({name:`${g[1].name}（${g[1].city}）`, period:"晚上", note:"夜景更出片"});
     items.push({name:`入住「${hotelPick(g[1].city)}」`, period:_hotelPeriod(items), note:"酒店随行程到下一城"});
    } else if(g[1]) {
     items.push({name:`${g[1].name}（${g[1].city}）`, period:"下午", note:"下午光线好，错开人流"});
     if(g[2]) items.push({name:`${g[2].name}（${g[2].city}）`, period:"晚上", note:"特种兵加餐，顺路打卡"});
     else items.push({name:"当地自由探索", period:"晚上", note:"夜景更出片，逛逛再回酒店"});
    } else {
     items.push({name:"当地自由探索", period:"下午", note:"第一天先放松，逛逛夜市或江边"});
    }
   }
  } else if(isLast){
   const hadSunrise = items.some(it => it.period === "凌晨");
   items.push({name: hadSunrise ? "回酒店退房寄存行李" : "退房寄存行李 + 当地早餐", period: hadSunrise ? "上午" : "早上", note: hadSunrise ? "看完日出下山后回住处退房寄存，轻装收尾" : "收拾行李，用当地味道收尾"});
   if(g.length === 1 && bigSpotInfo(g[0].name)){
    const bi = bigSpotInfo(g[0].name);
    const si = stayM ? sunriseSpotInfo(g[0].name) : null;
    items.push({name:`深度游览「${g[0].name}」（${g[0].city}）`, period:"上午", note: si ? `大景点专属日：建议 ${bi.hours || "一整天"}；想看日出可提前一晚住山顶（${si.view}）` : `大景点专属日：建议 ${bi.hours || "一整天"}，最后一天也慢慢逛`});
    items.push({name:`继续深度游览「${g[0].name}」`, period:"下午", note:"不走马观花，能看多深看多深"});
   } else {
    items.push({name:`${g[0].name}（${g[0].city}）`, period:"上午", note:"最后半天，别错过"});
    if(style === "leisure"){
     items.push({name:"当地自由探索", period:"下午", note:"最后半天随心情安排，买点伴手礼"});
    } else {
     if(g[1]) items.push({name:`${g[1].name}（${g[1].city}）`, period:"下午", note:""});
     else items.push({name:"当地自由探索", period:"下午", note:"最后半天随心情安排"});
     if(g[2]) items.push({name:`${g[2].name}（${g[2].city}）`, period:"傍晚", note:"特种兵收尾，能多打一个卡是一个"});
    }
   }
   items.push({name:"返程", period:tailPeriod(items), note:"预留充足时间前往机场/车站"});
  } else {
   if(needTransfer){
    const hadSunrise = items.some(it => it.period === "凌晨");
    items.push({name: hadSunrise ? "回酒店退房寄存行李" : "退房寄存行李", period: hadSunrise ? "上午" : "早上", note: hadSunrise ? "看完日出下山后回住处退房寄存，轻装转场" : "换一座城，继续省内之旅"});
    items.push({name:`前往 ${firstCity}${cityLegTxt(prevCity, firstCity)}`, period:"上午", note:"省内高铁/动车最方便，行李随行"});
   }
   if(style === "leisure"){
    // 休闲：每天 1 个主景点，晚上自由，不硬塞；观日出名山则上山住山顶
    const si = g.length === 1 ? (stayM ? sunriseSpotInfo(g[0].name) : null) : null;
    if(si){
     items.push({name:`深度游览 + 登山「${g[0].name}」（${g[0].city}）`, period: needTransfer ? "下午" : "上午", note: needTransfer ? "到达后直奔景区，沿主游线登山/乘索道" : "慢节奏，一个景点玩透；下午往高处走"});
     items.push({name:`入住山顶酒店（近${si.view}）`, period:"傍晚", note:si.note});
     items.push({name:"山顶晚餐 · 早点休息", period:"晚上", note:"明早看日出，保存体力"});
     pendingSunrise = g[0].name;
    } else {
     items.push({name:`${g[0].name}（${g[0].city}）`, period: needTransfer ? "下午" : "上午", note: needTransfer ? "到达后先玩核心景点" : "慢节奏，一个景点玩透再走"});
     items.push({name:"当地自由探索", period:"晚上", note:"咖啡馆/老街/江边，随心情"});
     if(needTransfer) items.push({name:`入住「${hotelPick(firstCity)}」`, period:_hotelPeriod(items), note:"酒店已按当天城市推荐"});
    }
   } else if(twoCities){
    items.push({name:`${g[0].name}（${g[0].city}）`, period:"下午", note:"到达后先玩核心景点"});
    items.push({name:`前往 ${g[1].city}${cityLegTxt(g[0].city, g[1].city)}`, period:"傍晚", note:"相邻城市，转场顺路"});
    items.push({name:`${g[1].name}（${g[1].city}）`, period:"晚上", note:"夜晚的风景更有味道"});
    items.push({name:`入住「${hotelPick(g[1].city)}」`, period:_hotelPeriod(items), note:"酒店已按当天城市推荐"});
   } else if(g.length === 1 && bigSpotInfo(g[0].name)){
    const bi = bigSpotInfo(g[0].name);
    const si = stayM ? sunriseSpotInfo(g[0].name) : null;
    if(si){
     if(needTransfer){
      items.push({name:`深度游览 + 登山「${g[0].name}」（${g[0].city}）`, period:"下午", note:`到达后直奔景区：${bi.reason || "大景点面积大"}，沿主游线登山/乘索道`});
     } else {
      items.push({name:`深度游览「${g[0].name}」（${g[0].city}）`, period:"上午", note:`大景点专属日：${bi.reason || "面积大，单独一天慢慢逛"}`});
      items.push({name:`继续游览 + 登山/索道上行`, period:"下午", note:"沿主游线往高处走，傍晚前抵达山顶"});
     }
     items.push({name:`入住山顶酒店（近${si.view}）`, period:"傍晚", note:si.note});
     items.push({name:"山顶晚餐 · 早点休息", period:"晚上", note:"明早看日出，22:00 前睡，保存体力"});
     pendingSunrise = g[0].name;
    } else {
     items.push({name:`深度游览「${g[0].name}」（${g[0].city}）`, period: needTransfer ? "下午" : "上午", note: needTransfer ? "到达后直奔大景点" : `大景点专属日：${bi.reason || "面积大，单独一天慢慢逛"}`});
     items.push({name:`继续深度游览「${g[0].name}」`, period: needTransfer ? "晚上" : "下午", note:`官方建议游览 ${bi.hours || "一整天"}，不走马观花`});
     if(needTransfer) items.push({name:`入住「${hotelPick(firstCity)}」`, period:_hotelPeriod(items), note:"酒店已按当天城市推荐"});
     else items.push(mealTail(items, "晚上", i, province));
    }
   } else {
    items.push({name:`${g[0].name}（${g[0].city}）`, period: needTransfer ? "下午" : "上午", note: needTransfer ? "到达后先玩核心景点" : "同城连玩，省去奔波"});
    if(g[1]) items.push({name:`${g[1].name}（${g[1].city}）`, period: needTransfer ? "晚上" : "下午", note:""});
    else items.push({name:"当地自由探索", period:"晚上", note:"傍晚走走逛逛"});
    if(g[2]) items.push({name:`${g[2].name}（${g[2].city}）`, period: needTransfer ? "深夜" : "晚上", note:"特种兵加餐，顺路打卡"});
    if(needTransfer) items.push({name:`入住「${hotelPick(firstCity)}」`, period:_hotelPeriod(items), note:"酒店已按当天城市推荐"});
   }
  }
  const d = _dm ? new Date(+_dm[1], +_dm[2]-1, +_dm[3]) : new Date(); d.setDate(d.getDate()+i);
  const isoDate = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const theme = isFirst ? "全省精华游 · 起" : (isLast ? "收尾 · 返程" : (needTransfer ? "转场 · "+firstCity : "继续 · "+firstCity));
  const title = isFirst ? "初见"+province : (isLast ? "告别"+province : "探索"+firstCity);
  const spotCount = items.filter(it=>!/^(抵达|退房|返程|前往|入住)/.test(it.name) && !/自由探索/.test(it.name)).length;
  const __dayCity = findCity(lastCity, province) || {};
  const __dayFoods = (__dayCity.foods && __dayCity.foods.length) ? __dayCity.foods
   : ((PROVINCE_CITY_FOODS && PROVINCE_CITY_FOODS[province]) || []);
  planDays.push({date: isoDate, theme, items, title, cityName: lastCity, seg: 0, pace: spotCount<=2?"轻松":(spotCount<=3?"适中":"紧凑"), spotCount,
   meal: budgetMealText(bStyle, __dayFoods, i)});
 }
 return planDays;
}

function spotEffort(name){
 if(!name) return 1;
 const hi = /山|峰|岭|峡谷|栈道|徒步|石窟|长城|瀑布|登山|台阶|爬升|索道|坡|天门|栈道/.test(name);
 const low = /湖|古镇|古村|博物馆|美术馆|纪念馆|街区|老街|广场|公园|园林|寺庙|教堂|演出|夜市|步行街|美食街|江|海边|沙滩|遗址|塔|河|桥|岛|洞/.test(name);
 if(hi && !low) return 2;
 if(low && !hi) return 0;
 return 1;
}

function cleanSpotName(name){
 const raw = String(name || "").trim();
 let n = raw.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
 n = n.replace(/[（(【].*?[)）】]/g, "").trim();
 return n || raw;
}

function uriEnc(s){ return encodeURIComponent(String(s == null ? "" : s)).replace(/'/g, "%27"); }

function budgetStyleOf(budgetKey, opt){
 opt = opt || {};
 let k = opt.tier || (opt.perDay ? tierOfPerDay(opt.perDay) : budgetTierKey(budgetKey, opt.days, opt.peopleN));
 return BUDGET_STYLE[k] || BUDGET_STYLE.mid;
}

function tierOfPerDay(perDay){
 const p = perDay || 450;
 if(p < 300) return "low";
 if(p < 600) return "mid";
 return "high";
}

function budgetTierKey(budgetKey, days, peopleN){
 if(budgetKey === "custom"){
  let amt = 0;
  try{
   const el = (typeof document !== "undefined" && document.getElementById) ? document.getElementById("customBudget") : null;
   amt = parseFloat(el ? el.value : "") || 0;
  }catch(e){ amt = 0; }
  if(amt > 0) return tierOfPerDay(amt / Math.max(1, days||1) / Math.max(1, peopleN||1));
  return "mid";
 }
 return BUDGETS[budgetKey] ? budgetKey : "mid";
}

function shopBand(priceStr){
 const p = rangePair(priceStr);
 if(!p) return null;
 const n = p.hi;
 return {n, band: n <= 60 ? "low" : (n <= 150 ? "mid" : "high"),
  label: n <= 60 ? "平价" : (n <= 150 ? "中档" : "高档")};
}

function budgetMealText(style, foods, i){
 const fs = (foods && foods.length) ? foods : ["本地特色菜", "地道小吃"];
 const a = fs[i % fs.length];
 const b = fs[(i + 1) % fs.length];
 // v1.11：fuzz 抓到 style 为 null/undefined 时 `style.label` 抛错 → 给个默认 label
 const st = style || {};
 const pl = st.eatPlan || {bf:"特色早餐", lunch:"尝 {A}", dinner:"吃 {B}"};
 const bf = pl.bf || "特色早餐";
 const lf = String(pl.lunch || "尝 {A}").split("{A}").join(a);
 const df = String(pl.dinner || "吃 {B}").split("{B}").join(b);
 return `${st.label || ""}餐食｜早餐${bf}，午餐${lf}，晚餐${df}`;
}

function budgetFoodDaily(key){
 const b = BUDGETS[key];
 return b ? moneyStr(rangePair(b.food)) : "";
}

function rangePair(str){
 const nums = String(str || "").match(/\d+(?:\.\d+)?/g);
 if(!nums || !nums.length) return null;
 const a = parseFloat(nums[0]);
 const b = nums.length > 1 ? parseFloat(nums[1]) : a;
 return {lo: Math.min(a, b), hi: Math.max(a, b)};
}

function getProfile(){
 return _read(PROFILE_KEY, null);   // v1.11：改走适配器（小程序无 localStorage）
}

function profileAdjustedFoods(foods){
 const p = getProfile();
 if(!p || !foods || !foods.length || p.taste === "balance") return foods;
 const heavyRe = /辣|麻|烤|卤|火锅|烧烤|串|香锅|干锅|重口|剁椒/;
 const lightRe = /汤|粥|清蒸|白灼|清淡|养生|素|炖|羹/;
 const arr = foods.slice();
 if(p.taste === "heavy") arr.sort((a,b)=> (heavyRe.test(b)?1:0) - (heavyRe.test(a)?1:0));
 else if(p.taste === "light") arr.sort((a,b)=> (lightRe.test(b)?1:0) - (lightRe.test(a)?1:0));
 return arr;
}

function sunriseSpotInfo(name){
 if(typeof name !== "string" || !name) return null;   // v1.11：fuzz 守卫
 if(BIG_EXCLUDE.some(x=>name.indexOf(x) >= 0)) return null;
 if(name.indexOf("九华山") >= 0) return null; // 九华山≠华山（日出库未收录九华山，避免误配华山日出数据）
 return bestMatch(name, SUNRISE_SPOTS);
}

// 想玩命中判定（对齐 travel.js wishHit）：清洗名相等或互相包含 →
// 「勾了故宫」也能优先安排合并大条目「天安门广场 + 故宫博物院」，反之亦然
function isWished(name){
 const w = getWish();
 if(!w.length || !name) return false;
 const n = cleanSpotName(name);
 if(!n) return false;
 // 与 travel.js 的 _wishNameHit 同规则：前缀命中 / 组合名分段命中，
 // 不再用「任意子串互相包含」（否则勾「西湖」会命中北京的「龙潭西湖公园」）。
 const _seg = (s) => String(s || "").split(/[+＋/、·,，]/).map(v => v.trim()).filter(v => v.length >= 2);
 return w.some(x => {
  const wn = cleanSpotName(x.name);
  if(!wn) return false;
  if(wn === n) return true;
  const ns = _seg(n), ws = _seg(wn);
  for(const a of ns) for(const b of ws){
   if(a === b) return true;
   // 前缀或后缀命中：故宫 → 故宫博物院；总统府 → 南京总统府；长城 → 八达岭长城
   if(a.indexOf(b) === 0 || b.indexOf(a) === 0) return true;
   if(a.length > b.length && a.endsWith(b)) return true;
   if(b.length > a.length && b.endsWith(a)) return true;
  }
  return false;
 });
}

function spotOpenNote(name, cityName, fromDetail){
 if(!name || /^(抵达|退房|返程|前往)/.test(name)) return "";
 if(fromDetail) return ""; // 由 spotDetailHtml 内部调用时跳过，避免互相递归
 const h = spotDetailHtml(name, cityName);
 if(!h) return "";
 const notes = [];
 const m = h.match(/([0-9]{1,2}[:：][0-9]{2}\s*[-~至到]\s*[0-9]{1,2}[:：][0-9]{2})/);
 if(m) notes.push(m[1].replace(/[:：]/g,":").replace(/\s+/g,""));
 const closed = h.match(/([周][一二三四五六日天])?闭馆/);
 if(closed) notes.push((closed[1] || "每周一") + "闭馆");
 if(/预约/.test(h)) notes.push("需提前预约");
 return notes.join(" · ");
}

function spotDetailExtras(name, cityName){
 try{
  const parts = [];
  parts.push(`<div class="sd-sec">⏰ 错峰建议</div><div class="sd-how">${spotOffpeak(name)}</div>`);
  const hd = spotHidden(name);
  if(hd) parts.push(`<div class="sd-sec">冷知识</div><div class="sd-how">${hd}</div>`);
  parts.push(`<div class="sd-sec">出片</div><div class="sd-how">${photoTip(name)}</div>`);
  return parts.join("");
 }catch(e){ return ""; }
}

function spotDetailFallback(name, cityName){
 const n = name || "";
 const c = cityName || "当地";
 const h = spotHours(n);
 const typeOf = () => {
  if(/山|峰|峡谷|岭|栈道|徒步|长城|草原|梯田/.test(n)) return "mountain";
  if(/湖|江|河|海|海滩|岛|湾|泉|水库|溪/.test(n)) return "lake";
  if(/博物馆|美术馆|纪念馆|科技馆|天文馆|展览|艺术区|图书馆/.test(n)) return "museum";
  if(/古镇|古村|古城|老街|街区|胡同|文化街|巷/.test(n)) return "oldtown";
  if(/寺|庙|教堂|观|塔/.test(n)) return "temple";
  if(/公园|园林|植物园|动物园/.test(n)) return "park";
  if(/乐园|欢乐世界|度假区|影视城|海洋王国/.test(n)) return "theme";
  if(/夜|演出|秀|演艺|演艺中心/.test(n)) return "show";
  if(/桥|广场|地标|中心|大道/.test(n)) return "landmark";
  if(/洞|溶洞|石窟|岩/.test(n)) return "cave";
  return "generic";
 };
 const t = typeOf();
 const hoursTxt = h >= 8 ? "建议留一整天，别赶" : (h >= 4 ? "建议留半天左右" : "留 1-2 小时逛逛足够");
 const T = {
  mountain: {
   intro: `${c}的山岳型景区「${n}」以峰林/峡谷/高山草甸等自然风光见长，以爬升与徒步为主。${hoursTxt}；山顶风大温差大，夏季防晒、冬季保暖，穿防滑运动鞋，备足饮用水。部分路段（栈道/索道）单独收费。`,
   how: `导航搜「${n}」直达；多数名山有景区大巴 + 索道/缆车上下山，可线上购票+分时段预约。建议上午 8-9 点入园错峰，雨雪或大风天气部分路段临时封闭，出发前查景区公告。`,
   route: ["游客中心/售票处", "登山道或索道上站", "核心观景点（登高远眺）", "途中补给/观景平台", "环线或原路下山"]
  },
  lake: {
   intro: `${c}的「${n}」是当地代表性水景，湖光山色适合慢节奏游览。${hoursTxt}；可环湖散步/骑行、乘船游湖（船票另计），傍晚光线最好、最出片。湖边风大，注意防晒防风。`,
   how: `导航搜「${n}」直达；环湖路线可步行/骑行或乘观光车，游船码头现场或线上购票。清晨人少清静，黄昏适合拍照，节假日建议上午去。`,
   route: ["入口/游客中心", "湖滨观景平台", "游船码头（可选）", "环湖步道/骑行段", "日落观景点"]
  },
  museum: {
   intro: `${c}的「${n}」以馆藏文物/艺术展陈为主，室内场馆不受天气影响。${hoursTxt}；多数免费但需线上预约（周一闭馆），可租语音导览或蹭免费讲解时段，看展顺序按展厅编号走最顺。`,
   how: `多数博物馆地铁直达；免费场馆务必提前 1-7 天在官方公众号/官网预约，带身份证入场。周一闭馆，节假日热门时段需抢票，建议预约上午场。`,
   route: ["入口安检/取票", "常设展厅（按编号）", "特展区（如有）", "文创商店/咖啡休憩", "出口"]
  },
  oldtown: {
   intro: `${c}的「${n}」保留传统街巷与老建筑，适合穿行慢逛、拍照打卡，巷子里常藏着本地小吃和老字号。${hoursTxt}；建议傍晚去，华灯初上最有味道。`,
   how: `导航搜「${n}」直达，多数街区免费开放；主街商业化程度高，想体验烟火气就往支巷钻。街区内小吃多，正餐可找居民区老店。`,
   route: ["街区入口/牌坊", "主街老建筑带", "支巷/故居或手工作坊", "小吃街或茶馆", "夜景打卡点"]
  },
  temple: {
   intro: `${c}的「${n}」是本地香火/历史最盛的古建之一，适合静心游览。${hoursTxt}；晨间人少清静、光影好，傍晚有仪式感的可留意。寺内注意着装与拍摄礼仪，部分殿宇需另购香花券。`,
   how: `导航搜「${n}」直达；门票多现场或线上均可，初一十五及节假日人流大建议早到。寺内动线一般中轴进、侧殿出，顺时针游览更顺。`,
   route: ["山门/检票口", "主殿（大雄宝殿等）", "偏殿/藏经阁", "古树或园林庭院", "出口"]
  },
  park: {
   intro: `${c}的「${n}」是本地人日常休闲的城市绿地/园林，免费或低价，适合散步放松。${hoursTxt}；清晨有晨练氛围，周末是遛娃/野餐热门地，春秋两季最美。`,
   how: `导航搜「${n}」直达，多数公园免费开放或门票 10 元内；园内可租船/骑行（另收费）。建议清晨或傍晚入园，避开正午暴晒。`,
   route: ["主入口", "园内标志景观/湖泊", "步道环线", "草坪/休憩区", "出口"]
  },
  theme: {
   intro: `${c}的「${n}」是大型主题乐园/度假区，项目多、演出密，${hoursTxt}。热门项目排队久，建议开园就进、优先冲热门项目，下载官方 App 看排队与预约，穿舒适鞋、轻装简行。`,
   how: `导航搜「${n}」直达；门票需提前在官方渠道购买并预约入园日期，高峰期建议买早享/快速通。带孩子的注意身高限制，可带水杯（园内接水）。`,
   route: ["入园安检/检票", "热门项目（开园首冲）", "主题区巡游/演出", "餐饮休憩", "烟花/灯光秀（晚间）"]
  },
  show: {
   intro: `${c}的「${n}」是当地特色演出/夜游项目，以灯光、演艺、沉浸体验为主。${hoursTxt}；建议提前订票选座（中后排视野更好），晚场注意散场交通。`,
   how: `导航搜「${n}」直达；演出票在官方渠道或大平台提前 1-3 天预订，热门场次需抢。提前 20-30 分钟到场取票入场。`,
   route: ["入口/取票", "检票入场", "观演/体验区", "散场离场"]
  },
  landmark: {
   intro: `${c}的「${n}」是当地代表性地标，适合打卡拍照、登高望远。${hoursTxt}；白天与夜景各有味道，傍晚时段可同时收获黄昏与夜景，人少又好出片。`,
   how: `导航搜「${n}」直达，多位于市中心交通便利；登高类（塔/观景台）需购票并可能限流，建议线上预约。`,
   route: ["地标正面打卡点", "登高观景（如可登）", "周边街区漫步", "夜景拍照点"]
  },
  cave: {
   intro: `${c}的「${n}」是喀斯特/溶洞或石窟类景观，洞内恒温、避暑效果好。${hoursTxt}；洞内灯光秀是亮点，注意地面湿滑，穿防滑鞋，夏季洞内外温差大可带薄外套。`,
   how: `导航搜「${n}」直达；一般有讲解团或游船（洞内地下河），建议跟讲解团走能看懂更多地质奇观。`,
   route: ["入口大厅", "洞内主游线（灯光区）", "地下河/游船段（如有）", "出口"]
  },
  generic: {
   intro: `${c}的「${n}」是本地值得一去的去处。${hoursTxt}；建议避开周末正午人流高峰，提前在线上查好开放时间与是否需预约，带好证件。`,
   how: `导航搜「${n}」直达；市区景点地铁/公交可达，郊区建议打车或景区直通车。旺季早到，出发前看官方公告确认开放状态。`,
   route: ["入口/游客中心", "核心游览区", "拍照/休息点", "出口"]
  }
 };
 const tpl = T[t] || T.generic;
 const chars = spotCharacter(n, c);
 const howTxt = spotHowTo(n, c);
 return `<div class="sd-intro">${tpl.intro}${chars.length ? `<br><br><b style="color:#d4a94e">特色看点</b><br>` + chars.map(x=>`<span class="sd-char">· ${x}</span><br>`).join("") : ""}</div>
  <div class="sd-sec">怎么去</div><div class="sd-how">${howTxt}</div>
  <div class="sd-sec">推荐游览线路</div>
  <div class="sd-route">${tpl.route.map((r,i)=>`<span class="sd-node">${i+1}. ${r}</span>${i<tpl.route.length-1?'<span class="sd-arrow">→</span>':''}`).join("")}</div>
  <div class="sd-sec">⏱ 游玩时长</div><div class="sd-how">预计 ${h} 小时${h>=8 ? "（大景点，建议独占一天深度游览）" : ""}；具体以当日人流与个人节奏为准。</div>` + spotDetailExtras(name, cityName);
}

// v1.11：fuzz 抓到 list 非数组 / item 无 kw / name 非字符串 时整函数抛错 → 全部守卫
function bestMatch(name, list){
 if(!Array.isArray(list) || typeof name !== "string" || !name) return null;
 if(MATCH_DENY.some(x => name.indexOf(x) >= 0)) return null;
 let best = null, bestLen = 0;
 for(const b of list){
  if(!b || !Array.isArray(b.kw)) continue;
  for(const kw of b.kw){
   if(typeof kw !== "string") continue;
   let at = name.indexOf(kw);
   if(at < 0) continue;
   const isMt = kw.charAt(kw.length - 1) === "山";
   let hit = false;
   for(let from = 0; ; from = at + 1){
    at = name.indexOf(kw, from);
    if(at < 0) break;
    if(suffixOk(name.slice(at + kw.length)) && (!isMt || prefixOk(name.slice(0, at)))) { hit = true; break; }
   }
   if(!hit) continue;
   if(kw.length > bestLen){ best = b; bestLen = kw.length; }
  }
 }
 return best;
}
// v1.19.9 关键词匹配收紧。keyword 表存的是「具体景区名」，但原来用全书 indexOf 匹配，于是
// 「青华山/翠华山/华山国际乡村俱乐部」「泰山区泰山方特欢乐世界」「齐长城百果园」「沈阳故宫」
// 全被误配上对应景区的「日出/大景点专线」数据 —— 真实用户会拿到「在青岛看华山日出、住山顶酒店」。
// 规则①：关键词之后只能是通用后缀（景区/公园/索道/博物馆…，可用 / 、 + 连接多段），
//        或「（…）」式说明；否则视为另一个地方。
function suffixOk(post){
 if(!post) return true;
 if(/^（[^）]{1,10}）$/.test(post)) return true;
 return post.split(/[／\/＋+、·，,－—-]/).every(seg => {
  const t = seg.trim();
  if(!t) return true;
  return /^[\u4e00-\u9fa5A-Za-z0-9]{0,3}?(风景名胜区|风景区|旅游景区|旅游区|景区|国家森林公园|森林公园|公园|地质公园|博物馆|博物院|遗址|古镇|乐园|度假区|小镇|王国|世界|中心|索道站|索道|大门|入口|游客中心|大峡谷|剧场|滑雪场|冰川公园|天池|湖|岛|沟|前山|后山|山)$/.test(t);
 });
}
// 规则②：以「山」结尾的关键词（华山/泰山/衡山…）要求前缀为空、以分隔符结尾，
//        或「南岳/张家界」这类同山前缀。「青华山/翠华山/南华山」「莱芜华山国家森林公园」
//        「泰山区泰山方特欢乐世界」「西泰山景区」因此不再误配。
function prefixOk(pre){
 if(!pre) return true;
 if(/[+＋\/、·,，和&＆（(\s]$/.test(pre)) return true;
 return /^(南岳|北岳|东岳|西岳|中岳|张家界)$/.test(pre);
}
// 「同名不同地」黑名单（通用规则之外的残余个例）
const MATCH_DENY = ["九华山公园", "沈阳故宫", "明故宫", "长城炮", "长城岭"];
// 收尾项（返程/转场）的时段必须与当天已排时段一致：
// 若当天已排过 [晚上/深夜/夜间]，返程再标 [傍晚] 会排到晚上之后，时间线倒挂。
const tailPeriod = (arr) => (Array.isArray(arr) && arr.some(it => it && /^(晚上|深夜|夜间)$/.test(it.period))) ? "晚上" : "傍晚";
// v1.19.11：转场日的「入住」若当天已排了深夜项（特种兵加餐），时段跟着变深夜，避免「晚上」排在「深夜」后
const _hotelPeriod = (arr) => (Array.isArray(arr) && arr.some(it => it && (it.period === "深夜" || it.period === "夜间"))) ? "深夜" : "晚上";
// 收尾填充文案轮换（同一天内按该时段已有条目数错开，避免同日撞词）
const MEAL_TAILS = [
 { name: "当地美食 + 自由活动", note: "用当地味道给这一天收尾" },
 { name: "找家本地馆子 + 夜市走走", note: "避开景区餐厅，往居民区钻更地道" },
 { name: "去小吃街扫街 + 慢慢逛", note: "边走边吃，别一次点太多" },
 { name: "本地味道 + 散步消食", note: "吃完沿街走一段，顺便看看夜景" },
 { name: "老字号晚餐 + 街头溜达", note: "挑本地人排队的店，通常不踩雷" },
 { name: "菜市场小吃 + 巷子闲逛", note: "傍晚的菜市场最能看出当地日常" },
 { name: "巷子里的馆子 + 夜游", note: "离主街越远，价格越实在" },
 { name: "本地小吃拼一顿 + 慢走", note: "多尝几样，别一次吃饱" },
 { name: "街边摊 + 江边吹风", note: "简单一顿，把时间留给散步" },
 { name: "特色早点铺 + 逛老街", note: "早点铺往往比正餐更有地方味" },
 { name: "本地馆子晚餐 + 早回酒店", note: "走了一天，今晚早点休息" },
 { name: "苍蝇馆子 + 夜市转转", note: "本地人常去的小店，性价比高" },
 { name: "火锅汤锅一顿 + 散步", note: "吃完沿街走一段再回住处" },
 { name: "面食小馆 + 老街夜灯", note: "小馆子出餐快，适合玩累的晚上" },
 { name: "烧烤摊 + 沿街走一段", note: "夜宵摊位往往藏着本地口味" },
 { name: "家常菜馆 + 街区慢逛", note: "点两个本地家常菜，慢慢吃完" },
 { name: "路边小店 + 走着消食", note: "找家顺眼的小店，吃完慢走回住处" },
 { name: "夜市第一口 + 沿街看", note: "从人气最旺的摊头吃起" },
 { name: "老巷馄饨 + 拍街景", note: "小馄饨配老街，简单也舒服" },
 { name: "本地面 + 晚风散步", note: "一碗面下肚，沿江边溜达" },
 { name: "砂锅/煲仔 + 慢慢吃", note: "砂锅煲仔出餐慢，适合慢慢聊" },
 { name: "卤味拼盘 + 啤酒", note: "卤味配酒，本地人的晚间打开方式" },
 { name: "糖水铺 + 消食走", note: "甜汤收尾，溜达一段再回" },
 { name: "豆浆油条夜宵 + 早回", note: "夜宵简简单单，留点肚子给明天" },
 { name: "街角饭馆 + 天台吹风", note: "吃饱上楼顶吹吹风，看看夜景" },
 { name: "本地招牌菜 + 散步", note: "点个招牌菜，吃完沿街走" },
 { name: "夜市海鲜/小炒 + 慢逛", note: "沿海城市夜市以鲜为胜" },
 { name: "粥粉面档 + 闲坐", note: "粥粉面档热乎实惠，吃完坐会儿" },
 { name: "水果摊 + 河边走", note: "买点当季水果，河边走走最惬意" },
 { name: "小酒馆 + 微醺收尾", note: "一天走完，小酌一杯收尾" },
];
// dayNo：行程第几天（0 起）；citySeed：城市名/省名，用于同城错开
function mealTail(itemsArr, period, dayNo, citySeed){
 let h = 0; const seedStr = String(citySeed || "");
 for (let k = 0; k < seedStr.length; k++) h = (h * 31 + seedStr.charCodeAt(k)) >>> 0;
 // seq：当天已出现的填充项条数（不按时段），保证同日内两条选到不同文案
 const seq = (itemsArr || []).filter(x => x && MEAL_TAILS.some(t => t.name === x.name)).length;
 // v1.19.11：day 上限提到 14（池 30 条，索引 (奇偶)+day*2+seq 在 15 天内两两不同）
 const day = Math.max(0, Math.min(14, Number(dayNo) || 0));
 // 索引 = 城市奇偶 + 天*2 + seq：同日内不重复、跨天不重复
 const t = MEAL_TAILS[((h % 2) + day * 2 + Math.min(seq, 1)) % MEAL_TAILS.length];
 return { name: t.name, period, note: t.note };
}


function customBudgetObj(amt, days, peopleN){
 if(!amt || amt <= 0) return null;
 const p = Math.max(1, peopleN || 1);
 const per = amt / Math.max(1, days) / p;
 const hotel = Math.round(per * 0.45);
 const food = Math.round(per * 0.22);
 const lo = Math.max(50, Math.round(per * 0.7)), hi = Math.round(per * 1.3);
 return {
  label: "自定义 ¥" + amt,
  daily: lo + "-" + hi,
  hotel: Math.max(60, Math.round(hotel*0.8)) + "-" + Math.max(80, Math.round(hotel*1.2)) + "元/晚",
  food: Math.max(40, Math.round(food*0.8)) + "-" + Math.max(60, Math.round(food*1.2)) + "元/人/天",
  note: "按自定义总预算 ¥" + amt + " 分摊：住宿约45%、餐饮约22%、交通门票约33%"
 };
}

// —— v1.8.2 通用城市景点补强：只给「高热度旅游城市」补真实知名景点（泛化填充已移除后，
//   小池城市长行程不靠类别模板灌水，改靠真实景点支撑；冷门地级市少量真实点+留白，宁缺毋假）——
const CITY_LM_PATCH = {
 "绍兴": ["柯岩 + 鉴湖 + 鲁镇", "沈园", "书圣故里", "安昌古镇", "大禹陵", "府山公园（越王台）", "青藤书屋", "吼山风景区", "镜湖国家城市湿地公园", "蕺山公园（文笔塔）", "瓜渚湖", "昂桑湖"],
 "珠海": ["珠海渔女", "珠海大剧院（日月贝）", "唐家湾古镇", "会同古村", "石景山公园", "珠海博物馆", "板樟山森林公园", "海泉湾度假区", "金台寺", "庙湾岛"],
 "威海": ["刘公岛", "成山头", "华夏城", "环翠楼", "幸福门广场", "赤山风景区", "神雕山野生动物园", "国际海水浴场", "半月湾", "威高海洋公园", "里口山风景区", "烟墩角天鹅湖"],
 "舟山": ["普陀山", "朱家尖大青山", "桃花岛", "东极岛", "嵊泗列岛", "枸杞岛", "沈家门渔港", "定海古城", "岱山岛", "秀山岛"],
 "秦皇岛": ["山海关老龙头", "北戴河海滨浴场", "鸽子窝公园", "老虎石海上公园", "天下第一关", "祖山风景区", "碧螺塔海上酒吧公园", "乐岛海洋王国", "秦皇求仙入海处", "怪楼奇园"],
 "乐山": ["乐山大佛", "峨眉山", "嘉阳小火车（桫椤湖）", "罗城古镇", "黑竹沟", "金口河大峡谷", "苏稽古镇", "东方佛都", "沐川竹海", "峨秀湖"],
 "张掖": ["七彩丹霞", "冰沟丹霞", "大佛寺", "马蹄寺", "平山湖大峡谷", "山丹军马场", "张掖国家湿地公园", "焉支山", "康乐草原", "镇远楼"],
 "嘉峪关": ["嘉峪关关城", "悬壁长城", "天下第一墩", "讨赖河峡谷", "长城博物馆", "魏晋墓壁画", "方特丝路神画", "东湖生态园", "嘉峪关南湖"],
 "黔东南": ["西江千户苗寨", "镇远古城", "肇兴侗寨", "岜沙苗寨", "加榜梯田", "郎德上寨", "下司古镇", "凯里民族风情园", "施秉云台山", "杉木河漂流"],
 "伊犁": ["那拉提草原", "喀拉峻草原", "赛里木湖", "霍尔果斯口岸", "解忧公主薰衣草园", "果子沟大桥", "特克斯八卦城", "夏塔古道", "库尔德宁", "唐布拉草原", "喀赞其民俗街"],
 "林芝": ["雅鲁藏布大峡谷", "南迦巴瓦峰", "巴松措", "鲁朗林海", "桃花沟", "苯日神山", "米堆冰川", "尼洋河风光带", "岗云杉林", "喇嘛岭寺"],
 "温州": ["雁荡山", "楠溪江", "江心屿", "五马街", "泰顺廊桥", "洞头列岛", "南麂列岛", "百丈漈", "泽雅风景区", "三垟湿地"]
};
function findCity(name, province){
 const hit = CITIES.find(c=>c.name===name);
 if(hit){
  // 精编城市：只补充「本市」本地景点（EXTRA_SPOTS，字符串数组），绝不混入省内其他城市的景点；
  // 精确去重 + 语义去重（组合名与单名不重复，如"天安门+故宫"与"天安门"）
  const own = hit.experiences.slice();
  const ownNames = new Set(own.map(e=>e.name));
  const ownKeys = own.map(e=>e.name);
  const tryPush = (s)=>{
   if(ownNames.has(s)) return;
   if(ownKeys.some(x=>spotOverlap(x, s))) return; // 语义重复（组合名/单名互相包含）
   own.push({name:s, period:"全天", note:"本市经典去处，可灵活安排半天"});
   ownNames.add(s);
   ownKeys.push(s);
  };
  (EXTRA_SPOTS[hit.id]||[]).forEach(tryPush);
  (EXTRA_SPOTS2[hit.id]||[]).forEach(tryPush);
  (EXTRA_SPOTS3[hit.id]||[]).forEach(tryPush);
  (EXTRA_SPOTS4[hit.id]||[]).forEach(tryPush);
  (EXTRA_SPOTS5[hit.id]||[]).forEach(tryPush);
  return {...hit, hotels: HOTELS[hit.id] || GEN_HOTELS, experiences: own};
 }
 const pinfo = PROVINCE_INFO[province] || {};
 const regionKey = PROVINCE_REGION[province] || "华北";
 const region = REGION_DEFAULT[regionKey] || REGION_DEFAULT["华北"];
 // 通用城市：优先「本市」景点库（含第二层补充，精确去重 + 语义去重）；未收录才回退省级地标（明确标注可能位于省内其他城市）
 const lmList = dedupSpots((CITY_LANDMARKS[name]||[]).concat(CITY_LANDMARKS_EXTRA[name]||[]).concat(CITY_LANDMARKS_EXTRA2[name]||[]).concat(CITY_LANDMARKS_EXTRA3[name]||[]).concat(CITY_LANDMARKS_EXTRA4[name]||[]).concat(CITY_LANDMARKS_EXTRA5[name]||[]).concat(CITY_LANDMARKS_EXTRA6[name]||[]).concat(CITY_LM_PATCH[name]||[]));
 const isProvinceFallback = lmList.length === 0;
 const landmarks = lmList.length ? lmList : (PROVINCE_LANDMARKS[province] || ["当地代表性景点"]);
 const periods = ["上午","下午","晚上","全天"];
 const cityFoods = PROVINCE_CITY_FOODS[name];
 return {
  id:"generic", name, region:regionKey, climate:region.climate, cost:"mid",
  best:pinfo.best || region.best,
  foods: cityFoods || pinfo.foods || region.foods,
  foodNote: cityFoods ? ("在"+name+"，这些本地味道值得专程去找：") : (pinfo.foodNote || "到一座城，先从当地老字号和菜市场吃起，最能感受地道风味。"),
  areas:[{name:`${name}市中心`,note:"交通便利，吃住选择多"},{name:`${name}老城街区`,note:"烟火气浓，体验当地生活"}],
  stayTip:"选择交通枢纽或商圈附近的连锁酒店，性价比和便利性兼顾。",
  travel:pinfo.travel || "高铁/动车是最便捷的城际方式，到站后地铁或打车进市区。",
  cityTravel:pinfo.cityTravel || "优先地铁+公交，市内景点间打车/骑行结合。",
  hotels: GEN_HOTELS,
  experiences: landmarks.map((lm,i)=>({
   name: lm,
   period: periods[i % periods.length],
   note: isProvinceFallback ? "省内经典景点（可能位于省内其他城市，可作为周边游规划）" :
      (i===0 ? (name+"的标志性景点，第一站先来这里") : (i===2 ? "夜晚的"+lm+"更值得一看" : "经典目的地，合理安排半天时间"))
  }))
 };
}

// v1.11：spotName 可能非字符串（fuzz 抓到 spotName.includes is not a function）
// v1.19.10：模糊匹配加边界。原来任意子串互相包含，导致「西双版纳热带植物园」
// 被坐标表里一条叫「植物园」的条目命中 → 全省游选云南却安排「入住贵阳」（跨省）。
function _spotCityFuzzy(a, b){
 if(a === b) return true;
 if(typeof a !== "string" || typeof b !== "string") return false;
 const [sh, lg] = a.length <= b.length ? [a, b] : [b, a];
 if(sh.length < 2) return false;
 return lg.indexOf(sh) === 0 && suffixOk(lg.slice(sh.length));
}
// v1.19.10：全省游专用的「省内定位」。通用 getSpotCity 会把「故宫博物院」判到沈阳
//（沈阳/北京都有含「故宫」的条目，模糊扫描按对象键序取第一个）→ 北京全省游跑到辽宁。
function getSpotCityIn(spotName, province){
 if(typeof spotName !== "string" || !spotName) return null;
 const pvCities = PROVINCE_CITIES[province] || [];
 const inPv = (c) => pvCities.indexOf(c) >= 0 || CITY2PROV[c] === province || !CITY2PROV[c];
 const fix = SPOT_CITY_FIX[spotName];
 if(fix && inPv(fix)) return fix;
 for(const cname of pvCities){
  const cl = SPOT_COORDS[cname];
  if(cl) for(const s of cl){ if(s[0] === spotName) return cname; }
 }
 for(const cname of pvCities){
  const cl = SPOT_COORDS[cname];
  if(cl) for(const s of cl){ if(_spotCityFuzzy(s[0], spotName)) return cname; }
 }
 const g = getSpotCity(spotName);
 return (g && inPv(g)) ? g : null;
}
// v1.19.12：getSpotCity 全省游会对每个地标全库扫描，结果（含 null）按景点名记忆化
const _spotCityMemo = new Map();
function getSpotCity(spotName){
 if(typeof spotName !== "string" || !spotName) return null;
 if(_spotCityMemo.has(spotName)) return _spotCityMemo.get(spotName);
 const _compute = () => {
  if(SPOT_CITY_FIX[spotName]) return SPOT_CITY_FIX[spotName];
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(s[0] === spotName) return cname; }
 }
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(_spotCityFuzzy(s[0], spotName)) return cname; }
 }
 const libs = [CITY_LANDMARKS, CITY_LANDMARKS_EXTRA, CITY_LANDMARKS_EXTRA2, CITY_LANDMARKS_EXTRA3, CITY_LANDMARKS_EXTRA4, CITY_LANDMARKS_EXTRA5, CITY_LANDMARKS_EXTRA6];
 for(const lib of libs){
  for(const cname in lib){
   const arr = lib[cname] || [];
   if(!Array.isArray(arr)) continue;
   for(const a of arr){
    if(a === spotName) return cname;
    if(_spotCityFuzzy(a, spotName)) return cname;
   }
  }
 }
  return null;
 };
 const res = _compute();
 if (_spotCityMemo.size > 10000) _spotCityMemo.clear();
 _spotCityMemo.set(spotName, res);
 return res;
}

function cityLegTxt(a, b){
 const ca = getCoord(a), cb = getCoord(b);
 if(!ca || !cb) return "";
 const km = haversine(ca, cb);
 if(km < 40) return "";
 const h = km/180;
 return `（高铁约${h<1 ? Math.round(h*60)+"分钟" : h.toFixed(1)+"小时"}）`;
}

function moneyStr(p){
 if(!p) return "";
 return "¥" + (p.lo === p.hi ? p.lo : p.lo + "-" + p.hi);
}

function getWish(){
 const w = _read(WISH_KEY, []);   // v1.11：改走适配器（小程序无 localStorage）
 return Array.isArray(w) ? w : [];
}

function spotDetailHtml(name, cityName){
 const core = spotDetailCore(name, cityName);
 return core ? (spotBaikeBar(name) + core) : "";
}

function spotOffpeak(name){
 const n = name || "";
 if(/博物馆|美术馆|科技馆|纪念馆/.test(n)) return "建议上午 9-11 点或闭馆前 1 小时参观，人少清净；周一闭馆需提前预约。";
 if(/山|峰|峡谷|栈道|长城|森林公园/.test(n)) return "赶早：8 点前入园能避开旅行团高峰，缆车/索道排队少，光线也好。";
 if(/古镇|古城|古村|老街|街区|胡同/.test(n)) return "傍晚 17 点后游客渐散、华灯初上，是体验烟火气的最佳时段。";
 if(/湖|江|海|海滩|岛|湾/.test(n)) return "清晨或日落前 1 小时光线最美人最少，正午暴晒建议避开。";
 if(/乐园|欢乐世界|度假区/.test(n)) return "开园即冲热门项目，下午排队至少 40 分钟起；工作日去体验最佳。";
 if(/寺|庙|教堂|宫|观/.test(n)) return "清晨 7-9 点香客少、光影好；初一十五及节假日人流大，建议避开。";
 return "建议避开周末 10-15 点高峰，早到 30 分钟或错后 1 小时更从容。";
}

function spotHidden(name){
 const n = typeof name === "string" ? name : "";   // v1.11：fuzz 守卫
 if(!n) return "";
 for(const k in SPOT_HIDDEN){ if(n.includes(k)) return SPOT_HIDDEN[k]; }
 if(/博物馆|美术馆/.test(n)) return "冷知识：馆内藏品通常每 3 个月轮换一次，连续来能看到不同展品。";
 if(/山|峰|长城|森林公园/.test(n)) return "本地人才知道：山脚村口的小卖部往往比景区内便宜一半，出发前备好水和干粮。";
 if(/古镇|古城|老街/.test(n)) return "冷知识：主街往里走两条巷子才是原住民生活区，烟火气和物价都更实在。";
 if(/湖|江|海/.test(n)) return "冷知识：涨潮前后 1 小时是湖边/江边光线最好、人也最少的时候。";
 return "";
}

function photoTip(name){
 const n = name || "";
 if(/山|峰|长城|森林公园/.test(n)) return "出片：山顶/观景台俯拍 + 栈道侧拍，清晨侧光最美";
 if(/湖|江|海|海滩|岛|湾/.test(n)) return "出片：日落前 30 分钟在岸线拍剪影，或租船在湖面拍倒影";
 if(/古镇|古城|老街|胡同/.test(n)) return "出片：巷口框景、桥头俯拍、灯笼亮起后的暖色街景";
 if(/博物馆|美术馆|科技馆/.test(n)) return "出片：入口大台阶、旋转楼梯、展陈灯光下的剪影是经典机位";
 if(/寺|庙|教堂|宫/.test(n)) return "出片：红墙金瓦的对称构图 + 飞檐仰拍，清晨逆光更有层次";
 if(/乐园|欢乐世界/.test(n)) return "出片：城堡/标志物前 45° 侧拍避开人流，晚上灯光秀倒影必拍";
 return "出片：入口地标 + 核心景观的『人小景大』构图最稳，人少时段光线更好";
}

function spotCharacter(name, cityName){
 const n = String(name || "");
 const pts = [];
 // 名字特征推断
 // 【重要】不要用单个汉字推断语义：大唐西市 / 大理 / 大昭寺 / 大三巴的「大」不是面积大，
 // 天坛 / 天山 / 天涯海角的「天」也不是传说色彩，老龙头的「老」与年代无关。
 // 一律改用明确的词或组合，宁可少说一句，也不要说错。
 if(/第一|之最|天下第/.test(n)) pts.push("名字带「第一/之最」，是该地最有代表性的地标，值得作为首选打卡点");
 if(/千年|百年|古镇|古城|古村|古街|古寺|古刹|古塔|古建|古迹|古都|明清|宋代|唐代|老街|老巷|老城|老字号/.test(n)) pts.push("历史底蕴深厚，适合放慢脚步看细节、听故事");
 if(/新区|新城|新天地|现代|创意园/.test(n)) pts.push("「新」字代表现代设施与玩法，拍照打卡与亲子体验都很合适");
 if(/仙|龙|凤|神|圣|神话|传说/.test(n)) pts.push("名字充满传说色彩，出发前查一下名字由来，逛起来更有味道");
 if(/御|皇|宫|陵|王府|相府|故居/.test(n)) pts.push("与皇家/官府/家族历史相关，建筑规制、匾额楹联和背后的故事是最大看点");
 if(/洞|岩|峡谷|溶/.test(n)) pts.push("以喀斯特/地质奇观见长，洞内灯光秀或峡谷栈道是核心体验");
 if(/温泉|汤/.test(n)) pts.push("温泉/疗养属性突出，适合安排在行程后半段放松，冬季体验最佳");
 if(/桥|塔|阁|楼|亭/.test(n)) pts.push("古建/地标属性强，登高望远或桥头远眺的视野是加分项");
 // 类型特色
 if(/湖|江|河|海|泉|瀑布|溪|潭|水库/.test(n)) pts.push("核心看点是水域风光：晨昏光线最美，环湖/亲水/看日落是标配玩法");
 if(/山|峰|岭|谷|崖|石/.test(n)) pts.push("以山地地貌见长：登高远眺、云海日出是招牌，穿防滑鞋、备足水，量力而行");
 if(/寺|庙|观|教堂|庵/.test(n)) pts.push("宗教/古建氛围浓：留意飞檐斗拱与香火，清晨最清静、光影最好");
 if(/古镇|古村|老街|巷|街区|胡同/.test(n)) pts.push("老街区烟火气最足：支巷深处藏着本地小吃和手作，傍晚华灯初上最出片");
 if(/博物馆|美术馆|纪念馆|科技馆|展览|艺术/.test(n)) pts.push("看展是核心：常设展+特展搭配，语音导览别错过，室内不受天气影响");
 if(/乐园|欢乐世界|海洋|水族|影城|度假区/.test(n)) pts.push("游玩项目是重点：热门项目优先冲，下载官方 App 看排队时长");
 if(/公园|园林|植物园|动物园|湿地/.test(n)) pts.push("城市绿肺/生态主题：适合散步野餐，清晨晨练氛围、周末亲子热门");
 if(/草原|沙漠|戈壁|冰川|雪山|高原/.test(n)) pts.push("地貌景观壮阔：与城市风貌反差大，出片率极高，注意防晒保暖与体力分配");
 if(/田园|花海|茶园|果园|梯田/.test(n)) pts.push("田园风光主题：季节感强，采摘/摄影/乡村体验是主打玩法");
 if(pts.length < 2) pts.push("当地有代表性的去处，不同季节各有风味，出发前查一下近期活动与开放情况");
 if(cityName) pts.push("位于 " + cityName + "，可与同区域景点串成一条动线，减少来回奔波");
 return pts.slice(0, 5);
}

function spotHowTo(name, cityName){
 let dist = -1;
 try{
  const c = getSpotCoord(cityName, name);
  const anchor = getCoord(cityName);
  if(c && anchor) dist = haversine(c, anchor);
 }catch(e){}
 const bi = bigSpotInfo(name);
 const part = [];
 if(dist < 0) part.push("市区及周边可达，具体线路以导航 App 实时结果为准");
 else if(dist <= 5) part.push("距市中心约 " + Math.round(dist) + "km，地铁/公交/步行都能到，打车 10-15 分钟");
 else if(dist <= 25) part.push("距市中心约 " + Math.round(dist) + "km，公交/打车 20-40 分钟，地铁到附近站点后换乘更方便");
 else part.push("距市中心约 " + Math.round(dist) + "km，属远郊/景区，建议景区直通车、旅游大巴或包车前往，单程预留 1 小时以上");
 if(bi && bi.hours) part.push("面积大、耗时长（官方建议 " + bi.hours + "），务必线上官方渠道提前购票/预约，避开排队高峰");
 if(/博物馆|美术馆|纪念馆|科技馆/.test(name)) part.push("多数免费，记得提前在官方公众号预约并带身份证");
 if(/山|峰|长城|森林公园/.test(name)) part.push("进山多为景区接驳车/索道，门票与索道分开购，建议提前订好上下山方案");
 return part.join("；") + "。";
}

function spotOverlap(a, b){
 const ka = spotKey(a), kb = spotKey(b);
 for(const x of ka) for(const y of kb){
  if(x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if(!long.includes(short)) continue;
  if(short.length >= 3) return true;            // 3 字以上包含即同源
  if(GENERIC_SPOT_WORDS.includes(short)) return long.startsWith(short); // 2 字泛词需前缀
  return true;                       // 2 字非泛词包含即同源（故宫/故宫博物院）
 }
 return false;
}

// v1.11：list 可能非数组（fuzz 抓到 list is not iterable）
function dedupSpots(list){
 const out = [];
 for(const s of (Array.isArray(list) ? list : [])){
  if(out.some(x=>x===s || spotOverlap(x, s))) continue;
  out.push(s);
 }
 return out;
}

function spotBaikeBar(name){
 const kw = baikeKeyword(name);
 if(!kw) return "";
 const url = "https://baike.baidu.com/item/" + uriEnc(kw);
 return `<div class="sd-ops"><a class="sd-baike" href="${url}" target="_blank" rel="noopener" `
  + `title="在新标签页打开「${kw.replace(/"/g, "&quot;")}」的百度百科词条">百度百科：${kw}</a>`
  + `<span class="sd-ops-hint">未收录则列出搜索结果</span></div>`;
}

function spotKey(name){
 return String(name||"").split(SPOT_SEP).map(s=>s.trim()).filter(s=>s.length>=2);
}

function baikeKeyword(name){
 let n = String(name || "").trim();
 if(!n) return "";
 // 去掉行程动作前缀与书名号（深度游览「故宫」→ 故宫；继续游览 + 西湖 → 西湖）
 n = n.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
 // 组合名只取主段（天安门广场 + 故宫博物院 → 天安门广场），避免百科搜不到
 const parts = n.split(/\s*(?:\+|＋|、|\/)\s*/).map(s => s.trim()).filter(Boolean);
 if(parts.length) n = parts[0];
 return n.trim();
}
module.exports = { SHOW_TIPS, setStoreAdapter, showListOf, baikeKeyword, bestMatch, bigSpotInfo, budgetFoodDaily, budgetMealText, budgetStyleOf, budgetTierKey, buildPlanDays, buildProvinceCity, buildProvincePlanDays, cityLegTxt, cleanSpotName, countPlanStats, customBudgetObj, dedupSpots, findCity, getCoord, getProfile, getSpotCity, getSpotCoord, getWish, haversine, isWished, moneyStr, photoTip, profileAdjustedFoods, rangePair, relaxDetail, relaxIndex, resolveBudget, shopBand, spotBaikeBar, spotCharacter, spotDetailCore, spotDetailExtras, spotDetailFallback, spotDetailHtml, spotEffort, spotHidden, spotHours, spotHowTo, spotKey, spotOffpeak, spotOpenNote, spotOverlap, sunriseSpotInfo, tierOfPerDay, uriEnc };
