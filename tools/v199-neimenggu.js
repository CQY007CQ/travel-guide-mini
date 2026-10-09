// v1.14 全域收录 第9批：内蒙古 6 城盟（CITIES 缺记录）
// 锡林郭勒盟/阿拉善盟原缺锚点，一并补 CITY_COORDS_ADD（GCJ-02 参考级）。
module.exports = {
  CITIES_ADD: [
    {
      id: "wuhai", name: "乌海", province: "内蒙古", region: "华北", climate: "dry", cost: "low",
      best: "5-9月；黄河和沙漠，夏季凉",
      foods: ["乌海葡萄", "手扒肉", "奶茶", "酸奶", "烤全羊", "羊杂碎", "酸菜", "莜面"],
      foodNote: "乌海是黄河明珠，葡萄和葡萄酒有名；手扒肉配奶茶是蒙式日常。",
      areas: [
        { name: "海勃湾区", note: "市区" },
        { name: "乌达", note: "沙漠和黄河" },
        { name: "海南区", note: "葡萄园" }
      ],
      stayTip: "住海勃湾区，去金沙湾约30分钟。",
      travel: "乌海机场通国内航线；乌海站通包兰铁路，到银川约1小时。",
      cityTravel: "市区打车便宜，黄河和沙漠景点靠班车或自驾。",
      experiences: [
        { name: "乌海湖", period: "全天", note: "黄河海勃湾水利枢纽形成的湖" },
        { name: "金沙湾", period: "全天", note: "沙漠和滑沙" },
        { name: "甘德尔山", period: "下午", note: "城市山地，成吉思汗像" },
        { name: "黄河湿地方", period: "傍晚", note: "湿地观鸟" },
        { name: "乌海葡萄园", period: "上午", note: "葡萄采摘和酒庄" },
        { name: "桌子山岩画", period: "全天", note: "远古岩画" },
        { name: "龙游湾湿地", period: "下午", note: "候鸟栖息地" },
        { name: "乌海沙漠体验", period: "上午", note: "沙丘骑行" },
        { name: "满巴拉僧庙", period: "上午", note: "藏传佛教寺院" },
        { name: "乌海湖畔骑行", period: "下午", note: "环湖风景" }
      ],
      spots: []
    },
    {
      id: "bayanur", name: "巴彦淖尔", province: "内蒙古", region: "华北", climate: "dry", cost: "low",
      best: "6-9月；黄河和乌梁素海，葵花田夏季",
      foods: ["河套酿皮", "巴盟炖羊肉", "葵花籽", "莜面", "奶茶", "酸粥", "羊杂碎", "烤全羊"],
      foodNote: "巴彦淖尔是河套粮仓，酿皮和羊肉实在，葵花籽是手信首选。",
      areas: [
        { name: "临河区", note: "市区" },
        { name: "磴口", note: "黄河和三盛公" },
        { name: "乌拉特", note: "草原" }
      ],
      stayTip: "住临河区，去乌梁素海约1.5小时；磴口黄河水利枢纽半天。",
      travel: "巴彦淖尔机场通国内航线；包兰铁路和京藏高速经过。",
      cityTravel: "市区打车便宜，湖泊草原靠班车或自驾。",
      experiences: [
        { name: "乌梁素海", period: "全天", note: "黄河流域最大淡水湖，候鸟" },
        { name: "三盛公水利枢纽", period: "上午", note: "黄河水利工程" },
        { name: "河套向日葵田", period: "下午", note: "夏季向日葵海" },
        { name: "乌拉特草原", period: "全天", note: "蒙式草原风情" },
        { name: "临河黄河湿地", period: "傍晚", note: "湿地观鸟" },
        { name: "五原农耕文化园", period: "上午", note: "河套农耕" },
        { name: "磴口沙漠", period: "全天", note: "黄河边沙漠" },
        { name: "巴彦淖尔博物馆", period: "下午", note: "河套文化" },
        { name: "阴山岩画", period: "全天", note: "远古岩刻" },
        { name: "临河早市", period: "早上", note: "烟火气集市" },
        { name: "乌拉特后旗戈壁", period: "全天", note: "戈壁和牧区" },
        { name: "河套酿皮店", period: "晚上", note: "地方名吃" }
      ],
      spots: []
    },
    {
      id: "ulanqab", name: "乌兰察布", province: "内蒙古", region: "华北", climate: "cold", cost: "low",
      best: "6-9月；辉腾锡勒和火山草原，夏季避暑",
      foods: ["乌兰察布莜面", "手扒羊肉", "奶茶", "酸奶", "烤全羊", "羊杂碎", "土豆", "莜面窝窝"],
      foodNote: "乌兰察布是“中国薯都”，莜面和土豆宴是主打，草原上吃手扒肉最爽。",
      areas: [
        { name: "集宁区", note: "市区" },
        { name: "辉腾锡勒", note: "高山草原" },
        { name: "乌兰哈达", note: "火山草原" }
      ],
      stayTip: "住集宁区，辉腾锡勒草原可住蒙古包；火山草原半天。",
      travel: "乌兰察布站通京呼高铁，到北京约1.5小时；草原有高速。",
      cityTravel: "市区打车方便，草原和火山靠自驾或包车。",
      experiences: [
        { name: "辉腾锡勒草原", period: "全天", note: "高山草甸和风力发电机" },
        { name: "乌兰哈达火山地质公园", period: "全天", note: "火山草原，网红拍照" },
        { name: "黄花沟", period: "全天", note: "辉腾锡勒的峡谷和花海" },
        { name: "察哈尔右翼草原", period: "下午", note: "草原和敖包" },
        { name: "集宁皮草城", period: "上午", note: "皮草市场" },
        { name: "岱海", period: "全天", note: "凉城湖泊" },
        { name: "集宁战役纪念馆", period: "下午", note: "红色历史" },
        { name: "格根塔拉草原", period: "全天", note: "大型草原旅游区" },
        { name: "乌兰察布土豆宴", period: "晚上", note: "薯都名吃" },
        { name: "察右中旗草原", period: "上午", note: "草场" },
        { name: "泉玉岭水库", period: "下午", note: "水库湿地" },
        { name: "草原星空", period: "晚上", note: "夏夜看星" }
      ],
      spots: []
    },
    {
      id: "xingan", name: "兴安盟", province: "内蒙古", region: "华北", climate: "cold", cost: "low",
      best: "6-9月；阿尔山和科尔沁草原",
      foods: ["兴安盟手扒肉", "奶茶", "酸奶", "烤全羊", "莜面", "羊杂碎", "酸菜", "蘑菇"],
      foodNote: "兴安盟以阿尔山森林闻名，林区蘑菇和野味是主打；奶茶手扒肉是草原标配。",
      areas: [
        { name: "乌兰浩特", note: "盟府" },
        { name: "阿尔山", note: "森林和温泉" },
        { name: "科右中旗", note: "草原" }
      ],
      stayTip: "住乌兰浩特或阿尔山，阿尔山泡温泉住镇上；秋季阿尔山很美。",
      travel: "乌兰浩特机场通国内航线；阿尔山机场有季节性航班；乌兰浩特通白阿铁路。",
      cityTravel: "城市间距远，自驾或包车为主。",
      experiences: [
        { name: "阿尔山国家森林公园", period: "全天", note: "天池和石塘林，森林温泉" },
        { name: "阿尔山天池", period: "上午", note: "火山口湖" },
        { name: "科尔沁草原", period: "全天", note: "草原和敖包" },
        { name: "乌兰浩特成吉思汗庙", period: "上午", note: "蒙古文化" },
        { name: "五一会址", period: "下午", note: "内蒙古自治区成立地" },
        { name: "阿尔山温泉", period: "晚上", note: "温泉泡汤" },
        { name: "玫瑰峰", period: "上午", note: "阿尔山石林" },
        { name: "三潭峡", period: "下午", note: "峡谷溪流" },
        { name: "好森沟", period: "全天", note: "森林景区" },
        { name: "突泉蒙元文化园", period: "下午", note: "蒙元历史" },
        { name: "阿尔山秋季彩林", period: "全天", note: "9月-10月很美" },
        { name: "草原牧家乐", period: "晚上", note: "蒙古包体验" }
      ],
      spots: []
    },
    {
      id: "xilingol", name: "锡林郭勒盟", province: "内蒙古", region: "华北", climate: "cold", cost: "low",
      best: "6-9月；锡林郭勒草原和那达慕",
      foods: ["锡盟手扒肉", "奶茶", "酸奶", "烤全羊", "莜面", "奶豆腐", "羊杂碎", "血肠"],
      foodNote: "锡林郭勒是天然草原，手扒肉和奶食最地道，那达慕大会8月很热闹。",
      areas: [
        { name: "锡林浩特", note: "盟府" },
        { name: "西乌珠穆沁", note: "草原" },
        { name: "正蓝旗", note: "元上都" }
      ],
      stayTip: "住锡林浩特，元上都遗址住正蓝旗；草原腹地住蒙古包。",
      travel: "锡林浩特机场通国内航线；自驾走G207/京锡高速。",
      cityTravel: "地广人稀，草原景点全程自驾或包车。",
      experiences: [
        { name: "锡林郭勒草原", period: "全天", note: "中国很美的草原之一" },
        { name: "元上都遗址", period: "全天", note: "世界遗产，元代都城" },
        { name: "贝子庙", period: "上午", note: "锡林浩特古寺" },
        { name: "乌珠穆沁草原", period: "全天", note: "水草丰美的牧场" },
        { name: "那达慕大会", period: "全天", note: "8月赛马摔跤射箭" },
        { name: "平顶山", period: "下午", note: "火山熔岩平台" },
        { name: "滦河源", period: "全天", note: "河源湿地" },
        { name: "太仆寺旗草原", period: "下午", note: "草场风光" },
        { name: "锡林九曲", period: "上午", note: "锡林河弯道" },
        { name: "浑善达克沙地", period: "全天", note: "沙地疏林" },
        { name: "苏尼特草原", period: "下午", note: "戈壁草原" },
        { name: "草原星空", period: "晚上", note: "纯净星空" }
      ],
      spots: []
    },
    {
      id: "alxa", name: "阿拉善盟", province: "内蒙古", region: "华北", climate: "dry", cost: "mid",
      best: "5-10月；胡杨林秋季、沙漠和航天城",
      foods: ["阿拉善羊肉", "奶茶", "酸奶", "烤全羊", "莜面", "锁阳饼", "沙葱", "羊杂碎"],
      foodNote: "阿拉善是胡杨和骆驼之乡，秋季额济纳胡杨林很美，羊肉和奶茶管够。",
      areas: [
        { name: "巴彦浩特", note: "盟府" },
        { name: "额济纳", note: "胡杨林" },
        { name: "腾格里沙漠", note: "沙漠湖泊" }
      ],
      stayTip: "胡杨林季住额济纳旗（房源紧张早订）；沙漠露营体验一晚。",
      travel: "阿拉善左旗机场通航线；额济纳有铁路/公路，胡杨季一票难求。",
      cityTravel: "沙漠和胡杨需包车或跟团，城镇间距离远。",
      experiences: [
        { name: "额济纳胡杨林", period: "全天", note: "世界级胡杨林，秋季金黄" },
        { name: "黑城遗址", period: "上午", note: "西夏古城废墟" },
        { name: "怪树林", period: "下午", note: "枯胡杨，日落剪影" },
        { name: "居延海", period: "早上", note: "日出和芦苇" },
        { name: "腾格里沙漠月亮湖", period: "全天", note: "沙漠湖泊，绿洲" },
        { name: "巴丹吉林沙漠", period: "全天", note: "世界最高沙丘，越野" },
        { name: "阿拉善SEE生态馆", period: "上午", note: "环保公益" },
        { name: "贺兰山南寺", period: "全天", note: "藏传佛教寺院" },
        { name: "东风航天城（额济纳）", period: "全天", note: "卫星发射场（需预约）" },
        { name: "沙海徒步", period: "下午", note: "沙漠体验" },
        { name: "阿拉善奇石市场", period: "上午", note: "戈壁奇石" },
        { name: "居延文化博物馆", period: "下午", note: "汉简文化" }
      ],
      spots: []
    }
  ],
  CITY_COORDS_ADD: {
    "锡林郭勒盟": [43.950, 116.080],
    "阿拉善盟": [38.840, 105.730]
  },
  COORDS_ADD: {
    "乌海": [["乌海湖", 39.670, 106.800], ["金沙湾", 39.700, 106.760]],
    "巴彦淖尔": [["乌梁素海", 40.940, 108.630], ["三盛公水利枢纽", 40.310, 107.030]],
    "乌兰察布": [["辉腾锡勒草原", 41.110, 112.540], ["乌兰哈达火山地质公园", 41.600, 113.120]],
    "兴安盟": [["阿尔山国家森林公园", 47.330, 120.500], ["科尔沁草原", 45.060, 121.900]],
    "锡林郭勒盟": [["元上都遗址", 42.330, 116.260], ["锡林郭勒草原", 43.950, 116.080]],
    "阿拉善盟": [["额济纳胡杨林", 41.950, 101.070], ["居延海", 42.310, 101.060]]
  }
};
