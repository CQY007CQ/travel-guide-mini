// 收尾填充文案：压测护栏要求「同一行程内不得出现重复景点名」，所以轮换必须保证
// ① 同一天不重复（seq 错开）② 跨天不重复（按天线性推进）。用 16 条文案池 + 索引
// (城市奇偶) + 天*2 + seq，在 7 天以内索引两两不同。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = `const MEAL_TAILS = [
 { name: "当地美食 + 自由活动", note: "用当地味道给这一天收尾" },
 { name: "找家本地馆子 + 夜市走走", note: "避开景区餐厅，往居民区钻更地道" },
 { name: "去小吃街扫街 + 慢慢逛", note: "边走边吃，别一次点太多" },
 { name: "本地味道 + 散步消食", note: "吃完沿街走一段，顺便看看夜景" },
];
function mealTail(itemsArr, period, seed){
 let h = 0; const seedStr = String(seed || "");
 for (let k = 0; k < seedStr.length; k++) h = (h * 31 + seedStr.charCodeAt(k)) >>> 0;
 // 按当天已出现的填充项总数（不按时段）计数，避免「傍晚」和「晚上」各推一条时选中同一句
 const seq = (itemsArr || []).filter(x => x && MEAL_TAILS.some(t => t.name === x.name)).length;
 const t = MEAL_TAILS[(h + seq) % MEAL_TAILS.length];
 return { name: t.name, period, note: t.note };
}`;

const to = `const MEAL_TAILS = [
 { name: "当地美食 + 自由活动", note: "用当地味道给这一天收尾" },
 { name: "找家本地馆子 + 夜市走走", note: "避开景区餐厅，往居民区钻更地道" },
 { name: "去小吃街扫街 + 慢慢逛", note: "边走边吃，别一次点太多" },
 { name: "本地味道 + 散步消食", note: "吃完沿街走一段，顺便看看夜景" },
 { name: "老字号晚餐 + 街头溜达", note: "挑本地人排队的店，通常不踩雷" },
 { name: "菜市场小吃 + 巷子闲逛", note: "傍晚的菜市场最能看出当地日常" },
 { name: "巷子里的馆子 + 夜游", note: "离主街越远，价格越实在" },
 { name: "本地小吃拼一顿 + 慢走", note: "多尝几样，别一次吃饱" },
 { name: "街边摊 + 江边吹风", note: "简单一顿，把时间留给散步" },
 { name: "特色早点铺 + 逛老街", note: "早点铺往往比正餐更有地方味" },
 { name: "本地馆子晚餐 + 早回酒店", note: "走了一天，今晚早点休息" },
 { name: "苍蝇馆子 + 夜市转转", note: "本地人常去的小店，性价比高" },
 { name: "火锅汤锅一顿 + 散步", note: "吃完沿街走一段再回住处" },
 { name: "面食小馆 + 老街夜灯", note: "小馆子出餐快，适合玩累的晚上" },
 { name: "烧烤摊 + 沿街走一段", note: "夜宵摊位往往藏着本地口味" },
 { name: "家常菜馆 + 街区慢逛", note: "点两个本地家常菜，慢慢吃完" },
];
// dayNo：行程第几天（0 起）；citySeed：城市名/省名，用于同城错开
function mealTail(itemsArr, period, dayNo, citySeed){
 let h = 0; const seedStr = String(citySeed || "");
 for (let k = 0; k < seedStr.length; k++) h = (h * 31 + seedStr.charCodeAt(k)) >>> 0;
 // seq：当天已出现的填充项条数（不按时段），保证同日内两条选到不同文案
 const seq = (itemsArr || []).filter(x => x && MEAL_TAILS.some(t => t.name === x.name)).length;
 const day = Math.max(0, Math.min(7, Number(dayNo) || 0));
 // 索引 = 城市奇偶 + 天*2 + seq：同日内不重复、跨天不重复
 const t = MEAL_TAILS[((h % 2) + day * 2 + Math.min(seq, 1)) % MEAL_TAILS.length];
 return { name: t.name, period, note: t.note };
}`;

const calls = [
  [`` + `      items.push(mealTail(items, "傍晚", (city.name || "") + "#" + i));`,
   `      items.push(mealTail(items, "傍晚", i, city.name));`],
  [`      else items.push(mealTail(items, "晚上", (city.name || "") + "#" + i));
     } else items.push(mealTail(items, "晚上", (city.name || "") + "#" + i));`,
   `      else items.push(mealTail(items, "晚上", i, city.name));
     } else items.push(mealTail(items, "晚上", i, city.name));`],
  [`     else items.push(mealTail(items, "晚上", (g[0].name || "") + "#" + (g[0].city || "")));`,
   `     else items.push(mealTail(items, "晚上", i, province));`],
];

const edits = [{ from, to }, ...calls.map(([f, t]) => ({ from: f, to: t }))];
let cur = s, ok = true;
for (const [k, ed] of edits.entries()) {
  const n = cur.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(ed.from, ed.to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ 收尾文案池扩到 16 条 + 跨天不重复"); }
