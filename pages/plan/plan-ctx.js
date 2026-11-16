// pages/plan/plan-ctx.js —— 行程页的共享上下文（从 plan.js 头部原样搬出，T4）
//
// 为什么单独一个文件：拆分后 plan.js 与 p-render / p-edit / p-svc / p-share / p-note
// 都需要同一批 tools 句柄与纯函数。分散在 6 个文件里各 require 一遍不会出错，但
// 「懒加载的分包模块（remind / plan-poster）」这类可变状态必须只有一份，
// 否则会出现「A 模块加载好了、B 模块看到的还是 null」这种极难查的 bug。
//
// R / PP 用 getter 暴露：它们是 let 且会被 _preloadSubMods 后续赋值，
// 用普通属性导出会在 require 那一刻就固化成 null。
const { getAppSafe } = require("../../utils/app.js");
const S = require("../../utils/store.js");   // v1.20.4 #81：统一存储出口
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
const T = require("../../utils/travel.js");
const W = require("../../utils/weather.js");
const A = require("../../utils/aicontent.js");
const EL = require("../../utils/errlog.js");        // v1.19.199：分享图失败分阶段留痕（真机可回溯）
const Cloud = require("../../utils/cloud.js");      // 云端 AI（llmProxy 强模型网关，fail-closed）
const AIAgent = require("../../utils/ai-agent.js");

// v1.20.3：remind / plan-poster 仅在特定用户操作（设提醒 / 生成分享图）才用到，
// 已从主包迁到分包 subpkg/utils，按需异步加载 —— 主包瘦身绕开微信「代码质量」1.5M 软线。
// 微信端走静态字面量 require.async；Node（allcheck / 单测）无 require.async，回退同步 require，保证回归照常。
let R = null, PP = null;
function _preloadSubMods() {
  if (typeof require.async === "function") {
    require.async("../../subpkg/utils/remind.js").then((m) => { R = m; }).catch(() => {});
    require.async("../../subpkg/utils/plan-poster.js").then((m) => { PP = m; }).catch(() => {});
  } else {
    try { R = require("../../subpkg/utils/remind.js"); } catch (e) {}
    try { PP = require("../../subpkg/utils/plan-poster.js"); } catch (e) {}
  }
}

// v1.19.100：模块顶层 getApp() 在 lazyCodeLoading 下可能返回 undefined，改用惰性代理。
const app = getAppSafe();

function isFrame(n) { return T.isFrameName(n); }
// v1.20.8→v1.20.9：路线缩略图（零网络 / 零域名白名单 / 全量覆盖）
// 收口到 utils/travel.js 的 spotCover()：稳定渐变 + 分类图标 + 名称，真图 it.img 优先。
// 无真图时由渲染层标注「示意图」，杜绝伪装成实拍。
function thumbFor(name, img, city) {
  const cv = T.spotCover(city || "", name, img);
  return {
    thumbBg: cv.bg,
    thumbEmoji: cv.glyph,
    img: cv.img || "",            // 数据自带真图 / CC 图映射的 cloud:// fileID
    photoCredit: cv.photoCredit || "",
    photoLicense: cv.photoLicense || "",
    coverLabel: cv.label,
    coverBadge: cv.badge,
    coverCat: cv.cat
  };
}
const MODE_LABEL = { family: "亲子游", couple: "情侣游", solo: "独行", elder: "带老人" };
function getSeason(month) {
  if (month >= 3 && month <= 5) return { name: "春", emoji: "" };
  if (month >= 6 && month <= 8) return { name: "夏", emoji: "" };
  if (month >= 9 && month <= 11) return { name: "秋", emoji: "" };
  return { name: "冬", emoji: "" };
}
// v1.8.5 C5：本地今日 YMD（对比天卡 date 用）
function ymdLocal() {
  // v1.20.8（T2）：日期拼接统一走 S.fmtLocalDate，页面不再手写 padStart（口径见 store.js）
  return S.fmtLocalDate(new Date());
}

module.exports = {
  app, AN, T, S, A, W, EL, Cloud, AIAgent,
  isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal,
  _preloadSubMods,
  get R() { return R; },
  get PP() { return PP; }
};
