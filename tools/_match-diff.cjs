// 按关键词统计「收紧后保留/失去」，确认主景点不会整体失配。
global.wx = { getStorageSync: () => "", setStorageSync: () => {}, removeStorageSync: () => {} };
const T = require("../utils/travel.js");
const D = T.D;

const SUFFIX_WORDS = ["风景区","风景名胜区","国家级风景名胜区","旅游景区","旅游区","景区","核心景区","国家森林公园","森林公园","公园","遗址公园","冰川公园","山","索道","索道站","索道上站","索道下站","大门","入口","游客中心","自然保护区","国家级自然保护区","地质公园","世界地质公园","国家地质公园","博物馆","博物院","遗址","古镇","乐园","度假区","旅游度假区","小镇","世界","中心","数字展示中心","野生动物世界","欢乐世界","大峡谷","剧场","温泉城","滑雪场"];
const SW = new Set(SUFFIX_WORDS);
function suffixOk(post) {
  if (!post) return true;
  return post.split(/[／\/＋+、·，,]/).every(p => SW.has(p.trim()));
}
function newMatch(name, list) {
  if (["九华山公园", "沈阳故宫", "明故宫", "长城炮", "长城岭"].some(x => name.indexOf(x) >= 0)) return null;
  let best = null, bl = 0;
  for (const b of list) { if (!b || !Array.isArray(b.kw)) continue;
    for (const kw of b.kw) { if (typeof kw !== "string") continue;
      const at = name.indexOf(kw); if (at < 0) continue;
      const pre = name.slice(0, at), post = name.slice(at + kw.length);
      if (!suffixOk(post)) continue;
      if (kw.charAt(kw.length - 1) === "山" && pre !== "" && !/[+＋\/、·,，和&＆（(\s]$/.test(pre)) continue;
      if (kw.length > bl) { best = b; bl = kw.length; } } }
  return best;
}
function oldMatch(name, list) {
  let best = null, bl = 0;
  for (const b of list) { if (!b || !Array.isArray(b.kw)) continue;
    for (const kw of b.kw) { if (typeof kw !== "string") continue;
      if (name.indexOf(kw) >= 0 && kw.length > bl) { best = b; bl = kw.length; } } }
  return best;
}
const names = [];
const seen = new Set();
D.CITIES.forEach(c => (c.experiences || []).forEach(e => { const n = e && e.name; if (typeof n === "string" && !seen.has(n)) { seen.add(n); names.push(n); } }));

for (const [label, list] of [["BIG", D.BIG_SPOT_DAYS || []], ["SUN", D.SUNRISE_SPOTS || []]]) {
  console.log("===== " + label + " =====");
  for (const b of list) {
    const kw = (b.kw || [])[0];
    let keep = 0, lose = 0; const loseEx = [];
    for (const nm of names) {
      const o = oldMatch(nm, [b]), n = newMatch(nm, [b]);
      if (o && n) keep++;
      else if (o && !n) { lose++; if (loseEx.length < 3) loseEx.push(nm); }
    }
    const flag = keep === 0 && lose > 0 ? "  ⚠️全失" : "";
    console.log("  kw=" + kw + "  保留 " + keep + " / 失去 " + lose + flag + (lose ? "  例: " + loseEx.join("、") : ""));
  }
}
