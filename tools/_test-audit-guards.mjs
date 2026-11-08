/**
 * tools/_test-audit-guards.mjs —— 审计整改防回潮断言（v1.20.4 #82）
 *
 * 守护本轮已落地的修复不被后续改动静默回潮：
 *   #1/#19 密钥无明文进仓库（DEFAULT 三字段空串 + setKeys 仍可用）
 *   #56 onShow 收敛（10 页均引用 onShowRender，无回潮到内联样板）
 *   #81 store 收口（getJSON/setJSON 已导出且可 round-trip）
 * 以及本轮 7 项「静默失效类」优化防回潮：
 *   网页版焦点恢复属性配对 / 导入读失败兜底与同文件重选 / 首页卸载清防抖定时器 /
 *   语法检查覆盖 subpkg 与网页版手写源码 / 单测无恒真断言 /
 *   真源缺失 fail-fast / 网页版增量同步目录感知
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

// ── 本轮「静默失效类」优化防回潮：这些缺陷都不报错、只是功能悄悄失灵 ──
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function guard(name, fn) {
  try { const r = fn(); ok(name, r[0], r[1]); }
  catch (e) { fail++; console.log("  ✗ FAIL: " + name + "  → " + e.message); }
}

guard("网页版焦点恢复属性配对", () => {
  const s = readSrc("web/lib/runtime.js");
  const a = (s.match(/\.__fkey\s*=/g) || []).length;
  const b = (s.match(/setAttribute\(\s*["']data-fkey/g) || []).length;
  return [a > 0 && a === b, "__fkey=" + a + " / data-fkey=" + b];
});
guard("网页版导入读失败有兜底", () => [ /rd\.onerror/.test(readSrc("web/index.html")) ]);
guard("网页版导入可重选同一文件", () => {
  const h = readSrc("web/index.html");
  const seg = h.slice(h.indexOf("rd.onload"), h.indexOf("rd.readAsText"));
  const p = seg.indexOf('fi.value = ""');
  return [p >= 0 && p < seg.indexOf("T()"), "清空位置=" + p];
});
guard("网页版导入有大小守卫", () => [ /f\.size\s*>/.test(readSrc("web/index.html")) ]);
guard("首页卸载清理防抖定时器", () => [
  /onUnload\s*\(\s*\)\s*\{[\s\S]{0,160}_kwTimer/.test(readSrc("pages/index/index.js"))
]);
guard("JS 语法检查覆盖 subpkg 与网页版手写源码", () => {
  const s = readSrc("allcheck.sh");
  return [/find[^\n]*subpkg[^\n]*web\/app\.js[^\n]*web\/lib\/runtime\.js/.test(s)];
});
guard("单测无恒真断言", () => {
  const s = readSrc("tools/check-new.mjs");
  return [!/\|\|\s*true\s*\)/.test(s) && !/assert\([^,]+,\s*true\s*\)/.test(s)];
});
guard("真源缺失 fail-fast", () => {
  const s = readSrc("tools/build-min.mjs");
  return [/备份源码缺失，构建中止/.test(s) && /process\.exit\(1\)/.test(s) && !/跳过（无备份源码）/.test(s)];
});
guard("网页版增量同步目录感知", () => {
  const s = readSrc("tools/web/build.mjs");
  return [/relTree/.test(s) && /rmdirSync/.test(s)];
});

// ── 2026-11-09 P0 凭据止血防回潮 ──────────────────────────────────────
// 起因：旧门禁只扫「会打进包」的目录，文件头注释还写着「tools/ 与 docs/ 不扫」，
// 结果公开仓库 docs/audit/ 里的明文 key 整轮发版都没被拦。泄露面是 git 跟踪面，不是包体面。
const HEX32_RE = /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/;

guard("凭据门禁扫描全仓而非仅随包目录", () => {
  const s = readSrc("tools/check-secrets.mjs");
  // 门禁断言查字面量会被「历史说明注释」误伤，先滤掉注释行再匹配
  const code = s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  return [/collect\(ROOT,\s*"",\s*all\)/.test(code) && !/tools\/ 与 docs\/ 不扫/.test(code)];
});
guard("allcheck 凭据步口径为全仓", () => [
  /凭据泄露 \(全仓无明文 key\)/.test(readSrc("allcheck.sh"))
]);
guard("32hex 正则带前后 hex 边界（sha256 摘要不误报）", () => {
  const s = readSrc("tools/check-secrets.mjs");
  return [/\(\?<!\[0-9a-fA-F\]\)/.test(s) && /\(\?!\[0-9a-fA-F\]\)/.test(s)];
});
guard("公开仓库审计文档已脱敏且无明文回潮", () => {
  const s = readSrc("docs/audit/code-audit-2026-11-08.md");
  return [!HEX32_RE.test(s) && /<REDACTED-32HEX-CREDENTIAL>/.test(s)];
});
guard("封禁 KEY 黑名单用 sha256 摘要而非明文", () => {
  const s = readSrc("tools/_amap-compliance.mjs");
  return [/REVOKED_KEY_SHA256/.test(s) && !HEX32_RE.test(s)];
});
guard("本地凭据池有 gitignore 与 git index 双断言", () => {
  const s = readSrc("tools/check-secrets.mjs");
  const gi = readSrc(".gitignore");
  return [/trackedInIndex\(rel\)/.test(s) && /LOCAL_POOLS/.test(s) && /geocode\.keys/.test(gi)];
});
guard("读 key 池脚本一律格式校验 + 友好空池 fail-closed", () => {
  const dir = path.join(ROOT, "tools");
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    if (f === "_test-audit-guards.mjs") continue;   // 断言脚本自身含该字面量，不能算作读 key 池脚本
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    if (s.indexOf('readFileSync("tools/geocode.keys"') < 0) continue;
    const fmt = /\[a-zA-Z0-9\]\{28,40\}/.test(s);
    const exit = /无可用 key/.test(s) && /process\.exit\(1\)/.test(s);
    const safe = /catch \(e\) \{ return ""; \}/.test(s) || /try \{ raw = fs\.readFileSync/.test(s);
    if (!fmt || !exit || !safe) bad.push(f + "(fmt=" + fmt + ",exit=" + exit + ",safe=" + safe + ")");
  }
  return [bad.length === 0, bad.join(",")];
});

// ── 2026-11-09 审计加固（#11/#12/#14/#16/#15/#65/#44/#46）防回潮 ──
guard("金额解析有限性与上限守卫", () => {
  const s = readSrc("tools/_src-backup/travel.js");
  return [/!isFinite\(amt\)/.test(s) && /99999999/.test(s) && /if \(!isFinite\(a\)/.test(s)];
});
guard("CSV 标准转义与公式注入防护", () => {
  const s = readSrc("tools/_src-backup/travel.js");
  return [/const cell =/.test(s) && /replace\(\/"\/g/.test(s)
    && s.indexOf("/^[=+") >= 0 && s.indexOf('.replace(/,/g, "，")') < 0];
});
guard("导入备份逐条净化", () => {
  const s = readSrc("tools/_src-backup/travel.js");
  return [/filter\(d => d && typeof d === "object"/.test(s) && /slice\(0, 200\)\.filter/.test(s)];
});
guard("网页版 innerHTML 动态文本全部转义", () => {
  const s = readSrc("web/lib/runtime.js");
  return [/function escHtml/.test(s) && /\+ escHtml\(t\) \+/.test(s)
    && /escHtml\(e && e\.message\)/.test(s) && s.indexOf("+ String(t) +") < 0];
});
guard("加固运行时单测挂在已有门禁步（不新增 step）", () => {
  const s = readSrc("allcheck.sh");
  return [s.indexOf("_test-hardening.mjs") >= 0 && /_test-audit-guards\.mjs &&/.test(s)];
});

console.log("");
if (fail > 0) {
  console.log("审计整改防回潮断言失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
console.log("审计整改防回潮断言通过：" + pass + " 项");
