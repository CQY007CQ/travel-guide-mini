// 从 HTML vm 沙箱中按引用链自动提取核心算法函数 → 小程序 utils/planner.js
// 思路: 每个函数 fn.toString() 拿源码 → 正则找它引用的函数名 → 递归收集（BFS）
// 顶层被引用的数据常量从 data.js require（数据已单独导出）
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const HTML = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/旅游攻略生成器.html";
const OUT = process.argv[2] || "./utils/planner.js";
const ENTRY = (process.argv[3] || "buildPlanDays,countPlanStats,relaxDetail,relaxIndex,spotDetailCore,spotHours,bigSpotInfo,getSpotCoord,haversine,getCoord,resolveBudget,buildProvinceCity,buildProvincePlanDays,spotEffort,cleanSpotName,uriEnc,budgetStyleOf,tierOfPerDay,budgetTierKey,shopBand,budgetMealText,budgetFoodDaily,rangePair")
  .split(",").map(s => s.trim()).filter(Boolean);

const html = fs.readFileSync(HTML, "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mkEl = () => ({ value:"", textContent:"", innerHTML:"", style:{}, className:"", options:[],
  addEventListener(){}, appendChild(){}, remove(){}, scrollTop:0, scrollHeight:0, scrollIntoView(){},
  select(){}, focus(){}, checked:true, click(){}, download:"", href:"", title:"", disabled:false });
const els = {};
const store = {};
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
  parseInt, parseFloat, isNaN, RegExp, String, Number, Array, Object, Boolean, Set, Map,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k,v)=>{store[k]=String(v);}, removeItem: k=>{delete store[k];} },
  document: { getElementById: id => (els[id] = els[id] || mkEl()), createElement: () => mkEl(),
    querySelectorAll: () => [], querySelector: () => null, addEventListener(){}, body:{appendChild(){},removeChild(){}} },
  window: { addEventListener(){}, __plan:null, __wxMap:{} }, alert:()=>{}, confirm:()=>true, prompt:()=>"",
  fetch: () => Promise.reject(new Error("net")), navigator:{onLine:true},
  location:{href:"",search:""}, L: {}, requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{},
  speechSynthesis: undefined, SpeechSynthesisUtterance: function(){}, Notification: undefined,
  Blob: function(){}, URL: {}
});
vm.runInContext(scripts.join("\n"), ctx, { timeout: 60000 });

const isFn = n => { try{ return vm.runInContext(`typeof ${n}`, ctx) === "function"; }catch(e){ return false; } };
const srcOf = n => {
  try{
    const s = vm.runInContext(`${n}.toString()`, ctx);
    // 过滤内建对象（Set/Map/String/Number… 的 toString 是 [native code]，写进模块会语法错误）
    if(typeof s !== "string" || s.includes("[native code]")) return null;
    return s;
  }catch(e){ return null; }
};

// BFS 收集闭包
const seen = new Set(), queue = [...ENTRY];
const refRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
while(queue.length){
  const fn = queue.shift();
  if(seen.has(fn)) continue;
  const src = srcOf(fn);
  if(!src) continue;
  seen.add(fn);
  let m;
  refRe.lastIndex = 0;
  while((m = refRe.exec(src))){
    const r = m[1];
    if(!seen.has(r) && isFn(r) && !queue.includes(r)) queue.push(r);
  }
}
// 扫描被引用的数据常量（从 data.js 解构）
const DATA_ALL = (function(){
  try{
    const dFile = path.resolve(path.dirname(OUT), "data.js");
    return Object.keys(require(dFile));
  }catch(e){ console.error("读 data.js 失败: " + e.message); return []; }
})();
const usedData = new Set();
for(const fn of seen){
  const src = srcOf(fn) || "";
  DATA_ALL.forEach(dn => { if(src.includes(dn)) usedData.add(dn); });
}

// 组装模块
const funcParts = [];
for(const fn of seen){
  let src = srcOf(fn);
  // 去掉 async 前缀保持原样即可
  funcParts.push(src);
}
const dataReq = [...usedData].sort();
const header = `// 由 tools/extract-planner.mjs 自动生成：从「旅游攻略生成器.html」vm 沙箱按引用链提取，勿手改。
const { ${dataReq.join(", ")} } = require("./data.js");

`;
const footer = `\nmodule.exports = { ${[...seen].sort().join(", ")} };\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + funcParts.join("\n\n") + footer, "utf8");
console.log("已提取 " + seen.size + " 个函数 → " + OUT + " (" + (funcParts.join("").length/1024).toFixed(0) + " KB)");
console.log("引用数据常量 " + dataReq.length + " 个: " + dataReq.join(" "));
console.log("导出: " + [...seen].length + " 个");
