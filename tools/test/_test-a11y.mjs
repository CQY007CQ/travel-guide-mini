/**
 * tools/test/_test-a11y.mjs —— 字号无障碍回归（v1.19.181 跟随系统字号）
 *
 * 背景：全站 font-size 都走 calc(* var(--fs,1))，--fs 由 .fz1/.fz2/.fz3 提供，
 * 等级来自 travel.js 的 fontScale()。此前未在本应用内选择过字号的用户一律从「标准」开始，
 * 在微信里把字体调到「大/超大」的长辈看到的仍是最小字号。
 *
 * 断言三组：
 *   1. 用户显式选择优先（不能被系统字号覆盖）
 *   2. 未选择时跟随系统字号（18→2 级，20+→3 级，正常→1 级）
 *   3. 系统接口缺失/异常时安全退化到 1 级，不得抛错
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let bad = 0, n = 0;
function ok(desc, cond, detail) {
  n++;
  if (cond) return;
  bad++;
  console.log("  ✗ " + desc + (detail !== undefined ? "  → " + detail : ""));
}

/* 用可控的 wx 桩件模拟不同系统字号；每次重置模块缓存，保证 store 与 travel 读到新桩 */
const store = {};
function installWx(fontSizeSetting) {
  globalThis.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ""),
    setStorageSync: (k, v) => { store[k] = v; return true; },
    removeStorageSync: (k) => { delete store[k]; },
    getSystemInfoSync: () => ({ fontSizeSetting }),
    showToast: () => {},
    showModal: () => {},
  };
}
function freshT() {
  for (const k of Object.keys(require.cache)) {
    if (/utils[\\/](travel|store|data|planner|geo)\.js$/.test(k) || /_src-backup/.test(k)) delete require.cache[k];
  }
  return require("../../utils/travel.js");
}

/* ── 1. 用户显式选择优先 ── */
{
  for (const k of Object.keys(store)) delete store[k];
  installWx(24); // 系统调到最大
  let T = freshT();
  ok("未选择时跟随系统超大字号 → 3 级", T.fontScale() === 3, T.fontScale());
  T.setFontScale(1); // 用户显式选「标准」
  ok("用户显式选择覆盖系统字号", T.fontScale() === 1, T.fontScale());
  T = freshT();
  ok("重载后仍以用户选择为准（持久化生效）", T.fontScale() === 1, T.fontScale());
}

/* ── 2. 未选择时跟随系统字号 ── */
{
  for (const k of Object.keys(store)) delete store[k];
  installWx(18);
  ok("系统「大」字号 → 2 级", freshT().fontScale() === 2, "");
  for (const k of Object.keys(store)) delete store[k];
  installWx(20);
  ok("系统「超大」字号 → 3 级", freshT().fontScale() === 3, "");
  for (const k of Object.keys(store)) delete store[k];
  installWx(16);
  ok("系统默认字号 → 1 级", freshT().fontScale() === 1, "");
}

/* ── 3. 异常退化 ── */
{
  for (const k of Object.keys(store)) delete store[k];
  installWx(undefined);
  ok("fontSizeSetting 缺失 → 1 级且不抛错", (() => { try { return freshT().fontScale() === 1; } catch (e) { return false; } })());
  globalThis.wx = {
    getStorageSync: () => "",
    setStorageSync: () => { throw new Error("quota"); },
    getSystemInfoSync: () => { throw new Error("boom"); },
    showToast: () => {},
  };
  ok("系统接口抛错 → 仍返回 1 级", (() => { try { return freshT().fontScale() === 1; } catch (e) { return false; } })());
  delete globalThis.wx;
  ok("无 wx（Node 环境）→ 1 级", (() => { try { return freshT().fontScale() === 1; } catch (e) { return false; } })());
}

/* ── 4. 等级恒在合法区间 ── */
{
  for (let f = 10; f <= 30; f++) {
    for (const k of Object.keys(store)) delete store[k];
    installWx(f);
    const v = freshT().fontScale();
    ok("系统中任意字号(" + f + ")都落在 1~3", [1, 2, 3].indexOf(v) >= 0, v);
  }
}
delete globalThis.wx;

console.log("");
if (bad) { console.log("字号无障碍回归失败：" + bad + " 项"); process.exit(1); }
console.log("字号无障碍回归通过：" + n + " 项");
