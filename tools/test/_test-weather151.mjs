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
// v1.20.15：404 在和风语义是「查询的地区不存在」，不是「参数写错了」；
// 204 是「请求成功但该地区暂无数据」（台站未覆盖的远郊很常见）。
// 两者都归到可辨识的 nodata，且页面不给重试按钮 —— 原先一律当「服务异常」让人白点。
const c404 = W.classifyApiError({ code: "404" });
ok("404 → nodata（地区无数据，不是参数错）", c404.type === "nodata" && /暂无天气数据/.test(c404.msg));
const c204 = W.classifyApiError({ code: "204" });
ok("204 → nodata（该地区暂无数据）", c204.type === "nodata" && /暂无天气数据/.test(c204.msg));
const c400 = W.classifyApiError({ code: "400" });
ok("400 → param（参数错误仍归 param）", c400.type === "param");
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

// ── v1.20.15 新增：下面几组都靠「注入和风 Key + 桩 wx」真跑 fetchPlanWeather，
//    不写「源码里有某个判断」这种对旧 bug 一样是绿的假断言。──
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
const dNear = ymd(todayD);
const dFar = ymd(new Date(todayD.getTime() + 30 * 86400000));
const K_INJ = { qweatherKey: "kw-test-abcdef012345", qweatherHost: "https://devapi.qweather.com" };

// ① 窗口预判：出发日在 30 天后，/v7/weather/7d 必然拿不到，必须「发请求之前」判掉。
//    原行为：照发 → 等 15s 超时或 200 但日期全不匹配 → 白花一次配额还白等一轮。
const savedWx2 = global.wx;
let farReq = 0, farErr = null, farList = null;
global.wx = {
  request() { farReq++; },
  getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
  setStorageSync() {}
};
W.fetchPlanWeather({ cityName: "北京", days: [{ date: dFar, cityName: "北京" }] }, (l, e) => { farList = l; farErr = e; });
ok("行程超出 7 天窗口 → 判定 window 且一次请求都不发（不白花配额）",
  farReq === 0 && !!farErr && farErr.type === "window" && Array.isArray(farList) && farList.length === 0);
ok("超窗口提示文案是原兜底那句（与既有 UI 文案一致，不新增口径）",
  /仅支持未来 7 天/.test((farErr && farErr.msg) || ""));

// ② 对照组：窗口内的行程必须照常发请求 —— 否则①可能只是「永远不发请求」的假绿
let nearReq = 0;
global.wx = {
  request() { nearReq++; },
  getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
  setStorageSync() {}
};
W.fetchPlanWeather({ cityName: "北京", days: [{ date: dNear, cityName: "北京" }] }, () => {});
ok("窗口内行程照常发起请求（预判不是无差别拦截）", nearReq === 1);

// ①b v1.20.22：对称补「出发日在过去」。从「我的行程」恢复的历史档同样拿不到 7d 预报，
//     原行为仍发 15s 请求才兜底；这里真跑断言「零请求 + 同一句 window 文案」。
const dPast = ymd(new Date(todayD.getTime() - 3 * 86400000));
let pastReq = 0, pastErr = null, pastList = null;
global.wx = {
  request() { pastReq++; },
  getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
  setStorageSync() {}
};
W.fetchPlanWeather({ cityName: "北京", days: [{ date: dPast, cityName: "北京" }] }, (l, e) => { pastList = l; pastErr = e; });
ok("历史行程（出发日在过去）→ 判定 window 且一次请求都不发",
  pastReq === 0 && !!pastErr && pastErr.type === "window" && Array.isArray(pastList) && pastList.length === 0,
  "req=" + pastReq + " err=" + JSON.stringify(pastErr));
ok("历史行程沿用与未来超窗完全相同的文案（不新增 UI 口径）",
  (pastErr && pastErr.msg) === (farErr && farErr.msg));

// ③ 重试退避必须非零：原写法 400 * attempt，attempt=0 → 0ms「立刻重试」，
//    弱网下刚失败的连接还没缓过来就再撞一次，重试形同虚设。
//    这里替换 setTimeout 只记录「声明延时」，再以 0ms 真跑，避免测试白等 400ms。
const delays = [];
const savedST = global.setTimeout;
global.setTimeout = (fn, ms) => { delays.push(ms); return savedST(fn, 0); };
let failReq = 0;
global.wx = {
  request(o) { failReq++; if (o && typeof o.fail === "function") o.fail({ errMsg: "request:fail timeout" }); },
  getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
  setStorageSync() {}
};
let retryErr = null;
W.fetchPlanWeather({ cityName: "北京", days: [{ date: dNear, cityName: "北京" }] }, (l, e) => { retryErr = e; });
await new Promise((r) => savedST(r, 30));
global.setTimeout = savedST;
global.wx = savedWx2;
ok("失败后确实重试了（共 2 次请求）", failReq === 2);
ok("重试退避非零（≥400ms，不再「立刻重试」）", delays.length > 0 && delays[0] >= 400);
ok("重试用尽后回落 net 错误（页面给重试按钮）", !!retryErr && retryErr.type === "net");

// ④ 盘上缓存必须带上原始落盘时刻：盘数据 10.5 分钟前落盘 → 内存 TTL(10min) 已过、盘 TTL(30min) 未过。
//    修好后：第二次调用内存已过期，必须回盘确认（读盘 2 次）。
//    修之前：回填时用 Date.now() 重新打戳当「刚取的」，第二次直接命中内存（读盘 1 次），
//    最坏把 29 分钟前的预报再续 10 分钟 —— 用户看到「天气有，但一直是半小时前的」，且全程不报错。
const staleT = Date.now() - Math.round(10.5 * 60 * 1000);
let diskReads = 0;
global.wx = {
  request() { /* 永不回调：本用例只看缓存命中路径，不能有网络结果盖掉它 */ },
  getStorageSync(k) {
    if (k === "__app_keys__") return K_INJ;
    if (String(k).indexOf("wxcacheV1.") === 0) {
      diskReads++;
      return { t: staleT, v: { [dNear]: { date: dNear, code: 0, icon: "sun", desc: "晴", tmax: 20, tmin: 8, isRain: false, isSnow: false, isThunder: false } } };
    }
    return null;
  },
  setStorageSync() {}
};
const pNear = { cityName: "北京", days: [{ date: dNear, cityName: "北京" }] };
let c1 = null, c2 = null;
W.fetchPlanWeather(pNear, (l) => { c1 = l; });
W.fetchPlanWeather(pNear, (l) => { c2 = l; });
global.wx = savedWx2;
ok("盘上 10.5 分钟的预报两次都能出（不因修时间戳而丢天气）",
  Array.isArray(c1) && c1.length === 1 && Array.isArray(c2) && c2.length === 1);
ok("盘上缓存回填不再冒充「刚取的」（第二次仍回盘确认，不是靠 Date.now() 续命）",
  diskReads === 2);

// ⑤ v1.20.38：「域名未加白」必须自己说出来，而且不重试。
//    病情（用户第 N 次报「天气不能用了」）：wx.request 的 fail 回调只有 errMsg，旧版 fail()
//    把整个参数丢掉 → 「request:fail url not in domain list」被归成 net +「天气加载失败，请重试」。
//    这条失败只靠「微信公众平台加一次合法域名」就能永久解决，但提示让人以为是网络抖了：
//    用户反复点重试、开发者反复怀疑代码。而且它**只在真机/体验版出现**（开发者工具默认不校验
//    合法域名，本地与 Node 全绿），所以必须由真机上的文案自己把原因讲出来。
const domDelays = [];
global.setTimeout = (fn, ms) => { domDelays.push(ms); return savedST(fn, 0); };
let domReq = 0, domErr = null, domList = null;
global.wx = {
  request(o) { domReq++; if (o && typeof o.fail === "function") o.fail({ errMsg: "request:fail url not in domain list" }); },
  getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
  setStorageSync() {}
};
W.fetchPlanWeather({ cityName: "北京", days: [{ date: dNear, cityName: "北京" }] }, (l, e) => { domList = l; domErr = e; });
await new Promise((r) => savedST(r, 30));
global.setTimeout = savedST;
global.wx = savedWx2;
ok("域名未加白 → 判 domain，不再笼统归成 net", !!domErr && domErr.type === "domain", JSON.stringify(domErr));
ok("域名未加白 → 只发一次请求、零退避重试（重试结果必然相同）",
  domReq === 1 && domDelays.length === 0, "req=" + domReq + " delays=" + JSON.stringify(domDelays));
ok("域名未加白的文案直接点名要加白的那个域名",
  /devapi\.qweather\.com/.test((domErr && domErr.msg) || ""), (domErr && domErr.msg) || "");
ok("域名未加白仍正常进 finish（页面进空态，不会永久卡在「加载中」）",
  Array.isArray(domList) && domList.length === 0);

// 对照组：同样是失败，但 timeout 必须仍然判 net 并保留重试 ——
// 否则「domain 不重试」可能只是把**所有**失败都变成不重试的假绿（③ 已覆盖重试次数，这里只锁类型）
{
  let tmoErr = null;
  // 超时这条路会走 400ms 退避重试，所以这里同样把 setTimeout 压成 0ms 真跑，
  // 否则只等 30ms 时回调还没到、tmoErr 仍是 null（会误报成「超时被吞」）。
  const savedST2 = global.setTimeout;
  global.setTimeout = (fn, ms) => savedST2(fn, 0);
  global.wx = {
    request(o) { if (o && typeof o.fail === "function") o.fail({ errMsg: "request:fail timeout" }); },
    getStorageSync(k) { return k === "__app_keys__" ? K_INJ : null; },
    setStorageSync() {}
  };
  // 用北京而不是随便找个城市：没有坐标的城市会走「无坐标占位」分支、根本不发请求，
  // 那样对照组会因为「压根没请求」而恒 FAIL（不是业务问题，是选错了样本）。
  W.fetchPlanWeather({ cityName: "北京", days: [{ date: dNear, cityName: "北京" }] }, (l, e) => { tmoErr = e; });
  await new Promise((r) => savedST2(r, 30));
  global.setTimeout = savedST2;
  global.wx = savedWx2;
  ok("对照组：超时仍判 net（不因新增 domain 分支把超时也吞掉）", !!tmoErr && tmoErr.type === "net", JSON.stringify(tmoErr));
}

// ⑥ 文案映射完整性：weather 层产出的每一种 err.type，都必须在行程页的 WX_ERR_TITLE 里有标题。
//    漏一种的后果是静默的 —— 页面标题回落成「天气暂不可用」，等于错误分类白做一遍
//    （v1.20.38 加 domain 时就是靠这条把「加了分类但没改 WXML」这种半成品挡住）。
{
  let wxSrc = "";
  try { wxSrc = readFileSync(process.cwd() + "/utils/weather.js", "utf8"); } catch (e) {}
  let pSvcSrc = "";
  try { pSvcSrc = readFileSync(process.cwd() + "/pages/plan/p-svc.js", "utf8"); } catch (e) {}
  const types = new Set([...wxSrc.matchAll(/type\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const missing = [...types].filter((t) => pSvcSrc.indexOf(t + ":") < 0);
  ok("weather 产出的每种 err.type 都有对应标题（共 " + types.size + " 种）", types.size > 0 && missing.length === 0, missing.join(","));
}

console.log(fail ? ("\n✗ weather151 单测失败 " + fail + " 项") : "\n✓ weather151 单测全部通过");
process.exit(fail ? 1 : 0);
