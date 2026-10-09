// A1 泛词体检 v2：聚焦「无法对应具体 POI」的条目
// 判定 ① 名字 = 纯类型/描述（无地名专名成分）→ 泛
//      ② 主城 experiences 中，景点名无法在 SPOT_COORDS/known-spot 库匹配到精确坐标 → 弱
// 输出分级：A级=建议替换/删除（纯泛）；B级=无坐标需补（进 A2）；C级=参考
const D = require("../utils/data.js");

const KNOWN = {}; // 城市 -> 景点名 -> coord
Object.keys(D.SPOT_COORDS || {}).forEach(city => {
  (D.SPOT_COORDS[city] || []).forEach(x => {
    if (!KNOWN[city]) KNOWN[city] = {};
    KNOWN[city][x[0]] = { lat: x[1], lng: x[2] };
  });
});
// 直接点名就能定位的大名（不依赖城市库，跨库匹配用包含判定）
function hasCoord(spot, city) {
  const s = String(spot || "").trim();
  // 先精确
  if (KNOWN[city] && KNOWN[city][s]) return true;
  // 主景点 + 子景点拆分："A + B" 只要 A 有坐标即可（B 通常顺带）
  const head = s.split("+")[0].split("·")[0].split("（")[0].trim();
  if (KNOWN[city] && KNOWN[city][head]) return true;
  // 含连接词截断
  const m = s.match(/^(.*?)(?:[（(]|，|、)/);
  if (m && KNOWN[city] && KNOWN[city][m[1].trim()]) return true;
  return false;
}

// A级纯泛：整名就是类型/描述词，无任何专名
const PURE = /^(?:城市|城区|市区|当地|老城|古城|古镇)?(?:中心|中央|人民|文化|体育|艺术|科技|民俗|美食|小吃|购物|商业|步行|夜市|滨江|江畔|湖畔|山顶|观景)?(?:广场|公园|大厦|中心|大道|大街|老街|古镇|古城|夜市|步行街|美食街|小吃街|博物馆|美术馆|纪念馆|遗址|夜景|灯光|演出|喷泉|码头|大桥|教堂|寺庙|古寺|景区|游船|索道|缆车|温泉|步道|街区|地标|景点|园区|风情街|特色街)$/;
// 描述性观光词（连名词都不是，纯活动/景观描述）
const DESC = /^(?:欣赏|观看|逛逛|体验|感受|漫步|夜游|游览|打卡|远眺|俯瞰|参观|品味|吃|喝).{0,8}$/;

let a = [], b = [], c = [];
const seen = new Set();
for (const city of D.CITIES) {
  const cn = city.name;
  (city.experiences || []).forEach(x => {
    const n = String(x.name || "").trim();
    const noCity = n.split("·").pop().trim().replace(new RegExp("^" + cn), "").replace(new RegExp("^" + cn + "市"), "").trim();
    const k = cn + "|" + n;
    if (seen.has(k)) return; seen.add(k);
    if (PURE.test(noCity) || PURE.test(n) || DESC.test(n)) a.push({ city: cn, n, note: String(x.note || "").slice(0, 30), why: "纯泛/描述" });
    else if (!hasCoord(n, cn)) b.push({ city: cn, n, note: String(x.note || "").slice(0, 30), why: "无坐标" });
    else c.push({ city: cn, n });
  });
}
console.log("A级纯泛 " + a.length + " 条 / B级无坐标(并入A2) " + b.length + " 条 / C级有坐标 " + c.length + " 条\n");
console.log("◆◆ A级 疑似纯泛条目：");
a.forEach(h => console.log("   [" + h.city + "] " + h.n + (h.note ? "  ← " + h.note : "")));
console.log("\n◆ B级 无坐标 experiences（应补坐标）top50：");
b.slice(0, 50).forEach(h => console.log("   [" + h.city + "] " + h.n));
console.log("\n◆ B级 全部 " + b.length + " 条详见 count 汇总：");
const byC = {};
b.forEach(h => { byC[h.city] = (byC[h.city] || 0) + 1; });
Object.keys(byC).sort((x, y) => byC[y] - byC[x]).forEach(k => console.log("   " + k + ": " + byC[k] + " 条"));
