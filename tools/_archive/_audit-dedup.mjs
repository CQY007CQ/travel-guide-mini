import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const D = req("./utils/data.js");

const out = {};
// 1. CITIES 重名/重 id
const seenId = {}, seenName = {};
let dupId = 0, dupName = 0;
for (const c of D.CITIES || []) {
  if (!c) continue;
  if (seenId[c.id]) dupId++; if (seenName[c.name]) dupName++;
  seenId[c.id] = 1; seenName[c.name] = 1;
}
out.CITIES = { dupId, dupName, total: (D.CITIES||[]).length };

// 2. SPOT_COORDS 同城重名
let spotIntra = 0, spotIntraEx = [];
for (const [city, list] of Object.entries(D.SPOT_COORDS || {})) {
  if (!Array.isArray(list)) continue;
  const seen = {};
  for (const s of list) {
    if (!Array.isArray(s)) continue;
    const nm = s[0];
    if (seen[nm]) { spotIntra++; if (spotIntraEx.length < 15) spotIntraEx.push(`${city}/${nm}`); }
    seen[nm] = 1;
  }
}
out.SPOT_INTRA = { dup: spotIntra, sample: spotIntraEx };

// 3. FOOD_SPOTS 同城重店
let foodIntra = 0, foodEx = [];
for (const [city, v] of Object.entries(D.FOOD_SPOTS || {})) {
  const shops = Array.isArray(v) ? v : (v && v.shops) || [];
  const seen = {};
  for (const s of shops) {
    const nm = s.shop || s.name;
    if (seen[nm]) { foodIntra++; if (foodEx.length < 15) foodEx.push(`${city}/${nm}`); }
    seen[nm] = 1;
  }
}
out.FOOD_INTRA = { dup: foodIntra, sample: foodEx };

// 4. HOTEL_AREAS 同城重片区
let haIntra = 0, haEx = [];
for (const [city, arr] of Object.entries(D.HOTEL_AREAS || {})) {
  if (!Array.isArray(arr)) continue;
  const seen = {};
  for (const a of arr) {
    const nm = a && a.name;
    if (seen[nm]) { haIntra++; if (haEx.length < 15) haEx.push(`${city}/${nm}`); }
    seen[nm] = 1;
  }
}
out.HOTEL_INTRA = { dup: haIntra, sample: haEx };

// 5. CITY_COORDS 同名(含 id) 同坐标
const cc = D.CITY_COORDS || {};
const byCoord = {};
let ccDup = 0;
for (const [k, v] of Object.entries(cc)) {
  if (!Array.isArray(v)) continue;
  const key = v.map(x => Math.round(x*10)/10).join(",");
  (byCoord[key] ||= []).push(k);
}
for (const [k, arr] of Object.entries(byCoord)) if (arr.length > 1) ccDup++;
out.CC_SAME_COORD_GROUPS = ccDup;

console.log(JSON.stringify(out, null, 2));
