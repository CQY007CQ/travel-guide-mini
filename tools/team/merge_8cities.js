const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "team-region-西北.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const COLLECTED = "2026-11 公开来源(携程/同程/美团/有来医生/政府官网)";

// ===== 新增 8 城数据（仅写有数据的 section）=====
const newData = {
  "阿克苏": {
    food: [
      { "shop": "阿不都热合曼烤肉王", "rep": "本地人常去", "menu": [ { "n": "馕坑肉", "p": "参考¥138/公斤" }, { "n": "土火锅", "p": "参考¥68" }, { "n": "烤羊排", "p": "参考¥88" } ] },
      { "shop": "3号仓库", "rep": "宴请名店", "menu": [ { "n": "烤羊排", "p": "参考¥88" }, { "n": "椒麻鸡", "p": "参考¥58" }, { "n": "土火锅", "p": "参考¥98" } ] },
      { "shop": "天山柒号烤包子店", "rep": "本地人常去", "menu": [ { "n": "烤包子", "p": "参考¥5" }, { "n": "抓饭", "p": "参考¥35" }, { "n": "大盘鸡", "p": "参考¥68" } ] },
      { "shop": "粒粒香抓饭店", "rep": "市井烟火", "menu": [ { "n": "羊腿抓饭", "p": "参考¥38" }, { "n": "碎肉抓饭", "p": "参考¥32" } ] }
    ],
    hotels: [
      { "name": "市中心/老街夜市片区", "price": "参考¥150-300/晚" },
      { "name": "火车站片区", "price": "参考¥120-200/晚" },
      { "name": "杭州路机场片区", "price": "参考¥240-300/晚" }
    ],
    hotelList: [
      { "name": "明华大酒店(阿克苏金兰广场天百时尚购物中心店)", "addr": "新疆阿克苏市迎宾路25号", "price": "参考¥274/晚", "rooms": [ { "type": "豪华大床房", "price": "参考¥274" }, { "type": "高级标间", "price": "参考¥260" } ], "note": "", "collected": COLLECTED },
      { "name": "澜泰酒店(阿克苏太百购物中心店)", "addr": "新疆阿克苏市新华西路2号", "price": "参考¥159/晚", "rooms": [ { "type": "商务大床房", "price": "参考¥159" }, { "type": "豪华套房", "price": "参考¥259" } ], "note": "", "collected": COLLECTED },
      { "name": "维也纳国际酒店(阿克苏老街火车站店)", "addr": "新疆阿克苏市交通西路良种场小区北侧约180米", "price": "参考¥192/晚", "rooms": [ { "type": "标准大床房", "price": "参考¥192" }, { "type": "豪华大床房", "price": "参考¥228" } ], "note": "", "collected": COLLECTED },
      { "name": "阿克苏机场万达美华酒店", "addr": "新疆阿克苏市杭州路1号", "price": "参考¥246/晚", "rooms": [ { "type": "豪华大床房", "price": "参考¥246" }, { "type": "行政套房", "price": "参考¥360" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "新疆生产建设兵团第一师医院", "lv": "三甲" }
    ]
  },
  "克拉玛依": {
    food: [
      { "shop": "小李子大盘鸡", "rep": "本地人常去", "menu": [ { "n": "大盘鸡", "p": "参考¥68" }, { "n": "椒麻鸡", "p": "参考¥58" } ] },
      { "shop": "白碱滩凉粉大盘鸡", "rep": "老字号", "menu": [ { "n": "凉粉大盘鸡", "p": "参考¥55" }, { "n": "皮带面", "p": "参考¥10" } ] },
      { "shop": "天天想抓饭", "rep": "本地人常去", "menu": [ { "n": "羊腿抓饭", "p": "参考¥35" }, { "n": "碎肉抓饭", "p": "参考¥28" } ] },
      { "shop": "老沙湾大盘鸡(友谊路店)", "rep": "老字号", "menu": [ { "n": "大盘鸡", "p": "参考¥60" }, { "n": "虎皮鸡蛋", "p": "参考¥8" } ] }
    ],
    hotels: [
      { "name": "克拉玛依区中心/世纪大道片区", "price": "参考¥180-310/晚" },
      { "name": "白碱滩区片区", "price": "参考¥120-200/晚" },
      { "name": "独山子区片区", "price": "参考¥160-220/晚" }
    ],
    hotelList: [
      { "name": "克拉玛依泰富广场南环路亚朵酒店", "addr": "新疆克拉玛依市克拉玛依区南环路250号泰富广场", "price": "参考¥310/晚", "rooms": [ { "type": "高级大床房", "price": "参考¥310" }, { "type": "行政大床房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED },
      { "name": "维也纳国际酒店(独山子独库公路零公里美食街店)", "addr": "新疆克拉玛依市独山子区北京路5-05-101", "price": "参考¥217/晚", "rooms": [ { "type": "豪华大床房", "price": "参考¥217" }, { "type": "豪华家庭房", "price": "参考¥320" } ], "note": "", "collected": COLLECTED },
      { "name": "和颐至格酒店(克拉玛依市政府店)", "addr": "新疆克拉玛依市克拉玛依区兴业路51号", "price": "参考¥186/晚", "rooms": [ { "type": "和颐商务房", "price": "参考¥186" }, { "type": "家庭房", "price": "参考¥260" } ], "note": "", "collected": COLLECTED },
      { "name": "克拉玛依世纪大道锦江都城酒店", "addr": "新疆克拉玛依市克拉玛依区世纪大道262号", "price": "参考¥298/晚", "rooms": [ { "type": "标准大床房", "price": "参考¥298" }, { "type": "豪华家庭房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "新疆医科大学附属克拉玛依医院", "lv": "三甲" }
    ]
  },
  "哈密": {
    food: [
      { "shop": "马氏羊肉焖饼", "rep": "老字号", "menu": [ { "n": "羊肉焖饼", "p": "参考¥158(2-3人)" }, { "n": "沙葱垫底", "p": "参考¥18" } ] },
      { "shop": "千柳湖羊肉焖饼", "rep": "宴请名店", "menu": [ { "n": "羊肉焖饼", "p": "参考¥158" }, { "n": "大盘土鸡", "p": "参考¥88" } ] },
      { "shop": "盛添抓饭肉汤馆", "rep": "本地人常去", "menu": [ { "n": "碎肉手抓饭", "p": "参考¥21" }, { "n": "羊排手抓饭", "p": "参考¥35" } ] },
      { "shop": "吃了再吃烤包子店", "rep": "市井烟火", "menu": [ { "n": "烤包子", "p": "参考¥3" }, { "n": "羊肉串", "p": "参考¥5" } ] }
    ],
    hotels: [
      { "name": "伊州区中心/天马商场片区", "price": "参考¥150-300/晚" },
      { "name": "哈密站/火车站片区", "price": "参考¥120-200/晚" },
      { "name": "人民路/高铁片区", "price": "参考¥250-350/晚" }
    ],
    hotelList: [
      { "name": "哈密希尔顿欢朋酒店", "addr": "新疆哈密市伊州区人民路1号", "price": "参考¥310/晚", "rooms": [ { "type": "舒适大床房", "price": "参考¥310" }, { "type": "豪华大床房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED },
      { "name": "锦江都城酒店(哈密火车站乘客集散中心文创园店)", "addr": "新疆哈密市伊州区伊州大道134号瑞驰大厦", "price": "参考¥192/晚", "rooms": [ { "type": "标准大床房", "price": "参考¥192" }, { "type": "高级大床房", "price": "参考¥260" } ], "note": "", "collected": COLLECTED },
      { "name": "哈密豫商大酒店(天马商场哈密站店)", "addr": "新疆哈密市伊州区天山北路豫商大厦", "price": "参考¥177/晚", "rooms": [ { "type": "舒适双床房", "price": "参考¥177" }, { "type": "商务套房", "price": "参考¥320" } ], "note": "", "collected": COLLECTED },
      { "name": "维也纳国际酒店(哈密高铁站店)", "addr": "新疆哈密市伊州区红星西路7号院市政大厦", "price": "参考¥228/晚", "rooms": [ { "type": "豪华大床房", "price": "参考¥228" }, { "type": "城景大床房", "price": "参考¥300" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "新疆生产建设兵团第十三师红星医院", "lv": "三甲" }
    ]
  },
  "安康": {
    food: [
      { "shop": "黄家蒸面(鼓楼西街店)", "rep": "老字号", "menu": [ { "n": "蒸面小份", "p": "参考¥5" }, { "n": "蒸面中份", "p": "参考¥6" }, { "n": "蒸面大份", "p": "参考¥7" } ] },
      { "shop": "朿家蒸面(鼓楼街店)", "rep": "老字号", "menu": [ { "n": "蒸面", "p": "参考¥8" }, { "n": "卤蛋", "p": "参考¥1.5" } ] },
      { "shop": "杨记蒸面(安悦街店)", "rep": "本地人常去", "menu": [ { "n": "粉皮蒸面", "p": "参考¥10" }, { "n": "稀饭", "p": "参考¥3" } ] },
      { "shop": "老地方(西坝店)", "rep": "市井烟火", "menu": [ { "n": "牛肉炒蒸面", "p": "参考¥15" }, { "n": "蒸面", "p": "参考¥7" } ] }
    ],
    hotels: [
      { "name": "汉滨区中心/兴安中路片区", "price": "参考¥180-300/晚" },
      { "name": "高新万达/安康大道片区", "price": "参考¥200-450/晚" },
      { "name": "滨江大道/火车站片区", "price": "参考¥260-450/晚" }
    ],
    hotelList: [
      { "name": "美豪丽致酒店(安康滨江旗舰店)", "addr": "陕西省安康市汉滨区滨江大道17号", "price": "参考¥300/晚", "rooms": [ { "type": "丽致大床房", "price": "参考¥300" }, { "type": "雅致江景大床房", "price": "参考¥380" } ], "note": "", "collected": COLLECTED },
      { "name": "安康高新希尔顿欢朋酒店", "addr": "陕西省安康市汉滨区康泰园金康商业广场", "price": "参考¥287/晚", "rooms": [ { "type": "舒适大床房", "price": "参考¥287" }, { "type": "豪华大床房", "price": "参考¥360" } ], "note": "", "collected": COLLECTED },
      { "name": "安康瑞斯丽酒店", "addr": "陕西省安康市汉滨区高新技术产业开发区安康大道18号", "price": "参考¥445/晚", "rooms": [ { "type": "标准大床房", "price": "参考¥445" }, { "type": "豪华双床房", "price": "参考¥520" } ], "note": "", "collected": COLLECTED },
      { "name": "安康金地酒店(汉江一桥店)", "addr": "陕西省安康市汉滨区大桥南路86号", "price": "参考¥207/晚", "rooms": [ { "type": "舒适大床房", "price": "参考¥207" }, { "type": "江景双床房", "price": "参考¥280" } ], "note": "", "collected": COLLECTED }
    ]
    // 安康三甲医院均为模板名(市中心医院/市中医院/市人民医院)，无具名真实医院，跳过 hospitals
  },
  "白银": {
    food: [
      { "shop": "尕马子烤羊肉", "rep": "老字号", "menu": [ { "n": "干烤羊肉", "p": "参考¥60" }, { "n": "烤饼子夹烤肉", "p": "参考¥15" } ] },
      { "shop": "靖远老马羊羔肉", "rep": "本地人常去", "menu": [ { "n": "清炖羊羔肉", "p": "参考¥88" }, { "n": "爆炒羊羔肉", "p": "参考¥98" } ] },
      { "shop": "果冻牛肉面馆", "rep": "市井烟火", "menu": [ { "n": "牛肉面", "p": "参考¥8" }, { "n": "凉菜", "p": "参考¥2" } ] },
      { "shop": "白银大肉面", "rep": "本地人常去", "menu": [ { "n": "大肉面", "p": "参考¥12" }, { "n": "卤肉", "p": "参考¥18" } ] }
    ],
    hotels: [
      { "name": "白银区中心/万盛路片区", "price": "参考¥180-280/晚" },
      { "name": "长安路/汽车西站片区", "price": "参考¥250-300/晚" },
      { "name": "纺织路/火车站片区", "price": "参考¥250-290/晚" }
    ],
    hotelList: [
      { "name": "白银希尔顿欢朋酒店", "addr": "甘肃省白银市白银区长安路323号", "price": "参考¥285/晚", "rooms": [ { "type": "舒适大床房", "price": "参考¥285" }, { "type": "豪华亲子房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED },
      { "name": "白银万豪万枫酒店", "addr": "甘肃省白银市白银区纺织路189号", "price": "参考¥258/晚", "rooms": [ { "type": "豪华大床房", "price": "参考¥258" }, { "type": "行政双床房", "price": "参考¥320" } ], "note": "", "collected": COLLECTED },
      { "name": "白银瑞南大酒店(实验中学店)", "addr": "甘肃省白银市白银区万盛路6号36幢", "price": "参考¥252/晚", "rooms": [ { "type": "标准大床房", "price": "参考¥252" }, { "type": "商务套房", "price": "参考¥380" } ], "note": "", "collected": COLLECTED },
      { "name": "全季酒店(白银国芳百货店)", "addr": "甘肃省白银市白银区兰州路16号", "price": "参考¥294/晚", "rooms": [ { "type": "季·大床房", "price": "参考¥294" }, { "type": "家庭房", "price": "参考¥360" } ], "note": "", "collected": COLLECTED }
    ]
    // 白银三甲医院均为模板名(市第一人民医院/市中心医院/市第二人民医院)，无具名真实医院，跳过 hospitals
  },
  "固原": {
    food: [
      { "shop": "永禄羊羔肉", "rep": "本地人常去", "menu": [ { "n": "羊羔肉", "p": "参考¥98" }, { "n": "清甜生洋葱", "p": "参考¥10" } ] },
      { "shop": "老白师泡馍(老白师泡馍烩肉)", "rep": "老字号", "menu": [ { "n": "牛羊肉泡馍", "p": "参考¥25" }, { "n": "烩肉", "p": "参考¥38" } ] },
      { "shop": "同福居暖锅城(隆德县)", "rep": "市井烟火", "menu": [ { "n": "隆德暖锅", "p": "参考¥68" }, { "n": "宽粉条", "p": "参考¥10" } ] },
      { "shop": "福苑饭庄(燕面柔柔)", "rep": "本地人常去", "menu": [ { "n": "燕面柔柔", "p": "参考¥18" }, { "n": "凉菜", "p": "参考¥15" } ] }
    ],
    hotels: [
      { "name": "原州区中心/政府街片区", "price": "参考¥150-290/晚" },
      { "name": "北京路/派胜金街片区", "price": "参考¥120-240/晚" },
      { "name": "文化西街/博物馆片区", "price": "参考¥200-290/晚" }
    ],
    hotelList: [
      { "name": "固原博物馆亚朵酒店", "addr": "宁夏固原市原州区文化西街泰合家园19号楼", "price": "参考¥288/晚", "rooms": [ { "type": "高级大床房", "price": "参考¥288" }, { "type": "行政大床房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED },
      { "name": "固原宾馆", "addr": "宁夏固原市原州区政府街59号", "price": "参考¥156/晚", "rooms": [ { "type": "豪华标间", "price": "参考¥156" }, { "type": "商务套房", "price": "参考¥320" } ], "note": "", "collected": COLLECTED },
      { "name": "如家商旅酒店(固原博物馆店)", "addr": "宁夏固原市原州区文化西街南侧泰合嘉园C区", "price": "参考¥208/晚", "rooms": [ { "type": "商务大床房", "price": "参考¥208" }, { "type": "家庭房", "price": "参考¥280" } ], "note": "", "collected": COLLECTED },
      { "name": "禧悦酒店(固原市政府店)", "addr": "宁夏固原市原州区北京路西侧派胜世茂广场派胜金街6号楼", "price": "参考¥237/晚", "rooms": [ { "type": "舒适大床房", "price": "参考¥237" }, { "type": "豪华套房", "price": "参考¥380" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "宁夏医科大学附属固原医院", "lv": "三甲" }
    ]
  },
  "酒泉": {
    food: [
      { "shop": "宋记糊锅", "rep": "老字号", "menu": [ { "n": "糊锅", "p": "参考¥15" }, { "n": "麻花", "p": "参考¥5" } ] },
      { "shop": "高玉霞特色拨疙瘩", "rep": "本地人常去", "menu": [ { "n": "拨疙瘩", "p": "参考¥22" }, { "n": "臊子", "p": "参考¥8" } ] },
      { "shop": "燕燕香天下(烧烤)", "rep": "市井烟火", "menu": [ { "n": "烤羊肉", "p": "参考¥6/串" }, { "n": "红柳大串", "p": "参考¥12" } ] },
      { "shop": "世纪红牡丹餐厅", "rep": "老字号", "menu": [ { "n": "糊锅", "p": "参考¥18" }, { "n": "拨疙瘩", "p": "参考¥25" } ] }
    ],
    hotels: [
      { "name": "肃州区钟鼓楼/汉唐美食街片区", "price": "参考¥120-290/晚" },
      { "name": "富康购物中心/万达片区", "price": "参考¥160-270/晚" },
      { "name": "西关路/人民医院片区", "price": "参考¥200-340/晚" }
    ],
    hotelList: [
      { "name": "酒泉宾馆", "addr": "甘肃省酒泉市肃州区南大街52号", "price": "参考¥289/晚", "rooms": [ { "type": "豪华标间", "price": "参考¥289" }, { "type": "商务大床房", "price": "参考¥360" } ], "note": "", "collected": COLLECTED },
      { "name": "酒泉亿丰国际酒店(肃州区钟鼓楼店)", "addr": "甘肃省酒泉市肃州区西关路3号", "price": "参考¥200/晚", "rooms": [ { "type": "臻享.行政大床房", "price": "参考¥200" }, { "type": "亲子家庭房", "price": "参考¥320" } ], "note": "", "collected": COLLECTED },
      { "name": "维也纳国际酒店(酒泉万达广场店)", "addr": "甘肃省酒泉市肃州区瓜州路26号", "price": "参考¥266/晚", "rooms": [ { "type": "高级大床房", "price": "参考¥266" }, { "type": "豪华家庭房", "price": "参考¥380" } ], "note": "", "collected": COLLECTED },
      { "name": "酒泉顺天府大酒店(钟鼓楼店)", "addr": "甘肃省酒泉市肃州区南大街33号", "price": "参考¥216/晚", "rooms": [ { "type": "轻奢舒眠双床房", "price": "参考¥216" }, { "type": "雅致大床房", "price": "参考¥280" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "联勤保障部队第九四四医院", "lv": "三甲" }
    ]
  },
  "武威": {
    food: [
      { "shop": "老孙家三套车(北关市场)", "rep": "老字号", "menu": [ { "n": "三套车(行面+卤肉+茯茶)", "p": "参考¥15" }, { "n": "加双份卤肉", "p": "参考¥10" } ] },
      { "shop": "程记面皮(凉州面皮子)", "rep": "本地人常去", "menu": [ { "n": "黄酿皮", "p": "参考¥7" }, { "n": "面皮子", "p": "参考¥6" } ] },
      { "shop": "杨记老牌羊杂", "rep": "市井烟火", "menu": [ { "n": "羊杂汤", "p": "参考¥15" }, { "n": "焙子", "p": "参考¥3" } ] },
      { "shop": "伊清斋(羊肉垫卷子)", "rep": "宴请名店", "menu": [ { "n": "羊肉垫卷子", "p": "参考¥68" }, { "n": "沙葱炒蛋", "p": "参考¥28" } ] }
    ],
    hotels: [
      { "name": "凉州老城/步行街文庙片区", "price": "参考¥150-300/晚" },
      { "name": "宣武街/万嘉汇片区", "price": "参考¥280-340/晚" },
      { "name": "滨河路/天马湖片区", "price": "参考¥260-300/晚" }
    ],
    hotelList: [
      { "name": "武威凉州希尔顿欢朋酒店", "addr": "甘肃省武威市凉州区宣武街万嘉汇商业街二期B2号楼", "price": "参考¥296/晚", "rooms": [ { "type": "高级大床房", "price": "参考¥296" }, { "type": "豪华大床房", "price": "参考¥380" } ], "note": "", "collected": COLLECTED },
      { "name": "武威凉州宾馆", "addr": "甘肃省武威市凉州区东大街159号", "price": "参考¥275/晚", "rooms": [ { "type": "豪华商务大床房", "price": "参考¥275" }, { "type": "行政套房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED },
      { "name": "武威金都国际酒店(步行街职业技术大学店)", "addr": "甘肃省武威市凉州区民勤路2016号", "price": "参考¥168/晚", "rooms": [ { "type": "雅致大床房", "price": "参考¥168" }, { "type": "豪华景观大床", "price": "参考¥260" } ], "note": "", "collected": COLLECTED },
      { "name": "公航旅金陵大酒店", "addr": "甘肃省武威市凉州区雷台东路60号", "price": "参考¥334/晚", "rooms": [ { "type": "高级大床房", "price": "参考¥334" }, { "type": "雅致大床房", "price": "参考¥420" } ], "note": "", "collected": COLLECTED }
    ],
    hospitals: [
      { "n": "甘肃省武威肿瘤医院(甘肃省武威医学科学院)", "lv": "三甲" },
      { "n": "武威市凉州医院", "lv": "三甲" }
    ]
  }
};

// 移除注释占位（安康/白银无 hospitals，直接删除键由下面逻辑处理）
delete newData["安康"].hospitals;
delete newData["白银"].hospitals;

// ===== 合并写入 =====
const sections = ["food", "hotels", "hotelList", "hospitals"];
for (const [city, cityData] of Object.entries(newData)) {
  for (const sec of sections) {
    if (cityData[sec] && Array.isArray(cityData[sec]) && cityData[sec].length > 0) {
      if (!data[sec]) data[sec] = {};
      data[sec][city] = cityData[sec];
    }
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");

// 输出统计
const counts = {};
for (const sec of sections) {
  counts[sec] = newData[sec] && newData[sec][Object.keys(newData)[0]] ? null : null;
}
const stat = {};
for (const city of Object.keys(newData)) {
  stat[city] = {
    food: (newData[city].food || []).length,
    hotels: (newData[city].hotels || []).length,
    hotelList: (newData[city].hotelList || []).length,
    hospitals: (newData[city].hospitals || []).length
  };
}
console.log("=== 写入完成 ===");
console.log(JSON.stringify(stat, null, 2));
