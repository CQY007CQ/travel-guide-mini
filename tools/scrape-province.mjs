// 省级「A级旅游景区名录」官方页面解析器（官方名录 → 规范化导入源）。
// 用法： node tools/scrape-province.mjs <local.html> --province 吉林 [--out tools/_dl/jilin.json]
// 兼容常见表格列：序号 / 景区名称 / 所在地(地址) / 等级（表头自动识别，识别不到时用启发式）。
// 只解析、不联网；抓取由 curl（宿主网络）另行完成。
import fs from "fs";
import zlib from "zlib";
import path from "path";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const provArg = (() => { const i = args.indexOf("--province"); return i >= 0 ? args[i + 1] : ""; })();
const outArg = (() => { const i = args.indexOf("--out"); return i >= 0 ? args[i + 1] : ""; })();
if (!file) { console.error("用法: node tools/scrape-province.mjs <local.html> --province 吉林 [--out x.json]"); process.exit(1); }

// ---- cities ----
// v1.20：数据包已拆到分包（utils/data-packed.js 不再存在，保留兼容回退）
const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const CITY_NAMES = D.CITIES.map(c => c.name);
const provCities = {}; D.CITIES.forEach(c => { const p = c.province || (D.CITY2PROV && D.CITY2PROV[c.name]); if (p) (provCities[p] = provCities[p] || []).push(c.name); });
function normProv(p) { return String(p || "").replace(/(省|市|自治区|维吾尔|壮族|回族|特别行政区)/g, "").trim(); }

const MUNICIPALITIES = ["北京", "上海", "天津", "重庆"];
// 从「所在地」串里找最长的城市名（如 "长春市宽城区" -> 长春；直辖市所在地为区县时兜底到市名）
function cityFromLoc(loc, prov) {
  const np = normProv(prov);
  let best = null;
  const pool = prov ? (provCities[np] || CITY_NAMES) : CITY_NAMES;
  if (loc) {
    for (const cn of pool) if (loc.includes(cn) && (!best || cn.length > best.length)) best = cn;
    if (!best) for (const cn of CITY_NAMES) if (loc.includes(cn) && (!best || cn.length > best.length)) best = cn;
  }
  if (best) return best;
  if (MUNICIPALITIES.includes(np) && CITY_NAMES.includes(np)) return np;
  return null;
}

const html = fs.readFileSync(file, "utf8");
const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
const cellText = tr => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [])
  .map(c => c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());

// 表头定位
let iName = -1, iLoc = -1, iLevel = -1;
for (const tr of rows) {
  const cells = cellText(tr);
  if (cells.length < 3) continue;
  const joined = cells.join("|");
  if (/景区名称|景点名称|名称/.test(joined) && /等级|级别/.test(joined)) {
    cells.forEach((c, i) => {
      if (iName < 0 && /名称/.test(c)) iName = i;
      if (iLoc < 0 && /所在地|地址|城市|所在/.test(c)) iLoc = i;
      if (iLevel < 0 && /等级|级别/.test(c)) iLevel = i;
    });
    break;
  }
}

const LEVEL_RE = /^(?:[1-5]\s*A|[1-5]A|A|[1-5]A级|AAAAA|AAAA|AAA|AA|A)$/i;
const out = [];
let skipped = 0;
for (const tr of rows) {
  const cells = cellText(tr);
  if (cells.length < 3) continue;
  let name, loc, level;
  if (iName >= 0 && iLevel >= 0) {
    name = cells[iName]; loc = iLoc >= 0 ? cells[iLoc] : ""; level = cells[iLevel];
  } else {
    // 启发式：等级 = 匹配 LEVEL_RE 的格；名称 = 最长的非等级非纯数字格；所在地 = 含城市名的格
    const lvIdx = cells.findIndex(c => LEVEL_RE.test(c.replace(/级/g, "")));
    if (lvIdx < 0) continue;
    level = cells[lvIdx];
    const cand = cells.filter((c, i) => i !== lvIdx && !/^\d+$/.test(c));
    const withCity = cand.find(c => cityFromLoc(c, provArg));
    loc = withCity || "";
    name = cand.filter(c => c !== withCity).sort((a, b) => b.length - a.length)[0] || cand[0];
  }
  if (!name || !level || !LEVEL_RE.test(String(level).replace(/级/g, "").trim())) { skipped++; continue; }
  if (!/[\u4e00-\u9fa5]/.test(name)) { skipped++; continue; }
  const city = cityFromLoc(loc, provArg) || cityFromLoc(name, provArg);
  if (!city) { skipped++; continue; }
  out.push({ name: name.trim(), city, province: provArg, level: String(level).replace(/\s|级/g, "").toUpperCase() });
}

const outPath = outArg || path.join("tools", "_dl", "province_" + (provArg || "unknown") + ".json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log("解析行:", rows.length, "| 有效景区:", out.length, "| 跳过:", skipped, "| 表头列 name/loc/level =", iName, iLoc, iLevel);
console.log("写出:", outPath);
const byCity = {}; out.forEach(o => byCity[o.city] = (byCity[o.city] || 0) + 1);
console.log("城市分布:", JSON.stringify(byCity));
