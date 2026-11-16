// pages/index/index-ctx.js —— 首页共享上下文（从 index.js 头部原样搬出，T4）
//
// 为什么单独一个文件：拆分后 index.js 与 m-generate / m-config / m-form / m-tile
// 都要用同一批句柄与两个纯函数。这里只放「无状态、可重复 require」的东西；
// 带可变状态的（比如分包懒加载模块）不能放这里，否则各模块会各自持有一份。
const { getAppSafe } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一存储封装（失败有提示，不再静默丢数据）
const R = require("../../utils/recommend.js");   // 智能推荐引擎（端侧计算，纯本地，不联网）

// v1.19.100 修复：模块顶层 `getApp()` 在 lazyCodeLoading 下可能返回 undefined（App 尚未注册完），
// 会导致 onLoad 整段初始化被抛错跳过、且本页 10 处 handler（goPlan / generate / 回填 等）访问
// app.globalData / app.setPlan 崩 → 首页大批按键集体失灵（表现：页面渲染但点了没反应）。
// 改为惰性代理：每次访问属性才实时取 getApp()，onLoad / 各 handler 运行时 App 一定已就绪；
// 模块求值期即使为 undefined 也不抛错（get 返回 undefined，由现有 `&&` 短路或 try/catch 兜底）。
const app = getAppSafe();

const PACE_TXT = ["轻松", "平衡", "特种兵"];
const MODE_TXT = ["不指定", "亲子", "情侣", "独行", "老人"];

// v1.20.8（T2）：日期格式化收敛到 store.js 单点（页面不再手写 padStart）
function iso(t) { return S.fmtLocalDate(t); }

// v1.19.197：「最近玩过」按城市唯一。历史 storage 里可能已存在同城多条
// （旧 pushRecent 把 days/depart 也纳入去重键），而首页 recents 用
// wx:key="city" 渲染，重复 city 会触发微信「Do not set same key」告警。
function _uniqRecent(list) {
  const seen = Object.create(null), out = [];
  for (const r of (Array.isArray(list) ? list : [])) {
    const k = r && String(r.city || "");
    if (!k || seen[k]) continue;
    seen[k] = 1; out.push(r);
  }
  return out;
}

module.exports = { app, AN, T, S, R, PACE_TXT, MODE_TXT, iso, _uniqRecent };
