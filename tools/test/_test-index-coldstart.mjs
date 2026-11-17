// 单测：首页冷启动「数据未就绪」路径（v1.20.10）
//
// 病情（真机实测 Page.onLoad 1676ms 的来源之一）：
//   首页 onLoad 是同步执行的，而城市数据（subdata/subdata2/subdata3）是 require.async 异步解包。
//   旧实现不管数据到没到，都在 onLoad 里把「建出发地表(400+ 条) → 填省城 → 高级设置 → 假期提示」
//   整套跑一遍；provs 那时必为空，于是这一轮全是空跑，boot 完成后 _ensureForm() 又从头重做。
//   更严重的是两个功能性后果（不报错、不白屏，只在冷启动发生）：
//     ① 分享链接 ?city=xxx —— _applyDeepLink 遍历空省表 → 找不到城市 → 直接 return，城市丢失；
//     ② 跨会话偏好城市 —— _applyPrefs 只在 onLoad 调用，同样找不到城市，冷启动永远回到默认出发地。
//   两者都只有「第二次进入」（数据已在内存）才表现正常，属于最难复现的那类 bug。
//
// 本单测锁三件事：
//   A. 数据未就绪时 onLoad 不得执行依赖数据那一轮（挂起 __needIndexInit）；
//   B. boot 完成后 _ensureForm() 必须补跑，且深链城市真的被选中；
//   C. 数据已就绪时行为与旧实现一致（onLoad 内立即生效，不等 onShow）。
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nodeRequire = createRequire(path.join(ROOT, "utils", "_sandbox.js"));

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

/* ───── wx / app 垫片（页面整条链路都会碰）───── */
const store = new Map();
const toast = [];
const mkToast = () => ({ success() {}, fail() {}, complete() {} });
const wxMock = new Proxy({}, {
  get(t, k) {
    // 必须有真解码：utils/data.js 的 b64ToBytes() 优先走 wx.base64ToArrayBuffer，
    // 兜底空函数会让 pako 抛 "buffer error"、数据整块为空，于是「冷启动」根本没被复现。
    if (k === "base64ToArrayBuffer") return (b64) => {
      const buf = Buffer.from(String(b64 || ""), "base64");
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    };
    if (k === "arrayBufferToBase64") return (ab) => Buffer.from(ab).toString("base64");
    if (k === "getStorageSync") return (key) => (store.has(key) ? store.get(key) : "");
    if (k === "setStorageSync") return (key, v) => { store.set(key, v); };
    if (k === "removeStorageSync") return (key) => { store.delete(key); };
    if (k === "clearStorageSync") return () => { store.clear(); };
    if (k === "getStorageInfoSync") return () => ({ keys: [...store.keys()], currentSize: 0, limitSize: 10240 });
    if (k === "getSystemInfoSync" || k === "getSystemInfo") return (cb) => { const r = { pixelRatio: 2, windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: "devtools", fontSizeSetting: 16 }; if (cb) cb(r); return r; };
    if (k === "getAccountInfoSync") return () => ({ miniProgram: { envVersion: "develop" } });
    if (k === "getMenuButtonBoundingClientRect") return () => ({ top: 20, right: 303, bottom: 64, left: 240, width: 63, height: 44 });
    if (k === "showToast") return (o) => { toast.push((o && o.title) || ""); return mkToast(); };
    if (k === "createSelectorQuery") return () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([]); return this; } });
    if (typeof k === "string" && k.startsWith("on")) return () => {};
    return () => mkToast();
  },
  has() { return true; },
});
globalThis.wx = wxMock;
const appMock = { globalData: { plan: null }, setPlan(p) { this.globalData.plan = p; } };
globalThis.getApp = () => appMock;

let cfg = null;
globalThis.Page = (c) => { cfg = c; };
globalThis.Component = () => {};

// 页面模块只需加载一次（Page 收集器抓取配置）
nodeRequire(path.join(ROOT, "pages", "index", "index.js"));
const T = nodeRequire(path.join(ROOT, "utils", "travel.js"));

ck("页面配置已捕获", !!cfg && typeof cfg.onLoad === "function");
ck("城市数据在 Node 侧就绪（基准前提）", !!(T.D && T.D.__dataReady && (T.D.CITIES || []).length), "cities=" + ((T.D && T.D.CITIES) || []).length);

// 关键前置：先把 ready() 跑出来，让 data.js 内部的 initData() 进缓存。
// 否则每次 onLoad 调 ready() 都会在 Node 分支里**同步**重跑 applyPacked（Node 没有 require.async），
// 把刚清空的省表又填回去 —— 冷启动模拟就被自己冲掉了（第一版踩过）。
await T.ready();

// 造一个页面实例：data 深拷贝，setData 合并，_initFrom/_fillProv 加调用计数
function makePage() {
  const page = Object.assign({}, cfg);
  page.data = JSON.parse(JSON.stringify(cfg.data || {}));
  page.setData = function (patch, cb) { Object.assign(this.data, patch || {}); if (typeof cb === "function") cb(); };
  page.selectComponent = () => null;
  page.selectAllComponents = () => [];
  page.__calls = { initFrom: 0, fillProv: 0 };
  for (const fn of ["_initFrom", "_fillProv"]) {
    const orig = page[fn];
    const key = fn === "_initFrom" ? "initFrom" : "fillProv";
    page[fn] = function () {
      if (this.__calls) this.__calls[key]++;
      return orig.apply(this, arguments);
    };
  }
  return page;
}
const tick = () => new Promise((r) => setTimeout(r, 30));

// 模拟「分包还没到」：只翻 __dataReady 不够 —— T.provinces() 读的是 D.PROVINCES，
// 内存里数据仍在，provs 非空，首页会照样走热路径，冷启动根本没被复现（第一版就白跑了）。
// 因此必须把省表一起清空，等断言完再原样恢复。
function intoCold() {
  const keep = { provinces: T.D.PROVINCES, ready: T.D.__dataReady };
  T.D.PROVINCES = [];
  T.D.__dataReady = false;
  return keep;
}
function backToWarm(keep) {
  T.D.PROVINCES = keep.provinces;
  T.D.__dataReady = true;
}

/* ───── A/B：冷启动（数据未就绪）───── */
{
  store.clear();
  const page = makePage();
  const DEEP = { city: encodeURIComponent("丽江"), days: "3" };
  const keep = intoCold();
  try { cfg.onLoad.call(page, DEEP); } catch (e) { ck("冷启动 onLoad 不抛错", false, e.message); }
  ck("冷启动：挂起标记已设置", page.__needIndexInit === true);
  ck("冷启动：不建出发地表（省下 400+ 条空跑）", page.__calls.initFrom === 0, "initFrom=" + page.__calls.initFrom);
  ck("冷启动：不填省城选择器", page.__calls.fillProv === 0, "fillProv=" + page.__calls.fillProv);
  ck("冷启动：日期仍有默认值（基础字段不依赖数据）", !!page.data.depart && !!page.data.departMin, page.data.depart);

  backToWarm(keep);                        // 分包到达
  try { cfg.onShow.call(page); } catch (e) { ck("冷启动 onShow 不抛错", false, e.message); }
  await tick();
  ck("boot 后：标记已消费", page.__needIndexInit === false);
  ck("boot 后：出发地表补建", page.__calls.initFrom >= 1, "initFrom=" + page.__calls.initFrom);
  ck("boot 后：省表已填充", (page.data.provinces || []).length > 0, "provs=" + (page.data.provinces || []).length);
  ck("boot 后：分享链接的城市真的选中了（旧实现冷启动会丢）",
    page.data.cityName === "丽江", "cityName=" + page.data.cityName);
  ck("boot 后：天数接住深链参数", String(page.data.days) === "3", "days=" + page.data.days);
}

/* ───── C：热启动（数据已就绪）—— 行为须与旧实现一致，不等 onShow ───── */
{
  store.clear();
  const page = makePage();
  const DEEP = { city: encodeURIComponent("丽江"), days: "3" };
  ck("前提：数据已就绪", T.D.__dataReady === true);
  try { cfg.onLoad.call(page, DEEP); } catch (e) { ck("热启动 onLoad 不抛错", false, e.message); }
  ck("热启动：onLoad 内立即建表", page.__calls.initFrom >= 1, "initFrom=" + page.__calls.initFrom);
  ck("热启动：onLoad 内立即选中深链城市", page.data.cityName === "丽江", "cityName=" + page.data.cityName);
  ck("热启动：不设置挂起标记", !page.__needIndexInit);
}

/* ───── D：偏好城市在冷启动也必须恢复（_applyPrefs 只在 onLoad 调，旧实现必丢）───── */
{
  store.clear();
  try { T.setPrefs && T.setPrefs({ city: "丽江", days: 4 }); } catch (e) { /* 无该接口时跳过 */ }
  const page = makePage();
  const keep = intoCold();
  try { cfg.onLoad.call(page, {}); } catch (e) { /* 冷启动不抛错已由 A 断言 */ }
  backToWarm(keep);
  try { cfg.onShow.call(page); } catch (e) { /* 同上 */ }
  await tick();
  const prefOk = page.data.cityName === "丽江";
  ck("冷启动：跨会话偏好城市恢复", prefOk || typeof T.setPrefs !== "function",
    prefOk ? "" : "cityName=" + page.data.cityName + "（无 setPrefs 接口则本条不判红）");
}

/* ───── 结构防回潮 ───── */
{
  const src = nodeRequire("fs").readFileSync(path.join(ROOT, "pages", "index", "index.js"), "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const onLoadBody = (src.match(/onLoad\(options\)\s*\{([\s\S]*?)\n {2}\},/) || [])[1] || "";
  ck("onLoad 不再无条件调用 _initFrom/_fillProv",
    !/_initFrom\(\)/.test(onLoadBody) && !/_fillProv\(/.test(onLoadBody));
  ck("onLoad 有「数据就绪才跑」的分支", /provs\.length/.test(onLoadBody) && /_initIndexData\(\)/.test(onLoadBody));
  const genSrc = nodeRequire("fs").readFileSync(path.join(ROOT, "pages", "index", "m-generate.js"), "utf8");
  ck("_ensureForm 会消费挂起标记", /__needIndexInit/.test(genSrc) && /_initIndexData\(\)/.test(genSrc));
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败项") + `：${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
