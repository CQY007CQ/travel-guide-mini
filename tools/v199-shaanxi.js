// v1.14 全域收录 第7批：陕西 7 市（CITIES 缺记录，锚点/CITY2PROV 已具备）
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "tongchuan", name: "铜川", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；药王山和照金，夏季凉爽",
      foods: ["耀州窝窝面", "铜川搅团", "宜君核桃", "腊汁肉夹馍", "油泼面", "刀削面", "凉皮", "酸汤面"],
      foodNote: "铜川是药王故里，窝窝面和搅团是本地味；宜君核桃和油泼面适合带回家。",
      areas: [
        { name: "耀州区", note: "药王山" },
        { name: "新区/王益", note: "市区" },
        { name: "照金", note: "红色旅游" }
      ],
      stayTip: "住耀州区或新区，照金红色小镇可住一晚。",
      travel: "铜川东站通西延高铁，到西安约30分钟；照金有高速连接。",
      cityTravel: "市区公交打车方便，照金需班车或自驾。",
      experiences: [
        { name: "药王山", period: "全天", note: "孙思邈故里，石窟和摩崖" },
        { name: "照金红色旅游小镇", period: "全天", note: "陕甘边革命根据地，红色教育" },
        { name: "陈炉古镇", period: "下午", note: "千年耀瓷古镇，罐罐墙" },
        { name: "玉华宫", period: "全天", note: "唐玄奘译经地，森林和滑雪" },
        { name: "香山", period: "上午", note: "佛教名山，秋色" },
        { name: "铜川博物馆", period: "下午", note: "耀州窑和丝路文物" },
        { name: "宜君旱作梯田", period: "上午", note: "黄土梯田，层叠田园" },
        { name: "金锁关", period: "下午", note: "古关隘和石林" },
        { name: "耀州窑博物馆", period: "上午", note: "宋代名窑" },
        { name: "溪山胜境", period: "全天", note: "自然山水" },
        { name: "照金薛家寨", period: "下午", note: "红军寨堡" },
        { name: "宜君福地湖", period: "傍晚", note: "湖泊湿地" }
      ],
      spots: []
    },
    {
      id: "xianyang", name: "咸阳", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；乾陵和袁家村，春秋很好",
      foods: ["咸阳biangbiang面", "乾县锅盔", "三原蓼花糖", "礼泉烙面", "袁家村小吃", "油泼辣子", "豆腐脑", "甑糕"],
      foodNote: "咸阳是秦汉故都，袁家村小吃街把关中美食一网打尽；biangbiang面裤带宽才正宗。",
      areas: [
        { name: "秦都区", note: "市区，咸阳湖" },
        { name: "乾县", note: "乾陵" },
        { name: "礼泉", note: "袁家村" }
      ],
      stayTip: "住咸阳秦都区或西安北郊，袁家村民宿体验一晚很舒服。",
      travel: "咸阳机场就是西安咸阳国际机场；高铁咸阳西站/咸阳北站连接西安。",
      cityTravel: "市区地铁/公交方便，乾陵和袁家村需班车或自驾。",
      experiences: [
        { name: "乾陵", period: "全天", note: "唐高宗与武则天合葬陵，无字碑" },
        { name: "袁家村", period: "全天", note: "关中民俗村，小吃街和窑洞" },
        { name: "茂陵", period: "上午", note: "汉武帝陵墓，霍去病墓" },
        { name: "汉阳陵", period: "下午", note: "汉景帝陵，陶俑博物馆" },
        { name: "咸阳湖", period: "傍晚", note: "渭河穿城湖，夜景" },
        { name: "昭陵", period: "全天", note: "唐太宗陵，九嵕山" },
        { name: "马嵬驿", period: "上午", note: "杨贵妃墓和民俗街" },
        { name: "三原城隍庙", period: "下午", note: "明清建筑群" },
        { name: "彬州大佛寺", period: "全天", note: "关中第一大佛" },
        { name: "咸阳博物馆", period: "上午", note: "西汉陶俑" },
        { name: "郑国渠", period: "下午", note: "古代水利工程" },
        { name: "石门山", period: "全天", note: "旬邑古关和红叶" }
      ],
      spots: []
    },
    {
      id: "weinan", name: "渭南", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；华山春秋很好，夏季凉",
      foods: ["华山豆腐脑", "潼关肉夹馍", "渭南时辰包子", "大荔冬枣", "富平柿饼", "合阳踅面", "韩城羊肉饸饹", "水盆羊肉"],
      foodNote: "渭南是华山所在地，潼关肉夹馍饼酥肉香，富平柿饼秋冬最甜，合阳踅面是渭北名吃。",
      areas: [
        { name: "临渭区", note: "市区" },
        { name: "华阴", note: "华山" },
        { name: "韩城/富平", note: "古城和柿子" }
      ],
      stayTip: "爬华山住华阴市区或山下，看日出住山顶；韩城古城可住一晚。",
      travel: "华山北站通郑西高铁，到西安约30分钟；渭南站连接普通铁路。",
      cityTravel: "市区公交方便，华山有专线，韩城需班车或自驾。",
      experiences: [
        { name: "华山", period: "全天", note: "奇险天下第一山，长空栈道和鹞子翻身" },
        { name: "华山日出", period: "早上", note: "东峰观日出，夜爬经典" },
        { name: "韩城古城", period: "全天", note: "司马迁故里，明清古城" },
        { name: "党家村", period: "上午", note: "民居瑰宝，四合院" },
        { name: "司马迁祠", period: "下午", note: "史圣祠墓" },
        { name: "洽川湿地", period: "全天", note: "黄河湿地，处女泉" },
        { name: "富平陶艺村", period: "上午", note: "国际陶艺博物馆" },
        { name: "大荔沙苑", period: "下午", note: "沙漠运动和冬枣" },
        { name: "少华山", period: "全天", note: "华山东侧，玻璃栈道" },
        { name: "潼关古城", period: "上午", note: "天下第一关" },
        { name: "合阳福山", period: "下午", note: "黄土山形似福字" },
        { name: "华山仙峪", period: "上午", note: "幽谷溪水" }
      ],
      spots: []
    },
    {
      id: "hanzhong", name: "汉中", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；油菜花季3月，汉江和古镇",
      foods: ["汉中热面皮", "菜豆腐", "汉中浆水面", "略阳乌鸡", "城固柑橘", "洋县黑米", "褒河鲜鱼", "核桃馍"],
      foodNote: "汉中热面皮配菜豆腐是灵魂早餐；洋县黑米和城固柑橘是特产，褒河鱼鲜嫩。",
      areas: [
        { name: "汉台区", note: "市区" },
        { name: "勉县/宁强", note: "武侯祠和青木川" },
        { name: "洋县/城固", note: "朱鹮和柑橘" }
      ],
      stayTip: "住汉台区，油菜花季可住油菜花海民宿；青木川需一天。",
      travel: "汉中站通西成高铁，到西安约1.5小时；汉中机场有国内航线。",
      cityTravel: "市区公交打车方便，青木川和洋县需班车或自驾。",
      experiences: [
        { name: "汉中油菜花海", period: "全天", note: "3月汉中盆地百万亩油菜花" },
        { name: "武侯祠", period: "上午", note: "勉县武侯祠，诸葛亮祭祀地" },
        { name: "青木川古镇", period: "全天", note: "陕甘川三省交界的古镇" },
        { name: "石门栈道", period: "下午", note: "褒斜道古栈道" },
        { name: "汉江湿地", period: "傍晚", note: "城边湿地观鸟" },
        { name: "华阳古镇", period: "全天", note: "秦岭南坡古镇和朱鹮" },
        { name: "洋县朱鹮保护区", period: "上午", note: "全球仅有的朱鹮栖息地" },
        { name: "黎坪国家森林公园", period: "全天", note: "秦岭山水" },
        { name: "拜将台", period: "上午", note: "韩信拜将处" },
        { name: "南湖", period: "下午", note: "南郑湖泊" },
        { name: "古汉台", period: "上午", note: "汉中博物馆" },
        { name: "城固张骞墓", period: "下午", note: "丝路开拓者墓" }
      ],
      spots: []
    },
    {
      id: "yulin", name: "榆林", province: "陕西", region: "西北", climate: "dry", cost: "low",
      best: "5-10月；镇北台和红石峡，夏季凉爽",
      foods: ["榆林豆腐", "羊肉面", "拼三鲜", "清涧煎饼", "绥德油旋", "子洲果馅", "沙盖拌疙瘩", "大烩菜"],
      foodNote: "榆林是塞上古城，豆腐宴和羊肉面有陕北味；绥德油旋和子洲果馅可当伴手礼。",
      areas: [
        { name: "榆阳区", note: "市区" },
        { name: "靖边/神木", note: "统万城和红碱淖" },
        { name: "米脂/绥德", note: "古城和石雕" }
      ],
      stayTip: "住榆阳区，去红石峡和镇北台半小时；统万城和红碱淖需一天。",
      travel: "榆林榆阳机场通全国；包西铁路/延榆高铁连接西安。",
      cityTravel: "市区打车便宜，镇北台和红石峡有公交；长城沿线需自驾。",
      experiences: [
        { name: "镇北台", period: "上午", note: "万里长城第一台" },
        { name: "红石峡", period: "下午", note: "摩崖石刻和峡谷" },
        { name: "榆林古城", period: "傍晚", note: "九边重镇，古城墙和钟楼" },
        { name: "统万城", period: "全天", note: "匈奴唯一都城遗址" },
        { name: "红碱淖", period: "全天", note: "中国最大沙漠淡水湖" },
        { name: "波浪谷", period: "全天", note: "丹霞地貌，靖边波浪谷" },
        { name: "米脂古城", period: "下午", note: "貂蝉故里，窑洞古城" },
        { name: "绥德汉画像石馆", period: "上午", note: "陕北汉墓石刻" },
        { name: "白云山", period: "全天", note: "道教名山" },
        { name: "佳县香炉寺", period: "上午", note: "黄河边的悬崖小寺" },
        { name: "府谷黄河湾", period: "下午", note: "黄河拐弯" },
        { name: "榆林豆腐宴", period: "晚上", note: "榆林豆腐名吃" }
      ],
      spots: []
    },
    {
      id: "ankang", name: "安康", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；瀛湖和南宫山，夏天凉",
      foods: ["安康蒸面", "紫阳毛尖", "汉阴炕炕馍", "镇坪腊肉", "平利绞股蓝", "石泉烤鱼", "岚皋魔芋", "豆腐干"],
      foodNote: "安康是秦巴山区，蒸面和石泉烤鱼是主打；紫阳毛尖和汉阴炕炕馍适合带回家。",
      areas: [
        { name: "汉滨区", note: "市区" },
        { name: "岚皋/南宫山", note: "山水" },
        { name: "石泉/紫阳", note: "古镇和茶山" }
      ],
      stayTip: "住汉滨区，瀛湖可半日游；南宫山和青木川方向需一天。",
      travel: "安康站通阳安/襄渝铁路，到西安约2小时；安康机场有国内航线。",
      cityTravel: "市区公交打车方便，汉江和瀛湖景区有专线。",
      experiences: [
        { name: "瀛湖", period: "全天", note: "西北最大淡水湖，岛屿游船" },
        { name: "南宫山", period: "全天", note: "火山岩地貌，云海" },
        { name: "香溪洞", period: "上午", note: "道教石窟" },
        { name: "石泉古城", period: "下午", note: "汉江古镇" },
        { name: "中坝大峡谷", period: "全天", note: "峡谷溪流" },
        { name: "紫阳茶山", period: "全天", note: "汉江茶山" },
        { name: "平利龙头村", period: "下午", note: "茶园和民宿" },
        { name: "汉阴凤堰古梯田", period: "全天", note: "清代梯田" },
        { name: "天柱山", period: "上午", note: "安康城郊" },
        { name: "汉江三峡", period: "全天", note: "汉江游船" },
        { name: "镇坪化龙山", period: "下午", note: "原始森林" },
        { name: "安康汉江夜景", period: "晚上", note: "一江两岸" }
      ],
      spots: []
    },
    {
      id: "shangluo", name: "商洛", province: "陕西", region: "西北", climate: "temperate", cost: "low",
      best: "3-6月、9-11月；金丝峡和天竺山，避暑",
      foods: ["商洛擀面皮", "柞水木耳", "镇安板栗", "山阳神仙叶凉粉", "丹凤葡萄酒", "洛南核桃", "商州糊汤", "洋芋糍粑"],
      foodNote: "商洛是秦岭腹地，柞水木耳和镇安板栗有名；丹凤葡萄酒是百年红酒。",
      areas: [
        { name: "商州区", note: "市区" },
        { name: "商南/柞水", note: "金丝峡和牛背梁" },
        { name: "丹凤/洛南", note: "古镇和核桃" }
      ],
      stayTip: "住商州区，金丝峡住商南县城；柞水牛背梁可当天往返西安。",
      travel: "商洛站通西康铁路，到西安约1.5小时；西商高速/西十高铁在建。",
      cityTravel: "市区打车方便，秦岭景区靠班车或自驾。",
      experiences: [
        { name: "金丝峡", period: "全天", note: "秦岭峡谷，瀑布和栈道" },
        { name: "牛背梁国家森林公园", period: "全天", note: "秦岭主脊，森林步道" },
        { name: "天竺山", period: "全天", note: "道教名山，云海" },
        { name: "柞水溶洞", period: "上午", note: "喀斯特溶洞群" },
        { name: "丹凤棣花古镇", period: "下午", note: "贾平凹故乡" },
        { name: "洛南音乐小镇", period: "上午", note: "现代艺术小镇" },
        { name: "塔云山", period: "全天", note: "险峰古寺" },
        { name: "漫川古镇", period: "下午", note: "陕鄂交界古镇" },
        { name: "月亮洞", period: "上午", note: "山阳溶洞" },
        { name: "商洛秦岭观景台", period: "下午", note: "秦岭山景" },
        { name: "柞水木耳基地", period: "上午", note: "木耳采摘" },
        { name: "仙娥湖", period: "傍晚", note: "商州湖泊" }
      ],
      spots: []
    }
  ],
  COORDS_ADD: {
    "铜川": [["药王山", 34.900, 108.980], ["陈炉古镇", 35.040, 109.100]],
    "咸阳": [["乾陵", 34.570, 108.210], ["袁家村", 34.560, 108.430]],
    "渭南": [["华山", 34.480, 110.080], ["韩城古城", 35.480, 110.440]],
    "汉中": [["青木川古镇", 32.830, 105.570], ["石门栈道", 33.250, 107.030]],
    "榆林": [["镇北台", 38.300, 109.740], ["红石峡", 38.290, 109.730], ["统万城", 38.080, 108.850]],
    "安康": [["瀛湖", 32.700, 108.970], ["南宫山", 32.280, 108.780]],
    "商洛": [["金丝峡", 33.420, 110.870], ["牛背梁国家森林公园", 33.790, 109.030]]
  }
};
