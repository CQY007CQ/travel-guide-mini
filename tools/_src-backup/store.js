// wx 存储封装（对齐网页版 localStorage 用法）+ 通用格式化
// v1.10.1：写入失败不再静默吞掉（配额满会让用户以为保存成功），改为返回 false + 节流提示
// v1.11.0：新增类型守卫（getArr / getObj）—— 读到脏数据/旧版本结构时降级为默认值，
//           而不是把炸弹透传下去让页面在 _sync 里崩掉。
// 【设计决策】曾尝试做「会话级读缓存」提升性能，最终否决：本项目存在多处绕过本封装
//   直接调用 wx.setStorageSync 的路径（不同页面各自维护 storage），单向缓存会读到过期值，
//   比少一次同步读（getStorageSync 本身就是内存读，开销极小）危险得多。
//   因此这里只做校验与统一失败提示，不做缓存；业务侧需要复用请自己在闭包里暂存。
const get = (k, def) => {
  try {
    const v = wx.getStorageSync(k);
    return v === "" || v === undefined || v === null ? def : v;
  } catch (e) { return def; }
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

const del = (k) => { try { wx.removeStorageSync(k); } catch (e) {} };

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
  } catch (e) { return null; }
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

// v1.11：入参可能不是 Date（fuzz 抓到 t.getFullYear is not a function）→ 尽力转换，失败退回今天
const fmtLocalDate = (t) => {
  let d = t instanceof Date ? t : null;
  if (!d && t) { const p = new Date(t); if (!isNaN(p.getTime())) d = p; }
  if (!d) d = new Date();
  return d.getFullYear() + "-"
    + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

module.exports = { get, getArr, getObj, set, del, usage, sizeOf, fmtLocalDate, getDrafts, saveDraft, delDraft };
