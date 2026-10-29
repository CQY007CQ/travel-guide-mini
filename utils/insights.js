// utils/insights.js —— 本机旅行数据洞察（离线 / 隐私优先）
//
// 全部从本机真实记录（记账 / 存档行程 / 足迹）聚合得出：不联网、不上传、不造数。
// 这是 product 内最贴近「大数据 / 智能分析」的实质模块 —— 结论来自用户自己的行为数据，
// 而非静态模板。所有函数纯计算、可被 check-insights 单测覆盖。
const T = require("./travel.js");

function _num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// 1) 记账按分类聚合（金额 + 占比）
function spendByCategory() {
  const list = (T.getLedger && T.getLedger()) || [];
  const m = {};
  list.forEach(e => {
    const cat = (e && e.cat) || "其他";
    m[cat] = (m[cat] || 0) + _num(e.amt);
  });
  const total = Object.keys(m).reduce((s, k) => s + m[k], 0);
  const rows = Object.keys(m)
    .map(k => ({ cat: k, amt: Math.round(m[k]), pct: total ? Math.round(m[k] / total * 100) : 0 }))
    .sort((a, b) => b.amt - a.amt);
  return { total: Math.round(total), rows };
}

// 2) 月度花费趋势（按账本日期聚合，pct 相对峰值）
function monthlySpend() {
  const list = (T.getLedger && T.getLedger()) || [];
  const m = {};
  list.forEach(e => {
    const d = (e && e.date) || "";
    const ym = /^(\d{4})-(\d{2})/.exec(String(d));
    if (!ym) return;
    const key = ym[1] + "-" + ym[2];
    m[key] = (m[key] || 0) + _num(e.amt);
  });
  const keys = Object.keys(m).sort();
  const max = keys.reduce((mx, k) => Math.max(mx, m[k]), 0);
  const rows = keys.map(k => ({
    ym: k, amt: Math.round(m[k]), pct: max ? Math.round(m[k] / max * 100) : 0
  }));
  return { max: Math.round(max), rows };
}

// 3) 出行节奏 + 季节偏好（来自存档行程的 depart 月）
function travelRhythm() {
  const plans = (T.listSavedPlans && T.listSavedPlans()) || [];
  const daysArr = plans.map(p => (p && Array.isArray(p.days) ? p.days.length : 0)).filter(Boolean);
  const tripN = daysArr.length;
  const totalDays = daysArr.reduce((s, n) => s + n, 0);
  const avgDays = tripN ? Math.round(totalDays / tripN * 10) / 10 : 0;
  const seasons = { 春: 0, 夏: 0, 秋: 0, 冬: 0 };
  plans.forEach(p => {
    const d = (p && (p.depart || (p.days && p.days[0] && p.days[0].date))) || "";
    const mo = /^(\d{4})-(\d{2})/.exec(String(d));
    if (!mo) return;
    const m = parseInt(mo[2], 10);
    const s = (m >= 3 && m <= 5) ? "春" : (m >= 6 && m <= 8) ? "夏" : (m >= 9 && m <= 11) ? "秋" : "冬";
    seasons[s]++;
  });
  let season = "", seasonN = 0;
  Object.keys(seasons).forEach(k => { if (seasons[k] > seasonN) { seasonN = seasons[k]; season = k; } });
  return { tripN, avgDays, totalDays, season: seasonN ? season : "", seasonN };
}

// 4) 足迹省份分布（复用 footHeatmap 的省份聚合，不碰未导出内部）
function footProvinces() {
  const h = (T.footHeatmap && T.footHeatmap()) || {};
  const provs = Array.isArray(h.provs) ? h.provs : [];
  const rows = provs
    .map(p => ({ prov: p.name, n: p.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  return { cities: h.cities || 0, rows };
}

// 5) 汇总：派生「个性化倾向」+ 一句话智能小结（纯数据驱动，无虚构）
function insights() {
  const spend = spendByCategory();
  const month = monthlySpend();
  const rhythm = travelRhythm();
  const fp = footProvinces();
  const noData = spend.total === 0 && rhythm.tripN === 0 && fp.cities === 0;
  const topCat = spend.rows[0] ? spend.rows[0].cat : "";
  const favProv = fp.rows[0] ? fp.rows[0].prov : "";
  const tendency = {
    topCat, topCatPct: spend.rows[0] ? spend.rows[0].pct : 0,
    avgDaily: (spend.total && rhythm.totalDays) ? Math.round(spend.total / rhythm.totalDays) : 0,
    favProv, season: rhythm.season
  };
  let summary = "还没有积累足够的本地数据，多用几次记账、打卡和存档，这里会给出你的旅行画像。";
  if (!noData) {
    const parts = [];
    if (favProv) parts.push("最常去" + favProv);
    if (rhythm.season) parts.push(rhythm.season + "季出行最多");
    if (topCat) parts.push("花费大头是" + topCat);
    if (rhythm.avgDays) parts.push("平均一趟" + rhythm.avgDays + "天");
    summary = parts.length ? ("你" + parts.join("、") + "。") : "已积累一些本地记录，继续用会更准。";
  }
  return { noData, spend, month, rhythm, fp, tendency, summary };
}

module.exports = { spendByCategory, monthlySpend, travelRhythm, footProvinces, insights };
