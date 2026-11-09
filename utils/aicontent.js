// 「城市深度玩法」内容 holder —— 内容随 subai 分包下发，主包不携带
//
// 设计上与 utils/data.js 同构：主包只放 holder，真正的文本在 subai/data/ai-deep.js。
// 微信端用分包异步化加载（require.async），Node 端（allcheck / 单测）同步 require。
//
// ⚠️ 微信硬约束：require.async() 的实参必须是「静态字符串字面量」，不能是变量。
//    传变量会导致微信在编译期解析不到目标分包 → 内容块永远加载不到 → 页面空白。
//    （这条是 v1.19.6x 首页白屏事故的根因，别再退化成变量。）
//
// 加载失败是「允许」的：深度内容是增强项，不是行程本身。
// 失败时 deepOf() 一律返回 null，调用方自然隐藏对应 UI，绝不报错、绝不阻塞主流程。

const S = {
  ready: false,
  err: false,
  data: null
};

function applyMod(m) {
  const d = (m && m.default) || m;
  if (!d || !d.cities || typeof d.cities !== "object") return;
  // 多内容文件合并：ai-deep.js（基线 28 城）+ ai-deep-extra.js（扩 72 城）。
  // 同名城市后者覆盖前者（扩展文件优先），其余累加。
  if (!S.data) S.data = { v: d.v, updated: d.updated, cities: {} };
  for (const k in d.cities) {
    if (d.cities[k] && typeof d.cities[k] === "object") S.data.cities[k] = d.cities[k];
  }
  if (d.updated) S.data.updated = d.updated;
  S.ready = true;
}

let _p = null;

/** 触发加载（幂等）。返回 Promise，内容是增强项，失败不抛错。 */
function initDeep() {
  if (_p) return _p;
  _p = (async () => {
    if (typeof require.async === "function") {
      try {
        // 静态字面量（微信编译期必须静态，否则分包内容加载不到 → 白屏）
        const [m1, m2] = await Promise.all([
          require.async("../subai/data/ai-deep.js"),
          require.async("../subai/data/ai-deep-extra.js")
        ]);
        applyMod(m1);
        applyMod(m2);
      } catch (e) {
        S.err = true;
        if (typeof console !== "undefined" && console.warn) console.warn("[aicontent] 深度内容加载失败:", e && e.message);
      }
    } else {
      // Node / 测试端：同步读（此处不受微信「静态字面量」约束，但同样写成字面量保持一致）
      try {
        applyMod(require("../subai/data/ai-deep.js"));
        applyMod(require("../subai/data/ai-deep-extra.js"));
      } catch (e) {
        S.err = true;
      }
    }
    return S;
  })();
  return _p;
}

/** 该城市是否有深度内容 */
function hasDeep(city) {
  const n = String(city || "").trim();
  return !!(n && S.data && S.data.cities && S.data.cities[n]);
}

/** 取该城市的深度内容（无则 null） */
function deepOf(city) {
  const n = String(city || "").trim();
  if (!n || !S.data || !S.data.cities) return null;
  return S.data.cities[n] || null;
}

/** 已收录深度内容的城市名列表 */
function deepCities() {
  if (!S.data || !S.data.cities) return [];
  return Object.keys(S.data.cities);
}

/** 内容版本号（展示用，如 "2026-10"） */
function updatedAt() {
  return (S.data && S.data.updated) || "";
}

module.exports = {
  initDeep,
  hasDeep,
  deepOf,
  deepCities,
  updatedAt,
  state: S
};
