// 生成名称精简补丁：只剥「行政区划标记」型冗余前缀（省/市/县/区…），并做碰撞保护
// 输出 tools/v204-name-clean.js（EXP_RENAME）
import fs from "fs"; import zlib from "zlib"; import path from "path";
const root = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/miniprogram-travel";
const raw = fs.readFileSync(path.join(root, "subdata/data/data-packed.js"), "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const base = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
const PV = base.PROVINCE_CITIES || {};
const provOfCity = {};
for (const p in PV) for (const c of PV[p]) provOfCity[c] = p;

const ADMIN = "(?:市|县|区|旗|盟|自治州|自治县|地区|林区|特区)";
// 省名的多种写法：浙江 / 浙江省 / 内蒙古 / 内蒙古自治区 …
const provVars = pv => {
  const v = [pv, pv.replace(/省$/, ""), pv.replace(/自治区$/, ""), pv.replace(/省$/, "") + "省", pv.replace(/自治区$/, "") + "自治区"];
  return Array.from(new Set(v)).filter(x => x.length >= 2).sort((a, b) => b.length - a.length);
};
const cityVars = cn => Array.from(new Set([cn, cn + "市", cn + "县", cn + "区"])).sort((a, b) => b.length - a.length);

function stripOnce(name, cn, pv) {
  const cvs = cityVars(cn), pvs = pv ? provVars(pv) : [];
  // 先剥「城市 + 行政标记」
  for (const cv of cvs) {
    const re = new RegExp("^" + cv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ADMIN);
    if (re.test(name)) {
      const rest = name.replace(re, "");
      if (rest.length >= 3) return rest;
    }
  }
  // 再剥「省份 + 行政标记」（省下辖 writes）
  for (const pv2 of pvs) {
    const re = new RegExp("^" + pv2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:省|自治区)?");
    const m = re.exec(name);
    if (m && name.length - m[0].length >= 3) {
      const rest = name.slice(m[0].length);
      // 只有后面还跟着「城市/乡镇 + 行政标记」这类区划串时才剥（避免把「浙江小九寨」误伤）
      if (new RegExp("^[^，、]{2,6}" + ADMIN).test(rest)) return rest;
    }
  }
  return null;
}

const renames = {};       // 城市名 -> [{from,to}]
let n = 0, skipped = 0, multi = 0;
for (const c of base.CITIES) {
  const cn = c.name, pv = provOfCity[cn] || "";
  const exps = c.experiences || [];
  const existing = new Set(exps.map(e => String((e && (e.name || e.t)) || "")));
  for (const e of exps) {
    if (!e) continue;
    const orig = String(e.name || e.t || "");
    if (!orig) continue;
    let cur = orig, hops = 0;
    while (hops < 3) {
      const nx = stripOnce(cur, cn, pv);
      if (!nx || nx === cur) break;
      cur = nx; hops++;
    }
    if (hops === 0) continue;
    if (cur.length < 2) { skipped++; continue; }
    // 碰撞保护：本市内已存在同名/近同名条目则放弃
    if (existing.has(cur)) { skipped++; continue; }
    const clash = exps.some(x => x && String(x.name || x.t || "") !== orig &&
      String(x.name || x.t || "").replace(/[（(【].*?[)）】]/g, "") === cur);
    if (clash) { skipped++; continue; }
    if (!renames[cn]) renames[cn] = [];
    renames[cn].push({ from: orig, to: cur });
    n++;
    if (hops > 1) multi++;
  }
}
const citiesN = Object.keys(renames).length;
console.log("可安全精简:", n, "| 涉及城市:", citiesN, "| 剥多层:", multi, "| 保护放弃:", skipped);
console.log("样例:");
let shown = 0;
for (const cn in renames) for (const r of renames[cn]) { if (shown++ < 8) console.log("   " + cn + ": " + r.from + "  →  " + r.to); }

// 顺带修：双横线 / 前导括号 / 括号不配对
const extra = [];
for (const c of base.CITIES) for (const e of (c.experiences || [])) {
  if (!e) continue;
  const orig = String(e.name || e.t || "");
  if (!orig) continue;
  let fix = orig;
  if (/--/.test(fix)) fix = fix.replace(/--+/g, "—");
  // 只删「多出来的右括号」，保留配对部分（袁家山（吕祖庙）） → 袁家山（吕祖庙））
  let _op = (fix.match(/[（(【]/g) || []).length, _cl = (fix.match(/[)）】]/g) || []).length;
  while (_cl > _op) { const nx = fix.replace(/[)）】](?=[^)）】]*$)/, ""); if (nx === fix) break; fix = nx; _cl--; }
  if (fix !== orig) extra.push(c.name + ": " + orig + " → " + fix);
}
console.log("额外修正:", extra.length);
extra.slice(0, 8).forEach(x => console.log("   " + x));

const body = `// v204 · 景点显示名精简（全自动生成，勿手改）
// 规则：只剥离「行政区划标记」型冗余前缀（省/市/县/区/自治州…），保留景点真名（广州塔→不会变成「塔」）。
// 保护：目标名在本市已存在 / 会产生近似重名时放弃该条；改名的同时同步改 SPOT_COORDS 的键（否则丢坐标）。
// 生成：tools/_gen-name-clean.mjs
const EXP_RENAME = ${JSON.stringify(renames, null, 2)};

// 附带修：双横线 / 多余括号
const NAME_FIX = ${JSON.stringify(Object.fromEntries(extra.map(s => { const i = s.indexOf(": "); const cn = s.slice(0, i); const rest = s.slice(i + 2); const [a, b] = rest.split(" → "); return [cn + "|" + a, b]; })), null, 2)};

module.exports = { EXP_RENAME, NAME_FIX };
`;
fs.writeFileSync(path.join(root, "tools/v204-name-clean.js"), body);
console.log("已写 tools/v204-name-clean.js");
