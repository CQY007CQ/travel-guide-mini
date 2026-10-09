// v1.14 全域收录 第12批：广东4/广西4/海南三沙/山东2/宁夏4（CITIES 缺记录）
// 三沙原缺锚点，用西沙群岛参考坐标补 SPOT_COORDS（导航可到南海，具体码头再问）。
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "maoming", name: "茂名", province: "广东", region: "华南", climate: "hot", cost: "low",
      best: "5-10月；中国第一滩和电白海岸，夏季戏水",
      foods: ["茂名荔枝", "化州橘红", "电白海鲜", "簸箕炊", "沙琅粉皮", "水东芥菜", "狗肉(慎食)", "香油鸡"],
      foodNote: "茂名是中国荔枝之乡，五月荔枝最甜；电白海鲜和簸箕炊是本地味。",
      areas: [
        { name: "茂南区", note: "市区" },
        { name: "电白", note: "中国第一滩" },
        { name: "高州/信宜", note: "荔枝和山岳" }
      ],
      stayTip: "住茂南区，中国第一滩约40分钟；高州荔枝季一天。",
      travel: "茂名站通深湛高铁，到广州约1.5小时。",
      cityTravel: "市区公交打车方便，第一滩有公交。",
      experiences: [
        { name: "中国第一滩", period: "全天", note: "电白沙滩，水上运动" },
        { name: "放鸡岛", period: "全天", note: "潜水海岛" },
        { name: "浪漫海岸", period: "下午", note: "滨海度假" },
        { name: "御水古温泉", period: "晚上", note: "温泉泡汤" },
        { name: "高州贡园", period: "上午", note: "千年荔枝园" },
        { name: "信宜天马山", period: "全天", note: "高山草原" },
        { name: "茂名森林公园", period: "下午", note: "城市绿地" },
        { name: "中国荔枝博览馆", period: "上午", note: "荔枝文化" },
        { name: "电白港", period: "下午", note: "渔港日落" },
        { name: "化州南山寺", period: "上午", note: "古寺" },
        { name: "茂名红树林", period: "傍晚", note: "湿地栈道" },
        { name: "水东湾海洋公园", period: "下午", note: "滨海湿地" }
      ],
      spots: []
    },
    {
      id: "shanwei", name: "汕尾", province: "广东", region: "华南", climate: "hot", cost: "low",
      best: "5-10月；红海湾和玄武山，夏季戏水",
      foods: ["汕尾薄饼", "菜茶", "马鲛鱼丸", "公平牛肉脯", "红海湾海鲜", "陆丰咸茶", "猪肠粉", "蚝烙"],
      foodNote: "汕尾菜茶和薄饼是地方名吃，红海湾的海鲜新鲜；陆丰玄武山香火旺。",
      areas: [
        { name: "城区", note: "市区" },
        { name: "红海湾", note: "滨海" },
        { name: "陆丰", note: "玄武山" }
      ],
      stayTip: "住城区或红海湾，玄武山住陆丰县城。",
      travel: "汕尾站通厦深高铁，到深圳约1小时。",
      cityTravel: "市区公交打车方便，红海湾有专线。",
      experiences: [
        { name: "红海湾", period: "全天", note: "遮浪半岛，帆船和沙滩" },
        { name: "玄武山", period: "全天", note: "陆丰宗教名山" },
        { name: "凤山祖庙", period: "上午", note: "妈祖文化" },
        { name: "风车岛", period: "下午", note: "红海湾风车海岸" },
        { name: "沙舌尾", period: "下午", note: "海景步道" },
        { name: "陆河梅园", period: "上午", note: "梅花季" },
        { name: "海丰红宫红场", period: "上午", note: "红色历史" },
        { name: "莲花山度假村", period: "全天", note: "温泉和山景" },
        { name: "汕尾港", period: "傍晚", note: "渔港夜景" },
        { name: "甲子古镇", period: "下午", note: "滨海古镇" }
      ],
      spots: []
    },
    {
      id: "yangjiang", name: "阳江", province: "广东", region: "华南", climate: "hot", cost: "low",
      best: "5-10月；海陵岛和阳春山水",
      foods: ["阳江豆豉", "海陵岛海鲜", "阳春春砂仁", "闸坡鱿鱼", "猪肠碌", "阳江粉酥", "鹅乸饭", "生蚝"],
      foodNote: "阳江豆豉全国有名，海陵岛海鲜和生蚝鲜甜；猪肠碌是本地小吃。",
      areas: [
        { name: "江城区", note: "市区" },
        { name: "海陵岛", note: "滨海" },
        { name: "阳春", note: "山水" }
      ],
      stayTip: "住海陵岛闸坡看海，阳春凌霄岩半天。",
      travel: "阳江站通深湛高铁，到广州约1.5小时。",
      cityTravel: "市区公交方便，海陵岛有旅游专线。",
      experiences: [
        { name: "海陵岛", period: "全天", note: "广东很美的海岛之一" },
        { name: "闸坡大角湾", period: "全天", note: "沙滩和水上乐园" },
        { name: "阳春凌霄岩", period: "全天", note: "喀斯特溶洞" },
        { name: "十里银滩", period: "下午", note: "超长沙滩" },
        { name: "海上丝绸之路博物馆", period: "上午", note: "南海I号沉船" },
        { name: "马尾岛", period: "傍晚", note: "看日落" },
        { name: "春湾石林", period: "上午", note: "阳春石林" },
        { name: "阳江豆豉文化", period: "下午", note: "特产体验" },
        { name: "沙扒湾", period: "全天", note: "阳西滨海" },
        { name: "东平珍珠湾", period: "下午", note: "阳东沙滩" },
        { name: "阳江风筝馆", period: "上午", note: "风筝之乡" },
        { name: "海陵岛出海", period: "上午", note: "渔排和垂钓" }
      ],
      spots: []
    },
    {
      id: "yunfu", name: "云浮", province: "广东", region: "华南", climate: "hot", cost: "low",
      best: "4-6月、9-11月；石文化和温泉",
      foods: ["云浮石磨肠粉", "新兴凉果", "罗定豆豉", "郁南无核黄皮", "罗定鱼腐", "新兴裹蒸粽", "云城米粉", "山稔"],
      foodNote: "云浮是石材之都，石磨肠粉细滑；新兴凉果和罗定豆豉是手信。",
      areas: [
        { name: "云城区", note: "市区" },
        { name: "新兴", note: "六祖故里和温泉" },
        { name: "罗定", note: "古城和田园" }
      ],
      stayTip: "住云城区，新兴六祖故里约1小时；罗定古城半日游。",
      travel: "云浮东站通南广高铁，到广州约1小时。",
      cityTravel: "市区打车便宜，新兴和罗定靠班车。",
      experiences: [
        { name: "国恩寺", period: "全天", note: "六祖惠能故里，禅宗祖庭" },
        { name: "云浮石文化艺术馆", period: "上午", note: "石材之都" },
        { name: "新兴金水台温泉", period: "晚上", note: "温泉" },
        { name: "蟠龙洞", period: "下午", note: "城市溶洞" },
        { name: "罗定文塔", period: "上午", note: "古塔" },
        { name: "郁南连滩油菜花", period: "上午", note: "春季花海" },
        { name: "天露山", period: "全天", note: "新兴高山草原" },
        { name: "龙潭湖", period: "下午", note: "山水" },
        { name: "云浮石材市场", period: "下午", note: "石艺市场" },
        { name: "罗定长岗坡渡槽", period: "上午", note: "水利工程" },
        { name: "新兴象窝茶场", period: "下午", note: "茶园" },
        { name: "云浮石磨肠粉店", period: "晚上", note: "地方名吃" }
      ],
      spots: []
    },
    {
      id: "guigang", name: "贵港", province: "广西", region: "华南", climate: "hot", cost: "low",
      best: "4-6月、9-11月；荷花和西江",
      foods: ["贵港莲藕", "桂平西山茶", "平南三利小刀(非食)", "荷城豆腐", "罗秀米粉", "东津细米", "酸嘢", "河鲜"],
      foodNote: "贵港是荷城，莲藕和河鲜是主打；桂平西山茶清香。",
      areas: [
        { name: "港北区", note: "市区" },
        { name: "桂平", note: "西山" },
        { name: "平南", note: "北帝山" }
      ],
      stayTip: "住港北区，桂平西山约1小时。",
      travel: "贵港站通南广高铁，到南宁约1小时。",
      cityTravel: "市区公交打车方便，桂平和北帝山靠班车。",
      experiences: [
        { name: "东湖公园", period: "上午", note: "荷城荷花" },
        { name: "桂平西山", period: "全天", note: "佛教名山和乳泉" },
        { name: "龙潭国家森林公园", period: "全天", note: "瀑布森林" },
        { name: "北帝山", period: "全天", note: "平南石山" },
        { name: "大藤峡", period: "全天", note: "峡谷和水利工程" },
        { name: "金田起义遗址", period: "上午", note: "太平天国策源地" },
        { name: "南山寺", period: "下午", note: "贵港古寺" },
        { name: "西江风光", period: "傍晚", note: "江边夜景" },
        { name: "平南大安古镇", period: "上午", note: "古镇" },
        { name: "贵港荷塘", period: "下午", note: "夏季荷花" }
      ],
      spots: []
    },
    {
      id: "hechi", name: "河池", province: "广西", region: "华南", climate: "hot", cost: "low",
      best: "4-6月、9-11月；小三峡和长寿之乡",
      foods: ["河池煮粉", "巴马香猪", "环江香牛", "东兰墨米", "宜州粽子", "都安黑山羊", "龙州河鱼", "豆腐圆"],
      foodNote: "河池是长寿之乡，巴马香猪和火麻汤有名；宜州粽子个头大。",
      areas: [
        { name: "金城江区", note: "市区" },
        { name: "宜州", note: "刘三姐故里" },
        { name: "巴马", note: "长寿村" }
      ],
      stayTip: "住金城江区，宜州约1小时，巴马约2小时。",
      travel: "河池机场通国内航线；贵南高铁河池西站到南宁约1小时。",
      cityTravel: "市区打车方便，巴马和宜州靠班车。",
      experiences: [
        { name: "巴马长寿村", period: "全天", note: "百魔洞和长寿文化" },
        { name: "宜州刘三姐故里", period: "全天", note: "山歌文化" },
        { name: "龙江小三峡", period: "全天", note: "河池峡谷" },
        { name: "百魔洞", period: "上午", note: "巴马溶洞" },
        { name: "水晶宫", period: "下午", note: "白色溶洞" },
        { name: "都安地下河", period: "全天", note: "暗河探险" },
        { name: "环江牛角寨", period: "上午", note: "瀑布群" },
        { name: "凤山三门海", period: "全天", note: "天窗水洞" },
        { name: "东兰红水河", period: "下午", note: "红水河风光" },
        { name: "宜州下枧河", period: "上午", note: "竹筏山歌" },
        { name: "河池博物馆", period: "下午", note: "民族历史" },
        { name: "巴马火麻汤", period: "晚上", note: "长寿美食" }
      ],
      spots: []
    },
    {
      id: "laibin", name: "来宾", province: "广西", region: "华南", climate: "hot", cost: "low",
      best: "4-6月、9-11月；金秀大瑶山",
      foods: ["来宾米粉", "金秀竹筒饭", "忻城土鸡", "武宣三姐酒", "象州米饼", "金秀红茶", "瑶族油茶", "酸鱼"],
      foodNote: "来宾是瑶族聚居地，金秀竹筒饭和油茶有山野味。",
      areas: [
        { name: "兴宾区", note: "市区" },
        { name: "金秀", note: "大瑶山" },
        { name: "武宣/象州", note: "山水" }
      ],
      stayTip: "住兴宾区，金秀大瑶山需一天，住金秀县城更好。",
      travel: "来宾北站通柳南高铁，到南宁约1小时。",
      cityTravel: "市区公交打车方便，金秀靠班车。",
      experiences: [
        { name: "金秀大瑶山", period: "全天", note: "圣堂山和瑶族风情" },
        { name: "圣堂山", period: "全天", note: "云海和杜鹃" },
        { name: "莲花山", period: "全天", note: "金秀丹霞" },
        { name: "象州温泉", period: "晚上", note: "温泉" },
        { name: "武宣百崖大峡谷", period: "全天", note: "峡谷瀑布" },
        { name: "来宾麒麟山", period: "上午", note: "古人类遗址" },
        { name: "忻城莫土司衙署", period: "上午", note: "土司文化" },
        { name: "金秀瑶族博物馆", period: "下午", note: "瑶族服饰" },
        { name: "红水河", period: "傍晚", note: "河景" },
        { name: "象州石龙古镇", period: "上午", note: "古镇" },
        { name: "金秀茶园", period: "下午", note: "高山茶" },
        { name: "来宾夜市", period: "晚上", note: "米粉和酸嘢" }
      ],
      spots: []
    },
    {
      id: "chongzuo", name: "崇左", province: "广西", region: "华南", climate: "hot", cost: "low",
      best: "4-6月、9-11月；德天瀑布和明仕田园",
      foods: ["崇左烤猪", "龙州桄榔粉", "宁明八角", "凭祥越南卷粉", "大新酸鱼", "扶绥姑辽茶", "糯米饭", "酸嘢"],
      foodNote: "崇左是中越边境，凭祥卷粉和烤猪有跨境风味；大新明仕田园边吃农家菜。",
      areas: [
        { name: "江州区", note: "市区" },
        { name: "大新", note: "德天瀑布" },
        { name: "凭祥", note: "友谊关" }
      ],
      stayTip: "住大新县或明仕田园民宿，凭祥友谊关半天。",
      travel: "崇左南站通南凭高铁，到南宁约1小时；德天瀑布有旅游专线。",
      cityTravel: "市区打车方便，德天和明仕靠班车或自驾。",
      experiences: [
        { name: "德天跨国瀑布", period: "全天", note: "亚洲第一跨国瀑布" },
        { name: "明仕田园", period: "全天", note: "桂林山水式田园" },
        { name: "友谊关", period: "上午", note: "中国南大门" },
        { name: "花山岩画", period: "全天", note: "世界遗产，左江岩画" },
        { name: "凭祥浦寨口岸", period: "下午", note: "边贸市场" },
        { name: "大新龙宫仙境", period: "上午", note: "溶洞" },
        { name: "明仕竹筏", period: "下午", note: "河上观光" },
        { name: "黑水河", period: "全天", note: "峡谷河流" },
        { name: "崇左斜塔", period: "上午", note: "左江斜塔" },
        { name: "凭祥大连城", period: "下午", note: "边境要塞" },
        { name: "扶绥炎鑫景区", period: "上午", note: "乡村" },
        { name: "德天瀑布夜场", period: "晚上", note: "灯光瀑布" }
      ],
      spots: []
    },
    {
      id: "sansha", name: "三沙", province: "海南", region: "华南", climate: "hot", cost: "high",
      best: "10月-次年4月；西沙群岛邮轮，注意航期",
      foods: ["海鲜", "石斑鱼", "海胆", "椰子", "热带水果", "海钓渔获"],
      foodNote: "三沙以南海海鲜为主，上岛物资靠补给，饮食简单鲜甜。",
      areas: [
        { name: "永兴岛", note: "三沙主岛" },
        { name: "西沙群岛", note: "邮轮航线" },
        { name: "南海诸岛", note: "远洋" }
      ],
      stayTip: "去西沙主要乘邮轮，航线从三亚出发，名额和航期需提前预约。",
      travel: "三沙无民用机场直飞（永兴机场限内部），常规走三亚邮轮航线。",
      cityTravel: "岛上交通靠电瓶车和船只，远岛需专业安排。",
      experiences: [
        { name: "西沙群岛邮轮", period: "全天", note: "乘邮轮探访西沙，玻璃海" },
        { name: "永兴岛", period: "全天", note: "三沙市政府所在地，纪念碑" },
        { name: "银屿岛", period: "全天", note: "邮轮停靠岛，玻璃海" },
        { name: "全富岛", period: "全天", note: "白沙岛，浮潜" },
        { name: "鸭公岛", period: "上午", note: "珊瑚岛" },
        { name: "西沙海钓", period: "下午", note: "南海渔获" },
        { name: "南海博物馆（三亚出发前）", period: "上午", note: "了解南海历史" },
        { name: "西沙日出", period: "早上", note: "南海日出" },
        { name: "岛礁浮潜", period: "上午", note: "清澈海水" },
        { name: "三沙灯塔", period: "下午", note: "岛礁灯塔" }
      ],
      spots: []
    },
    {
      id: "binzhou", name: "滨州", province: "山东", region: "华东", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；孙子故里和黄河湿地",
      foods: ["滨州锅子饼", "无棣金丝小枣", "沾化冬枣", "博兴草编(非食)", "惠民马蹄烧饼", "阳信鸭梨", "滨州羊汤", "黄河鲤鱼"],
      foodNote: "沾化冬枣和无棣金丝小枣是滨州名片，锅子饼和马蹄烧饼是地方主食。",
      areas: [
        { name: "滨城区", note: "市区" },
        { name: "惠民", note: "孙子故里" },
        { name: "沾化/无棣", note: "冬枣和贝壳堤" }
      ],
      stayTip: "住滨城区，孙子兵法城约1小时。",
      travel: "滨州站通德大铁路；自驾走长深高速，到济南约1.5小时。",
      cityTravel: "市区公交打车方便，惠民和沾化靠班车。",
      experiences: [
        { name: "中国孙子兵法城", period: "全天", note: "孙子故里" },
        { name: "黄河湿地", period: "全天", note: "候鸟和芦苇" },
        { name: "沾化冬枣园", period: "上午", note: "冬枣采摘" },
        { name: "无棣贝壳堤", period: "下午", note: "古贝壳堤" },
        { name: "魏氏庄园", period: "全天", note: "清代庄园" },
        { name: "滨州博物馆", period: "上午", note: "孙子文化" },
        { name: "阳信万亩梨园", period: "上午", note: "梨花季" },
        { name: "渤海湾渔港", period: "下午", note: "渔港日落" },
        { name: "惠民古城", period: "上午", note: "老城" },
        { name: "秦皇台", period: "下午", note: "古台遗址" },
        { name: "滨州锅子饼老店", period: "晚上", note: "地方名吃" },
        { name: "麻大湖湿地", period: "全天", note: "湖区和芦苇" }
      ],
      spots: []
    },
    {
      id: "heze", name: "菏泽", province: "山东", region: "华东", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；牡丹和曹州古城",
      foods: ["菏泽单县羊肉汤", "曹县烧牛肉", "菏泽水煎包", "郓城壮馍", "成武酱菜", "牡丹花茶", "菏泽羊汤", "饹馇"],
      foodNote: "菏泽是牡丹之都，单县羊肉汤全国有名；曹县汉服文化和烧牛肉是网红名片。",
      areas: [
        { name: "牡丹区", note: "市区" },
        { name: "曹县", note: "汉服和牛肉" },
        { name: "郓城/单县", note: "水浒和羊汤" }
      ],
      stayTip: "住牡丹区，曹县约1小时，单县羊汤需专程。",
      travel: "菏泽东站通鲁南高铁，到济南约1.5小时。",
      cityTravel: "市区公交打车方便，县区靠班车。",
      experiences: [
        { name: "曹州牡丹园", period: "全天", note: "4月牡丹花海" },
        { name: "单县浮龙湖", period: "全天", note: "湖泊湿地" },
        { name: "水浒好汉城", period: "全天", note: "郓城水浒文化" },
        { name: "曹县汉服街", period: "下午", note: "汉服产业" },
        { name: "菏泽博物馆", period: "上午", note: "牡丹和黄河文化" },
        { name: "古今园", period: "下午", note: "牡丹古园" },
        { name: "单县羊肉汤老店", period: "上午", note: "山东名吃" },
        { name: "曹州古城", period: "晚上", note: "夜景" },
        { name: "金山旅游区", period: "全天", note: "巨野山地" },
        { name: "成武文亭湖", period: "下午", note: "湖区" },
        { name: "郓城唐塔", period: "上午", note: "古塔" },
        { name: "菏泽牡丹节", period: "全天", note: "4月花会" }
      ],
      spots: []
    },
    {
      id: "shizuishan", name: "石嘴山", province: "宁夏", region: "西北", climate: "dry", cost: "low",
      best: "5-10月；沙湖和贺兰山，夏季凉爽",
      foods: ["石嘴山烩羊杂", "沙湖鱼头", "平罗羊羔肉", "宁夏枸杞", "大武口凉皮", "贺兰山紫蘑菇", "搓面", "油香"],
      foodNote: "沙湖鱼头和烩羊杂是石嘴山名片，大武口凉皮酸辣开胃。",
      areas: [
        { name: "大武口区", note: "市区" },
        { name: "沙湖", note: "沙漠湖泊" },
        { name: "平罗", note: "西夏古迹" }
      ],
      stayTip: "住大武口区，沙湖约40分钟。",
      travel: "石嘴山站通包兰铁路；自驾走京藏高速，到银川约1小时。",
      cityTravel: "市区打车便宜，沙湖有公交/班车。",
      experiences: [
        { name: "沙湖", period: "全天", note: "沙漠和湖泊，芦苇鸟岛" },
        { name: "贺兰山（北段）", period: "全天", note: "山地和岩画" },
        { name: "北武当庙", period: "上午", note: "贺兰山古庙" },
        { name: "大武口森林公园", period: "下午", note: "城市绿地" },
        { name: "平罗玉皇阁", period: "上午", note: "古建筑" },
        { name: "沙湖鸟岛", period: "下午", note: "观鸟" },
        { name: "石嘴山奇石山", period: "上午", note: "奇石文化" },
        { name: "星海湖", period: "傍晚", note: "城市湖泊" },
        { name: "宁夏枸杞园", period: "上午", note: "枸杞采摘" },
        { name: "贺兰山紫蘑菇", period: "下午", note: "山野特产" }
      ],
      spots: []
    },
    {
      id: "wuzhong", name: "吴忠", province: "宁夏", region: "西北", climate: "dry", cost: "low",
      best: "5-10月；黄河金岸和回乡文化",
      foods: ["吴忠手抓羊肉", "羊杂碎", "八宝茶", "吴忠酿皮", "炒糊饽", "油香", "扁豆子面", "枸杞"],
      foodNote: "吴忠手抓羊肉和羊杂碎是宁夏上乘，八宝茶配油香很舒坦。",
      areas: [
        { name: "利通区", note: "市区" },
        { name: "青铜峡", note: "黄河楼" },
        { name: "盐池/同心", note: "草原和红色" }
      ],
      stayTip: "住利通区，青铜峡黄河楼约40分钟。",
      travel: "吴忠站通银兰高铁，到银川约30分钟。",
      cityTravel: "市区打车便宜，黄河楼有公交。",
      experiences: [
        { name: "青铜峡黄河楼", period: "全天", note: "黄河文化和水利" },
        { name: "黄河大峡谷", period: "全天", note: "108塔和峡谷" },
        { name: "盐池哈巴湖", period: "全天", note: "草原湖泊" },
        { name: "同心清真大寺", period: "上午", note: "红色革命遗迹" },
        { name: "吴忠美食街", period: "晚上", note: "手抓和羊杂" },
        { name: "吴忠博物馆", period: "上午", note: "回乡文化" },
        { name: "牛首山", period: "下午", note: "佛教名山" },
        { name: "盐池滩羊基地", period: "上午", note: "滩羊文化" },
        { name: "青铜峡鸟岛", period: "下午", note: "湿地观鸟" },
        { name: "同心旱塬风光", period: "下午", note: "黄土高原" }
      ],
      spots: []
    },
    {
      id: "guyuan", name: "固原", province: "宁夏", region: "西北", climate: "dry", cost: "low",
      best: "5-10月；六盘山和须弥山，夏季避暑",
      foods: ["固原手抓", "生汆面", "泾源黄牛肉", "隆德暖锅", "荞面搅团", "固原凉粉", "土豆宴", "八宝茶"],
      foodNote: "固原六盘山下的黄牛肉和手抓有西北味，隆德暖锅是冬天暖心菜。",
      areas: [
        { name: "原州区", note: "市区" },
        { name: "六盘山", note: "红军长征" },
        { name: "泾源/隆德", note: "山水" }
      ],
      stayTip: "住原州区，六盘山红军长征景区约1小时。",
      travel: "固原机场通国内航线；银昆高速连接银川/西安。",
      cityTravel: "市区打车便宜，六盘山和须弥山靠班车。",
      experiences: [
        { name: "六盘山红军长征景区", period: "全天", note: "长征胜利之山" },
        { name: "须弥山石窟", period: "全天", note: "北魏石窟群" },
        { name: "六盘山国家森林公园", period: "全天", note: "森林云海" },
        { name: "泾源老龙潭", period: "上午", note: "峡谷潭水" },
        { name: "火石寨", period: "全天", note: "丹霞地貌" },
        { name: "固原博物馆", period: "下午", note: "固原历史" },
        { name: "古雁岭", period: "上午", note: "城市山景" },
        { name: "隆德六盘山梯田", period: "下午", note: "梯田风光" },
        { name: "泾河源", period: "上午", note: "泾河源头" },
        { name: "固原老街", period: "晚上", note: "夜市和暖锅" }
      ],
      spots: []
    },
    {
      id: "zhongwei", name: "中卫", province: "宁夏", region: "西北", climate: "dry", cost: "low",
      best: "5-10月；沙坡头和沙漠星空",
      foods: ["中卫硒砂瓜", "蒿子面", "羊杂碎", "中卫酸菜", "枸杞", "黄河鲤鱼", "凉粉", "油香"],
      foodNote: "中卫硒砂瓜夏季甜，蒿子面和羊杂是本地味，沙坡头夜市热闹。",
      areas: [
        { name: "沙坡头区", note: "市区" },
        { name: "沙坡头", note: "沙漠景区" },
        { name: "海原", note: "地震遗址" }
      ],
      stayTip: "住沙坡头区，景区约20分钟；沙漠星空露营体验一晚。",
      travel: "中卫站通银兰高铁，到银川约1小时；沙坡头有机场。",
      cityTravel: "市区打车便宜，沙坡头有专线。",
      experiences: [
        { name: "沙坡头", period: "全天", note: "黄河沙漠，滑沙和羊皮筏子" },
        { name: "腾格里沙漠", period: "全天", note: "沙漠越野和露营" },
        { name: "沙坡头黄河滑索", period: "上午", note: "飞越黄河" },
        { name: "金沙岛", period: "下午", note: "沙漠花园" },
        { name: "高庙", period: "上午", note: "儒释道三教古建" },
        { name: "寺口子", period: "全天", note: "峡谷丹霞" },
        { name: "海原地震遗址", period: "下午", note: "百年地震纪念" },
        { name: "中卫黄河宫", period: "上午", note: "黄河文化" },
        { name: "沙坡头星空", period: "晚上", note: "沙漠银河" },
        { name: "中卫硒砂瓜园", period: "下午", note: "瓜田采摘" },
        { name: "黄河宿集", period: "下午", note: "黄河民宿" },
        { name: "北长滩古村", period: "上午", note: "黄河古村" }
      ],
      spots: []
    }
  ],
  CITY_COORDS_ADD: {
    "三沙": [16.834, 112.348]
  },
  COORDS_ADD: {
    "茂名": [["中国第一滩", 21.500, 111.050], ["放鸡岛", 21.360, 111.220]],
    "汕尾": [["红海湾", 22.670, 115.570], ["玄武山", 22.840, 115.740]],
    "阳江": [["海陵岛", 21.580, 111.920], ["闸坡大角湾", 21.570, 111.880]],
    "云浮": [["国恩寺", 22.700, 112.230], ["蟠龙洞", 22.930, 112.030]],
    "贵港": [["桂平西山", 23.370, 110.090], ["北帝山", 23.590, 110.460]],
    "河池": [["巴马长寿村", 24.140, 107.210], ["宜州刘三姐故里", 24.480, 108.630]],
    "来宾": [["金秀大瑶山", 24.130, 110.190], ["圣堂山", 23.920, 110.250]],
    "崇左": [["德天跨国瀑布", 22.850, 106.720], ["明仕田园", 22.850, 106.770]],
    "三沙": [["西沙群岛邮轮", 16.834, 112.348], ["永兴岛", 16.834, 112.348]],
    "滨州": [["中国孙子兵法城", 37.490, 117.580], ["黄河湿地", 37.450, 118.000]],
    "菏泽": [["曹州牡丹园", 35.240, 115.430], ["单县浮龙湖", 34.800, 116.080]],
    "石嘴山": [["沙湖", 38.780, 106.350], ["北武当庙", 39.020, 106.250]],
    "吴忠": [["青铜峡黄河楼", 37.930, 105.980], ["黄河大峡谷", 37.880, 105.940]],
    "固原": [["六盘山红军长征景区", 35.670, 106.200], ["须弥山石窟", 35.940, 106.090]],
    "中卫": [["沙坡头", 37.530, 105.020], ["腾格里沙漠", 37.490, 105.050]]
  }
};
