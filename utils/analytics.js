/**
 * utils/analytics.js —— 轻量使用统计（本地计数 + 尽力上报）
 *
 * 为什么需要：所有优化优先级此前都是"从代码结构 + 问卷反馈推的"，没有一条来自真实使用数据。
 * 砍功能、补数据这类决策，没数据就是猜。
 *
 * 设计要点：
 *   1. **本地计数为主**：数据存在本机 storage（miniStatsV1），不依赖后台配置，立刻可用、可自查。
 *   2. **上报为辅**：同时尽力调 wx.reportAnalytics，后台若配了「自定义分析」事件就能收；
 *      未配也不报错（小程序对未定义事件是静默忽略）。
 *   3. **隐私**：只记事件名与计数/枚举值，绝不记录任何自由文本、金额、位置、城市名之外的内容。
 *      与「数据只存本机」的产品承诺一致。
 *   4. **不可失败**：任何异常都必须吞掉——埋点把主流程搞挂是最典型的低级事故。
 */

const S = require("./store.js");   // v1.20.4 #81：统一存储出口
const KEY = "miniStatsV1";

function _read() {
  try {
    const o = S.getJSON(KEY, null);
    if (!o || typeof o !== "object" || !o.ev) return { v: 1, ev: {}, since: Date.now() };
    return o;
  } catch (e) {
    return { v: 1, ev: {}, since: Date.now() };
  }
}

function _write(o) {
  S.setJSON(KEY, o);   // 写失败（如存储满）由 store 内部吞掉，绝不抛给调用方
}

/**
 * 记一次事件
 * @param {string} name 事件名，建议 snake_case，如 plan_generate
 * @param {object} data 可选，仅允许字符串/数字/布尔（会被拼成 key 后缀做计数维度）
 */
function track(name, data) {
  try {
    if (!name) return;
    let suffix = "";
    if (data && typeof data === "object") {
      const keys = Object.keys(data).sort().slice(0, 3);   // 维度最多 3 个，防维度爆炸
      suffix = keys.map((k) => {
        const v = data[k];
        const sv = (typeof v === "string" || typeof v === "number" || typeof v === "boolean") ? String(v) : "";
        return sv ? k + "=" + sv.slice(0, 16) : "";        // 截断，绝不落长文本
      }).filter(Boolean).join(",");
    }
    const full = suffix ? name + "|" + suffix : name;

    const o = _read();
    const rec = o.ev[full] || { n: 0, first: Date.now() };
    rec.n += 1;
    rec.last = Date.now();
    o.ev[full] = rec;
    o.lastAt = Date.now();
    _write(o);

    // 尽力上报（后台未配置事件时静默忽略；不要让它抛错影响主流程）
    try {
      if (typeof wx.reportAnalytics === "function") {
        wx.reportAnalytics(name, data && typeof data === "object" ? data : {});
      }
    } catch (e) {}
  } catch (e) {}
}

/** 页面到达 */
function pageView(p) { track("page_view", { p: p || "unknown" }); }

/** 读取快照（供「更多」页展示或调试） */
function snapshot() {
  try {
    const o = _read();
    const rows = Object.keys(o.ev).map((k) => ({
      k,
      n: o.ev[k].n,
      last: o.ev[k].last || 0,
    }));
    rows.sort((a, b) => b.n - a.n);
    return { since: o.since || 0, total: rows.reduce((s, r) => s + r.n, 0), rows };
  } catch (e) {
    return { since: 0, total: 0, rows: [] };
  }
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) {}
}

module.exports = { track, pageView, snapshot, reset };
