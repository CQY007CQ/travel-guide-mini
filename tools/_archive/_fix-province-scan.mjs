// 省域扫描（全省游）里「同名景点该取哪座城」的判定修正。
// 现象：P.getSpotCoord("辽宁","劳动公园") 返回大连的坐标，而辽宁省内真正带通用名「劳动公园」的是朝阳市；
// 跨城重名护栏因此挂。原因：大连在 PROVINCE_CITIES 里排在朝阳之前，而大连既有更具体的
// 「大连劳动公园」(SPOT_COORDS)，又有一条通用「劳动公园」(COORD_PATCH) —— 通用条先命中。
// 修法：省域精确扫描时，把「同城内还存在更长更具体写法」的条目降级为兜底，优先返回真正的通用名城市；
//       若全省都没有更干净的匹配，再回落到该兜底（不丢失覆盖）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = `   const scanPv = (fuzzy) => {
    for(const cname of pv){
     const l = (SPOT_COORDS[cname] || []).concat(COORD_PATCH[cname] || []);
     for(const s of l){
      if(fuzzy ? (s[0].length>=2 && (spotName.includes(s[0]) || s[0].includes(spotName))) : s[0] === spotName)
       return {lat:s[1], lon:s[2], approx:false};
     }
    }
    return null;
   };`;

const to = `   const scanPv = (fuzzy) => {
    // v1.19.9：同城内若还存在「更长更具体」的同源名字（大连劳动公园 vs 劳动公园），
    // 说明当前命中项是通用名，先记为兜底继续扫其他城市，避免它抢在真正通用名的城市（朝阳）之前命中。
    let loose = null;
    for(const cname of pv){
     const l = (SPOT_COORDS[cname] || []).concat(COORD_PATCH[cname] || []);
     for(const s of l){
      if(fuzzy ? (s[0].length>=2 && (spotName.includes(s[0]) || s[0].includes(spotName))) : s[0] === spotName){
       const generic = !fuzzy && l.some(o => o !== s && o[0] && o[0].length > s[0].length && o[0].indexOf(s[0]) >= 0);
       if(generic){ if(!loose) loose = {lat:s[1], lon:s[2], approx:false}; continue; }
       return {lat:s[1], lon:s[2], approx:false};
      }
     }
    }
    return loose;
   };`;

const n = s.split(from).length - 1;
if (n !== 1) { console.log("✗ 命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(from, to), "utf8");
console.log("✓ 省域扫描同名判定已修正");
