// pages/plan/p-svc.js —— 行程页外部服务（天气 / 城市深度玩法 / AI 答疑）（从 plan.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./plan-ctx.js");
const { app, T, S, A, W, EL, Cloud, AIAgent, AN, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

module.exports = {
 // 行程天气（和风天气 QWeather；首站城市预报，失败静默隐藏天气卡）
 _maybeLoadWx(plan) {
  const segs = Array.isArray(plan.segments) && plan.segments.length > 1;
  const segCity = plan.segments && plan.segments[0] && plan.segments[0].cityName;
  const d0 = plan.days && plan.days[0] ? String(plan.days[0].date) : "";
  const sig = (plan.cityName || "") + "|" + (plan.days ? plan.days.length : 0) + "|" + d0;
  if (this._wxSig === sig && (this.data.wxShow || this.data.wxOff)) return;
  this._wxSig = sig;
  if (this.data.wxShow) this.setData({ wxShow: false });
  this.setData({ wxLoading: true });
  // v1.19.153：回调改为 cb(list, err)；失败时按 err.type 给出可辨识文案，不再一律「天气暂不可用」
  W.fetchPlanWeather(plan, (list, err) => {
   if (err) {
     // type ∈ empty/env/no_key/nocity/quota/auth/param/api/net/window
     let msg = err.msg || "";
     if (!msg) {
       if (err.type === "empty") msg = "暂无行程，先生成一份攻略";
       else if (err.type === "env") msg = "当前环境不支持天气加载";
       else if (err.type === "nocity") msg = "未识别到行程城市";
       else if (err.type === "no_key") msg = "去「更多 → 合规与密钥」填入本人和风免费 Key，即时生效";
       else msg = "天气服务暂时异常";
     }
     // 仅「可能恢复」的失败（网络/额度/授权/服务异常/参数）才给重试；no_key/window/env/empty/nocity 重试无意义
     const recover = (err.type === "net" || err.type === "quota" || err.type === "auth" || err.type === "api" || err.type === "param");
     this.setData({ wxOff: true, wxShow: false, wxList: [], rainyShow: false, rainySpots: [], wxErrType: err.type || "api", wxErrMsg: msg, wxErrRetry: !!recover, wxLoading: false });
     return;
   }
   if (!list || !list.length) { this.setData({ wxOff: true, wxShow: false, wxList: [], rainyShow: false, rainySpots: [], wxErrType: "", wxErrMsg: "天气暂不可用", wxErrRetry: false, wxLoading: false }); return; }
   const today = T.fmtLocalDate(new Date());
   const wxList = list.map((w, wi) => {
    const p = String(w.date).split("-");
    // v1.11 UI 减法：湿度/UV/风 + 日出日落 原本是两行、且在 WXML 里靠三元拼字符串，
    // 现在合成一行预计算文本 —— 少一层容器、少一行高度、WXML 里零逻辑。
    const meta = [];
    if (w.hum != null) meta.push("湿" + w.hum + "%");
    if (w.uv != null) meta.push("UV" + w.uv);
    if (w.wind != null) meta.push("风" + w.wind + "km");
    if (w.sunrise) meta.push("日出" + w.sunrise);
    if (w.sunset) meta.push("日落" + w.sunset);
    return Object.assign({}, w, {
     di: wi,
     cityTx: w.city || "",
     dateText: p.length === 3 ? p[1] + "/" + p[2] : w.date,
     isToday: w.date === today,
     metaLine: meta.join(" · "),
     riskIcon: (w.risk && w.risk.icon) || "sun",
     riskTx: w.riskTx || "天气良好",
     tmaxTx: w.tmax != null ? w.tmax + "°" : "--",
     tminTx: w.tmin != null ? "/" + w.tmin + "°" : ""
    });
   });
   // v1.19.151：多城行程按各天所在城市预报；雨/雪天备选推「正在下雨/下雪的那座城」的室内/雨雪景
   const rainy = list.some(function (w) { return w.isRain || w.isSnow; });
   let rainySpots = [], rainyKinds = [], rainyKindsTx = "", rainyCity = "";
   if (rainy) {
     if (list.some(function (w) { return w.isSnow; })) rainyKinds.push("snow");
     if (list.some(function (w) { return w.isRain; })) rainyKinds.push("rain");
     for (let i = 0; i < list.length; i++) { if (list[i].isRain || list[i].isSnow) { rainyCity = list[i].city || ""; break; } }
     rainySpots = W.rainyDaySpots(rainyCity || segCity || plan.cityName, rainyKinds);
     if (rainyKinds.indexOf("snow") >= 0 && rainyKinds.indexOf("rain") >= 0) rainyKindsTx = "部分日期有雨 / 雪";
     else if (rainyKinds.indexOf("snow") >= 0) rainyKindsTx = "有降雪";
     else rainyKindsTx = "有降雨";
   }
   // v1.19.182：天气 × 行程联动 —— 把「雨天日」标注回日卡，并给出「优先室内/展馆」引导。
   // 不改 buildPlan 生成的行程顺序（保持 auto=1 复现确定性），仅在展示层加标注 + 引导。
   const _rainyDates = {};
   list.forEach(function (w) { if (w.isRain || w.isSnow) _rainyDates[String(w.date).slice(0, 10)] = 1; });
   const _indoorNames = (rainySpots || []).slice(0, 2).map(function (s) { return s.name; });
   const _indoorTx = _indoorNames.length ? ("雨天建议优先室内/展馆：" + _indoorNames.join("、")) : "雨天路滑，注意安全，优先安排室内景点";
   (plan.days || []).forEach(function (d, k) {
     const ds = String(d.date).slice(0, 10);
     if (_rainyDates[ds]) { d.isRainy = true; d.rainyHint = _indoorTx; }
     else { d.isRainy = false; d.rainyHint = ""; }
   });
   // 回写展示层：view 是 plan.days 的转换副本（转换段已拷贝 isRainy/rainyHint，重渲染不丢）
   if (Array.isArray(this.data.view)) {
     (plan.days || []).forEach(function (d, k) {
       if (this.data.view[k]) { this.data.view[k].isRainy = d.isRainy ? 1 : 0; this.data.view[k].rainyHint = d.rainyHint || ""; }
     }.bind(this));
   }
   const _longHint = (plan.days && plan.days.length > 7);
   // 多城/全省游：分段 >1 或同一份预报里出现不止一座城市 → 卡片标「各站按所在城市预报」并逐日显示城市
   const multi = !!segs || (wxList.length > 1 && wxList.some(function (w, i) { return i > 0 && w.city && wxList[0].city && w.city !== wxList[0].city; }));
   this.setData({ wxShow: true, wxOff: false, wxList: wxList, wxIsMulti: multi, wxLoading: false, wxErrType: "", wxErrMsg: "", wxErrRetry: false, rainyShow: rainySpots.length > 0, rainySpots: rainySpots, rainyKinds: rainyKinds, rainyKindsTx: rainyKindsTx, view: this.data.view, wxLongTripHint: _longHint });
  });
 },

 // C2：关闭「天气暂不可用」提示（本次行程记住，不再打扰）
  closeWxOff() {
    this._wxOffDismiss = this._wxSig || "";
    this.setData({ wxOff: false });
  },

  // v1.19.49：天气拉取失败（失败不写缓存）时给「重试」入口，弱网首拉失败可立即重拉
  onWxRetry() {
    const plan = app.globalData.plan;
    if (!plan) return;
    this._wxSig = "";           // 强制重新拉取（失败未缓存，重试会真实发请求）
    this.setData({ wxOff: false });
    this._maybeLoadWx(plan);
  },

  // 2026-11-09：天气未配置时给出可操作入口 —— 切到「更多」页配置和风 Key（仓库不内置明文 Key）
  goKeyConfig() {
    try { wx.switchTab({ url: "/pages/more/more" }); } catch (e) {}
  },

 _loadDeep(plan) {
  const cands = this._planCities(plan);
  const clear = () => { try { this.setData({ deep: null }); } catch (e) {} };
  if (!cands.length) { clear(); return; }
  const sig = this._planSig(plan);
  try {
   A.initDeep().then(() => {
    // 2026-11-09：异步落地前核对行程是否已切换 —— 否则旧城市的深度卡会贴到新行程上
    //（用户反馈：井冈山行程里显示了「太原 · 深度玩法」）。
    let cur = null;
    try { cur = app.globalData && app.globalData.plan; } catch (e) {}
    if (this._planSig(cur) !== sig) return;
    let hit = null;
    for (let i = 0; i < cands.length; i++) {
     if (A.hasDeep(cands[i])) { hit = cands[i]; break; }
    }
    // 新城市没有深度内容时必须清空，不能保留上一份行程的卡片
    if (!hit) { clear(); return; }
    const raw = A.deepOf(hit);
    if (!raw) { clear(); return; }
    let total = 0;
    const bs = raw.blocks || [];
    for (let i = 0; i < bs.length; i++) total += ((bs[i].items || []).length + (bs[i].trips || []).length);
    const teasers = (raw.teaser || []).slice(0, 3);
    // 渲染期可能已切走 / 已生成新行程，用 try 包住避免异步落地时页面已卸载
    try {
     this.setData({
      deep: { city: hit, updated: A.updatedAt(), total: total, teasers: teasers }
     });
    } catch (e) {}
   }).catch(() => {});
  } catch (e) {}
 },

 onDeep() {
  const d = this.data.deep;
  if (!d || !d.city) return;
  try {
   wx.navigateTo({ url: "/subai/deep/deep?city=" + encodeURIComponent(d.city) });
  } catch (e) {}
 },

  sendAI() {
    if (this.data.aiLoading) return;
  const q = (this.data.aiInput || "").trim();
  if (!q) { wx.showToast({ title: "先输入问题", icon: "none" }); return; }
  const self = this;
  // 云未开启 → 直接离线，不做无谓等待
  if (typeof Cloud.cloudEnabled === "function" && !Cloud.cloudEnabled()) {
   self.setData({ aiLoading: true });
   setTimeout(() => { self._aiOffline(q); }, 0);
   return;
  }
  self.setData({ aiLoading: true, aiErr: "" });
  AIAgent.ask("plan", q, self._aiCtx())
   .then((r) => {
    if (r && r.ok && r.text) self.setData({ aiAnswer: r.text, aiLoading: false, aiSource: r.source || "ai", aiErr: "" });
    else self._aiOffline(q);
   })
   .catch(() => { self._aiOffline(q); });
 },

 // ── 行程页 AI 答疑（云端强模型优先 · 离线规则引擎兜底 · 零白屏） ──
 openAI() {
  const plan = app.globalData && app.globalData.plan;
  if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "先生成行程再问 AI", icon: "none" }); return; }
  this.setData({ aiOpen: true, aiErr: "" });
 },

 closeAI() { this.setData({ aiOpen: false }); },

 onAIInput(e) { this.setData({ aiInput: e.detail.value }); },

 _aiCtx() {
  try { return Cloud.aiContextOf(app.globalData && app.globalData.plan, "每日行程页"); }
  catch (e) { return ""; }
 },

 _aiOffline(q) {
  const plan = app.globalData && app.globalData.plan;
  let r;
  try { r = T.askAssistant(q, plan); } catch (e) { r = { text: "暂时答不上来，换个问法试试" }; }
  this.setData({ aiAnswer: (r && r.text) || "", aiLoading: false, aiSource: "", aiErr: "" });
 },

  aiCopy() {
    const t = String(this.data.aiText || this.data.aiAnswer || this.data.lastResult || this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try {
      wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) });
    } catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },

  aiClearChat() {
    try { AIAgent.clearHistory("plan"); } catch (e) {}
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
};
