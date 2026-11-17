// subpkg/assistant/ab-core.js —— ai-brain 拆分模块①：共享依赖 / action 构造 / 命中计数 / 通用小工具
//
// 拆分缘由：ai-brain.js 曾达 784 行，离「单文件 800 行」硬线只剩 16 行（check-health 第 ⑦ 层棘轮）。
// 依赖方向严格单向：ab-core → ab-write → ab-runs → ai-brain.js，无循环 require。
// 成员为原文件逐字节搬运，未改任何实现。

const S = require("../../utils/store.js");               // 多轮会话/日期格式化单点

/* 与 ai-intent 同款 action 构造器（assistant.onAction 消费 path/query/mode） */
function act(path, label, query, mode) { return { label: label, path: path, query: query || {}, mode: mode || "push" }; }

/* ───────── 离线命中可观测（对齐 C16 旅客服务中心「AI 接通状态」思路，但零依赖云） ─────────
 * 计数离线引擎真正解答的次数，让离线 AI 的价值可被看见（无需强模型上线也能体现）。 */
let _hits = 0;
const _hitBy = Object.create(null);
function _bump(k) { _hits++; if (k) _hitBy[k] = (_hitBy[k] || 0) + 1; }
function offlineStats() { return { hits: _hits, byIntent: Object.assign({}, _hitBy) }; }

/* 本地日期 yyyy-mm-dd（v1.20.8 T2：收敛到 store.js 单点） */
function localDate(d) { return S.fmtLocalDate(d); }

/* 天数解析：中文数字 / 阿拉伯数字 + 天/日/晚，夹在 1~14 */
const NUM_CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function numOf(s) { return /^\d+$/.test(s) ? parseInt(s, 10) : (NUM_CN[s] || 0); }
function parseDays(text) {
  const m = String(text || "").match(/(\d+|[一二三四五六七八九十两])\s*(?:天|日|晚)/);
  if (!m) return 0;
  const n = numOf(m[1]);
  return n ? Math.max(1, Math.min(14, n)) : 0;
}

/* 页面 → 路由 + 是否 tab */
const PAGE_ROUTE = {
  index: { p: "pages/index/index", tab: true },
  today: { p: "pages/today/today", tab: true },
  plan: { p: "pages/plan/plan", tab: true },
  more: { p: "pages/more/more", tab: true },
  food: { p: "subpkg/food/food", tab: false },
  prep: { p: "subpkg/prep/prep", tab: false },
  spotsearch: { p: "subpkg/spotsearch/spotsearch", tab: false },
  deep: { p: "subai/deep/deep", tab: false },
  ledger: { p: "subpkg/ledger/ledger", tab: false },
  help: { p: "pages/help/help", tab: false },
  lens: { p: "subpkg/lens/lens", tab: false },
  travelsvc: { p: "subpkg/travelsvc/travelsvc", tab: false },
  toolkit: { p: "subpkg/toolkit/toolkit", tab: false },
  myguides: { p: "pages/myguides/myguides", tab: false },
  // 「行程复盘 / 游记」场景在助手页内完成（review），须登记路由，否则直达按钮会错误回落到首页
  assistant: { p: "subpkg/assistant/assistant", tab: false }
};
function routeOf(page) { return PAGE_ROUTE[page] || { p: "pages/index/index", tab: true }; }

module.exports = {
  act: act,
  _bump: _bump,
  offlineStats: offlineStats,
  localDate: localDate,
  numOf: numOf,
  parseDays: parseDays,
  PAGE_ROUTE: PAGE_ROUTE,
  routeOf: routeOf
};
