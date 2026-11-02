// utils/keys.js —— 第三方服务 Key 统一出口（v1.19.184 合规归一）
//
// 设计原则（合规铁律）：
//  1) 所有第三方 Key 只从此文件一个出口读取，禁止在 weather.js / 任意页面散落硬编码。
//  2) 主体一致：Key 必须注册在本人 / 本小程序主体账号下；
//     严禁借用他人 Key（历史上借用高德 Key 曾致封禁 + 主体不一致合规风险）。
//  3) Fail-closed：Key 缺失 / 为占位符 / 格式非法 → 返回 null，对应功能静默降级，绝不抛错阻断主流程。
//  4) 配额常识：高德配额按账号维度共享，轮换多把 Key 不增容量、反增封禁风险；只用本人账号一把 Key。
//
// 如何接入合规 Key（二选一，推荐①）：
//  ① 直接改下方 DEFAULT（编译期生效，一行搞定，最稳）；
//  ② 运行时通过 storage 注入：wx.setStorageSync("__app_keys__", { qweatherKey:"...", qweatherHost:"...", amapKey:"..." })
//     —— 便于不重新发版临时换 Key，但 Key 仍须是本人账号、且勿外泄到明文仓库。
//
// 现状（v1.19.184）：和风 Key 为 v1.19.157 接入的免费 Key，须确认归属本人和风账号；
// 高德 Key 当前为空 —— 小程序地图用的是微信内置腾讯地图（<map> 组件无需 Key），
// 仅当未来调用高德地理 / 地图 JS API 时才需填本人账号申请的 Key。
const DEFAULT = {
  qweatherKey: "d84611f29a4d48d48a36227b613de255", // 和风免费 Key（v1.19.157 接入；须确认在本人和风账号下）
  qweatherHost: "https://j864228fx2.re.qweatherapi.com", // 和风专属域名（devapi.qweather.com 对本 Key 返回 Invalid Host）
  amapKey: "" // 高德 Key：当前未使用；未来若用高德须填本人账号申请的 Key
};

// 占位符特征：未真正配置的 Key
const PLACEHOLDER = /在此填写|your_|xxxx|placeholder|<<|>>/i;

function _readOverride() {
  try {
    if (typeof wx !== "undefined" && wx.getStorageSync) {
      const s = wx.getStorageSync("__app_keys__");
      if (s && typeof s === "object") return s;
    }
  } catch (e) {}
  return null;
}

// 解析某个字段：运行时 storage 注入优先，否则用 DEFAULT；非法值回落 null（fail-closed）
function _resolve(field) {
  const ov = _readOverride();
  const v = (ov && typeof ov[field] === "string" && ov[field]) ? ov[field] : DEFAULT[field];
  if (!v || typeof v !== "string") return null;
  if (PLACEHOLDER.test(v)) return null;
  return v;
}

function qweatherKey() { return _resolve("qweatherKey"); }
function qweatherHost() { return _resolve("qweatherHost"); }
function amapKey() { return _resolve("amapKey"); }

// 是否已有可用的和风 Key（fail-closed 判据，供 weather 跳过 / 降级）
function qweatherConfigured() { return !!qweatherKey(); }

// 运行时注入（见上方②）。仅落内存 + storage，不写文件、不回传任何服务器。
function setKeys(patch) {
  try {
    if (typeof wx !== "undefined" && wx.getStorageSync && wx.setStorageSync) {
      const cur = wx.getStorageSync("__app_keys__") || {};
      const next = Object.assign({}, cur, patch || {});
      wx.setStorageSync("__app_keys__", next);
      return true;
    }
  } catch (e) {}
  return false;
}

module.exports = { qweatherKey, qweatherHost, amapKey, qweatherConfigured, setKeys, DEFAULT };
