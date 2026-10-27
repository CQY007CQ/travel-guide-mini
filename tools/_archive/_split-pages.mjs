// v1.20 拆分包：给所有页面加「数据就绪」门控。
// 无 onLoad 的页面：插入 onLoad(设置 __boot) + 包装 onShow → _renderShow。
// 有 onLoad 的页面：在 onLoad 开头注入 __boot，再包装 onShow。
// splash 单独处理（await ready 后再进首页）。
import fs from "fs";

const BASE = process.cwd();
const noOnLoad = [
  "pages/plan/plan.js",
  "subpkg/ledger/ledger.js",
  "subpkg/prep/prep.js",
  "subpkg/food/food.js",
  "subpkg/assistant/assistant.js",
  "subpkg/map/map.js",
  "pages/today/today.js",
  "pages/more/more.js",
];
const withOnLoad = [
  "pages/index/index.js",
  "subpkg/guide/guide.js",
];
const toolkit = "subpkg/toolkit/toolkit.js";

const wrap2 = `  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() { (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
  _renderShow() {`;

const wrap1 = ` onLoad() { this.__boot = T.ready().catch(() => null); },
 onShow() { (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) { try { wx.showToast({ title: "数据加载中，请稍后重试", icon: "none" }); } catch (_) {} } }); },
 _renderShow() {`;

const wrapWithOnLoad2 = `  onShow() { (this.__boot || Promise.resolve()).then(() => { try { this._renderShow(); } catch (e) {} }); },
  _renderShow() {`;

function apply(f, from, to, label) {
  let s = fs.readFileSync(f, "utf8");
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log("✗ " + label + " 命中 " + n + " 次：" + f); return false; }
  fs.writeFileSync(f, s.replace(from, to), "utf8");
  return true;
}
function injectAfter(f, marker, inject, label) {
  let s = fs.readFileSync(f, "utf8");
  const idx = s.indexOf(marker);
  if (idx < 0) { console.log("✗ 找不到注入点 " + label + "：" + f); return false; }
  if (s.indexOf("__boot = T.ready") >= 0) { console.log("✗ 已注入过 " + f); return false; }
  fs.writeFileSync(f, s.slice(0, idx + marker.length) + inject + s.slice(idx + marker.length), "utf8");
  return true;
}

let ok = true;
for (const f of noOnLoad) {
  const ind = f === toolkit ? 1 : 2;
  const from = (ind === 1 ? " onShow() {" : "  onShow() {");
  const to = ind === 1 ? wrap1 : wrap2;
  ok = apply(BASE + "/" + f, from, to, "包装 onShow(" + f + ")") && ok;
}
// withOnLoad: 在 onLoad 开头注入 __boot
ok = injectAfter(BASE + "/pages/index/index.js", "  onLoad() {\n", "    this.__boot = T.ready().catch(() => null);\n", "index onLoad") && ok;
ok = injectAfter(BASE + "/subpkg/guide/guide.js", "  onLoad() {\n", "    this.__boot = T.ready().catch(() => null);\n", "guide onLoad") && ok;
// withOnLoad 页面的 onShow 包装（不新增 onLoad）
ok = apply(BASE + "/pages/index/index.js", "  onShow() {", wrapWithOnLoad2, "index onShow 包装") && ok;
ok = apply(BASE + "/subpkg/guide/guide.js", "  onShow() {", wrapWithOnLoad2, "guide onShow 包装") && ok;
// toolkit：1 空格缩进 + 已有 onLoad
ok = injectAfter(BASE + "/subpkg/toolkit/toolkit.js", " onLoad() {\n", "   this.__boot = T.ready().catch(() => null);\n", "toolkit onLoad") && ok;
ok = apply(BASE + "/subpkg/toolkit/toolkit.js", " onShow() {", wrap1, "toolkit onShow 包装") && ok;

console.log(ok ? "✓ 页面门控注入完成" : "✗ 有失败项");
