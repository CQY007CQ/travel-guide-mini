// 真实景点批量地理编码（geocode/geo，开放配额池）
// 输入：tools/_curated_spots.js + tools/_curated_spots2.js（人工精选真实景点，非虚构）
// 过程：剔除「已在该城 experiences 中」与「列表内重复」→ 仅对真正新增者调用高德 geocode/geo 取真实 GCJ-02 坐标
// 输出：tools/v198-curated-spots.js（EXP_REPLACE 新增体验 + COORDS_ADD 真实坐标；未命中者随城锚兜底）
// 注意：geocode/geo 与 place/text(搜索配额,已耗尽) 是不同接口不同配额；本脚本只用开放的 geocode/geo。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const ROOT = process.cwd();
const D = req("./utils/data.js");

/* ---------- Key 池 ---------- */
function loadKeys() {
  const out = [];
  const push = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
    .forEach(x => { if (!out.includes(x)) out.push(x); });
  if (process.env.MAP_KEYS) push(process.env.MAP_KEYS);
  if (process.env.MAP_KEY) push(process.env.MAP_KEY);
  for (const f of ["geocode.keys", "geocode.key"]) {
    try { push(fs.readFileSync(path.join(ROOT, "tools", f), "utf8").split("\n").map(l => l.replace(/#.*$/, "")).join(" ")); }
    catch (e) {}
  }
  return out;
}
const KEYS = loadKeys();
if (!KEYS.length) { console.error("未找到 Key"); process.exit(1); }
let keyIdx = 0;
const curKey = () => KEYS[keyIdx];
let allExhausted = false;
// 轮换：每日配额耗尽等硬性错误 → 换下一把 key
const ROTATE_RE = /OVER_LIMIT|INVALID_USER_KEY|USER_KEY_RECYCLED|INVALID_USER_SCODE|USERKEY_PLAT_NOMATCH|INVALID_USER_IP|SERVICE_NOT_EXIST/;
// 瞬态：QPS/并发/网关超时 → 同一把 key 退避重试，不轮换、不判失败
const TRANSIENT_RE = /CUQPS_HAS_EXCEEDED|CONCURRENT|GATEWAY|TIMEOUT|SYSTEM_ERROR/;
const CACHE_FILE = path.join(ROOT, "tools", "geocode-curated-cache.json");
const OUT = path.join(ROOT, "tools", "v198-curated-spots.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 匹配校验（防止错配，复用 geocode-fix 思路） ---------- */
function coreOf(s){return String(s||"").replace(/[（(【].*?[)）】]/g,"").replace(/[\s·、,，/|+]/g,"").trim();}
function lcsLen(a,b){const m=a.length,n=b.length;if(!m||!n)return 0;const dp=new Array(n+1).fill(0);let best=0;
  for(let i=1;i<=m;i++){for(let j=n;j>=1;j--){if(a[i-1]===b[j-1]){dp[j]=dp[j-1]+1;if(dp[j]>best)best=dp[j];}else dp[j]=0;}}return best;}
function matchOk(kw,title){const k=coreOf(kw),t=coreOf(title);if(!k||!t)return false;
  if(t.includes(k)||k.includes(t))return true;return lcsLen(k,t)/Math.min(k.length,t.length)>=0.6;}

/* ---------- 请求层（geocode/geo，自动轮换 key） ---------- */
let CALLS=0;
async function geocode(city, name){
  const ck=city+"|"+name;
  const cache=readCache();
  if(cache[ck]!==undefined) return cache[ck];
  let rotateTried=0, transientTried=0;
  for(;;){
    if(allExhausted) return null;
    const url=`https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&key=${curKey()}`;
    CALLS++;
    let j=null,netErr="";
    try{const r=await fetch(url,{timeout:10000});j=await r.json();}catch(e){netErr=e.message;}
    if(netErr){await sleep(400);continue;}
    if(j&&j.status==="1"&&Array.isArray(j.geocodes)&&j.geocodes.length){
      const g=j.geocodes[0];
      const loc=String(g.location||"").split(",");
      const lon=Number(loc[0]),lat=Number(loc[1]);
      if(isFinite(lat)&&isFinite(lon)&&matchOk(name,g.formatted_address||"")){
        const v={lat:+lat.toFixed(6),lon:+lon.toFixed(6),title:g.formatted_address||name};
        writeCache(ck,v);return v;
      }
      // 有返回但名称不匹配 → 视为无可用坐标（非瞬态），记空缓存走城锚
      writeCache(ck,null);return null;
    }
    const info=String((j&&j.info)||"status "+(j&&j.status));
    if(TRANSIENT_RE.test(info)){            // QPS/并发/超时：退避重试同一把 key
      transientTried++;
      if(transientTried<=3){ await sleep(700*transientTried); continue; }
      writeCache(ck,null); return null;
    }
    if(ROTATE_RE.test(info)){               // 每日配额耗尽：换下一把 key
      if(rotateTried<KEYS.length-1){ rotateTried++; keyIdx=(keyIdx+1)%KEYS.length; console.log(`\n[key轮换] ${info} → 第${keyIdx+1}/${KEYS.length}把`); await sleep(150); continue; }
      allExhausted=true; console.log("\n所有 key 的 geocode/geo 配额疑似耗尽，剩余未查者走城锚兜底");
    }
    writeCache(ck,null); return null;
  }
}

/* ---------- 缓存读写（断点续传） ---------- */
let _cache=null;
function readCache(){if(_cache)return _cache;try{_cache=JSON.parse(fs.readFileSync(CACHE_FILE,"utf8"));}catch(e){_cache={};}return _cache;}
function writeCache(k,v){_cache[k]=v;if(Object.keys(_cache).length%50===0)fs.writeFileSync(CACHE_FILE,JSON.stringify(_cache),"utf8");}

/* ---------- 主流程 ---------- */
const a=req("./tools/_curated_spots.js"), b=req("./tools/_curated_spots2.js");
const list=a.concat(b);
const have={};
for(const c of D.CITIES){const s=new Set();(c.experiences||[]).forEach(e=>{if(e&&e.name)s.add(String(e.name).trim())});have[c.name]=s;}
// 仅保留真正新增（剔除已存在 + 列表内重复），保持原顺序
const seen=new Set(),todo=[];
for(const it of list){
  const key=it.city+"|"+it.name;
  if(seen.has(key))continue;seen.add(key);
  if(have[it.city]&&have[it.city].has(it.name))continue;
  todo.push(it);
}
console.log(`候选总数 ${list.length} → 真正新增 ${todo.length}（已剔除已存在/重复）`);

const expReplace={}, coordsAdd={};
let done=0,hit=0,miss=0;
for(const it of todo){
  const r=await geocode(it.city,it.name);
  done++;
  if(r){hit++;coordsAdd[it.city]=coordsAdd[it.city]||[];coordsAdd[it.city].push([it.name,r.lat,r.lon]);}
  else miss++;
  if(done%40===0){fs.writeFileSync(CACHE_FILE,JSON.stringify(readCache()),"utf8");
    process.stdout.write(`  已处理 ${done}/${todo.length}  坐标命中 ${hit}  城锚兜底 ${miss}\r`);}
  await sleep(400);
}
fs.writeFileSync(CACHE_FILE,JSON.stringify(readCache()),"utf8");

// 组装 EXP_REPLACE（from 空 → 追加）
for(const it of todo){
  expReplace[it.city]=expReplace[it.city]||[];
  expReplace[it.city].push({from:"",to:{name:it.name,period:it.period,note:it.note}});
}

const patch=`// 自动生成：人工精选真实景点 + 高德 geocode/geo 真实坐标（勿手改）
// EXP_REPLACE 新增体验（城市需 <14 时自然进入行程）；COORDS_ADD 为真实 GCJ-02 坐标，未命中者由城锚兜底。
module.exports = {
  EXP_REPLACE: ${JSON.stringify(expReplace, null, 1)},
  COORDS_ADD: ${JSON.stringify(coordsAdd, null, 1)}
};
`;
fs.writeFileSync(OUT,patch,"utf8");
console.log(`\n完成：新增体验 ${todo.length} | 真实坐标命中 ${hit} | 城锚兜底 ${miss}`);
console.log("补丁已生成:", OUT);
console.log("下一步：node tools/merge-data-patch.mjs 后 ./allcheck.sh");
