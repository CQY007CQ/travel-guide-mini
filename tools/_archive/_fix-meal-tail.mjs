// 长行程收尾填充文案轮换：原文案「当地美食 + 自由活动 / 用当地味道给这一天收尾」在 3~5 天行程里
// 连续几天一字不差（audit 实测 7 处，含同一天出现两次），用户一眼看出是模板。
// 沿用已有的 RELAX 哈希轮换思路：按「城市 + 天」+该时段已有条目数做确定性轮换，同一天内不撞词。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const helper = `
// 收尾填充文案轮换（同一天内按该时段已有条目数错开，避免同日撞词）
const MEAL_TAILS = [
 { name: "当地美食 + 自由活动", note: "用当地味道给这一天收尾" },
 { name: "找家本地馆子 + 夜市走走", note: "避开景区餐厅，往居民区钻更地道" },
 { name: "去小吃街扫街 + 慢慢逛", note: "边走边吃，别一次点太多" },
 { name: "本地味道 + 散步消食", note: "吃完沿街走一段，顺便看看夜景" },
];
function mealTail(itemsArr, period, seed){
 let h = 0; const seedStr = String(seed || "");
 for (let k = 0; k < seedStr.length; k++) h = (h * 31 + seedStr.charCodeAt(k)) >>> 0;
 const seq = (itemsArr || []).filter(x => x && x.period === period).length;
 const t = MEAL_TAILS[(h + seq) % MEAL_TAILS.length];
 return { name: t.name, period, note: t.note };
}`;

const edits = [
  {
    from: `const tailPeriod = (arr) => (Array.isArray(arr) && arr.some(it => it && /^(晚上|深夜|夜间)$/.test(it.period))) ? "晚上" : "傍晚";`,
    to: `const tailPeriod = (arr) => (Array.isArray(arr) && arr.some(it => it && /^(晚上|深夜|夜间)$/.test(it.period))) ? "晚上" : "傍晚";${helper}`,
  },
  {
    from: `      items.push({ name: "当地美食 + 自由活动", period: "傍晚", note: "用当地味道给这一天收尾" });`,
    to: `      items.push(mealTail(items, "傍晚", (city.name || "") + "#" + i));`,
  },
  {
    from: `      else items.push({name:"当地美食 + 自由活动", period:"晚上", note:"用当地味道给这一天收尾"});
     } else items.push({name:"当地美食 + 自由活动", period:"晚上", note:"用当地味道给这一天收尾"});`,
    to: `      else items.push(mealTail(items, "晚上", (city.name || "") + "#" + i));
     } else items.push(mealTail(items, "晚上", (city.name || "") + "#" + i));`,
  },
  {
    from: `     else items.push({name:"当地美食 + 休整", period:"晚上", note:"用当地味道给这一天收尾"});`,
    to: `     else items.push(mealTail(items, "晚上", (g[0].name || "") + "#" + (g[0].city || "")));`,
  },
];

let cur = s, ok = true;
for (const [k, ed] of edits.entries()) {
  const n = cur.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(ed.from, ed.to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ 收尾填充轮换已写入（4 处）"); }
