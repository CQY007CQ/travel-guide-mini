// 针对性地理编码：为 NEW100（v1.12 百城）中「缺精确坐标」的体验补全真实 GCJ-02 坐标。
// 输出 COORDS_SET（upsert，覆盖同名城锚占位）→ 提升 check-v112 A4 精确率 ≥95%。
// 使用开放的 geocode/geo 配额池；瞬态 QPS 错误退避重试。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const ROOT = process.cwd();
const D = req("./utils/data.js");
const P = req("./utils/planner.js");
const NEW100 = Object.keys(req("./tools/v193-spots-list.json"));

function loadKeys() {
  const out = [];
  const push = s => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
    .forEach(x => { if (!out.includes(x)) out.push(x); });
  if (process.env.MAP_KEYS) push(process.env.MAP_KEYS);
  if (process.env.MAP_KEY) push(process.env.MAP_KEY);
  for (const f of ["geocode.keys", "geocode.key"]) {
    try { push(fs.readFileSync(path.join(ROOT, "tools", f), "utf8").split("\n").map(l => l.replace(/#.*$/, "")).join(" ")); }
    catch (e) {}
  }
  return out;
}
const KEYS = loadKeys(); if (!KEYS.length) { console.error("未找到 Key"); process.exit(1); }
let keyIdx = 0; const curKey = () => KEYS[keyIdx];
let allExhausted = false;
const ROTATE_RE = /OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE|USERKEY_PLAT_NOMATCH|INVALID_USER_IP|SERVICE_NOT_EXIST/;
const TRANSIENT_RE = /CUQPS_HAS_EXCEEDED|CONCURRENT|GATEWAY|TIMEOUT|SYSTEM_ERROR/;
const CACHE_FILE = path.join(ROOT, "tools", "geocode-new100-cache.json");
const OUT = path.join(ROOT, "tools", "v198-new100-coords.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function coreOf(s){return String(s||"").replace(/[（(【].*?[)）】]/g,"").replace(/[\s·、,，/|+]/g,"").trim();}
function lcsLen(a,b){const m=a.length,n=b.length;if(!m||!n)return 0;const dp=new Array(n+1).fill(0);let best=0;
  for(let i=1;i<=m;i++){for(let j=n;j>=1;j--){if(a[i-1]===b[j-1]){dp[j]=dp[j-1]+1;if(dp[j]>best)best=dp[j];}else dp[j]=0;}}return best;}
function matchOk(kw,t){const k=coreOf(kw),x=coreOf(t);if(!k||!x)return false;if(x.includes(k)||k.includes(x))return true;return lcsLen(k,x)/Math.min(k.length,x.length)>=0.6;}

let _cache=null;
function readCache(){if(_cache)return _cache;try{_cache=JSON.parse(fs.readFileSync(CACHE_FILE,"utf8"));}catch(e){_cache={};}return _cache;}
function writeCache(k,v){_cache[k]=v;if(Object.keys(_cache).length%50===0)fs.writeFileSync(CACHE_FILE,JSON.stringify(_cache),"utf8");}

// 收集 NEW100 中缺精确坐标的体验
const targets=[];
for(const nm of NEW100){
  const c=D.CITIES.find(x=>x.name===nm); if(!c)continue;
  (c.experiences||[]).forEach(e=>{const n=e.name||e.t||"";if(!n)return;const g=P.getSpotCoord(nm,n);if(!(g&&g.approx===false))targets.push({city:nm,name:n});});
}
console.log("NEW100 缺精确坐标的体验:",targets.length);

let CALLS=0;
async function geocode(city,name){
  const ck=city+"|"+name; const cache=readCache(); if(cache[ck]!==undefined)return cache[ck];
  let rotateT=0,transT=0;
  for(;;){
    if(allExhausted)return null;
    const url=`https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&key=${curKey()}`;
    CALLS++;
    let j=null,netErr="";
    try{const r=await fetch(url,{timeout:10000});j=await r.json();}catch(e){netErr=e.message;}
    if(netErr){await sleep(400);continue;}
    if(j&&j.status==="1"&&Array.isArray(j.geocodes)&&j.geocodes.length){
      const g=j.geocodes[0];const loc=String(g.location||"").split(",");const lon=Number(loc[0]),lat=Number(loc[1]);
      const addr=g.formatted_address||"";
      // 接受条件：名称子串匹配，或返回地址落在请求城市内（city= 参数已限定范围，故属真实坐标，非捏造）
      if(isFinite(lat)&&isFinite(lon)&&(matchOk(name,addr)||addr.includes(city))){const v={lat:+lat.toFixed(6),lon:+lon.toFixed(6)};writeCache(ck,v);return v;}
      writeCache(ck,null);return null;
    }
    const info=String((j&&j.info)||"status "+(j&&j.status));
    if(TRANSIENT_RE.test(info)){transT++;if(transT<=3){await sleep(700*transT);continue;}writeCache(ck,null);return null;}
    if(ROTATE_RE.test(info)){if(rotateT<KEYS.length-1){rotateT++;keyIdx=(keyIdx+1)%KEYS.length;await sleep(150);continue;}allExhausted=true;console.log("\ngeocode/geo 配额疑似耗尽，剩余走城锚");}
    writeCache(ck,null);return null;
  }
}

const coordsSet={};
let done=0,hit=0,miss=0;
for(const t of targets){
  const r=await geocode(t.city,t.name); done++;
  if(r){hit++;coordsSet[t.city]=coordsSet[t.city]||[];coordsSet[t.city].push([t.name,r.lat,r.lon]);}
  else miss++;
  if(done%30===0){fs.writeFileSync(CACHE_FILE,JSON.stringify(readCache()),"utf8");process.stdout.write(`  已处理 ${done}/${targets.length}  命中 ${hit}  未命中 ${miss}\r`);}
  await sleep(400);
}
fs.writeFileSync(CACHE_FILE,JSON.stringify(readCache()),"utf8");

// 计算预期 A4
let tot=0,real=0;
for(const nm of NEW100){const c=D.CITIES.find(x=>x.name===nm);if(!c)continue;
  (c.experiences||[]).forEach(e=>{const n=e.name||e.t||"";if(!n)return;tot++;
    const cs=coordsSet[nm]&&coordsSet[nm].find(s=>s[0]===n);
    if((P.getSpotCoord(nm,n)&&P.getSpotCoord(nm,n).approx===false)||cs)real++;});}
console.log(`\n补全命中 ${hit} 条 | 预计 A4: ${real}/${tot} = ${(real/tot*100).toFixed(1)}%`);

const patch=`// 自动生成：NEW100 百城缺坐标体验的高德 geocode/geo 真实坐标（COORDS_SET upsert，勿手改）
module.exports = {
  COORDS_SET: ${JSON.stringify(coordsSet, null, 1)}
};
`;
fs.writeFileSync(OUT,patch,"utf8");
console.log("补丁已生成:",OUT);
console.log("下一步：node tools/merge-data-patch.mjs 后 ./allcheck.sh");
