/**
 * tools/test/_wx-shim.mjs —— 测试用 wx 垫片（共享）
 *
 * 为什么需要它：
 *   utils/store.js 的读写在拿不到 wx 时会走 catch 分支返回默认值（线上这是对的降级），
 *   于是「没装垫片」的测试会在**空存储**上跑，断言看着通过、实际没验存储行为。
 *   测「跨会话偏好」「草稿」「记账」这类必须落盘的功能，不装垫片等于没测。
 *
 * 用法：
 *   import { installWxShim } from "./_wx-shim.mjs";
 *   const shim = installWxShim();          // 装到 globalThis.wx，返回操作句柄
 *   shim.dump();                           // 看当前存储内容
 *   shim.reset();                          // 清空（模拟新会话）
 */
export function installWxShim(opts = {}) {
  const store = new Map();
  const failOn = opts.failOn || null;         // 传 "set" 可模拟存储写入失败（配额满）

  const wx = {
    getStorageSync(k) {
      if (!store.has(k)) return "";
      const v = store.get(k);
      return v === undefined ? "" : v;
    },
    setStorageSync(k, v) {
      if (failOn === "set") throw new Error("setStorageSync:fail exceed max size");
      store.set(k, v);
    },
    removeStorageSync(k) { store.delete(k); },
    clearStorageSync() { store.clear(); },
    getStorageInfoSync() {
      const keys = [...store.keys()];
      const current = keys.reduce((n, k) => n + JSON.stringify(store.get(k)).length, 0);
      return { keys, currentSize: Math.ceil(current / 1024), limitSize: 10240 };
    },
    // data.js 的 b64ToBytes 优先走这条；缺了它会拿到 undefined → pako 抛 buffer error → 数据整块为空
    base64ToArrayBuffer(b64) {
      const buf = Buffer.from(String(b64 || ""), "base64");
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    arrayBufferToBase64(ab) { return Buffer.from(ab).toString("base64"); },
    showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
    showModal(o) { if (o && o.success) o.success({ confirm: false, cancel: true }); },
    getSystemInfoSync() {
      return { pixelRatio: 2, windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: "devtools" };
    },
    createSelectorQuery() {
      const q = { in() { return q; }, select() { return q; }, fields() { return q; }, exec(cb) { if (cb) cb([]); return q; } };
      return q;
    },
  };

  globalThis.wx = wx;

  return {
    wx,
    raw: store,
    dump: () => Object.fromEntries(store),
    reset: () => store.clear(),
    /** 模拟「关掉 App 再打开」：清掉内存态但保留存储（store.js 的 _warned 之类不受影响） */
    newSession: () => { store; },
  };
}
