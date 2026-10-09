// v1.14 全域收录 第8批-东北A：黑龙江 7 城 + 吉林 6 城（CITIES 缺记录，锚点/CITY2PROV 已具备）
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "jixi", name: "鸡西", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；兴凯湖和乌苏里江，冬季寒冷",
      foods: ["鸡西大冷面", "兴凯湖白鱼", "虎林大米", "烤冷面", "锅包肉", "杀猪菜", "酸菜饺子", "粘豆包"],
      foodNote: "鸡西大冷面酸甜劲道是城市名片，兴凯湖白鱼鲜嫩，冬季粘豆包配酸菜最地道。",
      areas: [
        { name: "鸡冠区", note: "市区" },
        { name: "密山", note: "兴凯湖" },
        { name: "虎林", note: "乌苏里江" }
      ],
      stayTip: "住鸡冠区，去兴凯湖约1.5小时；虎林口岸需一天。",
      travel: "鸡西兴凯湖机场有国内航线；鸡西站通牡绥/哈牡铁路。",
      cityTravel: "市区打车便宜，兴凯湖和虎林靠班车或自驾。",
      experiences: [
        { name: "兴凯湖", period: "全天", note: "中俄界湖，沙滩湿地和观鸟" },
        { name: "虎头要塞", period: "上午", note: "二战遗址，中俄边境" },
        { name: "乌苏里江", period: "下午", note: "界江风光，虎林段" },
        { name: "鸡西博物馆", period: "上午", note: "东北老工业记忆" },
        { name: "密山口岸", period: "下午", note: "中俄边境口岸" },
        { name: "珍宝岛", period: "全天", note: "乌苏里江上的英雄岛" },
        { name: "鸡冠山", period: "上午", note: "城市后山" },
        { name: "麒麟山", period: "下午", note: "密山风景区" },
        { name: "北大荒开发纪念馆", period: "上午", note: "拓荒历史" },
        { name: "鸡西大冷面体验", period: "晚上", note: "城市灵魂小吃" }
      ],
      spots: []
    },
    {
      id: "hegang", name: "鹤岗", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；大界江和龙江三峡，冬季雪景",
      foods: ["鹤岗小串", "杀猪菜", "酸菜白肉", "粘豆包", "锅包肉", "铁锅炖", "豆腐脑", "冻梨"],
      foodNote: "鹤岗小串是东北烧烤代表，一把串配冰啤；龙江三峡边吃铁锅炖很应景。",
      areas: [
        { name: "向阳区", note: "市区" },
        { name: "萝北", note: "龙江三峡" },
        { name: "绥滨", note: "黑龙江边" }
      ],
      stayTip: "住向阳区，去龙江三峡约2小时；冬季鹤岗滑雪可住雪场附近。",
      travel: "鹤岗站通鹤岗铁路，连接佳木斯；自驾走鹤大高速。",
      cityTravel: "市区小，龙江三峡和名山岛需班车或自驾。",
      experiences: [
        { name: "龙江三峡", period: "全天", note: "黑龙江大峡谷，森林和界江" },
        { name: "名山岛", period: "下午", note: "黑龙江中的岛屿，俄式建筑" },
        { name: "鹤岗矿山公园", period: "上午", note: "煤矿工业记忆" },
        { name: "将军石", period: "下午", note: "黑龙江边的巨石" },
        { name: "绥滨口岸", period: "上午", note: "中俄边境" },
        { name: "鹤岗滑雪场", period: "全天", note: "冬季滑雪" },
        { name: "红松林国家森林公园", period: "全天", note: "原始森林" },
        { name: "鹤岗小串烧烤街", period: "晚上", note: "东北烧烤" },
        { name: "天水湖公园", period: "傍晚", note: "市区湖泊" },
        { name: "宝泉岭现代农业", period: "下午", note: "北大荒田园" }
      ],
      spots: []
    },
    {
      id: "shuangyashan", name: "双鸭山", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；七星峰和湿地，冬季寒冷",
      foods: ["双鸭山烤串", "酸菜白肉", "锅包肉", "铁锅炖", "大碴粥", "杀猪菜", "粘豆包", "冻梨"],
      foodNote: "双鸭山是煤城，烤串和铁锅炖是冬日刚需；七星峰山下的农家菜量大实在。",
      areas: [
        { name: "尖山区", note: "市区" },
        { name: "集贤/友谊", note: "北大荒农场" },
        { name: "宝清", note: "七星河湿地" }
      ],
      stayTip: "住尖山区，去七星峰约1.5小时；湿地观鸟住宝清县城。",
      travel: "双鸭山站通佳双铁路，到佳木斯约1小时；自驾走鹤大高速。",
      cityTravel: "市区打车便宜，景区靠班车或自驾。",
      experiences: [
        { name: "七星峰国家森林公园", period: "全天", note: "七座石峰，森林步道" },
        { name: "七星河湿地", period: "全天", note: "候鸟湿地，观鸟" },
        { name: "双鸭山煤博园", period: "上午", note: "煤城历史" },
        { name: "安邦河湿地", period: "下午", note: "城市湿地" },
        { name: "北大荒农机博览园", period: "上午", note: "垦区农机" },
        { name: "青山国家森林公园", period: "全天", note: "森林氧吧" },
        { name: "饶河口岸", period: "全天", note: "乌苏里江口岸" },
        { name: "大顶子山", period: "下午", note: "乌苏里江边山" },
        { name: "双鸭山烤串街", period: "晚上", note: "东北烧烤" },
        { name: "友谊农场", period: "下午", note: "现代化大农业" }
      ],
      spots: []
    },
    {
      id: "yichun", name: "伊春", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月、9-10月秋色；林海和汤旺河石林",
      foods: ["伊春山珍", "炖江鱼", "杀猪菜", "酸菜粉条", "松子", "木耳", "蓝莓", "粘豆包"],
      foodNote: "伊春是红松故乡，山珍野味和江鱼是主打；松子木耳蓝莓适合当手信。",
      areas: [
        { name: "伊美区", note: "市区" },
        { name: "汤旺河", note: "林海奇石" },
        { name: "嘉荫", note: "恐龙之乡" }
      ],
      stayTip: "住伊美区，汤旺河石林住汤旺县；嘉荫恐龙地质公园需一天。",
      travel: "伊春林都机场有国内航线；伊春站通南乌铁路。",
      cityTravel: "市区打车方便，林海景区靠班车或自驾。",
      experiences: [
        { name: "汤旺河林海奇石", period: "全天", note: "花岗岩石林和红松林海" },
        { name: "五营国家森林公园", period: "全天", note: "红松原始森林" },
        { name: "嘉荫恐龙地质公园", period: "全天", note: "恐龙化石发掘地" },
        { name: "茅兰沟", period: "全天", note: "峡谷瀑布" },
        { name: "上甘岭溪水森林公园", period: "上午", note: "森林溪流" },
        { name: "伊春红松林", period: "下午", note: "林都地标" },
        { name: "金山鹿苑", period: "上午", note: "和梅花鹿互动" },
        { name: "北山公园", period: "傍晚", note: "城市山林" },
        { name: "汤旺河漂流", period: "下午", note: "夏季漂流" },
        { name: "伊春蓝莓基地", period: "上午", note: "蓝莓采摘" }
      ],
      spots: []
    },
    {
      id: "jiamusi", name: "佳木斯", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；三江平原和湿地，秋季稻田金黄",
      foods: ["佳木斯拌面", "三江鱼", "杀猪菜", "酸菜火锅", "锅包肉", "大碴粥", "粘豆包", "冻梨"],
      foodNote: "佳木斯是东北粮仓，三江鱼鲜，拌面配豆腐脑是本地早餐。",
      areas: [
        { name: "前进区", note: "市区" },
        { name: "抚远", note: "黑瞎子岛" },
        { name: "同江", note: "三江口" }
      ],
      stayTip: "住前进区，抚远黑瞎子岛需一天；三江口半天。",
      travel: "佳木斯机场通全国；哈佳高铁到哈尔滨约2小时。",
      cityTravel: "市区公交打车方便，抚远和同江靠班车或自驾。",
      experiences: [
        { name: "黑瞎子岛", period: "全天", note: "中国最东端，湿地和界碑" },
        { name: "三江口", period: "下午", note: "黑龙江松花江乌苏里江汇合" },
        { name: "抚远东极广场", period: "早上", note: "中国最早见到太阳的地方" },
        { name: "同江赫哲族村", period: "上午", note: "赫哲族风情" },
        { name: "街津口", period: "下午", note: "黑龙江边和赫哲文化" },
        { name: "三江平原湿地", period: "全天", note: "大湿地和候鸟" },
        { name: "佳木斯松花江", period: "傍晚", note: "江边夜景" },
        { name: "乌苏镇", period: "上午", note: "东方第一哨" },
        { name: "佳木斯粮库", period: "下午", note: "北大荒粮仓" },
        { name: "东北民俗村", period: "上午", note: "雪乡体验" }
      ],
      spots: []
    },
    {
      id: "qitaihe", name: "七台河", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；桃山湖和森林，冬季冰雪",
      foods: ["七台河烤肉", "杀猪菜", "酸菜白肉", "铁锅炖", "粘豆包", "锅包肉", "大碴粥", "冻梨"],
      foodNote: "七台河是煤城和短道速滑之乡，烤肉和铁锅炖是主流，桃山湖边农家菜不错。",
      areas: [
        { name: "桃山区", note: "市区" },
        { name: "勃利", note: "西大圈" },
        { name: "金沙", note: "湿地" }
      ],
      stayTip: "住桃山区，桃山湖半日游；勃利西大圈需一天。",
      travel: "七台河站通牡佳铁路；自驾走鹤大高速。",
      cityTravel: "市区小，景区靠班车或自驾。",
      experiences: [
        { name: "桃山湖", period: "下午", note: "城市湖泊，湿地" },
        { name: "西大圈", period: "全天", note: "勃利森林峡谷" },
        { name: "仙洞山公园", period: "上午", note: "市区山景" },
        { name: "金沙水库", period: "下午", note: "水库湿地" },
        { name: "七台河短道速滑馆", period: "上午", note: "冠军摇篮" },
        { name: "万宝山", period: "下午", note: "森林步道" },
        { name: "七台河煤矿遗址", period: "上午", note: "煤城记忆" },
        { name: "大横山", period: "全天", note: "林区穿越" },
        { name: "七台河烤肉街", period: "晚上", note: "东北烤肉" },
        { name: "茄子河漂流", period: "下午", note: "夏季漂流" }
      ],
      spots: []
    },
    {
      id: "daxinganling", name: "大兴安岭", province: "黑龙江", region: "东北", climate: "cold", cost: "low",
      best: "6-9月、9-10月秋色；林海和漠河极光",
      foods: ["炖江鱼", "森林菌菇", "杀猪菜", "酸菜粉", "蓝莓", "松子", "粘豆包", "冻梨"],
      foodNote: "大兴安岭地区在黑龙江最北，森林和界江食材鲜；漠河冬季可看极光。",
      areas: [
        { name: "加格达奇", note: "地区首府" },
        { name: "漠河", note: "北极村" },
        { name: "呼玛", note: "界江" }
      ],
      stayTip: "住加格达奇或漠河，北极村看极光住村内；冬季注意极寒保暖。",
      travel: "加格达奇机场通哈尔滨/北京；嫩林铁路和加漠公路连接。",
      cityTravel: "地广人稀，全程自驾或包车。",
      experiences: [
        { name: "北极村", period: "全天", note: "中国最北村庄，极光和极昼" },
        { name: "漠河圣诞村", period: "下午", note: "北欧风格，冬季" },
        { name: "九曲十八弯", period: "上午", note: "额木尔河弯道观景" },
        { name: "白桦林", period: "下午", note: "大兴安岭白桦" },
        { name: "呼玛河", period: "全天", note: "界江湿地" },
        { name: "龙江第一湾", period: "全天", note: "黑龙江大拐弯" },
        { name: "加格达奇北山", period: "上午", note: "林区城市" },
        { name: "大兴安岭湿地", period: "全天", note: "寒温带湿地" },
        { name: "胭脂沟", period: "上午", note: "老金沟，淘金史" },
        { name: "漠河冬至线", period: "下午", note: "北纬53°打卡" },
        { name: "驯鹿园", period: "上午", note: "鄂温克驯鹿" },
        { name: "极光观测（冬季）", period: "晚上", note: "漠河冬夜看极光" }
      ],
      spots: []
    },
    {
      id: "siping", name: "四平", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；叶赫那拉和湿地，夏季凉快",
      foods: ["四平李连贵熏肉大饼", "酸菜白肉", "锅包肉", "杀猪菜", "粘豆包", "烤冷面", "大碴粥", "冻梨"],
      foodNote: "李连贵熏肉大饼是四平百年老字号，配碗小米粥刚好；杀猪菜冬天必点。",
      areas: [
        { name: "铁西区", note: "市区" },
        { name: "叶赫", note: "满族古城" },
        { name: "双辽", note: "湿地" }
      ],
      stayTip: "住铁西区，叶赫那拉城约1小时；湿地可半日游。",
      travel: "四平站通哈大高铁，到长春/沈阳约1小时。",
      cityTravel: "市区公交打车方便，景区靠班车或自驾。",
      experiences: [
        { name: "叶赫那拉古城", period: "全天", note: "满族发祥地之一，古城墙" },
        { name: "四平战役纪念馆", period: "上午", note: "四战四平，红色历史" },
        { name: "二龙湖", period: "下午", note: "水库湿地" },
        { name: "山门水库", period: "上午", note: "湖光山色" },
        { name: "梨树县国家湿地公园", period: "全天", note: "湿地候鸟" },
        { name: "四平动物园", period: "下午", note: "亲子游" },
        { name: "叶赫滑雪场", period: "全天", note: "冬季滑雪" },
        { name: "四平博物馆", period: "上午", note: "城市历史" },
        { name: "南北河公园", period: "傍晚", note: "城市滨河" },
        { name: "李连贵熏肉大饼", period: "晚上", note: "百年名吃" }
      ],
      spots: []
    },
    {
      id: "liaoyuan", name: "辽源", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；湿地和城市公园，冬季冰雪",
      foods: ["辽源烧烤", "酸菜白肉", "锅包肉", "杀猪菜", "粘豆包", "大碴粥", "烤冷面", "冻梨"],
      foodNote: "辽源是“中国梅花鹿之乡”和煤城，烧烤和酸菜是日常，鹿产品可当手信。",
      areas: [
        { name: "龙山区", note: "市区" },
        { name: "东丰", note: "梅花鹿" },
        { name: "东辽", note: "湿地" }
      ],
      stayTip: "住龙山区，东丰梅花鹿园约1小时。",
      travel: "辽源站通四梅铁路，到长春约1.5小时。",
      cityTravel: "市区打车便宜，景区靠班车。",
      experiences: [
        { name: "辽源龙首山", period: "上午", note: "市区山地，魁星楼" },
        { name: "东丰中国梅花鹿园", period: "全天", note: "梅花鹿养殖观赏" },
        { name: "杨木水库", period: "下午", note: "水库湿地" },
        { name: "辽源湿地公园", period: "傍晚", note: "城市湿地" },
        { name: "向阳山森林公园", period: "全天", note: "森林步道" },
        { name: "辽源博物馆", period: "上午", note: "煤城历史" },
        { name: "东辽河", period: "下午", note: "沿河风光" },
        { name: "辽源滑雪场", period: "全天", note: "冬季滑雪" },
        { name: "鹿苑餐厅", period: "晚上", note: "鹿肉品尝" },
        { name: "辽源烧烤街", period: "晚上", note: "东北烧烤" }
      ],
      spots: []
    },
    {
      id: "baishan", name: "白山", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月、9-10月秋色；长白山脚下和鸭绿江",
      foods: ["长白山山珍", "鸭绿江鱼", "酸菜白肉", "杀猪菜", "粘豆包", "松籽", "木耳", "冻梨"],
      foodNote: "白山是长白山门户，山珍野味和鸭绿江鱼是主打，冬季滑雪和温泉。",
      areas: [
        { name: "浑江区", note: "市区" },
        { name: "抚松", note: "长白山西坡" },
        { name: "临江", note: "鸭绿江" }
      ],
      stayTip: "去长白山西坡住抚松或松江河，鸭绿江边住临江。",
      travel: "白山长白山机场通航线；通白铁路/长白山站有高铁（西坡）。",
      cityTravel: "市区打车方便，长白山和临江需班车或自驾。",
      experiences: [
        { name: "长白山西坡天池", period: "全天", note: "登1442级台阶看天池" },
        { name: "锦江大峡谷", period: "下午", note: "长白山峡谷" },
        { name: "长白山国际度假区", period: "全天", note: "滑雪温泉度假" },
        { name: "鸭绿江边境风光", period: "全天", note: "临江段，中朝界江" },
        { name: "露水河国家森林公园", period: "全天", note: "原始红松林" },
        { name: "干饭盆", period: "下午", note: "火山口地貌" },
        { name: "白山湖", period: "上午", note: "水库湖泊" },
        { name: "望天鹅景区", period: "全天", note: "火山玄武岩柱状节理" },
        { name: "长白朝鲜族村", period: "上午", note: "朝鲜族风情" },
        { name: "老秃顶子", period: "下午", note: "高山草甸" },
        { name: "白山温泉", period: "晚上", note: "温泉泡汤" },
        { name: "雪岭", period: "全天", note: "冬季雪景" }
      ],
      spots: []
    },
    {
      id: "songyuan", name: "松原", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；查干湖和湿地，冬季冬捕",
      foods: ["查干湖鱼", "全鱼宴", "酸菜白肉", "锅包肉", "杀猪菜", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "查干湖鱼全国有名，冬捕季的胖头鱼最鲜；酸菜白肉是冬日标配。",
      areas: [
        { name: "宁江区", note: "市区" },
        { name: "前郭", note: "查干湖" },
        { name: "乾安", note: "泥林" }
      ],
      stayTip: "住宁江区或查干湖畔，冬捕季查干湖住宿紧张早订。",
      travel: "松原站通长白铁路，到长春约1小时；查干湖有高速直达。",
      cityTravel: "市区打车便宜，查干湖和乾安泥林需自驾或班车。",
      experiences: [
        { name: "查干湖", period: "全天", note: "中国第六大淡水湖，冬捕奇观" },
        { name: "查干湖冬捕", period: "全天", note: "12月-次年2月冰上冬捕" },
        { name: "乾安泥林", period: "全天", note: "潜蚀地貌，泥林奇观" },
        { name: "郭尔罗斯王府", period: "上午", note: "清代蒙古王府" },
        { name: "查干湖湿地", period: "下午", note: "候鸟天堂" },
        { name: "龙华寺", period: "上午", note: "松原古寺" },
        { name: "松原大桥", period: "傍晚", note: "松花江夜景" },
        { name: "查干湖渔家乐", period: "晚上", note: "全鱼宴" },
        { name: "前郭草原", period: "下午", note: "蒙古族风情" },
        { name: "松原博物馆", period: "上午", note: "查干湖文化" }
      ],
      spots: []
    },
    {
      id: "baicheng", name: "白城", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；向海湿地和莫莫格，夏季凉",
      foods: ["白城烤羊", "酸菜白肉", "锅包肉", "杀猪菜", "粘豆包", "大碴粥", "烤全羊", "冻梨"],
      foodNote: "白城是鹤乡，向海和莫莫格湿地观鸟；烤全羊和酸菜是东北味。",
      areas: [
        { name: "洮北区", note: "市区" },
        { name: "通榆", note: "向海湿地" },
        { name: "镇赉", note: "莫莫格" }
      ],
      stayTip: "住洮北区，向海和莫莫格各需一天。",
      travel: "白城站通长白铁路，到长春约2小时。",
      cityTravel: "市区小，湿地景区靠班车或自驾。",
      experiences: [
        { name: "向海国家级自然保护区", period: "全天", note: "世界A级湿地，鹤类和候鸟" },
        { name: "莫莫格湿地", period: "全天", note: "白鹤之乡" },
        { name: "查干浩特旅游区", period: "下午", note: "草原湖泊" },
        { name: "白城东湖", period: "傍晚", note: "城市湖泊" },
        { name: "向海蒙古族村", period: "上午", note: "民族风情" },
        { name: "大安嫩江湾", period: "全天", note: "嫩江湿地" },
        { name: "洮儿河", period: "下午", note: "河流湿地" },
        { name: "白城博物馆", period: "上午", note: "鹤乡历史" },
        { name: "烤全羊体验", period: "晚上", note: "草原风味" },
        { name: "向海观鸟", period: "早上", note: "晨观候鸟" }
      ],
      spots: []
    },
    {
      id: "yanbian", name: "延边", province: "吉林", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；长白山北坡和朝鲜族风情，冬季滑雪",
      foods: ["冷面", "石锅拌饭", "烤牛肉", "泡菜", "打糕", "辣白菜", "米酒", "烤串"],
      foodNote: "延边是朝鲜族聚居地，冷面配锅包肉是绝配，延吉烧烤和米酒是夜宵灵魂。",
      areas: [
        { name: "延吉", note: "州府" },
        { name: "安图/二道白河", note: "长白山北坡" },
        { name: "珲春", note: "边境口岸" }
      ],
      stayTip: "住延吉逛美食，去长白山住二道白河镇；珲春图们口岸需一天。",
      travel: "延吉朝阳川机场通国内主要城市；长珲高铁到长春约2.5小时。",
      cityTravel: "延吉公交打车方便，长白山和珲春靠班车或自驾。",
      experiences: [
        { name: "长白山北坡天池", period: "全天", note: "经典路线，看天池和瀑布" },
        { name: "长白山瀑布", period: "上午", note: "长白瀑布和温泉群" },
        { name: "绿渊潭", period: "下午", note: "碧水深潭" },
        { name: "延吉中国朝鲜族民俗园", period: "上午", note: "朝鲜族传统民居和歌舞" },
        { name: "帽儿山", period: "下午", note: "延吉城市森林" },
        { name: "珲春防川", period: "全天", note: "一眼望三国（中俄朝）" },
        { name: "图们口岸", period: "上午", note: "中朝界桥" },
        { name: "敦化六鼎山", period: "全天", note: "金鼎大佛" },
        { name: "龙井朝鲜族村", period: "下午", note: "民俗体验" },
        { name: "延吉水上市场", period: "早上", note: "烟火气早市" },
        { name: "长白山温泉", period: "晚上", note: "天然温泉" },
        { name: "安图雪山飞湖", period: "全天", note: "湖泊度假" }
      ],
      spots: []
    }
  ],
  COORDS_ADD: {
    "鸡西": [["兴凯湖", 45.210, 132.180], ["虎头要塞", 45.980, 133.490]],
    "鹤岗": [["龙江三峡", 47.590, 130.300], ["名山岛", 47.690, 130.800]],
    "双鸭山": [["七星峰国家森林公园", 46.560, 131.200], ["七星河湿地", 46.730, 131.970]],
    "伊春": [["汤旺河林海奇石", 48.450, 129.570], ["五营国家森林公园", 48.120, 129.240]],
    "佳木斯": [["黑瞎子岛", 48.350, 134.790], ["三江口", 47.700, 132.510]],
    "七台河": [["桃山湖", 45.800, 131.000], ["西大圈", 45.990, 130.600]],
    "大兴安岭": [["北极村", 53.490, 122.350], ["龙江第一湾", 53.410, 123.050]],
    "四平": [["叶赫那拉古城", 43.300, 124.630], ["二龙湖", 43.230, 124.450]],
    "辽源": [["东丰中国梅花鹿园", 42.680, 125.530], ["龙首山", 42.900, 125.140]],
    "白山": [["长白山西坡天池", 42.000, 128.050], ["望天鹅景区", 41.780, 128.100]],
    "松原": [["查干湖", 45.240, 124.260], ["乾安泥林", 45.020, 124.030]],
    "白城": [["向海国家级自然保护区", 44.980, 122.780], ["莫莫格湿地", 46.040, 123.200]],
    "延边": [["长白山北坡天池", 42.040, 128.060], ["珲春防川", 42.440, 130.650], ["延吉中国朝鲜族民俗园", 42.910, 129.510]]
  }
};
