// v1.14 全域收录 第11批：华中/华东/华南 15 城（CITIES 缺记录，锚点/CITY2PROV 已具备）
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "xingtai", name: "邢台", province: "河北", region: "华北", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；崆山白云洞和天河山",
      foods: ["邢台焖饼", "南宫熏菜", "清河羊绒(非食)", "巨鹿银花茶", "内丘枣", "威县火烧", "临城酥鱼", "浆水豆腐"],
      foodNote: "邢台焖饼配蒜汁是本地家常，临城酥鱼和威县火烧有地方味。",
      areas: [
        { name: "襄都区", note: "市区" },
        { name: "临城", note: "崆山白云洞" },
        { name: "内丘/沙河", note: "峡谷和山岳" }
      ],
      stayTip: "住襄都区，崆山白云洞约1.5小时；天河山需一天。",
      travel: "邢台东站通京广高铁，到石家庄约40分钟。",
      cityTravel: "市区公交打车方便，景区靠班车或自驾。",
      experiences: [
        { name: "崆山白云洞", period: "上午", note: "喀斯特溶洞，钟乳石" },
        { name: "天河山", period: "全天", note: "爱情山，峡谷和瀑布" },
        { name: "邢台峡谷群", period: "全天", note: "太行峡谷" },
        { name: "郭守敬纪念馆", period: "下午", note: "元代科学家故里" },
        { name: "清风楼", period: "傍晚", note: "古城地标" },
        { name: "开元寺", period: "上午", note: "邢台古寺" },
        { name: "九龙峡", period: "全天", note: "太行山水" },
        { name: "天河山漂流", period: "下午", note: "夏季漂流" },
        { name: "内丘鹊山", period: "上午", note: "扁鹊文化" },
        { name: "临城天台山", period: "下午", note: "山地景观" },
        { name: "沙河秦王湖", period: "全天", note: "湖光山色" },
        { name: "邢台博物馆", period: "上午", note: "邢台历史" }
      ],
      spots: []
    },
    {
      id: "hengshui", name: "衡水", province: "河北", region: "华北", climate: "temperate", cost: "low",
      best: "4-10月；衡水湖和湿地",
      foods: ["衡水老白干", "武强年画(非食)", "深州蜜桃", "故城熏肉", "衡水湖鱼", "饶阳杂面", "枣强饼", "桃城豆腐脑"],
      foodNote: "衡水老白干全国有名，衡水湖的鱼鲜嫩；深州蜜桃夏末最甜。",
      areas: [
        { name: "桃城区", note: "市区" },
        { name: "衡水湖", note: "湿地" },
        { name: "武强", note: "年画" }
      ],
      stayTip: "住桃城区，衡水湖半日游；武强年画馆约1小时。",
      travel: "衡水北站通石济高铁，到石家庄约40分钟。",
      cityTravel: "市区公交打车方便，衡水湖有公交。",
      experiences: [
        { name: "衡水湖", period: "全天", note: "华北平原最大的淡水湖，候鸟" },
        { name: "武强年画博物馆", period: "上午", note: "中国木版年画之乡" },
        { name: "衡水老白干酒厂", period: "下午", note: "酒文化体验" },
        { name: "衡水中学（外观）", period: "上午", note: "教育名城外景" },
        { name: "桃城区滏阳河", period: "傍晚", note: "滨河夜景" },
        { name: "深州蜜桃园", period: "下午", note: "桃季采摘" },
        { name: "衡水湖观鸟", period: "早上", note: "候鸟天堂" },
        { name: "冀州古城", period: "上午", note: "古冀州地标" },
        { name: "衡水湖湿地公园", period: "下午", note: "栈道湿地" },
        { name: "饶阳民族乐器厂", period: "上午", note: "乐器制作" }
      ],
      spots: []
    },
    {
      id: "hebi", name: "鹤壁", province: "河南", region: "华中", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；云梦山和淇河",
      foods: ["鹤壁缠丝蛋", "浚县子馍", "淇河鲫鱼", "庙会油饼", "山城豆皮", "淇县腐竹", "大胡烩菜", "酸汤水饺"],
      foodNote: "浚县子馍和庙会美食热闹，淇河鲫鱼是当地鲜味。",
      areas: [
        { name: "淇滨区", note: "市区" },
        { name: "浚县", note: "古城和庙会" },
        { name: "淇县", note: "云梦山和古都" }
      ],
      stayTip: "住淇滨区，云梦山约1小时，浚县古城半日游。",
      travel: "鹤壁东站通京广高铁，到郑州约40分钟。",
      cityTravel: "市区公交打车方便，景区靠班车。",
      experiences: [
        { name: "云梦山", period: "全天", note: "鬼谷子故里，古军校" },
        { name: "浚县古城", period: "全天", note: "千年古城，明代城墙" },
        { name: "淇河国家湿地公园", period: "下午", note: "诗经淇水" },
        { name: "大伾山", period: "上午", note: "浚县古庙和石佛" },
        { name: "浮丘山", period: "下午", note: "道教名山" },
        { name: "朝阳山", period: "上午", note: "淇县古寺" },
        { name: "古灵山", period: "全天", note: "女娲文化" },
        { name: "鹤壁煤城遗址", period: "上午", note: "鹤煤历史" },
        { name: "鬼谷子文化园", period: "下午", note: "纵横家文化" },
        { name: "鹤壁樱花大道", period: "下午", note: "春季樱花" },
        { name: "鹿台阁", period: "傍晚", note: "市区地标" },
        { name: "浚县正月庙会", period: "全天", note: "春节很热闹" }
      ],
      spots: []
    },
    {
      id: "puyang", name: "濮阳", province: "河南", region: "华中", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；戚城遗址和杂技之乡",
      foods: ["濮阳壮馍", "裹凉皮", "濮阳烧饼", "清丰兔肉", "南乐古寺豆腐", "范县香油", "糟鱼", "胡辣汤"],
      foodNote: "濮阳壮馍皮薄馅大，裹凉皮是街头小吃，杂技之乡的演出值得看。",
      areas: [
        { name: "华龙区", note: "市区" },
        { name: "濮阳县", note: "戚城和帝舜" },
        { name: "清丰/南乐", note: "红色和古寺" }
      ],
      stayTip: "住华龙区，戚城遗址半日游；杂技演出晚上看。",
      travel: "濮阳东站通郑济高铁，到郑州约1小时。",
      cityTravel: "市区公交打车方便。",
      experiences: [
        { name: "戚城遗址", period: "上午", note: "颛顼帝丘，春秋古城" },
        { name: "濮阳东北庄杂技", period: "全天", note: "杂技之乡，看表演" },
        { name: "濮水小镇", period: "下午", note: "文旅街区" },
        { name: "中原油田", period: "上午", note: "石油城记忆" },
        { name: "挥公陵", period: "下午", note: "张姓始祖" },
        { name: "清丰单拐革命旧址", period: "上午", note: "红色旅游" },
        { name: "南乐仓颉陵", period: "下午", note: "造字始祖" },
        { name: "濮阳博物馆", period: "上午", note: "蚌塑龙文化" },
        { name: "濮水河", period: "傍晚", note: "城市河景" },
        { name: "范县毛楼生态区", period: "全天", note: "黄河岸边" },
        { name: "濮阳裹凉皮店", period: "晚上", note: "地方小吃" },
        { name: "颛顼帝喾陵", period: "上午", note: "上古陵墓" }
      ],
      spots: []
    },
    {
      id: "luohe", name: "漯河", province: "河南", region: "华中", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；许慎文化和沙澧河",
      foods: ["漯河胡辣汤", "北舞渡胡辣汤", "漯河双汇", "小商桥烧饼", "临颍板栗", "舞阳胡辣汤", "郾城烩面", "沙澧鱼"],
      foodNote: "北舞渡胡辣汤是漯河名吃，双汇火腿肠是城市名片；沙澧河畔适合散步。",
      areas: [
        { name: "源汇区", note: "市区" },
        { name: "临颍", note: "小商桥" },
        { name: "舞阳", note: "城隍庙" }
      ],
      stayTip: "住源汇区，小商桥约40分钟。",
      travel: "漯河西站通京广高铁，到郑州约40分钟。",
      cityTravel: "市区公交打车方便。",
      experiences: [
        { name: "许慎文化园", period: "上午", note: "说文解字作者故里" },
        { name: "小商桥", period: "下午", note: "宋代石拱桥" },
        { name: "沙澧河风景区", period: "傍晚", note: "穿城河景" },
        { name: "漯河双汇工业游", period: "上午", note: "食品工业" },
        { name: "北舞渡古镇", period: "下午", note: "胡辣汤和古街" },
        { name: "舞阳城隍庙", period: "上午", note: "古建筑" },
        { name: "临颍小商桥景区", period: "全天", note: "桥和碑林" },
        { name: "漯河博物馆", period: "上午", note: "贾湖文化" },
        { name: "开源森林公园", period: "下午", note: "城市绿地" },
        { name: "漯河美食街", period: "晚上", note: "胡辣汤和烧饼" }
      ],
      spots: []
    },
    {
      id: "jiyuan", name: "济源", province: "河南", region: "华中", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；王屋山和小浪底",
      foods: ["济源土馍", "黄河鲤鱼", "小浪底鱼宴", "邵原核桃", "济源银鱼", "油茶", "柿饼", "粉皮"],
      foodNote: "济源是愚公移山故里，土馍是特色小吃；小浪底水库的黄河鲤鱼鲜。",
      areas: [
        { name: "沁园街道", note: "市区" },
        { name: "王屋山", note: "道教名山" },
        { name: "小浪底", note: "黄河大坝" }
      ],
      stayTip: "住市区，王屋山约1小时，小浪底约40分钟。",
      travel: "济源通焦柳铁路；自驾走济洛高速，到洛阳约1小时。",
      cityTravel: "市区打车方便，王屋山和小浪底靠班车或自驾。",
      experiences: [
        { name: "王屋山", period: "全天", note: "愚公移山之地，道教第一洞天" },
        { name: "黄河小浪底", period: "全天", note: "黄河第一坝，调水调沙" },
        { name: "济渎庙", period: "上午", note: "隋代水神庙" },
        { name: "阳台宫", period: "下午", note: "王屋山古建筑" },
        { name: "五龙口", period: "全天", note: "猕猴自然保护区和温泉" },
        { name: "小浪底大坝观景", period: "上午", note: "大坝和黄河" },
        { name: "济源滑雪场", period: "全天", note: "冬季滑雪" },
        { name: "天坛山", period: "上午", note: "王屋山主峰" },
        { name: "世纪广场", period: "傍晚", note: "城市休闲" },
        { name: "邵原古村", period: "下午", note: "太行山村" }
      ],
      spots: []
    },
    {
      id: "ezhou", name: "鄂州", province: "湖北", region: "华中", climate: "hot", cost: "low",
      best: "4-6月、9-11月；梁子湖和三国文化",
      foods: ["鄂州武昌鱼", "梁子湖螃蟹", "鄂州鳜鱼", "胡柚", "豆腐脑", "鱼糕", "藕带", "热干面(鄂州版)"],
      foodNote: "武昌鱼原产鄂州梁子湖，湖蟹秋季肥美；藕带和鱼糕是本地鲜味。",
      areas: [
        { name: "鄂城区", note: "市区" },
        { name: "梁子湖", note: "湖区" },
        { name: "华容", note: "三国遗迹" }
      ],
      stayTip: "住鄂城区，梁子湖约1小时；武汉地铁11号线已通鄂州葛店。",
      travel: "鄂州站通武九高铁，到武汉约30分钟；葛店南站通地铁。",
      cityTravel: "市区公交方便，梁子湖靠班车或自驾。",
      experiences: [
        { name: "梁子湖", period: "全天", note: "武昌鱼和螃蟹，湿地" },
        { name: "西山风景区", period: "上午", note: "三国吴都西山" },
        { name: "观音阁", period: "下午", note: "长江中的古阁" },
        { name: "鄂州博物馆", period: "上午", note: "吴国青铜器" },
        { name: "莲花山", period: "下午", note: "城市园林" },
        { name: "梁子岛", period: "全天", note: "湖心岛和鱼市" },
        { name: "吴王避暑宫", period: "上午", note: "三国遗址" },
        { name: "凤凰广场", period: "傍晚", note: "城市地标" },
        { name: "梁子湖湿地", period: "下午", note: "候鸟天堂" },
        { name: "华容楚王城", period: "上午", note: "楚文化遗址" }
      ],
      spots: []
    },
    {
      id: "suizhou", name: "随州", province: "湖北", region: "华中", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；炎帝故里和银杏谷",
      foods: ["随州香菇", "广水滑肉", "随州蜜枣", "马坪鱼面", "三鲜豆皮", "炎帝酒", "葛粉", "板栗"],
      foodNote: "随州是炎帝神农故里和香菇之乡，香菇炖鸡和滑肉是主打。",
      areas: [
        { name: "曾都区", note: "市区" },
        { name: "随县", note: "炎帝故里和银杏谷" },
        { name: "广水", note: "三潭" }
      ],
      stayTip: "住曾都区，炎帝故里约40分钟，银杏谷秋季需一天。",
      travel: "随州站通汉十高铁，到武汉约1小时。",
      cityTravel: "市区打车方便，景区靠班车或自驾。",
      experiences: [
        { name: "炎帝神农故里", period: "全天", note: "中华始祖祭坛和景区" },
        { name: "千年银杏谷", period: "全天", note: "深秋银杏，金叶铺地" },
        { name: "随州博物馆", period: "上午", note: "编钟文化" },
        { name: "擂鼓墩曾侯乙墓", period: "下午", note: "编钟出土地" },
        { name: "大洪山", period: "全天", note: "佛教名山，云海" },
        { name: "三潭风景区", period: "全天", note: "广水峡谷瀑布" },
        { name: "中华山国家森林公园", period: "上午", note: "森林避暑" },
        { name: "桐柏山", period: "下午", note: "淮河源头" },
        { name: "随县香菇基地", period: "上午", note: "香菇种植" },
        { name: "徐家河水库", period: "下午", note: "湖光山色" },
        { name: "编钟演奏会", period: "晚上", note: "古乐体验" },
        { name: "随州古银杏街", period: "下午", note: "银杏和古镇" }
      ],
      spots: []
    },
    {
      id: "yiyang", name: "益阳", province: "湖南", region: "华中", climate: "hot", cost: "low",
      best: "4-6月、9-11月；桃江竹海和洞庭湖",
      foods: ["益阳擂茶", "桃江竹笋", "沅江银鱼", "安化黑茶", "南县小龙虾", "益阳米粉", "梅子", "剁椒鱼头"],
      foodNote: "安化黑茶和益阳擂茶是特色，桃江竹笋鲜嫩，南县小龙虾夏季必吃。",
      areas: [
        { name: "赫山区", note: "市区" },
        { name: "桃江", note: "竹海" },
        { name: "安化", note: "茶山和云台山" }
      ],
      stayTip: "住赫山区，桃江竹海约1小时，安化茶山需一天。",
      travel: "益阳站通石长铁路，到长沙约40分钟；益阳有高速。",
      cityTravel: "市区公交打车方便，桃江和安化靠班车或自驾。",
      experiences: [
        { name: "桃江竹海", period: "全天", note: "万亩竹林，踏青" },
        { name: "安化云台山", period: "全天", note: "茶山和日出" },
        { name: "安化黑茶博物馆", period: "上午", note: "黑茶文化" },
        { name: "益阳古城", period: "下午", note: "明清街巷" },
        { name: "会龙山", period: "上午", note: "城市山地" },
        { name: "南县洞庭湖湿地", period: "全天", note: "湖区候鸟" },
        { name: "沅江胭脂湖", period: "下午", note: "湖泊风光" },
        { name: "益阳擂茶体验", period: "下午", note: "地方茶饮" },
        { name: "桃江美人窝", period: "上午", note: "竹乡文化" },
        { name: "安化茶马古道", period: "全天", note: "古道徒步" },
        { name: "洞庭湖观鸟", period: "早上", note: "候鸟季" },
        { name: "益阳夜市", period: "晚上", note: "小龙虾和米粉" }
      ],
      spots: []
    },
    {
      id: "loudi", name: "娄底", province: "湖南", region: "华中", climate: "hot", cost: "low",
      best: "4-6月、9-11月；紫鹊界梯田和新化梅山",
      foods: ["新化三合汤", "娄底米粉", "涟源走山鸡", "双峰辣酱", "冷水江猪血丸子", "梅山擂茶", "红薯粉", "腊肉"],
      foodNote: "新化三合汤酸辣鲜，紫鹊界梯田边吃农家菜很香；双峰辣酱可带回家。",
      areas: [
        { name: "娄星区", note: "市区" },
        { name: "新化", note: "紫鹊界" },
        { name: "涟源/双峰", note: "山岳和名人" }
      ],
      stayTip: "住娄星区，紫鹊界梯田建议住新化县城或景区内。",
      travel: "娄底南站通沪昆高铁，到长沙约1小时。",
      cityTravel: "市区公交打车方便，紫鹊界需班车或自驾。",
      experiences: [
        { name: "紫鹊界梯田", period: "全天", note: "世界灌溉遗产，云海梯田" },
        { name: "新化大熊山", period: "全天", note: "森林和瀑布" },
        { name: "梅山龙宫", period: "上午", note: "溶洞和地下河" },
        { name: "曾国藩故居", period: "全天", note: "双峰富厚堂" },
        { name: "湄江风景区", period: "全天", note: "涟源峡谷" },
        { name: "紫鹊界观景台", period: "早上", note: "日出云海" },
        { name: "娄星公园", period: "傍晚", note: "城市绿地" },
        { name: "冷水江波月洞", period: "上午", note: "西游记拍摄地溶洞" },
        { name: "新化梅山古寨", period: "下午", note: "梅山文化" },
        { name: "双峰荷叶镇", period: "上午", note: "曾国藩故里田园" },
        { name: "娄底博物馆", period: "下午", note: "地方历史" },
        { name: "新化三合汤老店", period: "晚上", note: "地方名吃" }
      ],
      spots: []
    },
    {
      id: "xinyu", name: "新余", province: "江西", region: "华东", climate: "hot", cost: "low",
      best: "4-6月、9-11月；仙女湖和抱石文化",
      foods: ["新余炒粉", "仙女湖鱼", "分宜腊肉", "新余辣椒炒肉", "薯粉", "油条包麻糍", "土鸡汤", "粉蒸肉"],
      foodNote: "新余炒粉配辣椒是早餐，仙女湖的鱼鲜嫩；油条包麻糍是赣西小吃。",
      areas: [
        { name: "渝水区", note: "市区" },
        { name: "仙女湖", note: "湖区" },
        { name: "分宜", note: "古村和湿地" }
      ],
      stayTip: "住渝水区，仙女湖半日游；分宜介桥古村约1小时。",
      travel: "新余北站通沪昆高铁，到南昌约40分钟。",
      cityTravel: "市区公交打车方便，仙女湖有公交专线。",
      experiences: [
        { name: "仙女湖", period: "全天", note: "爱情圣湖，岛屿和游船" },
        { name: "傅抱石纪念馆", period: "上午", note: "国画大师故里" },
        { name: "孔目江湿地", period: "傍晚", note: "城市湿地" },
        { name: "仙女湖爱情岛", period: "下午", note: "湖心岛" },
        { name: "分宜介桥古村", period: "全天", note: "明代古村" },
        { name: "昌坊古村", period: "上午", note: "乡村田园" },
        { name: "新余博物馆", period: "下午", note: "新余历史" },
        { name: "仰天岗", period: "上午", note: "城市山地" },
        { name: "仙女湖骑行", period: "下午", note: "环湖路线" },
        { name: "新余炒粉老店", period: "晚上", note: "地方名吃" }
      ],
      spots: []
    },
    {
      id: "sanming", name: "三明", province: "福建", region: "华东", climate: "hot", cost: "low",
      best: "4-6月、9-11月；泰宁丹霞和沙县小吃",
      foods: ["沙县小吃", "泰宁擂茶", "宁化客家菜", "建宁莲子", "将乐擂茶", "明溪肉脯干", "永安笋干", "沙县扁肉"],
      foodNote: "三明是沙县小吃发源地，扁肉拌面是招牌；泰宁擂茶和宁化客家菜有地方味。",
      areas: [
        { name: "梅列区", note: "市区" },
        { name: "泰宁", note: "丹霞" },
        { name: "沙县", note: "小吃" }
      ],
      stayTip: "住市区或泰宁，泰宁大金湖和丹霞需两天；沙县小吃半天。",
      travel: "三明站通南龙铁路，到福州约1.5小时；三明机场有航线。",
      cityTravel: "市区公交打车方便，泰宁和沙县靠班车或自驾。",
      experiences: [
        { name: "泰宁大金湖", period: "全天", note: "水上丹霞，乘船" },
        { name: "泰宁古城", period: "下午", note: "明代古城和明清园" },
        { name: "沙县小吃文化城", period: "全天", note: "小吃发源地" },
        { name: "大金湖甘露寺", period: "上午", note: "悬崖古寺" },
        { name: "寨下大峡谷", period: "全天", note: "丹霞峡谷" },
        { name: "宁化客家祖地", period: "上午", note: "客家文化" },
        { name: "建宁闽江源", period: "全天", note: "闽江源头" },
        { name: "将乐玉华洞", period: "上午", note: "喀斯特溶洞" },
        { name: "尤溪侠天下", period: "全天", note: "悬崖栈道" },
        { name: "永安桃源洞", period: "下午", note: "丹霞洞天" },
        { name: "沙县小吃体验", period: "晚上", note: "扁肉拌面烧麦" },
        { name: "泰宁九龙潭", period: "下午", note: "水上竹筏" }
      ],
      spots: []
    },
    {
      id: "huaibei", name: "淮北", province: "安徽", region: "华东", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；相山和运河古镇",
      foods: ["淮北口子窖", "临涣棒棒茶", "淮北椒糊子", "濉溪豆腐", "烙馍", "辣汤", "sa汤", "符离集烧鸡(宿州)"],
      foodNote: "临涣古镇的棒棒茶配茶点慢聊是特色，口子酒城值得一看。",
      areas: [
        { name: "相山区", note: "市区" },
        { name: "濉溪", note: "临涣古镇" },
        { name: "烈山", note: "矿山公园" }
      ],
      stayTip: "住相山区，临涣古镇约1小时。",
      travel: "淮北站通青阜铁路，到徐州约1小时；高铁淮北北站。",
      cityTravel: "市区公交打车方便，临涣靠班车。",
      experiences: [
        { name: "相山公园", period: "上午", note: "淮北地标，显通寺" },
        { name: "临涣古镇", period: "全天", note: "棒棒茶和古茶馆" },
        { name: "淮北口子窖", period: "下午", note: "酒文化体验" },
        { name: "隋唐运河古镇", period: "晚上", note: "仿古街区" },
        { name: "柳孜运河遗址", period: "上午", note: "世界遗产" },
        { name: "淮北矿山公园", period: "下午", note: "煤城记忆" },
        { name: "南湖湿地", period: "傍晚", note: "城市湖泊" },
        { name: "龙脊山", period: "全天", note: "山地森林" },
        { name: "淮北博物馆", period: "上午", note: "淮北历史" },
        { name: "临涣茶馆喝茶", period: "下午", note: "慢生活体验" }
      ],
      spots: []
    },
    {
      id: "tongling", name: "铜陵", province: "安徽", region: "华东", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；天井湖和铜文化",
      foods: ["铜陵姜", "铜陵茶干", "汀洲鱼", "大通茶干", "白姜", "铜陵酱鸭", "顺安酥糖", "义安米粉"],
      foodNote: "铜陵白姜是地理标志，茶干配茶不错；天井湖畔吃鱼鲜。",
      areas: [
        { name: "铜官区", note: "市区" },
        { name: "大通古镇", note: "澜溪老街" },
        { name: "义安/枞阳", note: "山湖" }
      ],
      stayTip: "住铜官区，天井湖步行；大通古镇约40分钟。",
      travel: "铜陵北站通京福高铁，到合肥约1小时。",
      cityTravel: "市区公交打车方便，大通靠公交或自驾。",
      experiences: [
        { name: "天井湖公园", period: "上午", note: "城市湖泊，铜文化" },
        { name: "大通古镇", period: "全天", note: "澜溪老街和长江" },
        { name: "铜陵博物馆", period: "下午", note: "青铜文化" },
        { name: "铜官山铜矿遗址", period: "上午", note: "千年采铜史" },
        { name: "永泉旅游度假区", period: "全天", note: "温泉和园林" },
        { name: "枞阳浮山", period: "全天", note: "摩崖石刻" },
        { name: "西湖湿地", period: "傍晚", note: "城市湿地" },
        { name: "滨江生态公园", period: "下午", note: "长江岸边" },
        { name: "白姜体验园", period: "上午", note: "铜陵白姜" },
        { name: "铜陵大桥", period: "傍晚", note: "长江大桥夜景" }
      ],
      spots: []
    },
    {
      id: "suzhou", name: "宿州", province: "安徽", region: "华东", climate: "temperate", cost: "low",
      best: "4-6月、9-11月；皇藏峪和砀山酥梨",
      foods: ["宿州sa汤", "符离集烧鸡", "砀山酥梨", "萧县羊肉", "灵璧石(非食)", "泗县粉丝", "夹沟香稻米", "徽式锅贴"],
      foodNote: "符离集烧鸡是宿州名片，sa汤配烧饼是早餐；砀山酥梨秋季最甜。",
      areas: [
        { name: "埇桥区", note: "市区" },
        { name: "萧县", note: "皇藏峪" },
        { name: "砀山", note: "酥梨" }
      ],
      stayTip: "住埇桥区，皇藏峪约1.5小时；砀山梨季一天。",
      travel: "宿州东站通京沪高铁，到徐州约20分钟。",
      cityTravel: "市区公交打车方便，萧县和砀山靠班车。",
      experiences: [
        { name: "皇藏峪", period: "全天", note: "刘邦藏身地，古树和寺庙" },
        { name: "砀山酥梨园", period: "上午", note: "酥梨采摘" },
        { name: "宿州博物馆", period: "下午", note: "运河和汉文化" },
        { name: "灵璧奇石园", period: "全天", note: "灵璧石之乡" },
        { name: "汴河遗址", period: "上午", note: "隋唐大运河" },
        { name: "萧县天门寺", period: "下午", note: "皇藏峪古寺" },
        { name: "埇桥符离集", period: "上午", note: "烧鸡之乡" },
        { name: "砀山黄河故道", period: "全天", note: "沙地和果园" },
        { name: "泗县石龙湖", period: "下午", note: "湿地湖泊" },
        { name: "宿州sa汤老店", period: "晚上", note: "地方名吃" }
      ],
      spots: []
    }
  ],
  COORDS_ADD: {
    "邢台": [["崆山白云洞", 37.440, 114.480], ["天河山", 37.170, 114.160]],
    "衡水": [["衡水湖", 37.610, 115.610], ["武强年画博物馆", 38.040, 115.980]],
    "鹤壁": [["云梦山", 35.780, 114.180], ["浚县古城", 35.680, 114.550]],
    "濮阳": [["戚城遗址", 35.760, 115.030], ["濮阳东北庄杂技", 35.800, 115.100]],
    "漯河": [["许慎文化园", 33.600, 114.030], ["小商桥", 33.800, 113.900]],
    "济源": [["王屋山", 35.140, 112.270], ["黄河小浪底", 35.050, 112.400]],
    "鄂州": [["梁子湖", 30.050, 114.530], ["西山风景区", 30.380, 114.880]],
    "随州": [["炎帝神农故里", 31.760, 113.350], ["千年银杏谷", 31.800, 113.600]],
    "益阳": [["桃江竹海", 28.520, 112.100], ["安化云台山", 28.210, 111.210]],
    "娄底": [["紫鹊界梯田", 27.730, 111.080], ["梅山龙宫", 27.900, 111.100]],
    "新余": [["仙女湖", 27.740, 114.810], ["傅抱石纪念馆", 27.810, 114.910]],
    "三明": [["泰宁大金湖", 26.900, 117.180], ["沙县小吃文化城", 26.390, 117.790]],
    "淮北": [["相山公园", 33.970, 116.790], ["临涣古镇", 33.800, 116.600]],
    "铜陵": [["天井湖公园", 30.940, 117.800], ["大通古镇", 30.810, 117.830]],
    "宿州": [["皇藏峪", 34.180, 117.000], ["砀山酥梨园", 34.420, 116.350]]
  }
};
