/**
 * 合并 _hospital-batch6.json 进 utils/emergency-data.js 的 HOSPITALS
 * 去重（同城市同名），按城市 zh 排序重写块，更新「覆盖」计数与扩容溯源注释。
 */
import fs from "fs";

const file = "utils/emergency-data.js";
const src = fs.readFileSync(file, "utf8");

const m = src.match(/const HOSPITALS = (\{[\s\S]*?\n\});/);
if (!m) { console.error("找不到 HOSPITALS 块"); process.exit(1); }
const cur = eval("(" + m[1] + ")");

const good = JSON.parse(fs.readFileSync("tools/_hospital-batch6.json", "utf8")).good;

let added = 0, newCities = 0;
for (const g of good) {
  const arr = cur[g.city] || (cur[g.city] = []);
  if (!cur[g.city].length) newCities++;
  if (cur[g.city].some((x) => x.n === g.n)) continue; // 精确名去重兜底
  cur[g.city].push({ n: g.n, lat: g.lat, lon: g.lon, lv: g.lv, kmc: g.kmc });
  added++;
}

// 每城按距城中心升序（纯几何排序，与 emergency.js 的 hospitalsOf 一致）
for (const c of Object.keys(cur)) cur[c].sort((a, b) => a.kmc - b.kmc);

const cities = Object.keys(cur).sort((a, b) => a.localeCompare(b, "zh"));

function fmtBlock() {
  let s = "const HOSPITALS = {\n";
  cities.forEach((c) => {
    s += '  "' + c + '": [\n';
    cur[c].forEach((h, i) => {
      s += "    { n: \"" + h.n + "\", lat: " + h.lat + ", lon: " + h.lon + ", lv: \"" + h.lv + "\", kmc: " + h.kmc + " }" + (i < cur[c].length - 1 ? "," : "") + "\n";
    });
    s += "  ]" + (c !== cities[cities.length - 1] ? "," : "") + "\n";
  });
  s += "};";
  return s;
}

const newBlock = fmtBlock();
const out = src.replace(/const HOSPITALS = \{[\s\S]*?\n\};/, newBlock);

const cityCount = cities.length;
const hospCount = cities.reduce((a, c) => a + cur[c].length, 0);
const out2 = out
  .replace(
    /覆盖：\d+ 座城市 \/ \d+ 家医院（分批扩充，全部经同一套质量闸门）/,
    `覆盖：${cityCount} 座城市 / ${hospCount} 家医院（分批扩充，全部经同一套质量闸门）`
  )
  .replace(
    /(\*           → 质检闸门（距城中心 ≤25km \/ 名称含医院）→ 合并写入本文件 HOSPITALS)/,
    "$1\n *           · _hospital-batch6.mjs + _hospital-merge6.mjs（第六批：覆盖全量 CITIES ≈751 城，每城 5 家标准公立医院，锚点法）"
  );

fs.writeFileSync(file, out2);
console.log(`合并完成：新增 ${added} 家（其中新城市 ${newCities} 座）→ 现共 ${cityCount} 城 / ${hospCount} 家`);
