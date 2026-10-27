import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const D = req("./utils/data.js");
const out = T.buildPlan({ city: "成都", days: 5, depart: "2026-10-01", budget: "mid", pace: "balanced", people: 2 });
const ORDER = {"凌晨":-1,"早上":0,"清晨":0,"上午":1,"下午":2,"傍晚":3,"晚上":4,"深夜":5,"夜间":5,"全天":6};
out.forEach((d, i) => {
  console.log(`\n=== D${i+1} (${d.date}) ${d.theme} ===`);
  d.items.forEach(it => console.log(`  [${it.period}] ${it.name}`));
  let prev = -99;
  d.items.forEach(it => {
    const r = ORDER[it.period] != null ? ORDER[it.period] : 99;
    if (r < prev) console.log(`  >>> 倒序: ${prev} -> ${r} (${it.name})`);
    prev = r;
  });
});
