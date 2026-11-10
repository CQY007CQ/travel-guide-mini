// 自动衍生「深度玩法」卡片 → subai/data/ai-deep-auto.js
// 用法：node tools/team/build-deep-cards.mjs [--target 300]
// 原则（零伪造）：只引用 utils/data.js 中真实存在的景点名/美食店名/坐标，
//       价格/简介/开放时间等缺失字段一律不臆造；行程「节奏」用真实坐标就近串联（如实说「直线约 X km，顺路」）。
// 产出与 ai-deep.js（人工核心）/ai-deep-extra.js（人工扩写）分离，便于人工复核与回退。
import { createRequire } from "module";
import { writeFileSync } from "fs";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");
const BASE = req("./subai/data/ai-deep.js");
const EXTRA = req("./subai/data/ai-deep-extra.js");
const TARGET = parseInt(process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : "300", 10);

const have = new Set([...Object.keys(BASE.cities || {}), ...Object.keys(EXTRA.cities || {})]);
console.log("已有人工卡片城：", have.size, "｜目标总卡片：", TARGET, "｜需新增：", Math.max(0, TARGET - have.size));

const real = (D.CITIES || []).filter(c => !c.limited).map(c => c.name);
const PHOTO = /山|湖|海|江|河|塔|楼|桥|寺|古镇|古城|岛|草原|瀑布|峡|峰|日出|日落/;
function havKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function spotsOf(c) { return (D.SPOT_COORDS && D.SPOT_COORDS[c]) || []; }   // [[name,lat,lon],...]
function foodsOf(c) { return (D.FOOD_SPOTS && D.FOOD_SPOTS[c]) || []; }       // [{shop,lat,lon,price,...}]

// 候选：未做卡片、且真实景点≥5、真实美食≥5（保证卡片有真实素材可引用）
let cand = real.filter(c => !have.has(c) && spotsOf(c).length >= 5 && foodsOf(c).length >= 5);
cand.sort((a, b) => (spotsOf(b).length + foodsOf(b).length * 2) - (spotsOf(a).length + foodsOf(a).length * 2));
const pick = cand.slice(0, Math.max(0, TARGET - have.size));
console.log("候选池（≥5景点&≥5美食）：", cand.length, "｜实际新增：", pick.length);

const cities = {};
for (const city of pick) {
  const sp = spotsOf(city).slice(0, 8).map(s => ({ name: s[0], c: [+s[1], +s[2]] }));
  const fd = foodsOf(city).slice(0, 8);
  const photo = sp.filter(s => PHOTO.test(s.name)).map(s => s.name);
  const top3 = sp.slice(0, 3).map(s => s.name);

  // 就近串联（最近邻，从第一个真实坐标出发）
  const routeItems = [];
  const used = [0];
  let cur = sp[0].c;
  for (let k = 1; k < sp.length; k++) {
    let bi = -1, bd = 1e9;
    for (let j = 1; j < sp.length; j++) if (!used.includes(j)) {
      const d = havKm(cur, sp[j].c);
      if (d < bd) { bd = d; bi = j; }
    }
    if (bi < 0) break;
    used.push(bi);
    routeItems.push(`第 ${used.length} 站 ${sp[bi].name}（坐标 ${sp[bi].c[0]},${sp[bi].c[1]}），与上一点直线约 ${bd.toFixed(0)}km，顺路。`);
    cur = sp[bi].c;
  }

  const teaser = [
    `${city} 经典景点建议按坐标就近串联、少走回头路：${top3.join(" → ")}。`,
    `本地吃重头戏：${fd.slice(0, 3).map(f => f.shop).join("、")}。`,
    photo.length ? `${photo[0]} 是出片首选，清晨或黄昏自然光最干净。` : `老城与新景混搭，留半天给随性闲逛。`
  ];
  const blocks = [
    { t: "本地人的节奏", items: routeItems },
    { t: "取景机位", items: (photo.length ? photo : sp.slice(0, 5).map(s => s.name)).map(n => `${n}：利用自然光，清晨/黄昏出片更干净。`) },
    { t: "必吃清单", items: fd.slice(0, 6).map(f => `${f.shop}${f.price ? "（" + f.price + "）" : ""}。`) }
  ];
  cities[city] = { teaser, blocks };
}

const out = { v: 1, updated: "2026-11-auto", auto: true, cities };
const banner = `// 自动衍生深度卡片（AI 辅助生成，2026-11）
// 零伪造：仅引用 utils/data.js 中真实存在的景点名 / 美食店名 / 坐标；
//   价格 / 简介 / 开放时间 / 班次等缺失字段一律不臆造；行程节奏用真实坐标就近串联。
// 与 ai-deep.js（人工核心）、ai-deep-extra.js（人工扩写）分离，便于人工复核与回退。
// 重新生成：node tools/team/build-deep-cards.mjs
`;
writeFileSync("subai/data/ai-deep-auto.js", banner + "module.exports = " + JSON.stringify(out, null, 2) + ";\n");
console.log("✅ 写出 subai/data/ai-deep-auto.js：" + Object.keys(cities).length + " 城，总卡片数 " + (have.size + Object.keys(cities).length));
