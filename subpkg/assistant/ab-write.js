// subpkg/assistant/ab-write.js —— ai-brain 拆分模块②：写操作（生成行程 / 记账 / 想玩清单）
//
// 这些处理器会真实写数据（globalData 行程、本机账本、想玩清单），与只读查询分开，
// 便于审计「AI 到底能改什么」。成员为原文件逐字节搬运，未改任何实现。

const T = require("../../utils/travel.js");
const DATA = require("../../utils/data.js");
const CORE = require("./ab-core.js");
const act = CORE.act;
const localDate = CORE.localDate;

/* 生成行程：真正 buildPlan + 写 globalData，再切到行程页（对齐网页版 generatePlan） */
function generatePlan(cityName, days, opts) {
  opts = opts || {};
  let city = null;
  try { if (T.findCity) city = T.findCity(cityName); } catch (e) {}
  if (!city) return { ok: false, msg: "离线知识库里还没有「" + (cityName || "") + "」这座城市，换个已收录的城市（如成都、杭州、西安）试试。" };
  const n = Math.max(1, Math.min(14, parseInt(days, 10) || 3));
  const depart = opts.depart || localDate(new Date(Date.now() + 7 * 86400000));
  let daysArr = null;
  try {
    daysArr = T.buildPlan({
      city: city, days: n, depart: depart,
      budget: opts.budget || "mid", pace: opts.pace || "balance",
      travelMode: opts.travelMode || "", people: opts.people || 1,
      stayMountain: true, picks: opts.picks || [], pickOnly: !!opts.pickOnly, bias: opts.bias || ""
    });
  } catch (e) { return { ok: false, msg: "行程生成失败：" + ((e && e.message) || e) }; }
  if (!daysArr || !daysArr.length) return { ok: false, msg: "这座城市暂时排不出逐日行程，换座城市试试。" };
  const plan = {
    cityName: city.name, province: city.province || "", totalDays: daysArr.length,
    depart: depart, days: daysArr, budget: opts.budget || "mid", customAmt: 0,
    people: opts.people || 1, pace: opts.pace || "balance", travelMode: opts.travelMode || "",
    pickOnly: !!opts.pickOnly, isMulti: false, from: opts.from || { province: "", city: "" },
    savedAt: Date.now(), bias: opts.bias || ""
  };
  const g = (typeof getApp === "function") ? getApp() : null;
  try {
    if (g && typeof g.setPlan === "function") g.setPlan(plan);
    else if (g && g.globalData) g.globalData.plan = plan;
    else return { ok: false, msg: "当前运行环境拿不到 getApp()，行程无法保存。" };
  } catch (e) { return { ok: false, msg: "行程已算出但保存失败：" + ((e && e.message) || e) }; }
  return { ok: true, plan: plan };
}

/* ── 写操作（对齐网页版内置 AI）：一句话记账 / 把真实景点加入想玩 ──
 * 只写本机离线数据；景点名必须能在离线库里查到，绝不写没收录的名字（零伪造、不脏数据）。
 * 这两条要放在 NEW_INTENTS 最前：「记账」否则会被 ledger 的「花了多少」查询意图抢走。 */
function realSpotOf(name) {
  const nm = String(name || "").trim();
  if (nm.length < 2) return null;
  const coords = (DATA && DATA.SPOT_COORDS) || {};
  const cities = Object.keys(coords);
  // 精确优先，并带回景点真实所属城市（否则「西湖」会被记到上一轮聊的成都名下）
  for (let i = 0; i < cities.length; i++) {
    const arr = coords[cities[i]] || [];
    for (let j = 0; j < arr.length; j++) {
      const s = Array.isArray(arr[j]) ? arr[j][0] : (arr[j] && arr[j].name ? arr[j].name : arr[j]);
      if (typeof s === "string" && s === nm) return { name: s, city: cities[i] };
    }
  }
  if (DATA && DATA.SPOT_DETAILS && DATA.SPOT_DETAILS[nm]) return { name: nm, city: "" };
  return null;
}
function runQuickBill(text) {
  const m = text.match(/^(?:帮我|请|给我)?\s*(?:记一笔|记一下|记个账|记下|加一笔|记账)\s*(.+)$/);
  if (!m) return null;
  let b = null;
  try { b = T.parseQuickBill ? T.parseQuickBill(m[1]) : null; } catch (e) {}
  if (!b) return {
    text: "没从「" + m[1] + "」里识别出金额。写成「记一笔 打车 32」这种带数字的说法就行～",
    actions: [act("subpkg/ledger/ledger", "打开账本 →")], intent: "quickBill"
  };
  try {
    T.addLedger(b.amt, b.cat, b.name);
    return {
      text: "已记下 ¥" + b.amt + " · " + b.cat + " · " + b.name + "（写入本机账本；说「今天花了多少」可查，去账本页可删）。",
      actions: [act("subpkg/ledger/ledger", "打开账本核对 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
      intent: "quickBill"
    };
  } catch (e) {
    return { text: "写入账本失败：" + ((e && e.message) || e), actions: [act("subpkg/ledger/ledger", "打开账本 →")], intent: "quickBill" };
  }
}
function runAddWish(text, city, ctx) {
  const m = text.match(/(?:把|将)?\s*(.{2,24}?)\s*(?:加入|加到|放进|加进|添加进|添加到)\s*想玩/) ||
    text.match(/想玩(?:清单|列表|池)?\s*(?:里)?\s*(?:加|添加|加入)\s*(.{2,24})/);
  if (!m) return null;
  let raw = String(m[1] || "").trim();
  if (/第一个|刚才|上面|它|这个|那个/.test(raw)) return {
    text: "小程序端直接点景点行的「想玩」就好；也可以说完整的景点名，比如「把西湖加入想玩」。",
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "addWish"
  };
  raw = raw.replace(/^(?:把|将|这个|那个)\s*/, "").replace(/[，。！？!?,.]$/, "").trim();
  const real = realSpotOf(raw);
  if (!real) return {
    text: "离线景点库里没找到「" + raw + "」，我不把没收录的名字写进想玩清单。可以说得更准确些，或先问「成都有什么必去」再挑一个。",
    actions: [act("subpkg/spotsearch/spotsearch", "按标签找景点 →")], intent: "addWish"
  };
  const wishCity = real.city || (ctx && ctx.plan && ctx.plan.cityName) || city || "";
  let was = false;
  try { was = !!(T.isWished && T.isWished(real.name)); } catch (e) {}
  try { T.toggleWish(real.name, wishCity); }
  catch (e) { return { text: "写入想玩清单失败：" + ((e && e.message) || e), actions: [], intent: "addWish" }; }
  return {
    text: (was ? "已从想玩清单移除" : "已加入想玩清单") + "：" + real.name +
      (wishCity ? "（" + wishCity + "）" : "") + "。再说一次可" + (was ? "重新加入" : "取消") + "；生成行程时会优先排进去。",
    actions: [act("pages/index/index", "去生成攻略 →", {}, "tab"), act("subpkg/spotsearch/spotsearch", "按标签找景点 →")],
    intent: "addWish"
  };
}

module.exports = {
  generatePlan: generatePlan,
  realSpotOf: realSpotOf,
  runQuickBill: runQuickBill,
  runAddWish: runAddWish
};
