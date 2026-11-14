// ai-context.js —— 全站「页面级 AI 上下文」组装（assistant 分包，主包零增长）
//
// 背景：v1.20.6 前，ai-entry 跳助手只带 topic + city，AI 到了助手页只知道「从哪页来、哪座城」，
//       不知道这一页此刻显示的真实数据 —— 在账本页问「我这趟花超了吗」和在首页问，得到的回答一样泛。
//
// 本模块把每个入口场景对应的**本机真实数据快照**组装成 grounding 文本：
//   · 只读 travel.js / data.js / store.js / corpus.js 的真实字段，取不到就整行省略，绝不估算、绝不补造；
//   · 结果限长，作为「本机上下文」注入 system（云函数 buildSystem 会带上），并标注「非实时」；
//   · 不落盘、不上传额外请求，经 globalData 在内存中传递，5 分钟后自动失效。
//
// 纯函数：不碰 wx.*、不碰网络，便于 Node 单测与网页端同源复用。

const T = require("../../utils/travel.js");
const D = require("../../utils/data.js");
const S = require("../../utils/store.js");
const C = require("../../utils/corpus.js");

const MAX_CHARS = 1200;

// 场景中文标签（与 ai-brain SCENARIOS 的 key 对齐；未知 topic 也能安全兜底）
const LABELS = {
  generate: "生成行程", food: "必吃美食", today: "今天安排", planOptimize: "行程体检",
  prep: "出行准备", spotsearch: "按标签找景点", deep: "深度玩法", ledger: "花费记账",
  "help-emergency": "旅途应急", lens: "拍照识景", travelsvc: "出行服务",
  toolkit: "旅行百宝箱", guide: "我的攻略", settings: "设置偏好", review: "行程复盘",
  spot: "景点讲解", map: "地图导览", help: "帮助与应急", plan: "我的行程"
};

function n(v) { return (typeof v === "number" && isFinite(v)) ? v : null; }
function str(v) { return v == null ? "" : String(v); }
function safe(fn, def) { try { const v = fn(); return v == null ? def : v; } catch (e) { return def; } }

// 只取随包真实店名 / 景点名，绝不生成名称。
function namesOf(city, kind, limit) {
  var out = [];
  try {
    if (kind === "food") {
      var arr = (D.FOOD_SPOTS && D.FOOD_SPOTS[city]) || [];
      for (var i = 0; i < arr.length && out.length < limit; i++) {
        if (arr[i] && arr[i].shop) out.push(arr[i].shop);
      }
    } else {
      var obj = (D.SPOT_COORDS && D.SPOT_COORDS[city]) || null;
      if (obj && typeof obj === "object") {
        var keys = Array.isArray(obj) ? [] : Object.keys(obj);
        for (var j = 0; j < keys.length && out.length < limit; j++) if (keys[j]) out.push(keys[j]);
        if (Array.isArray(obj)) {
          for (var k = 0; k < obj.length && out.length < limit; k++) {
            var it = obj[k];
            if (it && (it.name || it.n)) out.push(it.name || it.n);
          }
        }
      }
    }
  } catch (e) {}
  return out;
}

// 通用底座：所有场景都带，字段全部来自 plan 真实属性。
function baseLines(topic, city, plan) {
  var lines = ["【本机页面上下文 · 真实数据快照，非实时】"];
  lines.push("入口场景：" + (LABELS[topic] || str(topic) || "通用") + "。");
  if (city) lines.push("当前城市：" + city + "。");
  if (plan && Array.isArray(plan.days) && plan.days.length) {
    var seg = "当前行程：" + str(plan.cityName || "") + " " + plan.days.length + " 天";
    if (plan.depart) seg += "，出发日 " + str(plan.depart).slice(0, 10);
    if (n(plan.people)) seg += "，" + plan.people + " 人";
    if (plan.pace) seg += "，" + ({ leisure: "轻松", balance: "平衡", speed: "特种兵" }[plan.pace] || plan.pace) + "节奏";
    lines.push(seg + "。");
  } else {
    lines.push("当前没有已生成行程。");
  }
  return lines;
}

function topicLines(topic, city, plan) {
  var L = [];
  var add = function (s) { if (s) L.push(s); };
  var today = safe(function () { return T.todaySpent(); }, 0);
  var total = safe(function () { return T.totalSpent(); }, 0);
  var bg = safe(function () { return T.budgetGauge(plan); }, null);

  if (topic === "ledger" || topic === "today" || topic === "plan" || topic === "planOptimize") {
    if (total > 0) add("本机已记花费：今日 ¥" + Math.round(today) + " / 累计 ¥" + Math.round(total) + "。");
    if (bg && bg.txt) add("预算进度：" + bg.txt + (bg.over ? "（已超预算）" : "") + "。");
  }
  if (topic === "plan" || topic === "planOptimize") {
    var ck = safe(function () { return T.planCheckup(plan); }, null);
    if (ck && n(ck.score) != null) add("行程自检 " + ck.score + " 分" +
      (Array.isArray(ck.tips) && ck.tips.length ? "；建议：" + ck.tips.slice(0, 2).join("；") : "") + "。");
    var spots = 0;
    if (plan && Array.isArray(plan.days)) {
      for (var d = 0; d < plan.days.length; d++) {
        var items = (plan.days[d] && plan.days[d].items) || [];
        spots += items.length;
      }
    }
    if (spots) add("行程内共 " + spots + " 个安排点位。");
  }
  if (topic === "today") {
    var ts = safe(function () { return T.todayState(plan); }, null);
    if (ts && ts.phase) add("行程阶段：" + ({ before: "尚未出行", during: "行程进行中", after: "行程已结束" }[ts.phase] || ts.phase) +
      (n(ts.daysLeft) != null && ts.phase === "before" ? "（距出发 " + ts.daysLeft + " 天）" : "") + "。");
  }
  if (topic === "food" && city) {
    var arr = (D.FOOD_SPOTS && D.FOOD_SPOTS[city]) || [];
    if (arr.length) add("随包收录该城美食店 " + arr.length + " 家，例如：" + namesOf(city, "food", 3).join("、") + "。");
    var cb = safe(function () { return T.cityBrief(city); }, null);
    if (cb && Array.isArray(cb.foods) && cb.foods.length) add("该城代表吃法：" + cb.foods.slice(0, 4).join("、") + "。");
  }
  if ((topic === "spotsearch" || topic === "spot" || topic === "map") && city) {
    var ptNames = namesOf(city, "spot", 3);
    add("随包收录该城真实景点名样例：" + (ptNames.length ? ptNames.join("、") : "（该城暂无坐标条目）") + "。");
  }
  if (topic === "help-emergency" || topic === "help") {
    var cs = safe(function () { return C.corpusStats(); }, null);
    if (cs) add("本机应急数据：具名医院 " + cs.hospitals + " 家 / " + cs.hospitalCities + " 城，另有 " +
      cs.approxCities + " 城走地图搜索降级（不是医院）。");
  }
  if (topic === "prep" && city) {
    var cb2 = safe(function () { return T.cityBrief(city); }, null);
    if (cb2) add("该城气候：" + str(cb2.climateTxt || "") + "；最佳季节：" + str(cb2.best || "") + "。");
    var checked = safe(function () { return S.get("prepCheckedV1", null); }, null);
    if (checked && typeof checked === "object") add("行前清单已勾选项数：" + Object.keys(checked).length + "。");
  }
  if (topic === "deep" && city) {
    var cb3 = safe(function () { return T.cityBrief(city); }, null);
    if (cb3) add("该城速览：" + str(cb3.climateTxt || "") + "，" + str(cb3.best || "") + "。");
    var deep = (D.DEEP_PLAY && D.DEEP_PLAY[city]) || null;
    if (deep) add("随包收录该城深度玩法条目。");
  }
  if (topic === "lens" && city) {
    var ln = namesOf(city, "spot", 5);
    if (ln.length) add("该城随包真实景点名（仅供识景名称对齐，严禁套用）：" + ln.join("、") + "。");
  }
  if (topic === "review") {
    if (total > 0) add("本机已记累计花费 ¥" + Math.round(total) + "（复盘只能引用真实记录）。");
  }
  return L;
}

/**
 * 组装某入口场景的本机真实上下文。
 * @param {string} topic 场景 key（ai-brain SCENARIOS）
 * @param {object} opts  { city, plan }
 * @returns {string} ≤1200 字，全是本机真实字段；无数据时也只返回底座说明，不编造。
 */
function build(topic, opts) {
  opts = opts || {};
  var city = str(opts.city || "").trim();
  var plan = opts.plan || null;
  var t = str(topic || "").trim();
  var lines = baseLines(t, city, plan).concat(topicLines(t, city, plan));
  lines.push("以上均为本机真实数据；未列出的信息一律说「以 App 内对应页为准」，不得推测或编造。");
  return lines.join("\n").slice(0, MAX_CHARS);
}

// 供守卫 / 单测核对覆盖度：所有已知入口场景都必须能产出上下文。
function topics() { return Object.keys(LABELS); }

module.exports = {
  build: build,
  topics: topics,
  LABELS: LABELS,
  MAX_CHARS: MAX_CHARS
};
