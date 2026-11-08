/**
 * tools/_test-audit-guards.mjs —— 审计整改防回潮断言（v1.20.4 #82）
 *
 * 守护本轮已落地的修复不被后续改动静默回潮：
 *   #1/#19 密钥无明文进仓库（DEFAULT 三字段空串 + setKeys 仍可用）
 *   #56 onShow 收敛（10 页均引用 onShowRender，无回潮到内联样板）
 *   #81 store 收口（getJSON/setJSON 已导出且可 round-trip）
 *
 * 注：手写双源同步（keys.js / data.js 与 _src-backup 字节一致）由 allcheck「合并门禁」步负责，
 * 此处不重复；本文件只守「整改项功能语义」不回潮。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// 内存版 wx 存储桩：让 store.js 的 getJSON/setJSON 在 Node 下可 round-trip 验证
global.wx = global.wx || {
  _m: new Map(),
  getStorageSync(k) { return this._m.has(k) ? this._m.get(k) : ""; },
  setStorageSync(k, v) { this._m.set(k, v); },
  removeStorageSync(k) { this._m.delete(k); },
  showToast() {},
  getStorageInfoSync() { return { currentSize: 0, limitSize: 10240, keys: [] }; }
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : "")); }
}

// ── #1/#19 密钥无明文 ──
try {
  const keys = require(path.join(ROOT, "utils/keys.js"));
  const D = keys.DEFAULT || {};
  ok("#1/#19 DEFAULT.qweatherKey 为空串（无明文回潮）", D.qweatherKey === "", JSON.stringify(D.qweatherKey));
  ok("#1/#19 DEFAULT.qweatherHost 为空串", D.qweatherHost === "", JSON.stringify(D.qweatherHost));
  ok("#1/#19 DEFAULT.amapKey 为空串", D.amapKey === "", JSON.stringify(D.amapKey));
  ok("#1/#19 setKeys 运行时注入仍可用", typeof keys.setKeys === "function");
} catch (e) {
  fail++; console.log("  ✗ FAIL: 加载 utils/keys.js 抛错  → " + e.message);
}

// ── #56 onShow 收敛 ──
try {
  const app = require(path.join(ROOT, "utils/app.js"));
  ok("#56 utils/app.js 导出 onShowRender", typeof app.onShowRender === "function");
  const pages = [
    "pages/index/index.js", "pages/today/today.js", "pages/plan/plan.js", "pages/more/more.js",
    "subpkg/assistant/assistant.js", "subpkg/prep/prep.js", "subpkg/ledger/ledger.js",
    "subpkg/map/map.js", "subpkg/food/food.js", "subpkg/toolkit/toolkit.js"
  ];
  const bad = [];
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    if (!/onShowRender/.test(src)) bad.push(p);
  }
  ok("#56 10 页均引用 onShowRender（无回潮到内联样板）", bad.length === 0, bad.join(","));
} catch (e) {
  fail++; console.log("  ✗ FAIL: 加载 utils/app.js 抛错  → " + e.message);
}

// ── #81 store 收口 ──
try {
  const store = require(path.join(ROOT, "utils/store.js"));
  ok("#81 store 导出 getJSON", typeof store.getJSON === "function");
  ok("#81 store 导出 setJSON", typeof store.setJSON === "function");
  const TK = "__audit_guard_tmp__";
  store.setJSON(TK, { a: 1, b: [2, 3] });
  const back = store.getJSON(TK, null);
  ok("#81 getJSON/setJSON round-trip", back && back.a === 1 && Array.isArray(back.b) && back.b[1] === 3);
  try { if (typeof store.del === "function") store.del(TK); } catch (e) {}
} catch (e) {
  fail++; console.log("  ✗ FAIL: 加载 utils/store.js 抛错  → " + e.message);
}

console.log("");
if (fail > 0) {
  console.log("审计整改防回潮断言失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
console.log("审计整改防回潮断言通过：" + pass + " 项");
