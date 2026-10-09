// 收尾填充文案被误当作「景点」：isFrameName 只认 自由活动/当地美食/休整 等少数词，
// 新增的多样化文案（找家本地馆子 + 夜市走走…）没被识别 → 被算进交通动线（routeAdvice 单景点日不再返回 null）、
// 也会出现在地图/时间线的景点序列里。这里补齐餐饮休闲词集（真实景点名几乎不含这些词）。
import fs from "fs";

const F = "tools/_src-backup/travel.js";
let s = fs.readFileSync(F, "utf8");

const TOKEN = "夜市|小吃街|馆子|早点铺|街边摊|烧烤摊|菜市场|家常菜馆|面食小馆|苍蝇馆子|散步|吹风|慢走|闲逛|夜游|溜达|夜灯|拼一顿";

const edits = [
  {
    from: ` return /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选/.test(s);
}
// 详情/简介过滤也一致`,
    to: ` return /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选|${TOKEN}/.test(s);
}
// 详情/简介过滤也一致`,
  },
  {
    from: ` return !/自由活动|自由探索|留白|备选|看日出|下山|休整|凌晨出发|早餐|晚餐|早点休息|美食/.test(s);`,
    to: ` return !/自由活动|自由探索|留白|备选|看日出|下山|休整|凌晨出发|早餐|晚餐|早点休息|美食|${TOKEN}/.test(s);`,
  },
];

let cur = s, ok = true;
for (const [k, ed] of edits.entries()) {
  const n = cur.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(ed.from, ed.to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ isFrameName/isDetailable 词集已补齐"); }
