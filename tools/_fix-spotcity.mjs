// getSpotCity 的子串误配：用 `spotName.includes(a) || a.includes(spotName)` 全书模糊匹配，
// 于是「西双版纳热带植物园」被贵阳坐标表里一条叫「植物园」的条目命中 → 全省游选云南，
// 第一天却安排「入住贵阳 · 喷水池·甲秀楼」，把云南的景点归到了贵州（跨省）。
// 修法与 bestMatch 一致：模糊匹配改为「一方以另一方开头 + 其后是通用后缀」，命不中就返回 null
// （调用方会回落到省会 capCity，至少保证落在本省）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = `function getSpotCity(spotName){
 if(typeof spotName !== "string" || !spotName) return null;
 if(SPOT_CITY_FIX[spotName]) return SPOT_CITY_FIX[spotName];
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(s[0] === spotName) return cname; }
 }
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(s[0].length>=2 && (spotName.includes(s[0]) || s[0].includes(spotName))) return cname; }
 }
 const libs = [CITY_LANDMARKS, CITY_LANDMARKS_EXTRA, CITY_LANDMARKS_EXTRA2, CITY_LANDMARKS_EXTRA3, CITY_LANDMARKS_EXTRA4, CITY_LANDMARKS_EXTRA5, CITY_LANDMARKS_EXTRA6, CITY_LM_PATCH];
 for(const lib of libs){
  for(const cname in lib){
   const arr = lib[cname] || [];
   if(!Array.isArray(arr)) continue;
   for(const a of arr){
    if(a === spotName) return cname;
    if(typeof a === "string" && a.length>=2 && (spotName.includes(a) || a.includes(spotName))) return cname;
   }
  }
 }
 return null;
}`;

const to = `// v1.19.10：模糊匹配加边界。原来任意子串互相包含，会导致
// 「西双版纳热带植物园」被「植物园」命中而归到贵阳（跨省）。
function _spotCityFuzzy(a, b){
 if(a === b) return true;
 if(typeof a !== "string" || typeof b !== "string") return false;
 const [sh, lg] = a.length <= b.length ? [a, b] : [b, a];
 if(sh.length < 2) return false;
 return lg.indexOf(sh) === 0 && suffixOk(lg.slice(sh.length));
}
function getSpotCity(spotName){
 if(typeof spotName !== "string" || !spotName) return null;
 if(SPOT_CITY_FIX[spotName]) return SPOT_CITY_FIX[spotName];
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(s[0] === spotName) return cname; }
 }
 const libs = [CITY_LANDMARKS, CITY_LANDMARKS_EXTRA, CITY_LANDMARKS_EXTRA2, CITY_LANDMARKS_EXTRA3, CITY_LANDMARKS_EXTRA4, CITY_LANDMARKS_EXTRA5, CITY_LANDMARKS_EXTRA6, CITY_LM_PATCH];
 // 先做一遍全库精确匹配（省地标的正主），再做带边界的模糊匹配
 for(const lib of libs){
  for(const cname in lib){
   const arr = lib[cname] || [];
   if(!Array.isArray(arr)) continue;
   for(const a of arr){ if(a === spotName) return cname; }
  }
 }
 for(const cname in SPOT_COORDS){
  const cl = SPOT_COORDS[cname];
  if(!cl) continue;
  for(const s of cl){ if(_spotCityFuzzy(s[0], spotName)) return cname; }
 }
 for(const lib of libs){
  for(const cname in lib){
   const arr = lib[cname] || [];
   if(!Array.isArray(arr)) continue;
   for(const a of arr){ if(_spotCityFuzzy(a, spotName)) return cname; }
  }
 }
 return null;
}`;

const n = s.split(from).length - 1;
if (n !== 1) { console.log("✗ 命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(from, to), "utf8");
console.log("✓ getSpotCity 模糊匹配已加边界");
