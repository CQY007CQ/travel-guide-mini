// v1.14 全域收录 第8批-东北B：辽宁 5 城（CITIES 缺记录，锚点/CITY2PROV 已具备）
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "fushun", name: "抚顺", province: "辽宁", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；赫图阿拉城和红河谷，冬季冰雪",
      foods: ["抚顺麻辣拌", "酸菜白肉", "锅包肉", "杀猪菜", "烤冷面", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "抚顺麻辣拌是独一份的东北小吃，酸辣开胃；新宾满族农家菜量大实在。",
      areas: [
        { name: "顺城区", note: "市区" },
        { name: "新宾", note: "赫图阿拉城" },
        { name: "清原", note: "红河谷" }
      ],
      stayTip: "住顺城区，去赫图阿拉约1.5小时；红河谷漂流季住清原。",
      travel: "抚顺北站通沈抚城际，到沈阳约30分钟。",
      cityTravel: "市区公交打车方便，新宾和清原靠班车或自驾。",
      experiences: [
        { name: "赫图阿拉城", period: "全天", note: "清太祖努尔哈赤故都，满族文化" },
        { name: "红河谷", period: "全天", note: "漂流和森林" },
        { name: "抚顺战犯管理所", period: "上午", note: "改造战犯历史旧址" },
        { name: "高尔山", period: "下午", note: "辽代古塔" },
        { name: "三块石国家森林公园", period: "全天", note: "抗联遗址和森林" },
        { name: "萨尔浒风景区", period: "全天", note: "水库和山林" },
        { name: "新宾永陵", period: "上午", note: "清代祖陵" },
        { name: "皇家极地海洋世界", period: "下午", note: "海洋馆" },
        { name: "抚顺煤精琥珀博物馆", period: "上午", note: "抚顺特产" },
        { name: "满族风情园", period: "下午", note: "满族民俗" },
        { name: "玉龙溪", period: "全天", note: "清原溪谷" },
        { name: "抚顺麻辣拌", period: "晚上", note: "城市名片" }
      ],
      spots: []
    },
    {
      id: "benxi", name: "本溪", province: "辽宁", region: "东北", climate: "cold", cost: "low",
      best: "6-9月、9-10月秋色；本溪水洞和关门山",
      foods: ["本溪小市羊汤", "烤冷面", "酸菜白肉", "锅包肉", "杀猪菜", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "本溪水洞是东北名片，羊汤配烤饼暖胃；秋季关门山枫叶和羊汤是标配。",
      areas: [
        { name: "平山区", note: "市区" },
        { name: "本溪县", note: "水洞和关门山" },
        { name: "桓仁", note: "五女山和枫林" }
      ],
      stayTip: "住市区或本溪县城，关门山秋色季住景区附近；桓仁需一天。",
      travel: "本溪站通沈丹高铁，到沈阳约40分钟；丹东方向高速。",
      cityTravel: "市区打车便宜，水洞和关门山有旅游专线。",
      experiences: [
        { name: "本溪水洞", period: "上午", note: "世界最长地下暗河溶洞，乘船" },
        { name: "关门山", period: "全天", note: "东北小黄山，秋季枫叶" },
        { name: "五女山", period: "全天", note: "高句丽山城，世界遗产" },
        { name: "本溪水洞地质公园", period: "下午", note: "地质科普" },
        { name: "望天洞", period: "上午", note: "溶洞群" },
        { name: "大石湖", period: "全天", note: "瀑布和枫叶" },
        { name: "桓仁枫林谷", period: "全天", note: "秋色森林" },
        { name: "本溪湖", period: "下午", note: "辽宁最小湖" },
        { name: "平顶山", period: "上午", note: "市区山地" },
        { name: "小市一庄", period: "下午", note: "羊汤和小吃" },
        { name: "桓仁冰酒基地", period: "上午", note: "冰酒庄园" },
        { name: "本溪水洞漂流", period: "下午", note: "夏季戏水" }
      ],
      spots: []
    },
    {
      id: "fuxin", name: "阜新", province: "辽宁", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；海棠山和瑞应寺，冬季冰雪",
      foods: ["阜新蒙古馅饼", "酸菜白肉", "锅包肉", "杀猪菜", "烤全羊", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "阜新蒙古馅饼皮薄馅大是名片，烤全羊和奶茶有蒙古味。",
      areas: [
        { name: "海州区", note: "市区" },
        { name: "阜蒙县", note: "海棠山和瑞应寺" },
        { name: "彰武", note: "沙地草原" }
      ],
      stayTip: "住海州区，海棠山约1小时；彰武草原可半日游。",
      travel: "阜新站通京哈高铁，到沈阳约1小时。",
      cityTravel: "市区打车便宜，景区靠班车或自驾。",
      experiences: [
        { name: "海棠山", period: "全天", note: "摩崖造像和秋色" },
        { name: "瑞应寺", period: "上午", note: "藏传佛教寺院" },
        { name: "阜新玛瑙城", period: "下午", note: "玛瑙之乡，市场" },
        { name: "彰武大清沟", period: "全天", note: "沙地湖泊" },
        { name: "海州露天矿", period: "上午", note: "露天矿坑" },
        { name: "阜蒙县蒙古族村", period: "下午", note: "蒙古风情" },
        { name: "章古台沙地", period: "上午", note: "治沙林海" },
        { name: "阜新万人坑", period: "下午", note: "历史纪念" },
        { name: "蒙古馅饼老店", period: "晚上", note: "地方名吃" },
        { name: "瑞应寺庙会", period: "上午", note: "节庆" }
      ],
      spots: []
    },
    {
      id: "liaoyang", name: "辽阳", province: "辽宁", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；太子河和古塔，历史文化名城",
      foods: ["辽阳小市羊汤", "酸菜白肉", "锅包肉", "杀猪菜", "烤冷面", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "辽阳是东北最古老城市之一，羊汤和酸菜白肉是冬日暖胃首选。",
      areas: [
        { name: "白塔区", note: "市区" },
        { name: "弓长岭", note: "温泉" },
        { name: "汤河", note: "水库" }
      ],
      stayTip: "住白塔区，弓长岭温泉约40分钟。",
      travel: "辽阳站通哈大高铁，到沈阳约30分钟。",
      cityTravel: "市区公交打车方便。",
      experiences: [
        { name: "辽阳白塔", period: "上午", note: "东北第一塔" },
        { name: "太子河", period: "傍晚", note: "穿城河风光" },
        { name: "辽阳博物馆", period: "下午", note: "古城历史" },
        { name: "弓长岭温泉", period: "晚上", note: "温泉泡汤" },
        { name: "汤河水库", period: "全天", note: "水库度假" },
        { name: "辽阳汉魏壁画墓", period: "上午", note: "古代壁画" },
        { name: "冷热地公园", period: "下午", note: "地质奇观" },
        { name: "首山", period: "上午", note: "城郊山" },
        { name: "曹雪芹纪念馆", period: "下午", note: "红楼故里" },
        { name: "辽阳大集", period: "上午", note: "地方集市" }
      ],
      spots: []
    },
    {
      id: "tieling", name: "铁岭", province: "辽宁", region: "东北", climate: "cold", cost: "low",
      best: "6-9月；莲花湖和象牙山，喜剧之乡",
      foods: ["铁岭火勺", "酸菜白肉", "锅包肉", "杀猪菜", "烤冷面", "粘豆包", "大碴粥", "冻梨"],
      foodNote: "铁岭是喜剧之乡，火勺配羊汤是早餐标配；象牙山村因为《乡村爱情》出名。",
      areas: [
        { name: "银州区", note: "市区" },
        { name: "开原", note: "象牙山" },
        { name: "清河", note: "水库" }
      ],
      stayTip: "住银州区，象牙山约1小时；清河水库半日游。",
      travel: "铁岭站通京哈高铁，到沈阳约30分钟。",
      cityTravel: "市区公交打车方便，开原靠班车。",
      experiences: [
        { name: "莲花湖湿地", period: "全天", note: "城市湿地，荷花" },
        { name: "象牙山", period: "全天", note: "《乡村爱情》取景地" },
        { name: "铁岭龙首山", period: "上午", note: "城市山景" },
        { name: "清河水库", period: "下午", note: "水库风光" },
        { name: "银冈书院", period: "上午", note: "清代书院" },
        { name: "铁岭大剧院", period: "晚上", note: "看二人转" },
        { name: "凡河新区", period: "下午", note: "新区景观" },
        { name: "开原古城", period: "上午", note: "明代古城" },
        { name: "铁岭火勺老店", period: "晚上", note: "地方名吃" },
        { name: "清河滑雪场", period: "全天", note: "冬季滑雪" }
      ],
      spots: []
    }
  ],
  COORDS_ADD: {
    "抚顺": [["赫图阿拉城", 41.680, 124.970], ["红河谷", 42.050, 124.900]],
    "本溪": [["本溪水洞", 41.290, 123.890], ["关门山", 41.280, 124.050]],
    "阜新": [["海棠山", 42.050, 121.800], ["瑞应寺", 42.100, 121.900]],
    "辽阳": [["辽阳白塔", 41.280, 123.180], ["弓长岭温泉", 41.180, 123.360]],
    "铁岭": [["莲花湖湿地", 42.250, 123.830], ["象牙山", 42.480, 124.020]]
  }
};
