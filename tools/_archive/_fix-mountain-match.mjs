// 修复「山名关键词子串误配」：keyword 表里 华山/泰山/黄山风景区/峨眉山… 用全书 indexOf 匹配，
// 于是「青华山旅游景区」「翠华山」「南华山」「西泰山景区」全都命中华山/泰山，
// 被当成「日出名山」生成「入住山顶酒店 + 凌晨看日出」——西安 3 天行程曾整条变成秦岭登山游。
// 已有 BIG_EXCLUDE=["南华山"] 是逐个打补丁，这里改成通用规则：
//   以「山」结尾的关键词，只有在「名称开头」或「前一字符是分隔符」时才算命中。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const edits = [
  {
    from: `function bestMatch(name, list){
 if(!Array.isArray(list) || typeof name !== "string" || !name) return null;
 let best = null, bestLen = 0;
 for(const b of list){
  if(!b || !Array.isArray(b.kw)) continue;
  for(const kw of b.kw){
   if(typeof kw !== "string") continue;
   if(name.indexOf(kw) >= 0 && kw.length > bestLen){ best = b; bestLen = kw.length; }
  }
 }
 return best;
}`,
    to: `function bestMatch(name, list){
 if(!Array.isArray(list) || typeof name !== "string" || !name) return null;
 // 同名不同地的残余个例（通用规则拦不住的，逐个列出）
 if(MATCH_DENY.some(x => name.indexOf(x) >= 0)) return null;
 let best = null, bestLen = 0;
 for(const b of list){
  if(!b || !Array.isArray(b.kw)) continue;
  for(const kw of b.kw){
   if(typeof kw !== "string") continue;
   const at = name.indexOf(kw);
   if(at < 0) continue;
   // 山名类关键词防误配：「青华山/翠华山/南华山/少华山」都含「华山」但不是华山，
   // 「西泰山景区」含「泰山」但不是泰山。要求命中在名称开头，或前一字符是分隔符
   // （如「陕西·华山」「华山/西峰」）。长城/迪士尼/长隆 这类通名不受影响。
   if(kw.charAt(kw.length - 1) === "山" && at > 0){
    const prev = name.charAt(at - 1);
    if(!/[+＋\\/、·,，和&＆（(·\\-—\\s]/.test(prev)) continue;
   }
   if(kw.length > bestLen){ best = b; bestLen = kw.length; }
  }
 }
 return best;
}
// 「同名不同地」黑名单（bestMatch 通用规则之外的残余）
const MATCH_DENY = ["九华山公园"];`,
  },
];

let ok = true;
for (const [k, ed] of edits.entries()) {
  const n = s.split(ed.from).length - 1;
  if (n !== 1) { console.log("✗ 第" + (k + 1) + " 处命中 " + n + " 次，放弃"); ok = false; break; }
}
if (ok) {
  for (const ed of edits) s = s.replace(ed.from, ed.to);
  fs.writeFileSync(F, s, "utf8");
  console.log("✓ bestMatch 山名防误配已写入");
}
