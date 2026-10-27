// 关键词匹配收紧·最终版：把「全书 indexOf」换成「后缀白名单 + 山名前缀约束」。
import fs from "fs";

const F = "tools/_src-backup/planner.js";
let s = fs.readFileSync(F, "utf8");

const from = `function bestMatch(name, list){
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
const MATCH_DENY = ["九华山公园"];`;

const to = `function bestMatch(name, list){
 if(!Array.isArray(list) || typeof name !== "string" || !name) return null;
 if(MATCH_DENY.some(x => name.indexOf(x) >= 0)) return null;
 let best = null, bestLen = 0;
 for(const b of list){
  if(!b || !Array.isArray(b.kw)) continue;
  for(const kw of b.kw){
   if(typeof kw !== "string") continue;
   const at = name.indexOf(kw);
   if(at < 0) continue;
   if(!suffixOk(name.slice(at + kw.length))) continue;
   if(kw.charAt(kw.length - 1) === "山" && !prefixOk(name.slice(0, at))) continue;
   if(kw.length > bestLen){ best = b; bestLen = kw.length; }
  }
 }
 return best;
}
// v1.19.9 关键词匹配收紧。keyword 表存的是「具体景区名」，但原来用全书 indexOf 匹配，于是
// 「青华山/翠华山/华山国际乡村俱乐部」「泰山区泰山方特欢乐世界」「齐长城百果园」「沈阳故宫」
// 全被误配上对应景区的「日出/大景点专线」数据 —— 真实用户会拿到「在青岛看华山日出、住山顶酒店」。
// 规则①：关键词之后只能是通用后缀（景区/公园/索道/博物馆…，可用 / 、 + 连接多段），
//        或「（…）」式说明；否则视为另一个地方。
function suffixOk(post){
 if(!post) return true;
 if(/^（[^）]{1,10}）$/.test(post)) return true;
 return post.split(/[／\\/＋+、·，,－—-]/).every(seg => {
  const t = seg.trim();
  if(!t) return true;
  return /^[\\u4e00-\\u9fa5A-Za-z0-9]{0,8}?(风景名胜区|旅游景区|旅游区|景区|国家森林公园|森林公园|公园|地质公园|博物馆|博物院|遗址|古镇|乐园|度假区|小镇|王国|世界|中心|索道站|索道|大门|入口|游客中心|大峡谷|剧场|滑雪场|冰川公园|天池|湖|岛|沟|前山|后山|山)$/.test(t);
 });
}
// 规则②：以「山」结尾的关键词（华山/泰山/衡山…）要求前缀为空、以分隔符结尾，
//        或「南岳/张家界」这类同山前缀。「青华山/翠华山/南华山」「莱芜华山国家森林公园」
//        「泰山区泰山方特欢乐世界」「西泰山景区」因此不再误配。
function prefixOk(pre){
 if(!pre) return true;
 if(/[+＋\\/、·,，和&＆（(\\s]$/.test(pre)) return true;
 return /^(南岳|北岳|东岳|西岳|中岳|张家界)$/.test(pre);
}
// 「同名不同地」黑名单（通用规则之外的残余个例）
const MATCH_DENY = ["九华山公园", "沈阳故宫", "明故宫", "长城炮", "长城岭"];`;

const n = s.split(from).length - 1;
if (n !== 1) { console.log("✗ 命中 " + n + " 次，放弃"); process.exit(1); }
fs.writeFileSync(F, s.replace(from, to), "utf8");
console.log("✓ bestMatch 收紧规则已写入");
