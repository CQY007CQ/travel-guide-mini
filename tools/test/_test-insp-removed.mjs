/**
 * tools/test/_test-insp-removed.mjs —— 「今日正当时」下线守卫
 *
 * 2026-10-29：用户要求下线「今日正当时」（首页横滑灵感卡 + 今天页两处）。
 * 原来的 _test-v11987-insp-ui.mjs 是测"灵感卡接线正常"的，UI 删掉后它必然报错。
 * 这里把它改写成反向守卫：**断言这个功能真的没了**，防止以后重构时被无意加回来
 * （比如从旧分支复制回页面代码），也留下这次决策的可执行记录。
 *
 * 保留的部分：utils/travel.js 的 T.dailyInspire() 函数与其单测 _test-daily-insp.mjs。
 * 函数本身没删——它依赖 CITIES/bestMonths 的时令匹配，未来可能复用；单测继续防它腐化。
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
let n = 0, bad = 0;
function ok(desc, cond, detail) {
  n++;
  if (cond) return;
  bad++;
  console.log("  ✗ " + desc + (detail ? "  → " + detail : ""));
}

function read(p) {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch (e) { return ""; }
}

// 一、页面模板里不得再有灵感卡结构
const WXML = ["pages/index/index.wxml", "pages/today/today.wxml"];
for (const f of WXML) {
  const s = read(f);
  ok(f + " 不含 insp-bar/em-insp 容器", !/insp-bar|em-insp/.test(s));
  ok(f + " 不含 onInspTap 绑定", s.indexOf("onInspTap") < 0);
  ok(f + " 不渲染 insp 数组", !/\{\{\s*insp/.test(s));
}

// 二、页面逻辑里不得再取灵感数据
const JS = ["pages/index/index.js", "pages/today/today.js"];
for (const f of JS) {
  const s = read(f);
  ok(f + " 不调用 dailyInspire", s.indexOf("dailyInspire") < 0);
  ok(f + " 不含 onInspTap 方法", !/onInspTap\s*\(/.test(s));
}

// 三、函数本身仍在（供未来复用），且单测仍在跑
const travel = read("utils/travel.js");
ok("utils/travel.js 仍导出 dailyInspire（函数保留，仅下线 UI）", travel.indexOf("dailyInspire") >= 0);
ok("保留其单测 tools/test/_test-daily-insp.mjs", fs.existsSync(path.join(ROOT, "tools/test/_test-daily-insp.mjs")));

// 四、不误伤：盲盒（inspirePicks）与更多页灵感（inspire）是另外两个功能，必须还在
const idx = read("pages/index/index.js");
const more = read("pages/more/more.js");
ok("首页盲盒 inspirePicks 仍在（另一个功能）", idx.indexOf("inspirePicks") >= 0);
ok("更多页「去哪儿好呢」inspire 仍在（另一个功能）", more.indexOf("T.inspire(") >= 0);

// 五、连带下线：v1.19.89「分享即种草」标题依赖 dailyInspire，随灵感卡一起失效
const idxSrc = read("pages/index/index.js");
const tdSrc = read("pages/today/today.js");
ok("首页分享标题不再引用 dailyInspire", idxSrc.slice(idxSrc.indexOf("onShareAppMessage"), idxSrc.indexOf("onShareAppMessage") + 800).indexOf("dailyInspire") < 0);
ok("今天页分享标题不再引用 dailyInspire", tdSrc.slice(tdSrc.indexOf("onShareAppMessage"), tdSrc.indexOf("onShareAppMessage") + 600).indexOf("dailyInspire") < 0);
ok("首页分享仍是可用文案（含城市数或产品名）", /path: "\/pages\/index\/index"/.test(idxSrc));

console.log("");
if (bad) { console.log("insp 下线守卫失败：" + bad + " 项（有代码把功能加回来了？）"); process.exit(1); }
console.log("insp 下线守卫通过：" + n + " 项");
