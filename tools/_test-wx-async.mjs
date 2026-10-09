// 模拟「微信端」加载路径：注入带有 .async 的 require，强制走 utils/data.js 的
// `typeof require.async === "function"` 分支（Node 常规 require 无 .async，永远走不到这条）。
// 这正是本项目历史白屏的漏测点——本测试用于永久看住该分支。
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";

const dataPath = path.resolve("utils/data.js");
const baseReq = createRequire(dataPath);
const fakeReq = (p) => baseReq(p);
fakeReq.async = (p) => Promise.resolve(baseReq(p)); // 微信 require.async 语义：resolve 到 module.exports

const src = fs.readFileSync(dataPath, "utf8");
const mod = { exports: {} };
const sandbox = {
  module: mod, exports: mod.exports, require: fakeReq, process, console,
  Promise, Set, Map, JSON, Uint8Array, Math, String, Object, Array, Number,
  Boolean, Date, Error, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
};
vm.runInNewContext(src, sandbox, { filename: dataPath });

const D = mod.exports;
if (typeof D.initData !== "function") { console.log("❌ 未导出 initData"); process.exit(1); }

D.initData().then(() => {
  const n = (D.CITIES || []).length;
  const first = D.CITIES && D.CITIES[0] && D.CITIES[0].name;
  const noName = (D.CITIES || []).filter((c) => !(c && c.name)).length;
  let alias = 0;
  JSON.stringify(D, (k, v) => { if (/^@[A-Za-z0-9+\-=]$/.test(k)) alias++; return v; });
  const ok = n === 751 && !noName && alias === 0 && !!first;
  console.log(`微信异步分支加载: CITIES=${n} | [0].name=${first} | 无name=${noName} | 残留别名码=${alias}`);
  console.log(ok ? "✅ 微信异步分支加载正确" : "❌ 微信异步分支加载异常");
  process.exit(ok ? 0 : 1);
}).catch((e) => { console.log("❌ initData 失败:", e && e.message); process.exit(1); });
