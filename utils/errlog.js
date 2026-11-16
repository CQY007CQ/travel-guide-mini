// utils/errlog.js —— 本地错误回溯（无后端）：把被 SafePage 兜住 / app.onError 捕获的异常留存到 storage 环形缓冲，
// 便于真机 / 审核环境定位「按了没反应」类问题（错误不再无声消失）。
// 设计：纯 CommonJS；所有 wx 访问都带 typeof 守卫，Node 测试环境下 push 直接跳过，绝不抛错。
const S = require("./store.js");   // v1.20.4 #81：统一存储出口
const KEY = "errlogV1";
const CAP = 30;

function _get() {
  try { return S.getArr(KEY); } catch (e) { return []; }
}
function _set(v) {
  try { S.set(KEY, v); } catch (e) { /* 痕迹写盘失败只能吞掉：在这里再留痕会自我递归，且存储已满时必然再失败 */ }
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

/* ────────────────────────────────────────────────────────────────
 * v1.20.8（T1）：`note()` —— 降级痕迹统一出口
 *
 * 与 push() 的分工：
 *   push()  记「异常终于抛到边界了」（SafePage / app.onError 兜住的那种，属于崩溃）。
 *   note()  记「这里主动降级了、功能还在，但质量掉了一档」（云端 AI 回落离线、天气取不到、
 *           存储写不进去、地图上下文拿不到…）。这类失败原来大量写成 `catch (e) {}`，
 *           既不报错也不改界面也不留痕，用户只看到「点了没反应」，开发侧无从判断。
 *
 * 为什么不做成第二个模块：本仓已有 errlog 这个环形缓冲 + 9 个页面在用，
 *   再建一个 diag.js 就是「同一事实两个真相源」，排查时要翻两处、门禁也要断两处。
 *
 * 去重：同一 scope+消息一个会话只落一条（并累计次数）。天气 / 云函数这类会被反复触发的
 *   失败若每次都写，30 条的缓冲会被瞬间冲爆，反而把真正罕见的错误挤掉。
 * ──────────────────────────────────────────────────────────────── */
const _seen = Object.create(null);
function _msgOf(err) {
  if (err == null) return "unknown";
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);
  var m = err.message || err.errMsg || err.err || "";
  var c = err.code != null ? "(" + err.code + ")" : "";
  var t = String(m || "").trim();
  return (t ? t.slice(0, 200) : "unknown") + c;
}

// note(scope, err, extra) —— scope 用固定小写短语：ai / cloud / weather / map / lens / store / plan / pay
function note(scope, err, extra) {
  try {
    var sc = String(scope || "misc").toLowerCase().slice(0, 24);
    var msg = _msgOf(err);
    var key = sc + "|" + msg;
    if (_seen[key]) { _seen[key].n++; return _seen[key].n; }
    _seen[key] = { scope: sc, msg: msg, n: 1 };
    push("diag:" + sc, msg + (extra ? " · " + String(extra).slice(0, 120) : ""));
    try {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[diag][" + sc + "] " + msg + (extra ? " · " + extra : ""));
      }
    } catch (e2) { /* 控制台不可用也不能抛 */ }
    return 1;
  } catch (e3) { return 0; }
}

// 诊断汇总：降级过的 scope 与次数。空对象表示「整个过程没有发生任何降级」。
function noteStats() {
  var byScope = {}, kinds = 0, total = 0;
  try {
    for (var k in _seen) { byScope[_seen[k].scope] = (byScope[_seen[k].scope] || 0) + _seen[k].n; kinds++; total += _seen[k].n; }
  } catch (e) { /* ignore */ }
  return { total: total, kinds: kinds, byScope: byScope };
}

module.exports = { push, recent, count, clear, note, noteStats };
