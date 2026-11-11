// utils/cloud.js —— 微信云开发 / 网页版 CloudBase 统一接入层
//
// 目标：小程序与网页版共用同一云环境 / 集合（users/plans/wishes/footprints/notes/feedback/ai_cache），
//       实现「小程序生成的行程，网页版能接着看；网页版收藏的足迹，小程序能看到」的互通。
//
// 两端实现：
//   · 小程序端：基于原生 wx.cloud（零适配，Key 只放云函数，绝不下发）
//   · 网页端：基于 @cloudbase/js-sdk（由 web/lib/cloud-web.js 适配器预先 init 并挂到 window.__cloudbase）
//
// 合规铁律（呼应高德 Key 泄露教训）：
//   · 云环境 ID 走配置（keys.cloudEnv），绝不写死进 git；缺失即 fail-closed，云端能力整体降级，不抛错阻断主流程。
//   · 真正的密钥（LLM Key 等）只存在于云函数环境变量，小程序 / 网页端代码里一个字都不出现。
//
// 设计原则：本地优先。云同步是「增强项」，任何联网失败都回落本地，绝不阻塞行程本身。

const KEYS = require("./keys.js");
const S = require("./store.js");
const T = require("./travel.js");   // grounding 助手（预算/阶段/花费/想去/天气快照/体检），零伪造只读本机数据

let _inited = false;
let _initPromise = null;
let _uid = null;
const UID_KEY = "__uid__";
const OPENID_KEY = "__openid__";

// 配对同步码：跨端（小程序 ↔ 网页版）共享同一 uid 的机制。
// 用户在一端点「复制同步码」，另一端「输入同步码」粘贴，即把本地 uid 锁定为同一串，
// 从而在云端同一集合下共享行程 —— 无需登录体系，零合规风险。
const PAIRED_KEY = "__paired_uid__";
function getPairedUid() {
  try { return S.get(PAIRED_KEY, "") || ""; } catch (e) { return ""; }
}
function setPairedUid(code) {
  try {
    code = String(code == null ? "" : code).trim();
    if (!/^u_[a-z0-9]{6,}$/.test(code)) return false;   // 仅接受本 App 生成的同步码格式
    S.set(PAIRED_KEY, code);
    _uid = code;
    return true;
  } catch (e) { return false; }
}
function clearPairedUid() {
  try { S.del(PAIRED_KEY); } catch (e) {}
}

// 是否运行在网页版（@cloudbase/js-sdk 适配器已挂 window.__cloudbase）。
// 注意：网页版 runtime 也提供 window.wx 垫片，所以不能用「typeof wx === undefined」判别，
// 必须以「window.__cloudbase 是否被适配器挂载」为唯一判据，否则会误走 wx.cloud 分支。
function isWeb() {
  try {
    return (typeof window !== "undefined") && !!(window.__cloudbase);
  } catch (e) { return false; }
}

// 云环境 ID（fail-closed：无则 null → 云能力整体关闭）
function cloudEnv() {
  if (!KEYS.cloudEnv) return null;
  return KEYS.cloudEnv();
}

function cloudEnabled() { return !!cloudEnv(); }

// 初始化（幂等）。小程序 init wx.cloud；网页端由适配器预先 init，这里只确认存在。
function init() {
  if (_inited) return _initPromise || Promise.resolve(false);
  _inited = true;
  _initPromise = (function () {
    return new Promise(function (resolve) {
      try {
        const env = cloudEnv();
        if (!env) { resolve(false); return; }
        if (isWeb()) {
          const cb = (typeof window !== "undefined") && window.__cloudbase;
          resolve(!!cb);
          return;
        }
        if (typeof wx !== "undefined" && wx.cloud) {
          if (typeof wx.cloud.init === "function") {
            wx.cloud.init({ env: env, traceUser: true });
            resolve(true);
          } else resolve(false);
        } else resolve(false);
      } catch (e) { resolve(false); }
    });
  })();
  return _initPromise;
}

// 通道是否真正可用
function ready() {
  try {
    if (isWeb()) return (typeof window !== "undefined") && !!(window.__cloudbase);
    return (typeof wx !== "undefined") && !!(wx.cloud && typeof wx.cloud.callFunction === "function");
  } catch (e) { return false; }
}

// 统一 callFunction（Promise 化）
function callFunction(name, data) {
  return new Promise(function (resolve, reject) {
    try {
      if (isWeb()) {
        const cb = (typeof window !== "undefined") && window.__cloudbase;
        if (!cb || typeof cb.callFunction !== "function") { reject(new Error("cloud-web-not-ready")); return; }
        cb.callFunction({ name: name, data: data || {} })
          .then(function (res) { resolve(res && res.result); })
          .catch(function (err) { reject(err); });
        return;
      }
      if (typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
        reject(new Error("cloud-not-ready")); return;
      }
      wx.cloud.callFunction({
        name: name,
        data: data || {},
        success: function (res) { resolve(res && res.result); },
        fail: function (err) { reject(err); }
      });
    } catch (e) { reject(e); }
  });
}

// 本机匿名 uid（跨端合并的兜底标识）。先读缓存，没有则生成。
function localUid() {
  try {
    if (_uid) return _uid;
    let u = S.get(UID_KEY, "");
    if (!u) {
      u = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      S.set(UID_KEY, u);
    }
    _uid = u;
    return u;
  } catch (e) { return "u_anon_" + Math.random().toString(36).slice(2, 8); }
}

// 确保拿到跨端一致的 uid：小程序优先 openid（经云函数同步回写），失败回落本地 guid。
function ensureUid() {
  return new Promise(function (resolve) {
    // 配对同步码优先：一旦两端用同一同步码关联，uid 即一致，云端数据自然互通
    const paired = getPairedUid();
    if (paired) { _uid = paired; resolve(paired); return; }
    const local = localUid();
    if (isWeb()) { resolve(local); return; }
    if (!ready()) { resolve(local); return; }
    callFunction("syncPlan", { action: "whoami" })
      .then(function (r) {
        if (r && r.openid) {
          _uid = r.openid;
          try { S.set(OPENID_KEY, r.openid); } catch (e2) {}
          resolve(r.openid);
        } else resolve(local);
      })
      .catch(function () { resolve(local); });
  });
}

// ── AI 接入（共用云端 llmProxy 强模型网关，fail-closed） ──
// 组装本地真实上下文（行程 / 景点 / 城市 / 预算），作为 grounding 注入 LLM。
// 零伪造：这里只读取用户本机已有行程数据，不编造任何坐标 / 票价 / 医院。
// 组装本地真实上下文（行程 / 景点 / 城市 / 预算 / 天气 / 花费 / 想去清单），作为 grounding 注入 LLM。
// 零伪造：这里只读取用户本机已有行程数据，不编造任何坐标 / 票价 / 医院 / 天气。
// 每个派生维度都用 try/catch 隔离，任一助手缺失都不会让整段上下文失效（强模型调用永不因此崩）。
function aiContextOf(plan, page) {
  const lines = [];
  if (page) lines.push("当前页面：" + String(page) + "（旅行攻略生成器 App）。");
  if (!plan || !plan.days || !plan.days.length) {
    lines.push("用户当前没有行程。");
    return lines.join("\n");
  }
  lines.push("当前行程：" + (plan.cityName || "") + "，" + plan.days.length + " 天；出发日 " + String(plan.depart || "").slice(0, 10) + "。");
  const paceMap = { leisure: "轻松", balance: "平衡", speed: "特种兵" };
  if (plan.pace) lines.push("节奏：" + (paceMap[plan.pace] || plan.pace) + "。");
  if (plan.people) lines.push("同行人数：" + plan.people + " 人。");
  // 交通方式（真实字段，绝不编造）
  if (plan.travelMode) {
    const mm = { walking: "步行", transit: "公共交通", driving: "自驾", cycling: "骑行", metro: "地铁" };
    lines.push("交通偏好：" + (mm[plan.travelMode] || plan.travelMode) + "。");
  }
  // 预算进度（budgetGauge 已统一 customAmt 与档位；仅在用户实际设过预算时披露，避免把默认 900 当真）
  if (plan.budget || plan.customAmt) {
    try {
      const bg = T.budgetGauge(plan);
      if (bg && bg.txt) lines.push("预算：" + bg.txt + (bg.over ? "（已超预算，提醒控制）" : "") + "。");
    } catch (e) {}
  }
  // 行程阶段 / 倒计时（before / during / after）
  try {
    const ts = T.todayState(plan);
    if (ts && ts.phase === "before" && ts.daysLeft != null) lines.push("距出发还有 " + ts.daysLeft + " 天（尚未出行）。");
    else if (ts && ts.phase === "during") lines.push("行程正在进行中。");
    else if (ts && ts.phase === "after") lines.push("行程已结束（可作复盘）。");
  } catch (e) {}
  // 本机已记花费（真实记账，无则省略，不虚报）
  try {
    const today = T.todaySpent(), total = T.totalSpent();
    if (total > 0) lines.push("本机已记录花费：今日 ¥" + Math.round(today) + " / 累计 ¥" + Math.round(total) + "。");
  } catch (e) {}
  // 去重景点（≤30）
  const seen = new Set(), spots = [];
  for (const d of plan.days) {
    if (!d || !Array.isArray(d.items)) continue;
    for (const it of d.items) {
      const n = (it && (it.name || it.disp)) || "";
      if (!n) continue;
      const k = String(n);
      if (seen.has(k)) continue;
      seen.add(k); spots.push(n);
      if (spots.length >= 30) break;
    }
    if (spots.length >= 30) break;
  }
  if (spots.length) lines.push("这趟要去的点（去重，" + spots.length + " 个）：" + spots.join("、") + "。");
  // 想去清单（本机收藏，无则省略）
  try {
    const city = (T.activeCityOf && T.activeCityOf(plan)) || plan.cityName || "";
    if (city) {
      const wish = T.wishPicksFor(city) || [];
      if (wish.length) lines.push("用户在本机还收藏了想去（" + city + "，" + wish.length + " 个）：" + wish.slice(0, 15).join("、") + (wish.length > 15 ? " 等" : "") + "。");
    }
  } catch (e) {}
  // 天气缓存快照（本地缓存、非实时，明确标注，绝不冒充实时天气）
  try {
    const snap = S.get("svcWxSnapV1", null);
    if (snap && snap.day && typeof snap.day === "object") {
      const d = snap.day;
      let w = "最高 " + (d.tmax != null ? d.tmax : "?") + "℃/最低 " + (d.tmin != null ? d.tmin : "?") + "℃";
      if (d.isSnow) w += "，有雪"; else if (d.isThunder) w += "，雷雨"; else if (d.isRain) w += "，有雨";
      if (typeof d.wind === "number" && d.wind >= 40) w += "，大风";
      lines.push("天气（本地缓存、" + (snap.date || "未知日期") + "、非实时）：" + w + "。");
    }
  } catch (e) {}
  // 客流经验提示（非实时离线规则，不伪装实时拥挤度）
  try {
    const fd = plan.depart ? String(plan.depart).slice(0, 10) : "";
    if (fd) {
      const ct = T.crowdTipOf(fd);
      if (ct && ct.txt) lines.push("出发日客流经验提示（非实时）：" + ct.txt + "。");
    }
  } catch (e) {}
  // 行程体检（真实自检分 + 建议）
  try {
    const ck = T.planCheckup(plan);
    if (ck && typeof ck.score === "number") {
      let s = "行程自检 " + ck.score + " 分";
      if (Array.isArray(ck.tips) && ck.tips.length) s += "；建议：" + ck.tips.slice(0, 2).join("；") + "。";
      lines.push(s);
    }
  } catch (e) {}
  return lines.join("\n");
}

// 云端调用超时保护：云函数冷启动 / 网络挂起时，超时即返回 { ok:false } 让调用方回落离线，
// 避免页面 showLoading 无限转。返回 Promise 永远 resolve，绝不 reject。
function withTimeout(p, ms) {
  return new Promise(function (resolve) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve({ ok: false, err: "timeout" });
    }, ms);
    const finish = function (v) {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {}
      resolve(v);
    };
    p.then(finish).catch(function (e) { finish({ ok: false, err: String((e && e.message) || e) }); });
  });
}

// 调云端 llmProxy：传入对话 / 单轮问题 + 本地上下文，返回 { ok, text, model, source }。
// 任何失败（云未开 / 未配置 / 网络错 / 超时）都返回 { ok:false }，调用方必须回落离线引擎，绝不白屏。
function aiChat(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (!cloudEnabled()) { resolve({ ok: false, err: "cloud-disabled" }); return; }
    const payload = {
      messages: Array.isArray(opts.messages) ? opts.messages : null,
      prompt: (typeof opts.prompt === "string" && opts.prompt.trim()) ? opts.prompt.trim() : null,
      system: (typeof opts.system === "string" && opts.system.trim()) ? opts.system.trim() : null,
      context: (typeof opts.context === "string" && opts.context.trim()) ? opts.context.trim() : null,
      model: (typeof opts.model === "string" && opts.model.trim()) ? opts.model.trim() : null,
      temperature: (typeof opts.temperature === "number") ? opts.temperature : null,
      max_tokens: (typeof opts.max_tokens === "number" && opts.max_tokens > 0) ? opts.max_tokens : null
    };
    withTimeout(callFunction("llmProxy", payload), 15000).then(function (r) {
      if (r && r.ok && r.text) resolve({ ok: true, text: String(r.text), model: r.model || "", source: r.source || "ai" });
      else resolve({ ok: false, err: (r && r.err) || "ai-failed", raw: r });
    });
  });
}

// 上传本地图片到云存储，返回 fileID（拍照识物用；小程序端）。
function uploadImage(filePath) {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error("upload-timeout"));
    }, 20000);
    const ok = function (v) { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} resolve(v); };
    const bad = function (e) { if (done) return; done = true; try { clearTimeout(timer); } catch (e2) {} reject(e); };
    try {
      if (isWeb()) { bad(new Error("web-upload-unsupported")); return; }
      if (typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.uploadFile !== "function") {
        bad(new Error("cloud-not-ready")); return;
      }
      if (!filePath) { bad(new Error("empty-file-path")); return; }
      const m = String(filePath).match(/\.(\w+)$/);
      const ext = m ? m[1] : "jpg";
      const cloudPath = "lens/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath,
        success: function (res) { ok((res && res.fileID) || ""); },
        fail: function (err) { bad(err); }
      });
    } catch (e) { bad(e); }
  });
}

// 视觉识别：把图片 fileID / base64 交给 llmProxy（多模态强模型），返回同 aiChat 的结构。
function aiVision(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (!cloudEnabled()) { resolve({ ok: false, err: "cloud-disabled" }); return; }
    const payload = {
      prompt: (typeof opts.prompt === "string" && opts.prompt.trim()) ? opts.prompt.trim() : null,
      system: (typeof opts.system === "string" && opts.system.trim()) ? opts.system.trim() : null,
      context: (typeof opts.context === "string" && opts.context.trim()) ? opts.context.trim() : null,
      imageFileID: opts.imageFileID || null,
      imageBase64: opts.imageBase64 || null,
      model: (typeof opts.model === "string" && opts.model.trim()) ? opts.model.trim() : null,
      max_tokens: (typeof opts.max_tokens === "number" && opts.max_tokens > 0) ? opts.max_tokens : 700
    };
    if (!payload.imageFileID && !payload.imageBase64) { resolve({ ok: false, err: "no-image" }); return; }
    withTimeout(callFunction("llmProxy", payload), 20000).then(function (r) {
      if (r && r.ok && r.text) resolve({ ok: true, text: String(r.text), model: r.model || "", source: r.source || "ai" });
      else resolve({ ok: false, err: (r && (r.hint || r.err)) || "vision-failed", raw: r });
    });
  });
}

module.exports = {
  isWeb: isWeb,
  cloudEnv: cloudEnv,
  cloudEnabled: cloudEnabled,
  init: init,
  ready: ready,
  callFunction: callFunction,
  localUid: localUid,
  ensureUid: ensureUid,
  getPairedUid: getPairedUid,
  setPairedUid: setPairedUid,
  clearPairedUid: clearPairedUid,
  aiContextOf: aiContextOf,
  aiChat: aiChat,
  uploadImage: uploadImage,
  aiVision: aiVision
};
