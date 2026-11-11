// 无依赖解析 .xlsx（=zip 内 XML），产出 import-official-list.mjs 的规范化源。
// 用法： node tools/build/xlsx-to-source.mjs <unzipped_dir> --province 广东 [--out x.json]
//   <unzipped_dir> 需含 xl/sharedStrings.xml 与 xl/worksheets/sheet1.xml
// 表头自动识别（景区名称/所在地市/等级）；兼容多 sheet（默认 sheet1）。
import fs from "fs";
import zlib from "zlib";
import path from "path";

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith("--"));
const provArg = (() => { const i = args.indexOf("--province"); return i >= 0 ? args[i + 1] : ""; })();
const sheetArg = (() => { const i = args.indexOf("--sheet"); return i >= 0 ? args[i + 1] : "sheet1.xml"; })();
const outArg = (() => { const i = args.indexOf("--out"); return i >= 0 ? args[i + 1] : ""; })();
if (!dir) { console.error("用法: node tools/build/xlsx-to-source.mjs <unzipped_dir> --province 广东 [--out x.json]"); process.exit(1); }

// ---- cities ----
// v1.20：数据包已拆到分包（utils/data-packed.js 不再存在，保留兼容回退）
const PACKED_PATH = fs.existsSync("subdata/data/data-packed.js") ? "subdata/data/data-packed.js" : "utils/data-packed.js";
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const D = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const CITY_NAMES = D.CITIES.map(c => c.name);
const provCities = {}; D.CITIES.forEach(c => { const p = c.province || (D.CITY2PROV && D.CITY2PROV[c.name]); if (p) (provCities[p] = provCities[p] || []).push(c.name); });
const normProv = p => String(p || "").replace(/(省|市|自治区|维吾尔|壮族|回族|特别行政区)/g, "").trim();
const MUNICIPALITIES = ["北京", "上海", "天津", "重庆"];
function cityFromLoc(loc, prov) {
  const np = normProv(prov); let best = null;
  const pool = prov ? (provCities[np] || CITY_NAMES) : CITY_NAMES;
  if (loc) {
    for (const cn of pool) if (loc.includes(cn) && (!best || cn.length > best.length)) best = cn;
    if (!best) for (const cn of CITY_NAMES) if (loc.includes(cn) && (!best || cn.length > best.length)) best = cn;
  }
  if (best) return best;
  if (MUNICIPALITIES.includes(np) && CITY_NAMES.includes(np)) return np;
  return null;
}

// ---- sharedStrings ----
const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
let shared = [];
const ssPath = path.join(dir, "xl", "sharedStrings.xml");
if (fs.existsSync(ssPath)) {
  const ss = fs.readFileSync(ssPath, "utf8");
  shared = (ss.match(/<si>[\s\S]*?<\/si>/g) || []).map(si =>
    decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, "")).join(""))
  );
}
// ---- sheet ----
const sheetPath = path.join(dir, "xl", "worksheets", sheetArg);
const sheet = fs.readFileSync(sheetPath, "utf8");
const colIdx = ref => { const m = String(ref).match(/^([A-Z]+)/); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const rows = [];
for (const rowXml of (sheet.match(/<row[\s\S]*?<\/row>/g) || [])) {
  const cells = [];
  for (const cXml of (rowXml.match(/<c[\s\S]*?<\/c>|<c[^>]*\/>/g) || [])) {
    const ref = (cXml.match(/r="([A-Z]+\d+)"/) || [])[1];
    const t = (cXml.match(/t="([^"]+)"/) || [])[1];
    const vRaw = (cXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    const isRaw = (cXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
    let val = "";
    if (isRaw != null) val = decode(isRaw);
    else if (vRaw != null) val = t === "s" ? (shared[+vRaw] || "") : decode(vRaw);
    if (ref) cells[colIdx(ref)] = String(val).trim();
  }
  rows.push(cells);
}

// ---- header detect ----
let iName = -1, iLoc = -1, iLevel = -1;
for (let i = 0; i < Math.min(rows.length, 12); i++) {
  const cells = rows[i] || [];
  const joined = cells.join("|");
  if (/景区名称|景点名称|名称/.test(joined) && /等级|级别/.test(joined)) {
    cells.forEach((c, idx) => {
      if (iName < 0 && /名称/.test(c)) iName = idx;
      if (iLoc < 0 && /所在地|地址|城市|所在/.test(c)) iLoc = idx;
      if (iLevel < 0 && /等级|级别/.test(c)) iLevel = idx;
    });
    break;
  }
}
const LEVEL_RE = /^(?:[1-5]\s*A|[1-5]A|A|[1-5]A级|AAAAA|AAAA|AAA|AA)$/i;
const out = []; let skipped = 0;
for (const cells of rows) {
  if (!cells || cells.length < 3) continue;
  let name, loc, level;
  if (iName >= 0 && iLevel >= 0) { name = cells[iName]; loc = iLoc >= 0 ? cells[iLoc] : ""; level = cells[iLevel]; }
  else {
    const lvIdx = cells.findIndex(c => LEVEL_RE.test(String(c).replace(/级/g, "")));
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
  out.push({ name: String(name).trim(), city, province: provArg, level: String(level).replace(/\s|级/g, "").toUpperCase() });
}

const outPath = outArg || path.join("tools", "_dl", "province_" + (provArg || "unknown") + ".json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
const byCity = {}; out.forEach(o => byCity[o.city] = (byCity[o.city] || 0) + 1);
console.log("表格行:", rows.length, "| 有效景区:", out.length, "| 跳过:", skipped, "| 表头 name/loc/level =", iName, iLoc, iLevel);
console.log("写出:", outPath);
console.log("城市分布:", JSON.stringify(byCity));
