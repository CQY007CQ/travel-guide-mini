// pages/plan/p-share.js —— 行程页分享与导出（分享图 / 海报 / 日历 .ics）（从 plan.js 拆出，T4）
// 方法体原样搬运（tools/dev/page-split.mjs）：本对象被 Object.assign 进 Page 配置，
// this 仍指向页面实例，WXML 绑定名一字未变 —— 拆的是文件，不是行为。
const C = require("./plan-ctx.js");
const { app, T, S, A, W, EL, Cloud, AIAgent, AN, isFrame, thumbFor, MODE_LABEL, getSeason, ymdLocal } = C;

module.exports = {
  // v1.19.76：朋友圈/群分享长图 —— 把行程渲染成一张精美卡片，可转发图片或存相册发朋友圈
  // v1.19.199 真机「生成失败」修复（用户实机截图报障）：
  //   ① 旧版导出完全交给默认参数：canvas.width/height 已按 dpr 放大（如 1800×3936），
  //      而 wx.canvasToTempFilePath 的 destWidth/destHeight 默认还会再乘一次像素密度，
  //      高 dpr 安卓机直接申请超大图 → fail；同时画布 CSS 尺寸(600×2400) 与实际绘制
  //      逻辑尺寸(600×H) 不一致，默认导出区域越界。现显式给出导出矩形并把 dpr 钳到 2。
  //   ② 画布原放在 left:-10000rpx 视口外，部分真机渲染剔除导致 fields({node:true}) 拿不到节点。
  //   ③ 绘制后立刻导出，部分安卓 GPU 尚未提交会拿到空画布；现等一帧再导出。
  //   ④ 三个失败阶段全部 toast 同一句「生成失败」，无法定位；现分阶段日志 + 区分提示。
  onShareImg() {
    const that = this;
    const log = (stage, detail) => {
      try { console.warn("[shareImg] " + stage, detail || ""); } catch (e) {}
      try { EL.push("plan.onShareImg." + stage, detail); } catch (e) {}
    };
    const done = () => { that.__posterBusy = false; };
    const fail = (stage, detail, title) => {
      log(stage, detail); done();
      wx.hideLoading();
      wx.showToast({ title: title || "生成失败，请重试", icon: "none" });
    };
    wx.showLoading({ title: "生成中…" });
    that.__posterBusy = true;

    // 节点查询：首帧可能还没渲染出离屏 canvas，重试 3 次；最后一次不带 .in 兜底
    const findCanvas = (left) => {
      const q = wx.createSelectorQuery();
      const sq = left > 0 && q.in ? q.in(that) : q;
      sq.select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) return draw(node);
        if (left > 0) {
          const later = () => findCanvas(left - 1);
          if (typeof setTimeout === "function") setTimeout(later, 120); else later();
          return;
        }
        fail("node", "select #shareCanvas returned no node", "画布未就绪，请重试");
      });
    };

    const draw = (canvas, attempt) => {
      attempt = attempt || 0;
      try {
        // 高 dpr(3) 会让像素画布与输出图过大，钳到 2 兼顾清晰度与真机内存
        let dpr = 2;
        try { dpr = Math.min(2, Number((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2) || 2); } catch (e) {}
        const m = that._posterModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // 2026-11-09 真机：canvas 刚挂载/尚未绘制时部分机型会返回 null。
          // 已把 .share-canvas 从 z-index:-1 改到正层级，这里再给两次短重试兜底。
          if (attempt < 2) { setTimeout(() => draw(canvas, attempt + 1), 120); return; }
          return fail("draw", "getContext(2d) returned null after retries", "绘图失败，请重试");
        }
        // setTransform 而非 scale：共用节点时避免残留变换叠加
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else ctx.scale(dpr, dpr);
        that._drawPoster(ctx, m.W, m);
        // 导出参数三档降级，兼容基础库对 width/height 的两种单位口径（逻辑 px / 物理 px）
        const variants = [
          { x: 0, y: 0, width: m.W, height: m.H, destWidth: m.W * dpr, destHeight: m.H * dpr },
          { x: 0, y: 0, width: canvas.width, height: canvas.height, destWidth: canvas.width, destHeight: canvas.height },
          {}
        ];
        const exportAt = (i) => {
          if (i >= variants.length) return fail("export", "all canvasToTempFilePath variants failed", "导出失败，请重试");
          wx.canvasToTempFilePath(Object.assign({
            canvas,
            fileType: "png",
            success(r) {
              done(); wx.hideLoading();
              const path = r && r.tempFilePath;
              if (!path) return exportAt(i + 1);
              const save = () => wx.saveImageToPhotosAlbum({
                filePath: path,
                success() { wx.showToast({ title: "已存相册，去朋友圈发吧", icon: "none" }); },
                fail() { wx.previewImage({ urls: [path], showmenu: true }); }
              });
              if (wx.showShareImageMenu) wx.showShareImageMenu({ path: path, fail: save });
              else save();
            },
            fail(e) { log("export.variant" + i, (e && (e.errMsg || e.message)) || e); exportAt(i + 1); }
          }, variants[i]));
        };
        const next = () => exportAt(0);
        if (canvas.requestAnimationFrame) {
          try { canvas.requestAnimationFrame(next); } catch (e) { setTimeout(next, 30); }
        } else if (typeof setTimeout === "function") { setTimeout(next, 30); } else { next(); }
      } catch (e) { fail("draw", e, "绘图失败，请重试"); }
    };

    findCanvas(2);
  },

  _ensureShareCard() {
    const plan = app.globalData.plan;
    if (!plan || !plan.days || !plan.days.length) return;
    // v1.19.199：与「生成分享图」共用同一 canvas，海报绘制中让一让，避免互相覆盖
    if (this.__posterBusy) {
      if (typeof setTimeout === "function") setTimeout(() => { try { this._ensureShareCard(); } catch (e) {} }, 600);
      return;
    }
    const stamp = (plan.savedAt || 0) + "|" + (plan.cityName || "") + "|" + plan.days.length;
    if (this.__shareStamp === stamp && this.__shareImg) return;   // 行程没变不重画
    this.__shareStamp = stamp;
    const that = this;
    wx.createSelectorQuery().in(this).select("#shareCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      try {
        const canvas = res[0].node;
        let dpr = 2;
        try { dpr = Math.min(2, Number((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2) || 2); } catch (e) {}
        const m = that._shareCardModel();
        canvas.width = m.W * dpr; canvas.height = m.H * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else ctx.scale(dpr, dpr);
        that._drawShareCard(ctx, m.W, m);
        // v1.19.199：显式导出矩形（同 onShareImg 根因），失败再按物理像素口径降级一次
        const exp = () => wx.canvasToTempFilePath({
          canvas,
          x: 0, y: 0,
          width: m.W, height: m.H,
          destWidth: m.W * dpr, destHeight: m.H * dpr,
          fileType: "png",
          success(r) { that.__shareImg = r.tempFilePath; },
          fail() {
            wx.canvasToTempFilePath({
              canvas,
              x: 0, y: 0,
              width: canvas.width, height: canvas.height,
              destWidth: canvas.width, destHeight: canvas.height,
              fileType: "png",
              success(r2) { that.__shareImg = r2.tempFilePath; },
              fail() { that.__shareImg = null; }
            });
          }
        });
        if (canvas.requestAnimationFrame) {
          try { canvas.requestAnimationFrame(exp); } catch (e) { exp(); }
        } else { exp(); }
      } catch (e) { /* 静默：回退纯文字卡片 */ }
    });
  },

  _shareCardModel() {
    return C.PP.shareCardModel(this.data, app.globalData.plan);
  },

  _drawShareCard(ctx, cw, m) {
    C.PP.drawShareCard(ctx, cw, m);
  },

  _posterModel() {
    return C.PP.posterModel(this.data, app.globalData.plan);
  },

  _drawPoster(ctx, cw, m) {
    C.PP.drawPoster(ctx, cw, m);
  },

  _rrect(ctx, x, y, w, h, r) {
    C.PP.rrect(ctx, x, y, w, h, r);
  },

  _fit(ctx, text, maxW, fontPx) {
    return C.PP.fit(ctx, text, maxW, fontPx);
  },

  onShareAppMessage() {
    const plan = app.globalData.plan;
    const city = plan ? (plan.cityName || "") : "";
    const days = plan && plan.days ? plan.days.length : 0;
    // v1.19.76：分享带 city/days 深链参数，对方点开直达「已填好该城市的出发页」，提升搜索/分享获客
    // v1.19.180：再带上 depart/pace/budget/mode 与 auto=1 —— 行程生成是确定性的，
    //            参数齐了对方点开即可复现同一份行程（同款攻略），不用自己再调一遍选项。
    const q = [];
    if (city) q.push("city=" + encodeURIComponent(city));
    if (days) q.push("days=" + days);
    try {
      const d0 = plan && plan.days && plan.days[0] && plan.days[0].date;
      if (d0) q.push("depart=" + encodeURIComponent(String(d0).slice(0, 10)));
      if (plan && plan.pace) q.push("pace=" + encodeURIComponent(plan.pace));
      if (plan && plan.budget) q.push("budget=" + encodeURIComponent(plan.budget));
      // v1.19.193：自定义预算（budget=custom）必须一并带上总预算金额，否则对方 auto=1 复现时
      // 取不到 customAmt，generate() 会因「请输入全行程总预算」而卡住，复现同款行程失败。
      if (plan && plan.budget === "custom" && plan.customAmt) q.push("amt=" + encodeURIComponent(String(plan.customAmt)));
      if (plan && plan.travelMode) q.push("mode=" + encodeURIComponent(plan.travelMode));
      if (city && days) q.push("auto=1");
    } catch (e) {}
    const path = "/pages/index/index" + (q.length ? "?" + q.join("&") : "");
    const ret = {
      // v1.20.32：分享卡片标题会直接出现在微信会话里，旧脏档的编码城市名必须解码后再拼
      title: (plan ? "我做了份「" + T.decQuery(plan.cityName || "") + "·" + days + "天攻略」，景点路线美食都排好了" : "旅行攻略生成器") + "（离线可用）",
      path: path
    };
    // v1.19.88：转发卡片换黑金分享图（_ensureShareCard 惰性生成；未生成完回退默认卡片，不阻塞分享）
    if (this.__shareImg) ret.imageUrl = this.__shareImg;
    return ret;
  },

 /* ---- 导出 .ics 日历（复制文本 → 粘贴到文件助手 / 邮件，导入系统日历） ---- */
 onExportICS() {
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days.length) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  const dep = plan.depart || (plan.days[0] && plan.days[0].date) || "";
  const lastDay = plan.days[plan.days.length - 1];
  const endD = (lastDay && lastDay.date) || dep;
  const nm = plan.isProv ? plan.province : (plan.cityName || "");
  // v1.17.10：简化为一键写入手机系统日历（微信原生 API），不再要求用户复制 .ics 再手动导入
  if (typeof wx.addPhoneCalendar === "function") {
   const mk = (s, hh) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? Math.floor(new Date(+m[1], +m[2] - 1, +m[3], hh, 0, 0).getTime() / 1000) : Math.floor(Date.now() / 1000);
   };
   wx.addPhoneCalendar({
    title: (nm || "旅行") + "行程 · " + plan.days.length + " 天",
    description: "共 " + plan.days.length + " 天，出发 " + dep + (plan.days[0] && plan.days[0].theme ? " · " + plan.days[0].theme : ""),
    startTime: mk(dep, 9),
    endTime: mk(endD, 21),
    alarm: true,
    alarmOffset: 3600,
    // 网页版把同一份日程导出成 .ics 文件下载（runtime 的 addPhoneCalendar），
    // 文案不能承诺「已加入手机日历」；用 getAccountInfoSync 区分，不碰废弃 API。
    success: () => {
     let isWeb = false;
     try { isWeb = !!(wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.appId === "web"); } catch (e) {}
     wx.showToast({ title: isWeb ? "已下载日历文件（.ics）" : "已加入手机日历", icon: "success" });
    },
    fail: () => this._shareICS(plan)
   });
   return;
  }
  this._shareICS(plan);
 },

 // 2026-11-09：小程序里没有 wx.addPhoneCalendar（写系统日历）→ 生成 .ics 并调起「发送到聊天」，
  // 用户在手机上点开该文件即可导入系统日历。任何异常都退回「复制 .ics 文本」。
 _shareICS(plan) {
  let ics = "";
  try { ics = T.exportICS(plan) || ""; } catch (e) { ics = ""; }
  if (!ics) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  try {
   const fsm = wx.getFileSystemManager ? wx.getFileSystemManager() : null;
   const dir = (wx.env && wx.env.USER_DATA_PATH) || "";
   if (!fsm || !dir) return this._icsCopy(plan);
   const path = dir + "/trip_" + Date.now() + ".ics";
   fsm.writeFileSync(path, ics, "utf8");
   if (typeof wx.shareFileMessage === "function") {
    wx.shareFileMessage({
     filePath: path,
     fileName: "行程日历.ics",
     fail: () => this._icsCopy(plan)
    });
   } else {
    this._icsCopy(plan);
   }
  } catch (e) { this._icsCopy(plan); }
 },

 // 兜底：旧版微信/不支持 addPhoneCalendar 时，退回「复制 .ics」
 _icsCopy(plan) {
  const ics = T.exportICS(plan);
  if (!ics) { wx.showToast({ title: "暂无行程可导出", icon: "none" }); return; }
  wx.setClipboardData({
   data: ics,
   success: () => wx.showModal({
    title: "已复制日历文件",
    content: "共 " + plan.days.length + " 天行程 · 粘贴到微信「文件传输助手」或邮件，在手机里打开 .ics 即可加入系统日历",
    showCancel: false, confirmText: "好的"
   })
  });
 },
};
