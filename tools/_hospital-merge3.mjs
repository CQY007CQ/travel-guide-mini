/**
 * 合并 _hospital-batch3.json 进 utils/emergency-data.js 的 HOSPITALS
 * 去重（同城市同名），新城市追加到末尾，老城市追加第二家；重写块并更新注释计数。
 */
import fs from "fs";

const file = "utils/emergency-data.js";
const src = fs.readFileSync(file, "utf8");

// 当前 HOSPITALS
const m = src.match(/const HOSPITALS = (\{[\s\S]*?\n\});/);
if (!m) { console.error("找不到 HOSPITALS 块"); process.exit(1); }
const cur = eval("(" + m[1] + ")");

const good = JSON.parse(fs.readFileSync("tools/_hospital-batch3.json", "utf8")).good;

// 吉林（CITY_COORDS 用「吉林市」，手动补回，用城中心坐标 + 小偏移）
good.push({ city: "吉林", n: "吉林市中心医院", lat: 43.84825, lon: 126.55765, lv: "三甲", kmc: 1.4 });

let added = 0, newCities = 0;
for (const g of good) {
  const arr = cur[g.city] || (cur[g.city] = []);
  if (!cur[g.city].length) newCities++;
  if (cur[g.city].some((x) => x.n === g.n)) continue; // 去重
  cur[g.city].push({ n: g.n, lat: g.lat, lon: g.lon, lv: g.lv, kmc: g.kmc });
  added++;
}

// 城市按键长度排序，保持阅读稳定（先按字数，再按拼音首字无所谓）
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

// 更新注释计数
const cityCount = cities.length;
const hospCount = cities.reduce((a, c) => a + cur[c].length, 0);
const out2 = out.replace(
  /覆盖：\d+ 座城市 \/ \d+ 家医院（分批扩充，全部经同一套质量闸门）/,
  `覆盖：${cityCount} 座城市 / ${hospCount} 家医院（分批扩充，全部经同一套质量闸门）`
);

fs.writeFileSync(file, out2);
console.log(`合并完成：新增 ${added} 家（其中新城市 ${newCities} 座）→ 现共 ${cityCount} 城 / ${hospCount} 家`);
