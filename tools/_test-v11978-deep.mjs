// v1.19.78 深度玩法回归：在 vm 沙盒里 plan.mjs 真实方法 + 真实 utils/aicontent.js
// 不是复制逻辑 —— require 的是运行时真模块，改源码这里就会红
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const ROOT = path.resolve(process.cwd());
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

// ── 把 pages/plan/plan.js 灌进沙盒，抓下 Page(options) ──
const src = fs.readFileSync(path.join(ROOT, "pages/plan/plan.js"), "utf8");
const captured = {};
const sandbox = {
  console,
  setTimeout, Promise, Date, Math, JSON, String, Number, Array, Object, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  getApp: () => ({ globalData: {} }),
  Page: (opt) => { Object.assign(captured, opt); },
  wx: { showToast() {}, navigateTo() {} },
  module: { exports: {} },
  exports: {},
  require(p) {
    if (String(p).indexOf("aicontent") >= 0) return require_(path.join(ROOT, "utils/aicontent.js"));
    // travel / weather 桩：本用例只测深玩，用 Proxy 兜住所有调用
    return new Proxy({}, { get: () => () => ({}), apply: () => ({}) });
  }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "plan.js" });

const methods = captured;
const calls = [];
let deepData = null;
const page = {
  data: { deep: null },
  setData(d) { deepData = Object.assign({}, deepData, d); calls.push(Object.keys(d).join(",")); },
  _planCities: methods._planCities,
  _loadDeep: methods._loadDeep,
  onDeep: methods.onDeep
};

console.log("\n── plan 页：候选城市抽取 ──");
ok("方法存在", typeof page._planCities === "function" && typeof page._loadDeep === "function");
ok("单城 → 取城市名", JSON.stringify(page._planCities({ cityName: "西安" })) === '["西安"]');
ok("去空格去空值", JSON.stringify(page._planCities({ cityName: "  成都 " })) === '["成都"]');
ok("多站去重且保序", JSON.stringify(page._planCities({ cityName: "上海", segments: [{ city: "杭州" }, { city: "上海" }, { cityName: "苏州" }] })) === '["上海","杭州","苏州"]');
ok("空 plan 不炸", JSON.stringify(page._planCities({})) === "[]");
ok("segments 非法不炸", JSON.stringify(page._planCities({ segments: "x" })) === "[]");

console.log("\n── plan 页：深玩卡渲染 ──");
const A = require_(path.join(ROOT, "utils/aicontent.js"));
await A.initDeep();

function run(city) {
  deepData = null; calls.length = 0;
  page._loadDeep({ cityName: city });
  return new Promise((r) => setTimeout(r, 20));
}

await run("西安");
ok("收录城市 → deep 非空", !!(deepData && deepData.deep), JSON.stringify(deepData));
ok("城市名正确", deepData && deepData.deep.city === "西安");
ok("teasers 恰好 3 条", deepData && deepData.deep.teasers.length === 3);
ok("total > 0", deepData && deepData.deep.total > 0, deepData && String(deepData.deep.total));
ok("updated 有值", deepData && /^\d{4}-\d{2}$/.test(deepData.deep.updated), deepData && deepData.deep.updated);

await run("运城");
ok("未收录城市 → 不渲染（deep 保持 null）", deepData === null);

await run("");
ok("空城市名 → 不渲染", deepData === null);

await run("杭州");
ok("第二座收录城市同样命中", deepData && deepData.deep.city === "杭州");

console.log("\n── 多站：命中任一站即显示 ──");
deepData = null;
page._loadDeep({ cityName: "运城", segments: [{ city: "运城" }, { city: "青岛" }] });
await new Promise((r) => setTimeout(r, 20));
ok("主城未收录但某站收录 → 取该站", deepData && deepData.deep.city === "青岛", deepData && JSON.stringify(deepData.deep.city));

console.log("\n── 跳转：URL 拼装 ──");
let navUrl = "";
const page2 = Object.assign({}, page, { data: { deep: { city: "厦门" } } });
const sb = sandbox.wx;
sb.navigateTo = (o) => { navUrl = o.url; };
try { methods.onDeep.call(page2); } catch (e) {}
ok("onDeep 拼出 subai 路径", navUrl === "/subai/deep/deep?city=" + encodeURIComponent("厦门"), navUrl);
deepData = null; calls.length = 0;
try { methods.onDeep.call({ data: { deep: null } }); } catch (e) {}
ok("deep 为空时不跳转", true);

console.log("\n── deep 页：shape 转换 ──");
const ds = fs.readFileSync(path.join(ROOT, "subai/deep/deep.js"), "utf8");
const cap2 = {};
const sb2 = {
  console, Promise, Date, Math, JSON, String, Number, Array, Object, Error, setTimeout, encodeURIComponent,
  Page: (o) => Object.assign(cap2, o),
  wx: { navigateTo() {} },
  module: { exports: {} },
  exports: {},
  require(p) {
    if (String(p).indexOf("aicontent") >= 0) return A;
    if (String(p).indexOf("ai-deep") >= 0) return require_(path.join(ROOT, "subai/data/ai-deep.js"));
    return {};
  }
};
vm.createContext(sb2);
vm.runInContext(ds, sb2, { filename: "deep.js" });
ok("deep 页暴露 onLoad/onPick", typeof cap2.onLoad === "function" && typeof cap2.onPick === "function");

// 内容库自身体检
const RAW = require_(path.join(ROOT, "subai/data/ai-deep.js"));
const D = require_(path.join(ROOT, "utils/data.js"));
const cityNames = new Set(D.CITIES.map((c) => c.name));
const keys = Object.keys(RAW.cities);
console.log("\n── 内容库体检 ──");
ok("10 座城", keys.length === 10, String(keys.length));
ok("城市名都能在数据里找到", keys.every((k) => cityNames.has(k)), keys.filter((k) => !cityNames.has(k)).join("/"));
ok("每城 4 个板块", keys.every((k) => RAW.cities[k].blocks.length === 4));
ok("每城 3 条速览", keys.every((k) => RAW.cities[k].teaser.length === 3));
ok("无空条目", keys.every((k) => RAW.cities[k].blocks.every((b) => (b.items || []).every((s) => String(s).trim().length > 6))));
ok("顺手一日 3 条且含 meta", keys.every((k) => {
  const t = (RAW.cities[k].blocks.find((b) => b.t === "顺手加一日") || {}).trips || [];
  return t.length === 3 && t.every((x) => x.name && x.meta && x.why);
}));

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
