// utils/weather.js —— 行程天气（对齐网页版 open-meteo 实时天气条）
// 说明：
//  - 需在小程序后台「开发管理→服务器域名」配置 request 合法域名 https://api.open-meteo.com 才可联网；
//  - 未配置 / 断网 / 行程日期超出 16 天预报窗口时静默降级（页面不显示天气卡），绝不影响行程主流程；
//  - 多站行程按首站城市整窗请求，卡片上会注明「首站天气·多站仅供参考」。
const T = require("./travel.js");

const WMO_CODE = { 0:"晴",1:"大部晴",2:"多云",3:"阴",45:"雾",48:"雾",51:"毛毛雨",53:"毛毛雨",55:"小雨",56:"冻毛毛雨",57:"冻毛毛雨",
  61:"小雨",63:"中雨",65:"大雨",66:"冻雨",67:"冻雨",71:"小雪",73:"中雪",75:"大雪",77:"雪粒",80:"阵雨",81:"强阵雨",82:"暴雨",
  85:"阵雪",86:"强阵雪",95:"雷阵雨",96:"雷雨冰雹",99:"强雷雨" };
// 图标 key → /images/icons/<key>.png（无 emoji，双主题同为金色线性）
function iconOfCode(code) {
  if (code == null) return "sun";
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "cloud";
  if (code === 3 || code === 45 || code === 48) return "cloud";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "thunder";
  return "sun";
}
const SNOW = [71,73,75,77,85,86];
// 风险 {label, icon}（无 emoji）
function riskOf(w) {
  if (w.code == null) return null;
  if (w.tmin != null && w.tmin <= 0) return { label: "低温", icon: "snow" };
  if (SNOW.indexOf(w.code) >= 0) return { label: "降雪", icon: "snow" };
  if (w.code >= 95) return { label: "雷雨", icon: "thunder" };
  if (w.pop != null && w.pop >= 60 && w.code !== 0) return { label: "降雨", icon: "rain" };
  if (w.tmax != null && w.tmax >= 34) return { label: "高温", icon: "hot" };
  if (w.wind != null && w.wind >= 40) return { label: "大风", icon: "wind" };
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
    if (c && c.lat && c.lon) return c;
  } catch (e) {}
  return null;
}

// v1.19.41：天气请求缓存 —— open-meteo 同一城市 + 同一出发偏移 + 同一预报天数窗口的响应完全相同，
// 反复生成 / 切回行程页会重复请求；加进程内缓存（默认 10 分钟）既省请求又避免弱网下天气卡闪烁。
const _WX_CACHE = {};
const _WX_TTL = 10 * 60 * 1000;
// 拉取整份 plan 期间的自然日天气；对齐 plan.days[i].date。
// 成功 → cb(list)，每项 {date, code, icon, desc, tmax, tmin, feels, pop, hum, uv, wind, sunrise, sunset, risk}
// 失败 / 不可用 → cb([])
function fetchPlanWeather(plan, cb) {
  if (!plan || !plan.days || !plan.days.length) { cb([]); return; }
  if (typeof wx === "undefined" || !wx.request) { cb([]); return; }
  // 多站行程 cityName 形如「太原 → 西安」；坐标取首站 segment 城市
  const segCity = plan.segments && plan.segments[0] && plan.segments[0].cityName;
  const c = coordOf(segCity || plan.cityName);
  if (!c) { cb([]); return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(String(plan.days[0].date).slice(0, 10).replace(/-/g, "/"));
  first.setHours(0, 0, 0, 0);
  let gap = Math.round((first - today) / 86400000);
  if (gap < 0) gap = 0;
  const need = gap + plan.days.length;
  const nd = Math.min(Math.max(need, 1), 16); // open-meteo 免费预报窗口 ≤16 天
  if (nd < 1) { cb([]); return; }
  // v1.19.41：缓存键 = 城市 + 预报天数 + 出发偏移；同一窗口命中直接回放，不发请求
  const _wkey = (segCity || plan.cityName) + "|" + nd + "|" + gap;
  const _wh = _WX_CACHE[_wkey];
  if (_wh && (Date.now() - _wh.t) < _WX_TTL) { cb(_wh.v); return; }
  // 行程跨越 16 天窗口时只覆盖前面可预报部分
  const coverN = plan.days.length - Math.max(0, need - 16);
  wx.request({
    url: "https://api.open-meteo.com/v1/forecast",
    data: {
      latitude: c.lat, longitude: c.lon,
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,relative_humidity_2m_mean,uv_index_max,wind_speed_10m_max,sunrise,sunset",
      timezone: "auto", forecast_days: nd
    },
    success(res) {
      try {
        const d = res.data && res.data.daily;
        if (!d || !Array.isArray(d.time)) { cb([]); return; }
        const idx = {};
        d.time.forEach((t, i) => { idx[t] = i; });
        const out = [];
        for (let k = 0; k < coverN && k < plan.days.length; k++) {
          const ds = String(plan.days[k].date).slice(0, 10);
          const i = idx[ds];
          if (i == null) continue;
          const code = (d.weather_code || [])[i];
          const at = arr => (arr && arr[i] != null) ? arr[i] : null;
          const w = {
            date: ds, code,
            icon: iconOfCode(code),
            desc: WMO_CODE[code] || "",
            tmax: at(d.temperature_2m_max) != null ? Math.round(at(d.temperature_2m_max)) : null,
            tmin: at(d.temperature_2m_min) != null ? Math.round(at(d.temperature_2m_min)) : null,
            feels: at(d.apparent_temperature_max) != null ? Math.round(at(d.apparent_temperature_max)) : null,
            pop: at(d.precipitation_probability_max) != null ? Math.round(at(d.precipitation_probability_max)) : null,
            hum: at(d.relative_humidity_2m_mean) != null ? Math.round(at(d.relative_humidity_2m_mean)) : null,
            uv: at(d.uv_index_max) != null ? Math.round(at(d.uv_index_max)) : null,
            wind: at(d.wind_speed_10m_max) != null ? Math.round(at(d.wind_speed_10m_max)) : null,
            sunrise: d.sunrise ? String(d.sunrise[i]).slice(11, 16) : "",
            sunset: d.sunset ? String(d.sunset[i]).slice(11, 16) : ""
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

module.exports = { fetchPlanWeather, WMO_CODE, iconOfCode, outfitIndex };
