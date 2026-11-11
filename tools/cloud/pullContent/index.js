// 云函数 pullContent —— 内容版本清单（支持 OTA「数据有更新」提示，零伪造）
//
// 读集合 meta 的 contentVersion 文档，回传当前内容版本 / 更新时间 / 更新说明。
// 没有该文档时回传基线（不报错），前端据此决定是否提示「本地数据可更新」。
//
// 部署：云函数根建 pullContent，拷 index.js + package.json，上传并部署；建集合 meta（一条 _id=contentVersion 的文档即可）。

const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = "meta";

exports.main = async () => {
  try {
    const r = await db.collection(COL).doc("contentVersion").get();
    const d = (r && r.data) || {};
    return { ok: true, v: d.v || "", updated: d.updated || "", note: d.note || "" };
  } catch (e) {
    // 没有该文档 → 返回基线版本，不报错
    return { ok: true, v: "", updated: "", note: "" };
  }
};
