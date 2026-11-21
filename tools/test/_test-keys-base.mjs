// 回归：和风天气「Key + 专属 API Host 两件套」（v1.20.33）
//
// 起因（真实故障）：用户问「为什么天气功能又不能用了」。
// 排查发现两层问题叠在一起，而且**都不报错**：
//   ① 打包产物里 Key 为空（v1.20.4 合规整改把明文移出仓库）→ 第一道闸就 no_key 返回；
//   ② 即使只填了 Key，`KEYS.qweatherHost() + "/v7/weather/7d"` 在 Host 为空时会把 URL 拼成
//      "null/v7/weather/7d" —— 网络层必然失败，却被归类成 net/api，界面只显示「服务异常」，
//      真实原因（Host 没配）永远浮不出来；而旧版「配置密钥」UI 根本没有填 Host 的入口。
//
// 本测试全部是**真跑**（桩 wx.request 抓真实 URL），不是「源码里有某个判断」那种假绿。
import { createRequire } from "module";
import { readFileSync } from "fs";

const req = createRequire(process.cwd() + "/");
const W = req("./utils/weather.js");
const KEYS = req("./utils/keys.js");

// v1.20.42：本机 keys.local.js 可能已填真实 Key（随包上传，零配置可用）。
// 本测试验证的是「配置解析逻辑」——「空配置 → no_key / 只填 Key → 公共域名」等分支，
// 必须脱离本机配置状态才能稳定复现。keys.js 的 LOCAL 与这里的 LOCAL_FILE 是同一个
// module.exports 对象，测试期间清空、收尾还原，既不改文件也不影响其它用例。
let LOCAL_FILE = null;
try { LOCAL_FILE = req("./utils/keys.local.js"); } catch (e) { LOCAL_FILE = null; }
const SAVED_LOCAL = LOCAL_FILE ? { qweatherKey: LOCAL_FILE.qweatherKey, qweatherHost: LOCAL_FILE.qweatherHost } : null;
if (LOCAL_FILE) { LOCAL_FILE.qweatherKey = ""; LOCAL_FILE.qweatherHost = ""; }
const restoreLocal = () => {
  if (!LOCAL_FILE || !SAVED_LOCAL) return;
  LOCAL_FILE.qweatherKey = SAVED_LOCAL.qweatherKey;
  LOCAL_FILE.qweatherHost = SAVED_LOCAL.qweatherHost;
};

let fail = 0;
const ok = (n, c, d) => {
  console.log((c ? "  ✓ " : "  ✗ FAIL: ") + n + (c || d === undefined ? "" : "  [" + d + "]"));
  if (!c) fail++;
};

const SAVED_WX = global.wx;
const SAVED_ST = global.setTimeout;

// 内存版 storage 桩：keys.js 每次读都走 wx.getStorageSync，改 store 即改配置结果
function useWx(store, onReq) {
  global.wx = {
    request(o) { if (onReq) onReq(o); },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setStorageSync(k, v) { store[k] = v; },
    removeStorageSync(k) { delete store[k]; }
  };
  return store;
}

const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const T0 = new Date(); T0.setHours(0, 0, 0, 0);
const D1 = ymd(new Date(T0.getTime() + 86400000)); // 明天：必在 7 天预报窗口内

// 每个用例用**不同城市**：_WX_CACHE 是模块级内存缓存，同城同日会命中上一个用例的缓存而不发请求
const planOf = (city) => ({ cityName: city, days: [{ date: D1, cityName: city }] });

// 抓一次请求：返回 { url, n }
function runOnce(city, store, reply) {
  const hits = [];
  useWx(store, (o) => {
    hits.push(o && o.url);
    if (reply && typeof o.success === "function") o.success(reply);
  });
  let err = null;
  W.fetchPlanWeather(planOf(city), (l, e) => { err = e; });
  global.wx = SAVED_WX;
  return { url: hits[0] || "", n: hits.length, err };
}

const K = "kw-test-abcdef012345";
const LEGACY = "https://devapi.qweather.com";
const CUSTOM = "h2a9cf3mhs.xy.qweatherapi.com";

// ── ① 完全未配置：宁可明确说「未配置」，也不许拼坏地址发出去 ──
{
  const r = runOnce("北京", {});
  ok("未配置 → 一次请求都不发（不拿坏 URL 白撞网络）", r.n === 0, "n=" + r.n);
  ok("未配置 → err.type=no_key", !!r.err && r.err.type === "no_key", JSON.stringify(r.err));
  ok("未配置 → 文案指出需要 Key + API Host（不再只说「配置 Key」）",
    !!r.err && /Key/.test(r.err.msg) && /API Host/i.test(r.err.msg), r.err && r.err.msg);
}

// ── ② 只填 Key（老配置形态）：回落公共域名，URL 必须是完整合法地址 ──
//     这就是旧代码的破点：Host 为空时 url = null + "/v7/weather/7d"。
{
  const r = runOnce("上海", { __app_keys__: { qweatherKey: K } });
  ok("只填 Key → 仍会尝试请求（老配置不被一刀切判死）", r.n === 1, "n=" + r.n);
  ok("只填 Key → URL 落到公共域名基址", r.url === LEGACY + "/v7/weather/7d", r.url);
  ok("只填 Key → URL 里不含 null（旧版 bug 的直接特征）", !/null/i.test(r.url), r.url);
}

// ── ③ Key + 裸域名 Host：自动补 https://，不许出现 "h2a9.../v7" 这种缺 scheme 的地址 ──
{
  const r = runOnce("广州", { __app_keys__: { qweatherKey: K, qweatherHost: CUSTOM } });
  ok("裸域名 Host → 自动补 https:// 并拼成完整 URL",
    r.url === "https://" + CUSTOM + "/v7/weather/7d", r.url);
}

// ── ④ 用户粘贴带 https:// + 尾部斜杠：规范化后不得拼出 "//v7" 双斜杠 ──
{
  const r = runOnce("深圳", { __app_keys__: { qweatherKey: K, qweatherHost: "https://" + CUSTOM + "/" } });
  ok("带 scheme + 尾斜杠的 Host → 去尾斜杠后拼接（不出 //v7）",
    r.url === "https://" + CUSTOM + "/v7/weather/7d", r.url);
  ok("URL 中无连续双斜杠（scheme 之后）", !/^https?:\/\/[^/]*\/\//.test(r.url), r.url);
}

// ── ⑤⑥ 明显不是域名的脏值（中文 / 占位符）：当未填处理 → 回落公共域名，
//      绝不能把中文拼进 URL（微信会直接判 url 非法，报错还看不出原因）──
{
  const r5 = runOnce("成都", { __app_keys__: { qweatherKey: K, qweatherHost: "在此填写专属域名" } });
  ok("中文脏值 Host → 回落公共域名（不把中文拼进 URL）",
    r5.url === LEGACY + "/v7/weather/7d", r5.url);
  const r6 = runOnce("杭州", { __app_keys__: { qweatherKey: K, qweatherHost: "https://your_apis.qweatherapi.com" } });
  ok("占位符 Host → 回落公共域名",
    r6.url === LEGACY + "/v7/weather/7d", r6.url);
  const r7 = runOnce("重庆", { __app_keys__: { qweatherKey: K, qweatherHost: "nodots" } });
  ok("无点号 Host → 回落公共域名",
    r7.url === LEGACY + "/v7/weather/7d", r7.url);
}

// ── ⑦ 走 legacy 基址时，失败必须指路「换专属 Host」──
//     旧版这里只说「天气加载失败，请重试」，用户重试一百次也不会去填 Host。
{
  // 让重试立即执行，不真等 400ms
  global.setTimeout = (fn, ms) => SAVED_ST(fn, 0);
  const hits = [];
  useWx({ __app_keys__: { qweatherKey: K } }, (o) => {
    hits.push(o && o.url);
    if (o && typeof o.fail === "function") o.fail({ errMsg: "request:fail timeout" });
  });
  let netErr = null;
  W.fetchPlanWeather(planOf("南京"), (l, e) => { netErr = e; });
  await new Promise((r) => SAVED_ST(r, 30));
  global.setTimeout = SAVED_ST;
  global.wx = SAVED_WX;
  ok("legacy 基址网络失败 → 仍归 net（页面给重试按钮）", !!netErr && netErr.type === "net");
  ok("legacy 基址网络失败 → 文案指明「填专属 API Host」", !!netErr && /API Host/i.test(netErr.msg), netErr && netErr.msg);
  ok("legacy 失败前确实请求了公共域名", hits.length > 0 && hits[0] === LEGACY + "/v7/weather/7d", hits[0]);
}

// ── ⑧ legacy 基址下接口返回 401：同样要指路 ──
{
  const r = runOnce("武汉", { __app_keys__: { qweatherKey: K } }, { data: { code: "401" } });
  ok("legacy 基址 401 → 归 auth（Key 无效语义不变）", !!r.err && r.err.type === "auth", JSON.stringify(r.err));
  ok("legacy 基址 401 → 文案附带 Host 指引", !!r.err && /API Host/i.test(r.err.msg), r.err && r.err.msg);
}

// ── ⑨ 对照组：填了专属 Host 后失败，**不得**再塞 Host 指引 ──
//     否则提示自相矛盾（已经填了还让人去填），且会稀释真正的错误原因。
{
  const r = runOnce("西安", { __app_keys__: { qweatherKey: K, qweatherHost: CUSTOM } }, { data: { code: "401" } });
  ok("已填专属 Host 的 401 → 归 auth", !!r.err && r.err.type === "auth", JSON.stringify(r.err));
  ok("已填专属 Host 的失败文案不含 Host 指引（提示不自我矛盾）",
    !!r.err && !/API Host/i.test(r.err.msg), r.err && r.err.msg);
}

// ── ⑩ 缓存按「基址」隔离：换 Host 后不得命中旧 Host 的盘上缓存 ──
//     否则用户按提示换了专属 Host，看到的还是公共域名拉回来的旧数据，且会误以为换 Host 没用。
{
  const city = "昆明";
  const wkey = city + "|" + ymd(T0) + "|" + LEGACY;
  const disk = {};
  disk["wxcacheV1." + wkey] = { t: Date.now(), v: { [D1]: { date: D1, code: 0, icon: "sun", desc: "晴" } } };
  const hits = [];
  useWx(Object.assign({ __app_keys__: { qweatherKey: K, qweatherHost: CUSTOM } }, disk), (o) => {
    hits.push(o && o.url);
    if (o && typeof o.success === "function") o.success({ data: { code: "401" } });
  });
  let e10 = null;
  W.fetchPlanWeather(planOf(city), (l, e) => { e10 = e; });
  global.wx = SAVED_WX;
  ok("换 Host 后不命中旧基址的盘上缓存（仍发请求）", hits.length === 1, "n=" + hits.length);
  ok("换 Host 后的请求打新基址", hits[0] === "https://" + CUSTOM + "/v7/weather/7d", hits[0]);
  ok("旧基址缓存不会让页面误报成功", !!e10, "err=" + JSON.stringify(e10));
}

// ── ⑪ setKeys 写入后立即生效（more 页保存后立刻看状态，靠的就是这条同步性）──
{
  const store = {};
  useWx(store);
  const before = KEYS.qweatherBase();
  KEYS.setKeys({ qweatherKey: K, qweatherHost: CUSTOM });
  const after = KEYS.qweatherBase();
  const mode = KEYS.qweatherHostMode();
  global.wx = SAVED_WX;
  ok("setKeys 前无基址（fail-closed）", before === null, String(before));
  ok("setKeys 后基址立即可用（无需重启/重进页面）", after === "https://" + CUSTOM, String(after));
  ok("setKeys 后模式为 custom", mode === "custom", mode);
}

// ── ⑫ 禁止回潮：源码里不许再出现「直接把 qweatherHost() 拼进 URL」的写法 ──
//     这是一条**禁止性**断言（配 ③④⑤ 的真跑断言才有意义）：坏形态一旦复活，
//     上面那些真跑用例会先红；这里再钉死写法，避免有人绕过 keys.js 的 qweatherBase()。
{
  for (const p of ["tools/_src-backup/weather.js", "utils/weather.js"]) {
    let s = "";
    try { s = readFileSync(process.cwd() + "/" + p, "utf8"); } catch (e) {}
    ok(p + " 不再裸拼 qweatherHost() 进 URL", s.length > 0 && !/qweatherHost\s*\(\s*\)\s*\+/.test(s),
      s.length === 0 ? "文件读不到" : "仍存在 host 裸拼");
  }
  let src = "";
  try { src = readFileSync(process.cwd() + "/utils/weather.js", "utf8"); } catch (e) {}
  ok("产物里 URL 由基址拼出（含 qweatherBase 调用）", /qweatherBase\(\)/.test(src));
}

restoreLocal();   // 还原本机真实 Key，别让测试改变后续用例/进程的配置
console.log(fail ? ("\n✗ keys-base 单测失败 " + fail + " 项") : "\n✓ keys-base 单测全部通过");
process.exit(fail ? 1 : 0);
