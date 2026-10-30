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

const QW_API_HOST = "https://devapi.qweather.com"; // 若账号分配了自定义域名，改成你的 xxx.qweatherapi.com
const QW_KEY = "在此填写和风天气Key";              // 和风开发者控制台获取的免费 Key

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
// 拉取整份 plan 期间的自然日天气；对齐 plan.days[i].date。
// 成功 → cb(list)，每项 {date, code, icon, desc, tmax, tmin, feels, pop, hum, uv, wind, sunrise, sunset, isRain, isSnow, isThunder, risk, riskTx, idx}
// 失败 / 不可用 / Key 未配置 / 超预报窗口 → cb([])
function fetchPlanWeather(plan, cb) {
  if (!plan || !plan.days || !plan.days.length) { cb([]); return; }
  if (typeof wx === "undefined" || !wx.request) { cb([]); return; }
  if (!QW_KEY || QW_KEY.indexOf("在此填写") >= 0) { cb([]); return; } // Key 未配置 → 静默降级
  const segCity = plan.segments && plan.segments[0] && plan.segments[0].cityName;
  const c = coordOf(segCity || plan.cityName);
  if (!c) { cb([]); return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(String(plan.days[0].date).slice(0, 10).replace(/-/g, "/"));
  first.setHours(0, 0, 0, 0);
  let gap = Math.round((first - today) / 86400000);
  if (gap < 0) gap = 0;
  // 和风免费档至多 7 天预报；缓存键含 host + 出发偏移
  const _wkey = (segCity || plan.cityName) + "|" + gap + "|" + QW_API_HOST;
  const _wh = _WX_CACHE[_wkey];
  if (_wh && (Date.now() - _wh.t) < _WX_TTL) { cb(_wh.v); return; }
  const lat = Number(c.lat).toFixed(2), lon = Number(c.lon).toFixed(2);
  wx.request({
    url: QW_API_HOST + "/v7/weather/7d",
    data: { location: lon + "," + lat, key: QW_KEY },
    header: { "X-QW-Api-Key": QW_KEY },
    success(res) {
      try {
        const d = res && res.data;
        if (!d || d.code !== "200" || !Array.isArray(d.daily)) { cb([]); return; }
        const byDate = {};
        for (let i = 0; i < d.daily.length; i++) byDate[d.daily[i].fxDate] = d.daily[i];
        const out = [];
        const num = function (s) { return s == null ? null : parseInt(s, 10); };
        for (let k = 0; k < plan.days.length; k++) {
          const ds = String(plan.days[k].date).slice(0, 10);
          const r = byDate[ds]; if (!r) continue; // 超出预报窗口/无数据 → 该天不显示
          const norm = normText(r.textDay);
          const w = {
            date: ds, code: norm.code, icon: norm.icon, desc: r.textDay || "",
            tmax: num(r.tempMax), tmin: num(r.tempMin), feels: null, pop: null,
            hum: num(r.humidity), uv: num(r.uvIndex), wind: num(r.windSpeedDay),
            sunrise: r.sunrise || "", sunset: r.sunset || "",
            isRain: norm.isRain, isSnow: norm.isSnow, isThunder: norm.isThunder
          };
          w.risk = riskOf(w);          // null 或 {label, icon}
          w.riskTx = w.risk ? w.risk.label : "";
          w.idx = outfitIndex(w);     // [{t, icon}]
          out.push(w);
        }
        cb(out);
      } catch (e) { cb([]); }
    },
    fail() { cb([]); }
  });
}

// ── 雨雪天备选：目的地下雨/下雪时，推荐室内或雨/雪景友好的景点 ──
// 纯离线（基于城市真实语料扫描），无需联网；返回 [{name, reason}]，reason ∈ 室内/雨景佳/雪景佳/温泉。
// 优先级：室内(3) > 雪景佳/雨景佳/温泉(2)。kinds 为空返回 []。
const _INDOOR_RE = /博物馆|美术馆|纪念馆|展览馆|展览|石窟|古寺|寺|庙|科技馆|海洋馆|海洋世界|故居|书院|宫殿|博物院|室内|博览|文化馆|艺术馆|祠堂|古建|楼|塔|阁/;
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

module.exports = { fetchPlanWeather, rainyDaySpots, normText, riskOf, outfitIndex };
