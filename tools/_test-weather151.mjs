// 回归：天气多城按各天所在城市预报（v1.19.151）
// 覆盖：mergeWeatherByDay 把「每城 7 天预报」对齐到 plan.days（旧版只用首站城市，多城错位）；
//      超预报窗口的天被跳过；无 segments 时回退 plan.cityName；rainyDaySpots 形态与室内命中。
import { createRequire } from "module";
import { readFileSync } from "fs";
const req = createRequire(process.cwd() + "/");
const W = req("./utils/weather.js");
const KEYS = req("./utils/keys.js");

let fail = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n); if (!c) fail++; };

// 多城行程：北京 2 天 + 西安 3 天（含 1 天超窗口，应被跳过）
const plan = {
  cityName: "北京",
  segments: [
    { cityName: "北京", startDay: 0, endDay: 1 },
    { cityName: "西安", startDay: 2, endDay: 4 }
  ],
  days: [
    { date: "2026-11-01", cityName: "北京" },
    { date: "2026-11-02", cityName: "北京" },
    { date: "2026-11-03", cityName: "西安" },
    { date: "2026-11-04", cityName: "西安" },
    { date: "2026-11-05", cityName: "西安" },
    { date: "2099-01-01", cityName: "北京" } // 超窗口，应被跳过
  ]
};
const byCity = {
  "北京": { city: "北京", byDate: {
    "2026-11-01": { date: "2026-11-01", code: 0, icon: "sun", desc: "晴", tmax: 15, tmin: 5, isRain: false, isSnow: false, isThunder: false },
    "2026-11-02": { date: "2026-11-02", code: 61, icon: "rain", desc: "小雨", tmax: 12, tmin: 4, isRain: true, isSnow: false, isThunder: false }
  } },
  "西安": { city: "西安", byDate: {
    "2026-11-03": { date: "2026-11-03", code: 71, icon: "snow", desc: "雪", tmax: 2, tmin: -3, isRain: false, isSnow: true, isThunder: false },
    "2026-11-04": { date: "2026-11-04", code: 0, icon: "sun", desc: "晴", tmax: 8, tmin: -1, isRain: false, isSnow: false, isThunder: false },
    "2026-11-05": { date: "2026-11-05", code: 0, icon: "sun", desc: "晴", tmax: 9, tmin: 0, isRain: false, isSnow: false, isThunder: false }
  } }
};

const out = W.mergeWeatherByDay(plan, byCity);
ok("多城合并：天数对齐（超窗口天被跳过）", out.length === 5);
ok("第1天归属北京·晴", out[0].city === "北京" && out[0].desc === "晴");
ok("第2天归属北京·小雨·风险=降雨", out[1].city === "北京" && out[1].isRain === true && !!out[1].risk && out[1].risk.label === "降雨");
ok("第3天归属西安·雪·风险=降雪（旧版会错显北京天气）", out[2].city === "西安" && out[2].isSnow === true && !!out[2].risk && out[2].risk.label === "降雪");
ok("第4/5天归属西安·晴", out[3].city === "西安" && out[3].desc === "晴" && out[4].city === "西安");
ok("每项含出行指数数组", Array.isArray(out[0].idx));

// 无 segments 时回退 plan.cityName
const p2 = { cityName: "上海", days: [{ date: "2026-11-01", cityName: "上海" }] };
const b2 = { "上海": { city: "上海", byDate: { "2026-11-01": { date: "2026-11-01", code: 0, icon: "sun", desc: "晴", isRain: false, isSnow: false } } } };
const o2 = W.mergeWeatherByDay(p2, b2);
ok("无 segments 时回退 plan.cityName", o2.length === 1 && o2[0].city === "上海");

// day.cityName 与分段城市名不一致时，dayCityOf 仍能命中有数据的候选
const p3 = { cityName: "北京", segments: [{ cityName: "北京市", startDay: 0, endDay: 0 }], days: [{ date: "2026-11-01", cityName: "北京市" }] };
const b3 = { "北京": { city: "北京", byDate: { "2026-11-01": { date: "2026-11-01", code: 0, icon: "sun", desc: "晴", isRain: false, isSnow: false } } } };
const o3 = W.mergeWeatherByDay(p3, b3);
ok("day.cityName 与分段名不一致时仍能命中有数据城市", o3.length === 1 && o3[0].city === "北京");

// rainyDaySpots：形态 + 室内命中 + 不存在城市返回空
ok("雨雪备选：不存在城市返回空数组", W.rainyDaySpots("不存在XYZ", ["rain"]).length === 0);
const bj = W.rainyDaySpots("北京", ["rain"]);
ok("北京雨天有室内备选（如故宫/博物院）", Array.isArray(bj) && bj.length > 0 && bj.some(x => /室内/.test(x.reason)));
ok("雨雪备选元素含 name + reason", Array.isArray(bj) && bj.every(x => x && typeof x.name === "string" && typeof x.reason === "string"));

// 精度回归：楼/塔/阁 多为露天地标（黄鹤楼/大雁塔/滕王阁），下雨天不得误标「室内」
const wh = W.rainyDaySpots("武汉", ["rain", "snow"]);
ok("雨雪备选：含楼/塔/阁的露天地标不被误标室内", Array.isArray(wh) && wh.every(x => !(x.reason === "室内" && /[楼塔阁]/.test(x.name))));

// v1.19.153：错误码可辨识（classifyApiError 把和风错误码映射到 type/msg）
const c401 = W.classifyApiError({ code: "401" });
ok("401 → auth（Key 无效）", c401.type === "auth" && /Key/.test(c401.msg));
const c429 = W.classifyApiError({ code: "429" });
ok("429 → quota（额度/频次）", c429.type === "quota" && /额度|频次/.test(c429.msg));
const c403 = W.classifyApiError({ code: "403", status: "permission denied" });
ok("403 → auth", c403.type === "auth");
const c404 = W.classifyApiError({ code: "404" });
ok("404 → param", c404.type === "param");
const c500 = W.classifyApiError({ code: "500" });
ok("未知码 → api（兜底）", c500.type === "api");
const cStatus = W.classifyApiError({ status: "INVALID KEY" });
ok("status 含 invalid key → auth", cStatus.type === "auth");

// v1.19.153：fetchPlanWeather 回调签名改为 cb(list, err)；node 下无 wx → err.type=env
let envErr = null, envList = null;
W.fetchPlanWeather(plan, (list, err) => { envList = list; envErr = err; });
ok("无 wx 环境 → 回调 err.type=env（list 为空）", envErr && envErr.type === "env" && Array.isArray(envList) && envList.length === 0);

// v1.19.154 / v1.19.157：Key 占位符 → 短路 no_key（不误发请求）；填入真实 Key → 正常发起请求（不短路）。
// 状态自适应：随包 Key 状态变化时两分支各自生效（占位符时守住 no_key，真 Key 时验证不短路）。
let noKeyErr = null, reqCalled = false;
const savedWx = global.wx;
global.wx = { request() { reqCalled = true; } }; // 有 wx
W.fetchPlanWeather(plan, (list, err) => { noKeyErr = err; });
global.wx = savedWx;
// v1.20.4：Key 自 v1.19.184 起统一收敛到 keys.js 单出口（明文移出仓库、运行时注入），
//   原测试到 weather.js 找 QW_KEY 占位符的判据已失效 —— 仓库里 QW_KEY 早迁走，
//   导致该用例恒定走「真实 Key」分支、要求发起 wx.request，而仓库默认无 Key 必失败。
//   改为以 KEYS.qweatherConfigured() 为分支真值，与 fetchPlanWeather 门控同源，消除误报。
const configured = KEYS.qweatherConfigured();
if (!configured) {
  ok("无真实 Key（未配置）→ err.type=no_key（明确提示需配置，不误发请求）", !!noKeyErr && noKeyErr.type === "no_key");
} else {
  ok("填入真实 Key 时不短路 → 发起 wx.request 且不报 no_key", reqCalled === true && !(noKeyErr && noKeyErr.type === "no_key"));
}

// v1.19.154：wx.request 必须带 timeout（否则弱网/服务端挂起会让天气卡永久卡在「加载中…」）。
// 因 Key 为占位符时 fetchPlanWeather 短路返回 no_key，无法在 node 下发真实请求，
// 故校验构建产物里 wx.request 调用确实携带了 timeout 选项。
let builtSrc = "";
try { builtSrc = readFileSync(process.cwd() + "/utils/weather.js", "utf8"); } catch (e) {}
const hasTimeout = /timeout\s*:\s*(\d{3,}|[0-9]+e[0-9]+)/.test(builtSrc);
ok("构建产物 wx.request 携带 timeout（弱网不永久卡死）", hasTimeout);

console.log(fail ? ("\n✗ weather151 单测失败 " + fail + " 项") : "\n✓ weather151 单测全部通过");
process.exit(fail ? 1 : 0);
