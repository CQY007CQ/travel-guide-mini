// v1.19.182 生成「城市主清单 + 轮转状态」，供每日自动化滚动采集。
// 用法：node tools/_gen-team-cities.mjs
// 输出：tools/team/cities.json（全部去重城市，热门旅游城优先排序）
//       tools/team/collect-state.json（轮转游标/周期/采集日期，仅首次生成，已存在不覆盖）
import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
const req = createRequire(process.cwd() + "/");

const REGIONS = ["华北", "东北", "华东", "华中", "华南", "西南", "西北"];
const REGION_IDX = Object.fromEntries(REGIONS.map((r, i) => [r, i]));

// 热门旅游城（优先采集，priority=2）。不在清单内的自动忽略。
const TOP = new Set([
  "北京","上海","杭州","苏州","成都","重庆","西安","广州","三亚","昆明","丽江","厦门","青岛",
  "桂林","张家界","拉萨","九寨沟","黄山","大理","西双版纳","鼓浪屿","平遥","乌镇","西塘",
  "莫干山","婺源","武夷山","凤凰","香格里拉","千岛湖","普陀山","泰山","曲阜","都江堰",
  "峨眉山","乐山","敦煌","张掖","吐鲁番","长白山","延吉","哈尔滨","大连","武汉","长沙",
  "南京","深圳","天津","济南","烟台","威海","舟山","贵阳","南宁","呼和浩特","银川",
  "乌鲁木齐","太原","郑州","洛阳","开封","承德","秦皇岛","井冈山","华山","黄龙","稻城",
  "阳朔","北海","涠洲岛","喀纳斯","赛里木湖","那拉提","茶卡盐湖","武当山","神农架","张家界"
]);

mkdirSync("tools/team", { recursive: true });

// 去重（与 handout 同逻辑）：区域内若存在 "X市" 且 "X" 也在，删 "X市"
function dedupe(cities) {
  const set = new Set(cities);
  return cities.filter(c => (c.endsWith("市") ? !set.has(c.slice(0, -1)) : true));
}

const all = [];
for (const region of REGIONS) {
  const j = JSON.parse(readFileSync(`tools/team/team-region-${region}.json`, "utf8"));
  for (const city of dedupe(Object.keys(j.food))) all.push({ region, city, p: TOP.has(city) ? 2 : 0 });
}

all.sort((a, b) => (b.p - a.p) || (REGION_IDX[a.region] - REGION_IDX[b.region]) || a.city.localeCompare(b.city, "zh"));

writeFileSync("tools/team/cities.json", JSON.stringify(all, null, 0) + "\n", "utf8");
console.log(`✓ cities.json：${all.length} 城（优先 ${all.filter(x => x.p === 2).length} 城）`);

const statePath = "tools/team/collect-state.json";
if (!existsSync(statePath)) {
  writeFileSync(statePath, JSON.stringify({ cursor: 0, cycle: 0, dates: {}, lastRun: null }, null, 2) + "\n", "utf8");
  console.log("✓ collect-state.json：已初始化（cursor=0）");
} else {
  console.log("• collect-state.json：已存在，保留");
}
