// utils/keys.js —— 第三方服务 Key 统一出口（v1.19.184 合规归一）
//
// 设计原则（合规铁律）：
//  1) 所有第三方 Key 只从此文件一个出口读取，禁止在 weather.js / 任意页面散落硬编码。
//  2) 主体一致：Key 必须注册在本人 / 本小程序主体账号下；
//     严禁借用他人 Key（历史上借用高德 Key 曾致封禁 + 主体不一致合规风险）。
//  3) Fail-closed：Key 缺失 / 为占位符 / 格式非法 → 返回 null，对应功能静默降级，绝不抛错阻断主流程。
//  4) 配额常识：高德配额按账号维度共享，轮换多把 Key 不增容量、反增封禁风险；只用本人账号一把 Key。
//
// 如何接入合规 Key（v1.20.4 合规整改 #1/#19）：
//   ★ 仓库不再存放任何明文 Key —— DEFAULT 全部为空串（审计 #1/#19「密钥明文进公开仓库」已修复）。
//   ★ 唯一接入路径：运行时通过 storage 注入（fail-closed，缺失即静默降级）：
//       wx.setStorageSync("__app_keys__", { qweatherKey:"...", qweatherHost:"...", amapKey:"..." })
//     —— 注入的 Key 仍须是注册在本人 / 本小程序主体账号下的 Key（严禁借用他人 Key，见上方铁律②）。
//   ★ 若要重新编译进包（不推荐，会重新引入明文），把下方对应字段填上本人账号 Key 即可。
//
// 现状（v1.20.4）：和风 Key 已移出仓库，改为运行时注入。高德 Key 当前未使用（<map> 组件无需 Key）。
// 未注入 Key 时天气功能 fail-closed 静默降级（qweatherConfigured() 返回 false，绝不抛错阻断主流程）。
const DEFAULT = {
  qweatherKey: "", // v1.20.4 #1/#19：明文移出仓库，改运行时注入（setKeys）
  qweatherHost: "", // 同上，须与 qweatherKey 配对注入
  amapKey: "", // 高德 Key：当前未使用；未来若用高德须填本人账号申请的 Key
  // 云环境 ID（CloudBase）：个人主体也能开云开发（约 ¥19.9/月）。
  // 未填 → 云能力整体 fail-closed 降级（本地优先，绝不抛错，见 utils/cloud.js）。
  // 接入：运行时 wx.setStorageSync("__app_keys__", { cloudEnv: "你的环境ID" })，
  //   或直接在此填入（环境 ID 是标识符非密钥，风险低；但公开仓库仍建议用运行时注入避免泄露）。
  cloudEnv: ""
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

// 云环境 ID（fail-closed：空白 / 占位符 → null → 云能力整体关闭，绝不抛错）
function cloudEnv() { return _resolve("cloudEnv"); }

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

module.exports = { qweatherKey, qweatherHost, amapKey, qweatherConfigured, cloudEnv, setKeys, DEFAULT };
