#!/usr/bin/env node
// v1.19.181 deep 扩容：沧州 / 唐山 / 西塘（P1 批次 #9 / #16 / #12）
//
// 幂等追加到 subai/data/ai-deep.js 的 cities 对象末尾：
//   · 逗号锚点：文件以 "\n  }\n};\n" 收尾（cities 对象 } + module }），
//     保留末尾 "\n  }\n};\n" 之前的全部内容（含最后一个 entry 的收尾 }），
//     在最后一个 entry 后补逗号再插入新 entry，杜绝 JSON 语法断裂。
//   · 已收录城市自动跳过（幂等重跑安全）。
//   · 追加后 node --check + schema 自检 + CITIES 城名断言，任一不过即 exit 1。
//
// 红线（与 ai-deep.js 头注释一致）：
//   · 离线静态文本；票价/班次/开放时间/预约规则一律「以官方当日公告为准」；
//   · 无「值得一去 / 风景优美」式泛化词；每条含时间/地点/替代方案。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FILE = path.join(__dirname, "..", "..", "subai", "data", "ai-deep.js");
const DATA = path.join(__dirname, "..", "..", "utils", "data.js");
const BLOCK_TITLES = ["本地人的节奏", "避坑清单", "取景机位", "顺手加一日"];
// 与 tools/test/scan-generic.mjs 同口径的泛化词表（项目铁律：去泛化）
const CLICHE =
  /历史悠久|风景优美|景色宜人|值得一去|不容错过|美不胜收|山清水秀|人杰地灵|物华天宝|很有特色|独具特色|当地特色/;

const NEW_CITIES = {
  "沧州": {
    teaser: [
      "铁狮子在沧县旧州镇、不在市区：后周广顺三年铸成的 40 吨铸铁狮，上午 9 点前到，能避开 10 点后的团队",
      "火锅鸡是沧州人的晚餐主场：甜醋蒜泥蘸料，鸡吃罢下份扯面收尾，周末 18:00-19:30 排队最凶",
      "吴桥杂技大世界在吴桥县、离市区约一小时车程：开园就进，跟着现场节目单走，留四五个小时"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "早餐去老小区门口的羊肠汤店：羊肠血肠配奶白老汤，6-8 点坐满本地人，烧饼撕块泡汤里是标准吃法",
          "上午铁狮子、下午沧州博物馆、傍晚南川老街：三处顺路；博物馆周一闭馆，北朝青釉龙柄壶别漏",
          "南川老街傍晚 6 点半左右亮灯（以现场公告为准）：先沿运河步道走一圈拍南川楼倒影，19 点后再进主街吃饭，错开排队高峰",
          "吴桥杂技赶早场：江湖文化城的绝活和鬼手居上午场次密，按现场节目单倒推路线，别从下午倒着看"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "铁狮子在沧县旧州镇、距市区约 20 公里，与沧州铁狮子与旧城遗址公园是同一处：开放时间与门票以官方当日公告为准",
          "「沧州一日游」团把铁狮子、杂技、购物点塞进一天：三处两两相距一小时车程，跟团全程在赶路，分两天或自驾更值",
          "吴桥杂技大世界演出场次随季节调整：以官方当日公告为准，进园先拍节目单；景区大、分区多，漏看的往往是王牌场",
          "火锅鸡老店周末等位凶：17 点半前或 20 点后去基本不等位；蘸料认甜醋蒜泥，锅底能续汤涮菜",
          "南大港湿地看候鸟讲季节：10 月前后迁徙高峰最壮观，清晨傍晚鸟多，市区自驾过去约一个半小时，别按导航显示的一小时排时间",
          "买伴手礼去正规门店：金丝小枣、河间驴肉火烧认老字号，驴肉火烧保质期短当天吃，散装称重要看准再下手"
        ]
      },
      {
        t: "取景机位",
        items: [
          "南川老街对岸运河步道：19 点后灯全亮，隔水拍南川楼与灯笼倒影，慢门能压出灯串层次",
          "铁狮子正面：上午顺光拍铸铁纹路与通体体量，低角度显气势，10 点后团队人潮难躲",
          "清风楼登楼：傍晚俯瞰运河两岸，落日和亮灯前后两段蓝调都值得等"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "天津", meta: "高铁约 40 分钟", why: "五大道与意式风情区，把沧州的运河漕运故事接到天津卫" },
          { name: "德州", meta: "高铁约 30 分钟", why: "德州扒鸡原产地加董子文化街，京沪线上一脚油门的顺路城" },
          { name: "衡水", meta: "驾车约 1.5 小时，车次以当日为准", why: "衡水湖湿地加内画非遗，和沧州杂技武术是两种河北民间手艺" }
        ]
      }
    ]
  },

  "唐山": {
    teaser: [
      "清东陵在遵化不在市区：顺治康熙乾隆慈禧同眠的世界遗产，孝陵神道加裕陵地宫是主线，单独留一天",
      "唐山宴是座能吃的博物馆：棋子烧饼、饹馇、蜂蜜麻糖一条巷集齐，戏台上评剧乐亭大鼓轮着演",
      "河头老街傍晚再进：灯笼亮起后看《唐王东征》打铁花，演出场次以官方当日公告为准"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "市区一线顺路走：上午唐山宴、下午南湖、傍晚上地震遗址纪念公园外围；唐山宴到南湖步行约一刻钟",
          "南湖是采煤沉降区修复出的城市绿心：免费进，傍晚到凤凰台看日落，光影水舞秀一般 20 点开场（以当日公告为准）",
          "启新 1889 配培仁历史文化街排半天：中国第一桶机制水泥的诞生地，工业风老厂房接民国红砖街区",
          "河头老街 17 点后到：先逛水上市集吃饹馇棋子烧饼，再按节目单卡《唐王东征》的打铁花场次"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "清东陵在遵化市、距市区约 75 公里：和易县的清西陵是两处别跑错；联票含哪些陵寝、地宫开不开放以官方当日公告为准",
          "清东陵值得请正规讲解员：神道石像生和裕陵地宫的门道自己看容易看成一片石头；自驾最顺，班车要到遵化再转车",
          "河头老街演出与水舞秀场次随季节天气调整：进园先拍当日节目单再定动线，别按网上旧场次排时间",
          "河头老街晚场停车紧张：17 点后是入园高峰，住丰南城区或打车去比自驾省心；从市区打车约半小时",
          "唐山菜普遍偏咸：点餐提前说少盐；伴手礼选棋子烧饼、蜂蜜麻糖，保质期短别多买",
          "大地震纪念场所不是打卡点：纪念墙与遗址区保持肃穆，不带自拍杆不摆拍，带孩子去先讲清这段历史"
        ]
      },
      {
        t: "取景机位",
        items: [
          "启新 1889 老厂房：傍晚侧光拍烟囱与锈色钢架，广角低角度，工业风出片率高",
          "河头老街水街对岸：亮灯后隔水拍唐风建筑与灯笼阵列，画舫穿桥时开连拍",
          "南湖凤凰台：日落前半小时拍湖面金光，天黑后拍城市天际线灯光"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "天津", meta: "高铁约 40 分钟", why: "意式风情区加滨海图书馆，工业硬核之外的另一种北方城市" },
          { name: "秦皇岛", meta: "高铁约 1-1.5 小时", why: "山海关老龙头加海滨，把燕山渤海接进行程" },
          { name: "北京", meta: "京唐城际约 1 小时", why: "故宫国博一日，或把唐山当作北京周末的顺带一站" }
        ]
      }
    ]
  },

  "西塘": {
    teaser: [
      "烟雨长廊是西塘的灵魂：1300 米临河廊棚，晴天遮阳雨天避水，清晨 7 点前和傍晚人最少",
      "高铁到嘉善南站转公交直达：别买「西塘一日游」团，景区停留被压到两三小时",
      "门票分日场夜场、还有免费进街区时段：早 8 点前与晚 17 点后（节假日 21 点后）只逛街区，规则以官方当日公告为准"
    ],
    blocks: [
      {
        t: "本地人的节奏",
        items: [
          "住廊棚边的客栈，7 点前出门：整条烟雨长廊没有游客，拍完空镜再回客栈吃早饭",
          "傍晚从永宁桥开始等：灯笼亮起后俯拍长廊全景，北看廊棚南望送子来凤桥，一次占住两个机位",
          "摇橹船傍晚坐最值：灯笼刚亮、船娘哼小调穿水巷，散客拼船以码头当日公示为准",
          "第二天一早补烧香港和石皮弄：旅行团 10 点后才到，8 点前能拍到没有人的一线天"
        ]
      },
      {
        t: "避坑清单",
        items: [
          "「西塘一日游」团从上海杭州发车，多夹带购物点、景区停留只有两三小时：自己高铁到嘉善南站转公交更干净",
          "门票规则复杂：日场夜场票、含不含小景点、免费进街区时段都随时间调整，以官方当日公告为准；只逛街巷掐免费时段即可",
          "景区内主街餐馆价高味中庸：正餐往巷子里的小馆子走，或订含早的客栈；芡实糕臭豆腐当零嘴可以，别当饭",
          "酒吧街附近的客栈夜里吵：订房先看是否临塘东街，怕吵选西栅方向的僻静巷弄",
          "石板路凹凸不平：穿软底平底鞋，雨天廊棚下也滑，慢点走",
          "别理主动带路推销的人：竹筒奶茶和「走小路逃票」都别信，前者香精味重，后者容易上了黑车"
        ]
      },
      {
        t: "取景机位",
        items: [
          "永宁桥：俯拍长廊全景的第一机位，清晨蓝调与日落两段都出片",
          "石皮弄：全长 68 米的窄弄，最窄处不足一米，仰拍一线天，穿汉服拍纵深",
          "送子来凤桥：一侧台阶一侧斜坡，站在桥中央拍桥身与摇橹船同框"
        ]
      },
      {
        t: "顺手加一日",
        trips: [
          { name: "乌镇", meta: "大巴约 1.5 小时", why: "同为水乡气质不同：乌镇看戏剧节与精致民宿，西塘看廊棚生活气，一天一城刚好" },
          { name: "嘉兴", meta: "高铁约 20 分钟", why: "月河老街加嘉兴粽子，南湖红船，节奏比西塘慢一半" },
          { name: "上海", meta: "高铁约 30 分钟", why: "从水乡切进外滩与法租界，两种江南同日切换" }
        ]
      }
    ]
  }
};

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// ── 1. 读取现状，判断哪些城市尚未收录（幂等） ──
let src = fs.readFileSync(FILE, "utf8");
const current = require(FILE).cities || {};
const existing = new Set(Object.keys(current));
const missing = Object.keys(NEW_CITIES).filter((k) => !existing.has(k));

if (missing.length === 0) {
  // 已收录：仅兜底修 updated 字段，不做任何结构改动
  let fixed = src.replace('updated: "2026-10"', 'updated: "2026-11"');
  if (fixed !== src) {
    fs.writeFileSync(FILE, fixed, "utf8");
    console.log("已收录全部目标城市；仅将 updated 修到 2026-11");
  } else {
    console.log("已收录全部目标城市（" + Object.keys(NEW_CITIES).join("/") + "），SKIP");
  }
  process.exit(0);
}

// ── 2. 逗号锚点追加 ──
const ANCHOR = "\n  }\n};\n"; // cities 对象的 } + module.exports 的 }
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
  console.log("✅ v1.19.181 deep 扩容完成，cities 共 " + Object.keys(cities).length + " 城");
});
