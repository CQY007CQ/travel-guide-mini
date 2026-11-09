/* web/ai-assistant.js —— 网页版内置 AI 助手
 *
 * 设计原则（与小程序一致，离线优先）：
 *   1) 默认零网络、零 key：用同源离线数据（城市/美食/地标/省份）做意图识别与问答；
 *   2) 能跳 App：景点/行程类问题附带「去 App 内生成」动作，直接 window.go() 路由；
 *   3) 可选大模型：面板里填 OpenAI 兼容 baseURL+key+model 即切换为真实 LLM（默认关）。
 *
 * 该文件在 app.js 之后加载，__require / __APP_CONFIG 已就绪。
 */
(function () {
  "use strict";

  var APP = window;

  /* ───────── 数据接入（懒取，等 initData 合并完成） ───────── */
  function getD() {
    try { return APP.__require("__entry__", "./utils/data.js") || {}; }
    catch (e) { return {}; }
  }
  function getT() {
    try { return APP.__require("__entry__", "./utils/travel.js") || {}; }
    catch (e) { return {}; }
  }
  var _readyDone = false;
  function whenReady(cb) {
    if (_readyDone) { cb(); return; }
    var T = getT();
    var wait = (T && typeof T.ready === "function")
      ? T.ready()
      : new Promise(function (res) {
          var n = 0, iv = setInterval(function () {
            n++;
            if ((getD().CITIES && getD().CITIES.length) || n > 20) { clearInterval(iv); res(); }
          }, 300);
        });
    // 单一 Promise 等待 + 6s 超时兜底，避免 setInterval 轮询泄漏（#118）
    Promise.race([wait, new Promise(function (res) { setTimeout(res, 6000); })])
      .then(finish, finish);
    function finish() { _readyDone = true; cb(); }
  }

  /* ───────── 意图识别 ───────── */
  var INTENTS = [
    { key: "food",       kw: /吃|美食|小吃|餐厅|饭店|酒楼|特色菜|好吃|料理|必吃|餐馆|食|味道|口味|夜市|馆子/ },
    { key: "attraction", kw: /景点|好玩|玩|名胜|打卡|景区|必去|游览|风光|风景|地标|去哪|值得/ },
    { key: "itinerary",  kw: /行程|路线|几天|日游|安排|规划|攻略|玩法|计划|怎么玩|顺序|一日游|两日游|三日游/ },
    { key: "season",     kw: /天气|季节|几月|最佳时间|什么时候|穿|温度|冷|热|雨季|避开|气候|舒服|适宜/ },
    { key: "packing",    kw: /带|必备|准备|行李|物品|装备|清单|收拾|要带|装/ },
    { key: "transport",  kw: /怎么去|交通|高铁|飞机|机场|车站|到达|自驾|火车|怎么到|怎么走/ },
    { key: "greeting",   kw: /你好|您好|hi|hello|在吗|助手|你是|嗨|在么|你是谁/ },
    { key: "help",       kw: /能做什么|怎么用|功能|帮助|会什么|能帮|干什么|怎么操作/ }
  ];
  function detectIntent(text) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].kw.test(text)) return INTENTS[i].key;
    return "general";
  }

  /* ───────── 城市 / 省份识别（缓存合并正则，单次 O(1) 扫描，#119） ───────── */
  var _placeReg = null;
  function placeRegex() {
    if (_placeReg) return _placeReg;
    var D = getD(), toks = [];
    (D.CITIES || []).forEach(function (c) { if (c && c.name && c.name.length >= 2) toks.push(c.name); });
    (D.PROVINCES || []).forEach(function (p) { if (p) toks.push(p); });
    var c2p = D.CITY2PROV || {}; Object.keys(c2p).forEach(function (k) { if (k) toks.push(k); });
    toks.sort(function (a, b) { return b.length - a.length; }); // 长 token 优先，降低子串误命中
    var esc = toks.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    _placeReg = new RegExp(esc.join("|"), "g");
    return _placeReg;
  }
  function detectPlace(text) {
    var reg = placeRegex(), m, found = null, fl = 0;
    reg.lastIndex = 0;
    while ((m = reg.exec(text)) !== null) {
      if (m[0].length > fl) { fl = m[0].length; found = m[0]; }
    }
    if (!found) return null;
    var provs = (getD().PROVINCES || []);
    if (provs.indexOf(found) >= 0) return { type: "province", name: found };
    return { type: "city", name: found };
  }

  /* ───────── 数据取用 ───────── */
  function getFoods(city, n) {
    var D = getD(), arr = (D.FOOD_SPOTS && D.FOOD_SPOTS[city]) || [];
    if (!arr.length) return [];
    arr = arr.slice().sort(function (a, b) { return (b.rep || 0) - (a.rep || 0); });
    return arr.slice(0, n || 6);
  }
  function getSpots(city, n) {
    var D = getD();
    var arr = (D.SPOT_COORDS && D.SPOT_COORDS[city]) || [];
    return arr.slice(0, n || 8).map(function (it) { return Array.isArray(it) ? it[0] : it; });
  }
  function getLandmarks(city, n) {
    return getSpots(city, n || 6);
  }
  function getCitiesOfProvince(prov) {
    var D = getD(), list = (D.PROVINCE_CITIES && D.PROVINCE_CITIES[prov]) || [];
    var named = {}; (D.CITIES || []).forEach(function (c) { if (c && c.name) named[c.name] = 1; });
    return list.filter(function (s) { return named[s]; });
  }
  function hasGuide(city) {
    var D = getD();
    if (D.FOOD_SPOTS && D.FOOD_SPOTS[city] && D.FOOD_SPOTS[city].length) return true;
    if (D.SPOT_COORDS && D.SPOT_COORDS[city] && D.SPOT_COORDS[city].length) return true;
    return false;
  }

  /* ───────── 跳转动作构造（去重：原 8 处重复的 action 对象字面量） ───────── */
  function actPlan(city, label) {
    return { label: label || (city ? ("为" + city + "生成行程 →") : "去生成行程 →"), path: "pages/plan/plan" };
  }
  function actMore(label) {
    return { label: label || "打开清单工具 →", path: "pages/more/more" };
  }

  /* ───────── 回复生成（离线） ───────── */
  var lastCity = null;
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function foodHtml(city) {
    var foods = getFoods(city, 6);
    if (!foods.length) return null;
    var lines = foods.map(function (f) {
      var dishes = (f.menu || []).slice(0, 3).map(function (m) { return m.n; }).filter(Boolean).join("、");
      var price = f.price;
      if (price != null && price !== "") price = (typeof price === "number") ? ("约 ¥" + price + "/人") : String(price);
      else price = "";
      var note = f.note ? ("　" + f.note) : "";
      var head = "<b>" + escapeHtml(f.shop) + "</b>" + (price ? "（" + escapeHtml(price) + "）" : "");
      var body = dishes ? ("　招牌：" + escapeHtml(dishes)) : "";
      return "<div class='ai-row'>" + head + body + escapeHtml(note) + "</div>";
    }).join("");
    return "<div class='ai-muted'>" + escapeHtml(city) + " · 本地人常去（数据来自离线知识库）</div>" + lines;
  }
  function landmarkHtml(city) {
    var names = getLandmarks(city, 8);
    if (!names.length) return null;
    var D = getD();
    var lis = names.map(function (nm) {
      var d = D.SPOT_DETAILS && D.SPOT_DETAILS[nm];
      var intro = d && d.intro;
      if (intro) return "<li><b>" + escapeHtml(nm) + "</b> — " + escapeHtml(intro.length > 56 ? intro.slice(0, 56) + "…" : intro) + "</li>";
      return "<li>" + escapeHtml(nm) + "</li>";
    }).join("");
    return "<div class='ai-muted'>" + escapeHtml(city) + " · 代表性去处（" + names.length + "+）</div><ul>" + lis + "</ul>";
  }

  function buildReply(text) {
    text = (text || "").trim();
    var intent = detectIntent(text);
    var place = detectPlace(text);
    if (place && place.type === "city") lastCity = place.name;
    else if (place && place.type === "province") lastCity = null;

    // 问候 / 帮助
    if (intent === "greeting")
      return { html: "你好～我是旅行攻略生成器的内置助手 🧭\n可查<b>城市美食 / 景点地标 / 最佳季节 / 必备清单</b>，也能直接跳 App 生成专属行程。\n说个城市名，或点下面的快捷提问试试～" };
    if (intent === "help")
      return { html: "我能帮你：\n• 美食推荐（如「成都吃什么」）\n• 景点速览（如「杭州必去」）\n• 最佳季节（如「几月去云南」）\n• 必备清单（如「去海边带什么」）\n• 一键跳 App 生成行程\n\n数据来自离线知识库，" + (llmEnabled() ? "已接入大模型，可自由对话。" : "无需联网。") };

    // 省份
    if (place && place.type === "province") {
      var cs = getCitiesOfProvince(place.name);
      if (cs.length) {
        var guideCs = cs.filter(hasGuide).slice(0, 12);
        return { html: "<b>" + escapeHtml(place.name) + "</b> 下辖热门城市（" + cs.length + " 座，含县级市）：\n" +
          guideCs.map(function (c) { return "<span class='ai-row'>· " + escapeHtml(c) + "</span>"; }).join("") +
          "\n\n想看哪座城市的美食或景点？直接说城市名即可～" };
      }
      return { html: "<b>" + escapeHtml(place.name) + "</b> 暂时没有细分城市数据，告诉我具体城市名，我帮你查～" };
    }

    // 城市类
    if (place && place.type === "city") {
      var city = place.name;
      if (intent === "food") {
        var fh = foodHtml(city);
        if (fh) return { html: fh + "\n\n想吃得更细，可去 App「更多」里按城市翻美食清单～" };
        return { html: "<b>" + escapeHtml(city) + "</b> 暂时没有收录具体店铺，不过你可以去 App 生成行程，沿途会按城市给餐饮建议～",
          actions: [actPlan()] };
      }
      if (intent === "attraction") {
        var lh = landmarkHtml(city);
        if (lh) return { html: lh + "\n\n想排进行程、看顺路度和导航，点下面直接生成 👇",
          actions: [actPlan(city)] };
        return { html: "<b>" + escapeHtml(city) + "</b> 的地标还在补全，先用 App 生成行程，会自动挑出当天顺路的景点～",
          actions: [actPlan()] };
      }
      if (intent === "itinerary") {
        return { html: "为 <b>" + escapeHtml(city) + "</b> 规划行程，App 里最准——按你的天数、偏好、天气自动排景点+餐饮+顺路导航。\n我先把这座城市的亮点给你：\n" +
          (landmarkHtml(city) || "<span class='ai-muted'>地标数据收补中</span>") + "\n\n点下面直接进规划页 👇",
          actions: [actPlan(city)] };
      }
      if (intent === "season") {
        return { html: "去 <b>" + escapeHtml(city) + "</b> 的最佳季节：\n• 春秋（4–5 / 9–10 月）最舒服，少雨温度宜人；\n• 夏季防暑防晒、南方多雨带伞；\n• 冬季北方保暖、南方防潮。\n具体月份穿衣与当日天气，App 行程页会按日期提示～",
          actions: [actPlan(city, "去规划并看天气 →")] };
      }
      if (intent === "packing") {
        return { html: "去 <b>" + escapeHtml(city) + "</b> 的通用必备清单：\n<ul><li>身份证 / 学生证（门票常半价）</li><li>充电宝 + 数据线</li><li>舒适步行鞋</li><li>防晒霜 + 墨镜（户外多）</li><li>常用药 + 口罩</li><li>晴雨伞</li></ul>\n夏季加驱蚊、冬季加保暖层。App「更多」里也有按场景的清单可勾选～",
          actions: [actMore()] };
      }
      if (intent === "transport") {
        return { html: "到 <b>" + escapeHtml(city) + "</b> 一般三种方式：\n• 飞机：查「" + escapeHtml(city) + "机场」到市区的大巴/地铁；\n• 高铁/火车：查「" + escapeHtml(city) + "站」，市内多通地铁；\n• 自驾：导航设目的地，留意限行与停车。\n落地后的具体点位导航，App 行程页点任意一行即可唤起地图～",
          actions: [actPlan(city, "去生成带导航的行程 →")] };
      }
      // 通用（提到了城市但意图不明）
      var fhtml = foodHtml(city) || "";
      var lhtml = landmarkHtml(city);
      var both = fhtml + (lhtml ? ("\n" + lhtml) : "");
      if (both) return { html: both + "\n\n想把它排成几天行程？点下面直接生成 👇",
        actions: [actPlan(city)] };
      return { html: "关于 <b>" + escapeHtml(city) + "</b>，我去 App 里能给你最完整的攻略。点下面直接生成行程～",
        actions: [actPlan()] };
    }

    // 没提到具体城市
    if (intent === "food" || intent === "attraction" || intent === "itinerary" || intent === "season" || intent === "packing" || intent === "transport") {
      var tips = {
        food: "告诉我具体城市，我给你列本地人常去的美食（如「西安吃什么」）。",
        attraction: "说一个城市名，我列出那里的代表性地标（如「重庆有哪些必去」）。",
        itinerary: "想规划行程？告诉我城市+天数，或直接点下面进规划页。",
        season: "问我「几月去 XX 最好」，把 XX 换成城市名就行～",
        packing: "去哪类目的地？海边/山地/城市各不相同，告诉我城市我给精准清单。",
        transport: "说个城市，我告诉你怎么到、落地怎么走。"
      };
      return { html: (tips[intent] || "") + "\n\n或者先看看这些热门城市：\n" +
        ["北京", "成都", "杭州", "西安", "重庆", "云南"].map(function (c) { return "<span class='ai-row'>· " + c + "</span>"; }).join("") };
    }

    // 兜底
    if (lastCity)
      return { html: "我可以帮你查 <b>" + escapeHtml(lastCity) + "</b> 的美食、景点、季节或必备清单，也可以直接生成行程。想看哪一项？" };
    return { html: "我是旅行攻略生成器的内置助手 🧭 告诉我你想去的城市，比如「成都吃什么」「杭州最佳季节」，或点下面的快捷提问～" };
  }

  /* ───────── 可选大模型接入 ───────── */
  var LS_KEY = "ai_llm_cfg_v1";
  var _obfKey = "tg-ai-2026"; // 轻量混淆盐（非加密，仅防止一眼读取 localStorage 中的 Key，#109）
  function _xor(s) {
    if (!s) return s;
    var o = "";
    for (var i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ _obfKey.charCodeAt(i % _obfKey.length));
    return o;
  }
  function llmCfg() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      if (obj._obf && obj.apiKey) obj.apiKey = _xor(obj.apiKey); // 读取时还原（兼容旧明文：无 _obf 则不还原）
      return obj;
    } catch (e) { return {}; }
  }
  function llmSave(cfg) {
    try {
      var c = JSON.parse(JSON.stringify(cfg));
      if (c.apiKey) { c.apiKey = _xor(c.apiKey); c._obf = 1; }
      localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch (e) {}
  }
  function llmEnabled() { return !!(llmCfg().enabled && llmCfg().apiKey && llmCfg().baseURL); }
  // baseURL 安全校验：仅允许 https，拒绝本机/内网地址，防客户端请求伪造（#110）
  function safeBaseURL(u) {
    try {
      var s = String(u || "").trim();
      if (!/^https:\/\//i.test(s)) return null;
      var host = s.replace(/^https:\/\//i, "").split("/")[0].toLowerCase();
      if (host === "localhost" || host.endsWith(".local")) return null;
      if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
      return s.replace(/\/+$/, "");
    } catch (e) { return null; }
  }
  function callLLM(history, onDone, onErr) {
    var c = llmCfg();
    var base = safeBaseURL(c.baseURL);
    if (!base) { onErr("Base URL 不合法：仅支持 https，且不能是本机/内网地址"); return; }
    var url = base + "/chat/completions";
    var sys = "你是「旅行攻略生成器」的网页助手，基于离线旅行知识库回答中国国内旅行问题，简洁实用、用中文。";
    var msgs = [{ role: "system", content: sys }].concat(history.map(function (m) {
      return { role: m.user ? "user" : "assistant", content: m.text };
    }));
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
      body: JSON.stringify({ model: c.model || "gpt-4o-mini", messages: msgs, temperature: 0.6 })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        // 错误回退文案固定，不向对话气泡透传原始异常（#113）
        if (!o.ok || !o.j.choices || !o.j.choices[0]) { onErr("大模型接口返回异常，已切换离线助手"); return; }
        onDone(o.j.choices[0].message.content || "");
      }).catch(function () { onErr("大模型请求失败（多为浏览器跨域/CORS 限制），已切换离线助手"); });
  }

  /* ───────── UI 构建 ───────── */
  var dom = {}, history = [];
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function buildUI() {
    var fab = el("button", "ai-fab", "🧭");
    fab.setAttribute("aria-label", "打开 AI 助手");
    fab.id = "aiFab";
    var dot = el("span", "ai-fab-dot");
    fab.appendChild(dot);

    var backdrop = el("div", "ai-backdrop");
    backdrop.id = "aiBackdrop";

    var panel = el("div", "ai-panel");
    panel.id = "aiPanel";
    panel.innerHTML =
      "<div class='ai-head'>" +
        "<div class='ai-avatar'>🧭</div>" +
        "<div style='flex:1'><div class='ai-title'>旅行 AI 助手</div><div class='ai-sub'>离线知识库 · 内置</div></div>" +
        "<button class='ai-gear' id='aiGear' title='设置'>⚙</button>" +
        "<button class='ai-x' id='aiClose' title='关闭'>×</button>" +
      "</div>" +
      "<div class='ai-msgs' id='aiMsgs'></div>" +
      "<div class='ai-chips' id='aiChips'></div>" +
      "<div class='ai-input-bar'>" +
        "<textarea id='aiInput' rows='1' placeholder='问我去哪吃、去哪玩…'></textarea>" +
        "<button class='ai-send' id='aiSend'>↑</button>" +
      "</div>" +
      "<div class='ai-settings' id='aiSettings'>" +
        "<label><input type='checkbox' id='aiLlmOn'/> 启用大模型（OpenAI 兼容接口，可选）</label>" +
        "<label>Base URL</label><input type='text' id='aiBase' placeholder='https://api.openai.com/v1'/>" +
        "<label>API Key</label><input type='password' id='aiKey' placeholder='sk-...'/>" +
        "<label>模型名</label><input type='text' id='aiModel' placeholder='gpt-4o-mini'/>" +
        "<div class='ai-hint'>留空则使用内置离线助手。浏览器直连大模型可能因跨域(CORS)被拦，属正常现象。</div>" +
        "<button class='ai-save' id='aiSave'>保存设置</button>" +
      "</div>";

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    dom = {
      fab: fab, backdrop: backdrop, panel: panel,
      msgs: panel.querySelector("#aiMsgs"),
      chips: panel.querySelector("#aiChips"),
      input: panel.querySelector("#aiInput"),
      send: panel.querySelector("#aiSend"),
      settings: panel.querySelector("#aiSettings")
    };

    fab.addEventListener("click", openPanel);
    backdrop.addEventListener("click", closePanel);
    panel.querySelector("#aiClose").addEventListener("click", closePanel);
    panel.querySelector("#aiSend").addEventListener("click", send);
    panel.querySelector("#aiGear").addEventListener("click", function () {
      dom.settings.classList.toggle("show");
    });
    dom.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    dom.input.addEventListener("input", function () {
      this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 96) + "px";
    });
    // 设置读写
    var c = llmCfg();
    panel.querySelector("#aiLlmOn").checked = !!c.enabled;
    panel.querySelector("#aiBase").value = c.baseURL || "";
    panel.querySelector("#aiKey").value = c.apiKey || "";
    panel.querySelector("#aiModel").value = c.model || "";
    panel.querySelector("#aiSave").addEventListener("click", function () {
      var rawBase = panel.querySelector("#aiBase").value.trim();
      var nc = {
        enabled: panel.querySelector("#aiLlmOn").checked,
        baseURL: rawBase,
        apiKey: panel.querySelector("#aiKey").value.trim(),
        model: panel.querySelector("#aiModel").value.trim()
      };
      // baseURL 安全门禁：仅 https 且非本机/内网（#110），非法则退回离线并提示
      if (nc.enabled && !safeBaseURL(rawBase)) {
        toast("Base URL 不合法：仅支持 https，且不能是本机/内网地址，已暂不启用大模型");
        nc.enabled = false;
      }
      llmSave(nc); // 写入时混淆 apiKey（#109），替代明文 localStorage
      pushBot(nc.enabled && nc.apiKey && nc.baseURL ? "已启用大模型接入 ✅ 现在可以像聊天一样自由对话。" : "已保存。未填写 Key 或取消勾选时，仍使用内置离线助手。");
      dom.settings.classList.remove("show");
    });

    // 快捷提问
    var chips = ["成都吃什么", "杭州最佳季节", "重庆必去景点", "去海边要带什么", "北京3日游怎么安排", "云南有哪些城市"];
    chips.forEach(function (t) {
      var b = el("button", "ai-chip", escapeHtml(t));
      b.addEventListener("click", function () { dom.input.value = t; send(); });
      dom.chips.appendChild(b);
    });
  }

  function openPanel() {
    dom.panel.classList.add("open");
    dom.backdrop.classList.add("show");
    dom.fab.style.display = "none";
    setTimeout(function () { dom.input.focus(); }, 220);
    if (!dom._welcomed) {
      dom._welcomed = true;
      whenReady(function () {
        pushBot("你好，我是旅行攻略生成器的内置助手 🧭\n告诉我你想去的城市，我帮你查美食、景点、最佳季节；也能直接跳去生成专属行程。先挑一个试试？");
      });
    }
  }
  function closePanel() {
    dom.panel.classList.remove("open");
    dom.backdrop.classList.remove("show");
    dom.fab.style.display = "";
  }

  function pushUser(text) {
    var m = el("div", "ai-msg user", "<div class='ai-bubble'>" + escapeHtml(text) + "</div>");
    dom.msgs.appendChild(m); scroll();
    history.push({ user: true, text: text });
  }
  function pushBot(html, actions) {
    var inner = "<div class='ai-bubble'>" + html + "</div>";
    var m = el("div", "ai-msg bot", inner);
    if (actions && actions.length) {
      actions.forEach(function (a) {
        var btn = el("button", "ai-act", escapeHtml(a.label));
        btn.addEventListener("click", function () { if (APP.go) APP.go(a.path); closePanel(); });
        m.querySelector(".ai-bubble").appendChild(btn);
      });
    }
    dom.msgs.appendChild(m); scroll();
    history.push({ user: false, text: html.replace(/<[^>]+>/g, "") });
  }
  function pushTyping() {
    var m = el("div", "ai-msg bot", "<div class='ai-bubble'><div class='ai-typing'><span></span><span></span><span></span></div></div>");
    m.id = "aiTyping";
    dom.msgs.appendChild(m); scroll();
  }
  function clearTyping() { var t = document.getElementById("aiTyping"); if (t) t.remove(); }
  function scroll() { dom.msgs.scrollTop = dom.msgs.scrollHeight; }

  // 轻量 toast：用于超限等提示（不阻断交互，#111）
  var _toastT = null;
  function toast(msg) {
    var t = document.getElementById("aiToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "aiToast";
      t.className = "ai-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    if (_toastT) clearTimeout(_toastT);
    _toastT = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function send() {
    var v = (dom.input.value || "").trim();
    if (!v) return;
    // 消息长度上限，防止超长输入撑爆气泡 / 历史数组（#111）
    if (v.length > 2000) {
      v = v.slice(0, 2000) + "…";
      toast("已截断到 2000 字上限");
    }
    dom.input.value = ""; dom.input.style.height = "auto";
    pushUser(v);

    if (llmEnabled()) {
      pushTyping();
      callLLM(history.slice(0, -1), function (txt) {
        clearTyping(); pushBot(escapeHtml(txt).replace(/\n/g, "<br/>"));
      }, function (err) {
        clearTyping(); pushBot("⚠️ " + escapeHtml(err) + "\n已回退到内置离线助手：");
        var r = buildReply(v); pushBot(r.html, r.actions);
      });
      return;
    }

    pushTyping();
    whenReady(function () {
      setTimeout(function () {
        clearTyping();
        var r = buildReply(v);
        pushBot(r.html, r.actions);
      }, 360); // 轻微延迟，模拟思考
    });
  }

  /* ───────── 启动 ───────── */
  function init() {
    if (document.getElementById("aiFab")) return;
    buildUI();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
