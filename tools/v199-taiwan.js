// v1.14 全域收录 第13批（收尾）：台湾 8 县市（CITIES 缺记录；台北已有）
// 台湾县市锚点为参考级 GCJ-02 惯例值；坐标说明同前。
module.exports = {
  CITIES_ADD: [
    {
      id: "newtaipei", name: "新北", province: "台湾", region: "华东", climate: "hot", cost: "mid",
      best: "10月-次年4月；九份山城和淡水，四季皆宜",
      foods: ["阿给", "九份芋圆", "深坑臭豆腐", "淡水阿婆铁蛋", "贡寮海胆", "三芝蛋糕", "八里孔雀蛤", "金山鸭肉"],
      foodNote: "九份芋圆和淡水阿给是招牌，深坑老街的臭豆腐一条街很热闹。",
      areas: [
        { name: "板桥", note: "新北市区" },
        { name: "九份/瑞芳", note: "山城" },
        { name: "淡水/八里", note: "河海" }
      ],
      stayTip: "住板桥或淡水，九份建议住一晚看夜景。",
      travel: "台北捷运连接板桥/淡水，台铁瑞芳站转九份，交通方便。",
      cityTravel: "捷运+台铁覆盖主要景点，九份需接驳。",
      experiences: [
        { name: "九份老街", period: "全天", note: "山城老街，千与千寻场景" },
        { name: "淡水老街", period: "全天", note: "淡水河畔和渔人码头" },
        { name: "平溪天灯", period: "下午", note: "放天灯和铁道小镇" },
        { name: "十分瀑布", period: "上午", note: "台湾最大瀑布" },
        { name: "野柳地质公园", period: "全天", note: "女王头和奇岩海岸" },
        { name: "黄金博物馆", period: "上午", note: "金瓜石淘金历史" },
        { name: "深坑老街", period: "下午", note: "臭豆腐一条街" },
        { name: "北海岸", period: "全天", note: "基隆沿海风光" },
        { name: "淡水渔人码头", period: "傍晚", note: "看夕阳" },
        { name: "金山温泉", period: "晚上", note: "海边温泉" },
        { name: "乌来瀑布", period: "上午", note: "山泉瀑布" },
        { name: "八里左岸", period: "下午", note: "河岸骑行" }
      ],
      spots: []
    },
    {
      id: "taoyuan", name: "桃园", province: "台湾", region: "华东", climate: "hot", cost: "mid",
      best: "10月-次年4月；大溪老街和拉拉山",
      foods: ["大溪豆干", "石门活鱼", "桃园米干", "台湾啤酒", "拉拉山水蜜桃", "眷村牛肉面", "阿婆豆花", "花生糖"],
      foodNote: "大溪豆干和石门活鱼是桃园招牌，拉拉山水蜜桃夏季最甜。",
      areas: [
        { name: "桃园区", note: "市区" },
        { name: "大溪", note: "老街和石门水库" },
        { name: "拉拉山", note: "高山森林" }
      ],
      stayTip: "住桃园区或大溪，拉拉山赏樱/水蜜桃季住山上。",
      travel: "桃园机场是台湾门户，桃园高铁站连接台北台中。",
      cityTravel: "捷运桃园机场线+台铁/高铁，景点靠公车或自驾。",
      experiences: [
        { name: "大溪老街", period: "全天", note: "巴洛克老街和豆干" },
        { name: "石门水库", period: "全天", note: "湖光山色和活鱼" },
        { name: "拉拉山自然保护区", period: "全天", note: "巨木森林和水蜜桃" },
        { name: "慈湖陵寝", period: "上午", note: "两蒋纪念园区" },
        { name: "桃园眷村文化园区", period: "下午", note: "台湾眷村生活" },
        { name: "观音莲园", period: "上午", note: "夏日莲花" },
        { name: "虎头山", period: "下午", note: "城市森林" },
        { name: "大园沿海湿地", period: "傍晚", note: "观鸟" },
        { name: "小人国主题乐园", period: "全天", note: "迷你世界" },
        { name: "桃园夜市", period: "晚上", note: "米干和豆花" }
      ],
      spots: []
    },
    {
      id: "taichung", name: "台中", province: "台湾", region: "华东", climate: "hot", cost: "mid",
      best: "10月-次年4月；彩虹眷村和逢甲夜市，四季皆宜",
      foods: ["太阳饼", "逢甲夜市小吃", "台中肉圆", "东海乳品", "麻薏汤", "珍珠奶茶", "大甲芋头", "蚵仔煎"],
      foodNote: "太阳饼和珍珠奶茶是台中名产，逢甲夜市小吃种类全。",
      areas: [
        { name: "西屯/逢甲", note: "夜市区" },
        { name: "东海/大肚", note: "大学和牧场" },
        { name: "大甲/后里", note: "镇澜宫和outlet" }
      ],
      stayTip: "住逢甲或台中火车站周边，夜市步行可达。",
      travel: "台中高铁站+台铁+捷运（2021开通），台中机场有航线。",
      cityTravel: "捷运+公车覆盖，夜市和商圈集中。",
      experiences: [
        { name: "逢甲夜市", period: "晚上", note: "台湾很热闹夜市之一" },
        { name: "彩虹眷村", period: "上午", note: "彩虹爷爷彩绘村" },
        { name: "高美湿地", period: "傍晚", note: "日落天空之镜" },
        { name: "东海大学", period: "下午", note: "路思义教堂" },
        { name: "一中商圈", period: "晚上", note: "学生商圈" },
        { name: "大甲镇澜宫", period: "上午", note: "妈祖信仰中心" },
        { name: "新社花海", period: "全天", note: "秋冬花海" },
        { name: "审计新村", period: "下午", note: "文创聚落" },
        { name: "谷关温泉", period: "全天", note: "山区温泉" },
        { name: "日月潭（南投方向）", period: "全天", note: "可从台中中转" },
        { name: "大坑步道", period: "上午", note: "城市登山" },
        { name: "台中歌剧院", period: "下午", note: "建筑地标" }
      ],
      spots: []
    },
    {
      id: "tainan", name: "台南", province: "台湾", region: "华东", climate: "hot", cost: "low",
      best: "10月-次年4月；古都和美食，春秋最宜",
      foods: ["担仔面", "棺材板", "碗粿", "虱目鱼粥", "牛肉汤", "虾卷", "白糖粿", "冬瓜茶"],
      foodNote: "台南是台湾美食之都，担仔面和牛肉汤是招牌，早餐就能吃虱目鱼粥。",
      areas: [
        { name: "中西区", note: "古都核心" },
        { name: "安平", note: "安平古堡" },
        { name: "关子岭", note: "温泉" }
      ],
      stayTip: "住中西区逛古都，安平半日，关子岭温泉需一天。",
      travel: "台南高铁站+台铁，机场有航线；市区公车/YouBike方便。",
      cityTravel: "公车+共享单车覆盖古都景点，市区不大可步行。",
      experiences: [
        { name: "赤崁楼", period: "上午", note: "荷兰人建的古城楼" },
        { name: "安平古堡", period: "下午", note: "台湾最古老的城堡" },
        { name: "孔庙", period: "上午", note: "台湾第一座孔子庙" },
        { name: "神农街", period: "晚上", note: "老街和文创" },
        { name: "花园夜市", period: "晚上", note: "台南夜市" },
        { name: "延平郡王祠", period: "上午", note: "郑成功纪念" },
        { name: "关子岭温泉", period: "全天", note: "泥浆温泉" },
        { name: "四草绿色隧道", period: "上午", note: "红树林隧道" },
        { name: "奇美博物馆", period: "全天", note: "艺术博物馆" },
        { name: "安平老街", period: "下午", note: "虾卷和剑狮" },
        { name: "大天后宫", period: "上午", note: "妈祖庙" },
        { name: "台南美食巡礼", period: "全天", note: "担仔面牛肉汤" }
      ],
      spots: []
    },
    {
      id: "kaohsiung", name: "高雄", province: "台湾", region: "华东", climate: "hot", cost: "mid",
      best: "10月-次年4月；爱河和西子湾，冬季温暖",
      foods: ["高雄木瓜牛奶", "旗津海产", "台式日本料理", "冻圆", "牛肉面", "泡泡冰", "盐酥鸡", "打狗饼"],
      foodNote: "旗津海鲜和木瓜牛奶是高雄印象，爱河夜景配夜市很惬意。",
      areas: [
        { name: "盐埕/西子湾", note: "港区" },
        { name: "左营", note: "高铁站和眷村" },
        { name: "旗津", note: "海岛" }
      ],
      stayTip: "住三多商圈或西子湾，旗津乘渡轮可达。",
      travel: "高雄高铁站连接台北台中，捷运红线/橘线覆盖，高雄机场有国际航线。",
      cityTravel: "捷运+轻轨+渡轮，港区景点交通方便。",
      experiences: [
        { name: "西子湾", period: "傍晚", note: "看夕阳和打狗英国领事馆" },
        { name: "旗津岛", period: "全天", note: "渡轮、海滩和海产" },
        { name: "爱河", period: "晚上", note: "爱河游船和夜景" },
        { name: "美丽岛捷运站", period: "上午", note: "世界很美捷运站" },
        { name: "驳二艺术特区", period: "下午", note: "文创仓库区" },
        { name: "六合夜市", period: "晚上", note: "知名夜市" },
        { name: "打狗英国领事馆", period: "上午", note: "英式建筑" },
        { name: "佛陀纪念馆", period: "全天", note: "佛光山" },
        { name: "柴山", period: "上午", note: "城市山林和猴群" },
        { name: "莲池潭", period: "下午", note: "龙虎塔" },
        { name: "高雄85大楼", period: "下午", note: "港都地标" },
        { name: "瑞丰夜市", period: "晚上", note: "本地人夜市" }
      ],
      spots: []
    },
    {
      id: "keelung", name: "基隆", province: "台湾", region: "华东", climate: "hot", cost: "low",
      best: "9月-次年4月；雨都和庙口夜市，秋季吃蟹",
      foods: ["基隆庙口小吃", "咖喱炒饭", "八斗子海产", "泡泡冰", "鼎边锉", "甜不辣", "小卷", "海蟹"],
      foodNote: "基隆庙口夜市从早吃到晚，鼎边锉和泡泡冰是招牌。",
      areas: [
        { name: "庙口商圈", note: "夜市" },
        { name: "八斗子", note: "海滨" },
        { name: "和平岛", note: "地质公园" }
      ],
      stayTip: "住庙口附近，夜市步行，和平岛半天。",
      travel: "基隆港是邮轮母港，台铁连接台北约40分钟。",
      cityTravel: "市区小，景点靠公车或步行。",
      experiences: [
        { name: "基隆庙口夜市", period: "晚上", note: "台湾最有名夜市之一" },
        { name: "和平岛公园", period: "全天", note: "海蚀地质景观" },
        { name: "八斗子渔港", period: "下午", note: "渔港和彩虹屋" },
        { name: "基隆港", period: "傍晚", note: "港都夜景" },
        { name: "望幽谷", period: "上午", note: "海崖步道" },
        { name: "基隆灯塔", period: "上午", note: "海景灯塔" },
        { name: "潮境公园", period: "下午", note: "海滨公园" },
        { name: "仙洞岩", period: "上午", note: "天然洞穴" },
        { name: "基隆中正公园", period: "下午", note: "城市公园" },
        { name: "庙口鼎边锉", period: "下午", note: "地方名吃" }
      ],
      spots: []
    },
    {
      id: "hsinchu", name: "新竹", province: "台湾", region: "华东", climate: "hot", cost: "low",
      best: "10月-次年4月；科技城和客家风情",
      foods: ["新竹米粉", "贡丸", "客家菜", "城隍庙小吃", "新竹饼", "姜丝大肠", "水润饼", "擂茶"],
      foodNote: "新竹米粉和贡丸是名片，城隍庙口小吃配擂茶有客家味。",
      areas: [
        { name: "新竹市", note: "市区" },
        { name: "竹东/北埔", note: "客家小镇" },
        { name: "南寮", note: "渔港" }
      ],
      stayTip: "住新竹市区，北埔老街和南寮半天。",
      travel: "新竹高铁站连接台北台中，台铁新竹站近市区。",
      cityTravel: "市区公车+共享单车，客家小镇靠台铁或公车。",
      experiences: [
        { name: "新竹城隍庙", period: "下午", note: "全台城隍庙之首，小吃街" },
        { name: "新竹科学园区（外观）", period: "上午", note: "台湾硅谷" },
        { name: "北埔老街", period: "全天", note: "客家老街和擂茶" },
        { name: "南寮渔港", period: "傍晚", note: "渔港和海鲜" },
        { name: "内湾老街", period: "全天", note: "铁道客家小镇" },
        { name: "十七公里海岸", period: "下午", note: "单车海岸线" },
        { name: "竹东市场", period: "上午", note: "客家市集" },
        { name: "新竹玻璃工坊", period: "上午", note: "玻璃艺术" },
        { name: "峨眉湖", period: "下午", note: "湖光" },
        { name: "新竹火车站", period: "上午", note: "日式古站" }
      ],
      spots: []
    },
    {
      id: "chiayi", name: "嘉义", province: "台湾", region: "华东", climate: "hot", cost: "mid",
      best: "10月-次年4月；阿里山和夜市，樱花季3月",
      foods: ["火鸡肉饭", "砂锅鱼头", "阿里山茶", "蚵仔煎", "方块酥", "嘉义豆花", "粿", "山葵"],
      foodNote: "火鸡肉饭是嘉义招牌，阿里山茶叶和山葵有山地味。",
      areas: [
        { name: "嘉义市", note: "市区" },
        { name: "阿里山", note: "森林铁路" },
        { name: "布袋港", note: "渔港" }
      ],
      stayTip: "住嘉义市区，阿里山建议住山上民宿看日出。",
      travel: "嘉义高铁站+台铁，阿里山森林铁路和公车上山。",
      cityTravel: "市区公车/YouBike，阿里山需专车或小火车。",
      experiences: [
        { name: "阿里山森林游乐区", period: "全天", note: "神木、日出和云海" },
        { name: "阿里山森林铁路", period: "全天", note: "百年高山铁路" },
        { name: "奋起湖", period: "上午", note: "老街和铁路便当" },
        { name: "嘉义文化路夜市", period: "晚上", note: "火鸡肉饭和砂锅鱼头" },
        { name: "北回归线标志", period: "上午", note: "热带温带分界" },
        { name: "嘉义公园", period: "下午", note: "昭和J18文创" },
        { name: "布袋渔港", period: "傍晚", note: "海鲜和盐田" },
        { name: "触口龙隐寺", period: "上午", note: "阿里山脚古寺" },
        { name: "嘉义故宫南院", period: "全天", note: "故宫博物院南部分院" },
        { name: "隙顶云海", period: "早上", note: "阿里山公路云海" },
        { name: "梅山太平云梯", period: "下午", note: "吊桥景观" },
        { name: "嘉义火鸡肉饭巡礼", period: "全天", note: "遍地老店" }
      ],
      spots: []
    }
  ],
  CITY_COORDS_ADD: {
    "新北": [25.011, 121.446],
    "桃园": [24.994, 121.301],
    "台中": [24.148, 120.674],
    "台南": [22.999, 120.227],
    "高雄": [22.627, 120.301],
    "基隆": [25.128, 121.739],
    "新竹": [24.814, 120.968],
    "嘉义": [23.480, 120.450]
  },
  COORDS_ADD: {
    "新北": [["九份老街", 25.110, 121.844], ["野柳地质公园", 25.206, 121.689], ["淡水老街", 25.169, 121.445]],
    "桃园": [["大溪老街", 24.879, 121.287], ["石门水库", 24.806, 121.240], ["拉拉山自然保护区", 24.730, 121.420]],
    "台中": [["彩虹眷村", 24.131, 120.609], ["高美湿地", 24.313, 120.553], ["逢甲夜市", 24.180, 120.646]],
    "台南": [["赤崁楼", 22.997, 120.204], ["安平古堡", 23.001, 120.161], ["四草绿色隧道", 23.011, 120.136]],
    "高雄": [["西子湾", 22.623, 120.266], ["旗津岛", 22.613, 120.266], ["驳二艺术特区", 22.620, 120.280]],
    "基隆": [["基隆庙口夜市", 25.132, 121.741], ["和平岛公园", 25.160, 121.770]],
    "新竹": [["新竹城隍庙", 24.804, 120.967], ["北埔老街", 24.698, 121.060]],
    "嘉义": [["阿里山森林游乐区", 23.509, 120.802], ["奋起湖", 23.499, 120.691], ["嘉义故宫南院", 23.428, 120.322]]
  }
};
