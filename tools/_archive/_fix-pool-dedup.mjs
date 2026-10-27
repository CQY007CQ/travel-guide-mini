// 行程池语义去重：组合条目（「锦里 + 武侯祠」）与单点条目（「锦里」）同时进池，
// 会让同一景点在一份行程里出现两次（实测 90 处，如上海「外滩」+「外滩万国建筑群 + 陆家嘴三件套」）。
// 池顺序即编辑名次 → 保留靠前那条；用户「指定必玩」的条目一律保留（否则会破坏「只玩勾选的」）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = ` if(pickSpots.length && pickOnly) pool = pool.filter(e=>pickSet.has(e.name));`;
const to = ` if(pickSpots.length && pickOnly) pool = pool.filter(e=>pickSet.has(e.name));
 // v1.19.9 语义去重：池里同时存在「锦里 + 武侯祠」和「锦里」时，一份行程会两次出现同一景点。
 // 池顺序 = 编辑名次，保留靠前的那条；但「指定必玩」的条目不参与去重（用户明确要去的不能删）。
 {
  const _kept = [];
  for(const e of pool){
   if(!e || !e.name) continue;
   if(pickSet.has(e.name)){ _kept.push(e); continue; }
   if(_kept.some(x => x.name !== e.name && spotOverlap(x.name, e.name))) continue;
   _kept.push(e);
  }
  pool = _kept;
 }`;

const n = s.split(from).length - 1;
if (n !== 1) { console.log("✗ 命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(from, to), "utf8");
console.log("✓ 行程池语义去重已写入");
