// 新功能 P0：行程体检 / 一键换景点 / AI 问答（本地规则版）—— 纯前端离线，追加到 travel.js
import fs from "fs";

const F = "tools/_src-backup/travel.js";
let s = fs.readFileSync(F, "utf8");

const block = `
/* ============ 新功能 P0（v1.19.13+） ============ */
// 行程体检：动线 / 节奏 / 重复 / 空日 / 预算 五维评分（0-100），并给可执行建议
function planCheckup(plan) {
  const out = { score: 100, items: [], tips: [] };
  try {
    const days = (plan && Array.isArray(plan.days) ? plan.days : []).map(d => (d && d.items ? d.items : []));
    if (!days.length) return { score: 0, items: [{ k: "empty", label: "行程为空", ok: false }], tips: ["先生成一份行程再体检"] };
    const haversine = (typeof P.haversine === "function") ? P.haversine : null;
    // 1) 动线：每天相邻真实景点的最大跨度
    let worstLeg = 0, worstDay = -1;
    days.forEach((its, di) => {
      const pts = its.map(it => ({ name: String(it.name || ""), per: it.period || "" }))
        .filter(x => x.name.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(x.name)
          && !/自由活动|自由探索|休整|早餐|晚餐|馆子|夜市|小吃|美食|散步|看演出|看音乐剧|看歌剧|看相声|看演艺/.test(x.name));
      for (let i = 0; i + 1 < pts.length; i++) {
        if (!haversine) break;
        const a = P.getSpotCoord(plan.cityName || pts[i].cityName || "", pts[i].name);
        const b = P.getSpotCoord(plan.cityName || pts[i + 1].cityName || "", pts[i + 1].name);
        if (a && b && a.lat && b.lat) {
          const km = haversine({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
          if (km > worstLeg) { worstLeg = km; worstDay = di + 1; }
        }
      }
    });
    const legOk = worstLeg <= 35;
    out.items.push({ k: "route", label: "动线跨度", ok: legOk, detail: worstLeg ? "最长单段约 " + Math.round(worstLeg) + "km" : "暂无法计算" });
    if (!legOk) out.tips.push("第 " + worstDay + " 天相邻景点跨度偏大，建议把远郊点集中成一天（或缩短当日动线）");
    // 2) 节奏：每天条目数 2-9 为佳
    const thin = days.filter((its, i) => its.length < 2);
    const heavy = days.filter((its, i) => its.length > 9);
    const paceOk = !thin.length && !heavy.length;
    out.items.push({ k: "pace", label: "每日节奏", ok: paceOk, detail: "平均每天 " + Math.round(days.reduce((a, d) => a + d.length, 0) / days.length) + " 项" });
    if (thin.length) out.tips.push("有 " + thin.length + " 天安排偏少，可补 1-2 个顺路景点");
    if (heavy.length) out.tips.push("有 " + heavy.length + " 天过于密集，建议拆出半天自由活动");
    // 3) 重复景点（跨天）
    const seen = new Map();
    days.forEach((its) => its.forEach(it => {
      const n = String(it.name || "").replace(/[「」（）()]/g, "");
      if (n.length >= 3 && !/^(抵达|退房|返程|出发前往|前往|入住|回酒店|凌晨出发|深度游览|继续)/.test(n)) {
        if (!seen.has(n)) seen.set(n, 0);
        seen.set(n, seen.get(n) + 1);
      }
    }));
    const dups = [...seen.entries()].filter(([k, v]) => v > 1);
    const dupOk = dups.length === 0;
    out.items.push({ k: "dup", label: "景点重复", ok: dupOk, detail: dupOk ? "无重复" : dups.map(([k, v]) => k + "×" + v).join("、") });
    if (!dupOk) out.tips.push("同一景点出现多次，可换一个同类替代");
    // 4) 空日
    const empty = days.filter(d => !d.length);
    out.items.push({ k: "empty", label: "空日", ok: !empty.length, detail: empty.length ? empty.length + " 天为空" : "无空日" });
    // 5) 预算
    let budgetOk = true, budgetTxt = "";
    try {
      const b = budgetStyleOf && budgetStyleOf(plan && plan.budget || "mid");
      budgetOk = !!b; budgetTxt = b || "";
    } catch (e) {}
    out.items.push({ k: "budget", label: "预算档位", ok: budgetOk, detail: budgetTxt || "未设置" });
    // 汇总
    const bad = out.items.filter(x => !x.ok).length;
    out.score = Math.max(0, 100 - bad * 18);
    if (out.score >= 90) out.tips.unshift("整体很顺，可以直接出发");
    else if (out.score >= 70) out.tips.unshift("行程不错，按上面建议微调会更顺");
    else out.tips.unshift("建议按建议调整后再出发");
  } catch (e) { out.score = 0; out.tips.push("体检异常：" + (e && e.message || "")); }
  return out;
}

// 一键换景点：找到与指定景点同标签、同城、坐标相近的替代景点名（返回名称数组，不落盘）
function swapSpotFor(plan, spotName, cityName) {
  const cn = cityName || (plan && plan.cityName) || "";
  const target = String(spotName || "").trim();
  if (!cn || !target) return [];
  try {
    const tags = spotTagOf(target, cn);
    const pool = poolOfCity(findCity(cn) || { name: cn });
    const used = new Set();
    (Array.isArray(plan && plan.days) ? plan.days : []).forEach(d => (d.items || []).forEach(it => used.add(String(it.name || ""))));
    const out = [];
    for (const n of pool) {
      if (!n || n === target || used.has(n)) continue;
      const t2 = spotTagOf(n, cn);
      const shared = tags.some(t => t2.indexOf(t) >= 0) || t2.some(t => tags.indexOf(t) >= 0);
      if (!shared) continue;
      out.push({ name: n, tags: t2, note: "同类替代 · " + t2.slice(0, 2).join(" / ") });
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) { return []; }
}

// AI 行程问答（本地规则版）：识别常见意图并给出可执行答复；未识别返回 null
function askTrip(plan, question) {
  const q = String(question || "").trim();
  if (!q) return null;
  try {
    const days = Array.isArray(plan && plan.days) ? plan.days : [];
    // 改 N 天
    let m = q.match(/(改|换成|变成)\s*([1-9][0-9]?)\s*天/);
    if (m) return { ok: true, txt: "可以把行程改成 " + m[2] + " 天。在首页调整天数重新生成即可，当前行程 " + days.length + " 天。" };
    // 第 N 天
    m = q.match(/第\s*([1-9][0-9]?)\s*天/);
    if (m) {
      const di = Math.min(parseInt(m[1], 10), days.length) - 1;
      const d = days[di];
      const its = d && d.items ? d.items.map(x => x.name).join(" → ") : "（无安排）";
      return { ok: true, txt: "第 " + (di + 1) + " 天：" + (d && d.cityName ? "在" + d.cityName + "，" : "") + its };
    }
    // 下雨
    if (/下雨|雨天|天气不好|改室内/.test(q)) {
      const indoor = (days[0] && days[0].items ? days[0].items : []).filter(x => /博物馆|美术馆|展览|科技馆|馆|商场|书店/.test(x.name));
      return { ok: true, txt: indoor.length ? "雨天推荐室内：今天已有 " + indoor[0].name + "。需要的话可以在景点卡上用「一键换景点」换成室内同类。" : "雨天建议换成博物馆/美术馆/商场这类室内点，用「一键换景点」即可。" };
    }
    // 换景点
    if (/换|替代|替换/.test(q)) {
      const cn = plan.cityName || "";
      const first = days[0] && days[0].items ? days[0].items.find(x => x.name.length >= 3 && !/^(抵达|入住|退房|返程|出发|前往)/.test(x.name)) : null;
      if (first) {
        const alts = swapSpotFor(plan, first.name, cn);
        return { ok: true, txt: alts.length ? "「" + first.name + "」可换：" + alts.map(a => a.name).slice(0, 3).join("、") : "暂没找到合适的同类替代" };
      }
    }
    // 预算
    if (/预算|钱|花费/.test(q)) {
      const b = budgetStyleOf && budgetStyleOf(plan && plan.budget || "mid");
      return { ok: true, txt: "当前预算档位：" + (b || "未设置") + "。可回首页切换经济/舒适/高端或自定义总预算重新生成。" };
    }
    // 吃什么
    if (/吃|美食|餐厅/.test(q)) {
      const cn = plan.cityName || "";
      const fs = foodSpotsFor(cn);
      return { ok: true, txt: fs && fs.length ? cn + " 推荐：" + fs.slice(0, 3).map(x => x.shop).join("、") : "「美食」页有该地小吃推荐，去看看。" };
    }
    return null;
  } catch (e) { return null; }
}
`;

const anchor = "module.exports = {";
const n = s.split(anchor).length - 1;
if (n !== 1) { console.log("✗ anchor 命中 " + n); process.exit(1); }
s = s.replace(anchor, block + "\n" + anchor);

// 导出：在 module.exports 的 ready, 后追加
const expFrom = "module.exports = {\n ready,";
const expTo = "module.exports = {\n ready, planCheckup, swapSpotFor, askTrip,";
const n2 = s.split(expFrom).length - 1;
if (n2 !== 1) { console.log("✗ exports 命中 " + n2); process.exit(1); }
s = s.replace(expFrom, expTo);
fs.writeFileSync(F, s, "utf8");
console.log("✓ P0 三件套已写入并导出");
