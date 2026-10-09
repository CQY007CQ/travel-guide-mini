// v1.12 城市正文 第2批（东北11 + 华东9）
module.exports = {
  CITIES_ADD: [
    {
      id: "panjin", name: "盘锦", region: "东北", climate: "cold", cost: "low", province: "辽宁",
      best: "9-10月红海滩最红",
      foods: ["盘锦大米", "盘锦河蟹", "蟹黄豆腐", "稻田蟹", "碱蓬草煎饼", "辽河刀鱼", "海蜇皮", "苇芽炒肉"],
      foodNote: "盘锦大米香糯全国有名，河蟹秋天最肥，配一碗新米蒸饭是本地人的满足。",
      areas: [{ name: "红海滩景区周边", note: "看红色滩涂很方便" }, { name: "兴隆台区·市中心", note: "商业和美食集中" }, { name: "大洼稻田片区", note: "田园风光" }],
      stayTip: "住兴隆台区市中心，去红海滩约1小时车程。",
      travel: "盘锦站是高铁站，到沈阳约1小时。",
      cityTravel: "市区公交、打车方便，去红海滩可坐景区直通车。",
      experiences: [
        { name: "红海滩国家风景廊道", period: "全天", note: "碱蓬草铺就的红色滩涂，秋天很美" },
        { name: "盘锦鼎翔苇海蟹滩风景区", period: "下午", note: "芦苇荡里捉河蟹、看湿地" },
        { name: "辽河碑林公园", period: "下午", note: "辽河岸边的碑刻园林" },
        { name: "盘锦红海滩风景区", period: "全天", note: "红色海岸湿地经典观景点" },
        { name: "黑风关古镇", period: "下午", note: "仿古边关小镇，适合拍照" },
        { name: "湖滨公园", period: "傍晚", note: "城市休闲湖景" }
      ],
      spots: []
    },
    {
      id: "huludao", name: "葫芦岛", region: "东北", climate: "cold", cost: "low", province: "辽宁",
      best: "6-9月很舒服",
      foods: ["兴城海鲜", "干豆腐", "渤海对虾", "海胆", "葫芦岛炸酱面", "绥中白梨", "兴城烤鸭", "烤海蜇"],
      foodNote: "靠渤海吃海鲜，对虾海胆鲜甜，兴城干豆腐薄而香。",
      areas: [{ name: "兴城古城片区", note: "古城、海滨集中" }, { name: "龙湾海滨", note: "看海玩沙滩" }, { name: "绥中九门口方向", note: "登长城" }],
      stayTip: "住兴城古城附近，海边和古城都能步行逛。",
      travel: "葫芦岛北站是高铁站，到沈阳约1.5小时。",
      cityTravel: "市内公交、打车方便，去九门口可包车。",
      experiences: [
        { name: "兴城古城景区", period: "全天", note: "明代卫城，保存完整的方形古城" },
        { name: "兴城海滨国家重点风景名胜区", period: "下午", note: "渤海湾沙滩浴场" },
        { name: "菊花岛", period: "全天", note: "海上岛屿，乘船登岛看海景" },
        { name: "九门口风景区", period: "全天", note: "水上长城，明长城奇观" },
        { name: "葫芦山庄", period: "下午", note: "东北民俗文化园" },
        { name: "灵山风景区", period: "下午", note: "灵山寺与山水风光" }
      ],
      spots: []
    },
    {
      id: "chaoyang", name: "朝阳", region: "东北", climate: "cold", cost: "low", province: "辽宁",
      best: "4-5月、9-10月很舒服",
      foods: ["朝阳羊汤", "喀左陈醋", "凌源烧饼", "建平小米", "北票羊肉串", "朝阳冻豆腐", "凌源烤羊腿", "朝阳炖菜"],
      foodNote: "朝阳羊汤配烧饼是标配，冬天喝一碗暖到心里。",
      areas: [{ name: "老城中心", note: "北塔南塔、美食集中" }, { name: "凤凰山景区周边", note: "登山观景" }, { name: "高铁站片区", note: "赶车方便" }],
      stayTip: "住老城中心，北塔南塔步行可到。",
      travel: "朝阳站是高铁站，到沈阳约1.5小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "朝阳凤凰山景区", period: "上午", note: "辽西名山，登山看佛寺" },
        { name: "辽宁朝阳鸟化石国家地质公园", period: "下午", note: "中华龙鸟、化石之乡" },
        { name: "牛河梁国家考古遗址公园", period: "下午", note: "红山文化女神庙遗址" },
        { name: "佑顺寺", period: "下午", note: "清代古刹" },
        { name: "朝阳北塔", period: "下午", note: "辽代古塔，佛寺地宫" },
        { name: "朝阳南塔", period: "下午", note: "与北塔遥相呼应的古塔" }
      ],
      spots: []
    },
    {
      id: "jilin", name: "吉林市", region: "东北", climate: "cold", cost: "low", province: "吉林",
      best: "12-2月看雾凇、7-8月避暑",
      foods: ["白肉血肠", "小鸡炖蘑菇", "松花湖鱼", "吉林煎粉", "冻梨", "猪肉炖粉条", "锅包肉", "烤冷面"],
      foodNote: "吉林煎粉酸辣开胃，雾凇季来吉林看江畔雾凇是招牌体验。",
      areas: [{ name: "松花湖景区周边", note: "看湖避暑" }, { name: "市区·松江中路", note: "看雾凇、美食" }, { name: "北大湖片区", note: "滑雪度假" }],
      stayTip: "住市区松江中路一带，看雾凇方便，去松花湖约半小时。",
      travel: "吉林站是高铁站，到长春约40分钟。",
      cityTravel: "市区公交、打车方便，去北大湖滑雪可坐专线。",
      experiences: [
        { name: "吉林松花湖风景名胜区", period: "全天", note: "松花江上的大湖，游船观景" },
        { name: "孤凇岛", period: "上午", note: "雾凇岛观赏胜地，冬季雪树银花" },
        { name: "北山公园", period: "下午", note: "城市山林公园，古庙掩映" },
        { name: "北大湖滑雪度假区", period: "全天", note: "东北著名滑雪场" },
        { name: "朱雀山国家森林公园", period: "上午", note: "登高远眺松花江" },
        { name: "龙潭山公园", period: "下午", note: "龙潭山遗址与森林步道" }
      ],
      spots: []
    },
    {
      id: "tonghua", name: "通化", region: "东北", climate: "cold", cost: "low", province: "吉林",
      best: "5-6月、9-10月很舒服",
      foods: ["通化葡萄酒", "人参炖鸡", "蝲蛄豆腐", "山野菜", "通化炒面", "松子", "榛蘑", "蕨菜"],
      foodNote: "通化是葡萄酒城，人参、榛蘑、山野菜是大山里的味道。",
      areas: [{ name: "老城中心", note: "商业美食集中" }, { name: "五女峰方向", note: "森林公园" }, { name: "高铁站片区", note: "赶车方便" }],
      stayTip: "住老城中心，去周边景区都方便。",
      travel: "通化站有高铁，到长春约2小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "将军坟", period: "下午", note: "高句丽遗迹，有东方金字塔之称" },
        { name: "好太王碑", period: "下午", note: "高句丽长寿王纪念碑刻" },
        { name: "五女峰国家森林公园", period: "全天", note: "山峰叠翠，秋色极美" },
        { name: "吉林龙湾群国家森林公园", period: "全天", note: "火山湖群湿地景观" },
        { name: "通化玉皇山公园", period: "下午", note: "市区山林公园" },
        { name: "丸都山城", period: "下午", note: "高句丽山城遗址" }
      ],
      spots: []
    },
    {
      id: "changbaishan", name: "长白山", region: "东北", climate: "cold", cost: "mid", province: "吉林",
      best: "7-9月看天池、12-2月滑雪",
      foods: ["温泉鸡蛋", "长白山人参", "鹿茸", "榛蘑炖鸡", "冷水鱼", "蓝莓", "松子", "蕨菜"],
      foodNote: "温泉煮鸡蛋是长白山特色，天池景区必尝，蓝莓和松子是山里特产。",
      areas: [{ name: "北坡景区周边", note: "看天池主入口" }, { name: "西坡景区周边", note: "锦江大峡谷" }, { name: "二道白河镇", note: "住宿餐饮集中" }],
      stayTip: "住二道白河镇很方便，北坡、西坡都可从这里出发。",
      travel: "长白山机场可直飞，或坐高铁到长白山站再换车。",
      cityTravel: "景区内需坐环保车，各坡之间距离较远建议包车。",
      experiences: [
        { name: "长白山天池", period: "全天", note: "火山口湖，中国最高、最深的高山湖泊" },
        { name: "长白瀑布", period: "上午", note: "天池北侧，落差68米的瀑布" },
        { name: "长白山景区-绿渊潭", period: "下午", note: "碧绿潭水，幽静清凉" },
        { name: "长白山西景区-锦江大峡谷", period: "下午", note: "火山地貌大峡谷" },
        { name: "地下森林", period: "下午", note: "谷底原始森林" },
        { name: "峡谷浮石林", period: "下午", note: "火山浮石景观" }
      ],
      spots: []
    },
    {
      id: "qiqihar", name: "齐齐哈尔", region: "东北", climate: "cold", cost: "low", province: "黑龙江",
      best: "6-8月很舒服",
      foods: ["齐齐哈尔烤肉", "卜奎清真美食", "嫩江鱼", "克山土豆", "泰来大米", "大碴子粥", "酸菜白肉", "锅包肉"],
      foodNote: "齐齐哈尔烤肉全国闻名，炭火现烤蘸料香，是来这必吃的一顿。",
      areas: [{ name: "龙沙公园片区", note: "市中心休闲" }, { name: "扎龙方向", note: "看丹顶鹤" }, { name: "卜奎老街", note: "清真美食" }],
      stayTip: "住市中心龙沙区，去扎龙约40分钟。",
      travel: "齐齐哈尔站有高铁，到哈尔滨约1.5小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "扎龙自然保护区", period: "全天", note: "丹顶鹤之乡，湿地观鹤" },
        { name: "龙沙公园", period: "下午", note: "百年城市公园" },
        { name: "明月岛风景区", period: "下午", note: "嫩江中的岛屿" },
        { name: "大乘寺", period: "下午", note: "黑龙江著名佛教寺院" },
        { name: "黑龙江督军署", period: "下午", note: "清代官署建筑" },
        { name: "卜奎清真寺", period: "下午", note: "东北著名清真古寺" }
      ],
      spots: []
    },
    {
      id: "mudanjiang", name: "牡丹江", region: "东北", climate: "cold", cost: "low", province: "黑龙江",
      best: "7-8月看镜泊湖、1-2月去雪乡",
      foods: ["镜泊湖鱼", "雪乡冻梨", "猪肉炖粉条", "小鸡炖蘑菇", "俄式红肠", "锅包肉", "杀猪菜", "冻柿子"],
      foodNote: "镜泊湖鱼鲜美，冬季雪乡的冻梨冻柿子冰凉解腻。",
      areas: [{ name: "镜泊湖景区周边", note: "看火山湖" }, { name: "雪乡大雪谷片区", note: "冬季童话世界" }, { name: "市中心·西安区", note: "商业美食" }],
      stayTip: "玩镜泊湖可住景区周边，去雪乡建议住雪乡或二浪河。",
      travel: "牡丹江站有高铁，到哈尔滨约2小时。",
      cityTravel: "市内公交、打车方便，去镜泊湖、雪乡需包车或坐班车。",
      experiences: [
        { name: "镜泊湖国家级风景名胜区", period: "全天", note: "火山堰塞湖，吊水楼瀑布壮观" },
        { name: "雪乡大雪谷", period: "全天", note: "中国雪乡，冬季雪蘑菇景观" },
        { name: "八女投江遗址纪念馆", period: "下午", note: "抗战纪念地" },
        { name: "横道河子东北虎林园", period: "下午", note: "看东北虎" },
        { name: "横道河子威虎山影视城", period: "下午", note: "林海雪原拍摄地" },
        { name: "火山口国家森林公园", period: "全天", note: "火山口原始森林" }
      ],
      spots: []
    },
    {
      id: "daqing", name: "大庆", region: "东北", climate: "cold", cost: "low", province: "黑龙江",
      best: "5-9月很舒服",
      foods: ["大庆烧烤", "肇州大瓜子", "连环湖鱼", "大庆炖菜", "酸菜炖粉条", "锅包肉", "粘豆包", "林甸鸡"],
      foodNote: "石油之城的大庆，连环湖鱼和烧烤是当地人的心头好。",
      areas: [{ name: "让胡路区·市中心", note: "商业美食集中" }, { name: "龙凤湿地周边", note: "观鸟看湿地" }, { name: "连环湖方向", note: "温泉度假" }],
      stayTip: "住让胡路区或萨尔图区市中心很方便。",
      travel: "大庆东站是高铁站，到哈尔滨约1小时。",
      cityTravel: "市内公交、打车方便，去连环湖需自驾或包车。",
      experiences: [
        { name: "铁人王进喜纪念馆", period: "下午", note: "学习铁人精神的红色场馆" },
        { name: "大庆石油科技馆", period: "下午", note: "了解石油开采科技" },
        { name: "龙凤国家湿地公园", period: "上午", note: "城市湿地观鸟" },
        { name: "大庆市博物馆", period: "下午", note: "猛犸象化石与地方历史" },
        { name: "连环湖温泉景区", period: "全天", note: "温泉度假" },
        { name: "大庆油田历史陈列馆", period: "下午", note: "回顾油田开发历程" }
      ],
      spots: []
    },
    {
      id: "heihe", name: "黑河", region: "东北", climate: "cold", cost: "low", province: "黑龙江",
      best: "6-8月很舒服",
      foods: ["俄式大列巴", "五大连池矿泉水", "矿泉豆腐", "红肠", "杀猪菜", "山野菜", "鲟鳇鱼", "大碴子粥"],
      foodNote: "边境城市俄式风味浓，五大连池矿泉豆腐清甜有名。",
      areas: [{ name: "市区·中央街", note: "俄式风情与商业" }, { name: "五大连池景区周边", note: "火山矿泉" }, { name: "大黑河岛片区", note: "边贸购物" }],
      stayTip: "住市区中央街一带，去五大连池约2小时车程。",
      travel: "黑河站有铁路，也可从哈尔滨坐飞机或长途汽车。",
      cityTravel: "市内打车方便，去五大连池建议包车。",
      experiences: [
        { name: "五大连池风景区", period: "全天", note: "火山堰塞湖群，矿泉疗养胜地" },
        { name: "瑷珲历史陈列馆", period: "下午", note: "了解中俄历史" },
        { name: "大黑河岛", period: "下午", note: "黑龙江中的岛屿，边贸集市" },
        { name: "中俄民族风情园", period: "下午", note: "俄式建筑风情园" },
        { name: "黑龙江大桥公园", period: "下午", note: "隔江望俄罗斯" },
        { name: "温泊景区", period: "下午", note: "火山堰塞湖温泉景观" }
      ],
      spots: []
    },
    {
      id: "suihua", name: "绥化", region: "东北", climate: "cold", cost: "low", province: "黑龙江",
      best: "6-8月很舒服",
      foods: ["绥化酸菜", "血肠", "杀猪菜", "粘豆包", "大碴子粥", "冻梨", "锅包肉", "猪肉炖粉条"],
      foodNote: "典型东北家常味，酸菜炖血肠是当地主角。",
      areas: [{ name: "市区中心", note: "商业美食集中" }, { name: "千鹤岛湿地周边", note: "湿地观鸟" }, { name: "望龙山方向", note: "森林公园" }],
      stayTip: "住市区中心很方便，去周边景区需自驾。",
      travel: "绥化站有铁路，到哈尔滨约1.5小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "金龟山庄", period: "下午", note: "休闲度假山庄" },
        { name: "望龙山国家森林公园", period: "全天", note: "林海登山" },
        { name: "千鹤岛湿地公园", period: "上午", note: "湿地观鸟" },
        { name: "绥化人民公园", period: "傍晚", note: "城市休闲公园" },
        { name: "绥化市博物馆", period: "下午", note: "地方历史文物" },
        { name: "绥化森林植物园", period: "下午", note: "城市植物园" }
      ],
      spots: []
    },
    {
      id: "lianyungang", name: "连云港", region: "华东", climate: "temperate", cost: "low", province: "江苏",
      best: "4-6月、9-10月很舒服",
      foods: ["连云港海鲜", "梭子蟹", "对虾", "沙光鱼", "花果山风鹅", "灌云豆丹", "板浦凉粉", "赣榆煎饼"],
      foodNote: "花果山是孙悟空老家，海鲜和风鹅是当地味道。",
      areas: [{ name: "花果山景区周边", note: "登花果山" }, { name: "连岛海滨", note: "看海玩沙滩" }, { name: "市中心·海州", note: "商业美食" }],
      stayTip: "住海州区市中心，去花果山、连岛都约半小时。",
      travel: "连云港站是高铁站，到南京约2小时。",
      cityTravel: "市内BRT和公交方便，去连岛可坐景区专线。",
      experiences: [
        { name: "花果山风景区", period: "全天", note: "西游记孙悟空老家，水帘洞" },
        { name: "连岛风景区", period: "全天", note: "江苏最大海岛，海滨浴场" },
        { name: "渔湾自然风景区", period: "下午", note: "山水瀑布清幽" },
        { name: "海上云台山风景区", period: "下午", note: "登高望海" },
        { name: "孔望山风景区", period: "下午", note: "摩崖石刻与古寺" },
        { name: "大伊山景区", period: "下午", note: "灌云境内名山" }
      ],
      spots: []
    },
    {
      id: "tzh", name: "泰州", region: "华东", climate: "temperate", cost: "low", province: "江苏",
      best: "3-5月、9-11月很舒服",
      foods: ["泰州干丝", "蟹黄汤包", "溱湖八鲜", "黄桥烧饼", "靖江肉脯", "泰兴白果", "兴化大闸蟹", "泰州鱼汤面"],
      foodNote: "早茶文化浓，烫干丝和蟹黄汤包是泰州名片。",
      areas: [{ name: "凤城河景区周边", note: "水乡风光" }, { name: "溱湖湿地片区", note: "湿地古镇" }, { name: "市中心·海陵", note: "早茶美食" }],
      stayTip: "住海陵区市中心，早起尝泰州早茶很方便。",
      travel: "泰州站有动车，到南京约1.5小时。",
      cityTravel: "市内公交、打车方便，去溱湖可坐公交。",
      experiences: [
        { name: "溱湖国家湿地公园", period: "全天", note: "湿地湖泊，会船节有名" },
        { name: "凤城河风景区", period: "傍晚", note: "环城水上游船夜景" },
        { name: "溱潼古镇旅游区", period: "下午", note: "水乡古镇，老街美食" },
        { name: "望海楼景区", period: "下午", note: "登楼望凤城河" },
        { name: "光孝律寺", period: "下午", note: "千年古刹" },
        { name: "乔园", period: "下午", note: "苏北名园，古典园林" }
      ],
      spots: []
    },
    {
      id: "suqian", name: "宿迁", region: "华东", climate: "temperate", cost: "low", province: "江苏",
      best: "3-5月、9-11月很舒服",
      foods: ["宿迁煎饼", "骆马湖银鱼", "泗洪大闸蟹", "乾隆贡酥", "山楂糕", "宿迁车轮饼", "骆马湖白虾", "洋河大曲"],
      foodNote: "项王故里，骆马湖湖鲜和洋河酒是宿迁的特色。",
      areas: [{ name: "项王故里片区", note: "古城文化" }, { name: "骆马湖周边", note: "沙滩湖景" }, { name: "市中心·宿城", note: "商业美食" }],
      stayTip: "住宿城区市中心，去项王故里、骆马湖都方便。",
      travel: "宿迁站有高铁，到徐州约1小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "项王故里景区", period: "下午", note: "西楚霸王项羽出生地" },
        { name: "江苏三台山国家森林公园", period: "全天", note: "山地森林，花海" },
        { name: "泗洪洪泽湖湿地景区", period: "全天", note: "洪泽湖湿地观鸟" },
        { name: "骆马湖沙滩公园", period: "下午", note: "人工沙滩湖景" },
        { name: "龙王庙行宫", period: "下午", note: "乾隆南巡行宫" },
        { name: "洋河酒厂文化旅游区", period: "下午", note: "白酒老字号，可品酒" }
      ],
      spots: []
    },
    {
      id: "zhoushan", name: "舟山", region: "华东", climate: "temperate", cost: "mid", province: "浙江",
      best: "5-6月、9-10月很舒服",
      foods: ["舟山带鱼", "梭子蟹", "皮皮虾", "海鲜面", "嵊泗贻贝", "舟山大黄鱼", "佛茶", "观音饼"],
      foodNote: "海鲜天堂，带鱼和梭子蟹是舟山招牌。",
      areas: [{ name: "普陀山景区周边", note: "朝拜祈福" }, { name: "沈家门渔港", note: "海鲜大排档" }, { name: "朱家尖片区", note: "沙滩度假" }],
      stayTip: "住沈家门或朱家尖，去普陀山坐轮渡方便。",
      travel: "坐高铁到宁波再换大巴或轮渡，或直飞舟山普陀山机场。",
      cityTravel: "岛际靠轮渡，市区公交、打车方便。",
      experiences: [
        { name: "普陀山风景名胜区", period: "全天", note: "观音道场，海天佛国" },
        { name: "朱家尖景区", period: "全天", note: "沙滩与沙雕艺术" },
        { name: "桃花岛风景旅游区", period: "全天", note: "金庸笔下桃花岛" },
        { name: "嵊泗基湖沙滩景区", period: "下午", note: "海上岛屿沙滩" },
        { name: "东极岛景区", period: "全天", note: "中国大陆最东端的海岛" },
        { name: "花鸟岛", period: "全天", note: "浪漫小众海岛，蓝眼泪" }
      ],
      spots: []
    },
    {
      id: "fuzhou", name: "福州", region: "华东", climate: "hot", cost: "low", province: "福建",
      best: "10-12月、3-4月很舒服",
      foods: ["福州鱼丸", "肉燕", "佛跳墙", "锅边糊", "荔枝肉", "线面", "福州鱼汤", "光饼"],
      foodNote: "福州鱼丸和肉燕是闽菜代表，三坊七巷老字号云集。",
      areas: [{ name: "三坊七巷片区", note: "历史街区与美食" }, { name: "鼓山·鼓岭", note: "避暑登山" }, { name: "上下杭片区", note: "老街区夜游" }],
      stayTip: "住三坊七巷或东街口一带，逛老街吃小吃都方便。",
      travel: "福州站、福州南站都是高铁站，到厦门约1.5小时。",
      cityTravel: "地铁、公交发达，市区出行方便。",
      experiences: [
        { name: "三坊七巷", period: "全天", note: "明清古街区，福州文化名片" },
        { name: "鼓山旅游景区", period: "上午", note: "登鼓山看福州全景" },
        { name: "涌泉寺", period: "上午", note: "鼓山千年古刹" },
        { name: "西湖公园", period: "下午", note: "城中湖景园林" },
        { name: "上下杭历史文化街区", period: "晚上", note: "老街区夜景与小吃" },
        { name: "鼓岭旅游度假区", period: "全天", note: "避暑胜地，老别墅" }
      ],
      spots: []
    },
    {
      id: "ningde", name: "宁德", region: "华东", climate: "hot", cost: "low", province: "福建",
      best: "4-6月、9-11月很舒服",
      foods: ["宁德大黄鱼", "霞浦海带", "福安坦洋工夫茶", "柘荣太子参", "屏南米烧兔", "宁德鱼丸", "蛏子", "海蛎煎"],
      foodNote: "中国大黄鱼之乡，霞浦海鲜闻名，海蛎煎鲜香。",
      areas: [{ name: "太姥山景区周边", note: "登山观海" }, { name: "霞浦滩涂片区", note: "摄影胜地" }, { name: "市区·蕉城", note: "商业美食" }],
      stayTip: "住蕉城区市中心，去太姥山约1小时，去霞浦可坐动车。",
      travel: "宁德站是高铁站，到福州约40分钟。",
      cityTravel: "市内公交、打车方便，去霞浦滩涂建议包车。",
      experiences: [
        { name: "太姥山风景区", period: "全天", note: "海上仙都，奇石怪洞" },
        { name: "白水洋·鸳鸯溪景区", period: "全天", note: "平坦溪床戏水，鸳鸯溪峡谷" },
        { name: "福安白云山风景名胜区", period: "全天", note: "高山云海" },
        { name: "九龙漈瀑布", period: "下午", note: "华东最大瀑布群之一" },
        { name: "杨家溪景区", period: "下午", note: "溪流竹筏，古榕田园" },
        { name: "嵛山岛", period: "全天", note: "海岛草原天湖" }
      ],
      spots: []
    },
    {
      id: "pingtan", name: "平潭", region: "华东", climate: "hot", cost: "mid", province: "福建",
      best: "4-6月、9-11月很舒服",
      foods: ["平潭海蛎煎", "八珍炒糕", "时来运转", "天长地久", "平潭鱼面", "蛏干", "紫菜", "海带"],
      foodNote: "平潭靠海，时来运转和海蛎煎是地道海岛味道。",
      areas: [{ name: "坛南湾片区", note: "沙滩度假" }, { name: "海坛古城周边", note: "古城商业" }, { name: "北港村方向", note: "石厝民宿" }],
      stayTip: "住海坛古城或北港村民宿，体验海岛慢生活。",
      travel: "坐高铁到平潭站，或从福州自驾跨海大桥。",
      cityTravel: "岛上适合自驾或骑电瓶车，环岛游很方便。",
      experiences: [
        { name: "石牌洋景区", period: "下午", note: "海上巨石奇观" },
        { name: "东海仙境景区", period: "下午", note: "海蚀地貌仙人井" },
        { name: "坛南湾景区", period: "全天", note: "细软沙滩，蓝眼泪观赏地" },
        { name: "海坛古城", period: "晚上", note: "仿古商业街区" },
        { name: "将军山景区", period: "上午", note: "登高望海" },
        { name: "猴研岛", period: "下午", note: "大陆距台湾最近的地方" }
      ],
      spots: []
    },
    {
      id: "fuyang", name: "阜阳", region: "华东", climate: "temperate", cost: "low", province: "安徽",
      best: "3-5月、9-11月很舒服",
      foods: ["阜阳格拉条", "枕头馍", "阜阳卷馍", "粉鸡", "板面", "撒汤", "麻糊", "阜阳咸馍"],
      foodNote: "阜阳格拉条和枕头馍是标志性面食，一碗板面配撒汤很满足。",
      areas: [{ name: "颍州西湖周边", note: "湖景园林" }, { name: "老城·管仲老街", note: "老街美食" }, { name: "市中心·颍州", note: "商业集中" }],
      stayTip: "住颍州区市中心，去颍州西湖约半小时。",
      travel: "阜阳西站是高铁站，到合肥约1小时。",
      cityTravel: "市内公交、打车方便。",
      experiences: [
        { name: "颍州西湖景区", period: "全天", note: "北宋名湖，园林风光" },
        { name: "阜阳生态乐园", period: "下午", note: "亲子生态公园" },
        { name: "八里河风景区", period: "全天", note: "湿地湖泊，水乡景观" },
        { name: "管仲老街", period: "晚上", note: "古街夜游与美食" },
        { name: "文峰公园", period: "傍晚", note: "城市休闲公园" },
        { name: "尤家花园", period: "下午", note: "私家园林古建" }
      ],
      spots: []
    },
    {
      id: "luan", name: "六安", region: "华东", climate: "temperate", cost: "low", province: "安徽",
      best: "4-6月、9-11月很舒服",
      foods: ["六安瓜片", "霍山石斛", "皖西白鹅", "金寨板栗", "万佛湖鱼头", "六安酱瓜", "霍邱柳编饼", "大别山野菜"],
      foodNote: "六安瓜片是名茶，大别山山珍和万佛湖鱼头是地道味道。",
      areas: [{ name: "天堂寨方向", note: "大别山主峰" }, { name: "万佛湖片区", note: "湖光山色" }, { name: "市中心·金安", note: "商业美食" }],
      stayTip: "住市中心金安区，去天堂寨约2.5小时，去万佛湖约1小时。",
      travel: "六安站是高铁站，到合肥约40分钟。",
      cityTravel: "市内公交、打车方便，去大别山景区建议包车。",
      experiences: [
        { name: "安徽天堂寨风景区", period: "全天", note: "大别山主峰，华东最后一片原始森林" },
        { name: "万佛湖风景区", period: "全天", note: "人工湖泊，岛屿棋布" },
        { name: "皖西大裂谷", period: "下午", note: "峡谷裂谷奇观" },
        { name: "佛子岭水库", period: "下午", note: "新中国第一坝" },
        { name: "大别山主峰白马尖景区", period: "全天", note: "大别山最高峰" },
        { name: "燕子河大峡谷", period: "下午", note: "峡谷溪流与瀑布" }
      ],
      spots: []
    }
  ]
};
