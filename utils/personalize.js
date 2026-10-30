// utils/personalize.js —— 个性化目的地推荐（数据驱动的「AI」层）
//
// 思路：把「本机数据洞察」得到的真实用户画像，转成底层推荐引擎的专属查询，
// 再叠加一层「来自你自己的数据」的加分与理由。整套不联网、不上传，
// 结论可追溯（每条都带 whyMe 理由），直接回应「个性推荐未真正用上用户数据」的短板。
//
// 注意：本文件只做「编排 + 个性化加成」，复杂的相关度打分全部复用 recommend.js，
// 不重复造轮子，也不改动 recommend 的既有断言。
const R = require("./recommend.js");
const T = require("./travel.js");
const INS = require("./insights.js");

// 把真实画像映射成推荐查询词（让底层引擎跑「用户专属」候选集）
function queryFromTendency(td) {
  const w = [];
  if (td.favProv) w.push(td.favProv);
  if (td.season === "春") w.push("3月 4月 5月 踏青");
  else if (td.season === "夏") w.push("6月 7月 8月 避暑");
  else if (td.season === "秋") w.push("9月 10月 11月 赏秋");
  else if (td.season === "冬") w.push("12月 1月 2月 冰雪 温泉");
  // 花费大头 → 兴趣词（餐饮/购物/门票…）
  const catMap = {
    "餐饮": "美食", "购物": "购物 商场", "门票": "热门景点",
    "住宿": "度假", "交通": "都市游", "娱乐": "夜生活"
  };
  if (td.topCat && catMap[td.topCat]) w.push(catMap[td.topCat]);
  return w.join(" ");
}

// 个性化加分（独立于底层引擎，只认用户真实数据）
function _bonus(city, td) {
  let b = 0; const why = [];
  if (td.favProv && city.province === td.favProv) { b += 1.5; why.push("同你常去的" + td.favProv); }
  if (T.isVisited && T.isVisited(city.name)) why.push("你打卡过，可二刷");
  // v1.19.139：想去清单加权——用户在首页/行程页勾过的想玩城市，额外加分并给理由
  const wish = (T.getWish && T.getWish()) || [];
  if (wish.some(w => w && w.name === city.name)) { b += 1.2; why.push("就在你的想去清单里"); }
  return { b, why };
}

// 主入口：返回 N 个「为你推荐」的目的地，每条带 whyMe 理由
function personalized(n) {
  n = Math.max(1, Math.min(20, parseInt(n, 10) || 5));
  const ins = INS.insights();
  const td = (ins && ins.tendency) || {};
  if (!ins || ins.noData) return { list: [], fromMe: false, pending: false, tendency: td, summary: ins ? ins.summary : "" };
  const q = queryFromTendency(td);
  const base = R.recommend(q, { topN: n * 2, minScore: 0 });
  if (!base || base.pending) return { list: [], fromMe: false, pending: !!base && base.pending, tendency: td, summary: ins.summary };
  if (!base.list || !base.list.length) return { list: [], fromMe: false, pending: false, tendency: td, summary: ins.summary };
  const cities = (T.D && T.D.CITIES) || [];
  const scored = base.list.map((r) => {
    const city = cities.filter((c) => c && c.name === r.name)[0] || {};
    const bo = _bonus(city, td);
    const total = (r.score || 0) + bo.b;
    const why = bo.why.slice();
    if (td.topCat) why.push("贴合你偏好的" + td.topCat);
    return Object.assign({}, r, { _bonus: bo.b, whyMe: why, whyMeTx: why.join(" · "), total: total });
  }).sort((a, b) => (b.total - a.total) || ((b._raw || 0) - (a._raw || 0)) || a.name.localeCompare(b.name))
    .slice(0, n);
  return { list: scored, fromMe: true, pending: false, tendency: td, summary: ins.summary };
}

module.exports = { personalized, queryFromTendency };
