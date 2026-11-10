// 云函数 recommend —— 每用户偏好档案（真实落库，支撑跨端个性化；当前为最小可用）
//
// 集合 prefs：以归属键 owner 为主键（字段名沿用 openid 兼容既有 schema），存用户偏好画像。
//   { action: "set",   uid, patch } → 合并写入该归属键的偏好
//   { action: "get",   uid }         → 读回该归属键的偏好
//
// 归属键解析（与 syncPlan 同策略）：event.uid 优先（配对码/匿名 guid/小程序 openid 一视同仁），
//   缺失时回落 context.OPENID（小程序原生兜底）。这是跨端共享偏好的前提。
//
// 注：实际推荐仍由小程序本地 T 引擎完成（离线、零合规）；此函数只负责「跨端同步偏好画像」，
//     为未来的个性化重排提供真实数据底座，不伪造任何推荐结果。
//
// 部署：云函数根建 recommend，拷 index.js + package.json，上传并部署；建集合 prefs（权限：仅创建者可读写）。

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = "prefs";

function resolveOwner(event, context) {
  const u = (event && event.uid) || "";
  if (typeof u === "string" && u.length >= 2 && u.length <= 128) return u;
  return (context && context.OPENID) || (cloud.getWXContext && cloud.getWXContext().OPENID) || "";
}

exports.main = async (event, context) => {
  const owner = resolveOwner(event, context);
  if (!owner) return { ok: false, err: "no-owner" };
  const action = (event && event.action) || "get";
  try {
    if (action === "set") {
      const patch = (event && event.patch) || {};
      const exist = await db.collection(COL).where({ openid: owner }).get();
      if (exist && exist.data && exist.data.length) {
        await db.collection(COL).doc(exist.data[0]._id).update({ data: Object.assign({ openid: owner, updatedAt: Date.now() }, patch) });
      } else {
        await db.collection(COL).add({ data: Object.assign({ openid: owner, updatedAt: Date.now() }, patch) });
      }
      return { ok: true };
    }
    const r = await db.collection(COL).where({ openid: owner }).get();
    return { ok: true, prefs: (r.data && r.data[0]) || null };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
};
