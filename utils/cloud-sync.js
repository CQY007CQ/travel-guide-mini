// utils/cloud-sync.js —— 行程上云 / 拉回（本地优先 + fail-closed）
//
// 互通核心：小程序与网页版通过同一个云函数 syncPlan + 集合 plans 共享数据。
//   · 写入：以 uid（小程序 openid / 网页匿名 guid）为归属，plan 带稳定 id + updatedAt（主行程标记 primary）。
//   · 拉回：列出该 uid 下的主行程，供「多设备 / 跨端」继续编辑。
//   · 冲突：本地优先（last-writer-wins，按 updatedAt 比较），不覆盖用户正在看的本地行程。
//
// 任何失败都 fail-closed：返回 { ok:false, reason }，由调用方决定是否提示；绝不抛错阻断主流程。

const C = require("./cloud.js");
const S = require("./store.js");
const EL = require("./errlog.js");

const KEY_LOCAL = "planV1";

function _stamp(plan) {
  if (plan && typeof plan === "object") {
    if (!plan.id) plan.id = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!plan.updatedAt) plan.updatedAt = Date.now();
  }
  return plan;
}

// 上云：把当前行程写入云端。plan 为 null 表示「清空当前行程」（同步删除云端主行程）。
async function pushPlan(plan) {
  if (!C.ready()) return { ok: false, reason: "cloud-off" };
  let uid;
  try { uid = await C.ensureUid(); } catch (e) { uid = C.localUid(); }
  try {
    const payload = {
      action: "upsert",
      uid: uid,
      plan: plan ? _stamp(JSON.parse(JSON.stringify(plan))) : null,
      updatedAt: Date.now()
    };
    const r = await C.callFunction("syncPlan", payload);
    if (r && r.ok) return { ok: true };
    return { ok: false, reason: (r && r.err) || "remote-reject" };
  } catch (e) {
    try { EL.push("cloudSync.pushPlan", e); } catch (_) {}
    return { ok: false, reason: "exception" };
  }
}

// 拉回：列出云端该 uid 下的主行程
async function pullPlans() {
  if (!C.ready()) return { ok: false, reason: "cloud-off", list: [] };
  let uid;
  try { uid = await C.ensureUid(); } catch (e) { uid = C.localUid(); }
  try {
    const r = await C.callFunction("syncPlan", { action: "list", uid: uid });
    if (r && r.ok && Array.isArray(r.list)) return { ok: true, list: r.list };
    return { ok: false, reason: (r && r.err) || "remote-reject", list: [] };
  } catch (e) {
    try { EL.push("cloudSync.pullPlans", e); } catch (_) {}
    return { ok: false, reason: "exception", list: [] };
  }
}

// 取云端「最新一份」主行程（用于跨端继续）
async function pullLatest() {
  const r = await pullPlans();
  if (!r.ok || !r.list.length) return { ok: false, reason: r.reason || "empty", plan: null };
  let best = r.list[0];
  for (const p of r.list) if ((p.updatedAt || 0) > (best.updatedAt || 0)) best = p;
  return { ok: true, plan: best };
}

module.exports = { pushPlan, pullPlans, pullLatest, KEY_LOCAL };
