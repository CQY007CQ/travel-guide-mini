// 生成 v198-landmark-dedup.js：清除 experiences 内「清洗名相同」的近重名条目。
// 原因：把地标池转正进 experiences 时，部分库里带括号的写法（纯阳宫（山西省艺术博物馆））
// 与基础名（纯阳宫）清洗名相同，planner 按清洗名去重会把它们当成同一景点跨天重复排进行程。
// 策略：每个清洗名组只保留 1 条（优先「裸名/最短」），其余全部 EXP_REMOVE。
// 注意 merge 的 EXP_REMOVE 每次只删一个同名出现，故同一字符串重复 N 次要列 N-1 次。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");

const clean = n => T.cleanSpotName(n);
const EXP_REMOVE = {};
let removed = 0, collCities = 0;

for (const c of D.CITIES) {
  const exps = (c.experiences || []).map(e => (typeof e === "string" ? e : e.name)).filter(Boolean);
  // 按清洗名分组
  const groups = new Map();
  exps.forEach(n => { const k = clean(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
  // 选定每组的保留名：优先「清洗名==原名」（裸名），其次最短
  const keepName = {};
  for (const [k, arr] of groups) {
    const canon = arr.filter(n => clean(n) === n);
    keepName[k] = canon.length ? canon.slice().sort((a, b) => a.length - b.length)[0]
                               : arr.slice().sort((a, b) => a.length - b.length)[0];
  }
  // 每种保留名只允许保留 1 个出现；其余全部移除
  const budget = {};
  for (const k of groups.keys()) budget[keepName[k]] = (budget[keepName[k]] || 0) + 1;
  exps.forEach(n => {
    const k = clean(n);
    if (keepName[k] === n && (budget[n] || 0) > 0) { budget[n]--; return; } // 保留这一条
    EXP_REMOVE[c.name] = EXP_REMOVE[c.name] || [];
    EXP_REMOVE[c.name].push(n);
    removed++;
  });
  if (EXP_REMOVE[c.name]) collCities++;
}
for (const k of Object.keys(EXP_REMOVE)) if (!EXP_REMOVE[k].length) delete EXP_REMOVE[k];

const out = "// 自动生成：清除 experiences 内清洗名相同的近重名（纯阳宫 vs 纯阳宫（山西省艺术博物馆）等）\n// 避免 planner 按清洗名去重时同一景点跨天重复。每个清洗名组仅留 1 条。\nmodule.exports = {\n  EXP_REMOVE: " + JSON.stringify(EXP_REMOVE, null, 1) + "\n};\n";
fs.writeFileSync(path.join(process.cwd(), "tools", "v198-landmark-dedup.js"), out);
console.log("生成 v198-landmark-dedup.js：移除近重名条目", removed, "覆盖城", collCities);
