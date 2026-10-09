// §9.6 占位备注改写：官方名录/自动导入的景点，note 大量是占位符
// （「当地知名景点」3519 条 + 「当地景区」436 条 = 3955 条，占 21%），用户点开等于没有信息。
// 按景点名关键词推断类别，换成有信息量的备注；同类用 2 种措辞按名字哈希轮换，避免整份行程雷同。
import fs from "fs";

const F = "tools/_apply-safe.mjs";
let s = fs.readFileSync(F, "utf8");

const anchor = `if (noteFixed) console.log("§9.5 note 括号清洗:", noteFixed, "条");`;

const block = anchor + `

// §9.6 占位备注改写（「当地知名景点」/「当地景区」这类没有信息量的占位文案）
function noteBySpotName(name) {
  const n = String(name || "");
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const pick = (arr) => arr[h % arr.length];
  if (/博物馆|博物院|美术馆|展览馆|科技馆|陈列馆|纪念馆/.test(n)) return pick(["展馆类，室内为主，雨天可安排", "室内展馆，建议留 1-2 小时"]);
  if (/遗址|陵园|陵|墓|故居|旧址|会址|纪念园/.test(n)) return pick(["历史遗址，看点偏人文", "人文遗址，配讲解更值"]);
  if (/古镇|古城|古街|老街|古村|街区|步行街|古巷/.test(n)) return pick(["古街古镇，适合边逛边吃", "老街街区，慢慢走更有味"]);
  if (/寺|庙|宫|祠|塔|教堂|清真寺|道观|禅/.test(n)) return pick(["人文古迹，留意开放时间", "古建或宗教场所，着装得体"]);
  if (/温泉|滑雪|漂流|乐园|水世界|度假区|营地|游乐园/.test(n)) return pick(["体验类项目，建议预留半天", "玩乐项目，人多时先预约"]);
  if (/湿地|公园|植物园|动物园|海洋馆|花海|田园|农庄|生态园/.test(n)) return pick(["公园绿地，适合散步慢逛", "园林景观，早晚更舒服"]);
  if (/山|峰|峡|洞|岩|岭|谷|瀑布|森林|草原|沙漠/.test(n)) return pick(["自然景观，需步行或爬升", "山地峡谷景观，穿好走的鞋"]);
  if (/湖|河|江|海|岛|湾|滩|池|水库/.test(n)) return pick(["水景，傍晚光线更好", "水岸景观，适合傍晚散步"]);
  return pick(["本地景点，可灵活安排半天", "当地去处，按顺路安排即可"]);
}
const NOTE_PLACEHOLDER = ["当地知名景点", "当地景区", "当地景点", "景点", "当地", ""];
let notePlaceholder = 0;
for (const c of base.CITIES) {
  for (const e of (c.experiences || [])) {
    if (!e || typeof e !== "object") continue;
    const t = String(e.note || "").trim();
    if (NOTE_PLACEHOLDER.indexOf(t) >= 0) {
      e.note = noteBySpotName(e.name);
      notePlaceholder++;
    }
  }
}
if (notePlaceholder) console.log("§9.6 占位备注改写:", notePlaceholder, "条");`;

const n = s.split(anchor).length - 1;
if (n !== 1) { console.log("✗ 锚点命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(anchor, block), "utf8");
console.log("✓ §9.6 已写入 _apply-safe.mjs");
