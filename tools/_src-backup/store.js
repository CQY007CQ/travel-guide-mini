// wx 存储封装（对齐网页版 localStorage 用法）+ 通用格式化
// v1.10.1：写入失败不再静默吞掉（配额满会让用户以为保存成功），改为返回 false + 节流提示
// v1.11.0：新增类型守卫（getArr / getObj）—— 读到脏数据/旧版本结构时降级为默认值，
//           而不是把炸弹透传下去让页面在 _sync 里崩掉。
// 【设计决策】曾尝试做「会话级读缓存」提升性能，最终否决：本项目存在多处绕过本封装
//   直接调用 wx.setStorageSync 的路径（不同页面各自维护 storage），单向缓存会读到过期值，
//   比少一次同步读（getStorageSync 本身就是内存读，开销极小）危险得多。
//   因此这里只做校验与统一失败提示，不做缓存；业务侧需要复用请自己在闭包里暂存。
// v1.20.8（T1）：失败不再只靠 UI 提示，统一留一条可检索痕迹。
//   此前「写失败」只有 toast（且整个会话只提示一次）、「删除失败 / 读失败」完全静默 ——
//   用户反馈「数据没了」时无从判断是配额满、被系统清理还是读写异常。
//   diag 只做记录与去重，绝不抛错，不会把降级变成崩溃。
// 注意：errlog.js 自己 require 了本文件，所以这里必须「调用时懒取」，不能在模块级 require ——
// 否则 store 加载到一半就把 errlog 拉起来，errlog 拿到的是半初始化的 exports，S.get 会 undefined。
// ⚠️ 签名是 _note(描述, 原始错误)，scope 已固定为 "store" 写死在里面 —— 调用时**不要再传 scope**。
//   「描述放第一位」不是随手排的：errlog.note 的去重键是 `scope|msg`，msg 取自第一位。
//   把「操作 + 键名」放第一位，读/写/删/JSON 解析/序列化失败才各自成桶，键名也才留得下来；
//   若把原始错误放第一位（如 setStorageSync 的通用报错），四类失败会共用一个桶，只有第一条落盘。
//   2026-11-17 修：此前 6 个调用点都写成 _note("store", e, "写入失败: " + k)，多传的 "store"
//   被当成 err（_msgOf 对字符串原样返回）→ 落盘消息恒为 `store`，真正的「操作类型 + 键名」
//   被第三个实参吞掉，去重键退化成 `store|store`。现象是「用户说数据没了，日志里只有一行 store」，
//   正是 v1.20.8/T1 想解决的问题 —— 门禁当时只断言源码里有那句字符串，所以没拦住。
const _note = (desc, err) => { try { require("./errlog.js").note("store", desc, err); } catch (e) { /* errlog 自身不可用（极端裁剪/循环依赖）时放弃留痕，不允许它连累存储主流程 */ } };

const get = (k, def) => {
  try {
    const v = wx.getStorageSync(k);
    return v === "" || v === undefined || v === null ? def : v;
  } catch (e) { _note("读取失败: " + k, e); return def; }
};

// 数组型键的类型守卫：读到非数组（脏数据 / 旧版本结构）时降级为 []
const getArr = (k) => {
  const v = get(k, []);
  return Array.isArray(v) ? v : [];
};

// 对象型键的类型守卫
const getObj = (k) => {
  const v = get(k, {});
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
};

let _warned = false;          // 同一次会话只提示一次，避免刷屏
const set = (k, v) => {
  try { wx.setStorageSync(k, v); return true; } catch (e) {
    _note("写入失败（可能配额已满）: " + k, e);
    if (!_warned) {
      _warned = true;
      try {
        wx.showToast({
          title: "存储空间不足，部分内容未能保存",
          icon: "none", duration: 2600
        });
      } catch (_) { /* 冷启动阶段页面未就绪，忽略 */ }
    }
    return false;
  }
};

const del = (k) => { try { wx.removeStorageSync(k); } catch (e) { _note("删除失败: " + k, e); } };

// 存储用量：{ current, limit, keys, pct }（单位 KB）
const usage = () => {
  try {
    const i = wx.getStorageInfoSync();
    return {
      current: i.currentSize || 0,
      limit: i.limitSize || 10240,
      keys: (i.keys || []).length,
      pct: Math.min(100, Math.round((i.currentSize || 0) / (i.limitSize || 10240) * 100))
    };
  } catch (e) { _note("读取存储用量失败", e); return null; }
};

// 单个键的估算占用（KB）
const sizeOf = (k) => {
  try {
    const v = wx.getStorageSync(k);
    if (v === "" || v === undefined || v === null) return 0;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return Math.round(s.length / 1024 * 10) / 10;
  } catch (e) { return 0; }
};

// ── 日期/时间格式化：全仓唯一出口（v1.20.8 / T2）────────────────────────────
// 原先 8 个页面各自写 String(n).padStart(2,"0") 拼日期（plan / index / more / myguides /
// ai-brain / travelsvc…），改一处漏一处：曾出现「有的地方带秒、有的不带」「跨零点后取到昨天」。
// 现在只保留这里一处，页面一律调 S.fmtLocalDate / S.fmtDateTime / S.fmtClock。
// 校验规则固化在 check-demo-quality.mjs：页面里再出现手写 padStart 日期拼接即判红。
const _p2 = (n) => (n < 10 ? "0" : "") + n;
// 入参可能不是 Date（fuzz 抓到 t.getFullYear is not a function）→ 尽力转换，失败退回今天
const _toDate = (t) => {
  if (t instanceof Date) return t;
  if (t) { const p = new Date(t); if (!isNaN(p.getTime())) return p; }
  return new Date();
};
const fmtLocalDate = (t) => {
  const d = _toDate(t);
  return d.getFullYear() + "-" + _p2(d.getMonth() + 1) + "-" + _p2(d.getDate());
};
// YYYY-MM-DD HH:mm（存档 / 历史列表用）
const fmtDateTime = (t) => {
  const d = _toDate(t);
  return fmtLocalDate(d) + " " + _p2(d.getHours()) + ":" + _p2(d.getMinutes());
};
// HH:mm（当天时刻提示，如「今天 08:05 出发」）
const fmtHM = (t) => {
  const d = _toDate(t);
  return _p2(d.getHours()) + ":" + _p2(d.getMinutes());
};
// HH:mm:ss（诊断日志时间戳用）
const fmtClock = (t) => {
  const d = _toDate(t);
  return _p2(d.getHours()) + ":" + _p2(d.getMinutes()) + ":" + _p2(d.getSeconds());
};

// v1.19.58：行程草稿（保存 / 恢复首页配置）。最多保留 20 条，超出丢弃最旧。
const DRAFT_KEY = "draftV1";
const DRAFT_CAP = 20;
const getDrafts = () => getArr(DRAFT_KEY);
const saveDraft = (d) => {
  const list = getArr(DRAFT_KEY);
  const i = list.findIndex(x => x && x.id === d.id);
  if (i >= 0) list[i] = d; else list.unshift(d);
  if (list.length > DRAFT_CAP) list.length = DRAFT_CAP;
  set(DRAFT_KEY, list);
  return list;
};
const delDraft = (id) => {
  const list = getArr(DRAFT_KEY).filter(x => x && x.id !== id);
  set(DRAFT_KEY, list);
  return list;
};

// v1.20.4 #81：JSON 序列化读写 —— 收敛散落各处的 `JSON.parse(wx.getStorageSync(...))` / `wx.setStorageSync(..., JSON.stringify(...))`。
// 读：空 / 非法 JSON 一律回落默认，绝不把异常抛给调用方或返回 undefined 透传炸弹（与 getArr/getObj 同设计）。
const getJSON = (k, def) => {
  try {
    const raw = wx.getStorageSync(k);
    if (raw === "" || raw === undefined || raw === null) return def;
    if (typeof raw !== "string") return raw;            // 已是对象（旧版本直存）则直接返回
    try { return JSON.parse(raw); } catch (e) { _note("JSON 解析失败: " + k, e); return def; }
  } catch (e) { _note("读取失败: " + k, e); return def; }
};

// 写：序列化失败（循环引用 / 不可序列化）回落 false，由调用方决定降级；不抛错。
// 2026-11-17：序列化失败也是「数据没存上」，原先纯静默 → 补一条留痕（含键名）。
const setJSON = (k, v) => {
  try { return set(k, JSON.stringify(v)); } catch (e) { _note("序列化失败（循环引用/不可序列化）: " + k, e); return false; }
};

module.exports = { get, getArr, getObj, set, del, usage, sizeOf, fmtLocalDate, fmtDateTime, fmtClock, getDrafts, saveDraft, delDraft, getJSON, setJSON };
