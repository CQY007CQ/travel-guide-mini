// v1.14 全域收录 第10批：山西 4 城（CITIES 缺记录，锚点/CITY2PROV 已具备）
// 坐标说明：参考级 GCJ-02 惯例值，建议后续联网用腾讯地图复核；未覆盖点走城锚兜底。
module.exports = {
  CITIES_ADD: [
    {
      id: "yangquan", name: "阳泉", province: "山西", region: "华北", climate: "temperate", cost: "low",
      best: "4-6月、9-10月；娘子关和藏山，夏季凉爽",
      foods: ["阳泉刀削面", "抿曲", "炒不烂", "平定过油肉", "飘抿曲", "豆腐丝", "压饼", "糊嘟"],
      foodNote: "阳泉面食有特色，抿曲配酸菜汤是本地早餐，平定过油肉是晋菜代表。",
      areas: [
        { name: "城区", note: "市区" },
        { name: "娘子关", note: "长城关隘" },
        { name: "盂县", note: "藏山" }
      ],
      stayTip: "住城区，娘子关约1小时，藏山约1.5小时。",
      travel: "阳泉北站通石太高铁，到太原约40分钟；自驾走太旧高速。",
      cityTravel: "市区公交打车方便，娘子关和藏山靠班车或自驾。",
      experiences: [
        { name: "娘子关", period: "全天", note: "天下第九关，水上长城" },
        { name: "藏山", period: "全天", note: "赵氏孤儿藏身地，古祠山水" },
        { name: "狮脑山", period: "上午", note: "百团大战纪念碑" },
        { name: "固关长城", period: "下午", note: "明代长城关隘" },
        { name: "小河古村", period: "上午", note: "石家大院古村落" },
        { name: "娘子关瀑布", period: "上午", note: "关前瀑布" },
        { name: "翠枫山", period: "全天", note: "森林秋色" },
        { name: "冠山", period: "下午", note: "古书院和山景" },
        { name: "平定娘子关古街", period: "下午", note: "老街和醋坊" },
        { name: "阳泉博物馆", period: "上午", note: "煤城历史" }
      ],
      spots: []
    },
    {
      id: "shuozhou", name: "朔州", province: "山西", region: "华北", climate: "cold", cost: "low",
      best: "5-9月；应县木塔和雁门关，夏季凉爽",
      foods: ["朔州莜面", "右玉羊肉", "应县凉粉", "烫面饺子", "酸菜烩菜", "羊杂割", "抿豆面", "黄糕"],
      foodNote: "朔州是雁门关所在，莜面和羊肉是主打；应县凉粉配辣椒油是地方小食。",
      areas: [
        { name: "朔城区", note: "市区" },
        { name: "应县", note: "木塔" },
        { name: "右玉", note: "杀虎口" }
      ],
      stayTip: "住朔城区，应县木塔约1小时，雁门关在代县方向可一日游。",
      travel: "朔州站通大西高铁，到太原约1.5小时；自驾走二广高速。",
      cityTravel: "市区打车方便，木塔和雁门关靠班车或自驾。",
      experiences: [
        { name: "应县木塔", period: "上午", note: "世界最高木塔，千年古建" },
        { name: "雁门关", period: "全天", note: "中华第一关，长城雄关" },
        { name: "杀虎口", period: "全天", note: "走西口古关口" },
        { name: "右玉长城", period: "下午", note: "明长城和古堡" },
        { name: "广武明长城", period: "上午", note: "保存较好的古长城" },
        { name: "崇福寺", period: "下午", note: "金代寺院，朔州地标" },
        { name: "怀仁金沙滩", period: "全天", note: "杨家将古战场" },
        { name: "朔州老城", period: "傍晚", note: "古城街巷" },
        { name: "右玉县生态区", period: "上午", note: "塞上绿洲" },
        { name: "神海湿地", period: "下午", note: "朔州湿地" },
        { name: "北岳恒山（南线）", period: "全天", note: "可串联恒山悬空寺" },
        { name: "朔州莜面宴", period: "晚上", note: "地方面食" }
      ],
      spots: []
    },
    {
      id: "xinzhou", name: "忻州", province: "山西", region: "华北", climate: "temperate", cost: "low",
      best: "5-10月；五台山和雁门关，夏季避暑",
      foods: ["忻州瓦酥", "定襄蒸肉", "五台山台蘑", "保德油糕", "河曲酸粥", "原平锅盔", "忻州豆腐脑", "莜面栲栳栳"],
      foodNote: "五台山台蘑炖土鸡是山区名菜，定襄蒸肉和保德油糕可当伴手礼。",
      areas: [
        { name: "忻府区", note: "市区" },
        { name: "五台山", note: "佛教圣地" },
        { name: "河曲/偏关", note: "黄河" }
      ],
      stayTip: "住五台山台怀镇看寺院晨景，忻州市区去五台山约2小时。",
      travel: "忻州西站通大西高铁，到太原约40分钟；五台山有旅游专线。",
      cityTravel: "市区公交打车方便，五台山景区内靠区间车。",
      experiences: [
        { name: "五台山", period: "全天", note: "文殊道场，五座台顶和台怀镇" },
        { name: "五爷庙", period: "早上", note: "五台山香火最旺的寺院" },
        { name: "黛螺顶", period: "上午", note: "小朝台，1080级台阶" },
        { name: "显通寺", period: "下午", note: "五台山最大寺院" },
        { name: "雁门关", period: "全天", note: "天下九塞雁门为首" },
        { name: "忻州古城", period: "晚上", note: "复建古城，夜市" },
        { name: "芦芽山", period: "全天", note: "万年冰洞和草原" },
        { name: "万年冰洞", period: "上午", note: "四季结冰的冰洞" },
        { name: "老牛湾", period: "全天", note: "黄河第一湾，长城与黄河相会" },
        { name: "偏关古长城", period: "下午", note: "黄河边古长城" },
        { name: "河曲娘娘滩", period: "上午", note: "黄河中岛" },
        { name: "代县边靖楼", period: "下午", note: "雁门关下古楼" }
      ],
      spots: []
    },
    {
      id: "lvliang", name: "吕梁", province: "山西", region: "华北", climate: "temperate", cost: "low",
      best: "5-10月；碛口古镇和北武当山",
      foods: ["吕梁碗托", "孝义火烧", "岚县土豆", "汾阳核桃", "碛口枣", "柳林碗托", "孝义豆腐脑", "莜面"],
      foodNote: "碛口古镇的黄河鲤鱼和碗托是特色，汾阳核桃和碛口枣可带回家。",
      areas: [
        { name: "离石区", note: "市区" },
        { name: "碛口", note: "黄河古镇" },
        { name: "交城/孝义", note: "山岳和古城" }
      ],
      stayTip: "住离石区，碛口古镇建议住一晚看黄河日落；北武当山一天。",
      travel: "吕梁站通中南铁路；自驾走青银高速，太原出发约2小时到离石。",
      cityTravel: "市区打车便宜，古镇和山岳靠班车或自驾。",
      experiences: [
        { name: "碛口古镇", period: "全天", note: "黄河边的古镇，商号和老街" },
        { name: "北武当山", period: "全天", note: "道教名山，石阶和云海" },
        { name: "李家山", period: "上午", note: "碛口附近的窑洞村" },
        { name: "黄河画廊", period: "下午", note: "黄河岩画和峡谷" },
        { name: "卦山", period: "全天", note: "交城古寺和松林" },
        { name: "玄中寺", period: "上午", note: "净土宗祖庭" },
        { name: "庞泉沟", period: "全天", note: "原始森林和瀑布" },
        { name: "孝义古城", period: "下午", note: "三皇庙和古城" },
        { name: "贾家庄", period: "上午", note: "乡村旅游典范" },
        { name: "碛口黄河日落", period: "傍晚", note: "黄河落日" },
        { name: "柳林黄河三峡", period: "全天", note: "黄河峡谷" },
        { name: "吕梁博物馆", period: "下午", note: "黄土高原历史" }
      ],
      spots: []
    }
  ],
  COORDS_ADD: {
    "阳泉": [["娘子关", 37.970, 114.030], ["藏山", 38.230, 113.520]],
    "朔州": [["应县木塔", 39.560, 113.190], ["雁门关", 39.070, 112.770]],
    "忻州": [["五台山", 38.980, 113.590], ["万年冰洞", 38.940, 112.000], ["老牛湾", 39.670, 111.120]],
    "吕梁": [["碛口古镇", 37.700, 110.810], ["北武当山", 37.560, 111.100]]
  }
};
