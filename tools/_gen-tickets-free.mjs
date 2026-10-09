// v205 生成器：批量补「高置信免费」景点票价（绝不虚构收费价格）
// 原则：只给「开放即免费」的类别打免费标记，且对易收费类型一律排除（宁缺毋假）。
// 输出 tools/v205-tickets-free.js（TICKET_ADD）
import fs from "fs"; import zlib from "zlib"; import path from "path";
const root = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel";
const raw = fs.readFileSync(path.join(root, "subdata/data/data-packed.js"), "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const base = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const TK = base.SPOT_TICKETS || {};

function cleanSpotName(n) {
  const rawS = String(n || "").trim();
  let s = rawS.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )s*[「]?/, "").replace(/」$/, "");
  s = s.replace(/[（(【].*?[)）】]/g, "").trim();
  return s || rawS;
}
// 已有票价（含模糊命中）→ 不动
function covered(name) {
  if (TK[name]) return true;
  const cn = cleanSpotName(name);
  if (TK[cn]) return true;
  for (const k in TK) { if (name.indexOf(k) >= 0 || (cn && cn.indexOf(k) >= 0)) return true; }
  return false;
}

// 「易收费」排除词：命中任一则整条不标免费
// ⚠️ 不要在这里放「陵园$」—— 烈士陵园是免费的，会被整条排除（免费标记由下方「纪念地」规则负责）
const PAID_HINT = /森林|地质|矿山|海洋|水上|游乐园|动物园|植物园|世界|主题|影视|温泉|滑雪|漂流|乐园|遗址|国家|湿地|沙漠|石林|竹海|花海|田园|农场|农庄|度假|营地|游艇|高尔夫|索道|缆车|景区|风景区|名胜|缆车|溶洞|石窟|天山池|长城|古镇$|古城$|宫殿|皇城|王府|寺庙|寺院|道观|教堂|清真寺|观景台|塔$|索道|门票|墓$/;
// 规则：命中即标免费（并按类别给出措辞）
const RULES = [
  { tag: "广场", re: /广场$|广场·/, p: "免费", w: "开放式城市广场，免费进入" },
  { tag: "街区老街", re: /步行街|商业街|古街|老街|街区|民俗街|文化街|美食街|酒吧街|骑楼|古巷$/, p: "免费（开放式街区，沿街展馆/小景点另收）", w: "开放式街区免费逛，个别展馆另收" },
  { tag: "滨水绿道", re: /绿道|滨江|滨河|江滩|河堤|湖滨|海滨栈道|栈道|岸线|环湖|沿江|沿河/, p: "免费（开放式岸线/绿道）", w: "开放式滨水空间，免费" },
  // 城市公园：绝大多数免费开放，个别老牌公园象征性收 2-5 元 —— 措辞里带「个别象征性收费」，
  // 但不写具体数字（ticketTotal 会取 p 里的第一个数字累加进预算，写数字就等于编票价）。
  { tag: "城市公园", re: /公园$|公园·/, p: "免费（多数公园免费开放，个别象征性收费，以现场为准）", w: "城市公园多免费开放，园内游乐/专类园可能另收" },
  // 纪念馆/纪念堂/纪念碑/烈士陵园：全国基本都是「免费 + 实名预约」，不需要「公立字样」限定
  { tag: "纪念地", re: /纪念馆|纪念堂|纪念碑|烈士陵园|烈士纪念|英雄纪念|纪念广场|纪念园|殉难|遇难|惨案|纪念塔|纪念亭/,
    p: "免费（需实名预约）", w: "纪念类场馆多免费开放，需实名预约；周一多闭馆", book: true,
    not: /皇宫|故宫|科技|蜡像|珍宝|陵墓/ },
  { tag: "夜市集市", re: /夜市|集市|菜市场|早市|市集|农贸市场|小吃街|步行夜市/, p: "免费（进场免费，吃喝另付）", w: "开放式市集，免费进场" },
  { tag: "大学校园", re: /大学|学院|校区|校园/, p: "免费（需预约入校）", w: "按校方规定预约入校，进校免费", book: true },
  { tag: "公共沙滩", re: /沙滩|海滨浴场|海水浴场|海滩/, p: "免费（公共沙滩，浴场设施另收）", w: "公共岸线免费，更衣/遮阳等设施另收" },
  // 公立博物馆/美术馆/陈列馆：2008 年起普遍免费开放（但需预约）。
  // ⚠️ 排除易收费的馆：科技/自然/天文/海洋/地质/遗址/皇宫故宫/兵器/航空/铁路/汽车/恐龙/冰雪/蜡像/水族/极地
  // must：必须有「公立属性」字样才认（省/市/区/县/中国/国家/首都/红色类），
  // 否则民营馆（红砖美术馆、观复博物馆、中华民族博物院）会被误标免费 —— 那些是收费的。
  { tag: "公立馆", re: /博物馆|博物院|美术馆|展览馆|陈列馆|非遗馆|民俗馆|规划馆|纪念馆|纪念堂|名人馆|文史馆/,
    p: "免费（需实名预约，以馆方公告为准）",
    w: "公立馆多免费开放，需在公众号/小程序实名预约；周一多闭馆，个别特展另收", book: true,
    must: /省|市|自治区|区|县|中国|国家|首都|人民|革命|历史|抗战|抗日|解放|起义|党史|烈士|英烈|民俗|非遗|工人|青少年/,
    not: /科技|自然|天文|海洋|地质|遗址|皇宫|故宫|皇城|兵器|航空|铁路|铁道|汽车|恐龙|冰雪|蜡像|水族|极地|墓|陵|府邸|故居|民族|私人|民营|蜡像|珍宝|钟表|珍品/ },
  { tag: "文化设施", re: /图书馆|文化馆|工人文化宫|青少年宫|少年宫|文化中心|艺术中心/, p: "免费", w: "公共文化设施，免费开放（活动/演出另收）" },
  { tag: "雕塑雕像", re: /雕像|雕塑|浮雕|群雕|铜像|石像/, p: "免费", w: "开放式雕塑/纪念像，免费参观" },
  { tag: "文创艺术区", re: /文创|创意园|创意街区|艺术区|艺术街区|文化产业园|文创园|798|工业遗址园/, p: "免费（开放式园区，展馆/演出另收）", w: "开放式创意园区免费逛，个别展览另收" },
  { tag: "街巷胡同", re: /胡同|巷$|弄$|坊$|里$|古巷|老巷|街巷/, p: "免费（开放式街巷）", w: "开放式街巷，免费逛（沿街小店另付）" },
  { tag: "牌坊牌楼", re: /牌坊|牌楼|石牌坊|棂星门/, p: "免费", w: "开放式街坊构筑物，免费" },
  { tag: "体育场馆", re: /体育馆|体育场|体育中心|全民健身中心|体育公园/, p: "免费（公共体育场馆，具体以场馆公告为准）", w: "公共体育场馆多免费或低收费开放，以场馆公告为准" },
  { tag: "教堂", re: /教堂|礼拜堂|福音堂|天主堂|修道院/, p: "免费（开放时段可入内，礼拜时间请避让）", w: "宗教场所，开放时段可参观；礼拜/弥撒期间请勿打扰" },
  { tag: "码头岸线", re: /码头|渡口|古渡|渔港|渔人码头/, p: "免费（开放式码头/岸线）", w: "开放式码头岸线免费，乘船项目另付" },
];

const names = new Map(); // cleanName -> {cities}
for (const c of base.CITIES) for (const e of (c.experiences || [])) {
  const n = cleanSpotName((e && (e.name || e.t)) || "");
  if (!n) continue;
  if (!names.has(n)) names.set(n, new Set());
  names.get(n).add(c.name);
}

const out = {}, stat = {}, samples = {};
let total = 0;
for (const [n, citiesSet] of names) {
  if (covered(n)) continue;
  if (PAID_HINT.test(n)) continue;
  for (const r of RULES) {
    if (!r.re.test(n)) continue;
    if (r.not && r.not.test(n)) continue;   // 该规则内的易收费子类，跳过
    if (r.must && !r.must.test(n)) continue; // 缺「公立属性」字样 → 不认（防民营馆误标）
    // 名称过短/过泛不标（避免「街」「公园」这种泛名被当景点）
    if (n.length < 4) continue;
    out[n] = { p: r.p, book: !!r.book, where: r.w };
    stat[r.tag] = (stat[r.tag] || 0) + 1;
    if (!samples[r.tag]) samples[r.tag] = [];
    if (samples[r.tag].length < 4) samples[r.tag].push(Array.from(citiesSet)[0] + "·" + n);
    total++;
    break;
  }
}
console.log("候选唯一景点名(全库):", names.size);
console.log("本轮可安全新增免费标记:", total);
console.log("---------------------------------------------");
for (const k of Object.keys(stat).sort((a, b) => stat[b] - stat[a])) {
  console.log(String(stat[k]).padStart(6) + "  " + k + "   例: " + samples[k].join(", "));
}
const body = `// v205 · 高置信「免费」票价批量补充（工具自动生成，勿手改）
// 生成：tools/_gen-tickets-free.mjs
// 铁律：绝不虚构收费价格。这里只给「开放即免费」的类别打免费标记：
//   广场 / 开放式街区 / 滨水绿道 / 城市公园 / 纪念地 / 夜市集市 / 大学校园 / 公共沙滩
// 排除：森林|地质|海洋|乐园|遗址|湿地|景区|寺观|长城|古镇|石窟…等易收费类型（PAID_HINT）
// 已存在票价（精确或模糊命中）的景点一律跳过，不覆盖存量数据。
const TICKET_ADD = ${JSON.stringify(out, null, 2)};
module.exports = { TICKET_ADD };
`;
fs.writeFileSync(path.join(root, "tools/v205-tickets-free.js"), body);
console.log("已写 tools/v205-tickets-free.js | 条目:", Object.keys(out).length);
