// 页面高层接口：组合 data.js + planner.js + 本地存储，让页面尽量薄
const D = require("./data.js");
const store = require("./store.js");

// v1.20 数据拆分包：data-packed.js 移入 subdata/data，主包异步加载。
// planner.js 在模块顶层对 data.js 做了 36 个字段解构，必须在数据就绪后再 require，
// 否则会拿到空数据且被模块缓存。这里用惰性 Proxy，首次真正调用 P.xxx 时才加载 planner。
let _P = null;
let _PReady = false;
function planner() {
  if (_PReady) return _P;
  if (!D.__dataReady) throw new Error("数据尚未加载完成，请稍后重试");
  _P = require("./planner.js");
  // v1.11 修真 bug：planner.js 是从网页版抽出来的，里面 getWish/getProfile 走 localStorage，
  // 而小程序没有 localStorage 且那两个键常量也没定义 —— 异常被 try/catch 吞掉后
  // 「想玩清单里的景点优先安排」静默失效（用户勾了想玩，行程却没优先排）。
  // 这里把 wx 存储注入进去，让 planner 内部也能读到真实的想玩清单。
  if (_P && typeof _P.setStoreAdapter === "function") {
    _P.setStoreAdapter({
      getItem: (k) => store.get(k, null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.del(k)
    });
  }
  _PReady = true;
  return _P;
}
const P = new Proxy({}, { get: (_t, k) => planner()[k] });

// 页面在 onLoad/onShow 先 await ready()，保证数据与迁移都完成再渲染
function ready() {
  const p = D.initData ? D.initData() : Promise.resolve(D);
  return p.then(() => { bootData(); return D; });
}

// 版本号：发版时与 cli upload --version 保持一致（首页 / 更多页底部防呆显示）
const APP_VER = "1.19.129";

// 迁移后 CITIES 不内嵌 province，省份归属在 CITY2PROV；此处回填，
// 使 provinces()/citiesOf()/出发地与目的地选择按省正确分组。
// v1.20：数据分包异步加载，迁移必须在数据就绪后执行一次（ready() 调用）。
let _booted = false;
function bootData() {
  if (_booted && Array.isArray(D.CITIES) && D.CITIES.length) return;
  if (!Array.isArray(D.CITIES) || !D.CITIES.length) { _booted = false; return; } // 数据尚未就绪，留待重试后再跑
  _booted = true;
  (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => { if (!c.province && D.CITY2PROV && D.CITY2PROV[c.name]) c.province = D.CITY2PROV[c.name]; });
  const real = Array.isArray(D.PREP_CHECKLIST) ? D.PREP_CHECKLIST : null;
  if (real && real.length && Array.isArray(PACK_LIST)) {
    const old = PACK_LIST.join(",");
    const next = real.join(",");
    if (old !== next) { PACK_LIST.length = 0; real.forEach(x => PACK_LIST.push(x)); }
  }
}

/* ---------- 城市查询 ---------- */
// 省份：全量 34 个，按标准顺序（PROVINCES）
function provinces() { return (Array.isArray(D.PROVINCES) ? D.PROVINCES : []).slice(); }

// v1.19.8：城市列表在运行期不变，但 inspire/inspirePicks 等每次调用都会对全部 420 城
// 做一次 filter+map。这里缓存一次，后续直接复用（数据量约 420，省的是重复遍历开销）。
let _namedCitiesCache = null;
function namedCities() {
  if (_namedCitiesCache) return _namedCitiesCache;
  _namedCitiesCache = (Array.isArray(D.CITIES) ? D.CITIES : []).filter(c => c && c.name);
  return _namedCitiesCache;
}

// 城市：返回该省【全部】城市（351 城皆可生成——
// 46 座精编城走专属攻略数据，其余城市由 planner 用本市景点库/省地标兜底生成）
// guide=true 的精编城市排前面，方便优先选择
function citiesOf(prov) {
 const names = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || [];
 const guide = new Set((Array.isArray(D.CITIES) ? D.CITIES : []).map(c => c.name));
 // v1.19.79：同名「X市」归并 —— 选择列表只展示带数据的 canonical 名，避免用户选到零景点「X市」
 const out = [];
 const _seen = new Set();
 for (const name of names) {
  const cn = canonCityName(name);
  if (_seen.has(cn)) continue;
  _seen.add(cn);
  out.push({ name: cn, province: prov, guide: guide.has(cn) });
 }
 // v1.19.53：有限数据层——把本省带 limited 标记的城市也暴露进选择列表（不与省级纯真实名录重复）。
 // 这些城市仅有真实坐标、暂无景点库，选中后生成「抵达 + 自由活动 + 返程」框架并提示「内容收集中」。
 (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => {
  if (c && c.limited && c.province === prov) {
   const cn = canonCityName(c.name);
   if (!_seen.has(cn)) { _seen.add(cn); out.push({ name: cn, province: prov, guide: true, limited: true }); }
  }
 });
 return out.sort((a, b) => (b.guide - a.guide) || a.name.localeCompare(b.name, "zh"));
}

// 任意城市解析：46 精编城 → 专属攻略；其它城市 → 本市景点库，本市未收录再回退省级地标
// （planner.findCity 已实现完整兜底，这里补上 province 推断）
// v1.11：城市名 → 城市对象索引（原本每次 findCity 都要线性扫 132 城）
let _cityIdx = null;
const _cityIndex = () => {
  if (_cityIdx) return _cityIdx;
  _cityIdx = new Map();
  (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => { if (c && c.name && !_cityIdx.has(c.name)) _cityIdx.set(c.name, c); });
  return _cityIdx;
};
// v1.19.79：同名「X市」↔「X」归并。
// 库里同时有「安康」(有数据) 与「安康市」(零景点) 这类重名条目，用户选/搜「安康市」会生成空白。
// 统一把名称收敛到「带数据的那个」变体：优先原样(有数据) → 否则剥「市」 → 再否则补「市」。
function canonCityName(name) {
  if (!name || typeof name !== "string") return name;
  const idx = _cityIndex();
  const hasData = (n) => { const c = idx.get(n); return !!(c && Array.isArray(c.experiences) && c.experiences.length); };
  if (hasData(name)) return name;
  if (name.endsWith("市")) {
    const s = name.slice(0, -1);
    if (idx.has(s)) return s;
  }
  const withSuffix = name + "市";
  if (idx.has(withSuffix) && hasData(withSuffix)) return withSuffix;
  return name;
}
// 同一行程里 findCity 会被反复调用（每日每项都查），结果缓存避免重复解析
const _findCache = new Map();
function findCity(name, province) {
 if (!name) return null;
 const canon = canonCityName(name);
 const ck = canon + "|" + (province || "");
 if (_findCache.has(ck)) return _findCache.get(ck);
 let res = null;
 const prov = province || (D.CITY2PROV && D.CITY2PROV[canon]);
 try {
  const full = P.findCity(canon, prov);
  if (full && full.experiences && full.experiences.length) res = full;
 } catch (e) {}
 if (!res) res = _cityIndex().get(canon) || null;
 if (_findCache.size > 400) _findCache.clear();   // 防多城切换后无限增长
 _findCache.set(ck, res);
 return res;
}

/* ---------- 生成 ---------- */
// v1.18：放松填充项轮替去重。planner 生成的「休整 · 周边走走」在松行程里会逐日重复，
// 用户会觉得"行程好水"。此处统一在生成出口轮替不同措辞，保证同行程内不出现完全相同的放松文案。
const _RELAX_ALTS = [
  { n: "休整 · 周边走走", t: "充实的一天，出园/下山后放松一下" },
  { n: "休整 · 老街慢逛", t: "去老街走走，找家小店发会儿呆" },
  { n: "休整 · 咖啡馆放空", t: "挑家咖啡馆，看看街景歇歇脚" },
  { n: "休整 · 近郊步道", t: "附近绿道散个步，吹吹风换换气" },
  { n: "休整 · 江边吹风", t: "沿水边走一段，看看夜景" },
  { n: "休整 · 夜市转转", t: "找条烟火气的小巷，边走边吃" },
  { n: "休整 · 公园长椅发呆", t: "坐下歇会儿，把今天的高光记下来" },
  { n: "休整 · 书店咖啡", t: "找家书店或咖啡馆，慢慢收尾" },
  { n: "休整 · 沿街骑行", t: "骑车兜一圈，比走路更省时间" },
  { n: "休整 · 天台看晚霞", t: "傍晚光线最好，顺手拍几张" }
];
const _FREE_ALTS = [
  "当地自由探索 · 逛老街", "当地自由探索 · 咖啡馆坐坐", "当地自由探索 · 江边吹风",
  "当地自由探索 · 夜市觅食", "当地自由探索 · 街区闲逛", "当地自由探索 · 书店咖啡",
  "当地自由探索 · 公园散步", "当地自由探索 · 天台看晚霞", "当地自由探索 · 沿河骑行",
  "当地自由探索 · 巷子探店", "当地自由探索 · 菜市场寻味", "当地自由探索 · 老城夜灯",
  "当地自由探索 · 河堤慢走", "当地自由探索 · 小店淘货", "当地自由探索 · 城墙边遛弯",
  "当地自由探索 · 街心公园"
];
function polishRelax(days) {
  if (!Array.isArray(days)) return days;
  // v1.19.10：按天索引轮替（原全局 ri 在 10 天行程里第 5 个休整项会与第 1 个撞文案）
  // v1.19.11：planner 直出的固定「当地自由探索」也按天轮换，避免长行程逐日撞文案
  for (let di = 0; di < days.length; di++) {
    const d = days[di];
    if (!d || !Array.isArray(d.items)) continue;
    for (const it of d.items) {
      if (it && typeof it.name === "string") {
        if (it.name.indexOf("休整 ·") === 0) {
          const alt = _RELAX_ALTS[di % _RELAX_ALTS.length];
          it.name = alt.n;
          if (typeof it.note === "string") it.note = alt.t;
        } else if (it.name === "当地自由探索" || it.name.indexOf("当地自由探索 ·") === 0) {
          it.name = _FREE_ALTS[(di + 3) % _FREE_ALTS.length];
        }
      }
    }
  }
  return days;
}

// opts: {city(完整对象|{name,province}|城市名), days, depart, budget, pace, people, mode|travelMode, stayMountain, picks, pickOnly}
function buildPlan(opts) {
 // v1.11：fuzz 巡检发现 opts 为 null/undefined 时会抛 TypeError（调用方 catch 只拿到
 // "Cannot read properties of null"，提示不出来原因）→ 归一成明确的 Error
 if (!opts || typeof opts !== "object") throw new Error("buildPlan: 参数缺失，需要 {city, days, depart}");
 const raw = opts.city;
 // 允许三种传法：完整城市对象（直接用）/ 轻对象 {name,province} / 纯城市名
 let city = raw && raw.experiences ? raw : findCity(typeof raw === "string" ? raw : (raw && raw.name), raw && raw.province);
 if (!city) throw new Error("unsupported city: " + (raw && (raw.name || raw)));
 const daysN = parseInt(opts.days, 10);
 if (!(daysN > 0)) throw new Error("天数无效，请至少选择 1 天");
 const _out = P.buildPlanDays(city, daysN, opts.depart, opts.budget || "mid", {
  style: opts.pace || "balance",
  pickSpots: opts.picks || [],
  pickOnly: opts.pickOnly !== false,
  stayMountain: opts.stayMountain !== false,
  travelMode: opts.travelMode || opts.mode || "",
  bias: opts.bias || "", // v1.15：历史古迹/自然风光/默认
  lastMode: "return", nextCity: "", seg: 0
 });
 if (!_out || !_out.length) throw new Error("出发日期无效，请重新选择");
 return polishRelax(_out);
}

/* ---------- 多站串联（≤4 站，对齐网页 generateMulti） ---------- */
// opts: { route:[{name,province,days}, ...≤4], depart, budget, pace, travelMode, people, stayMountain, picksPerStation, pickOnly }
// 返回: { days, segments:[{cityName,province,startDay,endDay,dateStart,dateEnd,days}], totalDays, route }
function buildMultiPlan(opts) {
 // v1.11：同 buildPlan，null 入参给明确错误而不是 TypeError
 if (!opts || typeof opts !== "object") throw new Error("buildMultiPlan: 参数缺失，需要 {route, depart}");
 let route = (Array.isArray(opts.route) ? opts.route : []).slice(0, 4);
 if (!route.length) throw new Error("empty route");
 // v1.19.11：相邻同城站自动合并 —— 用户配「大理2天 + 大理3天」时，
 // 旧实现会生成「退房→前往 大理→再抵达入住」的滑稽环节，同城景点还会重复。
 // 合并成单站（天数相加）后行程更自然，重复消失。
 {
  const merged = [];
  for (const st of route) {
   const last = merged[merged.length - 1];
   const same = last && String(last.name || "") === String(st.name || "");
   if (same) last.days = (parseInt(last.days, 10) || 1) + (parseInt(st.days, 10) || 1);
   else merged.push({ name: st.name, province: st.province || "", days: st.days });
  }
  route = merged.slice(0, 4);
 }
 const base = String(opts.depart || "").split("-").map(Number);
 if (base.length !== 3) throw new Error("bad depart");
 const pad2 = n => String(n).padStart(2, "0");
 const fmt = d => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
 let cursor = new Date(base[0], base[1] - 1, base[2]);
 const out = [];
 const segments = [];
 const dayPicks = opts.picksPerStation || {};
 for (let i = 0; i < route.length; i++) {
  const st = route[i];
  const city = findCity(st.name, st.province);
  if (!city) throw new Error("unsupported city: " + st.name);
  const segDays = Math.max(1, parseInt(st.days, 10) || 1);
  if (!(parseInt(st.days, 10) > 0)) throw new Error("第 " + (i + 1) + " 站天数无效，请至少选择 1 天");
  const segDepart = fmt(cursor);
  const segNext = (route[i + 1] || {}).name || "";
  const subDays = P.buildPlanDays(city, segDays, segDepart, opts.budget || "mid", {
   style: opts.pace || "balance",
   pickSpots: dayPicks[st.name] || [],
   pickOnly: !!(opts.pickOnly) && (dayPicks[st.name] || []).length > 0,
   stayMountain: opts.stayMountain !== false,
   travelMode: opts.travelMode || "",
   bias: opts.bias || "", // v1.15：历史古迹/自然风光/默认
   lastMode: i === route.length - 1 ? "return" : "transfer",
   nextCity: segNext,
   seg: i
  });
  const segStart = out.length;
  subDays.forEach(d => out.push(d));
  const segEnd = out.length - 1;
  const segDateStart = fmt(cursor);
  cursor.setDate(cursor.getDate() + segDays);
  const segDateEnd = fmt(new Date(cursor.getTime() - 86400000));
  segments.push({
   cityName: st.name, province: st.province || "",
   startDay: segStart, endDay: segEnd,
   dateStart: segDateStart, dateEnd: segDateEnd, days: segDays
  });
 }
  return { days: polishRelax(out), segments, totalDays: out.length, route };
}

/* ---------- 「全省 · 省内精华游」（镜像网页版 __all 模式） ---------- */
// opts: { province:"山西", days, depart, budget:"low"|"mid"|"high", pace, stayMountain, travelMode }
// 返回: 逐日数组（同 buildPlan：每天含 date/theme/items/title/cityName/meal…），酒店逐城跟随
function buildProvPlan(opts) {
 const prov = opts && opts.province;
 if (!prov || !D.PROVINCE_CITIES || !D.PROVINCE_CITIES[prov]) throw new Error("unsupported province: " + prov);
 const daysN = parseInt(opts && opts.days, 10);
 if (!(daysN > 0)) throw new Error("天数无效，请至少选择 1 天");
 const _out = P.buildProvincePlanDays(prov, daysN, opts.depart, opts.budget || "mid",
  opts.pace || "balance", opts.stayMountain !== false, opts.travelMode || "", opts.bias || "");
  if (!_out || !_out.length) throw new Error("出发日期无效，请重新选择");
  return polishRelax(_out);
}

// v1.17.4：全省精华游天数上限 —— 旧实现固定用 days:12 探针再取其实际天数，
// 等于把上限永久夹在 12 天以内（无论该省能串多少城、多少景点）。改为用足够大的探针值
// 取「真实可生成天数」，并缓存结果（UI 在节奏切换时会反复调用）。
const _provCapCache = new Map();
function provinceDayCap(province, pace) {
 const ck = province + "|" + (pace || "balance");
 if (_provCapCache.has(ck)) return _provCapCache.get(ck);
 try {
  const arr = buildProvPlan({ province, days: 60, depart: "2027-01-01", budget: "mid", pace: pace || "balance", stayMountain: true, travelMode: "" });
  const n = (arr && arr.length) ? arr.length : 7;
  _provCapCache.set(ck, n);
  return n;
 } catch (e) { _provCapCache.set(ck, 7); return 7; }
}
// v1.17.4：全省精华游「建议天数」—— 按真实可玩天数的 60% 给出（留出取舍空间，
// 不逼玩家把可玩的每一天都走满），下限 3 天。
function provinceSuggestedDays(province, pace) {
 const cap = provinceDayCap(province, pace);
 return Math.max(3, Math.min(cap, Math.round(cap * 0.6)));
}
// v1.17.5：单城游天数上限 —— 旧 UI 对单城游写死上限 14 天，导致景点少的城市
//（芜湖、唐山）也能选 14 天，生成出 10~12 天的「留白」空天。
// 做法：用 14 天探针跑一次，数出「确实有非框架景点」的天数，再 +1 天作自由活动缓冲。
// 比按可玩池规模估算更准（池子里的景点未必都会被排进行程）。
const _cityCapCache = new Map();
function cityDayCap(cityName, pace) {
 const ck = String(cityName || "") + "|" + (pace || "balance");
 if (_cityCapCache.has(ck)) return _cityCapCache.get(ck);
 let n = 5;
 try {
  const arr = buildPlan({ city: cityName, days: 14, depart: "2027-01-01", budget: "mid", pace: pace || "balance" });
  if (Array.isArray(arr) && arr.length) {
   let withSpot = 0;
   arr.forEach(d => {
    const ok = (Array.isArray(d.items) ? d.items : []).some(it => it && it.name && !isFrameName(it.name));
    if (ok) withSpot++;
   });
   n = Math.max(2, Math.min(14, withSpot));
  }
 } catch (e) { n = 5; }
 _cityCapCache.set(ck, n);
 return n;
}

/* ---------- 想玩景点池（与网页版 poolOfCity 等价：行程经验 + 城市景点库 + 坐标表） ---------- */
// v1.19.12：poolOfCity 每页渲染反复调用，结果按「城市名+数据量」缓存，去重改用 Set
const _poolCache = new Map();
function poolOfCity(city) {
 if (!city) return [];
 const cn = String(city.name || "");
 const expN = Array.isArray(city.experiences) ? city.experiences.length : 0;
 const key = cn + "|" + (city.id || "") + "|" + expN;
 const hit = _poolCache.get(key);
 if (hit) return hit;
 const seen = new Set();
 const names = [];
 const push = n => { if (n && !seen.has(n)) { seen.add(n); names.push(n); } };
 (Array.isArray(city.experiences) ? city.experiences : []).forEach(e => push(e && e.name));
 const id = city.id || "";
 (D.EXTRA_SPOTS && D.EXTRA_SPOTS[id] || []).forEach(push);
 ((D.CITY_LANDMARKS_EXTRA && D.CITY_LANDMARKS_EXTRA[cn]) || []).forEach(push);
 ((D.CITY_LANDMARKS && D.CITY_LANDMARKS[cn]) || []).forEach(push);
 const sc = (D.SPOT_COORDS && D.SPOT_COORDS[cn]) || [];
 sc.forEach(s => { if (s && s[0]) push(s[0]); });
 if (_poolCache.size > 600) _poolCache.clear();
 _poolCache.set(key, names);
 return names;
}
// 某城的想玩勾选（wish 中归属该城或命中该城池的景点）
function wishPicksFor(cityName) {
 const pool = poolOfCity(cityName || "");
 return getWish()
  .filter(x => (x.city && x.city === cityName) || (pool.length && pool.includes(x.name)))
  .map(x => x.name);
}


// v1.17.10：就近城市（≤200km 的最近一座）—— 给新城（平遥/婺源等）在缺少独立数据时
// 回退到所属地级市用（如平遥→晋中、阳朔→桂林）。超出 200km 视为无可回退，返回空串。
 function nearbyCityOf(cityName) {
 try {
  const nm = canonCityName(String(cityName || ""));
  if (!nm || !findCity(nm)) return "";
  const g = P.getCoord(nm);
  if (!g) return "";
  let best = "", bd = Infinity;
  for (let i = 0; i < D.CITIES.length; i++) {
   const x = D.CITIES[i];
   if (!x || x.name === nm) continue;
   const gx = P.getCoord(x.name);
   if (!gx) continue;
   const d = haversineKm(g, gx);
   if (d < bd) { bd = d; best = x.name; }
  }
  return bd <= 200 ? best : "";
 } catch (e) { return ""; }
}
// 美食店铺（用于地图"美食"图层）
function foodSpotsFor(cityName) {
 if (!cityName) return [];
 return (D.FOOD_SPOTS && D.FOOD_SPOTS[canonCityName(cityName)]) || [];
}

/* ---------- v1.15 景点标签 / 多维检索 ---------- */
// 规则化标签：给景点打上「历史古迹/自然风光/博物馆/亲子/古镇/宗教/美食/乐园/海滨/徒步」。
// 规则基于真实景点名关键词，只做“分类”，不虚构事实；后续 SPOT_DETAIL 可带显式 tags 覆盖。
const SPOT_TAG_RULES = [
  { tag: "历史古迹", rx: /古迹|遗址|古城|古镇|旧城|老街|故居|陵|墓|碑|祠|石窟|长城|古道|遗址公园|纪念馆|博物馆|宫|府|楼|塔|桥/ },
  { tag: "博物馆", rx: /博物馆|展览馆|科技馆|美术馆|陈列馆|博览馆|纪念馆/ },
  { tag: "宗教", rx: /寺|庙|教堂|清真寺|佛塔|经堂|道观|窟/ },
  { tag: "古镇", rx: /古镇|古城|老街|古村|民俗村|文化村/ },
  { tag: "自然风光", rx: /山|峰|湖|江|河|海(?=滩|湾|岛|滨|边|域|洋|岸)|湾|滩|草原|森林|峡谷|瀑布|湿地|冰川|梯田|沙漠|花海|天池|溶洞|洞穴|地质公园|自然保护区|公园/ },
  { tag: "亲子", rx: /动物园|海洋公园|水族馆|科技馆|恐龙|乐园|游乐园|水上乐园|游乐场|动物园/ },
  { tag: "乐园", rx: /乐园|游乐园|主题公园|水世界|欢乐谷|迪士尼|欢乐|游乐场/ },
  { tag: "美食", rx: /美食|小吃|夜市|米线|火锅|烧烤|菜|肉|鱼|面|粉|店|街/ },
  { tag: "海滨", rx: /海滩|海岸|海边|海岛|海滨|渔港|码头|沙滩|海角|岛屿|岛(?=$|公园|屿|链|群)/ },
  { tag: "徒步", rx: /徒步|栈道|登山|爬山|穿越|步道/ }
];
// v1.19.12：spotTagOf 是纯函数且搜索页会对全量景点重复调用 → 记忆化
const _tagMemo = new Map();
function spotTagOf(name, cityName) {
 const n = String(name || "").trim();
 if (!n) return ["其他"];
 const mk = (cityName || "") + "|" + n;
 const hit = _tagMemo.get(mk);
 if (hit) return hit;
 // 显式标签优先（未来 SPOT_DETAILS.tags）
 const _cn = canonCityName(cityName);
 const detail = (D.SPOT_DETAILS && D.SPOT_DETAILS[_cn] && D.SPOT_DETAILS[_cn][n]);
 if (detail && Array.isArray(detail.tags) && detail.tags.length) return detail.tags.slice();
 const tags = [];
 for (const r of SPOT_TAG_RULES) if (r.rx.test(n)) tags.push(r.tag);
 const res = tags.length ? Array.from(new Set(tags)) : ["其他"];
 if (_tagMemo.size > 20000) _tagMemo.clear();
 _tagMemo.set(mk, res);
 return res;
}
// 多维检索：按城市 + 标签 + 关键词过滤景点，返回 [{name, city, tags, period, note}]
function searchSpots(opts) {
 const o = opts || {};
 const cityName = String(o.city || "").trim();
 const tag = String(o.tag || "").trim();
 const kw = String(o.kw || "").trim().toLowerCase();
 const out = [];
 const push = (cityObj, e) => {
  const n = String(e.name || "").trim();
  if (!n) return;
  const tags = spotTagOf(n, cityObj.name);
  if (tag && !tags.some(t => t === tag || String(t).includes(tag))) return;
  if (kw && n.toLowerCase().indexOf(kw) < 0 && (e.note || "").toLowerCase().indexOf(kw) < 0) return;
  out.push({ name: n, city: cityObj.name, tags, period: e.period || "", note: e.note || "" });
 };
 if (cityName) {
  const c = findCity(cityName);
  if (c && Array.isArray(c.experiences)) c.experiences.forEach(e => push(c, e));
 } else {
  (D.CITIES || []).forEach(c => (Array.isArray(c.experiences) ? c.experiences : []).forEach(e => push(c, e)));
 }
 // 城市优先排序；同城保持原有顺序
 return out;
}

// 酒店点位（用于地图"住宿"图层）— 取城市中心 + 该预算档位的酒店（无坐标时退化为"建议在市中心商圈"标签）
function hotelPointFor(cityName, budgetKey) {
 if (!cityName) return null;
 try {
  const c = P.getCoord(cityName);
  if (!c || !c.lat || !c.lon) return null;
  const hot = (D.HOTELS && (D.HOTELS[(_cityIndex().get(cityName) || {}).id])) || D.GEN_HOTELS;   // v1.19.8：find → 索引
  const key = (D.BUDGETS && D.BUDGETS[budgetKey || "mid"]) ? (budgetKey || "mid") : "mid";
  const lab = { low: "经济", mid: "舒适", high: "高端" }[key] || "舒适";
  const pick = (hot && hot.find(h => h.tier === lab)) || (hot && hot[1]) || (hot && hot[0]);
  const name = pick ? ((pick.place || "") + " · " + (pick.brands || "")) : "市中心酒店区";
  return { name, lat: c.lat, lon: c.lon, tier: pick ? pick.tier : lab };
 } catch (e) { return null; }
}

/* ---------- 预算（与网页版同语义） ---------- */
// 自定义预算：按总金额 ÷ 天数 ÷ 人数 估算每人每天，住宿45%/餐饮22%/交通门票33%分摊
function customBudgetObj(amt, days, peopleN) {
 if (!amt || amt <= 0) return null;
 const p = Math.max(1, peopleN || 1);
 const per = amt / Math.max(1, days || 1) / p;
 const hotel = Math.round(per * 0.45);
 const food = Math.round(per * 0.22);
 const lo = Math.max(50, Math.round(per * 0.7)), hi = Math.round(per * 1.3);
 return {
  label: "自定义 ¥" + amt,
  daily: lo + "-" + hi,
  hotel: Math.max(60, Math.round(hotel * 0.8)) + "-" + Math.max(80, Math.round(hotel * 1.2)) + "元/晚",
  food: Math.max(40, Math.round(food * 0.8)) + "-" + Math.max(60, Math.round(food * 1.2)) + "元/人/天",
  note: "按自定义总预算 ¥" + amt + " 分摊：住宿约45%、餐饮约22%、交通门票约33%"
 };
}
// 预算档位的 daily 是范围字符串（如"300-600"），乘人数/天数需解析范围
function scaleRange(s, m) {
 const parts = String(s).split("-").map(x => parseInt(x.trim(), 10));
 if (parts.some(isNaN)) return String(s);
 return parts.length > 1 ? (parts[0] * m) + "-" + (parts[1] * m) : String(parts[0] * m);
}
// 由 plan 得到预算展示对象（label/daily/hotel/food/note/总花费文本）
function budgetTotalObj(plan) {
 try {
  const days = Math.max(1, (plan && plan.days && plan.days.length) || (plan && plan.totalDays) || 1);
  const people = Math.max(1, (plan && plan.people) || 2);
  let b = null;
  if (plan && plan.customAmt > 0) b = customBudgetObj(plan.customAmt, days, people);
  if (!b) b = (D.BUDGETS || {})[plan && plan.budget ? plan.budget : "mid"] || (D.BUDGETS || {}).mid;
  const totalBudget = scaleRange(b.daily, days * people);
  return { ...b, days, people, totalBudget };
 } catch (e) { return null; }
}



/* ---------- 条目判定（与网页版同一套规则） ---------- */
function isFrameName(n) {
 const s = String(n || "");
// v1.19.25：补齐漏登记的填充/活动行（压测 3 万轮发现它们被当成真景点，污染重复率、地图与统计）
//   ① 「老街慢逛 · 喝杯咖啡」「继续游览 + 登山/索道上行」「+ 登山/索道上行」
//   ② 注意：不要登记「深度游览「X」/继续深度游览「X」」——那是大景点一日游的叙事拆行，
//      登记了整日大景点会变成「0 个景点」（同一向量的首行「出发前往「X」」本来就是框架）。
if (/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|继续游览|\+ ?登山|\+ ?索道)/.test(s)) return true;
return /自由活动|自由探索|留白|休整|当地美食|当地自由|早餐|晚餐|早点休息|看日出|下山|备选|夜市|小吃街|馆子|早点铺|街边摊|烧烤摊|菜市场|家常菜馆|面食小馆|苍蝇馆子|散步|吹风|慢走|慢逛|闲逛|夜游|溜达|夜灯|拼一顿/.test(s);
}
// 详情/简介过滤也一致
function isDetailable(n) {
 const s = String(n || "");
 if (/^(抵达|出发前往|退房|返程|前往|入住|回酒店|继续游览|\+ ?登山|\+ ?索道)/.test(s)) return false;
 return !/自由活动|自由探索|留白|备选|看日出|下山|休整|凌晨出发|早餐|晚餐|早点休息|美食|夜市|小吃街|馆子|早点铺|街边摊|烧烤摊|菜市场|家常菜馆|面食小馆|苍蝇馆子|散步|吹风|慢走|慢逛|闲逛|夜游|溜达|夜灯|拼一顿/.test(s);
}
// v1.15：展示层 note 归一——避免「坐标已收录，可一键导航：XXX」这类功能性占位在时间线满屏重复
function spotNoteDisp(note) {
  const s = String(note || "").trim();
  if (s.indexOf("坐标已收录，可一键导航：") === 0) return "坐标已收录 · 可一键导航";
  return s;
}
// v1.16：景点真实信息（来自地图 POI：开放时间/评分/人均/地址）。无数据返回 null，由调用方决定不展示。
function spotInfo(name) {
  try {
    const n = String(name || "").trim();
    if (!n) return null;
    const dict = D.SPOT_INFO || {};
    let v = dict[n];
    if (!v) { for (const k in dict) { if (n.indexOf(k) >= 0 && dict[k]) { v = dict[k]; break; } } }
    if (!v) return null;
    const has = !!(v.openTime || v.rating || v.cost || v.addr);
    return has ? { openTime: v.openTime || "", rating: v.rating || "", cost: v.cost || "", addr: v.addr || "" } : null;
  } catch (e) { return null; }
}
// 把真实信息拼成一行短文本，供详情区展示（无数据返回空串）
function spotInfoText(name) {
  const v = spotInfo(name);
  if (!v) return "";
  const parts = [];
  if (v.openTime) parts.push("开放 " + v.openTime);
  if (v.rating) parts.push("评分 " + v.rating);
  if (v.cost) parts.push("人均 ¥" + v.cost);
  if (v.addr) parts.push(v.addr);
  return parts.join(" · ");
}

/* ---------- 详情（纯文本 / rich-text 节点） ---------- */
// 小节标题保留原样（怎么去 / 推荐游览线路 …），块级 </div> 转成换行 → 小程序端逐段展示
// v1.11：入参可能是数字/数组（fuzz 抓到 "h.replace is not a function"）→ 统一转字符串
function stripHtml(h) {
 const s = (h === null || h === undefined || typeof h === "object") ? "" : String(h);
 return s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}
function spotDetailText(name, cityName) {
 try {
  const raw = P.spotDetailCore ? P.spotDetailCore(name, cityName) : "";
  if (!raw || /^<div class="sd-ops"/.test(raw)) return "";
  // 块级结尾转换行，节标题独立成段；内联标签再统一清理
  let h = raw.replace(/<\/div>/g, "\n").replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return h.split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
 } catch (e) { return ""; }
}

/* ---------- 导航 / 百科 ---------- */
function cleanSpotName(name) {
 const raw = String(name || "").trim();
 let n = raw.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
 n = n.replace(/[（(【].*?[)）】]/g, "").trim();
 return n || raw;
}
// 导航目标判定（v1.14）：
//   approx:false  → 景点精确坐标，直接 wx.openLocation 到点
//   approx:"city" → 只定位到所在城市中心（真坐标，非景点位），仍可开地图，附提示让用户在地图内搜该点
//   其它           → 工具内引导（问路/打车/看方向）
function navTarget(name, cityName) {
 const n = cleanSpotName(name);
 if (!n || isFrameName(name)) return null;
 let coord = null;
 try { if (cityName) coord = P.getSpotCoord(cityName, n); } catch (e) {}
 if (coord && coord.lat && coord.lon && coord.approx === false) {
  return { type: "coord", lat: coord.lat, lon: coord.lon, name: n };
 }
 if (coord && coord.lat && coord.lon) {
  return { type: "city", lat: coord.lat, lon: coord.lon, name: n, city: cityName || "" };
 }
 return { type: "search", name: n, keyword: (cityName ? cityName : "") + n };
}
function baikeUrl(name) {
 const kw = baikeKeyword(name);
 return kw ? "https://baike.baidu.com/item/" + encodeURIComponent(kw).replace(/'/g, "%27") : "";
}
function baikeKeyword(name) {
 let n = String(name || "").trim();
 if (!n) return "";
 n = n.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )\s*[「]?/, "").replace(/」$/, "");
 const parts = n.split(/\s*(?:\+|＋|、|\/)\s*/).map(s => s.trim()).filter(Boolean);
 if (parts.length) n = parts[0];
 return n.trim();
}

/* ---------- 今天卡片状态 ---------- */
function todayState(plan) {
 if (!plan || !plan.days || !plan.days.length) return null;
 const todayStr = store.fmtLocalDate(new Date());
 const days = plan.days;
 const first = String(days[0].date || "").slice(0, 10);
 const last = String(days[days.length - 1].date || "").slice(0, 10);
 const diff = (a, b) => { const pa = a.split("-").map(Number), pb = b.split("-").map(Number); return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000); };
 if (!first) return null;
 if (todayStr < first) return { phase: "before", daysLeft: diff(todayStr, first) };
 if (todayStr > last) return { phase: "after", daysSince: diff(last, todayStr) };
 const idx = days.findIndex(d => String(d.date).slice(0, 10) === todayStr);
 if (idx < 0) return { phase: "before", daysLeft: diff(todayStr, first) };
 return { phase: "during", idx, dayNo: idx + 1, total: days.length };
}
// 当前时段序号（与 PERIOD_ORDER 同刻度）
function currentPeriodOrder() {
 const h = new Date().getHours();
 if (h < 6) return -1;
 if (h < 9) return 0;
 if (h < 12) return 1;
 if (h < 17) return 2;
 if (h < 19) return 3;
 return 4;
}
// 今日「真正游玩点」（跳过框架），供途中卡与行程页高亮
function daySpots(day) {
 // v1.11：fuzz 抓到 day 为 null/undefined 时崩溃（行程数据结构异常时会走到这里）
 if (!day || !Array.isArray(day.items)) return [];
 return day.items.filter(it => it && !isFrameName(it.name));
}
function nextActivity(day) {
 if (!day) return null;
 const spots = daySpots(day);
 if (!spots.length) return null;
 const cur = currentPeriodOrder();
 const ord = p => (D.PERIOD_ORDER && D.PERIOD_ORDER[p] != null ? D.PERIOD_ORDER[p] : 99);
 const withO = spots.map(it => ({ it, o: ord(it.period) }));
 const now = withO.find(x => x.o >= cur);
 const next = now ? withO.find(x => x.o > now.o) : null;
 return { now: now ? now.it : null, next: next ? next.it : null, left: now ? withO.filter(x => x.o >= now.o).length : 0, spotsN: spots.length };
}

/* ---------- 记账 ---------- */
const LEDGER_KEY = "miniLedgerV1";
function getLedger() { return store.get(LEDGER_KEY, []); }
function addLedger(amt, cat, name, payer, share, date, trip) {
 const list = getLedger();
 const d = (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) ? String(date) : store.fmtLocalDate(new Date());
 list.unshift({
  date: d,
  cat, name: name || "行程中随手记",
  amt, payer: payer || "0",
  share: Math.max(1, parseInt(share, 10) || 1),
  trip: trip || ""
 });
 store.set(LEDGER_KEY, list.slice(0, 200));
 return list;
}
function delLedger(i) {
 const list = getLedger();
 list.splice(i, 1);
 store.set(LEDGER_KEY, list);
 return list;
}
function todaySpent() {
 const t = store.fmtLocalDate(new Date());
 return getLedger().filter(x => String(x.date) === t).reduce((s, x) => s + (Number(x.amt) || 0), 0);
}
// 单笔金额合理性过滤：账本脏数据（超大/负数/NaN）不参与累计，避免预算条被污染成天文数字
function totalSpent() {
 return getLedger().reduce((s, x) => {
  const a = Number(x.amt);
  if (!isFinite(a) || a <= 0 || a > 1e6) return s;
  return s + a;
 }, 0);
}
function budgetPerDay(plan) {
 // 网页版舒适型 ~300-600/人/天 两档 → 单日预算参考（2 人）
 try { return { low: 200, mid: 450, high: 900 }[plan.budget || "mid"]; } catch (e) { return 450; }
}

// 导出账本为 CSV（Excel/Numbers/Sheets 都能打开）
function exportLedgerCSV() {
 const list = getLedger();
 if (!list || !list.length) return ""; // 空账本不产出「只有表头」的假 CSV，页面守卫据此提示暂无数据
 const header = "日期,分类,说明,金额(元),付款人,AA人数,人均(元)";
 const lines = list.map(x => {
  const amt = Number(x.amt) || 0;
  const share = Math.max(1, parseInt(x.share, 10) || 1);
  const per = (amt / share).toFixed(2);
  return [x.date, x.cat || "", (x.name || "").replace(/,/g, "，"),
   amt.toFixed(2), x.payer || "", share, per].join(",");
 });
 // 加 BOM 防止 Excel 读 UTF-8 中文乱码
 return "\uFEFF" + header + "\n" + lines.join("\n");
}

// 导出行程为 .ics（导入到系统日历/Google Calendar/Outlook）
function exportICS(plan) {
 if (!plan || !plan.days || !plan.days.length) return "";
 const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
 const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
 const lines = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//travel-mini//zh//",
  "CALSCALE:GREGORIAN",
  "X-WR-CALNAME:" + esc(plan.cityName + " 行程")
 ];
 plan.days.forEach((d, di) => {
  const ds = String(d.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  const _dsm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds);
  const dt = ds.replace(/-/g, "");
  const next = _dsm ? new Date(+_dsm[1], +_dsm[2]-1, +_dsm[3]) : new Date();
  next.setDate(next.getDate() + 1);
  // ICS DTEND（all-day 用本地年月日，避开 toISOString UTC 跨日偏移）
  const dtEnd = next.getFullYear() + String(next.getMonth() + 1).padStart(2, "0") + String(next.getDate()).padStart(2, "0");
  const desc = (Array.isArray(d.items) ? d.items : []).map(it => (it.period ? "[" + it.period + "] " : "") + (it.name || "") + (it.note ? " (" + it.note + ")" : "")).join(" · ");
  lines.push("BEGIN:VEVENT");
  lines.push("UID:d" + (di + 1) + "-" + Date.now() + "@travel-mini");
  lines.push("DTSTAMP:" + stamp);
  lines.push("DTSTART;VALUE=DATE:" + dt);
  lines.push("DTEND;VALUE=DATE:" + dtEnd);
  lines.push("SUMMARY:" + esc(plan.cityName + " · D" + (di + 1) + " · " + (d.theme || "行程")));
  lines.push("DESCRIPTION:" + esc(desc));
  lines.push("END:VEVENT");
 });
 lines.push("END:VCALENDAR");
 return lines.join("\r\n");
}

/* ---------- 行前待办（可勾，存本机） ---------- */
const PREP_KEY = "miniPrepV1";
function getPrepChecks() { return store.get(PREP_KEY, {}); }
function togglePrepCheck(k) {
 const c = getPrepChecks();
 c[k] = !c[k];
 store.set(PREP_KEY, c);
 return c;
}
// v1.13.1：生成「新的行程」时重置行李清单勾选。
// pg_* 是上一程的打包进度，跨行程会「同名项保持已勾」造成误以为装好了；p_*（订票/订酒店等）非行李，保留。
function resetPackChecks() {
 const c = getPrepChecks();
 const keys = Object.keys(c).filter(k => k.indexOf("pg_") === 0);
 if (!keys.length) return;
 keys.forEach(k => { delete c[k]; });
 store.set(PREP_KEY, c);
}
// v1.15.3：换目的地/生成新行程时，「与本次行程绑定」的准备项也要重置。
// 用户反馈：订往返票、订全程酒店、过一遍流程、请假这 4 项换行程后仍显示已勾，会误以为新行程也办妥了。
// 这里清掉绑定具体行程/目的地的项；通用随身项（证件/现金/充电/App）保留，避免每次重头勾。
const TRIP_BOUND_PREP = ["p_ticket", "p_hotel", "p_plan", "p_leave", "p_book", "p_pack", "p_weather", "p_shot", "p_time"];
function resetTripPrep() {
 const c = getPrepChecks();
 let hit = 0;
 TRIP_BOUND_PREP.forEach(k => { if (c[k]) { delete c[k]; hit++; } });
 Object.keys(c).forEach(k => { if (k.indexOf("pg_") === 0) { delete c[k]; hit++; } });  // 行李清单一并重置
 if (!hit) return;
 store.set(PREP_KEY, c);
}
function prepPhaseList(daysLeft) {
 if (daysLeft >= 7) return { title: "不着急，先把大头定下来", items: [
  ["p_ticket", "订好往返交通票（高铁 / 机票）"], ["p_hotel", "订好全程酒店，确认可免费取消"],
  ["p_plan", "过一遍行程，不想去的随手删掉"], ["p_leave", "请假 / 把工作学习安排妥当"]] };
 if (daysLeft >= 3) return { title: "该抢票预约了", items: [
  ["p_book", "预约需要提前订的景点门票"], ["p_id", "检查证件有效期（身份证 / 学生证）"],
  ["p_money", "准备少量现金，确认手机支付可用"], ["p_app", "下载离线地图、打车与购票 App"]] };
 if (daysLeft >= 1) return { title: "临行前查漏补缺", items: [
  ["p_pack", "按行李清单打包"], ["p_weather", "再看一次目的地天气，调整衣物"],
  ["p_charge", "充满充电宝、相机电池"], ["p_shot", "把车票 / 门票二维码截图存相册"]] };
 return { title: "今天出发！", items: [["p_id2", "身份证 + 车票 / 机票"], ["p_wallet", "手机、钱包、钥匙"], ["p_time", "提前到站：高铁 1 小时 / 飞机 2 小时"]] };
}
const PACK_LIST = D.PREP_CHECKLIST || ["身份证/护照", "少量现金", "充电宝+数据线", "防晒霜+墨镜", "常用药", "换洗衣物", "舒适运动鞋"];

/* ---------- prep 票务跟踪（每个景点：已订 / 预约日期 / 备注，按「城市·景点名」记） ---------- */
const PREPTK_KEY = "miniPrepTicketsV1";
function tkKeyOf(cityName, name) { return (cityName || "") + "·" + (name || ""); }
function getTicketTrack() { return store.get(PREPTK_KEY, {}); }
// patch: {done, date, note} 任选；返回该景点最新的跟踪对象
function setTicketTrack(cityName, name, patch) {
 const m = getTicketTrack();
 const k = tkKeyOf(cityName, name);
 const prev = m[k] || { done: false, date: "", note: "" };
 m[k] = Object.assign({}, prev, patch || {});
 store.set(PREPTK_KEY, m);
 return m[k];
}

/* ---------- 预算参考 ---------- */
function budgetDaily(budget) {
 try { const b = (D.BUDGETS || {})[budget || "mid"]; return (b && b.daily) || "300-600"; } catch (e) { return "300-600"; }
}
function budgetDesc(budget) {
 try {
  const b = (D.BUDGETS || {})[budget || "mid"];
  return b ? `${b.label} · 每日 ${b.daily} · ${b.note}` : "";
 } catch (e) { return ""; }
}
function budgetLabel(budget) {
 try { const b = (D.BUDGETS || {})[budget || "mid"]; return (b && b.label) || "舒适型"; } catch (e) { return "舒适型"; }
}
// 名店按预算排序：贴合当前档价位的店排前面（与网页版同规则：经济→平价主推、舒适→平价+中档、高端→中档+高档）
// withTag=true 时给每家店附加 bandName（平价/中档/高档）与 hit（是否贴合预算）
function budgetFoodFirst(shops, budgetKey, withTag) {
 try {
  const list = Array.isArray(shops) ? shops : [];
  const key = (D.BUDGETS && D.BUDGETS[budgetKey || "mid"]) ? (budgetKey || "mid") : "mid";
  const st = (D.BUDGET_STYLE || {})[key];
  if (!st) return list.slice();
  const compat = st.key === "low" ? ["low"] : (st.key === "high" ? ["mid", "high"] : ["low", "mid"]);
  const tg = st.key === "low" ? 40 : (st.key === "high" ? 220 : 100);
  const meta = s => { try { return P.shopBand(s.price) || { n: 999, band: "mid" }; } catch (e) { return { n: 999, band: "mid" }; } };
  const rows = list.map((s, i) => { const m = meta(s); return { s, i, r: compat.includes(m.band) ? 0 : 1, d: Math.abs(m.n - tg), band: m.band }; });
  rows.sort((a, b) => a.r - b.r || a.d - b.d || a.i - b.i);
  return rows.map(x => {
   const o = Object.assign({}, x.s);
   if (withTag) { o.bandName = x.band === "low" ? "平价" : (x.band === "high" ? "高档" : "中档"); o.hit = x.r === 0; }
   return o;
  });
 } catch (e) { return Array.isArray(shops) ? shops.slice() : []; }
}

/* ---------- 穿衣建议（CLOTH + SEASON_WX，按目的地气候与出发月） ---------- */
const SEASON_KEYS = { 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋", 12: "冬" };
function clothAdvice(city) {
 try {
  const c = city || {};
  const climate = c.climate || "temperate";
  const sk = SEASON_KEYS[new Date().getMonth() + 1] || "秋";
  const wx = (D.SEASON_WX && D.SEASON_WX[climate] && D.SEASON_WX[climate][sk]) || "";
  const cl = (D.CLOTH && D.CLOTH[climate] && D.CLOTH[climate][sk]) || null;
  const lines = [];
  if (wx) lines.push(wx);
  if (c.best) lines.push("适宜时节：" + c.best);
  if (cl) {
   lines.push("上衣：" + cl.tops);
   lines.push("下装：" + cl.bottoms);
   if (cl.shoes) lines.push("鞋：" + cl.shoes);
   if (cl.accessories) lines.push("配件：" + cl.accessories);
   if (cl.tip) lines.push("" + cl.tip);
  }
  return lines.join("\n");
 } catch (e) { return ""; }
}

/* ---------- 攻略速览（住宿 / 交通 / 分区） ---------- */
function stayAdvice(city) {
 try {
  const c = city || {};
  const parts = [];
  if (c.areas && c.areas.length) parts.push("推荐住：" + c.areas.map(a => a.name + "（" + a.note + "）").join("；"));
  if (c.stayTip) parts.push("" + c.stayTip);
  return parts.join("\n");
 } catch (e) { return ""; }
}
function goAdvice(city) {
 try {
  const c = city || {};
  const parts = [];
  if (c.travel) parts.push(c.travel);
  if (c.cityTravel) parts.push(c.cityTravel);
  return parts.join("\n");
 } catch (e) { return ""; }
}

/* ---------- 一键复制全文 ---------- */
function copyPlanText(plan) {
 if (!plan || !plan.days) return "";
 const L = [];
 const fmt = s => String(s || "").slice(0, 10);
 L.push("" + plan.cityName + " " + plan.totalDays + " 天行程（出发 " + fmt(plan.depart) + "，预算 " + budgetLabel(plan.budget) + "）");
 const city = findCity(plan.cityName);
 if (city && city.foods && city.foods.length) L.push("必吃：" + city.foods.join("、"));
 if (city && city.travel) L.push("" + city.travel);
 if (city && city.stayTip) L.push("" + city.stayTip);
 L.push("——————");
 plan.days.forEach((d, di) => {
  L.push("【第 " + (di + 1) + " 天 · " + fmt(d.date) + "】" + (d.theme ? " " + d.theme : ""));
  (Array.isArray(d.items) ? d.items : []).forEach(it => {
   const p = it.period ? "[" + it.period + "] " : "";
   L.push(p + (it.name || ""));
   if (it.note) L.push("　" + it.note);
  });
 });
 return L.join("\n");
}

/* ---------- 想玩清单 ---------- */
const WISH_KEY = "miniWishV1";
function getWish() { return store.get(WISH_KEY, []); }
function toggleWish(name, cityName) {
 const w = getWish();
 const i = w.findIndex(x => x.name === name);
 if (i >= 0) w.splice(i, 1); else w.push({ name, city: cityName || "" });
 store.set(WISH_KEY, w.slice(0, 60));
 return w;
}
function isWished(name) { return getWish().some(x => x.name === name); }
// 想玩模糊命中：条目名清洗后与想玩「相等」或「互相包含」。
// 解决三处真实场景：①行名带动作前缀「深度游览「X」」；②X 是合并条目「天安门广场 + 故宫博物院」，
// 想玩只勾了「故宫」；③想玩存的整条 raw 名，重排后条目拆分/合并。用于高亮与行前预告（非 toggle 判等）。
function _wishNameHit(n, wn) {
 if (!n || !wn) return false;
 if (n === wn) return true;
 // v1.19.9：不再用「任意子串互相包含」判命中——勾「西湖」会把北京的「龙潭西湖公园」也算命中。
 // 改为：前缀命中（故宫 → 故宫博物院），或组合名拆分后某一段前缀命中（天安门广场 + 故宫博物院 ← 故宫）。
 const _seg = (s) => String(s || "").split(/[+＋/、·,，]/).map(v => v.trim()).filter(v => v.length >= 2);
 const ns = _seg(n), ws = _seg(wn);
 for (const x of ns) for (const y of ws) {
  if (x === y) return true;
  // 前缀或后缀命中：故宫 → 故宫博物院；总统府 → 南京总统府；长城 → 八达岭长城
  if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return true;
  if (x.length > y.length && x.endsWith(y)) return true;
  if (y.length > x.length && y.endsWith(x)) return true;
 }
 return false;
}
function wishHitsOf(name) {
 const w = getWish();
 if (!w.length || !name) return [];
 const n = cleanSpotName(name);
 return w.filter(x => _wishNameHit(n, cleanSpotName(x.name)));
}
function wishHit(name) { return wishHitsOf(name).length > 0; }
function clearWish() { store.set(WISH_KEY, []); }

/* ---------- 目的地收藏（心愿单） ---------- */
const FAV_KEY = "miniFavV1";
function getFavs() { return store.get(FAV_KEY, []); }
function isFaved(key) { return getFavs().includes(key); }
function toggleFav(key) {
 if (!key) return getFavs();
 const list = getFavs();
 const i = list.indexOf(key);
 if (i >= 0) list.splice(i, 1); else { list.unshift(key); if (list.length > 12) list.length = 12; }
 store.set(FAV_KEY, list);
 return list;
}
function delFav(i) {
 const list = getFavs();
 list.splice(i, 1);
 store.set(FAV_KEY, list);
 return list;
}

/* ---------- 最近查询 ---------- */
const RECENT_KEY = "miniRecentV1";
function getRecent() { return store.get(RECENT_KEY, []); }
function pushRecent(item) {
 // v1.11：脏入参不该写进「最近玩过」（会把 undefined 顶到首页回填里）
 if (!item || typeof item !== "object" || !item.city) return getRecent();
 const r = store.getArr(RECENT_KEY).filter(x => !(x && x.city === item.city && x.days === item.days && x.depart === item.depart));
 r.unshift({
  city: String(item.city), province: item.province || (D.CITY2PROV && D.CITY2PROV[item.city]) || "",
  days: Number(item.days) || 0, depart: String(item.depart || "")
 });
 store.set(RECENT_KEY, r.slice(0, 6));
 return r;
}
function delRecent(i) {
 const r = getRecent();
 r.splice(i, 1);
 store.set(RECENT_KEY, r);
 return r;
}

/* ---------- 本地攻略速查（离线 · 本地规则库 · 零网络） ---------- */
// 当前应参考的城市：多站时取今天所在段（无则第一站），单城直接返回 cityName
function activeCityOf(plan) {
 try {
  if (!plan) return "";
  const segs = Array.isArray(plan.segments) ? plan.segments : null;
  if (segs && segs.length === 1) return segs[0].cityName || plan.cityName;
  if (segs && segs.length > 1) {
   const st = todayState(plan);
   if (st && st.phase === "during" && st.idx != null) {
    for (let k = 0; k < segs.length; k++) {
     if (st.idx >= segs[k].startDay && st.idx <= segs[k].endDay) return segs[k].cityName;
    }
   }
   return segs[0].cityName || plan.cityName;
  }
  return plan.cityName || "";
 } catch (e) { return plan ? (plan.cityName || "") : ""; }
}
// 取某段（或全城）的名店数家作“吃”的补充
function _foodNames(cityName, n) {
 const list = foodSpotsFor(cityName);
 return list.slice(0, n).map(f => f.shop).filter(Boolean);
}
// 行程内某城相关的票务（对齐 prep 匹配逻辑）
function _ticketLines(plan, cityFilter) {
 const dict = D.SPOT_TICKETS || {};
 const seen = new Set();
 const out = [];
 (Array.isArray(plan.days) ? plan.days : []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const n = String(it.name || "");
  if (isFrameName(n) || seen.has(n)) return;
  seen.add(n);
  if (cityFilter) {
   const segCity = activeCityOf(plan);
   // 粗略过滤：只收集与目标城市相关日期的条目（单城/首站覆盖）
   if (segCity !== cityFilter && plan.cityName !== cityFilter && !String(n).includes(cityFilter)) return;
  }
  let info = dict[n];
  if (!info) { for (const k in dict) { if (n.includes(k) && dict[k]) { info = dict[k]; break; } } }
  if (!info) return;
  out.push("· " + n + "：" + (info.p || "免费") + (info.book ? "｜需预约（" + (info.where || "官方渠道") + "）" : "") +
   (info.url ? "｜" + info.url.replace(/^https?:\/\//, "") : ""));
 }));
 return out;
}
// 主入口：根据问题关键词检索本地知识库；返回 {text, tag}
function askAssistant(rawQ, plan) {
 const q = String(rawQ || "").trim();
 const hasPlan = !!(plan && plan.days && plan.days.length);
 if (!hasPlan) {
  return { text: "还没有行程，我暂时答不了行程问题。\n回「出发」页生成一份攻略（目的地 + 天数 + 出发日期），之后就能问我：\n· 每天怎么安排\n· 天气穿什么\n· 门票要不要预约\n· 住哪方便、怎么去、花多少", tag: "info" };
 }
 if (!q) return { text: "想问点什么？可以点上方小气泡，或直接输入。", tag: "info" };
 const city = activeCityOf(plan);
 const cityObj = findCity(city);
 const lines = [];
 const L = s => lines.push(s);
 const isGreet = /^(你好|您好|嗨|hi|hello|在吗|hey)/i.test(q);
 if (isGreet) {
  L("你好呀！我是你的离线旅行助手 \n这趟「" + plan.cityName + " · " + plan.days.length + " 天」我都在线（不用联网）。");
  L("试着问我：\n· 第2天怎么安排\n· " + city + "天气穿什么\n· 门票要预约吗\n· 吃什么/住哪/预算多少/怎么去");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 第 N 天 / 明天 / 今天 ----
 const dn = q.match(/第\s*(\d+)\s*天/);
 const askDay = dn ? parseInt(dn[1], 10) : (/明天/.test(q) ? 2 : (/今天|今天安排|今早|今晚/.test(q) ? 1 : 0));
 if (askDay > 0 || /(怎么安排|行程安排|怎么玩|去哪|推荐路线|攻略)/.test(q)) {
  let di = askDay > 0 ? askDay - 1 : (todayState(plan) && todayState(plan).phase === "during" ? todayState(plan).idx : 0);
  const clamped = di > plan.days.length - 1;
  di = Math.max(0, Math.min(di, plan.days.length - 1));
  const day = plan.days[di];
  L("【" + (di + 1) + "】" + (day.theme || "行程") + " · " + String(day.date).slice(5));
  if (clamped) L("（行程共 " + plan.days.length + " 天，已给你看最后一天）");
  const spots = (Array.isArray(day.items) ? day.items : []).filter(it => !isFrameName(it.name)).slice(0, 8);
  if (!spots.length) L("这一天是机动/休息日，自由安排即可。");
  spots.forEach(it => L("· " + (it.period ? "[" + it.period + "] " : "") + it.name + (it.note ? "（" + it.note + "）" : "")));
  if (di === 0) L("\n出发日记得提前到站：高铁 1 小时 / 飞机 2 小时。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 天气 / 穿衣 ----
 if (/天气|气温|穿衣|穿什么|衣服|外套|冷不冷|热不热|下雨|下雪|衣物|防晒|季节/.test(q)) {
  const adv = clothAdvice(cityObj);
  L(city + "穿衣建议：");
  L(adv || "数据暂缺，按目的地当月气候常识准备即可。");
  L("\n出发前再看一次预报，如逢雨天优先安排室内的展馆 / 商场路线，调整好衣物。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 吃 / 美食 ----
 if (/吃|美食|餐厅|饭店|小吃|必吃|好吃|推荐.*吃|哪家/.test(q)) {
  if (cityObj && cityObj.foods && cityObj.foods.length) L(city + "必吃：" + cityObj.foods.slice(0, 8).join("、"));
  const shops = _foodNames(city, 6);
  if (shops.length) L("\n名店参考：" + shops.join("、"));
  L("\n详情可在「更多 → 美食名店」看地址/人均，支持一键导航。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 门票 / 预约 / 买票 / 学生 ----
 if (/票|预约|门票|买票|学生|优惠|开放时间|几点开/.test(q)) {
  const tks = _ticketLines(plan, city);
  if (tks.length) { L(city + "涉及的购票/预约信息："); tks.slice(0, 10).forEach(x => L(x)); }
  else L(city + "行程里暂无强制预约景点，到官方渠道确认开放即可。");
  if (/学生/.test(q)) L("\n学生证在多数收费景点有半价优惠，购票时选「学生票」并带好证件。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 住 / 酒店 ----
 if (/住|酒店|民宿|住宿|订房|住哪|位置/.test(q)) {
  const sa = stayAdvice(cityObj);
  L(sa || city + "住宿建议：优先地铁站 500m 内、商圈附近，出行方便。");
  const ht = hotelPointFor(city);
  if (ht) L("\n中心参考：" + ht.name);
  L("\n订酒店前四平台（携程/美团/飞猪/去哪儿）比价，价差可达 10-30%。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 交通 / 怎么去 ----
 if (/交通|怎么去|高铁|动车|飞机|地铁|公交|打车|怎么走|车站|机场/.test(q)) {
  const ga = goAdvice(cityObj);
  L(ga ? city + "交通：" + ga : city + "市内建议地铁/公交 + 打车组合，景点之间用导航即可。");
  if (plan.depart) L("\n这趟出发：" + String(plan.depart).slice(0, 10) + "，越早订票越划算。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 预算 / 钱 ----
 if (/预算|花费|多少钱|费用|贵|人均|省钱|穷游/.test(q)) {
  const bo = budgetTotalObj(plan);
  if (bo) L(bo.note + "\n人均约 " + bo.daily + "/天 × " + bo.people + "人 × " + bo.days + "天 ≈ ¥" + bo.totalBudget);
  L("\n记账页能按「行程内」筛选，随时看这趟已花多少。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 注意 / 避坑 / 提醒 ----
 if (/注意|避坑|坑|提醒|小心|禁忌|别|不要|几点去|人多/.test(q)) {
  const day0 = plan.days[0] || {};
  const real = (Array.isArray(day0.items) ? day0.items : []).filter(it => !isFrameName(it.name)).slice(0, 3);
  let any = false;
  real.forEach(it => {
   try {
    const note = P.spotOpenNote ? P.spotOpenNote(it.name, city) : "";
    if (note) { L("· " + it.name + "：" + note); any = true; }
   } catch (e) {}
  });
  if (!any) L("行程里暂未收录特殊避坑点。\n通用三条：热门景点赶早（8:30 前）避人流；带好证件与学生证；自由活动路段先查是否周一闭馆。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 必去 / 值得去 / 推荐 ----
 if (/值得|必去|推荐|好玩|景点|去哪玩|打卡/.test(q)) {
  const pool = poolOfCity(cityObj);
  if (pool.length) { L(city + "人气推荐：" + pool.slice(0, 8).join("、")); L("\n可以在「出发」页想玩清单勾上，重新生成时优先安排。"); }
  else L("这趟最核心的景点都在每日行程里，展开任意条目有介绍与导航。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 特产 / 伴手礼 ----
 if (/特产|伴手礼|买什么|购物|带点什么|纪念品/.test(q)) {
  L("伴手礼建议：\n· 当地老字号糕点/小吃（可真空打包）\n· 文创周边（博物馆/景区旗舰店）\n· 邮局盖章明信片\n购物尽量留到最后半天，避免拖着走。");
  return { text: lines.join("\n"), tag: "ok" };
 }
 // ---- 兜底 ----
 return { text: "这个问题我离线库还答不上来 \n我可以帮你查：\n· 第 N 天怎么安排\n· 天气穿衣 / 吃什么 / 门票预约\n· 住哪方便 / 怎么去 / 预算多少 / 有什么要注意", tag: "info" };
}

/* ---------- 备份 / 恢复（剪贴板通道，全量 JSON，零网络） ---------- */
function _pickOnlyRaw() {
 return store.get("pickOnlyV1", undefined);
}
function exportBackup() {
 const o = {
  v: 1,
  savedAt: store.fmtLocalDate(new Date()) + " " + new Date().toTimeString().slice(0, 5),
  app: "travel-mini",
  plan: store.get("planV1", null),
  ledger: getLedger(),
  wish: getWish(),
  favs: getFavs(),
  recent: getRecent(),
  prep: getPrepChecks(),
  prepTickets: getTicketTrack(),
  remind: store.get("calRemindV1", null),
  from: store.get("fromV1", null),
  fromCity: store.get("fromCityV1", ""),
  pickOnly: _pickOnlyRaw(),
  plans: listSavedPlans(),
  foot: _footRaw(),
  notes: getNotes(),
  mates: getMates(),
  // v1.7
  tiles: homeTiles(),
  night: nightCfg(),
  fx: store.get(FX_KEY, {}),
  billImg: billImgMap()
 };
 return JSON.stringify(o);
}
// 返回 {count, hasPlan, plan}；损坏数据抛错由调用方捕获
function importBackup(json) {
 const raw = String(json || "");
 // v1.10.1：导入体积守卫 —— 超大数据直接拒绝，避免撑爆本地存储导致后续所有写入静默失败
 if (raw.length > 1500000) throw new Error("备份内容过大（超过 1.5MB），已中止导入");
 const o = JSON.parse(raw);
 if (!o || o.v !== 1) throw new Error("不是有效的备份内容");
 let n = 0;
 // v1.10.1：导入统一按各键容量上限裁剪，与运行时写入保持一致
 const CAP = {};
 CAP[LEDGER_KEY] = 200; CAP[WISH_KEY] = 60; CAP[RECENT_KEY] = 6;
 CAP[PLANS_KEY] = 10; CAP[FAV_KEY] = 60; CAP[NOTES_KEY] = 60; CAP[MATES_KEY] = 20;
 const put = (k, v) => {
  if (v === undefined || v === null) return;
  let val = v;
  if (Array.isArray(val) && CAP[k]) val = val.slice(0, CAP[k]);
  store.set(k, val); n++;
 };
 put("planV1", o.plan);
 put(LEDGER_KEY, o.ledger || []);
 put(WISH_KEY, o.wish || []);
 put(FAV_KEY, o.favs || []);
 put(RECENT_KEY, o.recent || []);
 put(PREP_KEY, o.prep || {});
 put(PREPTK_KEY, o.prepTickets || {});
 put("calRemindV1", o.remind);
 put("fromV1", o.from);
 put("fromCityV1", o.fromCity || "");
 if (o.pickOnly !== undefined) store.set("pickOnlyV1", o.pickOnly);
 if (Array.isArray(o.plans)) put(PLANS_KEY, o.plans);
 if (o.foot && o.foot.spots) {
  // 足迹：景点上限 2000 个，超出丢弃最旧的
  const sp = o.foot.spots || {};
  const keys = Object.keys(sp);
  // v1.19.8：原写法 spots 三元两侧都是 sp，超限并没有真正裁剪；改为超限时先置空再回填最近 2000 条
  const foot = { spots: keys.length > 2000 ? {} : sp, cities: o.foot.cities || {} };
  if (keys.length > 2000) {
   foot.spots = {};
   keys.slice(-2000).forEach(k => { foot.spots[k] = sp[k]; });
  }
  store.set(FOOT_KEY, foot); n++;
 }
 if (Array.isArray(o.notes)) put(NOTES_KEY, o.notes);
 if (Array.isArray(o.mates)) put(MATES_KEY, o.mates);
 // v1.7
 if (Array.isArray(o.tiles)) setHomeTiles(o.tiles);
 if (o.night) setNightCfg(o.night);
 if (o.fx && typeof o.fx === "object") store.set(FX_KEY, o.fx);
 if (o.billImg && typeof o.billImg === "object") store.set("miniBillImgV1", o.billImg);
 return { count: n, hasPlan: !!(o.plan && o.plan.days), plan: o.plan };
}

/* ---------- 行程存档（多行程管理，全本地，上限 10 份） ---------- */
const PLANS_KEY = "miniPlansV1";
function listSavedPlans() { return store.get(PLANS_KEY, []); }
// 存档当前行程；同名档（城市+天数+出发日相同）覆盖不堆积。返回 { id, name } 或 null
function savePlanSlot(plan, name) {
 const p = plan || store.get("planV1", null);
 if (!p || !p.days || !p.days.length) return null;
 const list = listSavedPlans();
 const d0 = p.days[0] && p.days[0].date ? String(p.days[0].date).slice(0, 10) : "";
 const sig = (p.cityName || "") + "|" + p.days.length + "|" + d0;
 const nm = name || ((p.cityName || "行程") + " · " + p.days.length + "天");
 const sub = [d0, p.budget ? budgetLabel(p.budget) : "", p.people ? p.people + "人" : ""].filter(Boolean).join(" · ");
 const slot = { id: "p" + Date.now(), sig, name: nm, sub, ts: Date.now(), plan: p };
 const idx = list.findIndex(x => x.sig === sig);
 if (idx >= 0) { slot.id = list[idx].id; list[idx] = slot; } else { list.unshift(slot); }
 store.set(PLANS_KEY, list.slice(0, 10));
 return { id: slot.id, name: slot.name };
}
// 只写 storage；调用方负责 app.setPlan 同步 globalData
function restorePlanSlot(id) {
 const s = listSavedPlans().find(x => x.id === id);
 if (!s || !s.plan || !s.plan.days) return null;
 store.set("planV1", s.plan);
 return s.plan;
}
function delPlanSlot(id) {
 const list = listSavedPlans().filter(x => x.id !== id);
 store.set(PLANS_KEY, list);
 return list.length;
}

/* ---------- B16 行程协作包（想玩清单 + 整份行程 JSON，剪贴板交换，零网络） ---------- */
// 导出协作包：想玩 + 当前整份行程（结构完整，可直接并入/存档）。无行程时也想玩也能导
function exportCollabPlan(plan) {
 const o = {
  app: "travel-collab", v: 1, savedAt: Date.now(),
  city: plan && plan.cityName ? plan.cityName : "",
  wish: getWish().map(w => ({ name: w.name, city: w.city || "" })),
  plan: plan && plan.days && plan.days.length ? plan : null
 };
 return JSON.stringify(o);
}
// 解析并合并协作包：并入想玩清单（去重），对方行程按 sig 查重后存为「同行人 ·」存档。
// 返回 { added, saved, existed, city, days }；不是协作包抛错由调用方兜底走旧纯文本解析
function mergeCollabPlan(text) {
 const o = JSON.parse(String(text || ""));
 if (!o || o.app !== "travel-collab" || o.v !== 1) throw new Error("not collab");
 const ws = getWish();
 let added = 0;
 (Array.isArray(o.wish) ? o.wish : []).forEach(w => {
  const nm = String(w && w.name || "").trim();
  if (!nm || nm.length > 30) return;
  if (ws.some(x => x.name === nm)) return;
  toggleWish(nm, (w && w.city) || "");
  added++;
 });
 let saved = null, existed = false;
 const p = o.plan;
 if (p && p.days && p.days.length && p.cityName) {
  const d0 = p.days[0] && p.days[0].date ? String(p.days[0].date).slice(0, 10) : "";
  const sig = (p.cityName || "") + "|" + p.days.length + "|" + d0;
  existed = listSavedPlans().some(x => x.sig === sig);
  if (!existed) {
   saved = savePlanSlot(p, "同行人 · " + p.cityName + " " + p.days.length + "天");
  }
 }
 return { added: added, saved: saved, existed: existed, city: o.city || (p && p.cityName) || "", days: (p && p.days) ? p.days.length : 0 };
}

/* ---------- 旅行足迹（景点打卡 + 城市点亮，全本地） ---------- */
const FOOT_KEY = "miniFootV1";
function _footRaw() {
 const f = store.get(FOOT_KEY, null);
 return (f && f.spots) ? f : { spots: {}, cities: {} };
}
function isVisited(name) {
 const k = cleanSpotName(name) || name;
 return !!_footRaw().spots[k];
}
// on=false 取消打卡；city 传归属城市（点亮城市）。返回最新 stats
function markVisited(name, city, on) {
 const f = _footRaw();
 const k = cleanSpotName(name) || name;
 if (on === false) { delete f.spots[k]; }
 else {
  f.spots[k] = { name: name, city: city || "", ts: Date.now() };
  if (city) {
   if (!f.cities) f.cities = {};
   if (!f.cities[city]) f.cities[city] = Date.now();
  }
  // v1.10.1：足迹容量上限 2000 个景点，超出时挤掉最早打卡的（防止长期无限膨胀）
  const ks = Object.keys(f.spots);
  if (ks.length > 2000) {
   ks.sort((a, b) => (f.spots[a].ts || 0) - (f.spots[b].ts || 0));
   for (let i = 0; i < ks.length - 2000; i++) delete f.spots[ks[i]];
  }
 }
 store.set(FOOT_KEY, f);
 return footStats();
}
function footStats() {
 const f = _footRaw();
 const cityList = Object.keys(f.cities || {});
 return { spots: Object.keys(f.spots || {}).length, cities: cityList.length, cityList };
}

/* ---------- 多站：某天归属城市（plan/prep/map 共用，避免各自用 plan.cityName 串） ---------- */
function segCityOfDay(plan, di) {
 if (!plan) return "";
 const segs = Array.isArray(plan.segments) ? plan.segments : null;
 if (segs && segs.length) {
  for (let k = 0; k < segs.length; k++) {
   if (di >= segs[k].startDay && di <= segs[k].endDay) return segs[k].cityName || "";
  }
  return segs[0].cityName || "";
 }
 return plan.cityName || "";
}

/* ---------- AA 结算（按付款人汇总 → 谁该收 / 谁该付多少 → 转账配对） ---------- */
function settleUp() {
 const list = getLedger();
 if (!list || !list.length) return null;
 const order = [];
 const paid = {};
 let total = 0;
 list.forEach(x => {
  const amt = Number(x.amt) || 0;
  if (!(amt > 0)) return;
  const p = String(x.payer || "我").trim() || "我";
  if (paid[p] === undefined) { paid[p] = 0; order.push(p); }
  paid[p] += amt;
  total += amt;
 });
 const n = order.length;
 if (!n || !(total > 0)) return null;
 const r2 = v => Math.round(v * 100) / 100;
 total = r2(total);
 const per = total / n;
 // v1.11：netCls / netTx 在 JS 里算好，WXML 不再写两层嵌套三元（每行渲染都要算两遍）
 const rows = order.map(p => {
  const net = r2(paid[p] - per);
  return {
   payer: p, paid: r2(paid[p]), owe: r2(per), net,
   netCls: net > 0 ? "st-get" : (net < 0 ? "st-pay" : ""),
   netTx: net > 0 ? "应收回 ¥" + net : (net < 0 ? "应支付 ¥" + r2(0 - net) : "已持平")
  };
 })
  .sort((a, b) => b.net - a.net);
 // 贪心配对：欠钱的（net<0）付给该收的（net>0）
 const owes = rows.filter(x => x.net < -0.01).map(x => ({ p: x.payer, v: -x.net }));
 const gets = rows.filter(x => x.net > 0.01).map(x => ({ p: x.payer, v: x.net }));
 const transfers = [];
 let i = 0, j = 0;
 while (i < owes.length && j < gets.length) {
  const v = Math.min(owes[i].v, gets[j].v);
  if (v > 0.01) transfers.push({ from: owes[i].p, to: gets[j].p, amt: r2(v) });
  owes[i].v -= v; gets[j].v -= v;
  if (owes[i].v <= 0.01) i++;
  if (gets[j].v <= 0.01) j++;
 }
 const lines = [];
 lines.push("AA 结算 · 共 ¥" + total + " · " + n + " 人 · 人均 ¥" + r2(per));
 rows.forEach(r => {
  const t = r.net > 0.01 ? "应收回 ¥" + r.net : (r.net < -0.01 ? "应支付 ¥" + (-r.net) : "已持平");
  lines.push("· " + r.payer + "：实付 ¥" + r.paid + " · " + t);
 });
 if (transfers.length) {
  lines.push("结清方式：");
  transfers.forEach(t => lines.push("· " + t.from + " → " + t.to + " ¥" + t.amt));
 } else {
  lines.push("结清方式：账目已平，无需转账");
 }
 return { total, people: n, per: r2(per), rows, transfers, text: lines.join("\n") };
}

/* ---------- 行程打卡进度（与足迹联动：这趟行程已打卡 X / 共 Y 个景点） ---------- */
function tripFoot(plan) {
 if (!plan || !plan.days || !plan.days.length) return null;
 const seen = new Set();
 let done = 0;
 plan.days.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  if (isFrameName(it.name)) return;
  const k = cleanSpotName(it.name);
  if (!k || seen.has(k)) return;
  seen.add(k);
  if (isVisited(it.name)) done++;
 }));
 return { done, total: seen.size, pct: seen.size ? Math.round(done / seen.size * 100) : 0 };
}

/* ---------- 每日花费聚合（账本按日柱状图用，取最近 N 个有账的日期） ---------- */
function spendByDay(limit) {
  const map = {};
  getLedger().forEach(x => {
    const d = String(x.date || "").slice(5);
    if (!d) return;
    map[d] = (map[d] || 0) + (Number(x.amt) || 0);
  });
  const keys = Object.keys(map).sort().slice(-(limit || 10));
  const max = Math.max.apply(null, keys.map(k => map[k]).concat([1]));
  return keys.map(k => ({ label: k, amt: Math.round(map[k]), h: Math.max(8, Math.round(map[k] / max * 100)) }));
}

/* ---------- 旅行手记（每天一句，存本机 miniNotesV1） ---------- */
const NOTES_KEY = "miniNotesV1";
function getNotes() { return store.get(NOTES_KEY, []); }
function noteOf(date) { const x = getNotes().find(n => n.date === date); return x ? x.txt : ""; }
function addNote(date, txt) {
  const t = String(txt || "").trim().slice(0, 120);
  if (!t) return getNotes();
  const list = getNotes().filter(x => x.date !== date);
  list.push({ date: String(date || ""), txt: t, ts: Date.now() });
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  store.set(NOTES_KEY, list.slice(-200));
  return getNotes();
}
function delNote(date) { store.set(NOTES_KEY, getNotes().filter(x => x.date !== date)); }

/* ---------- 行程内换景点：从同城池挑一个本行程没排过的替换，并自动重排当天行文 ---------- */
// 取某天可换的候选景点（同城池 − 整份行程已用 − 当前这条）
function swapCandidates(plan, di, ix) {
 if (!plan || !plan.days || !plan.days[di]) return [];
 const day = plan.days[di];
 const it = day.items && day.items[ix];
 if (!it) return [];
 const raw = String(it.name || "");
 if (!raw || isFrameName(raw)) return [];
 const cityName = segCityOfDay(plan, di) || plan.cityName || "";
 const city = findCity(cityName);
 const pool = poolOfCity(city) || [];
 const used = new Set();
 (Array.isArray(plan.days) ? plan.days : []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(x => {
  const k = cleanSpotName(x.name);
  if (k) used.add(k);
 }));
 const curKey = cleanSpotName(raw);
 return pool.filter(n => {
  const k = cleanSpotName(n);
  return k && k !== curKey && !used.has(k) && !isFrameName(n);
 });
}
// 执行替换：保留原条目的时段/时长结构，只换核心景点名，随后重排当天行文
function swapSpot(plan, di, ix, pickName) {
 const cands = swapCandidates(plan, di, ix);
 if (!cands.length) return null;
 const day = plan.days[di];
 const it = day.items[ix];
 const oldRaw = String(it.name || "");
 const curKey = cleanSpotName(oldRaw);
 const pick = pickName && cands.indexOf(pickName) >= 0
  ? pickName
  : cands[Math.floor(Math.random() * cands.length)];
 const newName = (curKey && oldRaw.indexOf(curKey) >= 0) ? oldRaw.replace(curKey, pick) : pick;
 day.items[ix] = Object.assign({}, it, { name: newName });
 try { normalizeDayItems(day.items); } catch (e) {}
 return { name: pick, cityName: segCityOfDay(plan, di) || plan.cityName || "", left: cands.length - 1 };
}

/* ---------- v1.15 按标签换/加同类景点 ---------- */
// 候选按标签过滤：swapCandidates 基础上只留 spotTagOf 命中 tag 的景点
function swapCandidatesByTag(plan, di, ix, tag) {
 const cands = swapCandidates(plan, di, ix);
 if (!tag) return cands;
 const cityName = segCityOfDay(plan, di) || (plan && plan.cityName) || "";
 return cands.filter(n => {
  const tags = spotTagOf(n, cityName);
  return tags.some(t => t === tag || t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0);
 });
}
function swapSpotByTag(plan, di, ix, tag) {
 const cands = swapCandidatesByTag(plan, di, ix, tag);
 if (!cands.length) return null;
 const day = plan.days[di];
 const it = day.items[ix];
 const pick = cands[Math.floor(Math.random() * cands.length)];
 const curKey = cleanSpotName(String(it.name || ""));
 const newName = (curKey && String(it.name || "").indexOf(curKey) >= 0) ? String(it.name || "").replace(curKey, pick) : pick;
 day.items[ix] = Object.assign({}, it, { name: newName });
 try { normalizeDayItems(day.items); } catch (e) {}
 return { name: pick, cityName: segCityOfDay(plan, di) || plan.cityName || "", left: cands.length - 1 };
}

/* ---------- 预算 gauge（账本实际花费 vs 行程总预算参考，供 plan/today 复用） ---------- */
function budgetGauge(plan) {
 try {
  if (!plan || !plan.days || !plan.days.length) return null;
  const bo = budgetTotalObj(plan);
  const raw = bo && bo.totalBudget;
  let totalBud = 0;
  if (typeof raw === "number") totalBud = raw;
  else if (typeof raw === "string") {
   const nums = String(raw).split("-").map(Number).filter(n => isFinite(n) && n > 0);
   if (nums.length) totalBud = nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  if (!(totalBud > 0)) return null;
  totalBud = Math.round(totalBud);
  const spent = Math.round(totalSpent());
  const over = spent > totalBud;
  const pct = Math.min(100, Math.round(spent / totalBud * 100));
  const left = Math.max(0, totalBud - spent);
  return { spent, total: totalBud, pct, over, left,
   txt: "已花 ¥" + spent + " / 预算约 ¥" + totalBud + (over ? " · 已超支，收一收啦" : " · 还剩 ¥" + left) };
 } catch (e) { return null; }
}

/* ---------- 一句话记账：按规则解析「打车 32」「午饭128元」「门票 ¥80」 ---------- */
// 关键词 → 分类（顺序即优先级：交通 > 门票 > 住宿 > 餐饮 > 购物）
const QUICK_CAT_RULES = [
  [/打车|出租|滴滴|网约|地铁|公交|高铁|动车|火车|机票|机票|车票|大巴|轮渡|油费|停车|共享单车|单车/, "交通"],
  [/门票|景区票|入园|展览|缆车|索道|演出|演出票/, "门票"],
  [/酒店|住宿|民宿|房费|青旅|客栈|钟点房/, "住宿"],
  [/餐|饭|面|小吃|奶茶|咖啡|烧烤|火锅|串|包子|早餐|午餐|晚餐|夜宵|甜品|饮料|水果|啤酒/, "餐饮"],
  [/伴手礼|特产|纪念品|文创|衣服|衣|鞋|药妆|化妆品|购物|超市|便利店/, "购物"]
];
function guessCat(name) {
  const s = String(name || "");
  for (let i = 0; i < QUICK_CAT_RULES.length; i++) {
    if (QUICK_CAT_RULES[i][0].test(s)) return QUICK_CAT_RULES[i][1];
  }
  return "其他";
}
// 从自由文本里抠出第一个金额 + 剩下的说明，自动猜分类
function parseQuickBill(str) {
  const s = String(str || "").trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const amt = Math.round(parseFloat(m[1]) * 100) / 100;
  if (!(amt > 0)) return null;
  let name = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length))
    .replace(/[¥￥]/g, " ").replace(/块钱|块|元|rmb|RMB/gi, " ")
    .replace(/[，,。.;；]/g, " ").replace(/\s+/g, " ").trim();
  const cat = guessCat(name || s);
  if (!name) name = cat + " · 随手记";
  return { amt: amt, name: name, cat: cat };
}

/* ---------- 预算分配对比（建议 住宿45/餐饮22/交通20/门票13 vs 账本实际） ---------- */
const SPLIT_BASE = { 住宿: 0.45, 餐饮: 0.22, 交通: 0.20, 门票: 0.13 };
function budgetSplit(plan) {
  try {
    if (!plan || !plan.days || !plan.days.length) return null;
    const g = budgetGauge(plan);
    const total = g ? g.total : 0;
    if (!(total > 0)) return null;
    const real = {};
    getLedger().forEach(x => { const c = x.cat || "其他"; real[c] = (real[c] || 0) + (Number(x.amt) || 0); });
    const realTotal = Math.round(totalSpent());
    const rows = Object.keys(SPLIT_BASE).map(c => {
      const sug = Math.round(total * SPLIT_BASE[c]);
      const r = Math.round(real[c] || 0);
      return { cat: c, sug: sug, real: r, diff: r - sug, over: r > sug * 1.15 };
    });
    const maxV = Math.max.apply(null, rows.map(r => Math.max(r.sug, r.real)).concat([1]));
    rows.forEach(r => {
      r.sugW = Math.max(4, Math.round(r.sug / maxV * 100));
      r.realW = Math.max(4, Math.round(r.real / maxV * 100));
    });
    return { total: total, realTotal: realTotal, rows: rows, hasReal: realTotal > 0 };
  } catch (e) { return null; }
}

/* ---------- 行程体检：把「排得太满 / 要预约没订 / 没有留白 / 费腿连排」这类问题挑出来 ---------- */
function tripCheck(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  const days = plan.days;
  const items = [];
  const warn = (t, x) => items.push({ t: t, x: x, lv: "warn" });
  const info = (t, x) => items.push({ t: t, x: x, lv: "info" });
  // ① 单日景点过多 / 过少
  days.forEach((d, di) => {
    const n = daySpots(d).length;
    if (n >= 6) warn("D" + (di + 1) + " 排了 " + n + " 个点", "一天跑 6 个以上会很赶，建议挪 1-2 个到别的天或改成自由活动");
    else if (n === 0) info("D" + (di + 1) + " 没有具体安排", "机动 / 休整日；想加内容可在「出发」页勾想玩后重排");
  });
  // ② 全程没有留白
  const hasFree = days.some(d => (Array.isArray(d.items) ? d.items : []).some(it => /自由活动|留白|休整|自由探索/.test(String(it.name || ""))));
  if (days.length >= 3 && !hasFree) info("全程没有留白", "连玩 " + days.length + " 天容易累，建议某天下午留 2-3 小时机动");
  // ③ 需要预约但还没勾「已订」
  const track = getTicketTrack();
  const dict = D.SPOT_TICKETS || {};
  const need = [];
  const seen = new Set();
  days.forEach((d, di) => (Array.isArray(d.items) ? d.items : []).forEach(it => {
    const n = String(it.name || "");
    if (isFrameName(n)) return;
    const cn = cleanSpotName(n);
    if (!cn || seen.has(cn)) return;
    seen.add(cn);
    let tk = dict[n] || dict[cn];
    if (!tk) { for (const k in dict) { if (cn.indexOf(k) >= 0 && dict[k]) { tk = dict[k]; break; } } }
    if (!tk || !tk.book) return;
    const keyCity = segCityOfDay(plan, di) || plan.cityName;
    if (!(track[tkKeyOf(keyCity, n)] || {}).done) need.push(cn);
  }));
  if (need.length) warn(need.length + " 个景点需要提前预约", "「" + need.slice(0, 3).join("、") + (need.length > 3 ? " 等" : "") + "」要去官方渠道订；订完到「出行准备」勾已订");
  // ④ 费腿连排
  let heavy = 0, heavyDay = -1;
  days.forEach((d, di) => {
    let h = 0;
    (Array.isArray(d.items) ? d.items : []).forEach(it => { try { if (P.spotEffort && P.spotEffort(it.name) >= 2) h++; } catch (e) {} });
    if (h > heavy) { heavy = h; heavyDay = di; }
  });
  if (heavy >= 2) info("D" + (heavyDay + 1) + " 有 " + heavy + " 段费腿安排", "爬山 / 长线徒步建议放体力好的前两天，穿舒适鞋、带水");
  // ⑤ 首日抵达晚 / 末日返程早
  const d0 = days[0] || {};
  if ((Array.isArray(d0.items) ? d0.items : []).some(it => /抵达|到达/.test(String(it.name || "")) && /晚上|夜间|深夜|傍晚/.test(String(it.period || ""))))
    info("首日抵达较晚", "第一天以入住休整为主，别再排夜间远门景点");
  const dN = days[days.length - 1] || {};
  if ((Array.isArray(dN.items) ? dN.items : []).some(it => /返程|回程/.test(String(it.name || "")) && /早上|清晨|上午/.test(String(it.period || ""))))
    info("末日返程较早", "提前 1 晚收拾行李，高铁提前 1 小时 / 飞机 2 小时到站");
  // ⑥ 跨城日（多站行程的转场天）提示
  if (Array.isArray(plan.segments) && plan.segments.length > 1) {
    plan.segments.forEach((s, i) => {
      if (i === 0) return;
      warn("D" + (s.startDay + 1) + " 是转场日 · 前往" + s.cityName, "跨城当天时间会被交通吃掉，别再排满景点，预留 3-5 小时在路上了");
    });
  }
  if (!items.length) return { level: "ok", needSlim: false, items: [{ t: "这趟行程没什么可挑的", x: "强度适中、该约的都在掌握中，直接出发吧", lv: "ok" }] };
  const hasWarn = items.some(x => x.lv === "warn");
  // 有单日 ≥6 个景点的天 → 页面显示「一键减负」
  const needSlim = days.some(d => daySpots(d).length >= 6);
  return { level: hasWarn ? "warn" : "info", needSlim: needSlim, items: items.slice(0, 6) };
}

/* ---------- v1.15 行程体检报告（可复制的出行前摘要） ---------- */
function tripHealth(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  const lines = [];
  const push = s => lines.push(s);
  push("【" + (plan.cityName || "我的行程") + " · " + plan.days.length + " 天 · 出行前体检】");
  const ck = tripCheck(plan) || { items: [] };
  if (ck.items && ck.items.length) {
    push("— 提醒 —");
    ck.items.slice(0, 6).forEach(it => push("· " + it.t + (it.x ? "（" + it.x + "）" : "")));
  }
  push("— 每日强度 —");
  plan.days.forEach((d, di) => {
    const n = daySpots(d).length;
    const pace = n <= 2 ? "轻松" : n <= 4 ? "适中" : "偏赶";
    let legs = 0;
    try { const rs = routeScore(plan, di); if (rs && rs.km) legs = rs.km; } catch (e) {}
    push("D" + (di + 1) + " " + (d.date || "").slice(5) + " · " + n + " 点 · " + pace + (legs ? " · 动线约 " + legs + "km" : ""));
  });
  const city = findCity(activeCityOf(plan) || plan.cityName || "");
  if (city && city.climate) {
    const w = weatherPackList(city.name || city.name) || [];
    if (w.length) push("— 天气穿搭 —");
    w.forEach(x => push("· " + x));
  }
  return { text: lines.join("\n"), lines };
}

/* ---------- 自动行李清单（按天数 / 季节 / 气候 / 行程特色生成，勾选存 miniPrepV1 的 pg_ 前缀） ---------- */
function packSmart(plan) {
  const days = Math.max(1, (plan && plan.days && plan.days.length) || 3);
  const depStr = String((plan && plan.depart) || "").slice(0, 10);
  let month = new Date().getMonth() + 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(depStr)) month = parseInt(depStr.slice(5, 7), 10) || month;
  const season = SEASON_KEYS[month] || "秋";
  const city = findCity(activeCityOf(plan) || (plan && plan.cityName) || "");
  const climate = (city && city.climate) || "temperate";
  const isMulti = !!(plan && plan.segments && plan.segments.length > 1);
  // 行程特色：山 / 海 / 高原 / 古镇（决定特殊装备）
  let hasMountain = false, hasSea = false, hasOld = false;
  (plan && plan.days ? plan.days : []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
    const n = String(it.name || "");
    if (/山|峰|岭|崖|谷|长城/.test(n)) hasMountain = true;
    if (/海|岛|湾|滩|湖/.test(n)) hasSea = true;
    if (/古镇|古城|老街|巷|村落|民居/.test(n)) hasOld = true;
  }));
  // v1.12.3：换洗衣物按「2 天 1 套」估算并封顶 6 套（原来 ceil(days/1.5)+1 会让 4 天带 4 套、袜子 5 双，明显过量）
  const sets = Math.min(6, Math.max(2, Math.ceil(days / 2)));
  const G = [];
  G.push({ title: "证件与钱", items: ["身份证 / 学生证（半价门票靠它）", "车票机票订单截图（断网也能看）", "银行卡 + 少量现金", "酒店确认单 / 预约码"] });
  const cloth = ["换洗衣物 " + sets + " 套（" + days + " 天行程）"];
  if (season === "冬") cloth.push("厚外套 / 羽绒服", "保暖内衣 · 围巾手套");
  else if (season === "夏") cloth.push("速干短袖 · 薄外套", "防晒衣 / 冰袖");
  else cloth.push("薄外套（早晚温差）", "长袖 1-2 件");
  cloth.push("舒适步行鞋 · 袜子 " + Math.min(6, sets + 1) + " 双");
  if (climate === "tropical" || climate === "subtropical") cloth.push("雨具（当地多阵雨）");
  if (climate === "plateau" || climate === "alpine") cloth.push("防风冲锋衣 · 高原防晒");
  if (climate === "cold" || climate === "temperate_continental") cloth.push("保暖中层 · 手套");
  G.push({ title: "衣物", items: cloth });
  G.push({ title: "电子", items: ["充电宝（≤20000mAh 随身）", "数据线 + 充电头", "耳机", "相机 + 备用电池", "插线板（一人带一个就够）"] });
  const care = ["牙刷牙膏 · 洗面奶", "防晒霜（SPF30+）· 墨镜", "常用药（肠胃 / 感冒 / 晕车）", "创可贴 · 纸巾湿巾"];
  if (hasMountain) care.push("护膝 / 登山杖（可当地租）", "驱蚊液");
  if (hasSea) care.push("拖鞋 · 防水袋", "泳衣 / 速干毛巾");
  G.push({ title: "洗护与药品", items: care });
  const other = [];
  if (isMulti) other.push("分装袋 · 行李牌（多站转场好找）");
  if (hasOld) other.push("少量零钱（网络不好时使用）");
  other.push("折叠伞（晴雨两用）", "水杯", "备用口罩 / 雨衣（轻便款）");
  G.push({ title: "其他", items: other });
  // 勾选状态（复用 miniPrepV1，pg_ 前缀，自动纳入备份）
  const checks = getPrepChecks();
  const groups = G.map(g => ({
    title: g.title,
    items: g.items.map(t => ({ k: "pg_" + t, t: t, done: !!checks["pg_" + t] }))
  }));
  let total = 0, done = 0;
  groups.forEach(g => g.items.forEach(i => { total++; if (i.done) done++; }));
  return { groups: groups, total: total, done: done, pct: total ? Math.round(done / total * 100) : 0, season: season };
}

/* ---------- 旅行成就徽章（基于足迹 / 手记 / 账本 / 行程存档） ---------- */
function achievements() {
  const f = footStats();
  const notes = getNotes().length;
  const bills = getLedger().length;
  const plans = listSavedPlans().length;
  const DEF = [
    { id: "first", t: "初出茅庐", d: "打卡第一个景点", cur: f.spots, need: 1 },
    { id: "spot5", t: "小有足迹", d: "累计打卡 5 个景点", cur: f.spots, need: 5 },
    { id: "spot10", t: "打卡达人", d: "累计打卡 10 个景点", cur: f.spots, need: 10 },
    { id: "city3", t: "城市猎人", d: "点亮 3 座城市", cur: f.cities, need: 3 },
    { id: "city6", t: "走遍四方", d: "点亮 6 座城市", cur: f.cities, need: 6 },
    { id: "note5", t: "记录的人", d: "写下 5 篇旅行手记", cur: notes, need: 5 },
    { id: "bill20", t: "精打细算", d: "累计记 20 笔账", cur: bills, need: 20 },
    { id: "plan3", t: "行程规划师", d: "保存 3 份行程", cur: plans, need: 3 }
  ];
  const list = DEF.map(x => Object.assign({}, x, {
    ok: x.cur >= x.need,
    pct: Math.min(100, Math.round(x.cur / x.need * 100)),
    ptxt: Math.min(x.cur, x.need) + "/" + x.need
  }));
  const got = list.filter(x => x.ok).length;
  return { list: list, got: got, total: list.length, pct: Math.round(got / list.length * 100) };
}

/* ---------- 行程强度总览（plan 页头部：景点数 / 城市数 / 天数 / 强度标签） ---------- */
function tripOverview(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  let spots = 0, frames = 0, heavy = 0;
  const seen = new Set();
  plan.days.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
    const n = String(it.name || "");
    if (isFrameName(n)) { frames++; return; }
    const k = cleanSpotName(n);
    if (k && !seen.has(k)) seen.add(k);
    spots++;
    try { if (P.spotEffort && P.spotEffort(n) >= 2) heavy++; } catch (e) {}
  }));
  const days = plan.days.length;
  const per = Math.round(seen.size / days * 10) / 10;
  const level = heavy >= 3 ? "强度偏高" : (per >= 3.5 ? "节奏紧凑" : (per >= 2 ? "张弛有度" : "轻松休闲"));
  const cities = Array.isArray(plan.segments) && plan.segments.length ? plan.segments.length : 1;
  return {
    days: days, cities: cities, spots: seen.size, rows: spots, heavy: heavy, perDay: per, level: level,
    text: days + " 天 · " + (cities > 1 ? cities + " 城 · " : "") + seen.size + " 个景点 · 日均 " + per + " 个"
  };
}

/* ================= v1.6.0 新功能 ================= */

/* ---------- ① 单日「加 / 删」一个景点（行程加减法） ---------- */
// 新加景点的时段：接在当天最后一个游览点之后（上午→下午→晚上）
function _dayPeriodAfter(day) {
  const ords = ["上午", "下午", "晚上"];
  const spots = daySpots(day);
  if (!spots.length) return "下午";
  const last = String(spots[spots.length - 1].period || "");
  const i = ords.indexOf(last);
  if (i < 0) return "晚上";
  return ords[Math.min(ords.length - 1, i + 1)];
}
function _daySyncCount(day) {
  try {
    day.spotCount = daySpots(day).length;
    day.pace = day.spotCount <= 2 ? "轻松" : (day.spotCount <= 3 ? "适中" : "紧凑");
  } catch (e) {}
}
// 该天还能加的同城景点（同城池 - 全程已排）
function dayAddCandidates(plan, di, bias) {
  if (!plan || !plan.days || !plan.days[di]) return [];
  const cityName = segCityOfDay(plan, di) || plan.cityName || "";
  const pool = poolOfCity(findCity(cityName)) || [];
  const used = {};
  (Array.isArray(plan.days) ? plan.days : []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(x => {
    const k = cleanSpotName(x.name);
    if (k) used[k] = 1;
  }));
  let cands = pool.filter(n => {
    const k = cleanSpotName(n);
    return k && !used[k] && !isFrameName(n);
  });
  // v1.15：加景点跟随游玩偏好（历史/自然）。优先同标签候选；不足时回退全池，避免无点可加。
  if (bias === "history" || bias === "nature") {
    const want = bias === "history" ? "历史古迹" : "自然风光";
    const same = cands.filter(n => spotTagOf(n, cityName).some(t => t === want));
    if (same.length) cands = same;
  }
  return cands;
}
// name 为空/命中池子 = 加一个当地经典景点；否则 = 用户自定义（库里没有 → 不编介绍）
function dayAddSpot(plan, di, name) {
  if (!plan || !plan.days || !plan.days[di]) return null;
  const day = plan.days[di];
  const cands = dayAddCandidates(plan, di);
  const nm = name ? String(name).trim() : "";
  const inPool = nm ? cands.some(n => cleanSpotName(n) === cleanSpotName(nm)) : true;
  const pick = nm || (cands[0] || "");
  if (!pick) return null;
  const custom = !!nm && !inPool;
  // v1.13.1：往这天补景点时，先把整段空白占位（自由活动 · 第N天留白）清掉，
  // 否则会出现「留白 + 新景点并存」，看起来仍像空一块
  const blank = /^自由活动\s*·\s*第\s*\d+\s*天留白$/;
  if (day.items.some(it => it && blank.test(String(it.name || "")))) {
   day.items = day.items.filter(it => !(it && blank.test(String(it.name || ""))));
  }
  // v1.15.1：新景点必须插在「最后一个非框架条目之后」——否则会被 push 到「返程/前往下一站」后面，
  //          出现「傍晚返程 → 晚上再去某景点」的荒谬顺序。
  // 时段同理：当天已有返程/转场时，新景点跟随最后一个真实景点的时段（不晚于返程），
  // 避免出现「晚上景点 → 傍晚返程」这种时序倒挂。
  const hasReturn = (day.items || []).some(it => /返程|前往/.test(String(it && it.name || "")));
  let newPeriod = _dayPeriodAfter(day);
  if (hasReturn) {
    const lastSpot = daySpots(day);
    const lp = lastSpot.length ? String(lastSpot[lastSpot.length - 1].period || "") : "";
    if (lp === "上午" || lp === "下午") newPeriod = lp;
    else if (newPeriod === "晚上") newPeriod = "下午";
  }
  const newItem = {
    name: pick,
    period: newPeriod,
    note: custom ? "自己加的点，可长按详情里换一个或删掉" : "本市经典去处，可灵活安排半天",
    custom: custom || undefined
  };
  let at = -1;
  for (let i = 0; i < day.items.length; i++) {
    if (!isFrameName(day.items[i] && day.items[i].name)) at = i;
  }
  if (at >= 0) day.items.splice(at + 1, 0, newItem);
  else day.items.push(newItem);
  try { normalizeDayItems(day.items); } catch (e) {}
  _daySyncCount(day);
  return { name: pick, custom: custom, left: cands.length, cityName: segCityOfDay(plan, di) || plan.cityName || "" };
}
function dayRemoveSpot(plan, di, ix) {
  if (!plan || !plan.days || !plan.days[di]) return null;
  const day = plan.days[di];
  const it = day.items && day.items[ix];
  if (!it) return null;
  const raw = String(it.name || "");
  if (!raw || isFrameName(raw)) return null;
  day.items.splice(ix, 1);
  try { normalizeDayItems(day.items); } catch (e) {}
  _daySyncCount(day);
  return { name: cleanSpotName(raw), left: daySpots(day).length, cityName: segCityOfDay(plan, di) || plan.cityName || "" };
}


/* ---------- ③ 每日预算额度与剩余 ---------- */
function dailyBudget(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  const bo = budgetTotalObj(plan) || {};
  let total = 0;
  const raw = bo.totalBudget;
  if (typeof raw === "number") total = raw;
  else if (typeof raw === "string") {
    const nums = String(raw).split("-").map(Number).filter(n => isFinite(n) && n > 0);
    if (nums.length) total = nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  const days = plan.days.length;
  const perDay = total > 0 ? Math.round(total / days) : 0;
  const byDate = {};
  getLedger().forEach(x => {
    const d = String(x.date || "").slice(0, 10);
    if (d) byDate[d] = (byDate[d] || 0) + (Number(x.amt) || 0);
  });
  const today = store.fmtLocalDate(new Date());
  let todayRow = null, overDays = 0, usedTotal = 0;
  const rows = plan.days.map((d, di) => {
    const ds = String(d.date || "").slice(0, 10);
    const spent = Math.round(byDate[ds] || 0);
    usedTotal += spent;
    if (perDay > 0 && spent > perDay) overDays++;
    const r = {
      no: di + 1, date: ds, md: ds.slice(5).replace("-", "/"),
      spent: spent, allow: perDay, left: perDay - spent,
      over: perDay > 0 && spent > perDay,
      pct: perDay > 0 ? Math.min(100, Math.round(spent / perDay * 100)) : 0,
      isToday: ds === today
    };
    if (r.isToday) todayRow = r;
    return r;
  });
  return {
    perDay: perDay, total: Math.round(total), rows: rows,
    today: todayRow, overDays: overDays, used: Math.round(usedTotal),
    left: Math.round(total - usedTotal)
  };
}

/* ---------- ④ 花费预测：按已花日均推算全程总额，对照预算 ---------- */
function spendForecast(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  const st = todayState(plan);
  const days = plan.days.length;
  let elapsed = 0, left = days;
  if (st && st.phase === "during") { elapsed = Math.max(1, st.idx + 1); left = Math.max(0, days - elapsed); }
  else if (st && st.phase === "after") { elapsed = days; left = 0; }
  const spent = Math.round(totalSpent());
  const perDay = elapsed > 0 ? Math.round(spent / elapsed) : 0;
  const forecast = Math.round(spent + perDay * left);
  let budget = 0;
  try {
    const bo = budgetTotalObj(plan) || {};
    const raw2 = bo.totalBudget;
    if (typeof raw2 === "number") budget = raw2;
    else if (typeof raw2 === "string") {
      const nums = String(raw2).split("-").map(Number).filter(n => isFinite(n) && n > 0);
      if (nums.length) budget = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
  } catch (e) {}
  budget = Math.round(budget);
  const over = budget > 0 && forecast > budget;
  const pct = budget > 0 ? Math.min(200, Math.round(forecast / budget * 100)) : 0;
  let txt = "";
  if (!elapsed) txt = spent > 0
    ? "已提前花 ¥" + spent + " · 出发后照此节奏全程约 ¥" + forecast
    : "还没开始花，按预算每日约 ¥" + (budget ? Math.round(budget / days) : perDay);
  else if (over) txt = "照这个花法全程约 ¥" + forecast + "，超预算 ¥" + (forecast - budget);
  else if (budget > 0) txt = "照这个花法全程约 ¥" + forecast + "，预算还剩 ¥" + (budget - forecast);
  else txt = "照这个花法全程约 ¥" + forecast;
  return { spent: spent, elapsed: elapsed, left: left, perDay: perDay, forecast: forecast, budget: budget, over: over, pct: pct, txt: txt };
}

/* ---------- ⑤ 旅行小结（结束后/随时可看的成绩卡） ---------- */
function tripReview(plan) {
  if (!plan || !plan.days || !plan.days.length) return null;
  const ov = tripOverview(plan) || {};
  const fp = tripFoot(plan) || {};
  const days = plan.days.length;
  const byDate = {}, byCat = {};
  let bills = 0, spent = 0;
  getLedger().forEach(x => {
    const a = Number(x.amt) || 0;
    spent += a; bills++;
    const d = String(x.date || "").slice(0, 10);
    if (d) byDate[d] = (byDate[d] || 0) + a;
    const c = String(x.cat || "其他");
    byCat[c] = (byCat[c] || 0) + a;
  });
  const topDay = Object.keys(byDate).sort((a, b) => byDate[b] - byDate[a])[0] || "";
  const topCat = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0] || "";
  const st = todayState(plan) || {};
  return {
    days: days, cities: ov.cities || 1, spots: ov.spots || 0,
    visited: fp.done || 0, visitPct: fp.pct || 0,
    spent: Math.round(spent), avg: Math.round(spent / days), bills: bills,
    topDay: topDay, topDayAmt: Math.round(byDate[topDay] || 0),
    topCat: topCat, topCatAmt: Math.round(byCat[topCat] || 0),
    notes: getNotes().length,
    cityName: plan.cityName || "",
    phase: st.phase || "before",
    title: (plan.cityName || "这次") + " · " + days + " 天小结",
    text: days + " 天 · " + (ov.spots || 0) + " 个景点 · 打卡 " + (fp.done || 0) + " 个 · 花了 ¥" + Math.round(spent)
  };
}

/* ---------- ⑥ 同行人（AA / 记账付款人共用） ---------- */
const MATES_KEY = "miniMatesV1";
function getMates() { return store.get(MATES_KEY, []); }
function addMate(name) {
  const n = String(name || "").trim();
  if (!n) return false;
  const l = getMates();
  if (l.indexOf(n) >= 0) return false;
  l.push(n);
  store.set(MATES_KEY, l);
  return true;
}
function delMate(i) {
  const l = getMates();
  if (!(i >= 0) || i >= l.length) return false;
  l.splice(i, 1);
  store.set(MATES_KEY, l);
  return true;
}

/* ---------- ⑦ 出发倒计时（首页 / 今天页头部 D-day） ---------- */
function tripCountdown(plan) {
  const st = todayState(plan);
  if (!st) return null;
  const city = plan.cityName || "";
  if (st.phase === "before") {
    const n = st.daysLeft;
    return {
      phase: "before", big: String(n), unit: "天", sub: "后出发 · " + city,
      tip: n <= 1 ? "明天就走：证件、车票、充电宝再过一遍" :
           n <= 3 ? "倒计时 " + n + " 天：该收拾行李、确认门票预约了" :
           n <= 10 ? "还有 " + n + " 天：先把要预约的门票订好" :
           "还有 " + n + " 天：行程已就绪，出发前一周再确认一次"
    };
  }
  if (st.phase === "during") {
    return {
      phase: "during", big: "D" + st.dayNo, unit: "/" + st.total,
      sub: "旅途中 · " + city,
      tip: st.dayNo === st.total ? "最后一天：留点时间买伴手礼" :
           "第 " + st.dayNo + " 天 / 共 " + st.total + " 天，玩得开心"
    };
  }
  return {
    phase: "after", big: String(st.daysSince), unit: "天", sub: "前结束 · 已归来",
    tip: "去「更多」看看旅行小结和成就徽章"
  };
}

/* ---------- ⑧ 城市速览（最佳季节 / 建议天数 / 气候 / 必吃） ---------- */
const CLIMATE_TXT = {
  temperate: "温带 · 四季分明", subtropical: "亚热带 · 夏热冬温", tropical: "热带 · 全年温热",
  plateau: "高原 · 昼夜温差大", alpine: "高寒 · 全年偏冷", cold: "寒温带 · 冬季漫长",
  temperate_continental: "温带大陆性 · 干燥少雨", desert: "干旱 · 少雨多风", maritime: "海洋性 · 温和湿润"
};
const COST_TXT = { high: "消费偏高", mid: "消费适中", low: "消费亲民" };
// v1.17.10：美食泛化占位词 —— 用户明确「要么具体，要么不写」，这类词一律不展示
const F_GENERIC_FOOD = /本地招牌菜|老字号小吃|本地特色|特色小吃|当地美食|本地味道|招牌菜|特色菜/;
function cityBrief(cityName) {
  const c = findCity(cityName);
  if (!c) return null;
  // v1.17.10：generic 兜底城（id==="generic"，如把省名当城市查）内容全是泛化占位
  //（「当地代表性景点」「本地招牌菜」「XX市中心」），速览宁可不显示也不展示套话。
  if (c.id === "generic") return null;
  const exp = (Array.isArray(c.experiences) ? c.experiences : []).length;
  // v1.17.4：按真实游览强度估算 —— 每天约 3 个景点（已计入城际/城内通勤与用餐）。
  // 旧公式 round(exp/2.4) 且 [2,5] 夹取，导致景点多的城市（30+）恒为 5 天、少的恒为 2 天，与真实脱节。
  const days = Math.min(8, Math.max(2, Math.round(exp / 3))) || 3;
  return {
    name: c.name,
    climate: c.climate || "", climateTxt: CLIMATE_TXT[c.climate] || "气候宜人",
    cost: c.cost || "mid", costTxt: COST_TXT[c.cost] || "消费适中",
    best: c.best || "四季皆宜",
    days: days,
    // v1.17.10：剔掉「本地招牌菜/老字号小吃」这类泛化占位，用户要的是具体菜名；全泛化时干脆不显示
    foods: (Array.isArray(c.foods) ? c.foods : []).filter(f => !F_GENERIC_FOOD.test(String(f))).slice(0, 6),
    foodNote: c.foodNote || "",
    areas: (Array.isArray(c.areas) ? c.areas : []).slice(0, 3).map(a => ({ name: a.name, note: a.note })),
    stayTip: c.stayTip || "",
    travel: c.cityTravel || c.travel || "",
    text: c.name + " · 建议 " + days + " 天 · " + (CLIMATE_TXT[c.climate] || "")
  };
}

// v1.17.10：全省精华游的「省级速览」—— 此前省域行程误用 cityBrief(省名)，
// 而 findCity 对省名会返回 generic 兜底城（experiences 只有 1 条占位），
// 于是建议天数算成 2 天、必吃显示「本地招牌菜/老字号小吃」。改为按全省真实口径统计。
function provBrief(province) {
  try {
    const pv = String(province || "");
    if (!pv) return null;
    const cities = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[pv]) || [];
    if (!cities.length) return null;
    const info = (D.PROVINCE_INFO && D.PROVINCE_INFO[pv]) || {};
    const capCity = (D.PROVINCE_CAPITAL && D.PROVINCE_CAPITAL[pv]) || cities[0];
    const base = findCity(capCity, pv) || {};
    // 全省景点总数（各城 experiences 合计，去重）
    const seenSpot = new Set();
    cities.forEach(cn => {
      const c = findCity(cn, pv);
      ((c && c.experiences) || []).forEach(e => { if (e && e.name) seenSpot.add(cleanSpotName(e.name)); });
    });
    const spotTotal = seenSpot.size;
    let foods = (Array.isArray(info.foods) ? info.foods : []).filter(f => !F_GENERIC_FOOD.test(String(f)));
    if (!foods.length) foods = (Array.isArray(base.foods) ? base.foods : []).filter(f => !F_GENERIC_FOOD.test(String(f)));
    const days = provinceSuggestedDays(pv);
    return {
      name: pv,
      days,
      spotTotal,
      cityTotal: cities.length,
      isProv: true,
      climate: base.climate || "",
      climateTxt: CLIMATE_TXT[base.climate] || "气候宜人",
      cost: base.cost || "mid",
      costTxt: COST_TXT[base.cost] || "消费适中",
      best: info.best || base.best || "四季皆宜",
      foods: foods.slice(0, 8),
      foodNote: info.foodNote || base.foodNote || "",
      areas: cities.slice(0, 3).map((c, i) => ({ name: c, note: i === 0 ? "省会/交通枢纽，住宿首选" : "省内主要城市，可高铁串联" })),
      stayTip: base.stayTip || "全省游建议选省会或交通枢纽连住，用高铁/动车辐射周边景点，避免每天换酒店。",
      travel: info.travel || base.travel || "省内城市间高铁/动车最方便，景点分散可自驾或包车。",
      text: pv + " · 建议 " + days + " 天 · 全省 " + cities.length + " 城 " + spotTotal + " 景点"
    };
  } catch (e) { return null; }
}

/* ---------- 主题（浅/暗双主题，默认浅色；暗色根类 .td 定义在 app.wxss） ---------- */
const THEME_KEY = "themeV1";
// 偏好：light / dark；老值 "auto"（跟随系统）已下线，按浅色处理
function themePref() {
  const v = store.get(THEME_KEY, "");
  return v === "dark" ? "dark" : "light";
}
function setThemePref(p) { store.set(THEME_KEY, p === "dark" ? "dark" : "light"); }
function sysTheme() {
  try {
    if (typeof wx !== "undefined" && wx.getSystemInfoSync) {
      const i = wx.getSystemInfoSync() || {};
      if (i.theme === "dark") return "dark";
    }
  } catch (e) {}
  return "light";
}
// 实际生效主题（「跟随系统」已移除；夜间自动深色独立生效）
function themeMode() {
  if (isNightHour()) return "dark";
  return themePref();
}
function setThemeMode(m) { setThemePref(m === "dark" ? "dark" : "light"); }
// 页面根 view 类名：暗色主题返回 "td"，浅色返回 ""（page{} 默认即浅色值）
function themeRootClass() { return themeMode() === "dark" ? "td" : ""; }
// 导航栏/状态栏配色跟随主题（默认导航栏页面每次展示时调用；frontColor 仅支持黑白）
function applyNav(mode) {
 const dark = (mode || themeMode()) === "dark";
 try {
  wx.setNavigationBarColor({
   frontColor: dark ? "#ffffff" : "#000000",
   backgroundColor: dark ? "#0d0d0d" : "#eaeff7"
  });
  // 2026-10-29（v1.19.126 修正）：窗口底色跟随主题 + 中性黑；app.wxss 的 page 根已改为不透明 #0d0d0d，
  // 双保险根除"导航栏与内容之间的缝隙白线"（setBackgroundColor 仅管下拉 overscroll 视口，page 根才是常规接缝底色）
  if (wx.setBackgroundColor) {
   wx.setBackgroundColor({
    backgroundColor: dark ? "#0d0d0d" : "#eaeff7",
    backgroundColorTop: dark ? "#0d0d0d" : "#eaeff7",
    backgroundColorBottom: dark ? "#0d0d0d" : "#eaeff7"
   });
  }
 } catch (e) {}
}
// tabBar（底部原生频道条）配色跟随主题：默认壳已配置为浅色 + 深灰图标；切到深色时动态覆盖配色与图标
function applyTabBar(mode) {
 const dark = (mode || themeMode()) === "dark";
 try {
  wx.setTabBarStyle({
   color: dark ? "#8495ad" : "#5b6b82",
   selectedColor: "#d4a94e",
   backgroundColor: dark ? "#0d0d0d" : "#ffffff",
   borderStyle: dark ? "black" : "white"
  });
  // 浅色 tabBar 用深灰图标（images/tab-light-*.png），深色切回原白线条（images/tab-*.png）保证可读
  const tabs = [
   { index: 0, light: "images/tab-light-index.png", dark: "images/tab-index.png" },
   { index: 1, light: "images/tab-light-today.png", dark: "images/tab-today.png" },
   { index: 2, light: "images/tab-light-plan.png", dark: "images/tab-plan.png" },
   { index: 3, light: "images/tab-light-more.png", dark: "images/tab-more.png" }
  ];
  for (const t of tabs) {
   wx.setTabBarItem({
    index: t.index,
    iconPath: dark ? t.dark : t.light,
    selectedIconPath: dark ? t.dark.replace(/^images\/tab-/, "images/tab-").replace(/\.png$/, "-active.png")
               : t.light.replace(/^images\/tab-light-/, "images/tab-").replace(/\.png$/, "-active.png")
   });
  }
  applyNav(dark ? "dark" : "light");
 } catch (e) {}
}

/* ---------- 字号（全局 1=标准 / 2=大 / 3=特大，默认 1；长辈友好） ---------- */
const FONT_KEY = "miniFontScaleV1";
function fontScale() {
  const n = Number(store.get(FONT_KEY, 1));
  return ([1, 2, 3].indexOf(n) >= 0) ? n : 1;
}
function setFontScale(v) {
  const n = ([1, 2, 3].indexOf(Number(v)) >= 0) ? Number(v) : 1;
  store.set(FONT_KEY, n);
  return n;
}

/* ---------- 手动调序后的行文归一（与网页版同文本实现，务必两处同步） ---------- */
// 硬交换会把「时段 + 动作前缀」一起搬走，造成「上午=继续深度游览」等病句。
// 每次手动调整后按新顺序：时段自然排序 → 重写行名——
//  ① 同一天同一景点第 1 段为「深度游览/游览」，其后出现才用「继续深度游览/继续游览」；
//  ② 被搬到段首的「继续…」自动降级为正常游览；
//  ③ 「抵达 + 直奔」只允许出现在跨城（抵达/出发前往）框架之后的段首，否则降级为普通深度游览；
//  ④ 跨城/返程等框架行不参与行文重写，天然形成「墙」，游览点不可跨墙换位。
function normalizeDayItems(items) {
 if (!Array.isArray(items)) return items;
 // 时段自然排序。「中午」排上午与下午之间（跨城日的中午出发行必须卡在两个城市的游览之间）。
 const ORDER = { "凌晨": -1, "早上": 0, "清晨": 0, "上午": 1, "中午": 1.5, "下午": 2, "傍晚": 3, "晚上": 4, "深夜": 5, "夜间": 5, "全天": 6 };
 items.sort((a, b) => ((ORDER[a.period] != null ? ORDER[a.period] : 99)) - ((ORDER[b.period] != null ? ORDER[b.period] : 99)));
 const PRE = /^(?:继续深度游览|继续游览|深度游览|抵达 \+ 直奔|抵达 \+ 深度游览|抵达 \+ 入住|抵达 \+ |出发前往|出发去|前往|凌晨出发，前往)/;
 // 框架「墙」行 = 跨城/返程/入住/退房等行文骨架（含不带景点动作的「抵达/到达」），
 // 天然分段，游览点不可跨墙延续；注意「抵达 + 直奔/深度游览」是游览点不是墙。
 const FRAME = /^(?:出发前往|出发去|前往|返程|凌晨出发|退房|回酒店|入住|抵达 \+ 入住)|^(?:抵达|到达)(?!\s*\+)/;
 const BLOCK = /自由活动|自由探索|留白|备选|休整|早餐|午餐|晚餐|早点休息|看日出|下山|当地美食|当地自由/;
 let seen = {};    // 当前「段」内已出现的景点 key → 首次出现样式（deep/plain）
 let segOpen = true; // 段首或紧跟框架之后：下一个「抵达+…」游览点可保留抵达语境
 const keyOf = n => String(n || "").trim().replace(PRE, "").replace(/[（(【][^)）】]*[)）】]/g, "").replace(/^「|」$/g, "").trim();
 const setPre = (n, pre) => {
  const s = String(n || "").trim();
  const m = s.match(PRE);
  return m ? pre + s.slice(m[0].length) : s;
 };
 const styleOf = n => {
  const s = String(n || "").trim();
  if (/^(?:继续深度游览|深度游览)/.test(s)) return "deep";
  if (/^抵达 \+ (?:直奔|深度游览)/.test(s)) return "arrive";
  return "plain";
 };
 for (let i = 0; i < items.length; i++) {
  const it = items[i];
  if (!it) continue;
  const raw = String(it.name || "");
  if (FRAME.test(raw)) { seen = {}; segOpen = true; continue; } // 框架「墙」：开新段
  if (!raw || BLOCK.test(raw)) continue; // 非游览内容不参与
  const k = keyOf(raw);
  if (!k) continue;
  const st1 = styleOf(raw);
  if (seen[k] !== undefined) { // 同段同景点第 ≥2 次 → 固化「继续…」；未带前缀的普通行不画蛇添足
   const np = setPre(raw, (seen[k] === "deep" || seen[k] === "arrive") ? "继续深度游览" : "继续游览");
   if (np !== raw) it.name = np;
   continue;
  }
  if (st1 === "arrive") { // 「抵达+直奔/深度游览」属游览点（抵达语境）
   if (segOpen) continue; // 段首/紧跟跨城框架：保留「抵达+…」开场直达，且不占「第1次游览」名额
   it.name = setPre(raw, "深度游览"); // 脱离抵达语境（本地日中间被换进来）→ 降级为普通深度游览
   seen[k] = "deep";
   segOpen = false;
   continue;
  }
  if (/^继续(?:深度游览|游览)/.test(raw)) { // 被搬到段首的「继续…」降级为正常游览
   it.name = setPre(raw, st1 === "deep" ? "深度游览" : "游览");
   seen[k] = st1 === "deep" ? "deep" : "plain";
  } else {
   seen[k] = st1;
  }
  segOpen = false;
 }
 return items;
}


/* ================= v1.7.0 新增 ================= */

/* ---------- 1. 景点间交通建议（相邻点位怎么去、要多久） ---------- */
const AREA_FAR = /(山|峰|岭|湖|岛|林|草原|沙漠|古镇|古村|长城|陵|窟|沟|峡谷|瀑布|梯田|湿地|国家公园)/;
const AREA_HUB = /(机场|火车站|高铁站|客运站|码头|口岸|汽车站)/;
function _areaOf(name) {
  const n = String(name || "");
  if (AREA_HUB.test(n)) return "hub";
  if (AREA_FAR.test(n)) return "far";
  return "mid";
}
// 返回 { legs:[{from,to,mode,minutes,tip}], totalMin, count, text }
function routeAdvice(plan, di) {
  const day = (plan && plan.days && plan.days[di]) || null;
  if (!day) return null;
  const uniq = [];
  daySpots(day).forEach(it => {
    let n = cleanSpotName(it.name);
    if (!n) return;
    n = String(n).split("+")[0].replace(/[「」（）()]/g, "").trim();
    if (n && uniq.indexOf(n) < 0) uniq.push(n);
  });
  if (uniq.length < 2) return null;
  const legs = [];
  let total = 0;
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i], b = uniq[i + 1];
    const aa = _areaOf(a), bb = _areaOf(b);
    let mode = "地铁 / 公交", min = 18, tip = "市内常规通勤";
    if (aa === "hub" || bb === "hub") { mode = "地铁快线"; min = 45; tip = "往返枢纽，建议预留 1 小时"; }
    else if (aa === "far" || bb === "far") { mode = "打车 / 包车"; min = 40; tip = "郊区路段，拼车更划算"; }
    if (a.slice(0, 2) === b.slice(0, 2)) { mode = "步行"; min = 10; tip = "同一片区，边走边逛"; }
    total += min;
    legs.push({ from: a, to: b, mode: mode, minutes: min, tip: tip });
  }
  return {
    legs: legs, count: legs.length, totalMin: total,
    text: "串起来约 " + total + " 分钟在路上"
  };
}

/* ---------- 2. 汇率换算（离线内置，可自定义） ---------- */
const FX_KEY = "miniFxV1";
const FX_RATES = {
  CNY: 1, USD: 0.14, EUR: 0.13, JPY: 21.5, HKD: 1.09, KRW: 190, THB: 5.0,
  SGD: 0.19, GBP: 0.11, AUD: 0.21, CAD: 0.19, CHF: 0.12, NZD: 0.23,
  MYR: 0.63, VND: 3500, TWD: 4.5, MOP: 1.12, RUB: 12.5, INR: 11.7,
  IDR: 2200, PHP: 8.0, AED: 0.51, TRY: 4.5, EGP: 6.8, ZAR: 2.6
};
const FX_LIST = ["CNY", "USD", "EUR", "JPY", "HKD", "KRW", "THB", "SGD", "GBP", "AUD", "MYR", "TWD"];
function fxRates() { return Object.assign({}, FX_RATES, store.get(FX_KEY, {})); }
function fxSetRate(code, v) {
  const o = store.get(FX_KEY, {});
  const n = parseFloat(v);
  if (!(n > 0)) return fxRates();
  o[code] = n; store.set(FX_KEY, o); return fxRates();
}
function fxConvert(amt, from, to) {
  const r = fxRates();
  const a = parseFloat(amt) || 0;
  const f = r[from] != null ? r[from] : 1;
  const t = r[to] != null ? r[to] : 1;
  return Math.round(a / f * t * 100) / 100;
}

/* ---------- 3. 足迹热力图（按省份点亮） ---------- */
// 返回 { provs:[{name,n,level}], max, visited, total }
function footHeatmap() {
  const f = _footRaw();
  const cs = f.cities || {};
  const agg = {};
  Object.keys(cs).forEach(name => {
    const prov = (D.CITY2PROV && D.CITY2PROV[name]) || (cs[name] && cs[name].province) || "";
    if (!prov) return;
    agg[prov] = (agg[prov] || 0) + 1;
  });
  // v1.8.4 B14：全量 34 省级宫格（没去过的置灰 level0），一眼看清「点亮全国」的进度
  const PROVS = D.PROVINCES || [];
  const list = PROVS.map(p => {
    const n = agg[p] || 0;
    return { name: p, n: n, level: n === 0 ? 0 : (n >= 4 ? 4 : (n === 3 ? 3 : (n === 2 ? 2 : 1))) };
  });
  const visited = list.filter(x => x.n > 0).length;
  return { provs: list, visited: visited, cities: Object.keys(cs).length };
}

/* ---------- 4. 账本月度汇总 ---------- */
// 返回 { months:[{ym,label,total,count,top,topAmt}], best, worst }
function ledgerMonthly() {
  const all = getLedger();
  const m = {};
  all.forEach(x => {
    const ym = String(x.date || "").slice(0, 7);
    if (!ym) return;
    if (!m[ym]) m[ym] = { ym: ym, total: 0, count: 0, cats: {} };
    m[ym].total += (parseFloat(x.amt) || 0);
    m[ym].count += 1;
    const c = x.cat || "其他";
    m[ym].cats[c] = (m[ym].cats[c] || 0) + (parseFloat(x.amt) || 0);
  });
  const months = Object.keys(m).sort().reverse().map(k => {
    const cs = Object.keys(m[k].cats).map(c => ({ cat: c, amt: m[k].cats[c] })).sort((a, b) => b.amt - a.amt);
    return {
      ym: k, label: k.replace("-", " 年 ") + " 月",
      total: Math.round(m[k].total), count: m[k].count,
      top: cs.length ? cs[0].cat : "", topAmt: cs.length ? Math.round(cs[0].amt) : 0
    };
  });
  return {
    months: months.slice(0, 6),
    best: months.length ? months.reduce((a, b) => (b.total < a.total ? b : a)) : null,
    worst: months.length ? months.reduce((a, b) => (b.total > a.total ? b : a)) : null
  };
}

/* ---------- 5. 收藏城市 → 一键多站行程 ---------- */
// favs 存的是城市名，返回可直接喂给 buildMultiPlan 的 route
function favRoute(maxN) {
  const favs = getFavs();
  const out = [];
  favs.forEach(n => {
    if (out.length >= (maxN || 4)) return;
    const prov = (D.CITY2PROV && D.CITY2PROV[n]) || "";
    if (!prov) return;
    out.push({ name: n, province: prov, days: 2 });
  });
  return out;
}

/* ---------- 6. 首页快捷入口自定义 ---------- */
const TILES_KEY = "miniTilesV1";
const HOME_TILES = [
  { k: "map", t: "路线地图", ic: "map", url: "/subpkg/map/map" },
  { k: "food", t: "必吃美食", ic: "food", url: "/subpkg/food/food" },
  { k: "ledger", t: "旅行账本", ic: "bill", url: "/subpkg/ledger/ledger" },
  { k: "prep", t: "出行准备", ic: "luggage", url: "/subpkg/prep/prep" },
  { k: "assistant", t: "本地速查", ic: "compass", url: "/subpkg/assistant/assistant" },
   { k: "today", t: "今天怎么走", ic: "sun", url: "/pages/today/today" }
 ];
 // v1.11：瓦片 key 索引 + 详情索引，替代反复 some()/find() 线性查找
 const HOME_TILE_KEYS = new Set(HOME_TILES.map(x => x.k));
 const HOME_TILE_BY_KEY = new Map(HOME_TILES.map(x => [x.k, x]));
 function homeTiles() {
   const saved = store.get(TILES_KEY, null);
   if (!saved || !saved.length) return HOME_TILES.map(x => x.k);
   return saved.filter(k => HOME_TILE_KEYS.has(k));   // v1.11：O(n·m) some() → Set O(n)
 }
 function setHomeTiles(list) {
  // v1.11：非数组入参（fuzz 抓到）不该写坏瓦片配置
  const src = Array.isArray(list) ? list : [];
  const ok = src.filter(k => HOME_TILE_KEYS.has(k));
  store.set(TILES_KEY, ok);
  return ok;
 }
 function homeTileList() {
   const keys = homeTiles();
   return keys.map(k => HOME_TILE_BY_KEY.get(k)).filter(Boolean);
 }

/* ---------- 7. 景点最佳时段 & 拥挤提示 ---------- */
const TIME_RULE = [
  { re: /(日出|索道|山|峰|岭|长城|梯田)/, best: "清晨 7-9 点", crowd: "低", tip: "早去人少光好，还能避开正午暴晒" },
  { re: /(寺|庙|观|博物馆|美术馆|宫|陵|故居|书院)/, best: "上午 9-11 点", crowd: "中", tip: "室内场馆上午最清静，注意周一闭馆" },
  { re: /(夜市|酒吧|江|江景|外滩|灯光|夜游|步行街|不夜)/, best: "晚上 19-21 点", crowd: "高", tip: "夜景主场，天黑后半小时最漂亮" },
  { re: /(海|沙滩|岛|湖|草原)/, best: "傍晚 16-18 点", crowd: "中", tip: "日落黄金一小时，光线最出片" },
  { re: /(公园|园|古镇|古村|巷|街)/, best: "下午 15-17 点", crowd: "中", tip: "下午光线柔和，逛起来最舒服" }
];
function spotTiming(name) {
  const n = cleanSpotName(name);
  for (let i = 0; i < TIME_RULE.length; i++) {
    if (TIME_RULE[i].re.test(n)) {
      return { name: n, best: TIME_RULE[i].best, crowd: TIME_RULE[i].crowd, tip: TIME_RULE[i].tip, hit: true };
    }
  }
  return { name: n, best: "按行程安排即可", crowd: "—", tip: "热门时段人会多一些，错峰更舒服", hit: false };
}

/* ---------- 8. 证件 / 出行必备清单 ---------- */
const DOC_ITEMS = [
  { k: "dc_id", t: "身份证", x: "住宿、购票、进站都要用" },
  { k: "dc_stu", t: "学生证", x: "多数景点半价，能省一大笔" },
  { k: "dc_bank", t: "银行卡 / 零钱", x: "小摊和网络差的景区只收现金" },
  { k: "dc_phone", t: "充电宝 + 数据线", x: "导航拍照很耗电，别低于 10000mAh" },
  { k: "dc_med", t: "常用药", x: "肠胃药、感冒药、创可贴" },
  { k: "dc_umbrella", t: "晴雨伞 / 防晒", x: "看天气卡提示准备" },
  { k: "dc_ticket", t: "预约凭证截图", x: "需预约景点提前截好图，断网也能进" },
  { k: "dc_insure", t: "旅游保险", x: "长途或户外项目建议买一份" }
];
function docItems() { return DOC_ITEMS.map(x => x); }
function docDone() {
  const c = getPrepChecks();
  return DOC_ITEMS.filter(x => c[x.k]).length;
}

/* ---------- 9. 旅行灵感（随机目的地） ---------- */
function inspire(seed) {
  const list = namedCities();
  if (!list.length) return null;
  const raw = (typeof seed === "number" && isFinite(seed)) ? seed : Math.floor(Math.random() * list.length);
  const i = ((raw % list.length) + list.length) % list.length;   // v1.11：负 seed 会取到 undefined
  const c = list[i];
  const b = cityBrief(c.name) || {};
  return {
    name: c.name,
    province: c.province || (D.CITY2PROV && D.CITY2PROV[c.name]) || "",
    days: b.days || 3,
    best: b.best || "四季皆宜",
    why: (c.desc || c.intro || (c.foods && c.foods.length ? "去吃 " + c.foods.slice(0, 2).join("、") : "")) ||
      (c.name + " · " + (b.climateTxt || "") + "，适合 " + (b.days || 3) + " 天慢游"),
    text: c.name + " · 建议 " + (b.days || 3) + " 天"
  };
}

/* ---------- 每日正当时（v1.19.87 日常灵感流） ---------- */
// 解析城市 best 字段的月份："4-5月、9-10月，春秋凉爽少雨" → [4,5,9,10]；"四季/全年/皆宜" → null（全月适宜）
function bestMonths(best) {
  const s = String(best || "");
  if (!s) return null;
  if (/四季|全年|皆宜/.test(s)) return null;
  const t = s.replace(/次年|翌年/g, "");   // 「11月到次年2月」跨年表述归一
  const ms = new Set();
  let m = null;
  const reR = /(\d{1,2})\s*月?\s*[-—~至到]\s*(\d{1,2})\s*月/g;
  while ((m = reR.exec(t))) {
    const a = +m[1], b = +m[2];
    if (a < 1 || a > 12 || b < 1 || b > 12) continue;
    if (b >= a) { for (let i = a; i <= b; i++) ms.add(i); }
    else { for (let i = a; i <= 12; i++) ms.add(i); for (let i = 1; i <= b; i++) ms.add(i); }  // 跨年区间「12-2月」
  }
  const reS = /(\d{1,2})\s*月/g;
  while ((m = reS.exec(s))) { const v = +m[1]; if (v >= 1 && v <= 12) ms.add(v); }
  return ms.size ? [...ms].sort((x, y) => x - y) : null;
}
// 「今日正当时」：以日期为种子的确定性灵感流（同一天每次打开结果一致——可期待、可分享），
// 只从数据够厚（experiences≥8、非 limited）且 best 月份命中当月的城市里按步长轮换取 3 个。
// 点击直达表单预填，把「无行程日打开 app 也有内容可看」变成日常习惯。now 参数仅供单测注入。
function dailyInspire(cnt, nowLike) {
  const now = (nowLike && typeof nowLike.getMonth === "function") ? nowLike : new Date();
  const month = now.getMonth() + 1;
  const seed = now.getFullYear() * 10000 + month * 100 + now.getDate();
  const pool = namedCities().filter(c => {
    if (!c || c.limited) return false;
    if (!Array.isArray(c.experiences) || c.experiences.length < 8) return false;
    const bm = bestMonths(c.best);
    if (bm && bm.indexOf(month) < 0) return false;
    return true;
  });
  const n = Math.min(cnt || 3, pool.length);
  if (!n) return [];
  const stride = Math.max(1, Math.floor(pool.length / n));
  const seen = {};
  const out = [];
  for (let k = 0; out.length < n && k < pool.length * 2; k++) {
    const c = pool[(seed + k * stride) % pool.length];
    if (!c || seen[c.name]) continue;
    seen[c.name] = 1;
    const b = cityBrief(c.name) || {};
    const spots = (c.experiences || [])
      .map(e => (e && e.name && !isFrameName(e.name)) ? String(e.name) : "")
      .filter(Boolean)
      .slice(0, 2);
    const bestShort = String(c.best || "四季皆宜").split(/[，,；;（(]/)[0].slice(0, 18);
    const spotsText = spots.join(" · ");
    // v1.19.90：四季城文案修正——best 为空/泛化（「四季皆宜」「全年宜游」）时：
    // why 不再出现「四季皆宜 · 四季皆宜」式重复；shareTitle 不再出现「10月的X正当时：四季皆宜」语义冲突
    const bm = bestMonths(c.best);
    const genericBest = /^(四季皆宜|全年宜游|四季|全年|全年宜)$/.test(bestShort);
    const why = bm ? month + "月正当时 · " + bestShort : (genericBest ? "四季皆宜" : "四季皆宜 · " + bestShort);
    // v1.19.89：分享标题单一逻辑源（页面直接消费），总长硬截 32 字（微信卡片最佳长度）
    let reason = (spotsText.split(" · ")[0] || "").slice(0, 12);
    if (!reason && !genericBest) reason = bestShort.slice(0, 12);
    let shareTitle = (bm ? month + "月的" + c.name + "正当时：" : c.name + "四季皆宜：")
      + (reason || "说走就走") + "｜离线攻略";
    if (shareTitle.length > 32) shareTitle = shareTitle.slice(0, 31) + "…";
    out.push({
      name: c.name,
      province: c.province || (D.CITY2PROV && D.CITY2PROV[c.name]) || "",
      days: b.days || 3,
      best: c.best || "四季皆宜",
      bestShort: bestShort,
      spotsText: spotsText,
      shareTitle: shareTitle,
      why: why
    });
  }
  return out;
}

/* ---------- 10. 夜间自动深色 ---------- */
const NIGHT_KEY = "miniNightV1";
function nightCfg() {
  const o = store.get(NIGHT_KEY, null);
  return { on: !!(o && o.on), from: (o && o.from != null) ? o.from : 22, to: (o && o.to != null) ? o.to : 7 };
}
function setNightCfg(o) {
  const cur = nightCfg();
  o = (o && typeof o === "object") ? o : {};   // v1.11：null 入参会崩
  const next = { on: o.on != null ? !!o.on : cur.on, from: o.from != null ? o.from : cur.from, to: o.to != null ? o.to : cur.to };
  store.set(NIGHT_KEY, next);
  return next;
}
function isNightHour() {
  const c = nightCfg();
  if (!c.on) return false;
  const h = new Date().getHours();
  return c.from > c.to ? (h >= c.from || h < c.to) : (h >= c.from && h < c.to);
}

/* ---------- 11. 消费凭证图片 ---------- */
const IMG_DIR = "bill_imgs";
function billImgPath(id) {
  const base = (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) ? wx.env.USER_DATA_PATH : "";
  return base ? (base + "/" + IMG_DIR + "/" + id + ".png") : "";
}
function setBillImg(date, idx, path) {
  const o = store.get("miniBillImgV1", {});
  o[date + "#" + idx] = path;
  store.set("miniBillImgV1", o);
  return o;
}
function getBillImg(date, idx) {
  const o = store.get("miniBillImgV1", {});
  return o[date + "#" + idx] || "";
}
function billImgMap() { return store.get("miniBillImgV1", {}); }
// 展示层具名演出兜底：老行程/缓存里若存着「看一场本地演出」「夜场脱口秀/演出」这类
// 无场馆无剧目的泛条目，渲染时换成该城市「具体场馆+演出」（planner 的 SHOW_TIPS）。
// 不改存储与 clean 名，避免影响换景点/打卡/想玩匹配；未收录城市保持原文。
function showDisp(name, cityName){
 const n = String(name || "");
 if(!/本地演出|脱口秀/.test(n)) return n;
 let L = null;
 try { L = P.showListOf ? P.showListOf(cityName) : null; } catch (e) {}
 if(!L || !L.length) return n;
 const s = (/脱口秀/.test(n) && L[1]) ? L[1] : L[0];
 if(!s) return n;
 return "「" + s.venue + "」看" + s.show;
}

/* ================= v1.8.4 档一 / 档二 ================= */

/* ---------- A1 日期提示（公假 / 暑假 / 周末 → 人流提醒；只报公历固定与长周期，宁可漏不误报） ---------- */
function _dOW(s) { return new Date(s.replace(/-/g, "/")).getDay(); }
function dateHintOf(dateStr) {
 const s = String(dateStr || "").slice(0, 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
 const mmdd = s.slice(5);
 const MM = Number(s.slice(5, 7)), DD = Number(s.slice(8, 10));
 if (MM === 1 && DD === 1) return { lv: "mid", txt: "元旦假期，核心商圈与地标人流大，热门餐厅建议提前订位" };
 if (MM === 5 && DD >= 1 && DD <= 5) return { lv: "big", txt: "五一假期，热门景区客流高峰，需预约的景点务必提前抢票、早到错峰" };
 if (MM === 10 && DD >= 1 && DD <= 7) return { lv: "big", txt: "国庆假期，全国性出游高峰，交通与门票紧张，尽早订票预约" };
 if (MM >= 7 && MM <= 8) return { lv: "mid", txt: "暑期档，亲子游集中，博物馆 / 乐园排队时间长，建议提前预约并早到" };
 const w = _dOW(s);
 if (w === 0 || w === 6) return { lv: "small", txt: "周末本地游客较多，热门点位早去或错峰体验更舒服" };
 return null;
}
function dateHintsForPlan(plan) {
 if (!plan || !plan.days) return [];
 const out = [];
 const seen = new Set();
 (Array.isArray(plan.days) ? plan.days : []).forEach(d => {
  const h = dateHintOf(d.date);
  if (!h || seen.has(h.txt)) return;
  seen.add(h.txt);
  out.push(Object.assign({ date: String(d.date).slice(0, 10) }, h));
 });
 return out.slice(0, 3);
}

/* ---------- A2 穿衣指数：按出行月份（dressForMonth）或当日实时温度（dressForTemp） ---------- */
function _seasonKeyOf(month) { return ({ 12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋" })[month] || "秋"; }
// v1.19.12：dressForMonth 纯函数（气候+月份→结果不变），今日页/行前多次调用 → memo
const _dressMemo = new Map();
function dressForMonth(city, dateStr) {
 const _mk = String((city && city.name) || "") + "|" + String((city && city.climate) || "") + "|" + String(dateStr || "");
 const _hit = _dressMemo.get(_mk);
 if (_hit !== undefined) return _hit;
 let _res = null;
 try {
  const c = city || {};
  const climate = c.climate || "temperate";
  const m = dateStr ? Number(String(dateStr).slice(5, 7)) : (new Date().getMonth() + 1);
  const sk = _seasonKeyOf(m);
  const cl = (D.CLOTH && D.CLOTH[climate] && D.CLOTH[climate][sk]) || null;
  const wx = (D.SEASON_WX && D.SEASON_WX[climate] && D.SEASON_WX[climate][sk]) || "";
  if (cl) _res = { season: sk + "季出行", weather: wx, lines: [cl.tops, cl.bottoms, cl.shoes].filter(Boolean), acc: cl.accessories || "", tip: cl.tip || "" };
 } catch (e) { _res = null; }
 if (_dressMemo.size > 5000) _dressMemo.clear();
 _dressMemo.set(_mk, _res);
 return _res;
}
// 实时温度 → 细粒度穿搭（今天页有天气数据时优先）
function dressForTemp(t) {
 if (!isFinite(t)) return null;
 let main = "", extra = [];
 if (t <= -5) { main = "羽绒服 + 毛衣 + 保暖内衣"; extra = ["厚围巾 / 帽子 / 手套", "防滑雪地靴或厚靴"]; }
 else if (t <= 5) { main = "厚外套 / 羽绒服 + 毛衣"; extra = ["围巾与手套", "内搭保暖，室内外温差大"]; }
 else if (t <= 12) { main = "风衣 / 夹克 + 长袖"; extra = ["早晚偏凉，备一件薄针织"]; }
 else if (t <= 18) { main = "薄外套 / 卫衣 + 长袖"; extra = ["早晚加薄外套"]; }
 else if (t <= 25) { main = "短袖 / 衬衫，早晚搭薄外套"; extra = ["防晒帽或遮阳"]; }
 else { main = "短袖 / 清凉夏装"; extra = ["防晒霜 + 墨镜 + 遮阳伞", "多补水"]; }
 return { main: main, extra: extra };
}

/* ---------- A3 美食按时段（早餐 / 正餐 / 夜宵）：关键词归类，未命中默认正餐 ---------- */
function mealSlotOf(name) {
 const n = String(name || "");
 if (/早餐|早点|早茶|豆浆|油条|包子|馄饨|烧麦|煎饼|豆腐脑|肠粉|生煎|小笼|粥|豆汁/.test(n)) return "early";
 if (/夜市|夜宵|大排档|小龙虾|烤串|烧烤|串串|夜啤酒/.test(n)) return "night";
 return "main";
}
const MEAL_SLOT_TXT = { early: "早餐", main: "正餐", night: "夜宵" };
function mealGroups(cityName) {
 const c = findCity(cityName);
 const out = { early: [], main: [], night: [] };
 (c && c.foods || []).forEach(f => { const s = mealSlotOf(f); out[s].push({ name: f, tag: "必吃", slot: s }); });
 const shops = (D.FOOD_SPOTS && D.FOOD_SPOTS[cityName]) || [];
 shops.forEach(sp => {
  if (!sp || !sp.food) return;
  const s = mealSlotOf(sp.food + " " + (sp.shop || ""));
  out[s].push({ name: sp.food, tag: "名店", shop: sp.shop, addr: sp.addr, lat: sp.lat, lon: sp.lon, price: sp.price });
 });
 return { early: out.early, main: out.main, night: out.night, txt: MEAL_SLOT_TXT };
}

/* ---------- A8 目的地盲盒：一次性给 3 个不重复灵感 ---------- */
function inspirePicks(n) {
 const list = namedCities();
 const N = Math.max(1, Math.min(n || 3, list.length));
 const idx = [];
 while (idx.length < N) {
  const k = Math.floor(Math.random() * list.length);
  if (idx.indexOf(k) < 0) idx.push(k);
 }
 return idx.map(k => inspire(k));
}

/* ---------- A4 账本归属行程：bill.trip = 行程签名；旧账无 trip 归「其它」 ---------- */
function tripSigOf(plan) {
 if (!plan) return "";
 const date0 = plan.days && plan.days[0] && plan.days[0].date ? String(plan.days[0].date).slice(0, 10) : "";
 return (plan.cityName || "") + "|" + (plan.totalDays || (Array.isArray(plan.days) ? plan.days : []).length) + "|" + date0;
}
function ledgerTrips() {
 const all = getLedger();
 const map = {};
 all.forEach(b => {
  const k = b.trip || "__other";
  if (map[k]) return;
  const parts = String(k).split("|");
  map[k] = parts.length >= 2 ? { key: k, label: parts[0] + " · " + parts[1] + " 天" } : { key: k, label: "本次行程" };
 });
 if (map.__other) map.__other = { key: "__other", label: "旧账（未分行程）" };
 const list = Object.keys(map).map(k => map[k]);
 return list.sort((a, b) => (a.key === "__other" ? 1 : b.key === "__other" ? -1 : a.label.localeCompare(b.label, "zh")));
}
function ledgerOfTrip(trip) {
 if (!trip || trip === "__all") return getLedger();
 return getLedger().filter(b => (trip === "__other") ? !b.trip : (b.trip === trip));
}

/* ---------- A6 人情往来（同行人借还，独立 miniIouV1） ---------- */
const IOU_KEY = "miniIouV1";
function iouList() { return store.get(IOU_KEY, []); }
function addIou(mate, what, amt, dir) {
 const list = iouList();
 list.unshift({
  mate: String(mate || "").trim(), what: String(what || "").trim(), amt: Math.max(0, Number(amt) || 0),
  dir: dir === "borrow" ? "borrow" : "lend", date: store.fmtLocalDate(new Date()), done: false
 });
 store.set(IOU_KEY, list.slice(0, 200));
 return list;
}
function toggleIou(i) {
 const list = iouList();
 if (!list[i]) return list;
 list[i].done = !list[i].done;
 store.set(IOU_KEY, list);
 return list;
}
function delIou(i) {
 const list = iouList();
 list.splice(i, 1);
 store.set(IOU_KEY, list);
 return list;
}
function iouStats() {
 const list = iouList();
 const out = { lend: 0, borrow: 0, lendDone: 0, borrowDone: 0, n: list.length };
 list.forEach(x => {
  if (x.dir === "lend") { out.lend += x.amt; if (x.done) out.lendDone += x.amt; }
  else { out.borrow += x.amt; if (x.done) out.borrowDone += x.amt; }
 });
 out.net = out.lend - out.borrow - (out.lendDone - out.borrowDone) * 0 + (out.borrowDone - out.lendDone);
 out.pending = (out.lend - out.lendDone) - (out.borrow - out.borrowDone); // 净应收（正=别人欠我）
 return out;
}

/* ---------- B12 景点停留估算 + 单日卡点预警（不假装精确，按类型给参考时长） ---------- */
function durOf(name) {
 const n = String(name || "");
 const H = (h) => ({ h: h, tip: "参考停留约 " + h + " 小时" });
 if (/博物馆|美术馆|科技馆|纪念馆|宫|院|展览|图书馆/.test(n)) return H(2.5);
 if (/演出|秀|剧|脱口秀/.test(n)) return H(2);
 if (/山|峰|谷|峡|长城|瀑布|森林公园|草原|湖|湿地/.test(n)) return H(3);
 if (/街|巷|坊|市|古镇|夜市|步行街/.test(n)) return H(2);
 if (/寺|庙|塔|教堂|陵|墓|碑/.test(n)) return H(1);
 if (/园|公园|广场|馆/.test(n)) return H(1.5);
 return H(1.5);
}
function dayLoad(plan, di) {
 const day = plan && plan.days && plan.days[di];
 if (!day) return null;
 const items = [];
 (Array.isArray(day.items) ? day.items : []).forEach(it => {
  if (isFrameName(it.name)) return;
  const n = cleanSpotName(it.name) || it.name;
  const d = durOf(n);
  items.push({ name: n, period: it.period || "", h: d.h });
 });
 const total = items.reduce((a, x) => a + x.h, 0);
 const over = Math.max(0, total - 12);
 const heavy = items.slice().sort((a, b) => b.h - a.h);
 return { n: items.length, hours: Math.round(total * 10) / 10, over: Math.round(over * 10) / 10,
  top: heavy.slice(0, 2), txt: "景点参考合计约 " + (Math.round(total * 10) / 10) + " 小时" +
   (over > 0 ? "，超出 12 小时可用时长 " + (Math.round(over * 10) / 10) + " 小时，建议减负" : "，节奏健康") };
}

/* ---------- B11 当天动线顺路度（真实坐标连线总里程 vs 片区跨度；示意点不计分） ---------- */
function _havKm(a, b) {
 const R = 6371, rad = x => x * Math.PI / 180;
 const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
 const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
 return 2 * R * Math.asin(Math.sqrt(h));
}
function routeScore(plan, di) {
 const day = plan && plan.days && plan.days[di];
 if (!day) return null;
 const cityName = segCityOfDay(plan, di) || (plan.cityName || "");
 const pts = [];
 const seen = new Set();
 (Array.isArray(day.items) ? day.items : []).forEach(it => {
  if (isFrameName(it.name)) return;
  const n = cleanSpotName(it.name);
  if (!n || seen.has(n)) return;
  seen.add(n);
  try {
   const c = P.getSpotCoord ? P.getSpotCoord(cityName, n) : null;
   if (c && c.lat && c.lon && c.approx === false) pts.push({ latitude: c.lat, longitude: c.lon, name: n });
  } catch (e) {}
 });
 if (pts.length < 2) return { ok: false, n: pts.length };
 let km = 0, mx = 0, mxIdx = 0;
 for (let i = 1; i < pts.length; i++) {
  const d = _havKm(pts[i - 1], pts[i]);
  km += d;
  if (d > mx) { mx = d; mxIdx = i; }
 }
 const avg = km / (pts.length - 1);
 let score;
 if (pts.length === 2) score = avg <= 15 ? 93 : avg <= 40 ? 82 : 66;
 else if (avg <= 6) score = 95;
 else if (avg <= 12) score = 89;
 else if (avg <= 25) score = 81;
 else if (avg <= 45) score = 71;
 else score = 58;
 let long = false;
 if (mx > 20 && mx > avg * 2.2) { long = true; score = Math.max(48, score - 12); }
 const txt = pts.length + " 个点 · 动线约 " + Math.round(km) + " km" + (long ? " · 有跨片区长转场（" + pts[mxIdx].name + "）" : "");
  const feel = score >= 88 ? "很顺路" : score >= 76 ? "较顺路" : score >= 62 ? "一般，有绕路" : "偏赶，建议挪点";
  // v1.11：分数档位色也在 JS 定好，WXML 不再判两遍
  return {
    ok: true, n: pts.length, km: Math.round(km), score: score, txt: txt, feel: feel, long: long,
    scoreCls: score >= 88 ? "rb-good" : (score >= 62 ? "rb-mid" : "rb-low")
  };
}

/* ---------- B17 城市打分 + 避坑小贴士（自存，回访时回显） ---------- */
const CITYNOTE_KEY = "miniCityNoteV1";
function getCityNote(cityName) { return (store.get(CITYNOTE_KEY, {}))[cityName] || null; }
function saveCityNote(cityName, score, tips) {
 const m = store.get(CITYNOTE_KEY, {});
 m[cityName] = { score: Math.max(0, Math.min(5, Number(score) || 0)), tips: (Array.isArray(tips) ? tips : []).slice(0, 8), ts: Date.now() };
 store.set(CITYNOTE_KEY, m);
 return m[cityName];
}
function delCityNote(cityName) {
 const m = store.get(CITYNOTE_KEY, {});
 delete m[cityName];
 store.set(CITYNOTE_KEY, m);
}
function allCityNotes() {
 const m = store.get(CITYNOTE_KEY, {});
 return Object.keys(m).map(c => Object.assign({ city: c }, m[c])).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/* ---------- B13 旅程回顾（全量足迹 / 账本 / 手记 / 存档聚合） ---------- */
function yearReport() {
 const f = footStats();
 const notes = getNotes();
 const plans = listSavedPlans();
 const bills = getLedger();
 const byCat = {};
 let spent = 0;
 bills.forEach(x => {
  const a = Number(x.amt);
  if (!isFinite(a) || a <= 0 || a > 1e6) return;
  spent += a;
  const c = x.cat || "其他";
  byCat[c] = (byCat[c] || 0) + a;
 });
 const topCats = Object.keys(byCat).map(c => ({ cat: c, amt: Math.round(byCat[c]) })).sort((a, b) => b.amt - a.amt).slice(0, 3);
 const cities = Object.keys((_footRaw().cities) || {});
 return {
  spent: Math.round(spent), billsN: bills.length, notesN: notes.length, plansN: plans.length,
  cities: cities, citiesN: cities.length,
  spotsN: f.spots, spotsList: Object.keys((_footRaw().spots) || {}).slice(0, 12),
  topCats: topCats, favsN: getFavs().length,
  txt: cities.length ? cities.join(" · ") : "还没点亮城市，出发去生成第一份行程吧"
 };
}

/* ---------- B18 首页预约提醒（读 prep 票务跟踪：有预约需求的票按 track.date 倒计时） ---------- */
function ticketRemind(plan) {
 if (!plan || !plan.days || !plan.days.length) return null;
 const dict = D.SPOT_TICKETS || {};
 const track = getTicketTrack();
 const seen = new Set();
 const need = [];
 (Array.isArray(plan.days) ? plan.days : []).forEach((d, di) => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const n = String(it.name || "");
  if (isFrameName(n)) return;
  const cn = cleanSpotName(n) || n;
  if (seen.has(cn)) return;
  seen.add(cn);
  let info = dict[n];
  if (!info) for (const k in dict) { if ((n.includes(k) || cn.includes(k)) && dict[k]) { info = dict[k]; break; } }
  if (!info || !info.book) return;
  const keyCity = segCityOfDay(plan, di) || plan.cityName;
  const t = track[tkKeyOf(keyCity, n)] || {};
  if (t.done) return;
  const today = store.fmtLocalDate(new Date());
  const dateStr = t.date || "";
  let left = -1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
   left = Math.round((new Date(dateStr.replace(/-/g, "/")) - new Date(today.replace(/-/g, "/"))) / 86400000);
  }
  need.push({ name: n, where: info.where || "", left: left, hasDate: /^\d{4}-\d{2}-\d{2}$/.test(dateStr), txt: dateStr });
 }));
 if (!need.length) return null;
 need.sort((a, b) => (a.left < 0 ? 1 : b.left < 0 ? -1 : a.left - b.left));
 const top = need[0];
 return { n: need.length, top: top, txt: top.hasDate
  ? (top.left > 7 ? "还有 " + top.left + " 天：" + top.name + " 记得预约" : top.left >= 0 ? "⚠️ " + top.name + (top.left === 0 ? " 今天就该约了" : " " + top.left + " 天后开放预约") : top.name + " 预约日期已过，看看是否补约")
  : top.name + " 需要提前预约" + (top.where ? "（" + top.where + "）" : "") + "，记得订票" };
}

/* ---------- B10 快捷短语（记账 / 手记通用） ---------- */
// 速记短语必须能直接记账（「名称 + 金额」）。原表里混了 4 条情绪感叹句，点了无法入账，2026-10-29 换掉。
const QUICK_PHRASES = ["打车 20", "午餐 45", "门票 60", "地铁 8", "咖啡 15", "纪念品 50", "晚餐 80", "住宿 300", "便利店 12", "水果 20"];
function quickPhrases() { return QUICK_PHRASES.slice(); }

/* ============================================================
   v1.8.5 档三（C 组）：预算体检 / 天数提示 / 顺路加站 / 门票预估
   账本占比·本周·高频分类 / 每日一句 / 足迹故事 / 想玩状态 / 城市足迹
   ============================================================ */
function _rngOf(s) {
 const m = String(s || "").match(/\d+(\.\d+)?/g);
 if (!m || !m.length) return null;
 const lo = parseFloat(m[0]), hi = m.length > 1 ? parseFloat(m[1]) : lo;
 return [Math.min(lo, hi), Math.max(lo, hi)];
}
// C1 预算体检：用户所选预算档 vs 城市消费档位的参考区间
function budgetCheckOf(plan) {
 if (!plan || !plan.cityName) return null;
 const c = findCity(plan.cityName);
 if (!c) return null;
 const cost = (c.cost && c.cost in COST_TXT) ? c.cost : "mid";
 const userTier = (plan.budget && plan.budget in D.BUDGETS) ? plan.budget : "mid";
 const ref = _rngOf(D.BUDGETS[cost] && D.BUDGETS[cost].daily);
 const u = _rngOf(D.BUDGETS[userTier] && D.BUDGETS[userTier].daily);
 const costTxt = COST_TXT[cost] || "消费适中";
 const userLabel = (D.BUDGETS[userTier] && D.BUDGETS[userTier].label) || "舒适型";
 const userDaily = (D.BUDGETS[userTier] && D.BUDGETS[userTier].daily) || "300-600";
 const refDaily = (D.BUDGETS[cost] && D.BUDGETS[cost].daily) || "300-600";
 if (!ref || !u) return { lv: "na", txt: "参考数据不足，先按感觉定预算吧", cost, costTxt, userTier, userLabel, userDaily, refDaily };
 const userMid = (u[0] + u[1]) / 2;
 let lv = "fit", txt;
 if (userMid < ref[0] * 0.85) {
  lv = "tight";
  txt = c.name + "消费" + costTxt + "，你选的「" + userLabel + "」档（日均 " + userDaily + " 元）可能偏紧，升一档更从容";
 } else if (userMid > ref[1] * 1.15) {
  lv = "loose";
  txt = c.name + costTxt + "，你留的「" + userLabel + "」档（日均 " + userDaily + " 元）比常见参考（" + refDaily + " 元）宽裕，机动金很足";
 } else {
  txt = c.name + costTxt + "，参考日均 " + refDaily + " 元，你选的「" + userLabel + "」档正好落在合理区间";
 }
 return { lv, txt, city: c.name, cost, costTxt, userTier, userLabel, userDaily, refDaily };
}
// C3 顺路加站候选：同省、未去过、不在当前行程里的城市（最多 2 座）
function nextStopPick(plan) {
 try {
  if (!plan || !plan.cityName) return [];
  const c = findCity(plan.cityName);
  const prov = (c && c.province) || (D.CITY2PROV && D.CITY2PROV[plan.cityName]) || "";
  let list = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || [];
  if (!list.length && D.CITIES) {
   list = D.CITIES.filter(x => (x.province || D.CITY2PROV[x.name]) === prov).map(x => x.name);
  }
  const used = new Set((Array.isArray(plan.segments) ? plan.segments : []).map(s => s.cityName).concat([plan.cityName]));
  return list.filter(x => !used.has(x)).slice(0, 2).map(name => {
   const cb = cityBrief(name);
   return { name, d: (cb && cb.days) || 3, best: (cb && cb.best) || "" };
  });
 } catch (e) { return []; }
}
// C2 单城天数偏长提示（超过城市推荐天数 2 天以上）
function cityLongHint(plan) {
 if (!plan || !plan.cityName || !Array.isArray(plan.days) || plan.days.length < 1) return null;
 if (plan.segments && plan.segments.length > 1) return null;
 const cb = cityBrief(plan.cityName);
 if (!cb) return null;
 const n = plan.days.length;
 if (n > cb.days + 1) return { n, rec: cb.days, over: n - cb.days, next: nextStopPick(plan) };
 return null;
}
// C4 门票预估：按行程内景点（去重）的挂牌票价合计
function ticketSumOf(plan) {
 try {
  const dict = D.SPOT_TICKETS || {};
  const seen = {}; let sum = 0, n = 0;
  (plan && plan.days || []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
   const nm = it && it.name;
   if (!nm || isFrameName(nm)) return;
   const cn = cleanSpotName(nm) || nm;
   if (seen[cn]) return; seen[cn] = 1;
   let t = dict[cn];
   if (!t) { for (const k in dict) { if (cn.indexOf(k) >= 0 && dict[k]) { t = dict[k]; break; } } }
   if (!t || !t.p) return;
   const s = String(t.p).replace(/[（(].*?[)）]/g, "");
   if (/免费|免票|无需/.test(s)) return;
   const m = s.match(/\d+(\.\d+)?/);
   if (!m) return;
   const v = parseFloat(m[0]);
   if (isNaN(v)) return;
   sum += v; n++;
  }));
  return { n, fee: Math.round(sum) };
 } catch (e) { return { n: 0, fee: 0 }; }
}
// C6 账本分类占比（正支出归因，退款负数单列）
function catPctOf(list) {
 const cat = {}; let pos = 0, neg = 0;
 // v1.11：bill 记录可能缺 amt/cat（导入的旧备份），且入参可能是对象而非数组
 const arr = Array.isArray(list) ? list : [];
 arr.forEach(x => {
  if (!x) return;
  const a = Number(x.amt != null ? x.amt : x.amount) || 0;
  const k = x.cat || "其他";
  if (a >= 0) { pos += a; cat[k] = (cat[k] || 0) + a; }
  else neg += Math.abs(a);
 });
 const rows = Object.keys(cat).map(k => ({ cat: k, sum: Math.round(cat[k] * 100) / 100, pct: pos > 0 ? Math.min(100, Math.round(cat[k] / pos * 100)) : 0 }))
  .sort((a, b) => b.sum - a.sum).slice(0, 6);
 return { rows, total: Math.round(pos * 100) / 100, refund: Math.round(neg * 100) / 100 };
}
function _ymdOf(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// C7 本周花费（周一 00:00 至今）
function weekSpent(list) {
 const now = new Date();
 const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
 const s0 = _ymdOf(mon), s1 = _ymdOf(now);
 let amt = 0, n = 0;
 (Array.isArray(list) ? list : getLedger()).forEach(x => { const d = String(x.date || ""); if (d >= s0 && d <= s1) { amt += (Number(x.amt) || 0); n++; } });
 return { amt: Math.round(amt * 100) / 100, n, from: s0, to: s1 };
}
// C8 本周账单可读文本（发给同行人对账 / 记周账）
function weekLedgerTxt(list) {
 const w = weekSpent(list);
 const lines = ["本周账单（" + w.from.slice(5) + " ~ " + w.to.slice(5) + "）"];
 (Array.isArray(list) ? list : getLedger()).forEach(x => {
  const d = String(x.date || "");
  if (d < w.from || d > w.to) return;
  const a = Number(x.amt) || 0;
  lines.push((d.slice(5) || "--") + "  " + (x.cat || "") + "  " + (a >= 0 ? "¥" + a : "-¥" + Math.abs(a)) + "  " + (x.name || ""));
 });
 lines.push("合计 ¥" + w.amt + " · " + w.n + " 笔");
 return lines.join("\n");
}
// C9 账本高频分类（快捷记账 chips 用）
function topCatsOf(list, n) {
 const m = {};
 (Array.isArray(list) ? list : []).forEach(x => { if (x.cat) m[x.cat] = (m[x.cat] || 0) + 1; });
 return Object.keys(m).map(k => ({ cat: k, n: m[k] })).sort((a, b) => b.n - a.n).slice(0, n || 4).map(x => x.cat);
}
/* C11 每日一句：本地小句库，按日期轮换（纯本地文案，无网络） */
const DAY_QUOTES = [
 { txt: "出发，是最好的出发方式。", from: "" },
 { txt: "把日子过成风景，把风景装进口袋。", from: "" },
 { txt: "路还长，天还亮，慢慢走。", from: "" },
 { txt: "去看没看过的山，去尝没尝过的面。", from: "" },
 { txt: "旅行不是逃离生活，而是让生活不设限。", from: "" },
 { txt: "地图之外，才是惊喜。", from: "" },
 { txt: "今天也要把脚步交给陌生的街道。", from: "" },
 { txt: "最好的相机，是愿意停留的眼睛。", from: "" },
 { txt: "远方不远，票根为证。", from: "" },
 { txt: "走走停停，遇见即是礼物。", from: "" },
 { txt: "把期待调成正好，把心情调成晴天。", from: "" },
 { txt: "旅行的意义，一半在路上，一半在回来后的回味。", from: "" },
 { txt: "陌生城市的第一缕阳光，值得早起。", from: "" },
 { txt: "行囊不必太重，够装好奇就够。", from: "" },
 { txt: "每一次出发，都是和更好的自己碰面。", from: "" },
 { txt: "把「有空再去」换成「明天就走」。", from: "" },
 { txt: "风景记不住脚程，只记得你的眼睛。", from: "" },
 { txt: "去的地方越多，越知道自己想去哪。", from: "" },
 { txt: "偶遇的小店，常是旅途的彩蛋。", from: "" },
 { txt: "在路上的人，口袋里总装着故事。", from: "" },
 { txt: "日子普通，出发让它闪闪发光。", from: "" },
 { txt: "见过山川湖海，也爱街角烟火。", from: "" },
 { txt: "下一站，未命名。", from: "" },
 { txt: "旅途的温柔，是把时间还给自己。", from: "" }
];
function quoteOfDay() {
 const d = new Date();
 const k = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
 const q = DAY_QUOTES[k % DAY_QUOTES.length] || DAY_QUOTES[0];
 return { txt: q.txt, from: q.from };
}
// C12 足迹故事文本：城市 → 景点，一键复制分享
function footStoryText() {
 const f = _footRaw(); const cs = f.cities || {}; const sp = f.spots || {};
 const lines = ["我点亮过 " + Object.keys(cs).length + " 座城市、" + Object.keys(sp).length + " 个地方："];
 Object.keys(cs).sort().forEach(city => {
  const arr = Object.keys(sp).filter(k => {
   const s = sp[k]; return (s.city === city) || ((s.name || "").indexOf(city) >= 0);
  }).map(k => sp[k].name || k);
  lines.push("· " + city + (arr.length ? "：" + arr.join("、") : ""));
 });
 return lines.join("\n");
}
// C13 想玩清单状态补标：已排进当前行程 / 已打卡去过
function wishStateMark(wishList, plan) {
 const pn = [];
 if (plan && plan.days) plan.days.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const nm = it && it.name;
  if (nm && !isFrameName(nm)) pn.push(cleanSpotName(nm) || nm);
 }));
 return (Array.isArray(wishList) ? wishList : []).map(w => {
  const wn = cleanSpotName(w.name) || w.name;
  const planned = pn.some(x => x === wn || (x && wn && (x.indexOf(wn) >= 0 || wn.indexOf(x) >= 0)));
  const visited = isVisited(w.name);
  return Object.assign({}, w, { planned, visited });
 });
}
// C20 城市足迹详情：某城市下打卡过的景点（含时间，倒序）
function footCityDetail(city) {
 if (!city) return { city: "", list: [], count: 0 };
 const f = _footRaw(); const sp = f.spots || {};
 const arr = Object.keys(sp).map(k => sp[k])
  .filter(s => (s.city === city) || ((s.name || "").indexOf(city) >= 0))
  .sort((a, b) => (b.ts || 0) - (a.ts || 0));
 return { city, list: arr.map(s => ({ name: s.name || "", ts: s.ts || 0 })), count: arr.length };
}

/* ================================================================
 * v1.9.0 · 四十项新功能（数据层）
 * 原则：纯函数、无网络、可单测（tools/check-new.mjs 有对应断言）
 * ================================================================ */
// —— 周一闭馆预警：常见「馆」类每周一闭（法定假日除外简化处理） ——
const CLOSED_MON_WORDS = ["博物馆", "博物院", "美术馆", "科技馆", "纪念馆", "展览馆", "艺术馆"];
function _isClosedMonSpot(name) {
 const n = String(name || "");
 return CLOSED_MON_WORDS.some(w => n.indexOf(w) >= 0);
}
function _parseYMD(s) {
 const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
 return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}
function _dowOf(s) { // 0=周日
 const p = _parseYMD(s);
 if (!p) return -1;
 return new Date(p.y, p.mo - 1, p.d).getDay();
}
function mondayClashOf(plan) {
 const out = [];
 if (!plan || !Array.isArray(plan.days)) return out;
 plan.days.forEach((d, di) => {
  const ds = String(d.date || "").slice(0, 10);
  if (_dowOf(ds) !== 1) return; // 非周一
  (Array.isArray(d.items) ? d.items : []).forEach(it => {
   const nm = it && it.name;
   if (nm && !isFrameName(nm) && _isClosedMonSpot(nm)) out.push({ di: di + 1, date: ds, name: cleanSpotName(nm) || nm });
  });
 });
 return out;
}
// —— 需提前预约的知名场馆（预约渠道提示） ——
const RESERVE_ADV = [
 { k: "故宫", adv: "故宫门票需提前 7 天 20:00 在官方小程序抢票" },
 { k: "布达拉宫", adv: "布达拉宫需提前 1-3 天在官方渠道预约（旺季名额紧张）" },
 { k: "莫高窟", adv: "莫高窟旺季须提前 15-30 天在官网预约，应急票当天难买" },
 { k: "三星堆", adv: "三星堆博物馆建议提前 3-5 天在小程序预约" },
 { k: "陕西历史博物馆", adv: "陕历博免费但需提前 3-7 天抢约，准点放票" },
 { k: "湖南博物院", adv: "湖南博物院（省博）免费需提前 3-7 天预约" },
 { k: "南京博物院", adv: "南博免费，周末需提前 3-5 天预约" },
 { k: "秦始皇兵马俑", adv: "兵马俑旺季建议提前 1-3 天购票并早到避开旅行团" },
 { k: "湖北省博物馆", adv: "湖北省博（越王勾践剑）免费需提前 3-5 天预约" },
 { k: "上海博物馆", adv: "上博（人民广场馆）需提前 7 天预约，东馆热门展需更早" }
];
function bookRemindOf(plan) {
 const out = [];
 if (!plan || !Array.isArray(plan.days)) return out;
 const seen = {};
 (Array.isArray(plan.days) ? plan.days : []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const nm = it && it.name;
  if (!nm || isFrameName(nm)) return;
  const cn = cleanSpotName(nm) || nm;
  if (seen[cn]) return; seen[cn] = 1;
  const hit = RESERVE_ADV.find(r => cn.indexOf(r.k) >= 0);
  if (hit) out.push({ name: cn, adv: hit.adv });
 }));
 return out;
}
// v1.19.31：本地速查「查景点」—— 把此前只入库、从未被读取的 SPOT_DETAILS 介绍库真正用起来
// （介绍 / 怎么玩 / 怎么去 + 门票 + 预约提示，纯本地、零网络）
function bookingTipOf(name) {
  const cn = cleanSpotName(name) || name;
  for (const r of (RESERVE_ADV || [])) if (r && r.k && (cn.indexOf(r.k) >= 0 || name.indexOf(r.k) >= 0)) return r.adv;
  for (const b of (D.BOOKING_TIPS || [])) if (b && b.kw && (cn.indexOf(b.kw) >= 0 || name.indexOf(b.kw) >= 0)) {
    return (b.days ? "需" + b.days + " " : "") + (b.where ? "· " + b.where : "");
  }
  return "";
}
// v1.19.35：城市维度离线简介兜底 —— 在本市 experiences 里按名（清洗后）找回该景点的 note。
// 通用名（人民公园/中山公园/博物馆…）多城同名，note 是按城市存的，按 cityName 取绝不会跨城误配。
// 作为 spotLookup 的最后兜底：扁平/by-city 都没有时，返回本市 note 当作简介（纯本地、零成本覆盖全部景点）。
function spotNoteInCity(rawName, cityName) {
  if (!cityName) return "";
  const c = findCity(cityName);
  if (!c || !Array.isArray(c.experiences)) return "";
  const raw = (rawName || "").trim();
  const n = cleanSpotName(raw) || raw;
  // 过滤行程合并名（「X + Y」等），它们不是真实景点名，会让子串匹配误配
  const isMerged = (nm) => nm.indexOf(" + ") >= 0 || nm.indexOf("→") >= 0 || nm.indexOf("／") >= 0 || nm.indexOf("｜") >= 0;
  // 1) 精确（原名 / 清洗后）
  for (const e of c.experiences) {
    if (!e || !e.name || isMerged(e.name)) continue;
    if (e.name === raw || e.name === n) return (e.note || "");
  }
  // 2) 清洗后互相包含（短名 ↔ 全名，如 故宫 ↔ 故宫博物院）
  for (const e of c.experiences) {
    if (!e || !e.name || isMerged(e.name)) continue;
    const en = cleanSpotName(e.name) || e.name;
    if (en && (en === n || en.indexOf(n) >= 0 || n.indexOf(en) >= 0)) return (e.note || "");
  }
  return "";
}
function spotLookup(rawName, cityName) {
  const name = (rawName || "").trim();
  if (!name) return { found: false };
  const n = cleanSpotName(name) || name;
  const SD = D.SPOT_DETAILS || {};
  const SDC = (cityName && D.SPOT_DETAILS_BY_CITY && D.SPOT_DETAILS_BY_CITY[cityName]) || null;
  // 城市维度优先（通用名安全，不跨城）：本市精确 / 子串命中
  let detKey = null, det = null, fromCity = false;
  if (SDC) {
    if (SDC[n]) { detKey = n; det = SDC[n]; fromCity = true; }
    else if (SDC[name]) { detKey = name; det = SDC[name]; fromCity = true; }
    else if (n.length >= 2) {
      for (const k in SDC) { if (k && (k.indexOf(n) >= 0 || n.indexOf(k) >= 0)) { detKey = k; det = SDC[k]; fromCity = true; break; } }
    }
  }
  // 扁平全局兜底（已审唯一名，含子串容错）—— 原有行为保持不变
  if (!det) {
    if (SD[n]) detKey = n;
    else if (SD[name]) detKey = name;
    else if (n.length >= 2) {
      for (const k in SD) { if (k && (k.indexOf(n) >= 0 || n.indexOf(k) >= 0)) { detKey = k; break; } }
    }
    det = detKey ? SD[detKey] : null;
  }
  const tk = ticketPriceOf(name);
  const bt = bookingTipOf(name);
  // 最后兜底：本市 experiences 的 note（城市维度，绝不跨城误配；纯本地、零数据成本覆盖全部景点）
  let note = "";
  if (!det && cityName) note = spotNoteInCity(name, cityName);
  const matchedCity = fromCity || !!note;
  return {
    found: !!(det || tk.known || bt || note),
    name: detKey || name, city: matchedCity ? cityName : "",
    intro: det ? (det.intro || "") : "",
    how: det ? (det.how || "") : "",
    route: det ? (det.route || "") : "",
    ticket: tk, booking: bt || "",
    note
  };
}
// —— 最佳出行月份命中徽章 ——
function bestSeasonHit(cityName, dateStr) {
 try {
  const c = findCity(cityName);
  if (!c || !c.best) return null;
  const p = _parseYMD(dateStr);
  if (!p) return null;
  const mo = p.mo;
  const txt = c.best;
  // 区间命中：抓「X-Y月」与「X月」，季节词兜底
  let hit = false;
  const seg = txt.replace(/[，,、。]/g, " ").split(/\s+/);
  const seas = { 春: [3, 4, 5], 夏: [6, 7, 8], 秋: [9, 10, 11], 冬: [12, 1, 2] };
  seg.forEach(s => {
   const m = s.match(/(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*月/);
   if (m) { if (mo >= +m[1] && mo <= +m[2]) hit = true; return; }
   const m2 = s.match(/(\d{1,2})\s*月/);
   if (m2 && +m2[1] === mo) { hit = true; return; }
   for (const k in seas) { if (s.indexOf(k) === 0 && seas[k].includes(mo)) hit = true; }
  });
  return { hit, month: mo, best: txt, mark: hit ? "正值最佳季节" : "非最旺季" };
 } catch (e) { return null; }
}
// —— 构成统计（人文 / 山水 / 场馆 / 乐园 / 街区） ——
function mixStat(plan) {
 const m = { 人文: 0, 山水: 0, 场馆: 0, 乐园: 0, 街区: 0 };
 (plan && plan.days || []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const nm = it && it.name;
  if (!nm || isFrameName(nm)) return;
  const n = cleanSpotName(nm) || nm;
  if (/博物馆|博物院|美术馆|科技馆|纪念馆|艺术馆|展览馆|海洋馆|动物园|植物园|水族馆/.test(n)) m.场馆++;
  else if (/乐园|世界|影视城|度假区|欢乐谷|方特|长隆/.test(n)) m.乐园++;
  else if (/山|峰|岭|峡|谷|瀑布|湖|江|海|岛|湾|泉|草原|沙漠|长城|梯田|溶洞|崖|溪|河|滩/.test(n)) m.山水++;
  else if (/古城|古镇|古村|街|巷|寺|庙|塔|陵|园|故居|书院|遗址|宫|楼|桥|里|弄/.test(n)) m.人文++;
  else m.街区++;
 }));
 const rows = Object.keys(m).map(k => ({ cat: k, n: m[k] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
 return rows;
}
// —— 单日主题标签 ——
function themeTagOf(day) {
 const spots = daySpots(day);
 if (!spots.length) return "休整日";
 if (spots.length === 1) return spots.length === 1 ? "轻松日" : "休整日";
 const cls = n => {
  const s = cleanSpotName(n) || n;
  if (/馆/.test(s)) return "场馆";
  if (/乐园|世界|影视城/.test(s)) return "乐园";
  if (/山|峰|峡|谷|长城|徒步|栈道|瀑布|草原|沙漠/.test(s)) return "山野";
  if (/湖|江|海|岛|湾|泉|河|滩|溪/.test(s)) return "亲水";
  if (/古城|古镇|街|寺|庙|故居|博物馆|陵|遗址/.test(s)) return "人文";
  return "城市";
 };
  const set = spots.map(s => cls(s.name));
  const uniq = [...new Set(set)];   // v1.11：O(n²) indexOf 去重 → Set
 const tagTxt = { 场馆: "看展日", 乐园: "畅玩日", 山野: "进山日", 亲水: "亲水日", 人文: "人文日", 城市: "城市漫游日" };
 if (uniq.length === 1) return tagTxt[uniq[0]] || "主题日";
 if (uniq.length === 2 && uniq.includes("人文") && uniq.includes("城市")) return "Citywalk 日";
 return "均衡日";
}
// —— 当日移动估算（导航 km 只按连续真实景点；步数为行程强度估计） ——
function dayMove(day, cityName) {
 let km = 0, legs = 0, steps = 4000;
 const spots = daySpots(day);
 let prev = null;
 spots.forEach(it => {
  const nm = cleanSpotName(it.name) || it.name;
  let c = null;
  try { c = cityName ? P.getSpotCoord(cityName, nm) : null; } catch (e) {}
  if (c && c.lat && c.lon && !c.approx) {
   if (prev) { km += haversineKm(prev, c); legs++; }
   prev = c;
  }
  const s = String(nm);
  if (/山|峰|峡|谷|瀑布|长城|徒步|栈道|草原|沙漠|梯田/.test(s) && !/公园/.test(s)) steps += 9000;
  else if (/乐园|世界|影视城|度假区/.test(s)) steps += 8000;
  else if (/古镇|古城|街|巷/.test(s)) steps += 6500;
  else if (/馆/.test(s)) steps += 5000;
  else if (/湖|江|海|岛|湾|泉|河|滩|溪|公园|园/.test(s)) steps += 5500;
  else steps += 3500;
 });
 steps = Math.min(24000, Math.round(steps / 500) * 500);
 return { km: Math.round(km * 10) / 10, legs, steps };
}
function haversineKm(a, b) {
 const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
 const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
 return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}
// —— 返程日预留贴士 ——
function endTripTip(plan) {
 if (!plan || !plan.days || !plan.days.length) return null;
 if (plan.segments && plan.segments.length > 1) return null; // 转场继续玩不算返程
 const last = plan.days[plan.days.length - 1];
 const hasBack = (Array.isArray(last.items) ? last.items : []).some(it => /^(返程|退房|出发前往)/.test(it.name || ""));
 if (!hasBack) return null;
 return { txt: "返程日建议：航班提前 2 小时、高铁提前 1 小时到站，给安检取票留足余量" };
}
// —— 想玩清单未排入的景点 ——
function wishMissOf(plan) {
 try {
  const pn = [];
  (plan && plan.days || []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
   const nm = it && it.name;
   if (nm && !isFrameName(nm)) pn.push(cleanSpotName(nm) || nm);
  }));
  return getWish().map(w => ({ name: w.name, city: w.city || "" }))
   .filter(w => !pn.some(x => x === w.name || (x && w.name && (x.indexOf(w.name) >= 0 || w.name.indexOf(x) >= 0))))
   .filter(w => !isVisited(w.name))
   .slice(0, 5);
 } catch (e) { return []; }
}
// —— 行前带什么（出发月 × 城市气候的静态建议；区别于今日实时穿衣指数） ——
function packHintOf(cityName, dateStr) {
 try {
  const c = findCity(cityName);
  if (!c) return [];
  const p = _parseYMD(dateStr);
  const mo = p ? p.mo : new Date().getMonth() + 1;
  const cli = c.climate || "temperate";
  const reg = c.region || "";
  const tips = [];
  const isCold = mo <= 2 || mo >= 11;
  if (cli === "cold" || (cli === "temperate" && isCold)) tips.push("厚外套/羽绒服" + (cli === "cold" ? "，注意保暖" : ""));
  if (cli === "hot" && mo >= 5 && mo <= 9) tips.push("防晒霜+遮阳帽，午后避开暴晒");
  if (cli === "plateau") tips.push("防晒+润唇膏，初上高原别剧烈运动");
  if (cli === "tropical" || (reg === "华南" && mo >= 5 && mo <= 10)) tips.push("驱蚊液+速干衣，热带蚊虫多");
  if (cli === "dry") tips.push("保湿护肤品+润唇膏，气候干燥");
  if ((reg === "华东" || reg === "华中" || reg === "华南") && mo >= 6 && mo <= 9) tips.push("折伞或雨衣，梅雨/台风雨季常备");
  if (c.cost === "high") tips.push("预算按偏高档预留，热门景区提前订票");
  if (!tips.length) tips.push("常规出行装备即可，按季节增减衣物");
  return tips.slice(0, 4);
 } catch (e) { return []; }
}
// —— 同省也值得去的精选城（顺路串游灵感） ——
function siblingCities(cityName) {
 try {
  const c = findCity(cityName);
  const prov = (c && c.province) || (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (!prov) return [];
  const list = (Array.isArray(D.CITIES) ? D.CITIES : []).filter(x => {
   if (x.name === cityName) return false;
   return ((D.CITY2PROV && D.CITY2PROV[x.name]) || (x.province || "")) === prov;
  });
  return list.slice(0, 3).map(x => {
   const cb = cityBrief(x.name);
   return { name: x.name, days: (cb && cb.days) || 3, best: (cb && cb.best) || "" };
  });
 } catch (e) { return []; }
}
// —— 多站各城停留天数条 ——
function routeDaysBar(plan) {
 if (!plan || !plan.segments || plan.segments.length < 2) return null;
 return plan.segments.map(s => ({ city: s.cityName || "", days: Math.max(1, (s.days && s.days.length) || (s.totalDays || 1)) }));
}
// —— 此刻该去哪（行程中，按当前时段找今天剩余点） ——
function nowSlotPick(plan) {
 try {
  const st = todayState(plan);
  if (!st || st.phase !== "during") return null;
  const day = plan.days[st.idx];
  if (!day) return null;
  const na = nextActivity(day);
  const spots = daySpots(day);
  if (na.now) return { tag: "now", txt: "此刻正该去 · " + cleanSpotName(na.now.name) };
  if (na.next) return { tag: "next", txt: "下一站 · " + cleanSpotName(na.next.name) };
  if (spots.length) return { tag: "done", txt: "今日已排点逛完，留给街头与晚风" };
  return null;
 } catch (e) { return null; }
}
// —— 明日预告 ——
function tomorrowPeek(plan) {
 try {
  const st = todayState(plan);
  if (!st || st.phase !== "during") return null;
  const nx = plan.days[st.idx + 1];
  if (!nx) return null;
  const spots = daySpots(nx).slice(0, 2).map(s => cleanSpotName(s.name));
  return { dayNo: st.idx + 2, theme: nx.title || "", spots };
 } catch (e) { return null; }
}
// —— 今日装备（行程中，按当天景点构成给携带建议） ——
function todayGear(plan) {
 try {
  const st = todayState(plan);
  if (!st || st.phase !== "during") return [];
  const day = plan.days[st.idx];
  const names = daySpots(day).map(s => cleanSpotName(s.name) || s.name).join(" ");
  const set = [];
  const add = t => { if (!set.includes(t)) set.push(t); };
  if (/山|峰|峡谷|瀑布|长城|徒步|栈道|草原|沙漠|梯田/.test(names) && !/公园/.test(names)) { add("登山鞋"); add("水壶"); }
  if (/乐园|欢乐谷|方特|影视城/.test(names)) { add("充电宝"); add("雨衣/防晒"); }
  if (/海|岛|浴场|海滩|水上/.test(names)) { add("泳衣"); add("防晒"); }
  if (/沙漠|高原|草原/.test(names)) { add("防晒霜"); add("润唇膏"); }
  if (/馆/.test(names)) { add("薄外套（展厅冷）"); }
  if (/温泉|漂流|水上/.test(names)) add("换洗衣物");
  if (/古镇|古城|街|夜市|演出/.test(names)) add("轻便鞋");
  if (!set.length) add("按当天节奏轻装出门");
  return set.slice(0, 5);
 } catch (e) { return []; }
}
// —— 今日花超轻提醒 ——
function todayOverHint(plan) {
 try {
  const st = todayState(plan);
  if (!st || st.phase !== "during") return null;
  const spent = todaySpent();
  if (spent <= 0) return null;
  const ref = budgetPerDay(plan);
  if (spent > ref * 1.5) return { lv: "over", txt: "今日已花 ¥" + Math.round(spent) + "，明显超出参考（¥" + ref + "），后面几笔悠着点" };
  if (spent > ref * 1.15) return { lv: "warn", txt: "今日 ¥" + Math.round(spent) + " 略超参考（¥" + ref + "），记一笔会更清楚" };
  return null;
 } catch (e) { return null; }
}
// —— 美食口味标签（筛选 chips） ——
function tasteTagOf(food) {
 const f = String(food || "");
 if (/辣|麻|火锅|串串|麻辣|剁椒|酸辣/.test(f)) return "辣";
 if (/甜|糖|蜜|点心|糕|羹|羹/.test(f)) return "甜";
 if (/鲜|海鲜|鱼|虾|蟹|贝|生蚝|粥|汤|面|粉/.test(f)) return "鲜";
 if (/烤|烧|焖|卤|炸|煎|炒/.test(f)) return "香";
 if (/凉|冰|冻|酿|生腌/.test(f)) return "爽";
 return "经典";
}
function tasteFilter(foods, tag) {
 if (!tag || tag === "全部") return foods || [];
 return (Array.isArray(foods) ? foods : []).filter(f => tasteTagOf(f) === tag);
}
// —— 行前清单气候加项（目的地气候补充 prep 项） ——
function climateAddOns(climate) {
 const map = {
  plateau: ["高反常备药", "防晒霜+墨镜", "保湿润唇", "轻便保暖外套"],
  cold: ["羽绒服", "保暖内衣", "手套围巾", "保温杯"],
  hot: ["防晒霜", "遮阳帽", "便携风扇", "藿香正气"],
  tropical: ["驱蚊液", "速干衣", "防晒霜", "雨具"],
  dry: ["保湿护肤品", "润唇膏", "墨镜", "多带饮用水"],
  temperate: []
 };
 return map[climate] || [];
}

/* 2026-10-29：气候补充项与主清单会重复（墨镜 / 防晒 / 雨具 / 羽绒服 两边都有）。
   按「关键词」判重，不整串比对 —— 主清单条目常是组合式，如「防晒霜（SPF30+）· 墨镜」。 */
const CLIMATE_SYN = {
 "高反常备药": ["高反", "红景天"],
 "防晒霜+墨镜": ["防晒"],
 "保湿润唇": ["润唇", "护唇"],
 "轻便保暖外套": ["保暖", "冲锋衣", "羽绒"],
 "羽绒服": ["羽绒"],
 "保暖内衣": ["保暖内衣"],
 "手套围巾": ["手套", "围巾"],
 "保温杯": ["保温杯", "水杯"],
 "防晒霜": ["防晒"],
 "遮阳帽": ["遮阳帽", "帽子"],
 "便携风扇": ["风扇"],
 "藿香正气": ["藿香", "正气"],
 "驱蚊液": ["驱蚊"],
 "速干衣": ["速干"],
 "雨具": ["雨具", "雨衣", "折叠伞", "伞"],
 "保湿护肤品": ["保湿"],
 "润唇膏": ["润唇", "护唇"],
 "墨镜": ["墨镜"],
 "多带饮用水": ["水杯", "饮用水"],
};

// 返回气候补充项，剔除主清单已覆盖的（packGroups 传 packSmart().groups）
function climateAddOnsFiltered(climate, packGroups, extraText) {
 const raw = climateAddOns(climate);
 if (!raw.length) return [];
 // 注意：packSmart 的 items 是对象数组 { k, t, done }，不是字符串数组。
 // 初版直接用 join(" ") 得到一串 "[object Object]"，导致去重永远失效（静默无效比报错更糟）。
 const txtOf = x => (typeof x === "string" ? x : (x && (x.t || x.name || "")) || "");
 let hay = (Array.isArray(packGroups) ? packGroups : [])
  .map(g => (g && Array.isArray(g.items) ? g.items.map(txtOf).join(" ") : ""))
  .join(" ");
 // 第三参：额外参与比对的文本（如今天页穿衣卡），同样算「已提到」
 if (extraText) hay += " " + String(extraText);
 if (!hay) return raw;
 const out = [];
 for (const it of raw) {
  const keys = CLIMATE_SYN[it] || [it];
  let dup = false;
  for (const k of keys) { if (k && hay.indexOf(k) >= 0) { dup = true; break; } }
  if (!dup) out.push(it);
 }
 return out;
}
// —— 近 7 日花费柱（账本 stat 用） ——
function weekBars(list) {
 const now = new Date();
 const days = [];
 for (let i = 6; i >= 0; i--) {
  const d = new Date(now); d.setDate(now.getDate() - i);
  const key = _ymdOf(d);
  days.push({ key, label: (i === 0 ? "今" : "周" + "日一二三四五六"[d.getDay()]), amt: 0 });
 }
 const amtOf = {};
 (Array.isArray(list) ? list : []).forEach(x => { const k = String(x.date || "").slice(0, 10); const a = Number(x.amt); if (a > 0 && amtOf[k] == null) amtOf[k] = 0; if (a > 0) amtOf[k] = (amtOf[k] || 0) + a; });
 days.forEach(d => { d.amt = Math.round((amtOf[d.key] || 0) * 100) / 100; });
 const max = Math.max(1, ...days.map(d => d.amt));
 return { days, max };
}
// —— 本月复盘一句话 ——
function monthStory(list) {
 const now = new Date();
 const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
 let total = 0; const cat = {};
 (Array.isArray(list) ? list : []).forEach(x => {
  const d = String(x.date || ""); const a = Number(x.amt);
  if (d.slice(0, 7) !== ym || !(a > 0)) return;
  total += a; cat[x.cat] = (cat[x.cat] || 0) + a;
 });
 if (!total) return null;
 const top = Object.keys(cat).sort((a, b) => cat[b] - cat[a])[0] || "";
 const n = (Array.isArray(list) ? list : []).filter(x => String(x.date || "").slice(0, 7) === ym && (Number(x.amt) || 0) > 0).length;
 return { ym, total: Math.round(total), top, n, txt: "本月共 " + n + " 笔、" + (top ? top + " 是大头" : "花钱很克制") + "，合计 ¥" + Math.round(total) };
}
// —— 想玩骰子：随机抽一条想玩（附城市最佳时节） ——
function wishDice() {
 try {
  const w = getWish();
  if (!w.length) return null;
  const item = w[Math.floor(Math.random() * w.length)];
  const city = item.city || "";
  const cb = city ? cityBrief(city) : null;
  return { name: item.name, city, days: (cb && cb.days) || 3, best: (cb && cb.best) || "" };
 } catch (e) { return null; }
}
// —— 足迹省份集章 ——
function provStamp() {
 const f = _footRaw(); const cs = Object.keys(f.cities || {});
 const provs = new Set();
 cs.forEach(c => { const p = (D.CITY2PROV && D.CITY2PROV[c]) || ""; if (p) provs.add(p); });
 const total = (D.PROVINCES && D.PROVINCES.length) || 34;
 const n = provs.size;
 return { cities: cs.length, provs: n, total, pct: total ? Math.round(n / total * 100) : 0 };
}
// —— 旅行人格（足迹城市地区构成 → 一句话） ——
function travelPersona() {
 const f = _footRaw(); const cs = Object.keys(f.cities || {});
 if (!cs.length) return null;
 const regCnt = {};
 cs.forEach(c => {
  const c2 = _cityIndex().get(c) || null;   // v1.19.8：原为 D.CITIES.find，循环内全量扫描 → O(n²)
  const reg = (c2 && c2.region) || "远方";
  regCnt[reg] = (regCnt[reg] || 0) + 1;
 });
 const top = Object.keys(regCnt).sort((a, b) => regCnt[b] - regCnt[a])[0] || "";
 const name = {
  华北: "古都巡礼者", 华东: "江南拾光人", 华南: "南风玩家", 华中: "江湖漫游家",
  西南: "山野云游客", 西北: "大漠追风人", 东北: "雪国探险家", 远方: "世界收藏家"
 }[top] || "自由旅人";
 const sp = Object.keys(f.spots || {}).length;
 const txt = "你去过 " + cs.length + " 座城、" + sp + " 个地方，最常往" + top + "跑——你是「" + name + "」";
 return { name, region: top, cities: cs.length, spots: sp, txt };
}
// —— 多站换城日标记 ——
function dayCityTag(plan, di) {
 if (!plan || !plan.segments || plan.segments.length < 2 || !Array.isArray(plan.days)) return null;
 const seg = plan.segments;
 let acc = 0;
 for (let i = 0; i < seg.length; i++) {
  const segDays = Math.max(1, (seg[i].days && seg[i].days.length) || (seg[i].totalDays || 1));
  if (di === acc && i > 0) return { change: true, city: seg[i].cityName || "", from: seg[i - 1].cityName || "" };
  acc += segDays;
  if (di < acc) break;
 }
 return null;
}
// —— 全程串城近似里程（多站锚点连线） ——
function routeKmOf(plan) {
 try {
  if (!plan || !plan.segments || plan.segments.length < 2) return 0;
  let total = 0, ok = 0;
  for (let i = 1; i < plan.segments.length; i++) {
   const a = P.getCoord(plan.segments[i - 1].cityName), b = P.getCoord(plan.segments[i].cityName);
   if (a && b && !a.approx && !b.approx) { total += haversineKm(a, b); ok++; }
  }
  return ok ? Math.round(total) : 0;
 } catch (e) { return 0; }
}
// —— 想玩清单坐标（地图图层：有真实坐标才收录） ——
function wishPins() {
 const out = [];
 getWish().forEach(w => {
  const city = w.city || "";
  if (!city) return;
  try {
   const c = P.getSpotCoord(city, w.name);
   if (c && c.lat && c.lon && !c.approx) out.push({ name: w.name, city, lat: c.lat, lon: c.lon });
  } catch (e) {}
 });
 return out;
}
// —— 法定假期提示（2026/2027 表；命中给客流提醒，节前 2 天给预热提示） ——
const HOLIDAYS = [
 { name: "元旦", s: "2026-01-01", e: "2026-01-03" },
 { name: "春节", s: "2026-02-15", e: "2026-02-21" },
 { name: "清明", s: "2026-04-04", e: "2026-04-06" },
 { name: "劳动节", s: "2026-05-01", e: "2026-05-05" },
 { name: "端午", s: "2026-06-19", e: "2026-06-21" },
 { name: "中秋", s: "2026-09-25", e: "2026-09-27" },
 { name: "国庆", s: "2026-10-01", e: "2026-10-07" },
 { name: "元旦", s: "2027-01-01", e: "2027-01-03" },
 { name: "春节", s: "2027-02-06", e: "2027-02-12" },
 { name: "清明", s: "2027-04-03", e: "2027-04-05" },
 { name: "劳动节", s: "2027-05-01", e: "2027-05-05" },
 { name: "端午", s: "2027-06-09", e: "2027-06-11" },
 { name: "中秋", s: "2027-09-15", e: "2027-09-17" },
 { name: "国庆", s: "2027-10-01", e: "2027-10-07" }
];
function holidayHint(dateStr) {
 const d = String(dateStr || "").slice(0, 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
 const dayN = t => t.replace(/-/g, "");
 const hit = HOLIDAYS.find(h => dayN(d) >= dayN(h.s) && dayN(d) <= dayN(h.e));
 if (hit) return { name: hit.name, on: true, txt: hit.name + "假期客流大，热门景区门票建议提前订，酒店尽早锁定" };
 // 节前 2 天内
 const near = HOLIDAYS.filter(h => {
  const diff = Math.round((new Date(dayN(h.s).slice(0, 4), +dayN(h.s).slice(4, 6) - 1, +dayN(h.s).slice(6, 8)) - new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))) / 86400000);
  return diff > 0 && diff <= 2;
 });
 if (near.length) return { name: near[0].name, on: false, txt: "临近" + near[0].name + "假期，机票酒店开始涨价，热门场馆趁早预约" };
 return null;
}

/* ============ v1.10.0 · 第二波功能（数据驱动 + 文案聚合，纯函数） ============ */
// 统一把 plan 归一为「天数数组」：buildPlan 直接返回数组；存储形态是 {cityName,days,totalDays}
function _pd(plan) {
 if (!plan) return [];
 const arr = Array.isArray(plan) ? plan : (Array.isArray(plan.days) ? plan.days : []);
 return Array.isArray(arr) ? arr : [];
}
// 条目名清洗：去掉 抵达/入住 前缀、括号酒店、分隔符，返回干净景点名
function _nm(it) {
 let n = it && typeof it === "string" ? it : (it && it.name);
 if (!n) return "";
 n = String(n).replace(/^抵达\s*\+?\s*/, "").replace(/^入住\s*/, "").replace(/「[^」]*」/g, "").replace(/^(入住|抵达)$/, "").trim();
 return n;
}
// 日期 → 星期几（0=周日）
function _wd(dateStr) {
 const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
 if (!m) return -1;
 return new Date(+m[1], +m[2] - 1, +m[3]).getDay();
}
// 文本关键词计数
function _cnt(txt, re) { const m = String(txt || "").match(re); return m ? m.length : 0; }

// 1) 行程区间
function periodOf(plan) {
 const arr = _pd(plan);
 if (!arr.length) return { d0: "", d1: "", nDays: 0, nNights: 0, label: "" };
 const d0 = String(arr[0].date || "").slice(0, 10);
 const d1 = String(arr[arr.length - 1].date || "").slice(0, 10);
 const nDays = arr.length;
 const label = d0 ? (d0 + (d1 && d1 !== d0 ? " ~ " + d1.slice(5) : "") + " · " + nDays + "天" + Math.max(0, nDays - 1) + "晚") : nDays + "天";
 return { d0, d1, nDays, nNights: Math.max(0, nDays - 1), label };
}
// 2) 城市串（去重保序，含多站标识）
function spanCityOf(plan) {
  const arr = _pd(plan);
  const seen = [];
  const seenSet = new Set();   // v1.11：线性 indexOf → Set
  arr.forEach(d => {
    const c = d.cityName || "";
    if (c && !seenSet.has(c)) { seenSet.add(c); seen.push(c); }
  });
 return { cities: seen, isMulti: seen.length > 1, text: seen.join(" → ") };
}
// 3) 每日行程密度（按条目数排序 + 最满/最闲）
function loadRank(plan) {
 const arr = _pd(plan);
 const rows = arr.map((d, i) => ({ di: i, date: String(d.date || "").slice(5), n: (Array.isArray(d.items) ? d.items : []).length, theme: d.theme || "" }))
  .sort((a, b) => b.n - a.n);
 if (!rows.length) return { rows: [], max: null, min: null };
 return { rows, max: rows[0], min: rows[rows.length - 1] };
}
// 4) 行程主题 top2（关键词打分）
const _TAG_RULES = [
 ["海滨", /海滨|海滩|海岛|海湾|海边|海岸|看海|赶海|环岛|沙滩|洋馆|海世界/],
 ["山川", /山|峰|峡|谷|长城|草原|森林|瀑布|冰川|沙漠|徒步|栈道/],
 ["古城古镇", /古城|古镇|老街|古村|牌坊|骑楼|巷/],
 ["人文历史", /博物|纪念|寺|庙|宫|陵|祠|故居|书院|楼|塔|遗址|院/],
 ["乐园亲子", /乐园|动物园|海洋馆|水族馆|科技馆|恐龙|摩天轮/],
 ["都市夜色", /夜景|夜市|酒吧|演出|灯光|商圈|步行街/],
 ["湖光水色", /湖|江|河|潭|泊|湿地|溪/],
 ["市井烟火", /早市|市场|菜场|美食|小吃|食街|早茶/]
];
function themeTagsOf(plan) {
 const arr = _pd(plan);
 let text = "";
 arr.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => { text += " " + _nm(it); }));
 const sc = _TAG_RULES.map(r => ({ tag: r[0], s: _cnt(text, r[1]) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
 if (!sc.length) return { top: [], all: [] };
 const top = sc.slice(0, 2).map(x => x.tag);
 return { top, all: sc };
}
// 5) 户外自然占比
function natureShareOf(plan) {
 const arr = _pd(plan);
 let total = 0, nat = 0;
 arr.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const n = _nm(it); if (!n) return;
  total++;
  if (/山|峰|峡|谷|草原|森林|瀑布|冰川|沙漠|湿地|海滩|岛|湖|公园|徒步|栈道/.test(n)) nat++;
 }));
 return { total, nat, share: total ? Math.round(nat / total * 100) : 0 };
}
// 6) 需提前预约清单（对接 BOOKING_TIPS 关键词表，逐日）
function bookingLines(plan) {
 const arr = _pd(plan);
 const rows = [];
 arr.forEach((d, di) => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const name = _nm(it);
  (Array.isArray(D.BOOKING_TIPS) ? D.BOOKING_TIPS : []).forEach(b => {
   if (!b || !b.kw) return;
   if (name.indexOf(b.kw) >= 0) rows.push({ di: di + 1, date: String(d.date || "").slice(5), name, kw: b.kw, days: b.days, where: b.where });
  });
 }));
 return rows;
}
// 7) 博物馆类日期（提示周一闭馆）
const _MUSEUM_RE = /博物馆|美术馆|纪念馆|科技馆|展览馆|博物院|规划馆/;
function museumDiList(plan) {
 const arr = _pd(plan);
 const rows = [];
 arr.forEach((d, di) => {
  const names = (Array.isArray(d.items) ? d.items : []).map(_nm).filter(n => _MUSEUM_RE.test(n));
  if (names.length) rows.push({ di: di + 1, date: String(d.date || "").slice(5), names, monday: _wd(d.date) === 1 });
 });
 return rows;
}
// 8/9) 日出晨早 / 日落夜景 推荐天
function sunriseDiList(plan) {
 return _pd(plan).map((d, i) => ({ di: i + 1, date: String(d.date || "").slice(5), names: (Array.isArray(d.items) ? d.items : []).map(_nm).filter(n => /日出|早市|赶海|晨/.test(n)) })).filter(r => r.names.length);
}
function sunsetDiList(plan) {
 return _pd(plan).map((d, i) => ({ di: i + 1, date: String(d.date || "").slice(5), names: (Array.isArray(d.items) ? d.items : []).map(_nm).filter(n => /日落|夜景|夜游|灯光|演出|夜市/.test(n)) })).filter(r => r.names.length);
}
// 10) 亲子适配（0-100 + 一句）
function familyFit(plan) {
 const arr = _pd(plan);
 let score = 60;
 const spots = [];
 arr.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => spots.push(_nm(it))));
 const s = spots.join(" ");
 if (/乐园|动物园|海洋馆|水族馆|科技馆|恐龙|演出|沙滩|赶海|游船/.test(s)) score += 20;
 if (/博物馆|公园|植物园|园林/.test(s)) score += 10;
 const heavy = _cnt(s, /山|峰|峡谷|长城|徒步|栈道|骑行|爬/);
 score -= heavy * 8;
 score = Math.max(10, Math.min(100, score));
 const tip = score >= 80 ? "乐园/展馆/自然都覆盖，遛娃友好，节奏别排太满。" :
  score >= 55 ? "含较多体力行程，建议亲子同线穿插乐园/展馆缓冲。" :
   "高强度户外占比高，带娃建议删减 1-2 个爬坡点，或选轻松版本。";
 return { score, tip };
}
// 11) 长辈适配
function elderFit(plan) {
 const arr = _pd(plan);
 const spots = [];
 arr.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => spots.push(_nm(it))));
 const s = spots.join(" ");
 let score = 60;
 if (/园林|公园|博物馆|古镇|街区|寺庙|湖|江|观景台/.test(s)) score += 18;
 const heavy = _cnt(s, /山|峰|峡谷|长城|徒步|栈道|爬山/);
 score -= heavy * 10;
 score = Math.max(10, Math.min(100, score));
 const tip = score >= 75 ? "以平缓人文与园林为主，适合长辈慢逛。" :
  score >= 50 ? "部分景点需要爬坡，建议备好登山杖、放慢节奏。" :
   "体力型景点偏多，带长辈请换成休闲节奏并减少登山项目。";
 return { score, tip };
}
// 12) 强度标签
function effortTagOf(plan) {
 const arr = _pd(plan);
 if (!arr.length) return { tag: "-", n: 0 };
 const n = arr.reduce((s, d) => s + (Array.isArray(d.items) ? d.items : []).length, 0);
 const avg = n / arr.length;
 const heavy = arr.reduce((s, d) => s + (Array.isArray(d.items) ? d.items : []).reduce((x, it) => x + _cnt(_nm(it), /山|峰|峡谷|长城|徒步|栈道|爬/g), 0), 0);
 const tag = heavy >= arr.length * 2 ? "特种兵" : avg >= 4 ? "紧凑充实" : avg >= 3 ? "节奏适中" : "轻松慢游";
 return { tag, avg, heavy };
}
// 13) 打包清单（基础 + 行程加项）
function packByPlan(plan) {
 const base = (Array.isArray(PACK_LIST) ? PACK_LIST : []).slice();
 // v1.11：day.items 可能为 null（脏存档/旧结构）→ 守卫，避免整函数抛错导致 prep 白屏
 const s = plan ? _pd(plan).map(d => (Array.isArray(d && d.items) ? d.items : []).map(_nm).join(" ")).join(" ") : "";
 const adds = [];
 if (/海|岛|滩|漂流/.test(s)) adds.push("泳衣/换洗衣物（海边下水）", "手机防水袋");
 if (/沙漠|草原/.test(s)) adds.push("防风面巾", "润唇膏", "墨镜（防强光）");
 if (/山|峰|峡谷|长城|草原/.test(s)) adds.push("登山鞋或防滑鞋", "登山杖（可选）");
 if (/温泉/.test(s)) adds.push("泳衣（泡温泉）");
  if (/博物馆|美术馆/.test(s)) adds.push("预约后截图保存预约码");
  // v1.11 修 bug：原写法 `plan && plan.cityName ? "" : ""` 恒为空串，高原判断永远不命中
  // （命中还会 push 一个空串进清单）。改为按目的地城市 climate 判定。
  const _mainCity = _pd(plan)[0] && _pd(plan)[0].cityName;   // 城市名挂在每天上，不在数组根
  if (_mainCity) {
    const cc = findCity(_mainCity);
    if (cc && (cc.climate === "plateau" || (cc.best || "").indexOf("高原") >= 0 || /高原|海拔/.test(cc.travel || "")))
      adds.push("防高反药（红景天提前 3-5 天吃）", "保温水杯（高原多喝热水）");
  }
  const uni = [...new Set(base.concat(adds).filter(Boolean))];   // v1.11：O(n²) → Set 去重
  return uni;
}
// 14) 城市彩蛋（精编池里「可灵活安排」的备选之一，取最冷门——名字最短）
function gemOfCity(city) {
 if (!city || !city.experiences) return "";
 const cands = city.experiences.filter(e => /灵活安排/.test(e.note || ""));
 const pool = cands.length ? cands : city.experiences;
 const pick = pool.reduce((a, b) => ((a.name || "").length <= (b.name || "").length ? a : b));
 return pick ? pick.name : "";
}
// 15) 某天文字行程（可分享）
function spotDayLines(plan, di) {
 const arr = _pd(plan);
 const d = arr[di];
 if (!d) return [];
 return (Array.isArray(d.items) ? d.items : []).map(it => {
  const name = _nm(it);
  return name ? ((it.period || "") + "｜" + name + (it.note ? "：" + it.note : "")) : "";
 }).filter(Boolean);
}
// 16) 行程总述
function tripDraft(plan) {
 const arr = _pd(plan);
 if (!arr.length) return "";
 const cityTxt = spanCityOf(plan).text;
 const per = periodOf(plan);
 const theme = themeTagsOf(plan).top.join("+") || "自由探索";
 const draft = themeTagsOf(plan).top.length ? "主打" + theme + "，" : "";
 const effort = effortTagOf(plan);
 const load = loadRank(plan);
 const lead = load.max ? "其中第 " + (load.max.di + 1) + " 天最满（" + load.max.n + " 个安排）" : "";
 return per.d0 + " 出发，" + cityTxt + " " + per.nDays + "天" + per.nNights + "晚，" + draft + effort.tag + "节奏。" + lead + "。" + (load.max && load.max.di !== load.min.di ? "第 " + (load.min.di + 1) + " 天留白较多，可机动。" : "");
}
// 17) 行前 TOP 提示（自动聚合）
function tipsTop3(plan) {
 const out = [];
 const bk = bookingLines(plan);
 if (bk.length) out.push("需预约 " + bk.length + " 处：" + bk.map(b => b.name).join("、") + "（" + bk[0].days + "）");
 const mu = museumDiList(plan).filter(r => r.monday);
 if (mu.length) out.push("第 " + mu.map(r => r.di).join("、") + " 天行程含博物馆且恰逢周一：" + mu[0].names[0] + " 等多周一闭馆，建议调天或核实开放");
 const sd = sunriseDiList(plan);
 if (sd.length) out.push("想看日出/早市请早起：第 " + sd.map(r => r.di).join("、") + " 天");
 const fam = familyFit(plan);
 if (fam.score < 60) out.push("带娃强度偏高：" + fam.tip);
 return out.slice(0, 3);
}
// 18/19) 分享文案
function shareOneLine(plan) {
 const per = periodOf(plan);
 const city = spanCityOf(plan).text;
 const theme = themeTagsOf(plan).top.join("/");
 return city + " · " + per.nDays + "天" + per.nNights + "晚" + (theme ? " · 主打" + theme : "") + "，攻略已生成，说走就走。";
}
function shareLong(plan) {
 const per = periodOf(plan);
 const c = spanCityOf(plan).text;
 const eff = effortTagOf(plan).tag;
 const sd = sunsetDiList(plan);
 return per.d0 + " 出发去 " + c + "，" + per.nDays + "天" + per.nNights + "晚" + eff + "节奏。\n" +
  (sd.length ? "蹲一场" + (sd[0].names[0] || "夜景") + "，" : "") + "把期待写进行程，剩下的交给好天气。";
}
// 20) 行程自评（趣味）
function tripScoreOf(plan) {
 const theme = themeTagsOf(plan);
 const load = loadRank(plan);
 let sc = 70;
 if (theme.all.length >= 2) sc += 10;
 if (theme.all.length >= 4) sc += 5;
 if (load.max && load.min && load.max.n - load.min.n >= 3) sc -= 5;
 sc = Math.max(40, Math.min(98, sc));
 const cm = sc >= 85 ? "主题丰富、张弛有度，是一份高分行程" : sc >= 70 ? "安排均衡，微调一下节奏会更顺" : "排得偏满，建议砍掉 1-2 个点留白";
 return { score: sc, comment: cm };
}
// 21) 去这里的理由
function cityFirstLine(city) {
 if (!city) return "";
 return "去" + city.name + "：" + (city.best ? city.best.split("；")[0] + "，" : "") + (city.foods && city.foods[0] ? "别错过" + city.foods[0] + "。" : "");
}
// 22) 城市美食动线（早市/正餐/宵夜）
function foodRouteOf(city) {
 if (!city || !city.foods || !city.foods.length) return [];
 const f = city.foods;
 return ["早餐/早市：先来份" + (f[0] || "本地小吃") + (city.foodNote ? "——" + city.foodNote.slice(0, 26) + "…" : ""),
  "正餐老店：" + (f[1] || f[0]) + "配" + (f[2] || "时令菜") + "，找本地人多的小馆子最稳",
  "宵夜扫街：" + (f[3] || f[2] || f[1] || f[0]) + "收尾，留点肚子给明天"];
}
// 23) 本季气候提示（占位文案，供天气失败时兜底显示）
function weatherFallback(city) {
 if (!city) return "";
 const cl = city.climate || "";
 const map = { tropical: "热带气候，全年暖热，备夏装+防晒，雨季常备伞", hot: "夏热冬温，夏季防暑、冬季薄外套", temperate: "四季分明，春秋最舒服，早晚加件外套", cold: "冬季寒冷，羽绒服备好；夏季凉爽宜人", dry: "干燥少雨，昼夜温差大，保湿防晒都要做", plateau: "高原气候，紫外线强、温差大，防高反+保暖" };
 return city.name + "：" + (map[cl] || "出行前看下当地天气") + "。" + (city.best ? "（" + city.best.split("；")[0] + "）" : "");
}
// 24) 穿衣参考（按气候+月份粗档）
function layerOf(climate, month) {
 const m = +month || 0;
 const cold = ["cold", "plateau", "dry"].indexOf(climate) >= 0;
 if (m >= 6 && m <= 8) return cold ? "夏季也备薄外套（高原/温差大），日常夏装" : "夏装为主，室内空调备薄衫";
 if (m >= 11 || m <= 2) return cold ? "厚羽绒+保暖内衣+帽子围巾" : "冬装为主，南方湿冷地区加绒裤更实用";
 return "春秋装为主，早晚温差大，叠穿（薄外套+内搭）最实用";
}
// 25) 住宿建议
function stayZoneOf(city) {
 if (!city) return "";
 const a = (Array.isArray(city.areas) ? city.areas : [])[0];
 return (a ? "首选 " + a.name + "（" + a.note + "）" : "选择交通枢纽或商圈附近") + "。" + (city.stayTip || "");
}
// 26) 交通备注精简
function moveNote(city) {
 if (!city) return "";
 return "去" + city.name + "：" + (city.travel || "") + " 市内：" + (city.cityTravel || "");
}
// 27) 提前量排序预约单（出发前该做啥）
function bookingByLead(plan) {
 const rows = bookingLines(plan);
 if (!rows.length) return [];
 const leadN = t => { const m = /(\d+)\s*天/.exec(String(t || "")); return m ? +m[1] : 99; };
 return rows.slice().sort((a, b) => leadN(a.days) - leadN(b.days));
}
// 28) 双城对比（概览文本）
function cityCompareLines(a, b) {
 if (!a || !b) return [];
 const c1 = a.climate === b.climate ? "气候相近（" + a.climate + "）" : "气候不同：" + a.name + " " + (a.climate || "-") + " vs " + b.name + " " + (b.climate || "-");
 return [c1, "最佳时节：" + (a.best || "-").split("；")[0] + "；" + b.name + "：" + (b.best || "-").split("；")[0],
  "预算档位：" + ({ low: "经济", mid: "舒适", high: "高端" }[a.cost] || a.cost) + " vs " + ({ low: "经济", mid: "舒适", high: "高端" }[b.cost] || b.cost),
  "吃：" + (Array.isArray(a.foods) ? a.foods : []).slice(0, 2).join("/") + "；" + b.name + "吃：" + (Array.isArray(b.foods) ? b.foods : []).slice(0, 2).join("/")];
}
// 29) 时段内该城可做的（来自 experiences 时段匹配）
function tipForSlot(city, slot) {
 if (!city || !city.experiences) return "";
 const e = city.experiences.find(x => (x.period || "").indexOf(slot) >= 0) || city.experiences[0];
 return e ? e.name + "：" + (e.note || "") : "";
}
// 30) 备选加天去处
function spareOfCity(city, n) {
 if (!city || !city.experiences) return [];
 const cands = city.experiences.filter(e => /灵活安排/.test(e.note || ""));
 const extra = (cands.length ? cands : city.experiences).slice(0, n || 3);
 return extra.map(e => e.name);
}
// 31) 高光时刻（文案带 必看/经典/日落/夜景 的条目）
function starMoments(plan) {
 const arr = _pd(plan);
 const hits = [];
 arr.forEach((d, di) => (Array.isArray(d.items) ? d.items : []).forEach(it => {
  const note = it.note || "";
  if (/必看|经典|最美|日落|夜景|震撼|世界|亚洲最大|地标/.test(note)) {
   hits.push({ di: di + 1, name: _nm(it), note });
  }
 }));
 return hits.slice(0, 3);
}
// 32) 风险提示卡
function riskCard(plan, city) {
 const out = [];
 const bk = bookingLines(plan);
 if (bk.length) out.push("预约风险：" + bk.length + " 处需预约（" + bk[0].name + " 等），忘了约可能白跑");
 const mu = museumDiList(plan).filter(r => r.monday);
 if (mu.length) out.push("闭馆风险：第 " + mu.map(r => r.di).join("、") + " 天是周一，博物馆行程请先核实开放");
 const sd = _pd(plan).reduce((s, d) => s + (Array.isArray(d.items) ? d.items : []).map(_nm).join(" "), "");
 if (/高原|海拔/.test(sd)) out.push("高原风险：备好防高反药，第一天别安排大运动量");
 if (city && /hot|tropical/.test(city.climate || "")) out.push("高温风险：正午尽量安排室内/阴凉行程，多补水");
 if (!out.length) out.push("整体风险较低：提前看好天气、预留弹性时间即可");
 return out;
}
// 33) 节奏评语
function routeRhythm(plan) {
 const lr = loadRank(plan);
 if (!lr.max || !lr.min) return "";
 const first = _pd(plan)[0], last = _pd(plan)[_pd(plan).length - 1];
 const fn = (first && first.items ? first.items.length : 0), ln = (last && last.items ? last.items.length : 0);
 if (fn > ln + 1) return "前紧后松：" + (first.theme || "首日") + " 排得满，收尾天很轻，适合把重头戏放在开头";
 if (ln > fn + 1) return "渐入佳境：越往后越丰富，" + (last.theme || "收官天") + " 是重头戏";
 return "张弛有度：头尾安排均衡，全程节奏稳定";
}
// 34) 返程提醒
function endNoteTxt(city) {
 return "返程提醒：" + (city && city.travel ? (/机场/.test(city.travel) ? "市区到机场预留充足时间，国内航班建议提前 2 小时到。" : "返程交通（高铁/大巴）建议提前 30 分钟进站。") : "提前确认返程交通，留出弹性时间。");
}
// 35) 每日「该天看点」一句话
function dayPeek(day) {
 if (!day) return "";
 const items = (Array.isArray(day.items) ? day.items : []).map(_nm).filter(Boolean);
 return (day.theme || "本日行程") + "：" + items.slice(0, 3).join(" → ") + (items.length > 3 ? " 等" + items.length + " 个安排" : "");
}
// 36) 该行程适合谁
function whoFit(plan) {
 const fam = familyFit(plan), eld = elderFit(plan);
 const tags = [];
 if (fam.score >= 75) tags.push("亲子");
 if (eld.score >= 75) tags.push("长辈");
 const eff = effortTagOf(plan);
 if (eff.tag === "特种兵") tags.push("硬核玩家");
 else if (eff.tag === "轻松慢游") tags.push("佛系慢游");
 if (!tags.length) tags.push("朋友/情侣结伴");
 return tags.join("、");
}

/* ============================================================
   v1.11 · 20 项新功能（1~20）
   全部为纯函数：输入依赖 D / 行程 / 本地存储，输出可直接渲染或复制。
   ============================================================ */
const _todayStr = () => store.fmtLocalDate(new Date());
const _diffDays = (a, b) => {
  const pa = String(a || "").split("-"), pb = String(b || "").split("-");
  if (pa.length !== 3 || pb.length !== 3) return NaN;
  const ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
  return Math.round((ta - tb) / 86400000);
};
// 取行程首日 / 末日
const _planSpan = (plan) => {
  const arr = _pd(plan);
  if (!arr.length) return { start: "", end: "", days: 0 };
  const ds = arr.map(d => String(d.date || "")).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { start: ds[0] || "", end: ds[ds.length - 1] || "", days: arr.length };
};

// 1) 行程阶段导航（行前/行中/行后 + 剩余天数 + 该做什么）
//    注：与既有 tripCountdown(倒计时大数字) 分工不同，这里给的是「阶段 + 待办进度 + 行动建议」
function tripPhaseGuide(plan) {
  const sp = _planSpan(plan);
  if (!sp.start) return { days: NaN, phase: "none", txt: "还没有行程", todo: [] };
  const left = _diffDays(sp.start, _todayStr());
  const done = (Array.isArray(plan.prepDone) ? plan.prepDone : []).length;
  const total = (Array.isArray(D.PREP_CHECKLIST) ? D.PREP_CHECKLIST : []).length;
  const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
  let phase = "before", txt = "";
  if (left > 0) { phase = "before"; txt = "距出发还有 " + left + " 天"; }
  else if (left === 0) { phase = "today"; txt = "今天出发"; }
  else if (sp.end && _diffDays(sp.end, _todayStr()) >= 0) { phase = "during"; txt = "旅行中 · 剩 " + (_diffDays(sp.end, _todayStr()) + 1) + " 天"; }
  else { phase = "after"; txt = "行程已结束 · 去看看旅行足迹"; }
  const todo = [];
  if (phase === "before") {
    todo.push(left <= 1 ? "票/证/充电宝再过一遍" : left <= 3 ? "收拾行李 + 确认预约" : left <= 10 ? "先把要预约的门票订好" : "行程已就绪，出发前一周再确认");
    todo.push("行前清单完成 " + done + "/" + total);
  } else if (phase === "during") {
    todo.push("当天安排：" + (arr0(plan) ? "按行程走，留 1-2 个弹性时段" : "—"));
  } else todo.push("导出备份 / 补记没记的账 / 点亮足迹");
  return { days: left, left: sp.end ? Math.max(0, _diffDays(sp.end, _todayStr())) : 0, phase, txt, prepPct: pct, prepDone: done, prepTotal: total, todo };
}
function arr0(plan) { return _pd(plan).length > 0; }

// 2) 某景点现在适不适合去（按名称关键词粗判时段）
function spotOpenNow(name) {
  const n = String(name || "");
  const h = new Date().getHours();
  if (/夜市|宵夜|酒吧|夜景|灯光秀/.test(n)) return { ok: h >= 18 || h < 2, tag: "夜间限定", why: "晚上才热闹，白天去了会扑空" };
  if (/早市|日出|晨练|早餐/.test(n)) return { ok: h >= 5 && h <= 10, tag: "早起限定", why: "清晨最有烟火气，10 点后基本收摊" };
  if (/博物馆|美术馆|纪念馆|展览/.test(n)) return { ok: h >= 9 && h <= 17, tag: "白天开放", why: "多数场馆 17:00 停止入场，周一常闭馆" };
  if (/温泉/.test(n)) return { ok: true, tag: "全天", why: "泡汤不限时，晚上人少体验更好" };
  return { ok: h >= 8 && h <= 20, tag: "白天为主", why: "建议安排在白天，光线好也方便拍照" };
}

// 3) 当天最值得的一件事
function dayHighlight(plan, di) {
  const arr = _pd(plan);
  const d = arr[di];
  if (!d) return { name: "", why: "" };
  const items = (Array.isArray(d.items) ? d.items : []).map(_nm).filter(Boolean);
  const pool = _pd(plan)[di] && (Array.isArray(d.items) ? d.items : []);
  // 优先挑「有大景点/观光类」的条目，其次取第一个真实景点
  const bigWords = /故宫|长城|兵马俑|西湖|外滩|古镇|古城|景区|国家公园|博物馆|山|海|岛|湖/;
  let pick = items.find(x => bigWords.test(x)) || items[0] || "";
  const detailItems = Array.isArray(pool) ? pool : [];
  const hit = detailItems.find(it => _nm(it) === pick);
  return { name: pick, why: (hit && (hit.note || hit.desc)) || (d.theme || "当天主打") , theme: d.theme || "" };
}

// 4) 花钱速度（元/天）+ 按此速度的终点预测
function burnRate(plan) {
  const bills = store.get(LEDGER_KEY, []);
  const sp = _planSpan(plan);
  const spent = (Array.isArray(bills) ? bills : []).reduce((s, b) => s + (Number(b && b.amount) || 0), 0);
  const started = sp.start && _diffDays(_todayStr(), sp.start) >= 0;
  const daysIn = started ? Math.min(sp.days, _diffDays(_todayStr(), sp.start) + 1) : 0;
  const rate = daysIn > 0 ? spent / daysIn : 0;
  const total = plan ? budgetTotalObj(plan) : 0;
  const projected = rate > 0 && sp.days ? Math.round(rate * sp.days) : 0;
  let verdict = "还没开始记账";
  if (rate > 0 && total) {
    const r = projected / total;
    verdict = r <= 1 ? "按当前速度，整趟预算可控" : r <= 1.25 ? "略超一点，注意后几天收着点" : "照这个花法会明显超支，建议下调非必要消费";
  } else if (rate > 0) verdict = "按当前速度，整趟约 ¥" + projected;
  return { spent, daysIn, rate: Math.round(rate), projected, total, verdict, nBills: (Array.isArray(bills) ? bills.length : 0) };
}

// 5) 两城对比卡（花费/气候/季节/可玩量/区域）—— 入参可以是城市名或城市对象
//    注：与既有 cityCompareLines（接受两个城市对象、返回长句）不同，这里返回结构化表格行
function cityCompareCard(a, b) {
  const A = typeof a === "string" ? findCity(a) : a, B = typeof b === "string" ? findCity(b) : b;
  if (!A || !B) return [];
  const costTxt = { low: "省钱", mid: "适中", high: "偏贵" };
  const cl = { temperate: "四季分明", hot: "常年偏热", cold: "冬季寒冷", dry: "干燥少雨", plateau: "高原气候", tropical: "热带" };
  const row = (t, x, y) => t + "：" + x + " ｜ " + y;
  return [
    row("花费", costTxt[A.cost] || "-", costTxt[B.cost] || "-"),
    row("气候", cl[A.climate] || "-", cl[B.climate] || "-"),
    row("最佳季", A.best || "-", B.best || "-"),
    row("可安排体验", (Array.isArray(A.experiences) ? A.experiences : []).length + " 个", (Array.isArray(B.experiences) ? B.experiences : []).length + " 个"),
    row("所属区域", A.region || "-", B.region || "-")
  ];
}

// 6) 我的足迹完成度 + 下一个推荐目标（同省/邻省优先，去过的不推）
function visitProgress() {
  const st = footStats();
  const gone = new Set(Array.isArray(st.cityList) ? st.cityList : []);
  const total = (Array.isArray(D.CITIES) ? D.CITIES : []).length;
  const recent = getRecent();
  const last = (Array.isArray(recent) && recent.length) ? (typeof recent[0] === "string" ? recent[0] : (recent[0] && (recent[0].name || recent[0].city)) || "") : "";
  const prov = last && D.CITY2PROV ? D.CITY2PROV[last] : "";
  const sameProv = ((D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || []).filter(c => !gone.has(c));
  const others = (Array.isArray(D.CITIES) ? D.CITIES : []).map(c => c.name).filter(c => !gone.has(c));
  const next = [];
  const pusher = (n) => { if (n && next.length < 3 && next.indexOf(n) < 0 && n !== last) next.push(n); };
  if (sameProv.length) pusher(sameProv[0]);
  others.slice(0, 40).forEach(n => { if (next.length < 3) pusher(n); });
  return {
    gone: gone.size, total, pct: total ? Math.round(gone.size / total * 100) : 0,
    cityList: st.cityList || [], spots: st.spots || 0,
    last: last, next: next, txt: "已点亮 " + gone.size + "/" + total + " 座城（收录池），下一步：" + (next.join("、") || "随便挑一个都行")
  };
}

// 7) 按天气生成「明天带什么」
function weatherPack(w) {
  const codes = [].concat((w && w.codes) || [], (w && w.code !== undefined && w.code !== null) ? [w.code] : []);
  const maxT = w && (w.max !== undefined ? w.max : w.tmax);
  const minT = w && (w.min !== undefined ? w.min : w.tmin);
  const out = [];
  const rain = (Array.isArray(D.RAIN_CODES) ? D.RAIN_CODES : []).some(c => codes.indexOf(c) >= 0);
  const snow = (Array.isArray(D.SNOW_CODES) ? D.SNOW_CODES : []).some(c => codes.indexOf(c) >= 0);
  if (rain) out.push("折叠伞/雨衣（有雨，鞋最好防水）");
  if (snow) out.push("防滑鞋 + 保暖手套帽子");
  if (typeof maxT === "number" && maxT >= 30) out.push("防晒霜 + 遮阳帽 + 便携小风扇");
  if (typeof maxT === "number" && maxT >= 23 && maxT < 30) out.push("薄外套（早晚温差）");
  if (typeof minT === "number" && minT <= 5) out.push("厚外套/羽绒 + 暖宝宝");
  if (typeof maxT === "number" && maxT - (typeof minT === "number" ? minT : maxT) >= 10) out.push("洋葱式叠穿（昼夜温差 10℃+）");
  if (!out.length) out.push("常规穿搭即可，备一件薄外套");
  return out;
}

// 8) 出片指数（0-100）+ 最佳时段建议
function photoScoreOf(name) {
  const n = String(name || "");
  let s = 45;
  if (/日出|早市|晨/.test(n)) s += 25;
  if (/日落|夕阳|夜景|黄昏|晚霞/.test(n)) s += 25;
  if (/观景台|天台|山顶|塔|阁|楼/.test(n)) s += 12;
  if (/湖|海|江|河|溪|瀑布/.test(n)) s += 10;
  if (/胡同|巷|老街|古镇|古城|弄堂/.test(n)) s += 8;
  if (/博物馆|陵|墓| Cemetery/.test(n)) s -= 20;
  if (/书店|商场|超市/.test(n)) s -= 15;
  s = Math.max(5, Math.min(100, s));
  const best = /日出|早市|晨/.test(n) ? "日出后 1 小时" : /日落|夕阳|夜景|黄昏|晚霞/.test(n) ? "日落前 40 分钟到入夜" : "上午 9-11 点光线最稳";
  const lv = s >= 80 ? "很出片" : s >= 60 ? "适合拍" : s >= 40 ? "一般" : "主要看体验，别纠结拍照";
  return { score: s, level: lv, best };
}

// 9) 体力曲线（每天强度指数，用于画曲线/条形）
function energyCurve(plan) {
  const arr = _pd(plan);
  return arr.map((d, i) => {
    const items = (Array.isArray(d.items) ? d.items : []).map(_nm).filter(Boolean);
    let load = items.length * 10;
    load += _cnt(items.join(" "), /山|峰|峡谷|长城|徒步|栈道|爬/g) * 12;
    load += _cnt(items.join(" "), /夜市|宵夜|酒吧/g) * 4;
    load = Math.max(0, Math.min(100, load));
    return { di: i, date: String(d.date || "").slice(5), score: load, level: load >= 70 ? "拉满" : load >= 45 ? "适中" : "轻松", n: items.length };
  });
}

// 10) 当天空档补点（从该城备选池挑没进过行程的）
function freeSlotPicker(plan, di) {
  const arr = _pd(plan);
  const d = arr[di];
  if (!d) return [];
  const used = new Set(arr.flatMap(x => (Array.isArray(x.items) ? x.items : []).map(_nm).filter(Boolean)));
  const cityName = d.cityName || (arr[0] && arr[0].cityName) || "";
  const c = findCity(cityName);
  if (!c) return [];
  const pool = [].concat((D.EXTRA_SPOTS && D.EXTRA_SPOTS[c.id]) || [], (D.EXTRA_SPOTS2 && D.EXTRA_SPOTS2[c.id]) || [],
    (D.CITY_LANDMARKS && D.CITY_LANDMARKS[cityName]) || [], (Array.isArray(c.experiences) ? c.experiences : []).map(e => e.name));
  const seen = new Set();
  return pool.filter(n => {
    if (!n || seen.has(n) || used.has(n)) return false;
    seen.add(n); return true;
  }).slice(0, 6);
}

// 11) 花费结构 + 异常提示
function costBreakdown(plan) {
  const bills = Array.isArray(store.get(LEDGER_KEY, [])) ? store.get(LEDGER_KEY, []) : [];
  const map = {};
  let total = 0;
  bills.forEach(b => {
    const cat = (b && b.cat) || "其他";
    const amt = Number(b && b.amount) || 0;
    map[cat] = (map[cat] || 0) + amt; total += amt;
  });
  const rows = Object.keys(map).map(k => ({ cat: k, amount: map[k], pct: total ? Math.round(map[k] / total * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const warns = [];
  const food = rows.find(r => r.cat === "餐饮");
  if (food && food.pct >= 55) warns.push("餐饮占比 " + food.pct + "%，偏高：控制正餐、多吃本地小馆");
  const shop = rows.find(r => r.cat === "购物");
  if (shop && shop.pct >= 40) warns.push("购物占 " + shop.pct + "%，留意是否超预算");
  return { rows, total, warns, txt: rows.length ? rows.map(r => r.cat + " " + r.amount + "（" + r.pct + "%）").join(" ｜ ") : "还没有记账" };
}

// 12) 当地禁忌 / 礼仪提醒
function localEtiquette(city) {
  const c = typeof city === "string" ? findCity(city) : city;
  if (!c) return [];
  const n = c.name || "";
  const out = [];
  if (/拉萨|西宁|迪庆|香格里拉|康定|阿坝|伊犁|喀什|乌鲁木齐|呼和浩特/.test(n)) {
    out.push("进入寺庙/清真寺脱帽、不大声喧哗，转经按顺时针方向走");
    out.push("拍摄当地人先征得同意，尤其是僧人和老人");
  }
  if (/西双版纳|三亚|海口|北海|厦门|汕头|潮州|泉州/.test(n)) out.push("进寺庙注意着装，别穿拖鞋背心；海边下水解凉前先问清浴场开放时间");
  if (/故宫|Beijing|北京/.test(n)) out.push("故宫等大景区实名制，带好证件；周一多数博物馆闭馆");
  if (/香港|澳门|台北/.test(n)) out.push("入境要办通行证/入台证；公共交通禁饮食，扶梯靠右站");
  if (/喀什|乌鲁木齐|伊犁|吐鲁番/.test(n)) out.push("斋月期间白天公共场所饮食请留意场合");
  if (!out.length) out.push("进寺庙着装得体、不踩门槛；餐馆排队先取号，别插队");
  return out;
}

// 13) 伴手礼清单（只挑「带得走」的：干货/茶酒/糕点/调味/工艺品，现做的给出替代建议）
function souvenirOf(city) {
  const c = typeof city === "string" ? findCity(city) : city;
  if (!c) return [];
  // 便携关键词：这类名字大概率有真空/礼盒装
  const PORTABLE = /茶|酒|酥|饼|糕|糖|脯|干|酱|火腿|腊|火腿|牛肉|肉脯|糕点|桃酥|鲜花饼|耳块|咖啡|蜂蜜|枸杞|菌|坚果|橄榄|梅|醋|豆瓣|火锅底料|糕点/;
  const portable = (Array.isArray(c.foods) ? c.foods : []).filter(f => PORTABLE.test(f));
  const out = portable.slice(0, 3).map(f => f + "：认准正规商超/老字号，真空或礼盒装更耐带");
  const fresh = (Array.isArray(c.foods) ? c.foods : []).filter(f => !PORTABLE.test(f)).slice(0, 2);
  if (fresh.length) out.push("现做的" + fresh.join("、") + "带不走，建议买「火锅底料 / 调味包」等同类衍生品替代");
  out.push("轻量兜底：冰箱贴 / 明信片 / 城市文创（不占地，送人不踩雷）");
  if (/高温|热/.test(c.best || "") || /hot|tropical/.test(c.climate || "")) out.push("注意保质期：热带城市买糕点类尽量出发前一晚再买");
  return out;
}

// 14) 雨天备选（从该城备选池挑室内/文化类）
function rainyDayPlan(plan, di) {
  const arr = _pd(plan);
  const d = arr[di];
  if (!d) return [];
  const cityName = d.cityName || (arr[0] && arr[0].cityName) || "";
  const cand = freeSlotPicker(plan, di);
  const indoor = cand.filter(n => /博物馆|美术馆|馆|寺|祠|书院|商场|书店|宫|故居|纪念馆|故居/.test(n));
  const list = indoor.length ? indoor : cand;
  return list.slice(0, 4).map((n, i) => (i + 1) + ". " + n + "（室内/半室内，下雨也能去）");
}

// 15) 夜间去处（该城夜生活相关条目）
function nightLifeList(plan, di) {
  const arr = _pd(plan);
  const d = arr[di];
  if (!d) return [];
  const items = (Array.isArray(d.items) ? d.items : []).map(_nm).filter(Boolean);
  const night = items.filter(n => /夜市|夜景|宵夜|酒吧|灯光| River|南锣|九眼桥|外滩|江滩/.test(n));
  if (night.length) return night;
  const cityName = d.cityName || "";
  const c = findCity(cityName);
  const pool = c ? [].concat((D.CITY_LANDMARKS && D.CITY_LANDMARKS[cityName]) || [], (Array.isArray(c.experiences) ? c.experiences : []).map(e => e.name)) : [];
  return pool.filter(n => /夜市|夜景|宵夜|酒吧|灯光|公园/.test(n)).slice(0, 3);
}

// 16) 错峰建议（把每天最挤的点挪到开放/闭馆边缘时段）
function crowdAvoid(plan, di) {
  const arr = _pd(plan);
  const d = arr[di];
  if (!d) return [];
  const items = (Array.isArray(d.items) ? d.items : []).map(_nm).filter(Boolean);
  const hot = items.filter(n => /故宫|兵马俑|长城|迪士尼|环球|博物馆|外滩|西湖|古城|古镇|布达拉/.test(n));
  if (!hot.length) return [];
  return hot.slice(0, 3).map(n => n + "：开门即入（提前 30 分钟到）或闭馆前 1 小时进，正午人最多");
}

// 17) 新手易错清单（按目的地/行程特征生成）
function mistakeChecklist(plan) {
  const arr = _pd(plan);
  const cityName = (arr[0] && arr[0].cityName) || "";
  const c = findCity(cityName);
  const s = arr.flatMap(d => (Array.isArray(d.items) ? d.items : []).map(_nm)).join(" ");
  const out = ["证件/身份证随身，很多景区实名核验"];
  if (/火车|高铁|动车/.test((c && c.travel) || "")) out.push("高铁票看清出发站：同城多站最常走错");
  if (/机场/.test((c && c.travel) || "")) out.push("航班提前 2 小时到，节假日再加 30 分钟");
  if (/高原|海拔/.test((c && (c.travel || "")) + (c && c.best || "")) || (c && c.climate === "plateau")) out.push("高原第一天别安排大运动量，备好防高反药");
  if (/海|岛|滩/.test(s)) out.push("海边行程看潮汐和台风预警，船票提前订");
  if (/博物馆|美术馆/.test(s)) out.push("热门馆要实名预约，先查开放日，周一很多馆休");
  if (/山|峰|峡谷|长城/.test(s)) out.push("登山穿防滑鞋，带够水，别卡着闭园时间下山");
  out.push("把电子票/预约码截图保存：山区或地下常没信号");
  return out;
}

// 18) 行程一张卡（城市/天数/人数/预算/进度）
function snapshotCard(plan) {
  const arr = _pd(plan);
  if (!arr.length) return null;
  const sp = _planSpan(plan);
  const cities = [];
  const seenC = new Set();
  arr.forEach(d => { const cn = d.cityName || ""; if (cn && !seenC.has(cn)) { seenC.add(cn); cities.push(cn); } });
  const spent = Array.isArray(store.get(LEDGER_KEY, [])) ? store.get(LEDGER_KEY, []).reduce((s, b) => s + (Number(b && b.amount) || 0), 0) : 0;
  return {
    city: cities.join(" → ") || "—",
    range: sp.start && sp.end ? sp.start.slice(5) + " ~ " + sp.end.slice(5) : "—",
    days: sp.days, nights: Math.max(0, sp.days - 1),
    people: (plan && plan.people) || 1,
    budget: plan ? budgetTotalObj(plan) : 0,
    spent,
    progress: ((typeof tripCountdown === "function" ? tripCountdown(plan) : null) || {}).phase || "—",
    score: (typeof tripScoreOf === "function") ? tripScoreOf(plan).score : 0
  };
}

// 19) 下一站推荐（基于 recently + 同省未去过 + 季节合适）
function nextCitySuggest() {
  const st = visitProgress();
  const now = new Date().getMonth() + 1;
  const scored = st.next.map(n => {
    const c = findCity(n);
    let s = 50;
    if (c) {
      const best = c.best || "";
      const nums = best.match(/(\d{1,2})/g);
      if (nums && nums.map(Number).some(x => Math.abs(x - now) <= 1)) s += 30;
      s += (Array.isArray(c.experiences) ? c.experiences : []).length;
      if (c.cost === "low") s += 6;
    }
    return { name: n, why: c && c.best ? "最佳季：" + c.best : "常年可去", score: s };
  }).sort((a, b) => b.score - a.score);
  return { list: scored, top: scored[0] ? scored[0].name : "", gone: st.gone, total: st.total };
}

// 20) 存储体检（用量 / 最大键 / 清理建议）
function storageHealth() {
  const u = store.usage();
  const keys = [LEDGER_KEY, WISH_KEY, RECENT_KEY, PLANS_KEY, FAV_KEY, NOTES_KEY, FOOT_KEY, PREPTK_KEY, PREP_KEY];
  const rows = keys.map(k => ({ key: k, kb: store.sizeOf(k) })).filter(r => r.kb > 0).sort((a, b) => b.kb - a.kb);
  const tips = [];
  if (u && u.pct >= 80) tips.push("存储已用 " + u.pct + "%，建议导出备份后清理旧行程");
  const big = rows.find(r => r.kb >= 100);
  if (big) tips.push("「" + big.key + "」占 " + big.kb + "KB，是最大项");
  if (!tips.length) tips.push("存储健康，无需清理");
  return { usage: u, rows, tips, txt: (u ? "已用 " + u.current + "KB / " + u.keys + " 个键" : "无法读取用量") };
}

/* ============ v1.12 · 100 项新功能（第1批：交通 + 行程规划） ============ */
// 城市坐标（GCJ-02，取 CITY_COORDS 或 SPOT_COORDS 首条）
function _cityCoord(cityName) {
  const cc = (D.CITY_COORDS && D.CITY_COORDS[cityName]);
  if (cc && Array.isArray(cc) && cc.length >= 2 && typeof cc[0] === "number") return { latitude: cc[0], longitude: cc[1] };
  const sc = (D.SPOT_COORDS && D.SPOT_COORDS[cityName]) || [];
  if (sc.length && sc[0][1] != null) return { latitude: sc[0][1], longitude: sc[0][2] };
  return null;
}
// 1) 两城高铁/动车信息（TRAIN_TABLE 双向查）
function trainBetween(a, b) {
  const na = String(a || "").trim(), nb = String(b || "").trim();
  if (!na || !nb) return null;
  const key = na + "→" + nb, key2 = nb + "→" + na;
  const hit = (D.TRAIN_TABLE && D.TRAIN_TABLE[key]) || (D.TRAIN_TABLE && D.TRAIN_TABLE[key2]);
  if (!hit) return { from: na, to: nb, found: false, txt: "暂无直达高铁数据，建议查 12306 或转乘" };
  return Object.assign({ from: na, to: nb, found: true, reverse: !!D.TRAIN_TABLE[key2] }, hit);
}
// 2) 机场三字码
function flightCodeOf(cityName) {
  const n = String(cityName || "").trim();
  if (!n) return "";
  return (D.AIRPORT_CODES && D.AIRPORT_CODES[n]) || "";
}
// 3) 两城直线距离（km，缺坐标返回 null）
function routeDist(a, b) {
  const ca = _cityCoord(a), cb = _cityCoord(b);
  if (!ca || !cb) return null;
  return Math.round(_havKm(ca, cb));
}
// 4) 周边城市：按直线距离排序，取前 n 个（排除自身，含距离）
function nearbyCities(cityName, n) {
  const c0 = _cityCoord(cityName);
  const out = [];
  if (!c0) return out;
  (Array.isArray(D.CITIES) ? D.CITIES : []).forEach(c => {
    if (c.name === cityName) return;
    const cc = _cityCoord(c.name);
    if (!cc) return;
    const km = _havKm(c0, cc);
    out.push({ name: c.name, province: c.province || (D.CITY2PROV && D.CITY2PROV[c.name]) || "", km: Math.round(km) });
  });
  out.sort((x, y) => x.km - y.km);
  return out.slice(0, n == null ? 6 : n);
}
// 5) 城际耗时估算（按直线距离粗估：高铁 ~1.5km/分钟 起步半小时）
function cityHopTime(a, b) {
  const km = routeDist(a, b);
  if (km == null) return { km: 0, min: 0, txt: "无法估算" };
  const min = Math.max(30, Math.round(km / 1.6));
  let txt;
  if (km < 100) txt = "约 " + min + " 分钟（高铁/动车）";
  else if (km < 400) txt = "约 " + Math.round(min / 60 * 10) / 10 + " 小时（高铁）";
  else if (km < 1200) txt = "约 " + Math.round(min / 60 * 10) / 10 + " 小时，建议高铁或飞机";
  else txt = "跨省长途，建议飞机（约 " + Math.round(km / 700 * 10) / 10 + " 小时含候机）";
  return { km, min, txt };
}
// 6) 单日景点按坐标重排（减少折返：从起点/前一天终点就近贪心）
function dayPlanOrder(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  const cityName = segCityOfDay(plan, di) || (plan.cityName || "") || (day.cityName || "");
  const pts = [];
  const seen = new Set();
  (Array.isArray(day.items) ? day.items : []).forEach(it => {
    if (isFrameName(it.name)) return;
    const nm = cleanSpotName(it.name);
    if (!nm || seen.has(nm)) return;
    seen.add(nm);
    try {
      const c = P.getSpotCoord(cityName, nm);
      if (c && c.lat != null && c.lon != null) pts.push({ name: nm, latitude: c.lat, longitude: c.lon });
    } catch (e) {}
  });
  if (pts.length < 2) return pts.map(p => p.name);
  const order = [pts.shift()];
  while (pts.length) {
    let bi = 0, bd = Infinity;
    const cur = order[order.length - 1];
    pts.forEach((p, i) => { const d = _havKm(cur, p); if (d < bd) { bd = d; bi = i; } });
    order.push(pts.splice(bi, 1)[0]);
  }
  return order.map(p => p.name);
}
// 7) 上午景点（按 period 关键词）
function morningSpots(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  return (Array.isArray(day.items) ? day.items : []).filter(it => {
    const p = String(it && it.period || ""), n = _nm(it);
    return /上午|早|清晨|日出/.test(p) && !isFrameName(n);
  }).map(_nm).filter(Boolean);
}
// 8) 下午景点
function afternoonSpots(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  return (Array.isArray(day.items) ? day.items : []).filter(it => {
    const p = String(it && it.period || "");
    return /下午|午后/.test(p) && !isFrameName(_nm(it));
  }).map(_nm).filter(Boolean);
}
// 9) 晚上景点
function eveningSpots(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  return (Array.isArray(day.items) ? day.items : []).filter(it => {
    const p = String(it && it.period || ""), n = _nm(it);
    return /晚|夜|夜景|夜市|酒吧/.test(p) && !isFrameName(n);
  }).map(_nm).filter(Boolean);
}
// 10) 全天景点
function fullDaySpots(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  return (Array.isArray(day.items) ? day.items : []).filter(it => {
    const p = String(it && it.period || "");
    return /全天|不限/.test(p) && !isFrameName(_nm(it));
  }).map(_nm).filter(Boolean);
}
// 11) 必看景点（experiences 里 note 含"必"或"招牌"或首位）
function mustSeeOf(cityName) {
  const c = findCity(cityName);
  if (!c) return [];
  const ex = Array.isArray(c.experiences) ? c.experiences : [];
  const names = ex.map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  const must = ex.filter(e => {
    const n = (typeof e === "string" ? "" : (e.note || e.desc || ""));
    return /必去|必游|必看|招牌|名片|头牌|镇馆|不可错过/.test(String(n));
  }).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  return (must.length ? must : names.slice(0, 2)).slice(0, 5);
}
// 12) 单日行程密度（景点数 + 是否偏赶）
function itineraryDensity(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return { n: 0, level: "", txt: "" };
  const n = (Array.isArray(day.items) ? day.items : []).filter(it => !isFrameName(_nm(it))).length;
  let level, txt;
  if (n <= 2) { level = "轻松"; txt = "节奏很松，可以睡到自然醒，多留点拍照时间"; }
  else if (n <= 4) { level = "适中"; txt = "松紧合适，按顺序走基本不赶"; }
  else if (n <= 6) { level = "偏满"; txt = "点偏多，建议删掉 1-2 个顺路的"; }
  else { level = "过载"; txt = "太赶了，一天跑不过来，强烈建议拆分"; }
  return { n, level, txt };
}
// 13) 景点分簇（同城景点按坐标距离聚成片区，简单阈值聚类）
function spotClusterOf(cityName, maxKm) {
  const c = findCity(cityName);
  if (!c) return [];
  const names = (Array.isArray(c.experiences) ? c.experiences : []).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  const pts = [];
  names.forEach(nm => { try { const g = P.getSpotCoord(cityName, nm); if (g && g.lat != null) pts.push({ name: nm, latitude: g.lat, longitude: g.lon }); } catch (e) {} });
  const thr = maxKm == null ? 8 : maxKm;
  const clusters = [];
  pts.forEach(p => {
    let hit = null;
    for (const cl of clusters) if (cl.some(q => _havKm(p, q) < thr)) { hit = cl; break; }
    if (hit) hit.push(p); else clusters.push([p]);
  });
  return clusters.filter(cl => cl.length).map(cl => ({ spots: cl.map(x => x.name) }));
}
// 14) 多城联程顺序（就近贪心，返回串游顺序）
function transferChain(cityNames) {
  const arr = (Array.isArray(cityNames) ? cityNames : []).filter(Boolean);
  if (arr.length < 2) return arr.slice();
  const rest = arr.slice(1), order = [arr[0]];
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((nm, i) => { const d = routeDist(order[order.length - 1], nm); if (d == null) return; if (d < bd) { bd = d; bi = i; } });
    order.push(rest.splice(bi, 1)[0]);
  }
  return order;
}
// 15) 机场提示
function airportTipOf(cityName) {
  const code = flightCodeOf(cityName);
  if (!code) return { has: false, txt: "该城机场信息未收录，建议查航司或地图" };
  return { has: true, code, txt: "机场三字码 " + code + "，提前 2 小时到，值机截止一般在起飞前 45 分钟" };
}
// 16) 到达时间建议（结合当天行程）
function arriveHint(depart) {
  const d = String(depart || "").slice(0, 10);
  if (!d) return "建议上午到，下午能直接开玩，晚上到会浪费半天";
  const dow = _wd(d);
  if (dow === 5 || dow === 6) return "周末到人流量大，建议早点（上午）到，避开午后客流高峰";
  return "工作日到，中午前后到即可，先办入住再轻松开逛";
}
// 17) 出发时间建议
function departHint(depart) {
  const d = String(depart || "").slice(0, 10);
  if (!d) return "返程建议下午走，上午还能补一两个没逛的";
  const dow = _wd(d);
  if (dow === 0 || dow === 6) return "周末返程车票紧张，建议提前买好下午车票";
  return "下午返程最从容，上午补景点，赶高铁提前 1 小时到站";
}
// 18) 景区入口/购票提示（SPOT_TICKETS）
function entranceHintOf(name) {
  const n = cleanSpotName(name);
  if (!n) return "";
  const t = D.SPOT_TICKETS && D.SPOT_TICKETS[n];
  if (!t) return "";
  return "门票 " + (t.p || "需查") + (t.where ? "，购票/预约：" + t.where : "");
}
// 19) 索道提示（关键词）
function cableHintOf(name) {
  const n = String(name || "");
  if (/山|峰|岳|崖|顶|峡/.test(n) && /缆|索道|登山/.test(n)) return "有索道，建议上行坐索道省体力、下行徒步看景";
  if (/山|峰|岳|顶/.test(n)) return "山地景点，留意是否有索道或接驳车，膝盖不好建议坐索道";
  return "";
}
// 20) 景区接驳提示
function busHintOf(name) {
  const n = String(name || "");
  if (/大峡谷|国家公园|地质公园|景区|草原|湿地|古镇|古城|岛/.test(n)) return "这类景区通常有内部接驳车/观光车，进门前先问清楚再决定走哪段";
  return "";
}
// 21) 早关门景点（博物馆类）
function earlyCloseOf(cityName) {
  const c = findCity(cityName);
  if (!c) return [];
  return (Array.isArray(c.experiences) ? c.experiences : []).filter(e => {
    const n = (typeof e === "string" ? e : (e.name || e.t || ""));
    return _MUSEUM_RE.test(n);
  }).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
}
// 22) 山岳住宿提示
function stayMountTip(plan) {
  const arr = _pd(plan);
  const days = arr.filter(d => (Array.isArray(d.items) ? d.items : []).some(it => /山|峰|岳|顶|峡/.test(_nm(it))));
  if (!days.length) return { has: false, txt: "本行程无明显山岳景点" };
  return { has: true, txt: "含 " + days.length + " 天山地行程：想看日出/云海就住山顶或山脚景区，条件一般但省往返" };
}
// 23) 空档填充（当天景点少时补同城候选）
function gapFillOf(plan, di) {
  const day = _pd(plan)[di];
  if (!day) return [];
  const n = (Array.isArray(day.items) ? day.items : []).filter(it => !isFrameName(_nm(it))).length;
  if (n >= 4) return [];
  const cityName = segCityOfDay(plan, di) || (plan.cityName || "");
  const used = new Set((Array.isArray(day.items) ? day.items : []).map(_nm));
  const c = findCity(cityName);
  if (!c) return [];
  return (Array.isArray(c.experiences) ? c.experiences : []).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(x => x && !used.has(x)).slice(0, 3);
}
// 24) 行程景点总数
function spotCountOf(plan) {
  const arr = _pd(plan);
  let n = 0;
  arr.forEach(d => { n += (Array.isArray(d.items) ? d.items : []).filter(it => !isFrameName(_nm(it))).length; });
  return n;
}
// 25) 单日里程（按坐标顺序累计）
function dayKmOf(plan, di) {
  const order = dayPlanOrder(plan, di);
  const cityName = segCityOfDay(plan, di) || ((plan && plan.cityName) || "");
  let km = 0, last = null;
  order.forEach(nm => { try { const g = P.getSpotCoord(cityName, nm); if (g && g.lat != null) { const p = { latitude: g.lat, longitude: g.lon }; if (last) km += _havKm(last, p); last = p; } } catch (e) {} });
  return Math.round(km);
}

/* ============ v1.12 · 100 项新功能（第2批：美食 + 天气） ============ */
// 26) 美食街区（FOOD_SPOTS，含坐标可导航）
function foodStreetOf(cityName) {
  const n = String(cityName || "").trim();
  const list = (D.FOOD_SPOTS && D.FOOD_SPOTS[n]) || [];
  return (Array.isArray(list) ? list : []).slice(0, 12);
}
// 27) 美食地图点位（去重按 food 归组，附坐标）
function foodMapOf(cityName) {
  const list = foodStreetOf(cityName);
  return list.map(x => ({ food: x.food, shop: x.shop, addr: x.addr, lat: x.lat, lon: x.lon, price: x.price }));
}
// 28) 省级美食（PROVINCE_INFO.foods）
function provFoodOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const info = (D.PROVINCE_INFO && D.PROVINCE_INFO[prov]) || (D.PROVINCE_INFO && D.PROVINCE_INFO[String(prov).replace(/省|市|自治区|壮族|回族|维吾尔/g, "")]);
  return (info && Array.isArray(info.foods)) ? info.foods.slice() : [];
}
// 29) 城市美食（PROVINCE_CITY_FOODS，兜底省级）
function cityFoodOf(cityName) {
  const n = String(cityName || "").trim();
  const own = (D.PROVINCE_CITY_FOODS && D.PROVINCE_CITY_FOODS[n]) || [];
  if (own.length) return own.slice();
  const c = findCity(n);
  if (c && Array.isArray(c.foods)) return c.foods.slice();
  return provFoodOf(n);
}
// 30) 必吃 TOP3
function foodTop3(cityName) {
  const own = cityFoodOf(cityName);
  const c = findCity(cityName);
  const merged = own.concat(c && Array.isArray(c.foods) ? c.foods : []);
  const uniq = [...new Set(merged.filter(Boolean))];
  return uniq.slice(0, 3);
}
// 31) 美食价格区间（从 FOOD_SPOTS 的 price 解析）
function foodPriceRange(cityName) {
  const list = foodStreetOf(cityName);
  const nums = [];
  list.forEach(x => { const m = String(x.price || "").match(/¥?\s*(\d+)/); if (m) nums.push(Number(m[1])); });
  if (!nums.length) return { min: 0, max: 0, txt: "暂无价格数据" };
  const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
  return { min, max, txt: "人均约 ¥" + min + " ~ ¥" + max };
}
// 32) 早餐推荐
function breakfastPlace(cityName) {
  const c = findCity(cityName);
  const foods = cityFoodOf(cityName);
  const note = c && c.foodNote ? c.foodNote : "";
  const bf = /早|糁|汤包|生煎|馄饨|面|烧饼|粥|粉|米线/.test(foods.join(" ")) ? "早餐尝本地汤面/粉类最地道" : "早餐去老街、菜市场周边的小店，烟火气最足";
  return { foods: foods.slice(0, 3), tip: bf, note: note ? String(note).slice(0, 60) : "" };
}
// 33) 晚餐推荐
function dinnerPlace(cityName) {
  const list = foodStreetOf(cityName);
  const dinner = list.filter(x => !/早|豆浆|生煎|烧饼|包子|馄饨/.test(x.food));
  return (dinner.length ? dinner : list).slice(0, 5).map(x => x.shop + "（" + x.food + "，人均 " + x.price + "）");
}
// 34) 夜宵推荐
function lateSnackPlace(cityName) {
  const c = findCity(cityName);
  const list = foodStreetOf(cityName);
  const night = list.filter(x => /烧烤|小龙虾|夜宵|串|啤酒|火锅|麻辣|卤|鸭|粥/.test(x.food));
  if (night.length) return night.slice(0, 4).map(x => x.shop + "（" + x.food + "）");
  const txt = c && c.areas ? (c.areas.map(a => a.name).join("、") || "") : "";
  return txt ? ["夜宵去 " + txt + " 一带的小吃街、夜市"] : ["夜宵去市中心步行街/夜市，本地人聚集地最热闹"];
}
// 35) 本地饮品
function localDrink(cityName) {
  const n = String(cityName || "");
  if (/西安|陕西/.test(n)) return ["冰峰汽水", "稠酒"];
  if (/长沙|湖南/.test(n)) return ["茶颜悦色", "白沙井水"];
  if (/成都|重庆|四川/.test(n)) return ["盖碗茶", "唯怡豆奶"];
  if (/广东|广州|潮汕/.test(n)) return ["广式凉茶", "功夫茶"];
  if (/北京/.test(n)) return ["北冰洋", "酸梅汤"];
  if (/新疆|喀什|乌鲁木齐/.test(n)) return ["卡瓦斯", "酸奶"];
  if (/云南|大理|丽江/.test(n)) return ["酸角汁", "普洱茶"];
  if (/内蒙古|呼伦贝尔|锡林郭勒/.test(n)) return ["咸奶茶", "马奶酒"];
  return ["当地特色饮品", "老字号茶饮"];
}
// 36) 季节天气（SEASON_WX，按 climate）
function seasonWeather(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  return (D.SEASON_WX && D.SEASON_WX[climate]) || null;
}
// 37) 月度天气（按当前月取季节）
function monthWeather(cityName, month) {
  const wx = seasonWeather(cityName);
  if (!wx) return "";
  const m = month == null ? (new Date().getMonth() + 1) : month;
  const season = _seasonKeyOf(m);
  return wx[season] || "";
}
// 38) 降雨提示（climate 相关）
function rainLikely(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  if (climate === "hot" || climate === "tropical") return { high: true, txt: "多雨/多雷阵雨，随身带折叠伞，留意台风预警" };
  if (climate === "plateau" || climate === "dry") return { high: false, txt: "少雨干燥，补水防晒为主，伞可省" };
  return { high: false, txt: "降水适中，春秋偶有雨，带把轻便伞有备无患" };
}
// 39) 降雪提示
function snowLikely(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  if (climate === "cold") return { high: true, txt: "冬季多雪，防滑防冻，鞋子要防滑" };
  return { high: false, txt: "降雪少，冬季偶有雪，注意保暖即可" };
}
// 40) 台风提示（华南沿海）
function typhoonHint(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/广东|海南|福建|浙江|广西|台湾|香港|澳门/.test(prov)) return { risk: true, txt: "7-10 月台风季，出行前查预警，沿海行程留备选" };
  return { risk: false, txt: "无台风影响" };
}
// 41) 最佳出行月（PROVINCE_INFO.best / 城市 best）
function bestTravelMonth(cityName) {
  const c = findCity(cityName);
  if (c && c.best) return c.best;
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const info = (D.PROVINCE_INFO && D.PROVINCE_INFO[prov]);
  return (info && info.best) || "4-5月、9-11月";
}
// 42) 旺季提示
function peakSeasonHint(cityName) {
  const best = bestTravelMonth(cityName);
  return "旺季集中在 " + best + "，住宿和机票提前订，景点排队久，尽量赶早" ;
}
// 43) 淡季提示
function offSeasonHint(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  const low = climate === "cold" ? "11-2月最冷，人少价低，注意保暖" : "1-2月、6月人相对少，错峰划算";
  return low + "，酒店折扣多，适合预算有限的深度游";
}
// 44) 温度区间（按 climate 粗估）
function tempRangeOf(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  const R = { tropical: [24, 33], hot: [18, 32], temperate: [8, 24], cold: [-15, 10], dry: [0, 22], plateau: [3, 18] };
  const r = R[climate] || R.temperate;
  return { min: r[0], max: r[1], txt: "年均约 " + r[0] + " ~ " + r[1] + "℃" };
}
// 45) 湿度提示
function humidityHint(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  if (climate === "hot" || climate === "tropical") return { high: true, txt: "湿热，多汗多带替换衣物，注意防潮" };
  if (climate === "dry" || climate === "plateau") return { high: false, txt: "干燥，护手霜唇膏润肤露带上，多喝水" };
  return { high: false, txt: "湿度适中" };
}
// 46) 天气打包清单（按 climate 给行李建议）
function weatherPackList(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  const base = ["换洗衣物", "洗漱用品", "充电宝", "身份证件"];
  if (climate === "cold") return base.concat(["羽绒服", "保暖内衣", "防滑鞋", "手套围巾"]);
  if (climate === "plateau") return base.concat(["防晒霜", "墨镜", "遮阳帽", "保湿霜", "常用药(高反备用)"]);
  if (climate === "tropical" || climate === "hot") return base.concat(["防晒霜", "遮阳帽", "驱蚊液", "轻便雨具"]);
  if (climate === "dry") return base.concat(["防晒霜", "润唇膏", "保湿霜", "围巾挡风沙"]);
  return base.concat(["轻外套", "折叠伞", "防晒霜"]);
}
// 47) 三餐规划
function mealPlanOf(cityName) {
  const foods = cityFoodOf(cityName);
  return { breakfast: foods[0] || "当地早餐", lunch: foods[1] || "特色主食", dinner: foods[2] || "硬菜/招牌" };
}
// 48) 餐饮预算（按 cost 档粗估 元/人/天）
function foodBudgetOf(cityName) {
  const c = findCity(cityName);
  const cost = (c && c.cost) || "mid";
  const R = { low: [40, 90], mid: [80, 160], high: [150, 350] };
  const r = R[cost] || R.mid;
  return { min: r[0], max: r[1], txt: "人均约 ¥" + r[0] + " ~ ¥" + r[1] + "/天" };
}
// 49) 辣度提示
function spicyLevelOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/四川|重庆|湖南|贵州|江西|云南/.test(prov)) return { spicy: true, lv: 3, txt: "重辣，点菜记得说少辣或微辣，别逞强" };
  if (/湖北|陕西/.test(prov)) return { spicy: true, lv: 2, txt: "偏辣，微辣即可" };
  return { spicy: false, lv: 1, txt: "口味偏清淡/咸鲜，不吃辣也友好" };
}
// 50) 素食提示
function vegHint(cityName) {
  const c = findCity(cityName);
  const foods = cityFoodOf(cityName);
  const veg = foods.filter(f => /素|斋|菜|笋|菌|豆|面|粥|粉/.test(f));
  return { count: veg.length, samples: veg.slice(0, 4), tip: veg.length ? "可点上述偏素菜式" : "寺庙周边或老字号一般有素斋" };
}

/* ============ v1.12 · 100 项新功能（第3批：预算 + 安全健康） ============ */
// 51) 门票价格（SPOT_TICKETS）
function ticketPriceOf(name) {
  const n = cleanSpotName(name);
  const t = (D.SPOT_TICKETS && D.SPOT_TICKETS[n]);
  if (!t) return { known: false, txt: "门票需到现场或官网确认" };
  return { known: true, price: t.p || "", book: !!t.book, where: t.where || "", url: t.url || "" };
}
// 52) 门票预订提示
function ticketBookHint(name) {
  const t = ticketPriceOf(name);
  if (!t.known) return "";
  if (!t.book) return "门票 " + t.price + "，一般现场可买";
  return "需预约：" + (t.where || "官网/小程序") + "，票 " + t.price;
}
// 53) 免费景点清单（某城）
function freeSpotList(cityName) {
  const c = findCity(cityName);
  if (!c) return [];
  const names = (Array.isArray(c.experiences) ? c.experiences : []).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  return names.filter(n => { const t = D.SPOT_TICKETS && D.SPOT_TICKETS[n]; return t && /免费/.test(String(t.p || "")); });
}
// 54) 收费景点清单
function paidSpotList(cityName) {
  const c = findCity(cityName);
  if (!c) return [];
  const names = (Array.isArray(c.experiences) ? c.experiences : []).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  return names.filter(n => { const t = D.SPOT_TICKETS && D.SPOT_TICKETS[n]; return t && !/免费/.test(String(t.p || "")); });
}
// 55) 门票总预算（按行程内景点）
function ticketTotal(plan) {
  const arr = _pd(plan);
  let sum = 0, known = 0, unknown = 0;
  const seen = new Set();
  arr.forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
    const n = cleanSpotName(_nm(it));
    if (!n || seen.has(n)) return;
    seen.add(n);
    const t = D.SPOT_TICKETS && D.SPOT_TICKETS[n];
    if (!t) { return; }
    const m = String(t.p || "").match(/¥?\s*(\d+)/);
    if (m) { sum += Number(m[1]); known++; } else if (/免费/.test(t.p || "")) { } else { unknown++; }
  }));
  return { sum, known, unknown, txt: "门票约 ¥" + sum + (unknown ? "（另有 " + unknown + " 处需现场确认）" : "") };
}
// 56) 住宿预算（按 cost 档 元/晚）
function hotelBudgetOf(cityName) {
  const c = findCity(cityName);
  const cost = (c && c.cost) || "mid";
  const R = { low: [100, 220], mid: [220, 450], high: [450, 1200] };
  const r = R[cost] || R.mid;
  return { min: r[0], max: r[1], txt: "约 ¥" + r[0] + " ~ ¥" + r[1] + "/晚" };
}
// 57) 交通预算（市内 元/天）
function transportBudgetOf(cityName) {
  const c = findCity(cityName);
  const cost = (c && c.cost) || "mid";
  const R = { low: [10, 40], mid: [30, 80], high: [60, 150] };
  const r = R[cost] || R.mid;
  return { min: r[0], max: r[1], txt: "市内交通约 ¥" + r[0] + " ~ ¥" + r[1] + "/天" };
}
// 58) 预算构成（住宿/餐饮/交通/门票占比参考）
function budgetPieOf(cityName) {
  const h = hotelBudgetOf(cityName), f = foodBudgetOf(cityName), t = transportBudgetOf(cityName);
  const hv = (h.min + h.max) / 2, fv = (f.min + f.max) / 2, tv = (t.min + t.max) / 2, gv = 40;
  const total = hv + fv + tv + gv;
  const pct = v => Math.round(v / total * 100);
  return [
    { k: "住宿", v: Math.round(hv), pct: pct(hv) },
    { k: "餐饮", v: Math.round(fv), pct: pct(fv) },
    { k: "市内交通", v: Math.round(tv), pct: pct(tv) },
    { k: "门票", v: gv, pct: pct(gv) }
  ];
}
// 59) 省钱技巧
function saveTipsOf(cityName) {
  const c = findCity(cityName);
  const cost = (c && c.cost) || "mid";
  const tips = ["错峰出行，淡季住宿机票都便宜", "博物馆多免费或低价，可排在同一天", "住宿选地铁/公交沿线，省打车费"];
  if (cost === "high") tips.push("该城消费偏高，优先连锁快捷、避开景区内餐厅");
  else tips.push("该城消费亲民，本地苍蝇馆子比景区餐厅实惠一半");
  return tips;
}
// 60) 一次奢侈体验推荐
function splurgeTipOf(cityName) {
  const n = String(cityName || "");
  const list = foodStreetOf(cityName);
  const top = list.length ? list[0] : null;
  if (/杭州|西湖/.test(n)) return "坐一次西湖摇橹船或湖畔景观位晚餐";
  if (/上海|外滩/.test(n)) return "外滩江景位吃一顿，看陆家嘴夜景";
  if (/成都|重庆/.test(n)) return "吃一顿本地老火锅，点招牌九宫格";
  if (/北京/.test(n)) return "去一次老字号烤鸭店，或看一场演出";
  if (top) return "去 " + top.shop + " 吃一顿 " + top.food + "（" + top.price + "）";
  return "选一家本地口碑老字号，好好吃一顿招牌";
}
// 61) 性价比评分（0-100，物价低+景点多 → 分高）
function valueScoreOf(cityName) {
  const c = findCity(cityName);
  if (!c) return 0;
  const cost = (c && c.cost) || "mid";
  const n = (Array.isArray(c.experiences) ? c.experiences : []).length;
  let score = 60;
  if (cost === "low") score += 20; else if (cost === "high") score -= 15;
  score += Math.min(15, n * 2);
  return Math.max(30, Math.min(100, score));
}
// 62) 海拔提示（按气候/省份粗判）
function altitudeOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/西藏|青海/.test(prov)) return { high: true, m: 3000, txt: "高海拔 3000m+，注意高反" };
  if (/四川|云南|甘肃|新疆/.test(prov)) return { high: true, m: 1500, txt: "部分区域海拔较高，量力而行" };
  return { high: false, m: 200, txt: "平原/低海拔，无需担心高反" };
}
// 63) 高反风险
function altitudeRisk(cityName) {
  const a = altitudeOf(cityName);
  if (!a.high) return { risk: 0, txt: "无高反风险" };
  const tips = ["抵达后先适应半天，别剧烈运动", "多喝水、少饮酒、保证睡眠", "带点红景天/氧气瓶备用"];
  return { risk: a.m >= 3000 ? 3 : 2, m: a.m, txt: "海拔 " + a.m + "m 左右，", tips };
}
// 64) 防晒提示
function sunBlockHint(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  if (climate === "plateau" || climate === "dry") return { strong: true, txt: "紫外线强，SPF50 防晒 + 墨镜 + 帽子缺一不可" };
  if (climate === "tropical" || climate === "hot") return { strong: true, txt: "日晒强，勤补防晒，遮阳伞/帽带上" };
  return { strong: false, txt: "日常防晒即可" };
}
// 65) 防蚊虫提示
function insectHint(cityName) {
  const c = findCity(cityName);
  const climate = (c && c.climate) || "temperate";
  if (climate === "tropical" || climate === "hot") return { risk: true, txt: "湿热蚊虫多，驱蚊液、防蚊贴带上，野外防虫" };
  return { risk: false, txt: "蚊虫一般，夏季户外备点驱蚊液即可" };
}
// 66) 常见骗局提醒
function scamAlertOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const tips = ["景区周边高价『特产』慎买，货比三家", "路边拉客的一日游/包车别轻信，走正规平台", "打车认准正规车辆，先确认是否打表"];
  if (/云南|海南|四川|湖南/.test(prov)) tips.push("热门目的地低价团陷阱多，『零团费』基本都是购物团");
  return tips;
}
// 67) 应急电话
function emergencyOf(cityName) {
  return { police: "110", ambulance: "120", fire: "119", tourist: "12301 全国旅游服务热线", tip: "存好酒店地址，报警时先报准确位置" };
}
// 68) 常备药清单
function medKitList(cityName) {
  const a = altitudeOf(cityName);
  const base = ["感冒药", "肠胃药", "创可贴", "晕车药", "退烧药"];
  if (a.high) base.push("红景天(高反)", "氧气瓶(可选)");
  const c = findCity(cityName);
  if (c && /hot|tropical/.test(c.climate || "")) base.push("藿香正气水(防中暑)");
  return base;
}
// 69) 保险建议
function insuranceHint(cityName) {
  const a = altitudeOf(cityName);
  return {
    tip: "出行建议买一份含意外医疗的旅行险（几十元），",
    extra: a.high ? "高原地区务必确认险种覆盖高反、紧急转运" : "常规意外+医疗即可"
  };
}
// 70) 饮水安全
function waterHint(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/云南|贵州|四川|西藏|青海|新疆/.test(prov)) return { tip: "西部部分地区水质偏硬，肠胃敏感建议喝瓶装水" };
  return { tip: "城市自来水烧开可喝，路上买瓶装水最省心" };
}
// 71) 饮食安全
function foodSafeHint(cityName) {
  const spicy = spicyLevelOf(cityName);
  const tips = ["路边摊挑人气旺、现做的，别吃隔夜凉菜", "生冷海鲜慎食，肠胃不好少吃生腌"];
  if (spicy.spicy) tips.push("当地偏辣，肠胃弱的从微辣开始，备点肠胃药");
  return tips;
}
// 72) 夜间安全
function nightSafeHint(cityName) {
  return { tip: "夜间别走偏僻小巷，随身财物看好，打车走正规平台并分享行程给同伴" };
}
// 73) 交通安全
function trafficSafeHint(cityName) {
  return { tip: "过马路看信号灯，山城/景区路滑注意脚下，包车务必签正规平台订单" };
}
// 74) 健康准备
function healthPrepOf(cityName) {
  const a = altitudeOf(cityName), sun = sunBlockHint(cityName), ins = insectHint(cityName);
  return { altitude: a, sun, insect: ins, meds: medKitList(cityName) };
}
// 75) 砍价技巧
function bargainTip(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/云南|广西|海南|四川/.test(prov)) return "纪念品、特产可适当议价，先对半再慢慢磨；明码标价的景区店一般不讲价";
  return "多数正规店明码标价，夜市小摊可小额议价，别砍太狠伤和气";
}

/* ============ v1.12 · 100 项新功能（第4批：文化 + 实用工具 + 数据洞察） ============ */
// 76) 方言提示
function dialectOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const map = { 广东: "粤语", 福建: "闽南语/福州话", 上海: "上海话/吴语", 浙江: "吴语", 四川: "四川话", 重庆: "重庆话", 湖南: "湘语", 河南: "中原官话", 陕西: "关中话", 云南: "西南官话", 贵州: "西南官话", 广西: "粤语/壮语", 江苏: "吴语/江淮官话" };
  const d = map[prov] || "普通话为主";
  return { dialect: d, tip: "普通话基本畅通，学一句本地招呼会更亲切" };
}
// 77) 当地禁忌
function localTabooOf(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  if (/西藏|青海/.test(prov)) return ["转经、绕佛塔须顺时针", "寺庙内不拍照、不喧哗", "不摸藏族同胞头部", "玛尼堆别随意搬动"];
  if (/新疆/.test(prov)) return ["清真餐厅不携带猪肉、不饮酒", "尊重少数民族习俗", "拍照前先征得同意"];
  if (/内蒙古/.test(prov)) return ["进蒙古包别踩门槛", "接哈达用双手", "不踩敖包"];
  if (/宁夏|甘肃/.test(prov)) return ["清真场所注意着装", "不携带猪肉入清真餐厅"];
  return ["尊重当地风俗，拍照先询问", "寺庙祠堂内保持安静"];
}
// 78) 寺庙礼仪
function templeRule(cityName) {
  return ["入殿脱帽、不踩门槛", "不拍佛像（部分严禁）", "香火按规矩，别大声喧哗", "绕佛/绕塔顺时针"];
}
// 79) 拍照礼仪
function photoRule(cityName) {
  return ["拍人像先征得同意", "寺庙、博物馆注意禁拍标识", "边防/军事区域严禁拍照", "无人机先查是否禁飞"];
}
// 80) 用餐礼仪
function diningRule(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const base = ["等长辈/主人先动筷", "筷子别插在饭里"];
  if (/广东|香港|澳门/.test(prov)) base.push("茶楼倒茶礼：别人给你倒茶，用指尖轻点桌面致谢");
  if (/山东/.test(prov)) base.push("山东酒桌讲究座次，敬酒注意顺序");
  return base;
}
// 81) 当地节庆
function festivalOf(cityName) {
  const n = String(cityName || "");
  if (/哈尔滨/.test(n)) return ["哈尔滨冰雪节(1月)", "啤酒节(夏季)"];
  if (/西双版纳|云南/.test(n)) return ["泼水节(4月)", "火把节(6-7月)"];
  if (/潍坊/.test(n)) return ["潍坊国际风筝节(4月)"];
  if (/拉萨|西藏/.test(n)) return ["藏历新年", "雪顿节(夏季)"];
  if (/自贡/.test(n)) return ["自贡国际恐龙灯会(春节)"];
  if (/内蒙古|呼伦贝尔/.test(n)) return ["那达慕大会(7-8月)"];
  return ["春节/国庆等全国性节庆为主，出行前查当地文旅活动"];
}
// 82) 伴手礼（只推便携/易保存）
function giftIdea(cityName) {
  const prov = (D.CITY2PROV && D.CITY2PROV[cityName]) || "";
  const map = { 北京: ["稻香村点心", "景泰蓝小件"], 上海: ["大白兔奶糖", "上海牌手表"], 四川: ["郫县豆瓣", "蜀绣小件"], 云南: ["鲜花饼", "普洱茶"], 福建: ["铁观音", "线面"], 广东: ["广式腊味", "陈皮"], 浙江: ["西湖龙井", "丝绸方巾"], 江苏: ["苏绣", "碧螺春"], 湖南: ["剁椒", "湘绣"], 新疆: ["葡萄干", "和田玉(慎买)"], 内蒙古: ["牛肉干", "奶制品"] };
  return (map[prov] || ["本地特产点心", "手工艺品小件"]);
}
// 83) 行李清单（复用 PACK_LIST 精简 + 天气）
function luggageCheck(cityName) {
  const base = ["身份证/证件", "手机充电器", "充电宝", "洗漱用品", "换洗衣物"];
  const w = weatherPackList(cityName);
  return { must: base, byWeather: w.filter(x => !base.includes(x)) };
}
// 84) 拍照机位（日出日落点位 + 大景点）
function photoSpotOf(cityName) {
  const c = findCity(cityName);
  if (!c) return [];
  const names = (Array.isArray(c.experiences) ? c.experiences : []).map(e => (typeof e === "string" ? e : (e.name || e.t || ""))).filter(Boolean);
  const good = names.filter(n => /山|湖|海|江|河|塔|楼|桥|寺|古镇|古城|岛|草原|瀑布|峡|峰|日出|日落/.test(n));
  return (good.length ? good : names).slice(0, 5);
}
// 85) 网络提示
function wifiHint(cityName) {
  return { tip: "酒店/商场/景点多有免费 WiFi，公共 WiFi 注意别登录敏感账号，可办张本地流量卡更稳" };
}
// 86) 电源插座
function powerHint(cityName) {
  return { tip: "国内通用 220V 两孔/三孔插座，带个多口充电器+转换头备用" };
}
// 87) 手机卡建议
function simHint(cityName) {
  return { tip: "国内三大运营商信号覆盖好，按行程天数办一张全国流量卡/套餐即可" };
}
// 88) 离线地图
function mapHint(cityName) {
  return { tip: "出发前在导航 App 下载该城离线地图，信号差的山区/景区也不怕" };
}
// 89) 交通卡
function transportCardHint(cityName) {
  return { tip: "多数城市公交地铁支持手机扫码（微信/支付宝/云闪付），无需实体卡" };
}
// 90) 打车提示
function taxiHint(cityName) {
  return { tip: "用正规打车平台，上车前确认车牌一致；机场/车站别上黑车" };
}
// 91) 行李寄存
function luggageStoreHint(cityName) {
  return { tip: "火车站/机场多有行李寄存处，部分商场、景区也有自助寄存柜，退房后可以先寄存再逛" };
}
// 92) ATM 提示
function atmHint(cityName) {
  return { tip: "市区 ATM 多，景区偏远建议备少量现金；大额消费刷卡/移动支付最方便" };
}
// 93) 足迹地图（去过城市 + 坐标点）
function footMapOf() {
  const f = footStats();
  const pts = [];
  (f.cityList || []).forEach(nm => { const cc = _cityCoord(nm); if (cc) pts.push({ name: nm, latitude: cc.latitude, longitude: cc.longitude }); });
  return { cities: f.cities, spots: f.spots, points: pts };
}
// 94) 年度旅行总结（精简摘要）
function yearTravelSummary() {
  const f = footStats();
  const bills = store.get(LEDGER_KEY, []);
  const spent = (Array.isArray(bills) ? bills : []).reduce((s, b) => s + (Number(b && b.amount) || 0), 0);
  const nTrips = store.get(PLANS_KEY, []).length;
  return {
    cities: f.cities, spots: f.spots, spent: Math.round(spent), trips: nTrips,
    txt: "这一年点亮了 " + f.cities + " 座城市、" + f.spots + " 个足迹点，记账花费约 ¥" + Math.round(spent)
  };
}
// 95) 城市排行（按足迹去过标记，无标记则按 CITIES 顺序）
function cityRankOf() {
  const f = _footRaw();
  const cityCount = (f && f.cities) || {};
  return Object.keys(cityCount).map(name => {
    const info = cityCount[name] || {};
    const cnt = (info && info.count) || (info && info.n) || 1;
    return { name, count: cnt };
  }).sort((a, b) => b.count - a.count).slice(0, 10);
}
// 96) 旅行风格标签
function travelStyleTag() {
  const p = travelPersona();
  if (!p) return { tag: "旅行新手", txt: "还没点亮足迹，出发第一站吧" };
  return { tag: p.name || "旅行者", txt: (p.nature && p.nature) || "热爱在路上的你" };
}
// 97) 行程对比（两个 plan 的景点数/城市/天数）
function tripCompare(planA, planB) {
  const a = planA || {}, b = planB || {};
  const ac = segCityOfDay(a, 0) || a.cityName || "", bc = segCityOfDay(b, 0) || b.cityName || "";
  return {
    a: { city: ac, days: _pd(a).length, spots: spotCountOf(a) },
    b: { city: bc, days: _pd(b).length, spots: spotCountOf(b) }
  };
}
// 98) 花费趋势（按月聚合账本）
function budgetTrendOf() {
  const bills = store.get(LEDGER_KEY, []);
  const byMonth = {};
  (Array.isArray(bills) ? bills : []).forEach(b => {
    const d = String(b.date || b.day || "").slice(0, 7);
    if (!d) return;
    byMonth[d] = (byMonth[d] || 0) + (Number(b.amount) || 0);
  });
  const keys = Object.keys(byMonth).sort();
  return keys.map(k => ({ month: k, amt: Math.round(byMonth[k]) }));
}
// 99) 里程统计（按去过的城市两两距离累计）
function distanceStatOf() {
  const f = footStats();
  const coords = (f.cityList || []).map(nm => _cityCoord(nm)).filter(Boolean);
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += _havKm(coords[i - 1], coords[i]);
  return { cities: f.cityList.length, km: Math.round(km), txt: "足迹城市累计里程约 " + Math.round(km) + " km" };
}
// 100) 成就进度
function achievementProgress() {
  const f = footStats();
  const p = travelPersona();
  const list = [
    { k: "首站出发", done: f.cities >= 1, txt: "点亮第一座城市" },
    { k: "足迹 10 城", done: f.cities >= 10, txt: "点亮 10 座城市" },
    { k: "足迹 30 城", done: f.cities >= 30, txt: "点亮 30 座城市" },
    { k: "达人 100 景点", done: f.spots >= 100, txt: "点亮 100 个足迹点" },
    { k: "旅行画像", done: !!p, txt: "生成旅行画像" }
  ];
  const done = list.filter(x => x.done).length;
  return { done, total: list.length, pct: Math.round(done / list.length * 100), list };
}


/* ============ 新功能 P0（v1.19.13+） ============ */
// 行程体检：动线 / 节奏 / 重复 / 空日 / 预算 五维评分（0-100），并给可执行建议
function planCheckup(plan) {
  const out = { score: 100, items: [], tips: [] };
  try {
    const days = (plan && Array.isArray(plan.days) ? plan.days : []).map(d => (d && d.items ? d.items : []));
    if (!days.length) return { score: 0, items: [{ k: "empty", label: "行程为空", ok: false }], tips: ["先生成一份行程再体检"] };
    const _km2 = (a, b) => { const R=6371, dLa=(b.lat-a.lat)*Math.PI/180, dLo=(b.lon-a.lon)*Math.PI/180, la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180, h=Math.sin(dLa/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
    // 1) 动线：每天相邻真实景点的最大跨度
    let worstLeg = 0, worstDay = -1;
    days.forEach((its, di) => {
      const pts = its.map(it => ({ name: String(it.name || ""), per: it.period || "" }))
        .filter(x => x.name.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(x.name)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|散步|看演出|看音乐剧|看歌剧|看相声|看演艺/.test(x.name));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = P.getSpotCoord(plan.cityName || pts[i].cityName || "", pts[i].name);
        const b = P.getSpotCoord(plan.cityName || pts[i + 1].cityName || "", pts[i + 1].name);
        if (a && b && a.lat && b.lat) {
          const km = _km2({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
          if (km > worstLeg) { worstLeg = km; worstDay = di + 1; }
        }
      }
    });
    const legOk = worstLeg <= 35;
    out.items.push({ k: "route", label: "动线跨度", ok: legOk, detail: worstLeg ? "最长单段约 " + Math.round(worstLeg) + "km" : "暂无法计算" });
    if (!legOk) out.tips.push("第 " + worstDay + " 天相邻景点跨度偏大，建议把远郊点集中成一天（或缩短当日动线）");
    // 2) 节奏：每天条目数 2-9 为佳
    const thin = days.filter((its, i) => its.length < 2);
    const heavy = days.filter((its, i) => its.length > 9);
    const paceOk = !thin.length && !heavy.length;
    out.items.push({ k: "pace", label: "每日节奏", ok: paceOk, detail: "平均每天 " + Math.round(days.reduce((a, d) => a + d.length, 0) / days.length) + " 项" });
    if (thin.length) out.tips.push("有 " + thin.length + " 天安排偏少，可补 1-2 个顺路景点");
    if (heavy.length) out.tips.push("有 " + heavy.length + " 天过于密集，建议拆出半天自由活动");
    // 3) 重复景点（跨天）
    const seen = new Map();
    days.forEach((its) => its.forEach(it => {
      const n = String(it.name || "").replace(/[「」（）()]/g, "");
      if (n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)) {
        if (!seen.has(n)) seen.set(n, 0);
        seen.set(n, seen.get(n) + 1);
      }
    }));
    const dups = [...seen.entries()].filter(([k, v]) => v > 1);
    const dupOk = dups.length === 0;
    out.items.push({ k: "dup", label: "景点重复", ok: dupOk, detail: dupOk ? "无重复" : dups.map(([k, v]) => k + "×" + v).join("、") });
    if (!dupOk) out.tips.push("同一景点出现多次，可换一个同类替代");
    // 4) 空日
    const empty = days.filter(d => !d.length);
    out.items.push({ k: "empty", label: "空日", ok: !empty.length, detail: empty.length ? empty.length + " 天为空" : "无空日" });
    // 5) 预算
    let budgetOk = true, budgetTxt = "";
    try {
      const b = budgetStyleOf && budgetStyleOf(plan && plan.budget || "mid");
      budgetOk = !!b; budgetTxt = b || "";
    } catch (e) {}
    out.items.push({ k: "budget", label: "预算档位", ok: budgetOk, detail: budgetTxt || "未设置" });
    // 汇总
    const bad = out.items.filter(x => !x.ok).length;
    out.score = Math.max(0, 100 - bad * 18);
    if (out.score >= 90) out.tips.unshift("整体很顺，可以直接出发");
    else if (out.score >= 70) out.tips.unshift("行程不错，按上面建议微调会更顺");
    else out.tips.unshift("建议按建议调整后再出发");
  } catch (e) { out.score = 0; out.tips.push("体检异常：" + (e && e.message || "")); }
  return out;
}

// 一键换景点：找到与指定景点同标签、同城、坐标相近的替代景点名（返回名称数组，不落盘）
function swapSpotFor(plan, spotName, cityName) {
  const cn = cityName || (plan && plan.cityName) || "";
  const target = String(spotName || "").trim();
  if (!cn || !target) return [];
  try {
    const tags = spotTagOf(target, cn);
    const pool = poolOfCity(findCity(cn) || { name: cn });
    const used = new Set();
    (Array.isArray(plan && plan.days) ? plan.days : []).forEach(d => (d.items || []).forEach(it => used.add(String(it.name || ""))));
    const out = [];
    for (const n of pool) {
      if (!n || n === target || used.has(n)) continue;
      const t2 = spotTagOf(n, cn);
      const shared = tags.some(t => t2.indexOf(t) >= 0) || t2.some(t => tags.indexOf(t) >= 0);
      if (!shared) continue;
      out.push({ name: n, tags: t2, note: "同类替代 · " + t2.slice(0, 2).join(" / ") });
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) { return []; }
}

// AI 行程问答（本地规则版）：识别常见意图并给出可执行答复；未识别返回 null
function askTrip(plan, question) {
  const q = String(question || "").trim();
  if (!q) return null;
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    // 改 N 天
    let m = q.match(/(改|换成|变成)s*([1-9][0-9]?)s*天/);
    if (m) return { ok: true, txt: "可以把行程改成 " + m[2] + " 天。在首页调整天数重新生成即可，当前行程 " + days.length + " 天。" };
    // 第 N 天
    m = q.match(/第s*([1-9][0-9]?)s*天/);
    if (m) {
      const di = Math.min(parseInt(m[1], 10), days.length) - 1;
      const d = days[di];
      const its = d && d.items ? d.items.map(x => x.name).join(" → ") : "（无安排）";
      return { ok: true, txt: "第 " + (di + 1) + " 天：" + (d && d.cityName ? "在" + d.cityName + "，" : "") + its };
    }
    // 下雨
    if (/下雨|雨天|天气不好|改室内/.test(q)) {
      const indoor = (days[0] && days[0].items ? days[0].items : []).filter(x => /博物馆|美术馆|展览|科技馆|馆|商场|书店/.test(x.name));
      return { ok: true, txt: indoor.length ? "雨天推荐室内：今天已有 " + indoor[0].name + "。需要的话可以在景点卡上用「一键换景点」换成室内同类。" : "雨天建议换成博物馆/美术馆/商场这类室内点，用「一键换景点」即可。" };
    }
    // 换景点
    if (/换|替代|替换/.test(q)) {
      const cn = plan.cityName || "";
      const first = days[0] && days[0].items ? days[0].items.find(x => x.name.length >= 3 && !/^(抵达|入住|退房|返程|出发|前往)/.test(x.name)) : null;
      if (first) {
        const alts = swapSpotFor(plan, first.name, cn);
        return { ok: true, txt: alts.length ? "「" + first.name + "」可换：" + alts.map(a => a.name).slice(0, 3).join("、") : "暂没找到合适的同类替代" };
      }
    }
    // 预算
    if (/预算|钱|花费/.test(q)) {
      const b = budgetStyleOf && budgetStyleOf(plan && plan.budget || "mid");
      return { ok: true, txt: "当前预算档位：" + (b || "未设置") + "。可回首页切换经济/舒适/高端或自定义总预算重新生成。" };
    }
    // 吃什么
    if (/吃|美食|餐厅/.test(q)) {
      const cn = plan.cityName || "";
      const fs = foodSpotsFor(cn);
      return { ok: true, txt: fs && fs.length ? cn + " 推荐：" + fs.slice(0, 3).map(x => x.shop).join("、") : "「美食」页有该地小吃推荐，去看看。" };
    }
    return null;
  } catch (e) { return null; }
}


/* ============ 新功能 P1（v1.19.13+） ============ */
const _km2 = (a, b) => {
  const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// 动线优化建议：找出每天跨度过大的相邻对，给出换序/拆天建议
function routeAdvicePlus(plan) {
  const out = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    const cn = plan && plan.cityName;
    days.forEach((d, di) => {
      const items = (d && d.items) || [];
      const real = items.filter(it => {
        const n = String(it.name || "");
        return n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|散步|看演出|看音乐剧|看歌剧|看相声|看演艺/.test(n);
      });
      for (let i = 0; i + 1 < real.length; i++) {
        const a = P.getSpotCoord(cn || "", real[i].name);
        const b = P.getSpotCoord(cn || "", real[i + 1].name);
        if (a && b && a.lat && b.lat) {
          const km = _km2(a, b);
          if (km > 25) out.push({ day: di + 1, from: real[i].name, to: real[i + 1].name, km: Math.round(km), tip: "建议把较远的那个点挪到专门的一天，或与同方向景点合并" });
        }
      }
    });
  } catch (e) {}
  return out;
}

// 高光时刻标记：用 spotTiming 为每天挑出最佳出片/体验点
function highlightOf(plan) {
  const out = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    days.forEach((d, di) => {
      const items = (d && d.items) || [];
      const real = items.filter(it => {
        const n = String(it.name || "");
        return n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|散步|看演出|看音乐剧|看歌剧|看相声|看演艺|留白/.test(n);
      });
      const picked = real.find(it => {
        const t = typeof spotTiming === "function" ? spotTiming(it.name) : null;
        return t && t.best;
      }) || real[0];
      if (picked) {
        const t = typeof spotTiming === "function" ? spotTiming(picked.name) : null;
        out.push({ day: di + 1, name: picked.name, best: (t && t.best) || "全天", tip: (t && t.tip) || "顺路安排即可" });
      }
    });
  } catch (e) {}
  return out;
}

// 错峰提示：法定节假日 + 周末对热门景点给提示（静态规则）
const _HOLIDAYS = { "01-01": "元旦", "02-10": "春节", "04-05": "清明", "05-01": "五一", "06-10": "端午", "09-15": "中秋", "10-01": "国庆" };
function crowdTipOf(dateStr) {
  const d = String(dateStr || "");
  const md = d.slice(5, 10);
  const hol = _HOLIDAYS[md] || "";
  try {
    const dt = new Date(d + "T00:00:00");
    const wd = dt.getDay();
    const isWeekend = wd === 0 || wd === 6;
    if (hol) return { level: "高", txt: hol + "假期人流量大，热门景点建议提前预约、错开上午 10 点前入场" };
    if (isWeekend) return { level: "中", txt: "周末市区景点人流较多，热门点建议赶早" };
    return { level: "低", txt: "工作日出行，人流友好" };
  } catch (e) { return { level: "-", txt: "" }; }
}

// 行李清单增强：在 packSmart 基础上按行程特色追加项目（返回追加数组）
function packExtra(plan) {
  const add = [];
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    const names = [];
    days.forEach(d => (d.items || []).forEach(it => names.push(String(it.name || ""))));
    const all = names.join(" ");
    if (/山|峰|岭|栈道|徒步|登山|长城|峡谷|索道/.test(all)) add.push("登山鞋/防滑鞋");
    if (/海|海滩|岛|沙滩|海滨|浴场/.test(all)) add.push("泳衣/防晒/人字拖");
    if (/温泉/.test(all)) add.push("泳衣（温泉用）");
    if (/滑雪|冰雪/.test(all)) add.push("保暖手套/帽子/雪镜");
    if (/沙漠|戈壁/.test(all)) add.push("防风面巾/墨镜/润唇膏");
    if (/高原|海拔|拉萨|稻城|香格里拉|玉龙/.test(all)) add.push("红景天/润喉糖/防晒帽");
    if (/博物馆|美术馆|展览|演出|剧场|剧院/.test(all)) add.push("薄外套（室内空调冷）");
    if (/夜市|小吃街|美食/.test(all)) add.push("肠胃药/健胃消食片");
    if (/漂流|水上乐园/.test(all)) add.push("手机防水袋/速干衣");
  } catch (e) {}
  return add;
}


/* ============ 新功能 P1 留存批（v1.19.13+） ============ */
// 勋章成就：基于本地足迹/行程/记账统计解锁
const BADGE_RULES = [
  { id: "first", name: "出发啦", desc: "生成第一份行程", test: (s2) => s2.plans >= 1 },
  { id: "plan10", name: "攻略老手", desc: "累计生成 10 份行程", test: (s2) => s2.plans >= 10 },
  { id: "city5", name: "五城足迹", desc: "点亮 5 座城市", test: (s2) => s2.cities >= 5 },
  { id: "city20", name: "走遍半个中国", desc: "点亮 20 座城市", test: (s2) => s2.cities >= 20 },
  { id: "prov10", name: "跨省达人", desc: "足迹覆盖 10 个省份", test: (s2) => s2.provs >= 10 },
  { id: "ledger", name: "精打细算", desc: "记过 10 笔账", test: (s2) => s2.bills >= 10 },
  { id: "foot", name: "打卡狂魔", desc: "打卡过 30 个景点", test: (s2) => s2.foots >= 30 },
  { id: "day14", name: "长途旅行家", desc: "生成过 14 天以上行程", test: (s2) => s2.long >= 1 },
];
function badgesOf() {
  const st = { plans: 0, cities: 0, provs: 0, bills: 0, foots: 0, long: 0 };
  try {
    const saved = store.get("planSlotsV1", []) || [];
    st.plans = saved.length;
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) { st.cities = Object.keys(foot.cities || {}).length; st.provs = Object.keys(foot.provs || {}).length; st.foots = Object.keys(foot.spots || {}).length; }
    const ledger = getLedger();
    st.bills = Array.isArray(ledger) ? ledger.length : 0;
    if (saved.some(p => p && p.days && p.days.length >= 14)) st.long = 1;
  } catch (e) {}
  return BADGE_RULES.map(r => ({ id: r.id, name: r.name, desc: r.desc, got: r.test(st) }));
}

// 年度旅行报告：聚合当年足迹/账本/行程
function yearReportNew(year) {
  const y = String(year || new Date().getFullYear());
  const out = { year: y, cities: 0, days: 0, bills: 0, total: 0, provs: 0, top: "" };
  try {
    const saved = store.get("planSlotsV1", []) || [];
    const cityCnt = new Map();
    saved.forEach(p => {
      const ds = (p && p.days) || [];
      if (!ds.length) return;
      const firstDate = String((ds[0] && ds[0].date) || "").slice(0, 4);
      if (firstDate !== y) return;
      out.days += ds.length;
      const cnm = (p && p.cityName) || (ds[0] && ds[0].cityName) || "";
      if (cnm) cityCnt.set(cnm, (cityCnt.get(cnm) || 0) + 1);
    });
    out.cities = cityCnt.size;
    let topCity = "", topN = 0;
    cityCnt.forEach((v, k) => { if (v > topN) { topN = v; topCity = k; } });
    out.top = topCity;
    const led = getLedger().filter(x => String(x.date || "").slice(0, 4) === y);
    out.bills = led.length;
    out.total = led.reduce((a, x) => a + (Number(x.amt) || 0), 0);
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) out.provs = Object.keys(foot.provs || {}).length;
  } catch (e) {}
  return out;
}

// 点亮中国：足迹省份 + 城市（供可视化色块图用）
function chinaLite() {
  const out = { provs: [], cities: [] };
  try {
    const foot = (typeof footStats === "function") ? footStats() : null;
    if (foot) {
      out.provs = Object.keys(foot.provs || {});
      out.cities = Object.keys(foot.cities || {});
    }
  } catch (e) {}
  return out;
}

// 交通住宿预估参考（静态估算，非实时）：返回两城间高铁/住宿参考
const _RAIL_EST = { // 常用干线：城市对 → [小时, 二等座参考价]
  "北京-上海": [4.5, 553], "北京-广州": [8, 862], "北京-深圳": [8.5, 944], "上海-杭州": [1, 73],
  "上海-南京": [1.3, 135], "广州-深圳": [0.5, 75], "成都-重庆": [1.2, 154], "西安-郑州": [2.2, 239],
  "武汉-长沙": [1.3, 165], "杭州-苏州": [1.2, 117], "北京-西安": [4.5, 516], "上海-北京": [4.5, 553]
};
function transportEstimate(cityA, cityB) {
  const a = String(cityA || ""), b = String(cityB || "");
  if (!a || !b) return null;
  const k1 = a + "-" + b, k2 = b + "-" + a;
  const hit = _RAIL_EST[k1] || _RAIL_EST[k2];
  if (!hit) return null;
  const h = hit[0];
  return { railHours: h, railText: (h < 2 ? Math.round(h * 60) + " 分钟" : h + " 小时左右"), price: "二等座约 ¥" + hit[1], hotel: "连锁酒店 ¥200-450/晚（参考）" };
}

module.exports = {
 ready, planCheckup, swapSpotFor, askTrip,
 routeAdvicePlus, highlightOf, crowdTipOf, packExtra,
 badgesOf, yearReportNew, chinaLite, transportEstimate,
 provinces, citiesOf, findCity, canonCityName, buildPlan, buildMultiPlan, buildProvPlan, provinceDayCap, provinceSuggestedDays, cityDayCap, provBrief, nearbyCityOf, D, P,
 poolOfCity, wishPicksFor, foodSpotsFor, hotelPointFor,
 spotTagOf, searchSpots,
 customBudgetObj, budgetTotalObj,
 isFrameName, isDetailable, stripHtml, spotDetailText, spotNoteDisp, spotInfo, spotInfoText,
 normalizeDayItems,
 cleanSpotName, navTarget, baikeUrl, baikeKeyword,
 todayState, currentPeriodOrder, daySpots, nextActivity,
 LEDGER_KEY, getLedger, addLedger, delLedger, todaySpent, totalSpent, budgetPerDay, exportLedgerCSV,
 PREP_KEY, getPrepChecks, togglePrepCheck, resetPackChecks, resetTripPrep, prepPhaseList, PACK_LIST,
 PREPTK_KEY, getTicketTrack, setTicketTrack, tkKeyOf, exportICS,
 WISH_KEY, getWish, toggleWish, isWished, wishHit, wishHitsOf, clearWish,
 FAV_KEY, getFavs, isFaved, toggleFav, delFav,
 budgetDaily, budgetDesc, budgetLabel, budgetFoodFirst, clothAdvice, stayAdvice, goAdvice, copyPlanText,
 activeCityOf, askAssistant, exportBackup, importBackup,
 THEME_KEY, themeMode, setThemeMode, themeRootClass, applyNav, applyTabBar, fontScale, setFontScale,
 RECENT_KEY, getRecent, pushRecent, delRecent,
 PLANS_KEY, listSavedPlans, savePlanSlot, restorePlanSlot, delPlanSlot,
 exportCollabPlan, mergeCollabPlan,
 FOOT_KEY, isVisited, markVisited, footStats, tripFoot,
  segCityOfDay, settleUp, swapCandidates, swapSpot, swapCandidatesByTag, swapSpotByTag,
  spendByDay, NOTES_KEY, getNotes, noteOf, addNote, delNote,
  budgetGauge,
  parseQuickBill, guessCat, budgetSplit, SPLIT_BASE, tripCheck, tripHealth, packSmart, achievements, tripOverview,
  // v1.6.0
  dayAddCandidates, dayAddSpot, dayRemoveSpot,
  dailyBudget, spendForecast, tripReview,
  MATES_KEY, getMates, addMate, delMate,
  tripCountdown, cityBrief, CLIMATE_TXT, COST_TXT,
  themePref, setThemePref, sysTheme,
  // v1.7.0
  routeAdvice, FX_LIST, fxRates, fxSetRate, fxConvert,
  footHeatmap, ledgerMonthly, favRoute,
  TILES_KEY, HOME_TILES, homeTiles, setHomeTiles, homeTileList,
  spotTiming, DOC_ITEMS, docItems, docDone,
  inspire, bestMonths, dailyInspire, nightCfg, setNightCfg, isNightHour,
  billImgPath, setBillImg, getBillImg, billImgMap,
  APP_VER,
  // v1.8.4 档一 / 档二
  dateHintOf, dateHintsForPlan,
  dressForMonth, dressForTemp,
  mealSlotOf, mealGroups, MEAL_SLOT_TXT,
  inspirePicks,
  tripSigOf, ledgerTrips, ledgerOfTrip,
  iouList, addIou, toggleIou, delIou, iouStats,
  durOf, dayLoad,
  routeScore,
  getCityNote, saveCityNote, delCityNote, allCityNotes,
  yearReport,
  ticketRemind,
  quickPhrases,
  // v1.8.5 档三（C 组）
  budgetCheckOf, cityLongHint, nextStopPick, ticketSumOf,
  catPctOf, weekSpent, weekLedgerTxt, topCatsOf,
  quoteOfDay, footStoryText, wishStateMark, footCityDetail,
 showDisp,
 // v1.9.0 · 四十项新功能数据层
 mondayClashOf, bookRemindOf, bestSeasonHit, mixStat, themeTagOf, dayMove,
 spotLookup, bookingTipOf,
 endTripTip, wishMissOf, packHintOf, siblingCities, routeDaysBar, nowSlotPick,
 tomorrowPeek, todayGear, todayOverHint, tasteTagOf, tasteFilter, climateAddOns, climateAddOnsFiltered,
 weekBars, monthStory, wishDice, provStamp, travelPersona, dayCityTag,
 routeKmOf, wishPins, holidayHint,
 fmtLocalDate: store.fmtLocalDate,
 // v1.10.0 · 第二波功能
 periodOf, spanCityOf, loadRank, themeTagsOf, natureShareOf,
 bookingLines, museumDiList, sunriseDiList, sunsetDiList,
 familyFit, elderFit, effortTagOf, packByPlan, gemOfCity,
 spotDayLines, tripDraft, tipsTop3, shareOneLine, shareLong,
 tripScoreOf, cityFirstLine, foodRouteOf, weatherFallback, layerOf,
 stayZoneOf, moveNote, bookingByLead, cityCompareLines, tipForSlot,
 spareOfCity, starMoments, riskCard, routeRhythm, endNoteTxt, dayPeek, whoFit,
 // v1.11.0 · 20 项新功能
 tripPhaseGuide, spotOpenNow, dayHighlight, burnRate, cityCompareCard,
 visitProgress, weatherPack, photoScoreOf, energyCurve, freeSlotPicker,
 costBreakdown, localEtiquette, souvenirOf, rainyDayPlan, nightLifeList,
  crowdAvoid, mistakeChecklist, snapshotCard, nextCitySuggest, storageHealth,
  // v1.12.0 · 100 项新功能（第1批：交通 + 行程规划）
  trainBetween, flightCodeOf, routeDist, nearbyCities, cityHopTime,
  dayPlanOrder, morningSpots, afternoonSpots, eveningSpots, fullDaySpots,
  mustSeeOf, itineraryDensity, spotClusterOf, transferChain, airportTipOf,
  arriveHint, departHint, entranceHintOf, cableHintOf, busHintOf, earlyCloseOf,
  stayMountTip, gapFillOf, spotCountOf, dayKmOf,
  // v1.12.0 · 100 项新功能（第2批：美食 + 天气）
  foodStreetOf, foodMapOf, provFoodOf, cityFoodOf, foodTop3, foodPriceRange,
  breakfastPlace, dinnerPlace, lateSnackPlace, localDrink, seasonWeather,
  monthWeather, rainLikely, snowLikely, typhoonHint, bestTravelMonth,
  peakSeasonHint, offSeasonHint, tempRangeOf, humidityHint, weatherPackList,
  mealPlanOf, foodBudgetOf, spicyLevelOf, vegHint,
  // v1.12.0 · 100 项新功能（第3批：预算 + 安全健康）
  ticketPriceOf, ticketBookHint, freeSpotList, paidSpotList, ticketTotal,
  hotelBudgetOf, transportBudgetOf, budgetPieOf, saveTipsOf, splurgeTipOf,
  valueScoreOf, altitudeOf, altitudeRisk, sunBlockHint, insectHint, scamAlertOf,
  emergencyOf, medKitList, insuranceHint, waterHint, foodSafeHint, nightSafeHint,
  trafficSafeHint, healthPrepOf, bargainTip,
  // v1.12.0 · 100 项新功能（第4批：文化 + 实用工具 + 数据洞察）
  dialectOf, localTabooOf, templeRule, photoRule, diningRule, festivalOf, giftIdea,
  luggageCheck, photoSpotOf, wifiHint, powerHint, simHint, mapHint,
  transportCardHint, taxiHint, luggageStoreHint, atmHint, footMapOf,
  yearTravelSummary, cityRankOf, travelStyleTag, tripCompare, budgetTrendOf,
  distanceStatOf, achievementProgress
};
