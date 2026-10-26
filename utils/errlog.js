// utils/errlog.js —— 本地错误回溯（无后端）：把被 SafePage 兜住 / app.onError 捕获的异常留存到 storage 环形缓冲，
// 便于真机 / 审核环境定位「按了没反应」类问题（错误不再无声消失）。
// 设计：纯 CommonJS；所有 wx 访问都带 typeof 守卫，Node 测试环境下 push 直接跳过，绝不抛错。
const KEY = "errlogV1";
const CAP = 30;

function _get() {
  try { return (typeof wx !== "undefined" && wx && wx.getStorageSync) ? (wx.getStorageSync(KEY) || []) : []; }
  catch (e) { return []; }
}
function _set(v) {
  try { if (typeof wx !== "undefined" && wx && wx.setStorageSync) wx.setStorageSync(KEY, v); } catch (e) {}
}

function push(label, err) {
  if (typeof wx === "undefined" || !wx) return; // Node 测试环境跳过
  let msg = "";
  try {
    if (err && (err.message || err.errMsg)) msg = String(err.message || err.errMsg);
    else msg = String(err);
  } catch (e) { msg = "unknown error"; }
  const item = { t: Date.now(), label: String(label || ""), msg: msg.slice(0, 600) };
  const list = _get();
  list.push(item);
  while (list.length > CAP) list.shift();
  _set(list);
}

function recent() { return _get(); }
function count() { try { return _get().length; } catch (e) { return 0; } }
function clear() { _set([]); }

module.exports = { push, recent, count, clear };
