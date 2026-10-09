// 从单文件 HTML（vm 运行时）导出数据常量 → 小程序 utils/data.js
// 用法: node export-data.mjs   (在 miniprogram-travel 目录执行，或指定输出路径)
import fs from "fs";
import path from "path";
import vm from "vm";

const HTML = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/旅游攻略生成器.html";
const OUT = process.argv[2] || "./utils/data.js";

const html = fs.readFileSync(HTML, "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const mkEl = () => ({ value:"", textContent:"", innerHTML:"", style:{}, className:"", options:[],
  addEventListener(){}, appendChild(){}, remove(){}, scrollTop:0, scrollHeight:0, scrollIntoView(){},
  select(){}, focus(){}, checked:true, click(){}, download:"", href:"", title:"", disabled:false });
const mkL = () => new Proxy({}, { get: () => (...a) => ({ addTo:()=>({}), on:()=>({}), bindPopup:()=>({}),
  setView:()=>({}), fitBounds:()=>({}), removeLayer:()=>({}), addLayer:()=>({}), remove:()=>({}),
  setLatLng:()=>({}), openPopup:()=>({}), pad:()=>({}), getBounds:()=>({}) }) });

const els = {};
const win = { addEventListener(){}, __plan:null, __wxMap:{}, __wxAll:[],
  open: () => ({document:{write(){},close(){}}, close(){}}) };
const store = {};
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
  parseInt, parseFloat, isNaN, RegExp, String, Number, Array, Object, Boolean, Set, Map,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k,v)=>{store[k]=String(v);}, removeItem: k=>{delete store[k];} },
  document: { getElementById: id => (els[id] = els[id] || mkEl()), createElement: () => mkEl(),
    querySelectorAll: () => [], querySelector: () => null, addEventListener(){}, body:{appendChild(){},removeChild(){}} },
  window: win, alert:()=>{}, confirm:()=>true, prompt:()=>"",
  fetch: () => Promise.reject(new Error("net")), navigator:{onLine:true},
  location:{href:"",search:""}, L: mkL(), requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{},
  speechSynthesis: undefined, SpeechSynthesisUtterance: function(){}, Notification: undefined,
  Blob: function(){}, URL: {createObjectURL:()=>"blob:x", revokeObjectURL(){}}
});
vm.runInContext(scripts.join("\n"), ctx, { timeout: 60000 });

// 需要导出的数据常量（白名单；__ 开头的是运行时状态变量，不需要）
const DATA_NAMES = `CITIES PROVINCES PROVINCE_MAP PROVINCE_CITY_FOODS PROVINCE_REGION PROVINCE_CITIES
  FOOD_SPOTS PROVINCE_INFO GEN_HOTELS HOTELS PROVINCE_LANDMARKS EXTRA_SPOTS EXTRA_SPOTS2 EXTRA_SPOTS3
  EXTRA_SPOTS4 EXTRA_SPOTS5 CITY_LANDMARKS_EXTRA5 CITY_LANDMARKS_EXTRA6 CITY_LANDMARKS_EXTRA
  CITY_LANDMARKS CITY_LANDMARKS_EXTRA2 CITY_LANDMARKS_EXTRA3 CITY_LANDMARKS_EXTRA4 CITY2PROV
  AIRPORT_CODES SPEC_TRAVEL TRAIN_TABLE WMO_ICON WMO_DESC RAIN_CODES SNOW_CODES CITY_COORDS
  SPOT_COORDS PROVINCE_CAPITAL CAPITAL_COORDS SEASON_WX WTTR_MAP REGION_DEFAULT BUDGETS CLOTH
  BUDGET_STYLE
  PERIOD_ORDER SLOT_GROUP_G SWAP_FALLBACK SPOT_SEP GENERIC_SPOT_WORDS SPOT_CITY_FIX SPOT_HIDDEN
  SPOT_TICKETS BOOKING_TIPS PREP_CHECKLIST HOTEL_TIPS SPOT_DETAILS BIG_SPOT_DAYS BIG_EXCLUDE
  SUNRISE_SPOTS PERIOD_TIME`.split(/\s+/).filter(Boolean);

const out = {};
const errors = [];
// const 声明不进沙箱全局，需在沙箱内用表达式取值（与 harness 一致）
let api = {};
try{
  api = vm.runInContext(`({ ${DATA_NAMES.join(", ")} })`, ctx);
}catch(e){ errors.push("取值表达式: " + e.message); }
for(const name of DATA_NAMES){
  try{
    const val = api[name];
    if(val === undefined) { errors.push(name + ": undefined"); continue; }
    // 序列化测试（函数/循环引用会在此暴露）
    JSON.stringify(val);
    out[name] = val;
  }catch(e){ errors.push(name + ": " + e.message); }
}

const header = `// 由 export-data.mjs 从「旅游攻略生成器.html」运行时自动导出，勿手改。
// 重新生成: node export-data.mjs
// 数据总字节: ${JSON.stringify(out).length}
module.exports = ${JSON.stringify(out, null, 0)};\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header, "utf8");
console.log("已导出 " + Object.keys(out).length + " 个数据常量 → " + OUT);
console.log("文件大小: " + (header.length/1024).toFixed(0) + " KB");
if(errors.length) console.log("警告:\n  " + errors.join("\n  "));
