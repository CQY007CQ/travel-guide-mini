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
// 现状（v1.20.33）：和风 Key 已移出仓库，改为运行时注入。高德 Key 当前未使用（<map> 组件无需 Key）。
// 未注入 Key 时天气功能 fail-closed 静默降级（qweatherConfigured() 返回 false，绝不抛错阻断主流程）。
// ★ 和风两件套必须配对：2026 年起公共域名 devapi/api/geoapi.qweather.com 陆续停服，
//   新账号须用控制台「设置 → API Host」分配的专属 Host（形如 h2a9cf3mhs.xy.qweatherapi.com）。
//   只填 Key 不填 Host → 回落公共域名（老账号或许还能用），新账号必然失败。
const DEFAULT = {
  qweatherKey: "", // v1.20.4 #1/#19：明文移出仓库，改运行时注入（setKeys）
  qweatherHost: "", // 同上，须与 qweatherKey 配对注入
  amapKey: "", // 高德 Key：当前未使用；未来若用高德须填本人账号申请的 Key
  // 云环境 ID（CloudBase）：环境 ID 是公开标识符（小程序前端本就要明文用它初始化 wx.cloud），非密钥。
  // 已填本人环境 → 云端 AI（llmProxy 强模型）启用；留空 → 云能力 fail-closed 降级（本地优先，见 utils/cloud.js）。
  // 运行时仍可用 wx.setStorageSync("__app_keys__", { cloudEnv: "..." }) 覆盖，用于换环境而无需重发版。
  cloudEnv: "cloud1-d8ghdiimn9a2d8b8e"
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

// ── 和风 API Host（v1.20.33）────────────────────────────────────────────────
// 背景（外部变化，不是本项目改坏的）：和风公共域名 devapi / api / geoapi.qweather.com
// **自 2026 年起陆续停服**，新账号必须用控制台「设置」里分配的专属 Host
// （形如 h2a9cf3mhs.xy.qweatherapi.com）；API Host 本身也是身份认证的一部分
// —— 只拿到 Key 而不知 Host，请求同样调不通。
// 兜底：未填 Host 时回落公共域名（老账号可能仍可用），失败时由 weather 层给出
// 「去填专属 API Host」的具体指引，而不是一句无用的「服务异常」。
const LEGACY_HOST = "https://devapi.qweather.com";

// 规范化 Host：三种写法都实测见过 —— 裸域名 / 带 https:// / 带尾部斜杠，统一成完整基址。
// 明显不是域名（含空格、中文、无点）→ 返回 null 当未填，绝不把脏串拼进 URL。
function qweatherHostNorm() {
  const h = qweatherHost();
  if (!h) return null;
  let s = String(h).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/\/+$/, "");
  const m = /^https?:\/\/([^\s\/:]+)(:\d+)?(\/[^\s]*)?$/i.exec(s);
  if (!m) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(m[1])) return null;
  return s;
}

// 天气请求基址：要么是完整可用 URL，要么 null —— 禁止再出现 "null/v7/weather/7d" 这种半成品。
function qweatherBase() {
  const norm = qweatherHostNorm();
  if (norm) return norm;
  return qweatherKey() ? LEGACY_HOST : null;
}

// 当前走的是专属 Host 还是公共域名：custom / legacy / none。
// legacy 失败时必须指路「换专属 Host」，否则用户只会看到无从下手的「服务异常」。
function qweatherHostMode() {
  if (qweatherHostNorm()) return "custom";
  return qweatherKey() ? "legacy" : "none";
}

// 是否已有可用的和风 Key（fail-closed 判据，供 weather 跳过 / 降级）
// 注意：这里刻意**只看 Key**，不看 Host —— 只填 Key 的老配置仍允许尝试（回落公共域名）。
// 「Key 有 / Host 空」这种半配置由 qweatherBase() 兜底成合法 URL，不会再拼出坏地址。
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

module.exports = { qweatherKey, qweatherHost, qweatherHostNorm, qweatherBase, qweatherHostMode, amapKey, qweatherConfigured, cloudEnv, setKeys, DEFAULT, LEGACY_HOST };
