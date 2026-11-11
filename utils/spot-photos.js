// utils/spot-photos.js —— 真实景点照片映射（由 tools/photos/build-map.mjs 生成，勿手改）
//
// 图源：Wikimedia Commons，仅收录 CC0 / CC BY / CC BY-SA / Public Domain 许可图片。
// 版权信息（credit / license / 来源页）随条目保存，展示端必须显示署名。
//
// 为什么用 cloud:// fileID 而不是 https 外链：
//   · 小程序 <image> 外链域名须加入「downloadFile 合法域名」白名单，且域名需 ICP 备案；
//     境外图源（upload.wikimedia.org 等）无法备案 → 直接外链不可行。
//   · 图片随包会撑爆主包（当前 1528KB / 1536KB 代码质量线，仅余 8KB）。
//   · 微信云开发存储的 cloud:// fileID 由 <image> 原生解析，域名自动白名单，
//     无需服务器、无需备案、不占包体。
//
// ⚠️ ENABLED 开关：默认 false。必须先完成「抓图 → 上传云存储 → build-map 生成映射」，
//    再在真机确认图片能显示，才把 ENABLED 改为 true。false 时一律走原有渐变示意图，零回归。
//    云开发未开通 / 图片被删时，渲染层还有 binderror 兜底回退示意图。

const ENABLED = false;

// 键： "景点名|城市" 或 "景点名"；值： { f: cloud fileID, credit, license, src }
const PHOTOS = {
  // 由 build-map.mjs 填充
};

function enabled() { return ENABLED; }

function photoOf(name, city) {
  if (!ENABLED) return null;
  try {
    const n = String(name || "").trim();
    const c = String(city || "").trim();
    if (!n) return null;
    const p = PHOTOS[n + "|" + c] || PHOTOS[n] || null;
    if (!p || !p.f) return null;
    return { fileID: p.f, credit: p.credit || "", license: p.license || "", src: p.src || "" };
  } catch (e) { return null; }
}

module.exports = { enabled, photoOf, PHOTOS };
