const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// lens：AI 识物 · 旅途科普（拍照 / 相册 → 云端多模态强模型识别 → 科普小贴士）
// 设计原则：云端优先、离线诚实降级。识别依赖云端视觉模型（llmProxy + 多模态 LLM_MODEL），
// 未配置时明确告知并引导「文字问」，绝不伪造识别结果。
const T = require("../../utils/travel.js");
const Cloud = require("../../utils/cloud.js");
const AIAgent = require("../../utils/ai-agent.js");
const EL = require("../../utils/errlog.js");
const app = getAppSafe();

Page(SafePage({
  data: {
    fz: 1,
    td: false,
    img: "",            // 本地临时图（预览用）
    loading: false,
    result: "",         // AI 识别 / 回答结果
    source: "",         // 来源标识（显示「AI 生成」）
    err: "",            // 失败/未配置提示
    cloudOn: false,     // 云端是否开启
    textMode: false,    // 文字问模式
    textInput: "",
    cityName: ""
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
    try {
      if (typeof wx.chooseMedia === "function") {
        wx.chooseMedia({
          count: 1, mediaType: ["image"], sourceType: sourceType, camera: "back",
          success: (res) => {
            const f = res && res.tempFiles && res.tempFiles[0];
            if (f && f.tempFilePath) self._setImg(f.tempFilePath);
          },
          fail: () => {}   // 用户取消不打扰
        });
      } else if (typeof wx.chooseImage === "function") {
        wx.chooseImage({
          count: 1, sourceType: sourceType,
          success: (res) => {
            const p = res && res.tempFilePaths && res.tempFilePaths[0];
            if (p) self._setImg(p);
          },
          fail: () => {}
        });
      } else {
        wx.showToast({ title: "当前版本不支持选图", icon: "none" });
      }
    } catch (e) { wx.showToast({ title: "打开相机失败", icon: "none" }); }
  },

  _setImg(p) { this.setData({ img: p, result: "", source: "", err: "" }); },
  clearImg() { this.setData({ img: "", result: "", source: "", err: "" }); },

  _prompt() {
    const city = this.data.cityName ? ("当前所在城市：" + this.data.cityName + "。") : "";
    return city +
      "请识别这张照片里的主体（植物 / 动物 / 地标 / 建筑 / 美食 / 器物等），用简体中文按以下结构作答：\n" +
      "1. 最可能的名称（学名或俗名；若不确定请说明置信度）；\n" +
      "2. 一句话科普（最突出的特点）；\n" +
      "3. 旅途小贴士（能否触碰、能否食用、观赏或拍摄注意、相关文化典故）。\n" +
      "若无法可靠识别，直接说「无法确定」并给出可能的类别，绝不编造具体数据。";
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
    if (!this.data.img) { wx.showToast({ title: "先拍一张或从相册选", icon: "none" }); return; }
    if (!Cloud.cloudEnabled()) {
      self.setData({ err: "AI 识物需先开启云端：在云函数 llmProxy 配置 LLM_PROVIDER / LLM_MODEL（需多模态模型，如 gpt-4o、qwen-vl-max）。当前可用下方「文字问」。" });
      return;
    }
    self.setData({ loading: true, result: "", source: "", err: "" });
    try { wx.showLoading({ title: "AI 识别中", mask: true }); } catch (e) {}
    self._compress(self.data.img)
      .then((p) => Cloud.uploadImage(p))
      .then((fileID) => {
        if (!fileID) throw new Error("upload-empty");
        return Cloud.aiVision({ imageFileID: fileID, prompt: self._prompt(), system: self._system() });
      })
      .then((r) => {
        try { wx.hideLoading(); } catch (e) {}
        if (r && r.ok && r.text) self.setData({ result: r.text, loading: false, source: r.source || "ai", err: "" });
        else self.setData({ loading: false, err: "识别失败：" + ((r && r.err) || "未知错误") + "。可改用「文字问」。" });
      })
      .catch((e) => {
        try { wx.hideLoading(); } catch (_) {}
        try { EL.push("lens.identify", e); } catch (_) {}
        self.setData({ loading: false, err: "识别失败（" + String((e && e.message) || e) + "）。可改用「文字问」。" });
      });
  },

  toggleText() { this.setData({ textMode: !this.data.textMode, err: "" }); },
  onTextInput(e) { this.setData({ textInput: e.detail.value }); },

  askText() {
    const q = (this.data.textInput || "").trim();
    if (!q) { wx.showToast({ title: "先输入问题", icon: "none" }); return; }
    const self = this;
    if (!Cloud.cloudEnabled()) { self.setData({ err: "云端未开启，暂无法提问。" }); return; }
    self.setData({ loading: true, err: "", result: "", source: "" });
    try { wx.showLoading({ title: "AI 思考中", mask: true }); } catch (e) {}
    let ctx = "";
    try { ctx = Cloud.aiContextOf(app.globalData && app.globalData.plan, "AI 识物页"); } catch (e) {}
    AIAgent.ask("lens", q, ctx)
      .then((r) => {
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
      .catch((e) => {
        try { wx.hideLoading(); } catch (_) {}
        self.setData({ loading: false, err: "回答失败：" + String((e && e.message) || e) });
      });
  },

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
