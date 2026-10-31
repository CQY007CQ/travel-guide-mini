// utils/weather.js —— 行程天气（和风天气 QWeather v7，已备案域名 devapi.qweather.com）
//
// 为什么从 open-meteo 换和风：
//  open-meteo 是海外域名、无中国大陆 ICP 备案，无法加入小程序 request 合法域名白名单，
//  wx.request 在真机/上线后被微信拦截（url not in domain list），天气卡永久静默降级成「天气暂不可用」。
//  和风 devapi.qweather.com 是国内已备案域名，白名单可过审；免费档给 7 天预报，数据含天气现象/温度/湿度/UV/风/日出日落，
//  足够做下雨下雪检测与「雨雪天备选」推荐。
//
// 配置（你来做，代码已就绪）：
//  1) 去 https://dev.qweather.com 注册（个人主体需实名认证），建项目拿 Key；
//  2) 把 Key 填到下方 QW_KEY；若账号分配了自定义域名（xxx.qweatherapi.com），改 QW_API_HOST；
//  3) 小程序后台「开发管理→开发设置→服务器域名」把请求域名加入 request 合法域名；
//  4) 可选：和风控制台「安全域名」加上你的小程序 request 域名，防止 Key 被他人盗用。
//
// 失败/不可用：Key 未配置、断网、超预报窗口、Key 无效 → 静默降级（天气卡隐藏/提示），绝不影响行程主流程。
const T = require("./travel.js");

const QW_API_HOST = "https://j864228fx2.re.qweatherapi.com"; // 和风新计费模型：每个项目分配专属域名（devapi.qweather.com 对本 Key 返回 Invalid Host）
const QW_KEY = "d84611f29a4d48d48a36227b613de255";              // 和风开发者控制台获取的免费 Key（v1.19.157 接入）

// 和风天气现象文字 → 归一化 icon / 合成 WMO 码 / 雨雪判定（合成码只为复用既有的 riskOf/outfitIndex）
const QW_RE_THUNDER = /雷|暴|飑/;
const QW_RE_SNOW = /雪|霰|冰粒|冰雹|雨夹雪/;
const QW_RE_RAIN = /雨|阵水|冻雨|雨夹雪/;
function normText(text) {
  if (!text) return { icon: "sun", code: 0, isRain: false, isSnow: false, isThunder: false };
  if (QW_RE_THUNDER.test(text)) return { icon: "thunder", code: 95, isRain: true, isSnow: false, isThunder: true };
  if (QW_RE_SNOW.test(text)) return { icon: "snow", code: 71, isRain: false, isSnow: true, isThunder: false };
  if (QW_RE_RAIN.test(text)) return { icon: "rain", code: 61, isRain: true, isSnow: false, isThunder: false };
  if (/阴|多云|雾|沙|尘|霾/.test(text)) return { icon: "cloud", code: 3, isRain: false, isSnow: false, isThunder: false };
  return { icon: "sun", code: 0, isRain: false, isSnow: false, isThunder: false };
}

const SNOW = [71, 73, 75, 77, 85,86];
// 风险 {label, icon}（无 emoji）
function riskOf(w) {
  if (w.code == null) return null;
  if (SNOW.indexOf(w.code) >= 0) return { label: "降雪", icon: "snow" };
  if (w.code >= 95) return { label: "雷雨", icon: "thunder" };
  if (w.code >= 51 && w.code <= 82) return { label: "降雨", icon: "rain" };
  if (w.tmin != null && w.tmin <= 0) return { label: "低温", icon: "snow" };
  if (w.tmax != null && w.tmax >= 34) return { label: "高温", icon: "hot" };
  if (w.wind != null && w.wind >= 40) return { label: "大风", icon: "wind" };
  if (w.pop != null && w.pop >= 60 && w.code !== 0) return { label: "降雨", icon: "rain" };
  return null;
}
// 出行指数：按当天天气给「带伞 / 防晒 / 保暖 / 防风」等可操作建议
function outfitIndex(w) {
  const out = [];
  if (!w) return out;
  if ((w.pop != null && w.pop >= 50) || (w.code >= 51 && w.code <= 82)) out.push({ t: "带伞", icon: "umbrella" });
  if (w.uv != null && w.uv >= 6) out.push({ t: "防晒", icon: "hot" });
  else if (w.tmax != null && w.tmax >= 30) out.push({ t: "防晒", icon: "hot" });
  if (w.tmin != null && w.tmin <= 8) out.push({ t: "保暖", icon: "snow" });
  if (w.wind != null && w.wind >= 30) out.push({ t: "防风", icon: "wind" });
  if (!out.length) out.push({ t: "舒适", icon: "sun" });
  return out.slice(0, 3);
}

function coordOf(cityName) {
  try {
    const c = T.P.getCoord(cityName);
    if (c && c.lat != null && c.lon != null) return c;
  } catch (e) {}
  return null;
}

// v1.19.41：天气请求缓存 —— 同一城市 + 同一出发偏移 + 同一预报窗口的响应完全相同，
// 反复生成 / 切回行程页会重复请求；加进程内缓存（默认 10 分钟）既省请求又避免弱网下天气卡闪烁。
const _WX_CACHE = {};
const _WX_TTL = 10 * 60 * 1000;

// 多城行程：每天归属的城市（day.cityName 优先，缺失时按 segments 区间回退，再回退 plan.cityName）。
// byCity 作为「该候选是否真有数据」的二次校验，避免 day.cityName 与分段城市名不一致导致整天天气丢失。
function dayCityOf(plan, k, byCity) {
  const d = plan.days && plan.days[k];
  const cands = [];
  if (d && d.cityName) cands.push(d.cityName);
  if (Array.isArray(plan.segments)) {
    for (let i = 0; i < plan.segments.length; i++) {
      const s = plan.segments[i];
      if (k >= (s.startDay || 0) && k <= (s.endDay || 0) && s.cityName) cands.push(s.cityName);
    }
  }
  if (plan.cityName) cands.push(plan.cityName);
  for (let i = 0; i < cands.length; i++) {
    const e = byCity[cands[i]];
    if (e && e.byDate && Object.keys(e.byDate).length) return cands[i];
  }
  return cands[0] || "";
}

// 纯函数：把「每城 7 天预报」合并成与 plan.days 对齐的列表。
// byCity: { cityName: { byDate: {fxDate: normItem}, city } }；缺数据的天（超窗口/无坐标）直接跳过。
// 每项附 city（当天真实城市），供 UI 多城时显示「各站按所在城市预报」。
function mergeWeatherByDay(plan, byCity) {
  const out = [];
  if (!plan || !plan.days) return out;
  for (let k = 0; k < plan.days.length; k++) {
    const ds = String(plan.days[k].date).slice(0, 10);
    const city = dayCityOf(plan, k, byCity);
    const ent = byCity[city];
    const r = ent && ent.byDate && ent.byDate[ds];
    if (!r) continue; // 该天无数据（超出预报窗口 / 城市无坐标）→ 不显示
    const w = Object.assign({}, r, { city: city });
    w.risk = riskOf(w);
    w.riskTx = w.risk ? w.risk.label : "";
    w.idx = outfitIndex(w);
    out.push(w);
  }
  return out;
}

// 和风错误码 → 可辨识的错误类型/文案（让用户看到「为什么没天气」，而非一律「暂不可用」）
function classifyApiError(d) {
  const code = d && d.code;
  const status = (d && d.status) ? String(d.status).toLowerCase() : "";
  if (code === "401" || /invalid key|unauthorized/.test(status)) return { type: "auth", msg: "天气服务未授权（Key 无效）" };
  if (code === "402" || code === "429" || /quota|too many requests|frequency|exceeded/.test(status)) return { type: "quota", msg: "天气接口受限（免费额度或频次）" };
  if (code === "403" || /permission denied|forbidden/.test(status)) return { type: "auth", msg: "天气服务未授权" };
  if (code === "404" || /invalid parameter/.test(status)) return { type: "param", msg: "天气请求参数有误" };
  return { type: "api", msg: "天气服务暂时异常" };
}

// 拉取整份 plan 期间的自然日天气；多城行程按各天所在城市分别拉取
// （v1.19.151 修复：旧版只用首站城市，导致后续城市的天也显示首站天气）。对齐 plan.days[i].date。
// 回调 cb(list, err)：成功 err=null；失败 err={type,msg}（type∈ empty/env/no_key/nocity/quota/auth/param/api/net/window）。
function fetchPlanWeather(plan, cb) {
  if (!plan || !plan.days || !plan.days.length) { cb([], { type: "empty" }); return; }
  if (typeof wx === "undefined" || !wx.request) { cb([], { type: "env" }); return; }
  if (!QW_KEY || QW_KEY.indexOf("在此填写") >= 0) { cb([], { type: "no_key", msg: "天气服务未启用（需在和风后台配置 Key）" }); return; } // Key 未配置 → 明确提示
  // 行程涉及的城市（去重保序）：有分段用分段城市，否则用 plan.cityName
  const rawCities = (Array.isArray(plan.segments) && plan.segments.length)
    ? plan.segments.map(function (s) { return s.cityName; })
    : [plan.cityName];
  const seen = {}; const cities = [];
  rawCities.forEach(function (c) { if (c && !seen[c]) { seen[c] = 1; cities.push(c); } });
  if (!cities.length) { cb([], { type: "nocity" }); return; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayYMD = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const first = new Date(String(plan.days[0].date).slice(0, 10).replace(/-/g, "/"));
  first.setHours(0, 0, 0, 0);

  const byCity = {};
  let pending = 0, finished = false, aggErr = null;
  const setErr = function (e) { if (!aggErr) aggErr = e; };
  const finish = function () {
    if (finished) return;
    if (pending > 0) return;
    finished = true;
    const out = mergeWeatherByDay(plan, byCity);
    if (out.length) cb(out, null);
    else cb([], aggErr || { type: "window", msg: "行程超出天气预报范围（仅支持未来 7 天）" });
  };
  const normDaily = function (daily) {
    const byDate = {};
    if (!Array.isArray(daily)) return byDate;
    const num = function (s) { return s == null ? null : parseInt(s, 10); };
    for (let i = 0; i < daily.length; i++) {
      const r = daily[i]; if (!r || !r.fxDate) continue;
      const norm = normText(r.textDay);
      byDate[r.fxDate] = {
        date: r.fxDate, code: norm.code, icon: norm.icon, desc: r.textDay || "",
        tmax: num(r.tempMax), tmin: num(r.tempMin), feels: null, pop: null,
        hum: num(r.humidity), uv: num(r.uvIndex), wind: num(r.windSpeedDay),
        sunrise: r.sunrise || "", sunset: r.sunset || "",
        isRain: norm.isRain, isSnow: norm.isSnow, isThunder: norm.isThunder
      };
    }
    return byDate;
  };
  cities.forEach(function (city) {
    const c = coordOf(city);
    if (!c) { byCity[city] = { byDate: {}, city: city }; return; } // 无坐标：占位，避免 dayCityOf 误判
    const wkey = city + "|" + todayYMD + "|" + QW_API_HOST;
    const cached = _WX_CACHE[wkey];
    if (cached && (Date.now() - cached.t) < _WX_TTL) { byCity[city] = { byDate: cached.v, city: city }; return; }
    pending++;
    const lat = Number(c.lat).toFixed(2), lon = Number(c.lon).toFixed(2);
    wx.request({
      url: QW_API_HOST + "/v7/weather/7d",
      data: { location: lon + "," + lat, key: QW_KEY },
      header: { "X-QW-Api-Key": QW_KEY },
      timeout: 8000, // v1.19.154：弱网/服务端无响应时避免天气卡永久卡在「加载中…」（默认可能挂起数十秒）
      success(res) {
        try {
          const d = res && res.data;
          if (!d || d.code !== "200" || !Array.isArray(d.daily)) {
            if (d) setErr(classifyApiError(d)); // API 返回错误码（Key 无效/超额度/参数等）
            byCity[city] = { byDate: {}, city: city };
          } else {
            const byDate = normDaily(d.daily);
            _WX_CACHE[wkey] = { t: Date.now(), v: byDate };
            byCity[city] = { byDate: byDate, city: city };
          }
        } catch (e) { byCity[city] = { byDate: {}, city: city }; }
        pending--; finish();
      },
      fail() { setErr({ type: "net", msg: "天气加载失败，请重试" }); byCity[city] = { byDate: {}, city: city }; pending--; finish(); }
    });
  });
  finish(); // 全部命中缓存 / 无坐标时立即结算
}

// ── 雨雪天备选：目的地下雨/下雪时，推荐室内或雨/雪景友好的景点 ──
// 纯离线（基于城市真实语料扫描），无需联网；返回 [{name, reason}]，reason ∈ 室内/雨景佳/雪景佳/温泉。
// 优先级：室内(3) > 雪景佳/雨景佳/温泉(2)。kinds 为空返回 []。
// 注意：楼/塔/阁 已从室内判定移除——黄鹤楼/大雁塔/滕王阁/蓬莱阁等均为露天地标，
// 误标「室内」会误导雨天出游；它们不靠这几个字也能被博物馆/古寺/石窟等正确命中。
const _INDOOR_RE = /博物馆|美术馆|纪念馆|展览馆|展览|石窟|古寺|寺|庙|科技馆|海洋馆|海洋世界|故居|书院|宫殿|博物院|室内|博览|文化馆|艺术馆|祠堂|古建/;
const _SNOW_RE = /雪|滑雪|冰雕|雪场|雾凇|雪山|冰川|雪乡|冰灯|滑冰/;
const _RAIN_RE = /古镇|水乡|园林|竹海|瀑布|烟雨|老街|廊|溶洞|钟乳|洞|亭|廊桥|古巷/;
const _HOTSPRING_RE = /温泉|汤泉|泡汤/;
function rainyDaySpots(cityName, kinds) {
  const arr = kinds || [];
  const hasRain = arr.indexOf("rain") >= 0, hasSnow = arr.indexOf("snow") >= 0;
  if (!hasRain && !hasSnow) return [];
  const city = (T.D && T.D.CITIES || []).filter(function (x) { return x && x.name === cityName; })[0];
  if (!city || !Array.isArray(city.experiences)) return [];
  const seen = {}, out = [];
  for (let i = 0; i < city.experiences.length; i++) {
    const it = city.experiences[i]; if (!it) continue;
    const nm = it.name || ""; if (!nm || seen[nm]) continue;
    let reason = null, pri = 0;
    if (_INDOOR_RE.test(nm)) { reason = "室内"; pri = 3; }
    else if (_HOTSPRING_RE.test(nm)) { reason = "温泉"; pri = 2; }
    else if (hasSnow && _SNOW_RE.test(nm)) { reason = "雪景佳"; pri = 2; }
    else if (hasRain && _RAIN_RE.test(nm)) { reason = "雨景佳"; pri = 2; }
    if (!reason) continue;
    seen[nm] = 1; out.push({ name: nm, reason: reason, pri: pri });
  }
  out.sort(function (a, b) { return b.pri - a.pri; });
  return out.slice(0, 6);
}

module.exports = { fetchPlanWeather, mergeWeatherByDay, dayCityOf, classifyApiError, rainyDaySpots, normText, riskOf, outfitIndex };
