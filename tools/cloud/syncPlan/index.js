// 云函数 syncPlan —— 行程互通核心（小程序 ↔ 网页版共用）
//
// 集合 plans：以「归属键 owner」索引（字段名沿用 openid 以兼容既有 schema，语义上即 owner）。
// 归属键取值（由前端 utils/cloud.js 的 ensureUid() 解析后通过 event.uid 传入）：
//   · 小程序原生（未配对）：openid（经 whoami 回写，等同 context.OPENID）
//   · 网页版：匿名 guid（u_ 前缀，本地生成）
//   · 跨端配对：用户在一端点「复制同步码」、另一端「输入同步码」得到的同一串 u_xxx
//     两端用同一 uid → 云端同一归属键 → 数据自然互通（无需登录体系，零合规风险）
//
// ⚠️ 关键修复（2026-11-11）：旧版只用 context.OPENID，导致网页版（无微信 openid）与配对码
//    （非 openid）两种场景完全失效。现以 event.uid 为归属主键，仅当 uid 缺失时回落 OPENID。
//
// 动作：
//   { action: "whoami" }                       → 回写归属键（前端据此统一跨端 uid）
//   { action: "upsert", uid, plan, updatedAt }  → 写入/更新该归属键的主行程（plan=null 表示清空）
//   { action: "list",   uid }                    → 列出该归属键的主行程
//
// ⚠️ 本文件不被打包进小程序（tools/ 已被 packOptions.ignore 排除），放这里进 git 方便一键上传。
// 部署：云函数根建 syncPlan，拷 index.js + package.json，右键「上传并部署（云端安装依赖）」；
//       建集合 plans（权限：仅创建者可读写）。

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = "plans";

// 本次修复：首次部署时 plans 集合还没建 —— 真机实测 whoami 通、upsert/list 直接
//   `-502005 database collection not exists`。让云函数自己补建一次集合并重试，
//   用户就不必再去微信云开发控制台手动创建（这一步以前没写在任何部署文档里）。
// createCollection 只在「集合不存在」时调用；并发下若已被别人建好会报 -501001，
// 那也是可恢复的，直接继续走原查询即可。
let _collectionReady = false;
async function ensureCollection() {
  if (_collectionReady) return;
  try {
    await db.createCollection(COL);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!/already exist|-501001|exist/i.test(msg)) throw e;
  }
  _collectionReady = true;
}
function isMissingCollection(e) {
  const msg = String((e && e.message) || e);
  return /-502005|collection not exists|ResourceNotFound|not exist/i.test(msg);
}

// 解析归属键：event.uid 优先（跨端互通的关键），缺失时回落微信 OPENID（小程序原生兜底）。
// 长度护栏防止伪造超长 uid 注入；合法 uid 形如 openid / u_xxx guid。
function resolveOwner(event, context) {
  const u = (event && event.uid) || "";
  if (typeof u === "string" && u.length >= 2 && u.length <= 128) return u;
  return (context && context.OPENID) || (cloud.getWXContext && cloud.getWXContext().OPENID) || "";
}

async function runAction(action, owner, event) {
  if (action === "whoami") return { ok: true, openid: owner };
  if (action === "upsert") {
    const plan = (event && event.plan) || null;
    if (!plan) {
      await db.collection(COL).where({ openid: owner, primary: true }).remove();
      return { ok: true };
    }
    plan.openid = owner;   // 归属键（语义：owner）
    plan.primary = true;
    plan.updatedAt = (event && event.updatedAt) || Date.now();
    const exist = await db.collection(COL).where({ openid: owner, primary: true }).get();
    if (exist && exist.data && exist.data.length) {
      await db.collection(COL).doc(exist.data[0]._id).update({ data: plan });
    } else {
      await db.collection(COL).add({ data: plan });
    }
    return { ok: true };
  }
  if (action === "list") {
    const r = await db.collection(COL).where({ openid: owner }).orderBy("updatedAt", "desc").limit(20).get();
    return { ok: true, list: r.data || [] };
  }
  return { ok: false, err: "unknown-action" };
}

exports.main = async (event, context) => {
  const owner = resolveOwner(event, context);
  if (!owner) return { ok: false, err: "no-owner" };
  const action = (event && event.action) || "";
  // 首次调用先确保集合存在；whoami 不碰库，跳过
  if (action !== "whoami") {
    try { await ensureCollection(); }
    catch (e) { return { ok: false, err: "ensure-collection:" + String((e && e.message) || e) }; }
  }
  try {
    return await runAction(action, owner, event);
  } catch (e) {
    // 并发冷启动下 createCollection 与首次写入可能抢跑；再补建一次并重试一次即可自愈。
    if (isMissingCollection(e) && action !== "whoami") {
      try {
        _collectionReady = false;
        await ensureCollection();
        return await runAction(action, owner, event);
      } catch (e2) {
        return { ok: false, err: String((e2 && e2.message) || e2) };
      }
    }
    return { ok: false, err: String((e && e.message) || e) };
  }
};
