const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
// lens：AI 识物 · 旅途科普（拍照 / 相册 → 云端多模态强模型识别 → 科普小贴士）
// 设计原则：云端优先、离线诚实降级。识别依赖云端视觉模型（llmProxy + 多模态 LLM_MODEL），
// 未配置时明确告知并引导「文字问」，绝不伪造识别结果。
// v1.20.6 增强：① 本地真实上下文 grounding（当前城市 + 随包真实景点名，提升地标识别与联动命中）；
//   ② 自适应级联多数投票（2 链一致即定，分歧才起第 3 链仲裁，绝不用「第二次结果覆盖第一次」）；
//   ③ 结构化结果（名称/类别/置信度/特征/贴士）+ 云端名称对齐本地真实景点名；
//   ④ 云不可用 / 识别失败时给「本机离线对照」出口（明确声明不是图像识别，只列随包真实资料）；
//   ⑤ 部分上传失败仍可识别、失败自动重试一次、识别历史落盘、追问带识别上下文。
const T = require("../../utils/travel.js");
const Cloud = require("../../utils/cloud.js");
const AIAgent = require("../../utils/ai-agent.js");
const AI = require("../assistant/ai-brain.js");   // 离线 AI 大脑（无云时文字问兜底，零网络）
const V = require("./lens-vision.js");             // 识物纯逻辑（分包内，主包零增长）
const S = require("../../utils/store.js");
const EL = require("../../utils/errlog.js");
const app = getAppSafe();
const HIST_KEY = "lensHistoryV1";
const HIST_MAX = 8;

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
    spotErr: "",        // 查不到时的提示（空表示已命中）
    // v1.20.6：结构化识别结果 / 投票 / 离线对照 / 历史
    parsed: null,       // {name,category,confidence,features,science,tip}
    voteInfo: null,     // {consensus,agree,total,alternatives,tied}
    chainN: 0,          // 本次实际跑了几条识别链
    localMode: false,   // 是否处于「本机离线对照」模式
    localNote: "",      // 离线模式的诚实说明
    candidates: [],     // 随包真实景点候选（零伪造）
    history: [],        // 最近识别记录
    busyTip: "",        // 识别过程提示（上传到第几张 / 投票阶段）
    rawOpen: false      // 是否展开模型完整回答
  },

  _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },

  // 清空「与本次识别相关的状态」的统一口径，避免新增字段后某个入口漏清导致旧结论串到新照片上。
  _blank() {
    return {
      result: "", source: "", err: "", voted: false, spotName: "", spotInfo: null, spotErr: "",
      parsed: null, voteInfo: null, chainN: 0, localMode: false, localNote: "", candidates: [], busyTip: "", rawOpen: false
    };
  },

  toggleRaw() { this.setData({ rawOpen: !this.data.rawOpen }); },

  onLoad() { this.__boot = T.ready().catch(() => null); },

  onShow() {
    onShowRender(this, "lens", null, () => {
      try {
        const plan = app.globalData && app.globalData.plan;
        const city = plan ? (T.activeCityOf(plan) || plan.cityName || "") : "";
        let hist = [];
        try { hist = S.get(HIST_KEY, []) || []; } catch (e) { hist = []; }
        this.setData({ cloudOn: Cloud.cloudEnabled(), cityName: city || "", history: Array.isArray(hist) ? hist.slice(0, HIST_MAX) : [] });
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
    this.setData(Object.assign({ imgs: next }, this._blank()));
  },
  removeImg(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    const next = this.data.imgs.slice();
    next.splice(i, 1);
    this.setData(Object.assign({ imgs: next }, this._blank()));
  },
  clearImgs() { this.setData(Object.assign({ imgs: [] }, this._blank())); },

  // 结构化输出约定（三条识别链共用，便于 parseResult 解析与投票）。
  // 明确告知「本地景点名清单只做名称对齐」，防止模型为了对齐而把不相干的东西硬套成某个景点。
  _format() {
    return "用简体中文严格按下面 5 行作答，每行一项、不要额外编号外的段落：\n" +
      "①名称：最可能是什么（俗名或学名）（置信度：高/中/低）\n" +
      "②类别：植物 / 动物 / 地标建筑 / 美食 / 器物 / 自然地貌 / 其他（选一类）\n" +
      "③关键可辨识特征：2-3 个现场可核对的视觉特征，用「、」分隔\n" +
      "④一句话科普：最突出的特点或趣闻\n" +
      "⑤旅途小贴士：能否触碰 / 能否食用 / 观赏或拍摄建议 / 文化典故\n" +
      "若无法可靠识别，①直接写「无法确定」，②给出最可能的大类，绝不编造物种名、毒性、价格或坐标。";
  },

  _prompt() {
    const city = this.data.cityName ? ("当前所在城市：" + this.data.cityName + "。") : "";
    return city + "请识别这张（这些）照片里的主体。\n" + this._format() +
      "\n注意：若上下文附有本地景点名清单，它只用于「照片确实是那个地标时」统一标准名称；不是就照实作答，严禁套用清单里的名字。";
  },

  // 复核链：换客观视角独立重判（输出同样结构化，供多数投票解析名称）
  _promptVerify() {
    return "请抛开常识联想，完全依据照片里可见的形态、颜色、纹理、比例、生境 / 环境、构造用途做一次独立判断。\n" +
      this._format() +
      "\n重点：给出 1-2 个决定性判别特征；若与常见叫法不同，按你看到的客观特征命名，不要迎合任何清单。";
  },

  // 仲裁链：仅在前两链分歧时启用，从「排除易混淆对象」角度给出第三票
  _promptArbitrate() {
    return "这是第三次独立判断。请先列出 2-3 个最容易与照片主体混淆的候选，再逐一用可见特征排除，" +
      "最后给出你认为最可能的那一个。\n" + this._format();
  },

  _system() {
    return "你是「晨的旅行助手」的识物科普助手，擅长辨认旅行中遇到的植物、动物、地标、建筑与地方美食。" +
      "回答必须基于图片真实可见的特征；不确定就明说，绝不编造物种名、毒性、价格或坐标。";
  },

  _systemVerify() {
    return "你是独立的形态学复核员。只描述照片里看得见的证据并据此下结论，不受地点、常见印象或已有结论影响。" +
      "不确定就写「无法确定」，绝不编造物种名、毒性、价格或坐标。";
  },

  _systemArbitrate() {
    return "你是第三方仲裁员，专长为区分易混淆物种与建筑。以可排除的错误候选为推理依据，只给最可能的一个名称。" +
      "证据不足就写「无法确定」，绝不编造物种名、毒性、价格或坐标。";
  },

  // 本地真实上下文 grounding：行程 + 当前城市 + 该城随包真实景点名（只做名称对齐）。
  // 零伪造：清单全部来自 utils/data.js，不生成任何新名称；云函数会把这段注入 system。
  _groundContext() {
    let base = "";
    try { base = Cloud.aiContextOf(app.globalData && app.globalData.plan, "AI 识物页"); } catch (e) { base = ""; }
    const city = this.data.cityName || "";
    const lines = [base];
    if (city) lines.push("拍照时的城市：" + city + "。");
    let names = [];
    try { names = city ? V.citySpotNames(city, 20).map(function (x) { return x.name; }) : []; } catch (e) { names = []; }
    if (names.length) {
      lines.push("本机随包收录的该城真实景点名（仅供名称对齐；只有确认照片就是该地标时才使用其标准名，否则照实作答，严禁套用）：" + names.join("、") + "。");
    }
    return lines.filter(Boolean).join("\n");
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

  // 逐张上传：单张失败只丢这一张（原 Promise.all 是一张失败整批全挂）。
  _uploadAny(paths) {
    return Promise.all(paths.map(function (p) {
      return Cloud.uploadImage(p).catch(function () { return ""; });
    })).then(function (ids) { return ids.filter(Boolean); });
  },
  _uploadWithRetry(paths) {
    const self = this;
    return self._uploadAny(paths).then(function (ids) {
      if (ids.length) return ids;
      self.setData({ busyTip: "图片上传未成功，正在重试一次…" });
      return self._uploadAny(paths);
    });
  },

  // 云端不可用 / 识别失败时的诚实出口：本机不含离线图像识别，只列随包真实资料供人工对照。
  // 绝不把「知识库候选」包装成「识别结果」——这是零伪造红线。
  _openLocalCompare(note) {
    const city = this.data.cityName || "";
    let wish = [], plan = null, cands = [];
    try { plan = app.globalData && app.globalData.plan; } catch (e) {}
    try { wish = (city && T.wishPicksFor) ? (T.wishPicksFor(city) || []) : []; } catch (e) { wish = []; }
    try { cands = V.localCandidates({ city: city, plan: plan, wish: wish, limit: 8 }); } catch (e) { cands = []; }
    const head = "本机不含离线图像识别，无法判断照片里是什么。";
    const tail = city
      ? "下面是随包收录的「" + city + "」真实地点，请对照照片自行确认；点选后可看离线资料或加入行程。"
      : "当前没有行程城市，可先在首页生成行程，或用下方「文字问」。";
    this.setData(Object.assign({}, this._blank(), {
      loading: false,
      localMode: true,
      localNote: (note ? note + " " : "") + head + tail,
      candidates: cands,
      err: cands.length ? "" : "本机暂无可用候选：请先在首页生成行程或选择城市。"
    }));
  },

  identify() {
    const self = this;
    if (!this.data.imgs.length) { wx.showToast({ title: "先拍一张或从相册选", icon: "none" }); return; }
    if (!Cloud.cloudEnabled()) {
      self._openLocalCompare("云端 AI 未开启（需在云函数 llmProxy 配置多模态 LLM_MODEL）。");
      return;
    }
    self.setData(Object.assign({}, self._blank(), { loading: true, busyTip: "正在压缩图片…" }));
    try { wx.showLoading({ title: "AI 识别中", mask: true }); } catch (e) {}
    Promise.all(this.data.imgs.map(function (p) { return self._compress(p); }))
      .then(function (paths) {
        self.setData({ busyTip: "正在上传 " + paths.length + " 张图片…" });
        return self._uploadWithRetry(paths);
      })
      .then(function (fileIDs) {
        if (!fileIDs || !fileIDs.length) throw new Error("upload-empty");
        self.setData({ busyTip: "多链识别中（2 条独立判断）…" });
        return self._visionWithVote(fileIDs);
      })
      .then(function (out) {
        try { wx.hideLoading(); } catch (e) {}
        const v = (out && out.v) || { consensus: false, uncertain: true, total: 0, agree: 0, alternatives: [], primaryText: "" };
        const text = v.primaryText || (out && out.r && out.r.text) || "";
        if (!text) {
          self._openLocalCompare("云端识别未返回结果（" + ((out && out.r && out.r.err) || "未知") + "）。");
          return;
        }
        const parsed = V.parseResult(text);
        const city = self.data.cityName || "";
        const name = v.consensus ? v.name : "";
        let localName = "";
        try { localName = name ? V.matchLocalName(name, city) : ""; } catch (e) {}
        const spotName = name ? (localName || name) : "";
        let spotInfo = null, spotErr = "";
        if (spotName) {
          try {
            const hit = T.spotLookup(spotName, city);
            if (hit && hit.found) spotInfo = {
              name: hit.name || spotName, intro: hit.intro || "", how: hit.how || "",
              route: hit.route || "", city: hit.city || city || ""
            };
          } catch (e) {}
          if (localName && localName !== name) spotErr = "已对齐本地标准名「" + localName + "」";
        }
        self.setData(Object.assign({}, self._blank(), {
          result: text, loading: false, source: (out && out.r && out.r.source) || "ai",
          voted: (out && out.n) >= 3, parsed: parsed,
          voteInfo: { consensus: !!v.consensus, agree: v.agree, total: v.total, tied: !!v.tied, alternatives: v.alternatives || [] },
          chainN: (out && out.n) || 2, busyTip: "",
          spotName: spotName, spotInfo: spotInfo, spotErr: spotErr
        }));
        // 只有多链一致才自动联动 / 记历史，避免把分歧结果误加进行程
        if (spotName) self._pushHistory({ name: spotName, category: parsed.category || "", city: city, ts: Date.now(), source: "ai" });
      })
      .catch(function (e) {
        try { wx.hideLoading(); } catch (_) {}
        try { EL.push("lens.identify", e); } catch (_) {}
        self._openLocalCompare("识别失败（" + String((e && e.message) || e) + "）。");
      });
  },

  // 自适应级联多数投票：主链 + 客观复核链并发 → 名称一致（含同义归组）即定；
  // 分歧或任一链不确定才起第三链仲裁 → 三链多数投票；仍不一致则标「意见不一致」，交用户确认。
  // 修复旧实现「不确定就再问一次、然后直接用第二次结果覆盖第一次」——那反而可能把对的换成错的。
  _visionWithVote(fileIDs) {
    const self = this;
    const ctx = self._groundContext();
    const call = function (prompt, system, mt) {
      return Cloud.aiVision({
        imageFileIDs: fileIDs, prompt: prompt, system: system, context: ctx, max_tokens: mt || 700
      }).then(function (r) {
        return { ok: !!(r && r.ok && r.text), text: (r && r.text) || "", source: (r && r.source) || "ai", err: (r && r.err) || "" };
      }).catch(function (e) { return { ok: false, text: "", err: String((e && e.message) || e) }; });
    };
    const two = [call(self._prompt(), self._system(), 700), call(self._promptVerify(), self._systemVerify(), 600)];
    return Promise.all(two).then(function (rs) {
      const v2 = V.vote(rs);
      if (v2.consensus) return { r: rs[0].ok ? rs[0] : rs[1], v: v2, n: 2 };
      self.setData({ busyTip: "前两次判断不一致，正在做第三次仲裁…" });
      return call(self._promptArbitrate(), self._systemArbitrate(), 600).then(function (third) {
        const v3 = V.vote([rs[0], rs[1], third]);
        const primary = third.ok ? third : (rs[0].ok ? rs[0] : rs[1]);
        return { r: primary, v: v3, n: 3 };
      });
    });
  },

  _pushHistory(item) {
    let h = [];
    try { h = S.get(HIST_KEY, []) || []; } catch (e) { h = []; }
    if (!Array.isArray(h)) h = [];
    h = [item].concat(h.filter(function (x) { return !(x && x.name === item.name); })).slice(0, HIST_MAX);
    try { S.set(HIST_KEY, h); } catch (e) {}
    this.setData({ history: h });
  },
  onClearHistory() {
    try { S.del(HIST_KEY); } catch (e) {}
    this.setData({ history: [] });
  },
  onPickCandidate(e) {
    const name = (e.currentTarget.dataset && e.currentTarget.dataset.name) || "";
    if (!name) return;
    this.setData({ localMode: false, localNote: "", candidates: [], spotName: name, spotInfo: null, spotErr: "" });
    this.onLookupSpot();
  },
  onHistoryTap(e) {
    const name = (e.currentTarget.dataset && e.currentTarget.dataset.name) || "";
    if (!name) return;
    this.setData({ spotName: name, spotInfo: null, spotErr: "" });
    this.onLookupSpot();
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
    // 追问带上刚才的识别结论，避免「这是什么季节开花」「附近还有类似的吗」这类追问丢上下文。
    // 明确标注仅供参考，防止强模型把未经人工确认的识别结果当事实继续发挥。
    try {
      const pr = this.data.parsed;
      if (pr && pr.rawName) {
        ctx += "\n刚才这张照片的识别结论（仅供参考，可能有误，勿据此编造事实）：" +
          pr.rawName + (pr.category ? "（类别：" + pr.category + "）" : "") + "。";
      }
    } catch (e) {}
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
    // 结构化识别结论 / 投票态一并清掉，否则「追问」会把上一次照片的结论当上下文串到新对话。
    // 识别历史是独立功能，不在 _blank() 内，清空会话不会误删。
    this.setData(Object.assign({ textInput: "" }, this._blank()));
    wx.showToast({ title: "会话已清空", icon: "none" });
  },
}));
