// 出发提醒 —— 本地队列 + 日历兜底 + 云端订阅消息（可选）
//
// ── 现实约束（先说清楚，别做假功能）─────────────────────────────────
// 微信小程序的推送只有一条路：**服务端调 subscribeMessage.send**。
// 客户端 wx.requestSubscribeMessage 只是「向用户拿一次发送许可」，
// 拿到许可后如果没人发，这条许可会在有效期后自动作废，用户也不会收到任何东西。
//
// 所以在**没有服务端**（云开发 / 自建后端）之前，真正能落地的是：
//   ① 加入手机日历（wx.addPhoneCalendar）—— 完全离线，系统自己会响铃
//   ② 本模块的「站内轻提醒」—— 用户下次打开小程序时，把到点的提醒弹出来
//
// 等哪天开通了微信云开发，把 CLOUD_FN / TMPL_IDS 填好，
// 同一套队列就会走 ③ 订阅消息，逻辑不用改。
//
// ── 开通云开发后的接线步骤 ──────────────────────────────────────────
//   1) 开发者工具 → 云开发 → 开通（个人主体可开；2026 年有 6 个月免费额度活动）
//   2) 把 tools/cloud/sendRemind/ 整个目录上传到云函数根（或新建同名函数）
//   3) mp 后台 → 订阅消息 → 选用模板（个人主体只能选「一次性订阅」）→ 复制模板 ID
//   4) 填到下面 TMPL_IDS，并把 USE_CLOUD 改成 true
//
// ── 设计原则 ────────────────────────────────────────────────────────
//   · 未配置 → 订阅入口自动隐藏，只保留日历，**绝不弹一个没用的授权框**
//   · 任何读写异常都不抛给页面（try 包死），提醒是辅助功能

const KEY = "remindQueueV1";
const USE_CLOUD = false;            // 未开通云开发前保持 false
const CLOUD_FN = "sendRemind";      // 云函数名，需与 tools/cloud/sendRemind 对应
const TMPL_IDS = [];                // ← 开通后填一次性订阅模板 ID（最多 3 个）

function _read() {
  try {
    const s = wx.getStorageSync(KEY);
    const a = s ? JSON.parse(s) : null;
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function _write(a) {
  try { wx.setStorageSync(KEY, JSON.stringify(a)); } catch (e) {}
  return a;
}

function _ymd(d) {
  const x = d || new Date();
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}

/** 全部提醒（按时间升序） */
function list() {
  return _read().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * 添加一条提醒。item = { id?, date:'YYYY-MM-DD', title, city, note, planId }
 * 同一 planId + 同一天去重（避免用户反复点）
 */
function add(item) {
  const a = _read();
  const date = String((item && item.date) || "").slice(0, 10);
  if (!date) return null;
  const dup = a.filter((x) => x.date === date && String(x.planId || "") === String((item && item.planId) || ""));
  if (dup.length) return dup[0];
  const rec = {
    id: (item && item.id) || _uid(),
    date: date,
    title: (item && item.title) || "出发提醒",
    city: (item && item.city) || "",
    note: (item && item.note) || "",
    planId: (item && item.planId) || "",
    via: (item && item.via) || "local",
    ack: 0,
    created: Date.now()
  };
  a.push(rec);
  _write(a);
  return rec;
}

function remove(id) {
  _write(_read().filter((x) => x.id !== id));
}

function clear() { _write([]); }

/** 标记已读（弹过就不再弹） */
function ack(id) {
  const a = _read();
  let hit = false;
  for (let i = 0; i < a.length; i++) if (a[i].id === id) { a[i].ack = 1; hit = true; }
  if (hit) _write(a);
  return hit;
}

/** 到点（含已过期）且未读的提醒 */
function dueToday() {
  const today = _ymd();
  return list().filter((x) => !x.ack && String(x.date) <= today);
}

/** 未来 N 天内临近的提醒（用于首页 / 行程页提示条） */
function upcoming(days) {
  const n = Number(days) || 7;
  const today = _ymd();
  const lim = _ymd(new Date(Date.now() + n * 86400000));
  return list().filter((x) => String(x.date) >= today && String(x.date) <= lim);
}

/** 订阅消息是否真的可用（没填模板 ID → false → 页面隐藏入口） */
function subscribeAvailable() {
  return !!(USE_CLOUD && TMPL_IDS.length);
}

/** 云推送是否已激活 */
function cloudReady() {
  if (!subscribeAvailable()) return false;
  try { return typeof wx.cloud === "object" && typeof wx.cloud.callFunction === "function"; } catch (e) { return false; }
}

/**
 * 申请一次订阅授权（必须在用户点击手势里调用，不能自动触发）
 * 返回 Promise<Array<模板授权结果>>，失败返回 []
 */
function requestSubscribe() {
  return new Promise((resolve) => {
    if (!TMPL_IDS.length) { resolve([]); return; }
    try {
      wx.requestSubscribeMessage({
        tmplIds: TMPL_IDS.slice(0, 3),
        success: (r) => { resolve(r || {}); },
        fail: () => { resolve([]); }
      });
    } catch (e) { resolve([]); }
  });
}

/**
 * 走云函数预约发送。失败返回 false —— 调用方据此降级到「日历 + 站内提醒」。
 */
function scheduleCloud(item) {
  if (!cloudReady()) return Promise.resolve(false);
  const todo = item || {};
  return new Promise((resolve) => {
    try {
      wx.cloud.callFunction({
        name: CLOUD_FN,
        data: {
          date: String(todo.date || "").slice(0, 10),
          title: todo.title || "出发提醒",
          city: todo.city || "",
          note: todo.note || "",
          openid: ""   // 由云函数从 context.OPENID 自取，端上不必传
        },
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (e) { resolve(false); }
  });
}

/**
 * 加入手机日历（完全离线，系统自带闹钟）。成功返回 true。
 * 这是「没有服务端时」唯一能真正把用户叫醒的通道。
 */
function addToCalendar(item) {
  const t = item || {};
  return new Promise((resolve) => {
    if (typeof wx.addPhoneCalendar !== "function") { resolve(false); return; }
    try {
      const d = String(t.date || "");
      if (!d) { resolve(false); return; }
      const start = new Date(d + " 08:00:00");
      if (isNaN(start.getTime())) { resolve(false); return; }
      const startTime = Math.floor(start.getTime() / 1000);
      wx.addPhoneCalendar({
        title: t.title || "出发提醒",
        startTime: startTime,
        endTime: startTime + 3600,
        description: t.note || "",
        alarm: true,
        alarmOffset: 3600,   // 提前 1 小时响
        allDay: false,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (e) { resolve(false); }
  });
}

module.exports = {
  list, add, remove, clear, ack,
  dueToday, upcoming,
  subscribeAvailable, cloudReady,
  requestSubscribe, scheduleCloud, addToCalendar,
  debug: () => ({ cloud: cloudReady(), sub: subscribeAvailable(), n: _read().length })
};
