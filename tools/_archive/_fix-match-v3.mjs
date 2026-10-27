// 收紧第二轮：① 扫描关键词的「所有」出现位置（原来只取第一次，泰山区泰山方特欢乐世界因此漏网）；
// ② 后缀里允许的专名前缀从 8 字收到 3 字（「区泰山方特欢乐」这种长前缀不再算通用后缀）。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const edits = [
  {
    from: `   const at = name.indexOf(kw);
   if(at < 0) continue;
   if(!suffixOk(name.slice(at + kw.length))) continue;
   if(kw.charAt(kw.length - 1) === "山" && !prefixOk(name.slice(0, at))) continue;
   if(kw.length > bestLen){ best = b; bestLen = kw.length; }`,
    to: `   let at = name.indexOf(kw);
   if(at < 0) continue;
   const isMt = kw.charAt(kw.length - 1) === "山";
   let hit = false;
   for(let from = 0; ; from = at + 1){
    at = name.indexOf(kw, from);
    if(at < 0) break;
    if(suffixOk(name.slice(at + kw.length)) && (!isMt || prefixOk(name.slice(0, at)))) { hit = true; break; }
   }
   if(!hit) continue;
   if(kw.length > bestLen){ best = b; bestLen = kw.length; }`,
  },
  {
    from: `  return /^[\\u4e00-\\u9fa5A-Za-z0-9]{0,8}?(风景名胜区|`,
    to: `  return /^[\\u4e00-\\u9fa5A-Za-z0-9]{0,3}?(风景名胜区|`,
  },
];

let cur = s, ok = true;
for (const [k, ed] of edits.entries()) {
  const n = cur.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
  cur = cur.replace(ed.from, ed.to);
}
if (ok) { fs.writeFileSync(F, cur, "utf8"); console.log("✓ 二轮收紧已写入"); }
