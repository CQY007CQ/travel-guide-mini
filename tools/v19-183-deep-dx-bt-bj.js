#!/usr/bin/env node
// deep 扩容（P1 批次 #14 定西 / #17 保亭 / #18 毕节）——目标 APP_VER 1.20.5
//
// 幂等追加到 subai/data/ai-deep.js 的 cities 对象末尾：
//   · 逗号锚点：文件以 "\n  }\n};\n" 收尾（最后一个 entry 的 } + cities } + module }），
//     先 od -c 核对真实 EOF 字节再改写，杜绝 JSON 语法断裂。
//   · 已收录城市自动跳过（幂等重跑安全）。
//   · 追加后 node --check + schema 自检 + CITIES 城名断言 + 台湾城市红线断言，任一不过 exit 1。
//
// 红线（与 ai-deep.js 头注释一致）：
//   · 离线静态文本；票价/班次/开放时间/预约规则一律「以官方当日公告为准」；
//   · 无「值得一去 / 风景优美」式泛化词；每条含时间/地点/替代方案；
//   · 台湾城市内容只写风物美食、不写行政区划表述（本批三城均不涉台，防御性断言）。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FILE = path.join(__dirname, "..", "subai", "data", "ai-deep.js");
const DATA = path.join(__dirname, "..", "utils", "data.js");
const BLOCK_TITLES = ["本地人的节奏", "避坑清单", "取景机位", "顺手加一日"];
// 与 tools/scan-generic.mjs 同口径的泛化词表（项目铁律：去泛化）
const CLICHE =
  /历史悠久|风景优美|景色宜人|值得一去|不容错过|美不胜收|山清水秀|人杰地灵|物华天宝|很有特色|独具特色|当地特色/;
// 台湾城市红线：deep 库不收台湾城市内容（P2 候选里的台中/桃园一律不写行政区划，本批不涉及，防御性拦截）
const TAIWAN_CITIES = [
  "台北", "新北", "桃园", "台中", "台南", "高雄", "基隆", "新竹", "嘉义",
  "宜兰", "花莲", "台东", "屏东", "彰化", "云林", "南投", "苗栗", "澎湖", "金门", "马祖"
];

const NEW_CITIES = {
  "定西": {
    teaser: [
      "兰州西高铁约半小时到定西北：景点散在渭源、陇西、漳县、通渭等县，一天一县自驾最顺",
      "渭河源在渭源县五竹镇：大禹导渭传说的起点，禹王庙、品字泉、灞陵桥一条线走完",
      "李家龙宫是全球李氏寻根祖庭：唐式祠堂配北宋威远楼，黄昏登楼看陇西古城"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "落地先逛安定区：定西市博物馆看马家窑彩陶（周一闭馆），西岩山公园登顶看人字形城貌，半天走完",
          "第二天扎陇西：上午李家龙宫，中午北关正街吃腊肉夹饼，黄昏登威远楼等古城落日",
          "第三天进漳县山野：贵清山断涧仙桥配遮阳山峡谷同一天，中午在县城吃手抓羊肉",
          "夏天周五晚从兰州自驾来过周末是本地惯例：山区凉好几度，夜市来碗洋芋搅团配宽粉"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "景点跨县、单程一小时起步：定西市区到漳县车程约一个半小时，全程住市区会浪费大量车程，按县拆天数",
          "县域班车末班收得早：去渭源、陇西、漳县前先问清回程末班，别磨到天黑误了返程",
          "门票与观光车价格随季节调整：一律以官方当日公告为准；高原峡谷徒步穿防滑运动鞋，带薄外套",
          "遮阳山全程徒步量不小：三潭瀑布到一线天约需半天，体力一般就坐观光车到精华段再走",
          "买当归党参黄芪去正规门店：认准包装标识与检测报告，路边散装无标识的别当特产买",
          "定西菜偏酸辣：洋芋搅团、浆水面、荞圈圈口味重，忌口提前跟店家说"
        ]
      },
      {
        t: "取景机位",
        items: [
          "灞陵桥：明代纯木悬臂拱桥、无钉无铆，晨雾或夕阳下隔渭水拍桥身倒影，渭源县城步行可达",
          "威远楼：北宋鼓楼，黄昏侧光拍城楼立面和陇西古城天际线",
          "贵清山断涧仙桥：上午顺光拍悬空桥与峡谷深谷，山间多雾，雾散后半小时最出片"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "兰州", meta: "高铁约 30 分钟，车次以当日为准", why: "黄河风情线加牛肉面，定西最顺的中转城" },
          { name: "天水", meta: "高铁约 1.5 小时，车次以当日为准", why: "麦积山石窟加伏羲庙，从陇中黄土高原切到陇南山地" },
          { name: "临夏", meta: "驾车约 2 小时", why: "炳灵寺石窟加八坊十三巷，和政古动物化石博物馆看巨犀" }
        ]
      }
    ]
  },

  "保亭": {
    teaser: [
      "保亭不通高铁：三亚出发山海高速约一小时，呀诺达、槟榔谷两大 5A 加七仙岭温泉一条线",
      "呀诺达走梦幻谷踏瀑戏水：瀑布连环涉水而行，速干衣防滑鞋必备，山间比市区凉三五度",
      "槟榔谷看《槟榔·古韵》：绣面文身阿婆、黎锦纺染织绣、甘什黎村，演出场次以官方当日公告为准"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "开园就进呀诺达：梦幻谷线路上午人最少，踏瀑戏水连走带玩约三小时，中午出景区吃五脚猪",
          "下午转槟榔谷：甘什黎村加非遗村慢逛两小时，《槟榔·古韵》按当日节目单卡场次，别错过开场",
          "傍晚上七仙岭泡温泉：槟榔谷过去约 40 分钟，公共泡池就够解乏，泡完回三亚或住保亭县城",
          "十一月到四月是保亭正季：三亚人挤人的时候，这里凉而不冷，雨林徒步加温泉正好"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "保亭没有高铁站：从三亚汽车总站乘城际公交约一个半小时，打车或网约车约一小时，先查末班车",
          "呀诺达和槟榔谷同属三道镇却分居两头：之间车程约 20 分钟，别按地图直线距离排时间",
          "踏瀑戏水另购装备且全程涉水：备速干衣、防滑凉鞋、手机防水袋，人字拖进不了谷",
          "门票、演出场次、观光车价格随季节调整：一律以官方当日公告为准，官方渠道提前购票常有小幅优惠",
          "槟榔谷内黎锦、山兰酒认准非遗村正规摊位：路边主动推销的香囊手串先问价再碰",
          "雨林蚊虫多：长袖加驱蚊水；黎族村寨拍照先问过阿婆，绣面文身老人不喜欢被怼脸拍"
        ]
      },
      {
        t: "取景机位",
        items: [
          "呀诺达梦幻谷瀑布群：上午十点前顺光拍水雾彩虹，慢门压水流穿林感",
          "槟榔谷船型屋聚落：傍晚侧光拍茅草屋脊与黎锦晾晒架，浅色衣服和土黄墙面对比更干净",
          "七仙岭温泉泉眼池：清晨薄雾时拍七峰层叠，温泉水汽正好补氛围"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "三亚", meta: "驾车约 1 小时 / 城际公交约 1.5 小时", why: "海湾沙滩加第一市场夜市，把雨林和海岸一天串完" },
          { name: "五指山", meta: "驾车约 1.5 小时", why: "热带雨林森林公园加黎族祖居，登山看云海比呀诺达更野" },
          { name: "万宁", meta: "驾车约 2.5 小时", why: "石梅湾加日月湾冲浪，从黎乡切到海岛海岸线" }
        ]
      }
    ]
  },

  "毕节": {
    teaser: [
      "成贵高铁贵阳北到毕节最快约 46 分钟：织金洞看溶洞、百里杜鹃看花海、草海看黑颈鹤，景区分散建议自驾",
      "织金洞常年恒温十几摄氏度：银雨树、霸王盔、十万大山走完约两小时，薄外套防滑鞋必带",
      "百里杜鹃盛花期约一个月：三月中旬到四月底，普底金坡双景区连看，行前查官方花期预报"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "第一天以织金洞为主：上午进洞避开午后团客，下午回织金古城逛财神庙，晚饭荞凉粉配烙锅",
          "花期季专攻百里杜鹃：早七点半前进普底景区，上午光线柔、旅行团未到，数花峰俯瞰后转金坡",
          "冬天留给草海：十一月到次年三月黑颈鹤来越冬，清晨傍晚鸟最活跃，观鸟台备长焦",
          "夏天来避暑：市区海拔一千五上下、均温二十一度出头，晚上臭豆干火锅加烤洋芋"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "景区之间没有直达公交：织金洞到百里杜鹃车程约两小时，自驾、景区直通车或包车三选一",
          "高铁站门口揽客的黑车不坐：毕节站、大方站、黔西站出去用网约车或官方直通车，先谈好价再上车",
          "百里杜鹃花期只有一个月且逐年浮动：动身前查官方花期预报；非花期可改去赫章韭菜坪，八九月紫色韭菜花海",
          "织金洞内常年低温潮湿、地面湿滑：薄外套加防滑鞋，钟乳石不要摸，拍照别用闪光灯",
          "门票、观光车、花期活动一律以官方当日公告为准：官方渠道提前购票常比现场便宜",
          "草海是国家级自然保护区：观鸟保持距离不喧哗，乘船认正规码头，别理拉客的私船"
        ]
      },
      {
        t: "取景机位",
        items: [
          "织金洞迎宾厅到灵霄殿一段：洞内光线暗，架三脚架长曝光拍钟乳石，禁用闪光灯",
          "百里杜鹃数花峰观景台：上午顺光拍花海纵深，广角纳入山峦层次，浅色衣服更干净",
          "草海观鸟台：清晨侧逆光拍黑颈鹤掠过芦苇荡，长焦 400mm 起步，薄雾天更出片"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "贵阳", meta: "高铁最快约 46 分钟，车次以当日为准", why: "甲秀楼加夜市，毕节最顺的省会中转站" },
          { name: "安顺", meta: "高铁约 1.5 小时，车次以当日为准", why: "黄果树加龙宫，看完溶洞再看瀑布水势" },
          { name: "宜宾", meta: "高铁约 1.5 小时，车次以当日为准", why: "蜀南竹海加李庄古镇，顺路看一眼长江第一城" }
        ]
      }
    ]
  }
};

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// ── 0. 台湾城市红线（防御性）：本批不得收录台湾城市 ──
for (const k of Object.keys(NEW_CITIES)) {
  if (TAIWAN_CITIES.some((t) => k.includes(t))) fail("台湾城市「" + k + "」不在本批收录范围");
}

// ── 1. 读取现状，判断哪些城市尚未收录（幂等） ──
let src = fs.readFileSync(FILE, "utf8");
const current = require(FILE).cities || {};
const existing = new Set(Object.keys(current));
const missing = Object.keys(NEW_CITIES).filter((k) => !existing.has(k));

if (missing.length === 0) {
  let fixed = src.replace('updated: "2026-10"', 'updated: "2026-11"');
  if (fixed !== src) {
    fs.writeFileSync(FILE, fixed, "utf8");
    console.log("已收录全部目标城市；仅将 updated 修到 2026-11");
  } else {
    console.log("已收录全部目标城市（" + Object.keys(NEW_CITIES).join("/") + "），SKIP");
  }
  process.exit(0);
}

// ── 2. 逗号锚点追加（先核对真实 EOF） ──
const ANCHOR = "\n  }\n};\n"; // 最后一个 entry 的 } + cities 的 } + module.exports 的 }
if (!src.endsWith(ANCHOR)) fail("文件结尾不是预期锚点，人工确认后再跑");

const bodies = missing.map((k) => {
  const json = JSON.stringify(NEW_CITIES[k], null, 2);
  return json
    .split("\n")
    .map((l, i) => (i === 0 ? '  "' + k + '": ' + l : "  " + l))
    .join("\n");
});
// prefix 以 "    ]\n  }" 收尾（最后一个 entry 的 blocks 数组 + entry 收尾 }）
const prefix = src.slice(0, src.length - ANCHOR.length);
let out = prefix + ",\n" + bodies.join(",\n") + ANCHOR;
out = out.replace('updated: "2026-10"', 'updated: "2026-11"');

fs.writeFileSync(FILE, out, "utf8");
console.log("已追加：" + missing.join(" / ") + "（updated → 2026-11）");

// ── 3. node --check ──
const chk = spawnSync(process.execPath, ["--check", FILE], { encoding: "utf8" });
if (chk.status !== 0) fail("node --check 失败:\n" + chk.stderr);
console.log("✓ node --check 通过");

// ── 4. schema 自检（重新 require，绕开本进程缓存） ──
delete require.cache[require.resolve(FILE)];
const cities = require(FILE).cities;
for (const k of missing) {
  const e = cities[k];
  if (!e) fail("追加后仍读不到 " + k);
  if (!Array.isArray(e.teaser) || e.teaser.length !== 3) fail(k + " teaser 必须恰好 3 条");
  e.teaser.forEach((t, i) => {
    if (typeof t !== "string" || !t.trim()) fail(k + " teaser[" + i + "] 为空");
    if (CLICHE.test(t)) fail(k + " teaser[" + i + "] 含泛化词: " + t);
  });
  if (!Array.isArray(e.blocks) || e.blocks.length !== 4) fail(k + " blocks 必须恰好 4 块");
  e.blocks.forEach((b, i) => {
    if (b.t !== BLOCK_TITLES[i]) fail(k + " blocks[" + i + "].t 应为「" + BLOCK_TITLES[i] + "」，实为「" + b.t + "」");
    if (b.t === "顺手加一日") {
      if (!Array.isArray(b.trips) || b.trips.length < 2) fail(k + " 顺手加一日 trips 至少 2 个");
      b.trips.forEach((t2, j) => {
        if (!t2.name || !t2.meta || !t2.why) fail(k + " trips[" + j + "] 缺 name/meta/why");
        if (CLICHE.test(t2.why)) fail(k + " trips[" + j + "].why 含泛化词");
      });
      return;
    }
    if (!Array.isArray(b.items) || !b.items.length) fail(k + " blocks[" + i + "] items 为空");
    b.items.forEach((x, j) => {
      if (typeof x !== "string" || !x.trim()) fail(k + " blocks[" + i + "].items[" + j + "] 为空");
      if (CLICHE.test(x)) fail(k + " blocks[" + i + "].items[" + j + "] 含泛化词: " + x);
    });
  });
}
console.log("✓ schema 自检通过（teaser×3 + blocks 四块 + 无泛化词）");

// ── 5. CITIES 城名断言（与 utils/data.js 的 CITIES[].name 完全一致） ──
const D = require(DATA);
Promise.resolve(D.initData ? D.initData() : D).then(() => {
  const names = new Set((D.CITIES || []).map((c) => c.name));
  for (const k of missing) {
    if (!names.has(k)) fail("城名「" + k + "」不在 CITIES[].name 中，页面匹配不上");
  }
  // 顺手加一日的 trip 名做软提示（不在 CITIES 不阻断，但列出人工过目）
  const soft = [];
  for (const k of missing) {
    const blk = cities[k].blocks.find((b) => b.t === "顺手加一日");
    (blk.trips || []).forEach((t2) => {
      if (!names.has(t2.name)) soft.push(k + " → " + t2.name);
    });
  }
  if (soft.length) console.log("⚠ trip 名不在 CITIES（软提示，不阻断）: " + soft.join(", "));
  console.log("✓ CITIES 城名断言通过：" + missing.join(" / "));
  console.log("✅ deep 扩容完成，cities 共 " + Object.keys(cities).length + " 城");
});
