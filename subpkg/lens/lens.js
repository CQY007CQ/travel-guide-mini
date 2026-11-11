const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// lens：AI 识物 · 旅途科普（拍照 / 相册 → 云端多模态强模型识别 → 科普小贴士）
// 设计原则：云端优先、离线诚实降级。识别依赖云端视觉模型（llmProxy + 多模态 LLM_MODEL），
// 未配置时明确告知并引导「文字问」，绝不伪造识别结果。
const T = require("../../utils/travel.js");
const Cloud = require("../../utils/cloud.js");
const AIAgent = require("../../utils/ai-agent.js");
const AI = require("../assistant/ai-brain.js");   // 离线 AI 大脑（无云时文字问兜底，零网络）
const EL = require("../../utils/errlog.js");
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    imgs: [],           // 本地临时图（最多 3 张，多角度提升识别率）
    loading: false,
    result: "",         // AI 识别 / 回答结果
    source: "",         // 来源标识（显示「AI 生成」）
    voted: false,       // 是否触发二次核验（多链投票）
    err: "",            // 失败/未配置提示
    cloudOn: false,     // 云端是否开启
    textMode: false,    // 文字问模式
    textInput: "",
    cityName: "",
    // v1.20.7：识物联动 —— 识别结果解析出的实体名 / 本地查到的景点资料 / 查不到时的提示
    spotName: "",       // 从识别结果解析出的主体名称（供「查景点 / 加入行程」联动）
    spotInfo: null,     // 本地命中资料 {name,intro,how,route,city}
    spotErr: ""         // 查不到时的提示（空表示已命中）
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  onLoad() { this.__boot = T.ready().catch(() => null); },

  onShow() {
    onShowRender(this, "lens", null, () => {
      try {
        const plan = app.globalData && app.globalData.plan;
        const city = plan ? (T.activeCityOf(plan) || plan.cityName || "") : "";
        this.setData({ cloudOn: Cloud.cloudEnabled(), cityName: city || "" });
      } catch (e) { try { EL.push("lens.onShow", e); } catch (_) {} }
    });
  },

  _renderShow() { try { this._theme(); } catch (e) {} },

  onShareAppMessage() {
    return { title: "AI 识物：旅途中拍照认植物、地标，随手科普", path: "/pages/index/index" };
  },

  takePhoto() { this._choose(["camera"]); },
  pickAlbum() { this._choose(["album"]); },

  _choose(sourceType) {
    const self = this;
    const remain = 3 - this.data.imgs.length;
    if (remain <= 0) { wx.showToast({ title: "最多 3 张，可先删除", icon: "none" }); return; }
    try {
      if (typeof wx.chooseMedia === "function") {
        wx.chooseMedia({
          count: remain, mediaType: ["image"], sourceType: sourceType, camera: "back",
          success: (res) => {
            const fs = (res && res.tempFiles) || [];
            const paths = fs.map(function (f) { return f.tempFilePath; }).filter(Boolean);
            if (paths.length) self._addImgs(paths);
          },
          fail: () => {}   // 用户取消不打扰
        });
      } else if (typeof wx.chooseImage === "function") {
        wx.chooseImage({
          count: remain, sourceType: sourceType,
          success: (res) => {
            const ps = (res && res.tempFilePaths) || [];
            if (ps.length) self._addImgs(ps);
          },
          fail: () => {}
        });
      } else {
        wx.showToast({ title: "当前版本不支持选图", icon: "none" });
      }
    } catch (e) { wx.showToast({ title: "打开相机失败", icon: "none" }); }
  },

  _addImgs(paths) {
    const next = this.data.imgs.concat(paths).slice(0, 3);
    this.setData({ imgs: next, result: "", source: "", err: "", voted: false, spotName: "", spotInfo: null, spotErr: "" });
  },
  removeImg(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    const next = this.data.imgs.slice();
    next.splice(i, 1);
    this.setData({ imgs: next, result: "", source: "", err: "", voted: false, spotName: "", spotInfo: null, spotErr: "" });
  },
  clearImgs() { this.setData({ imgs: [], result: "", source: "", err: "", voted: false, spotName: "", spotInfo: null, spotErr: "" }); },

  _prompt() {
    const city = this.data.cityName ? ("当前所在城市：" + this.data.cityName + "。") : "";
    return city +
      "请识别这张（这些）照片里的主体（植物 / 动物 / 地标 / 建筑 / 美食 / 器物等）。用简体中文严格按以下结构作答：\n" +
      "①名称：最可能是什么（俗名或学名），并给出你的置信度（高 / 中 / 低）；\n" +
      "②关键可辨识特征：列出 2-3 个最有助于现场确认该物体的视觉特征；\n" +
      "③一句话科普：最突出的特点或趣闻；\n" +
      "④旅途小贴士：能否触碰、能否食用、观赏或拍摄建议、相关文化典故。\n" +
      "若无法可靠识别，直接说「无法确定」并给出可能的类别，绝不编造物种名、毒性、价格或坐标。";
  },

  // 二次核验（多链投票）：换角度重新判断，要求给出明确结论与决定性判别特征
  _promptVerify() {
    const city = this.data.cityName ? ("当前所在城市：" + this.data.cityName + "。") : "";
    return city +
      "请抛开既有思路，对同一张（同一组）照片做「二次核验」：从形态、生境、颜色、纹理、用途等更客观的角度重新判断主体最可能是什么，" +
      "并给出置信度（高 / 中 / 低）与 1-2 个决定性判别特征。如果仍不确定，请明确说「无法确定」并列出 2-3 个最相关的可能类别，绝不编造。";
  },

  _system() {
    return "你是「晨的旅行助手」的识物科普助手，擅长辨认旅行中遇到的植物、动物、地标、建筑与地方美食。" +
      "回答必须基于图片真实可见的特征；不确定就明说，绝不编造物种名、毒性、价格或坐标。";
  },

  _compress(p) {
    return new Promise((resolve) => {
      try {
        if (typeof wx.compressImage !== "function") { resolve(p); return; }
        wx.compressImage({
          src: p, quality: 60, compressedWidth: 900,
          success: (res) => resolve((res && res.tempFilePath) || p),
          fail: () => resolve(p)
        });
      } catch (e) { resolve(p); }
    });
  },

  identify() {
    const self = this;
    if (!this.data.imgs.length) { wx.showToast({ title: "先拍一张或从相册选", icon: "none" }); return; }
    if (!Cloud.cloudEnabled()) {
      self.setData({ err: "AI 识物需先开启云端：在云函数 llmProxy 配置 LLM_PROVIDER / LLM_MODEL（需多模态模型，如 gpt-4o、qwen-vl-max）。当前可用下方「文字问」（离线也能答）。" });
      return;
    }
    self.setData({ loading: true, result: "", source: "", err: "", voted: false, spotName: "", spotInfo: null, spotErr: "" });
    try { wx.showLoading({ title: "AI 识别中", mask: true }); } catch (e) {}
    Promise.all(this.data.imgs.map(function (p) { return self._compress(p); }))
      .then(function (paths) { return Promise.all(paths.map(function (p) { return Cloud.uploadImage(p); })); })
      .then(function (fileIDs) {
        fileIDs = fileIDs.filter(Boolean);
        if (!fileIDs.length) throw new Error("upload-empty");
        return self._visionWithVote(fileIDs);
      })
      .then(function (r) {
        try { wx.hideLoading(); } catch (e) {}
        if (r && r.ok && r.text) {
          const nm = self._extractName(r.text);
          self.setData({ result: r.text, loading: false, source: r.source || "ai", err: "", voted: !!r.voted, spotName: nm, spotInfo: null, spotErr: "" });
        } else self.setData({ loading: false, err: "识别失败：" + ((r && r.err) || "未知错误") + "。可改用「文字问」。" });
      })
      .catch(function (e) {
        try { wx.hideLoading(); } catch (_) {}
        try { EL.push("lens.identify", e); } catch (_) {}
        self.setData({ loading: false, err: "识别失败（" + String((e && e.message) || e) + "）。可改用「文字问」。" });
      });
  },

  // 自适应多链投票：先主识别，若结果不确定（低置信度）再换角度核验一次，提升准确率
  _visionWithVote(fileIDs) {
    const self = this;
    return Cloud.aiVision({ imageFileIDs: fileIDs, prompt: self._prompt(), system: self._system(), max_tokens: 700 })
      .then(function (r1) {
        if (!r1 || !r1.ok || !r1.text) return r1;
        const uncertain = /不确定|可能|疑似|无法确定|不清楚|不太确定|也许|大概|存疑|难以确定|我无法|无法确认|不能确认/.test(r1.text);
        if (!uncertain) return r1;
        // 二次核验
        return Cloud.aiVision({ imageFileIDs: fileIDs, prompt: self._promptVerify(), system: self._system(), max_tokens: 500 })
          .then(function (r2) {
            if (r2 && r2.ok && r2.text) return { ok: true, text: r2.text, source: r2.source || "ai", voted: true };
            return r1; // 二次失败则回退首次结果
          })
          .catch(function () { return r1; });
      });
  },

  copyResult() {
    const t = String(this.data.result || "");
    if (!t) { wx.showToast({ title: "还没有可复制的内容", icon: "none" }); return; }
    try { wx.setClipboardData({ data: t, success: () => wx.showToast({ title: "已复制", icon: "none" }) }); }
    catch (e) { wx.showToast({ title: "复制失败", icon: "none" }); }
  },

  toggleText() { this.setData({ textMode: !this.data.textMode, err: "" }); },
  onTextInput(e) { this.setData({ textInput: e.detail.value }); },

  askText() {
    const q = (this.data.textInput || "").trim();
    if (!q) { wx.showToast({ title: "先输入问题", icon: "none" }); return; }
    const self = this;
    if (!Cloud.cloudEnabled()) {
      // 离线兜底：先走本地 AI 大脑，再回落本地规则引擎（零网络，不伪造）
      let r = null;
      try {
        const plan = app.globalData && app.globalData.plan;
        r = AI.handle(q, { city: (plan && (T.activeCityOf(plan) || plan.cityName)) || "", plan: plan, page: "lens" });
      } catch (e) {}
      if (r && r.text) { self.setData({ result: r.text, loading: false, source: "", err: "", voted: false }); return; }
      try { r = T.askAssistant(q, app.globalData && app.globalData.plan); } catch (e) {}
      if (r && r.text) { self.setData({ result: r.text, loading: false, source: "", err: "", voted: false }); return; }
      self.setData({ err: "本地也无法识别，请联网后重试，或在「问问 AI」里用文字描述。" });
      return;
    }
    self.setData({ loading: true, err: "", result: "", source: "", voted: false });
    try { wx.showLoading({ title: "AI 思考中", mask: true }); } catch (e) {}
    let ctx = "";
    try { ctx = Cloud.aiContextOf(app.globalData && app.globalData.plan, "AI 识物页"); } catch (e) {}
    AIAgent.ask("lens", q, ctx)
      .then(function (r) {
        try { wx.hideLoading(); } catch (e) {}
        if (r && r.ok && r.text) { self.setData({ result: r.text, loading: false, source: r.source || "ai" }); return; }
        // 云端不可用（离线/未配置/超时）属预期降级，给出清晰提示而非误导性的「回答失败」
        const off = !!(r && (r.err === "cloud-disabled" || r.err === "cloud-not-ready" || r.err === "timeout"));
        self.setData({
          loading: false,
          err: off
            ? "识物需联网：当前未连接云端 AI，请联网后重试；或在「问问 AI」里用文字描述。"
            : "回答失败：" + ((r && r.err) || "未知")
        });
      })
      .catch(function (e) {
        try { wx.hideLoading(); } catch (_) {}
        self.setData({ loading: false, err: "回答失败：" + String((e && e.message) || e) });
      });
  },

  // 从结构化识别结果里抽取主体名称（供「查景点 / 加入行程」联动）。
  // 零伪造：只做文本解析，绝不据此编造景点；解析不出则回退空串，由 UI 隐藏联动按钮。
  _extractName(text) {
    const t = String(text || "");
    let name = "";
    const m = t.match(/名称[：:]\s*([^\n，。；（(]+)/);
    if (m) name = (m[1] || "").trim();
    if (!name) {
      const lines = t.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 1; });
      if (lines.length) {
        let first = lines[0].replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, "");
        first = first.replace(/^[①-⑩\s]+/, "");
        name = first.split(/[，。；：、（）()【】\s]/)[0] || "";
      }
    }
    if (name) {
      name = name.replace(/\s*[（(][^）)]*[）)]\s*$/, "");
      name = name.replace(/[（(]?\s*置信度?\s*[:：]?\s*(高|中|低)\s*[）)]?/g, "");
      name = name.replace(/^(这是|可能是|疑似|大概率是|应为|应该是|我认为是|估计是|或为)\s*/, "");
      name = name.trim();
    }
    return (name.length > 1 && name.length <= 30) ? name : "";
  },

  // 查这个景点：命中本地资料则就地展示；未命中则落到查景点页（按名称搜索，零伪造）。
  onLookupSpot() {
    const name = this.data.spotName;
    const city = this.data.cityName;
    if (!name) { wx.showToast({ title: "没识别到明确名称，换个角度拍", icon: "none" }); return; }
    let hit = null;
    try { hit = T.spotLookup(name, city); } catch (e) {}
    if (hit && hit.found) {
      this.setData({
        spotInfo: { name: hit.name || name, intro: hit.intro || "", how: hit.how || "", route: hit.route || "", city: hit.city || city || "" },
        spotErr: ""
      });
    } else {
      this.setData({ spotErr: "本地库暂未收录「" + name + "」，已打开查景点页" });
      try { wx.navigateTo({ url: "/subpkg/spotsearch/spotsearch?q=" + encodeURIComponent(name) + "&city=" + encodeURIComponent(city || "") }); } catch (e) {}
    }
  },

  // 加入行程：解析出的实体若命中本地景点，优先用其真实城市；否则用当前行程城市。
  // 经 T.buildPlan 本地生成（可把该景点经 picks 强制纳入行程），零云依赖、零伪造。
  onAddToTrip() {
    const self = this;
    let name = this.data.spotName;
    let city = this.data.cityName;
    if (!city && !name) { wx.showToast({ title: "先选目的地，或在首页生成行程", icon: "none" }); return; }
    if (name) {
      try {
        const hit = T.spotLookup(name, city);
        if (hit && hit.found && hit.city) { city = hit.city; name = hit.name || name; }
      } catch (e) {}
    }
    if (!city) { wx.showToast({ title: "无法确定城市，去首页选目的地", icon: "none" }); return; }
    self._generateForCity(city, name ? [name] : []);
  },

  // 复用 assistant「一句话生成」同源逻辑：本地生成并跳行程页（picks 可把具体景点纳入行程）
  _generateForCity(cityName, picks) {
    const self = this;
    let c = null;
    try { if (T.findCity) c = T.findCity(cityName); } catch (e) {}
    if (!c) {
      const provs = T.provinces();
      for (let pi = 0; pi < (provs || []).length && !c; pi++) {
        const cs = T.citiesOf(provs[pi]) || [];
        c = cs.find(function (x) { return x.name === cityName; }) || null;
      }
    }
    if (!c) { wx.showToast({ title: "未收录「" + cityName + "」", icon: "none" }); return; }
    try {
      const d = new Date(); d.setDate(d.getDate() + 3);
      const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
      const depart = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const oldPlan = app.globalData && app.globalData.plan;
      if (oldPlan && oldPlan.days && oldPlan.days.length) T.savePlanSlot(oldPlan);
      const daysArr = T.buildPlan({ city: c, days: 4, depart: depart, budget: "mid", pace: "balance", travelMode: "", people: 2, stayMountain: true, picks: picks || [], pickOnly: false, bias: "" });
      const from = { province: c.province || "", city: c.name };
      try { T.resetTripPrep(); } catch (e) {}
      if (app.setPlan) app.setPlan({
        cityName: c.name, province: c.province || "", totalDays: daysArr.length, depart: depart, days: daysArr,
        budget: "mid", customAmt: 0, people: 2, pace: "balance", travelMode: "", pickOnly: false, isMulti: false,
        from: from, savedAt: Date.now(), bias: ""
      });
      try { T.pushRecent({ province: c.province || "", city: c.name, days: daysArr.length, depart: depart }); } catch (e) {}
      wx.showToast({ title: "已将「" + c.name + "」加入行程", icon: "none" });
      setTimeout(function () { try { wx.switchTab({ url: "/pages/plan/plan" }); } catch (e) {} }, 700);
    } catch (e) {
      wx.showToast({ title: "生成失败：" + ((e && e.message) || "请稍后重试"), icon: "none" });
    }
  },

  // 收起本地资料面板
  onCloseSpot() { this.setData({ spotInfo: null, spotErr: "" }); },

  goAssistant() {
    try { wx.navigateTo({ url: "/subpkg/assistant/assistant" }); } catch (e) {}
  },

  aiClearChat() {
    try { AIAgent.clearHistory("lens"); } catch (e) {}
    this.setData({ aiText: "", aiAnswer: "", lastResult: "", result: "", out: null,
      aiSource: "", source: "", aiQ: "", aiInput: "", aiErr: "" });
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
}));
