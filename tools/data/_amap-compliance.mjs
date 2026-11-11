// 高德接口合规护栏（2026-09-14 建立）
//
// ── 为什么有这个文件 ────────────────────────────────────────────────
// 2026-09-14，高德开放平台向本账号发出正式处置通知：依据《高德地图开放平台服务协议》
// 4.12.3 条（禁止使用任何漫游器 / 网络蜘蛛 / 网络爬虫 / 抓取工具，或其他工具访问、抓取、
// 爬取、预读取、存储、缓存、检索或索引本服务及相关内容的任何一部分；亦不得以任何方式、
// 任何工具避开或试图避开本服务及高德所提供的任何安全保护机制或系统防御工具）——
// 对违规 KEY 的「关键字搜索 v3/place/text」接口权限作出封禁处理。
//
// 实测该处置是「接口级」而非「账号级」：被封 KEY 调 geocode/geo 仍返回 10000 OK，
// 且未出现账号级封禁码 10026 INVALID_REQUEST。
//
// ── 本模块的职责 ────────────────────────────────────────────────────
// 所有高德 Web 服务请求的**唯一出口**：
//   ① assertAllowed()  —— 被官方点名的接口路径一律硬拦截，永不发出请求；
//   ② isPunishPage()   —— 响应不是 JSON（阿里「比西」风控 punish 页 / rgv587_flag）
//                          说明已被行为风控拦截，调用方应立即熔断整轮，绝不重试。
//
// ── 合规红线（务必遵守，别再试探）────────────────────────────────────
//   4.12.3  禁止爬虫式抓取（本轮封禁依据）
//   3.5     禁止直接存储 / 缓存 / 以技术手段抓取本服务数据（落盘 POI 数据即踩此条）
//   3.7     超限须付费；多 KEY 轮换绕过配额本身即「规避限流」，是风控重点
//   3.1     个人认证仅限个人研究学习，不得用于生产（小程序上线即不合规）
//   4.5     一个 KEY 只能用于一个应用

export const BANNED_PATHS = [
  "place/text",
  "v3/place/text"
];

// ── 已封禁 KEY 黑名单（永久禁止复用）─────────────────────────────────
// b4f58a…：2026-09-14 因 place/text 批量抓取被高德依据 4.12.3 封禁「关键字搜索」接口权限。
// 该 KEY 的其他接口（geocode/geo、regeo、direction、district）实测仍可用，
// 但已被官方标记为违规 KEY —— 继续使用只会加速升级到账号级封禁（10026）。
// 保留在控制台即可（删除 KEY 不会解除任何处置），但任何脚本都不许再引用它。
// 注：其余 6 把 key 经用户确认属于本人账号（2026-09-14），可正常使用；
//    明文暂被合规清理删除，待用户重新提供后恢复于 tools/geocode.keys。
// ⚠️ 安全约定：黑名单**只存 sha256 摘要，不存明文**。
//    该 KEY 属第三方账号（外借），明文一旦进入 git 历史就无法撤回；
//    而比对所需的只是「相等性」，sha256 摘要语义完全等价。
export const REVOKED_KEY_SHA256 = [
  "07b07e979f1ea010433e50d7092ce02dcd01ab2b0a667f509957bdc87f140bac"
];

// ── 配额口径（据高德官方错误码对照表核对，2026-09）──────────────────
//   10003 DAILY_QUERY_OVER_LIMIT      日访问量超限        → 次日 00:00 自动恢复
//   10044 USER_DAILY_QUERY_OVER_LIMIT **账号维度**日调用量超限 → 次日 00:00 自动恢复
//   10010 IP_QUERY_OVER_LIMIT         单 IP 超限          → 不自动恢复，须提工单
//   10012 INSUFFICIENT_PRIVILEGES     权限不足（接口权限被摘 / 未开通）
//   10026 INVALID_REQUEST             账号被封禁          → 唯一账号级封禁码，全 KEY 作废
//
// ⚠️ 关键结论：10044 是「账号维度」。同一账号下无论建多少把 KEY，
//    搜索类配额都是共享同一份 —— 多建 KEY 不会多出一次调用，只会多出一份被封风险。
export const CODE_ACCOUNT_BANNED = "10026";
export const CODES_ACCOUNT_LEVEL = ["10044", "10045", "10026"];
export const CODES_AUTO_RESET = ["10003", "10044", "10045"];

import { createHash } from "node:crypto";

/** KEY 是否在永久封禁黑名单里（按 sha256 摘要比对，仓库内不存明文） */
export function isRevokedKey(key) {
  const k = String(key || "").trim();
  if (!k) return false;
  const h = createHash("sha256").update(k, "utf8").digest("hex");
  return REVOKED_KEY_SHA256.includes(h);
}

/** 已封禁 KEY 直接抛错 —— 这是「永不发出请求」的保证，不是提示 */
export function assertKeyAllowed(key) {
  if (isRevokedKey(key)) {
    throw new Error(
      `KEY ${String(key).slice(0, 6)}… 已被高德官方封禁（2026-09-14，服务协议 4.12.3 反爬条款），` +
      `禁止再用它发起任何请求。\n` +
      `  该封禁为「接口级」（仅摘除 v3/place/text），但继续使用该 KEY 会升级为账号级封禁 10026。`
    );
  }
}

/** 从响应中取 infocode；非 JSON（阿里风控页）返回 "HTML" */
export function infocodeOf(json) {
  if (!json || typeof json !== "object") return "HTML";
  return String(json.infocode || "?");
}

/** 账号级封禁（10026）—— 出现即全账号所有 KEY 作废，只剩申诉一条路 */
export function isAccountBanned(json) {
  return infocodeOf(json) === CODE_ACCOUNT_BANNED;
}

export const BAN_HINT = [
  "",
  "🛑 高德返回了风控拦截页（非 JSON 响应，含 bixi.alicdn.com/punish 或 rgv587_flag）。",
  "   这意味着当前调用已被阿里「比西」反爬风控判定为异常流量。",
  "   已立即停止本轮全部请求 —— 继续重试只会加重处置（本轮封禁依据：服务协议 4.12.3）。",
  "   请改用 place/around（周边搜索）或 assistant/inputtips（输入提示），并停止批量抓取落盘。",
  ""
].join("\n");

/** 判断某个 v3 接口路径（含查询串）是否属于被官方封禁的接口 */
export function isBanned(qs) {
  const p = String(qs || "").split("?")[0].replace(/^\/+/, "");
  return BANNED_PATHS.some(b => p === b || p === b + "/");
}

/** 被禁接口直接抛错 —— 这是「永不发出请求」的保证，不是提示 */
export function assertAllowed(qs) {
  if (isBanned(qs)) {
    throw new Error(
      `接口 v3/${String(qs).split("?")[0]} 已被高德官方封禁（2026-09-14，服务协议 4.12.3 反爬条款）。\n` +
      `  禁止再调用。替代方案：place/around（周边搜索）/ assistant/inputtips（输入提示）/ geocode/geo（地理编码）。`
    );
  }
}

/** 响应体是阿里反爬 punish 页（而非 JSON）→ 判定被风控拦截 */
export function isPunishPage(body) {
  const s = String(body || "");
  return /bixi\.alicdn\.com\/punish|rgv587_flag|x5secdata/.test(s);
}

/** 从 punish 页里提取 uuid / action，便于日志留证 */
export function describePunish(body) {
  const s = String(body || "");
  const uuid = (s.match(/uuid=([0-9a-f]+)/) || [])[1] || "-";
  const action = (s.match(/action=(\w+)/) || [])[1] || "-";
  return `action=${action} uuid=${uuid}`;
}
