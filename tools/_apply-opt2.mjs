// v1.19.8 优化批次 2：缓存运行期不变的城市列表，避免每次调用全量 filter 420 城。
// 教训（批次1）：不要引入可能与已有变量重名的常量。这里用独立的 _namedCitiesCache，
// 且缓存的是「含 name 的城市」列表，数据加载后不再变化，安全。
import fs from "fs";

const file = "tools/_src-backup/travel.js";
let s = fs.readFileSync(file, "utf8");

const edits = [
  {
    from: `function provinces() { return (Array.isArray(D.PROVINCES) ? D.PROVINCES : []).slice(); }`,
    to: `function provinces() { return (Array.isArray(D.PROVINCES) ? D.PROVINCES : []).slice(); }

// v1.19.8：城市列表在运行期不变，但 inspire/inspirePicks 等每次调用都会对全部 420 城
// 做一次 filter+map。这里缓存一次，后续直接复用（数据量约 420，省的是重复遍历开销）。
let _namedCitiesCache = null;
function namedCities() {
  if (_namedCitiesCache) return _namedCitiesCache;
  _namedCitiesCache = (Array.isArray(D.CITIES) ? D.CITIES : []).filter(c => c && c.name);
  return _namedCitiesCache;
}`,
    why: "新增 namedCities() 城市列表缓存"
  },
  {
    from: `  const list = (Array.isArray(D.CITIES) ? D.CITIES : []).filter(c => c.name);`,
    to: `  const list = namedCities();`,
    why: "inspire() 复用缓存"
  },
  {
    from: `  const list = (Array.isArray(D.CITIES) ? D.CITIES : []).filter(c => c && c.name);`,
    to: `  const list = namedCities();`,
    why: "inspirePicks() 复用缓存"
  }
];

let ok = 0, skip = 0;
for (const e of edits) {
  const n = s.split(e.from).length - 1;
  if (n !== 1) { console.log(`命中 ${n} 次(期望1) → 跳过: ${e.why}`); skip++; continue; }
  s = s.replace(e.from, e.to);
  console.log("✓", e.why);
  ok++;
}
fs.writeFileSync(file, s, "utf8");
console.log(`\n批次2 完成：${ok} 处成功，${skip} 处跳过`);
process.exit(skip > 0 ? 1 : 0);
