/* 排行数据层（本地实现）
 *
 * ── 为什么是「本地」而不是云端 ──
 * 真正的「用户排名」必须有一份所有用户共享的榜单，那是云端的活。
 * 但本次接入云服务时用户关闭了确认弹窗（这是正常结果，不是错误），
 * 于是这里做的是**本地版排行榜**：排名只在**本机的多份存档之间**产生 ——
 * 用户可以把「这台手机上记录过的不同旅行者档案」放在一起比较，
 * 数据全部来自各自真实记账/打卡记录，**不生成任何虚构对手**。
 *
 * 一旦云服务开通，本文件只需把 `loadRanks()` 换成一次云查询，
 * 其余（指标计算、名次并列规则、名次高亮、分享）全部不用改 ——
 * 所以接口按「远端榜」形状设计，不是死写本地循环。
 *
 * ── 铁律 ──
 * ① 所有指标从真实记录算出（footStats / getLedger / listSavedPlans / getNotes）。
 *    没有任何「示例用户」「模拟对手」—— 榜单只有真实档案才进得去。
 * ② 档案可由用户自己新增（换人时用），每人一份，互相独立。
 * ③ 隐私：不写任何手机号/身份标识；档案名只存本地，且默认是「旅行者 1」这类中性名。
 */
const T = require("./travel.js");
const S = require("./store.js");

const ARCH_KEY = "miniRankProfilesV1";   // 档案列表（多人档案）
const ME_KEY = "miniRankProfileV1";      // 当前选中的档案 id
const VER_KEY = "miniRankSchemaV1";      // 榜单口径版本（指标集变了要 bump）

/* ── 榜单口径 ──
 * 每项都对应本小程序里**已经存在**的数据，不额外要求用户填任何东西。
 * 权重刻意让「走过的路」占大头：这是旅行应用，不是记账应用。 */
const METRICS = [
  { k: "score",   n: "旅行积分", u: "分",  d: "按打卡城市、景点、行程与笔记综合计算", get: (m) => m.score },
  { k: "cities",  n: "打卡城市", u: "座",  d: "记录里出现过的不同城市",           get: (m) => m.cities },
  { k: "spots",   n: "打卡景点", u: "个",  d: "足迹里记录过的不同景点",           get: (m) => m.spots },
  { k: "plans",   n: "规划行程", u: "份",  d: "保存过的行程方案数",               get: (m) => m.plans },
  { k: "notes",   n: "旅行笔记", u: "篇",  d: "写下的笔记与城市备注",             get: (m) => m.notes },
  { k: "spent",   n: "旅行支出", u: "元",  d: "记账里累计的花费",               get: (m) => m.spent },
];
const DEFAULT_METRIC = "score";

/* ── 从真实记录算一份档案的指标 ──
 * 全部读 travel.js 已有接口，不复制业务逻辑。 */
function metricsOf(ledgerOverride, plansOverride, notesOverride) {
  const foot = safe(() => T.footStats(), { spots: 0, cities: 0, cityList: [] });
  const ledger = ledgerOverride || safe(() => T.getLedger(), []);
  const plans = plansOverride || safe(() => T.listSavedPlans(), []);
  const notes = notesOverride || safe(() => T.getNotes(), []);

  const spots = num(foot.spots);
  const cities = num(foot.cities);
  const nPlans = Array.isArray(plans) ? plans.length : 0;
  const nNotes = Array.isArray(notes) ? notes.length : num(foot.cityList && foot.cityList.length);

  let spent = 0, bills = 0;
  (Array.isArray(ledger) ? ledger : []).forEach((r) => {
    if (!r) return;
    const a = Number(r.amt);
    if (!isFinite(a) || a <= 0 || a > 1e6) return;   // 与 totalSpent 同一口径：剔异常值
    spent += a; bills++;
  });
  spent = Math.round(spent * 10) / 10;

  /* 积分：城市与景点是主项，行程/笔记/记账条数是加分项。
     系数取整数、量级递增，保证「走得远」一定压过「记得多」。 */
  const score = cities * 100 + spots * 10 + nPlans * 30 + nNotes * 8 + bills;

  return {
    score: score, cities: cities, spots: spots, plans: nPlans,
    notes: nNotes, spent: spent, bills: bills,
  };
}

/* ── 档案存储 ──
 * 一个档案 = { id, name, m(指标快照), ts }。
 * 快照是「上榜那一刻的指标」，而不是每次打开重算 ——
 * 否则用户新增一条记录就会看到别人名次莫名变化，榜单不可信。 */
function profiles() {
  return S.getArr(ARCH_KEY);
}
function meId() {
  return S.get(ME_KEY, "");
}
/* 首次进入：把当前这台手机上已有的真实数据存成「旅行者 1」。
 * 不造数 —— 指标就是现有记录算出来的，可能全是 0，那也如实显示。 */
function ensureMine() {
  const list = profiles();
  const cur = meId();
  if (cur && list.some((p) => p && p.id === cur)) return cur;
  const fresh = {
    id: "me_" + Date.now(),
    name: "旅行者 1",
    m: metricsOf(),
    ts: Date.now(),
  };
  list.unshift(fresh);
  S.set(ARCH_KEY, list);
  S.set(ME_KEY, fresh.id);
  return fresh.id;
}
/* 把当前真实数据刷新进自己的档案（手动触发，不在每次 onLoad 悄悄改） */
function refreshMine() {
  const list = profiles();
  const id = meId();
  const i = list.findIndex((p) => p && p.id === id);
  if (i < 0) return ensureMine();
  list[i] = Object.assign({}, list[i], { m: metricsOf(), ts: Date.now() });
  S.set(ARCH_KEY, list);
  return id;
}
/* 新增一个独立档案：调用方通常在「换人 / 帮同行者记录」后使用。
 * 参数 snapshot 用于从一份传入的数据建档（例如导入同伴的记账）。 */
function addProfile(name, snapshot) {
  const list = profiles();
  const p = {
    id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    name: (name || "").trim() || ("旅行者 " + (list.length + 1)),
    m: snapshot || metricsOf(),
    ts: Date.now(),
  };
  list.push(p);
  S.set(ARCH_KEY, list);
  return p.id;
}
function renameProfile(id, name) {
  const list = profiles();
  const i = list.findIndex((p) => p && p.id === id);
  if (i < 0) return false;
  const v = (name || "").trim();
  if (!v) return false;
  list[i] = Object.assign({}, list[i], { name: v });
  return S.set(ARCH_KEY, list);
}
function removeProfile(id) {
  const list = profiles();
  const next = list.filter((p) => p && p.id !== id);
  if (next.length === list.length) return false;
  S.set(ARCH_KEY, next);
  if (meId() === id) S.set(ME_KEY, next.length ? next[0].id : "");
  return true;
}
function setMe(id) {
  if (!profiles().some((p) => p && p.id === id)) return false;
  return S.set(ME_KEY, id);
}

/* ── 榜单计算 ──
 * 名次规则（写清楚是为了不让「并列」变成含糊事）：
 *   同分同名次，后续名次跳号（1,2,2,4），与竞赛惯例一致。
 *   没有任何真实数据的人不隐藏 —— 但「未上榜」区会明确说明原因，
 *   避免用户以为「榜上无名 = 我很差」。 */
function buildRank(metricKey) {
  const key = METRICS.some((m) => m.k === metricKey) ? metricKey : DEFAULT_METRIC;
  const met = METRICS.filter((m) => m.k === key)[0] || METRICS[0];
  const list = profiles()
    .filter((p) => p && p.m)
    .map((p) => ({
      id: p.id, name: p.name,
      val: num(p.m[key]),
      m: p.m,
      ts: p.ts || 0,
    }))
    .sort((a, b) => b.val - a.val || a.ts - b.ts);

  let lastVal = null, lastRank = 0;
  list.forEach((r, i) => {
    if (lastVal !== null && r.val === lastVal) { r.rank = lastRank; }
    else { r.rank = i + 1; lastRank = r.rank; lastVal = r.val; }
    r.me = r.id === meId();
  });

  const meIdNow = meId();
  const mine = list.filter((r) => r.id === meIdNow)[0] || null;
  const total = list.length;
  /* 「零分档」：确实一条真实记录都没有。它不是榜上的最后一名，
     而是「还没有数据可排」—— 单独说明，避免误导。 */
  const noData = mine && mine.val <= 0;

  return {
    metric: key, metricName: met.n, metricUnit: met.u, metricDesc: met.d,
    list: list, me: mine, total: total, noData: noData,
    allMetrics: METRICS.map((m) => ({ k: m.k, n: m.n, u: m.u, d: m.d, on: m.k === key })),
  };
}

/* 供未来的云端版本替换：形状固定为 { list:[{id,name,val,m}], metric, ... } */
function loadRanks(metricKey) { return Promise.resolve(buildRank(metricKey)); }

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

module.exports = {
  METRICS: METRICS, DEFAULT_METRIC: DEFAULT_METRIC, VER: VER_KEY,
  ensureMine: ensureMine, refreshMine: refreshMine,
  addProfile: addProfile, renameProfile: renameProfile, removeProfile: removeProfile,
  setMe: setMe, profiles: profiles, metricsOf: metricsOf,
  buildRank: buildRank, loadRanks: loadRanks,
};
