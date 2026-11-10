/* web/ai-assistant.js —— 网页版内置 AI 助手（全站智能体）
 *
 * 设计原则（与小程序一致，离线优先、零伪造）：
 *   1) 默认零网络、零 key：意图识别与问答只用同源离线知识库（城市/美食/地标/省份）；
 *   2) 感知全站上下文：当前页面 + query + 页面实例 data + globalData.plan + 账本/清单/足迹，
 *      全部通过小程序原有的真实 API 读取，不编造任何店铺、景点、医院、评分；
 *   3) 能干活：直接生成并写入行程、带 query 跳到全站任意一页（页面清单与 app.json 同源）；
 *   4) 可选大模型：面板里填 OpenAI 兼容 baseURL+key+model 即切换为真实 LLM（默认关），
 *      system prompt 里会注入当前页面与行程摘要，避免 LLM 变成「不知道用户在哪」的孤岛。
 *
 * 2026-11-10 升级：由「孤立悬浮窗」改为全站智能体 —— 能直接生成并落行程、
 * 带参数跳任意页（与 app.json 同源）、快捷提问随页面变化、对外暴露 window.__webAI。
 */
(function () {
  "use strict";

  var APP = window;

  /* ───────── 1. 数据接入（懒取，等 initData 合并完成） ───────── */
  function getD() {
    try { return APP.__require("__entry__", "./utils/data.js") || {}; }
    catch (e) { return {}; }
  }
  function getT() {
    try { return APP.__require("__entry__", "./utils/travel.js") || {}; }
    catch (e) { return {}; }
  }
  function getApp_() {
    try { return (typeof APP.getApp === "function" && APP.getApp()) || APP.__APP_CONFIG || {}; }
    catch (e) { return APP.__APP_CONFIG || {}; }
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

  /* ───────── 2. 全站上下文感知 ───────── */
  function pageTitle(p) {
    var list = APP.__WEB_NAV || [];
    for (var i = 0; i < list.length; i++) if (list[i].p === p) return list[i].t;
    return String(p || "").split("/").pop() || "出发";
  }
  function context() {
    var r = (APP.__webSplitHash ? APP.__webSplitHash() : { path: "pages/index/index", query: {} });
    var inst = APP.__webCurrent ? APP.__webCurrent() : null;
    var g = getApp_();
    var plan = (g && g.globalData && g.globalData.plan) || null;
    return {
      path: r.path || "pages/index/index",
      query: r.query || {},
      title: pageTitle(r.path || "pages/index/index"),
      page: inst,
      data: (inst && inst.data) || {},
      plan: plan,
    };
  }
  function siteSummary(ctx) {
    var p = ctx.plan;
    if (!p || !p.days || !p.days.length)
      return "目前还没有行程。说一句「帮我生成成都 3 天行程」，我直接排好并带你过去。";
    return "当前行程：<b>" + escapeHtml(p.cityName || "") + " · " + p.days.length + " 天</b>（出发 " +
      escapeHtml(String(p.depart || "").slice(0, 10)) + "）。可以问我「今天还剩几项安排」「行程体检」「今天花了多少」。";
  }

  /* ───────── 3. 意图识别 ───────── */
  var INTENTS = [
    { key: "food",       kw: /吃|美食|小吃|餐厅|饭店|酒楼|特色菜|好吃|料理|必吃|餐馆|味道|口味|夜市|馆子/ },
    { key: "attraction", kw: /景点|好玩|玩|名胜|打卡|景区|必去|游览|风光|风景|地标|去哪|值得/ },
    { key: "itinerary",  kw: /行程|路线|几天|日游|安排|规划|攻略|玩法|计划|怎么玩|顺序|一日游|两日游|三日游/ },
    { key: "season",     kw: /天气|季节|几月|最佳时间|什么时候|穿|温度|冷|热|雨季|避开|气候|舒服|适宜/ },
    { key: "packing",    kw: /带|必备|准备|行李|物品|装备|清单|收拾|要带|装/ },
    { key: "transport",  kw: /怎么去|交通|高铁|飞机|机场|车站|到达|自驾|火车|怎么到|怎么走/ },
    { key: "greeting",   kw: /你好|您好|hi|hello|在吗|助手|你是|嗨|在么|你是谁/ },
    { key: "help",       kw: /能做什么|怎么用|功能|帮助|会什么|能帮|干什么|怎么操作/ },
  ];
  function detectIntent(text) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].kw.test(text)) return INTENTS[i].key;
    return "general";
  }

  /* 城市 / 省份识别（缓存合并正则，单次扫描，#119） */
  var _placeReg = null;
  function placeRegex() {
    if (_placeReg) return _placeReg;
    var D = getD(), toks = [];
    (D.CITIES || []).forEach(function (c) { if (c && c.name && c.name.length >= 2) toks.push(c.name); });
    (D.PROVINCES || []).forEach(function (p) { if (p) toks.push(p); });
    var c2p = D.CITY2PROV || {}; Object.keys(c2p).forEach(function (k) { if (k) toks.push(k); });
    toks.sort(function (a, b) { return b.length - a.length; });
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
  function getLandmarks(city, n) { return getSpots(city, n || 6); }
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

  /* ───────── 4. 全站动作 ───────── */
  function act(path, label, query, mode) {
    return { label: label, path: path, query: query || {}, mode: mode || "push" };
  }
  function actPlan(city, label) {
    return act("pages/plan/plan", label || (city ? "为" + city + "看行程 →" : "去生成行程 →"), {}, "tab");
  }
  function actMore(label) {
    return act("pages/more/more", label || "打开清单工具 →", {}, "tab");
  }
  /** 每条回答都给「直达对应页」的动作，让 AI 真的服务全站而不只是聊天 */
  function pageActions(ctx, intent) {
    var cityQ = lastCity ? { city: lastCity } : {};
    var mapQ = { di: 0 };
    var common = [actPlan(), act("subpkg/map/map", "看地图导引 →", mapQ)];
    if (intent === "food") return [act("subpkg/food/food", "打开美食清单 →", cityQ), act("subpkg/toolkit/toolkit", "旅行百宝箱 →")].concat(common);
    if (intent === "attraction") return [act("subpkg/spotsearch/spotsearch", "按标签找景点 →"), act("subai/deep/deep", "城市深度玩法 →", cityQ)].concat(common);
    if (intent === "packing") return [act("subpkg/prep/prep", "打开出行准备 →"), act("pages/today/today", "打开今天 →", {}, "tab")];
    if (intent === "transport") return [act("subpkg/map/map", "打开地图导引 →", mapQ), actPlan()];
    return [act("pages/index/index", "打开生成攻略 →", {}, "tab"), act("subpkg/assistant/assistant", "本地速查 →")];
  }

  /** 显式导航意图：只有用户说「打开/跳到/带我去 X 页」才直接切页 */
  var NAV_KW = [
    { re: /出发页|生成攻略|首页|规划页|做行程/, p: "pages/index/index", t: "生成攻略" },
    { re: /今天页|今日速览/, p: "pages/today/today", t: "今天" },
    { re: /行程页|每日行程/, p: "pages/plan/plan", t: "每日行程" },
    { re: /更多页|设置页/, p: "pages/more/more", t: "更多" },
    { re: /我的攻略|存档/, p: "pages/myguides/myguides", t: "我的攻略" },
    { re: /应急|医院|120|急救/, p: "pages/help/help", t: "旅途应急" },
    { re: /使用指南|教程/, p: "subpkg/guide/guide", t: "使用指南" },
    { re: /美食页|必吃清单/, p: "subpkg/food/food", t: "美食" },
    { re: /记账|账本|分账/, p: "subpkg/ledger/ledger", t: "记账" },
    { re: /地图|动线|导航页/, p: "subpkg/map/map", t: "地图导引" },
    { re: /准备页|行李清单|打包/, p: "subpkg/prep/prep", t: "出行准备" },
    { re: /速查|随身问答|百科/, p: "subpkg/assistant/assistant", t: "本地速查" },
    { re: /工具箱|百宝箱/, p: "subpkg/toolkit/toolkit", t: "旅行百宝箱" },
    { re: /找景点|按标签|标签检索/, p: "subpkg/spotsearch/spotsearch", t: "按标签找景点" },
    { re: /深度玩法|机位|避坑/, p: "subai/deep/deep", t: "城市深度玩法" },
  ];
  function detectNav(text) {
    if (!/打开|跳转|跳到|切到|切换|进入|带我|前往|去看看|去.{0,6}页/.test(text)) return null;
    for (var i = 0; i < NAV_KW.length; i++) if (NAV_KW[i].re.test(text)) return NAV_KW[i];
    // 兜底：用构建生成的页面标题精确匹配（新增页面自动可用）
    var list = APP.__WEB_NAV || [];
    for (var j = 0; j < list.length; j++) if (text.indexOf(list[j].t) >= 0) return { p: list[j].p, t: list[j].t };
    return null;
  }
  var NUM_CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function numOf(s) { return /^\d+$/.test(s) ? parseInt(s, 10) : (NUM_CN[s] || 0); }
  function parseDays(text) {
    var m = text.match(/(\d+|[一二三四五六七八九十两])\s*(?:天|日)/);
    return m ? Math.max(1, Math.min(14, numOf(m[1]) || 3)) : 3;
  }
  function detectGenerate(text) {
    if (/打开|跳转|切到|进入|带我去.*页/.test(text)) return false;
    return /生成|做一份|排一份|安排一下|帮我排|来一份|规划一份|日游|怎么安排|几日游|天.*怎么玩/.test(text);
  }

  /* ───────── 5. 真正生成行程（写进 globalData，切到行程页即可见） ───────── */
  function localDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function generatePlan(cityName, days) {
    var T = getT();
    var city = T.findCity ? T.findCity(cityName) : null;
    if (!city) return { ok: false, msg: "离线知识库里还没有「" + escapeHtml(cityName) + "」这座城市，换个已收录的城市试试（如成都、杭州、西安）。" };
    var n = Math.max(1, Math.min(14, parseInt(days, 10) || 3));
    var dep = localDate(new Date(Date.now() + 7 * 86400000));
    var daysArr;
    try {
      daysArr = T.buildPlan({
        city: city, days: n, depart: dep, budget: "mid", pace: "balance",
        travelMode: "", people: 1, stayMountain: true, picks: [], pickOnly: false, bias: "",
      });
    } catch (e) {
      return { ok: false, msg: "行程生成失败：" + escapeHtml(e && e.message ? e.message : String(e)) };
    }
    if (!daysArr || !daysArr.length) return { ok: false, msg: "这座城市暂时排不出逐日行程，换座城市试试。" };
    var plan = {
      cityName: city.name, province: city.province || "", totalDays: daysArr.length,
      depart: dep, days: daysArr, budget: "mid", customAmt: 0, people: 1,
      pace: "balance", travelMode: "", pickOnly: false, isMulti: false,
      from: { province: "", city: "" }, savedAt: Date.now(), bias: "",
    };
    var g = getApp_();
    try {
      if (g && typeof g.setPlan === "function") g.setPlan(plan);       // 小程序同源的存档逻辑
      else if (g && g.globalData) g.globalData.plan = plan;             // 降级：至少当前会话可见
      else return { ok: false, msg: "当前运行环境拿不到 getApp()，行程无法保存。" };
    } catch (e) {
      return { ok: false, msg: "行程已算出但保存失败：" + escapeHtml(e && e.message ? e.message : String(e)) };
    }
    return { ok: true, plan: plan };
  }

  /* ───────── 6. 站点状态问答（全部走真实 API，零伪造） ───────── */
  function noPlanReply() {
    return {
      html: "现在还没有行程，我读不到对应的真实数据。说一句「帮我生成成都 3 天行程」，我直接排好并带你过去。",
      actions: [act("pages/index/index", "打开生成攻略 →", {}, "tab")],
    };
  }
  function siteStatus(text, ctx) {
    var T = getT(), plan = ctx.plan;
    if (/今天.*(花|花费|消费|花了)|今日花费|花了多少|记账.*多少/.test(text)) {
      var v = T.todaySpent ? Math.round(Number(T.todaySpent()) || 0) : 0;
      return {
        html: "今天账本记录合计 <b>¥" + v + "</b>（来自本机账本，逐笔可在记账页核对）。",
        actions: [act("subpkg/ledger/ledger", "打开记账核对 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
      };
    }
    if (/总花费|一共花|全程花|预算|超支/.test(text)) {
      var tot = T.totalSpent ? Math.round(Number(T.totalSpent()) || 0) : 0;
      var gauge = plan && T.budgetGauge ? T.budgetGauge(plan) : null;
      return {
        html: "账本累计 <b>¥" + tot + "</b>。" +
          (gauge ? escapeHtml(gauge.txt || "") + "（进度 " + gauge.pct + "%）。" : "生成行程后可看预算对比。"),
        actions: [act("subpkg/ledger/ledger", "打开账本 →"), act("pages/plan/plan", "看行程 →", {}, "tab")],
      };
    }
    if (/体检|行程.*(检查|合理|问题|有没有)|排得|太赶|需要改|挑毛病/.test(text)) {
      if (!plan || !plan.days || !plan.days.length) return noPlanReply();
      var ck = T.tripCheck ? T.tripCheck(plan) : null;
      var items = (ck && ck.items) || [];
      var h = "<b>行程体检 · " + escapeHtml(plan.cityName || "") + " " + plan.days.length + " 天</b>\n" +
        items.slice(0, 4).map(function (x) {
          return "<div class='ai-row'>· " + escapeHtml(x.t || "") + " —— " + escapeHtml(x.x || "") + "</div>";
        }).join("");
      return {
        html: h,
        actions: [act("pages/plan/plan", "打开行程页 →", {}, "tab"), act("subpkg/prep/prep", "出行准备 →")],
      };
    }
    if (/还差.*天|倒计时|什么时候出发|几天后出发|出发还有/.test(text)) {
      if (!plan || !plan.days || !plan.days.length) return noPlanReply();
      var st = T.todayState ? T.todayState(plan) : null;
      var s = !st ? "行程日期还没设定。" :
        st.phase === "before" ? "距出发还有 <b>" + st.daysLeft + " 天</b>" :
        st.phase === "during" ? "正在进行第 <b>" + st.dayNo + "/" + st.total + "</b> 天" :
        "这趟行程已经结束。";
      return {
        html: s + "（出发日 " + escapeHtml(String(plan.depart || "").slice(0, 10)) + "）。",
        actions: [act("pages/today/today", "打开今天 →", {}, "tab"), act("pages/plan/plan", "看行程 →", {}, "tab")],
      };
    }
    if (/今天.*(还剩|几项|安排|接下来)|下一站|明天去哪/.test(text)) {
      if (!plan || !plan.days || !plan.days.length) return noPlanReply();
      var stt = T.todayState ? T.todayState(plan) : null;
      if (!stt || stt.phase !== "during") {
        return {
          html: stt && stt.phase === "before" ? "还没出发，行前待办与自动行李清单可以在「今天」页看。" : "今天没有进行中的行程安排。",
          actions: [act("pages/today/today", "打开今天 →", {}, "tab")],
        };
      }
      var day = plan.days[stt.idx] || {};
      var na = T.nextActivity ? T.nextActivity(day) : null;
      var mv = T.dayMove ? T.dayMove(day, plan.cityName) : null;
      var nowName = na && na.now && T.cleanSpotName ? T.cleanSpotName(na.now.name) : "";
      return {
        html: "第 <b>" + stt.dayNo + "/" + stt.total + "</b> 天" +
          (na ? "，还剩 " + na.left + " 项安排" : "") +
          (nowName ? "，当前：「" + escapeHtml(nowName) + "」" : "") + "。\n" +
          (mv ? "按真实坐标估算：当天动线约 <b>" + mv.km + " km</b>、步行约 " + mv.steps + " 步。" : ""),
        actions: [act("pages/today/today", "打开今天 →", {}, "tab"),
          act("subpkg/map/map", "看当天地图 →", { di: stt.idx })],
      };
    }
    if (/还差.*(项|准备)|清单.*(进度|完成)|打包.*进度|出发前.*准备/.test(text)) {
      if (!plan || !plan.days || !plan.days.length) return noPlanReply();
      var pk = T.packSmart ? T.packSmart(plan) : null;
      var checks = T.getPrepChecks ? T.getPrepChecks() : {};
      var done = 0;
      for (var k in checks) if (checks[k]) done++;
      return {
        html: "自动行李清单已勾 <b>" + (pk ? pk.done : 0) + "/" + (pk ? pk.total : 0) + "</b> 项（" +
          (pk ? pk.pct : 0) + "%），行前待办已完成 " + done + " 项。",
        actions: [act("subpkg/prep/prep", "打开出行准备 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
      };
    }
    if (/足迹|打卡|去过几|点亮.*城/.test(text)) {
      var fs = T.footStats ? T.footStats() : null;
      return {
        html: fs ? "足迹：已点亮 <b>" + fs.cities + "</b> 座城市、打卡 <b>" + fs.spots + "</b> 个景点（本机记录）。"
                 : "足迹数据暂时读不到。",
        actions: [act("pages/more/more", "打开更多看足迹 →", {}, "tab")],
      };
    }
    if (/动线|哪天最累|步行量|走多少|几公里/.test(text)) {
      if (!plan || !plan.days || !plan.days.length || !T.dayMove) return noPlanReply();
      var arr = plan.days.map(function (d, i) {
        var m = T.dayMove(d, plan.cityName) || { km: 0, steps: 0 };
        return { i: i, km: m.km, steps: m.steps };
      });
      var mx = arr.reduce(function (a, b) { return b.km > a.km ? b : a; }, arr[0]);
      return {
        html: "按真实坐标估算，<b>第 " + (mx.i + 1) + " 天</b> 动线最长：约 " + mx.km +
          " km、步行约 " + mx.steps + " 步；其余天可在行程页逐日查看。",
        actions: [act("subpkg/map/map", "看那天地图 →", { di: mx.i }),
          act("pages/plan/plan", "看行程 →", {}, "tab")],
      };
    }
    return null;
  }

  /* ───────── 7. 回复生成（离线） ───────── */
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
    return "<div class='ai-muted'>" + escapeHtml(city) + " · 本地人常去（离线知识库）</div>" + lines;
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

  function buildReply(text, ctx) {
    text = (text || "").trim();
    ctx = ctx || context();
    var intent = detectIntent(text);
    var place = detectPlace(text);
    if (place && place.type === "city") lastCity = place.name;
    else if (place && place.type === "province") lastCity = null;

    // ① 站点状态：读真实账本/行程/清单/足迹，优先于泛化问答
    var site = siteStatus(text, ctx);
    if (site) return site;

    // ② 直接把行程排出来（不是回一句「去规划页」）
    if (detectGenerate(text)) {
      var target = (place && place.type === "city") ? place.name : lastCity;
      if (!target) {
        return {
          html: "说一座城市 + 天数就行，比如「帮我生成成都 3 天行程」「杭州 5 日游怎么安排」，我会直接排好并切到行程页。",
          actions: [act("pages/index/index", "打开生成攻略 →", {}, "tab")],
        };
      }
      var n = parseDays(text);
      var res = generatePlan(target, n);
      if (!res.ok) return { html: res.msg, actions: [act("pages/index/index", "打开生成攻略 →", {}, "tab")] };
      var d0 = res.plan.days[0] || {};
      return {
        html: "已为 <b>" + escapeHtml(target) + "</b> 生成 <b>" + res.plan.totalDays + " 天</b>行程（出发日 " +
          escapeHtml(res.plan.depart) + "），并写入当前行程。\n第一天主题：" + escapeHtml(d0.theme || "逐日展开") +
          "，共 " + ((d0.items || []).length) + " 项安排。现在切到行程页即可逐日查看、换景点、记账。",
        actions: [act("pages/plan/plan", "打开每日行程 →", {}, "tab"),
          act("subpkg/map/map", "看地图导引 →"), act("pages/today/today", "打开今天 →", {}, "tab")],
        auto: "pages/plan/plan", mode: "tab",
      };
    }

    // ②b 「看第 N 天地图」：带 di 参数直达对应天（map.js onLoad 读 options.di，0-based）
    var dayMap = text.match(/第\s*(\d+|[一二三四五六七八九十])\s*天.*地图|地图.*第\s*(\d+|[一二三四五六七八九十])\s*天/);
    if (dayMap) {
      var di = Math.max(0, numOf(dayMap[1] || dayMap[2]) - 1);
      return {
        html: "好，切到地图导引的 <b>第 " + (di + 1) + " 天</b> 图层（网页端为真实坐标示意图，点编号可唤起导航）。",
        actions: [],
        auto: "subpkg/map/map", query: { di: di }, mode: "push",
      };
    }

    // ③ 显式导航：一步切到目标页
    var nav = detectNav(text);
    if (nav) {
      var q = {};
      var dm = text.match(/第\s*(\d+|[一二三四五六七八九十])\s*天/);
      if (nav.p === "subpkg/map/map" && dm) q.di = Math.max(0, numOf(dm[1]) - 1);
      var dn = q.di != null ? "（第 " + (q.di + 1) + " 天）" : "";
      var isTab = false, navList = APP.__WEB_NAV || [];
      for (var z = 0; z < navList.length; z++) if (navList[z].p === nav.p) isTab = !!navList[z].tab;
      return {
        html: "好，已切到 <b>" + escapeHtml(nav.t) + "</b>" + dn + "。这一页的数据都来自本机离线知识库。",
        actions: [],
        auto: nav.p, query: q, mode: isTab ? "tab" : "push",
      };
    }

    // ④ 问候 / 帮助：带当前页面上下文
    if (intent === "greeting")
      return {
        html: "你好～我是旅行攻略生成器的内置助手 🧭\n我现在在 <b>" + escapeHtml(ctx.title) +
          "</b> 页，能读到你当前的行程、账本、行李清单和足迹（都在本机，不上传）。\n" + siteSummary(ctx) +
          "\n可以问「成都吃什么」「行程体检」「今天花了多少」，也能说「帮我生成成都 3 天行程」。",
        actions: pageActions(ctx, "general"),
      };
    if (intent === "help")
      return {
        html: "我能帮你：\n• <b>查数据</b>：城市美食 / 景点地标 / 最佳季节 / 必备清单\n" +
          "• <b>读当前状态</b>：行程体检、倒计时、今天花费、行李进度、足迹、动线步行量\n" +
          "• <b>真干活</b>：直接生成并写入行程、带参数跳到任意一页（含地图指定某一天）\n" +
          "• <b>全站导航</b>：说「打开美食页」「看第 2 天地图」即可\n\n" +
          (llmEnabled() ? "已接入大模型，可自由对话。" : "默认纯离线，无需联网、无需 Key。") + "\n" + siteSummary(ctx),
        actions: pageActions(ctx, "general"),
      };

    // ⑤ 省份
    if (place && place.type === "province") {
      var cs = getCitiesOfProvince(place.name);
      if (cs.length) {
        var guideCs = cs.filter(hasGuide).slice(0, 12);
        return {
          html: "<b>" + escapeHtml(place.name) + "</b> 下辖热门城市（" + cs.length + " 座，含县级市）：\n" +
            guideCs.map(function (c) { return "<span class='ai-row'>· " + escapeHtml(c) + "</span>"; }).join("") +
            "\n\n想看哪座城市的美食或景点？直接说城市名即可～",
          actions: [act("pages/index/index", "去生成攻略 →", {}, "tab")],
        };
      }
      return { html: "<b>" + escapeHtml(place.name) + "</b> 暂时没有细分城市数据，告诉我具体城市名，我帮你查～" };
    }

    // ⑥ 城市类
    if (place && place.type === "city") {
      var city = place.name;
      if (intent === "food") {
        var fh = foodHtml(city);
        if (fh) return { html: fh + "\n\n想吃得更细，去美食页按菜品与餐类筛选～", actions: pageActions(ctx, "food") };
        return {
          html: "<b>" + escapeHtml(city) + "</b> 暂时没有收录具体店铺（不编造店名）。可以生成行程，沿途会按城市给餐饮建议～",
          actions: [actPlan(city), act("subpkg/food/food", "打开美食页 →")],
        };
      }
      if (intent === "attraction") {
        var lh = landmarkHtml(city);
        if (lh) return { html: lh + "\n\n想排进行程、看顺路度和导航，点下面直达 👇", actions: pageActions(ctx, "attraction") };
        return {
          html: "<b>" + escapeHtml(city) + "</b> 的地标还在补全，可以先生成一份行程，会自动挑出当天顺路的景点～",
          actions: [actPlan(city), act("subpkg/spotsearch/spotsearch", "按标签找景点 →")],
        };
      }
      if (intent === "season") {
        return {
          html: "去 <b>" + escapeHtml(city) + "</b> 的最佳季节（通用口径）：\n• 春秋（4–5 / 9–10 月）最舒服，少雨温度宜人；\n• 夏季防暑防晒、南方多雨带伞；\n• 冬季北方保暖、南方防潮。\n具体月份穿衣与当日天气，行程页会按出发日期提示～",
          actions: pageActions(ctx, "season"),
        };
      }
      if (intent === "packing") {
        return {
          html: "去 <b>" + escapeHtml(city) + "</b> 的通用必备清单：\n<ul><li>身份证 / 学生证（门票常半价）</li><li>充电宝 + 数据线</li>" +
            "<li>舒适步行鞋</li><li>防晒霜 + 墨镜（户外多）</li><li>常用药 + 口罩</li><li>晴雨伞</li></ul>" +
            "按天数和当地气候自动生成的清单在「出行准备」页，可逐项打勾～",
          actions: pageActions(ctx, "packing"),
        };
      }
      if (intent === "transport") {
        return {
          html: "到 <b>" + escapeHtml(city) + "</b> 一般三种方式：\n• 飞机：查「" + escapeHtml(city) + "机场」到市区的大巴/地铁；\n" +
            "• 高铁/火车：查「" + escapeHtml(city) + "站」，市内多通地铁；\n• 自驾：导航设目的地，留意限行与停车。\n" +
            "落地后的点位导航，在地图页或行程页点任意一行即可唤起地图～",
          actions: pageActions(ctx, "transport"),
        };
      }
      var fhtml = foodHtml(city) || "";
      var lhtml = landmarkHtml(city);
      var both = fhtml + (lhtml ? ("\n" + lhtml) : "");
      if (both) return { html: both + "\n\n想排成几天行程？说「帮我生成" + escapeHtml(city) + " 3 天行程」我直接排。",
        actions: pageActions(ctx, "general") };
      return { html: "关于 <b>" + escapeHtml(city) + "</b>，离线库里暂时没有逐店/逐点的资料；我可以先生成一份行程。",
        actions: [actPlan(city)] };
    }

    // ⑦ 没提到具体城市
    if (intent === "food" || intent === "attraction" || intent === "itinerary" || intent === "season" || intent === "packing" || intent === "transport") {
      var tips = {
        food: "告诉我具体城市，我列出本地人常去的美食（如「西安吃什么」）。",
        attraction: "说一个城市名，我列出代表性地标（如「重庆有哪些必去」）。",
        itinerary: "想规划行程？说「城市 + 天数」，我直接排好并切到行程页。",
        season: "问我「几月去 XX 最好」，把 XX 换成城市名就行～",
        packing: "去哪类目的地？告诉我城市，我给精准清单与进度。",
        transport: "说个城市，我告诉你怎么到、落地怎么走。",
      };
      return {
        html: (tips[intent] || "") + "\n\n也可以先看看这些已收录城市：\n" +
          ["北京", "成都", "杭州", "西安", "重庆"].map(function (c) { return "<span class='ai-row'>· " + c + "</span>"; }).join("") +
          "\n\n" + siteSummary(ctx),
        actions: pageActions(ctx, intent),
      };
    }

    if (lastCity)
      return {
        html: "我可以帮你查 <b>" + escapeHtml(lastCity) + "</b> 的美食、景点、季节或清单，也可以直接生成行程。\n" + siteSummary(ctx),
        actions: pageActions(ctx, "general"),
      };
    return {
      html: "我是旅行攻略生成器的内置助手 🧭 当前在 <b>" + escapeHtml(ctx.title) + "</b> 页。\n" +
        "试试「成都吃什么」「帮我生成杭州 3 天行程」「行程体检」，或点下面的快捷提问～",
      actions: pageActions(ctx, "general"),
    };
  }

  /* ───────── 8. 可选大模型接入（安全策略沿用 #109/#110/#113） ───────── */
  var LS_KEY = "ai_llm_cfg_v1";
  var _obfKey = "tg-ai-2026";
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
      if (obj._obf && obj.apiKey) obj.apiKey = _xor(obj.apiKey);
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
  function llmEnabled() { var c = llmCfg(); return !!(c.enabled && c.apiKey && c.baseURL); }
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
  function callLLM(history, ctx, onDone, onErr) {
    var c = llmCfg();
    var base = safeBaseURL(c.baseURL);
    if (!base) { onErr("Base URL 不合法：仅支持 https，且不能是本机/内网地址"); return; }
    var p = ctx.plan;
    var sys = "你是「旅行攻略生成器」的网页助手，基于应用内离线旅行知识库回答中国国内旅行问题，简洁实用、用中文。" +
      "当前页面：" + ctx.title + "（" + ctx.path + "）。" +
      (p && p.days && p.days.length
        ? "当前行程：" + (p.cityName || "") + "，" + p.days.length + " 天，出发 " + String(p.depart || "").slice(0, 10) + "。"
        : "当前没有行程。") +
      "涉及具体店铺、景点、医院、价格时只能引用应用内已有数据，不得编造；不确定的就说未收录。";
    var msgs = [{ role: "system", content: sys }].concat(history.map(function (m) {
      return { role: m.user ? "user" : "assistant", content: m.text };
    }));
    fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
      body: JSON.stringify({ model: c.model || "gpt-4o-mini", messages: msgs, temperature: 0.6 }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        if (!o.ok || !o.j.choices || !o.j.choices[0]) { onErr("大模型接口返回异常，已切换离线助手"); return; }
        onDone(o.j.choices[0].message.content || "");
      }).catch(function () { onErr("大模型请求失败（多为浏览器跨域/CORS 或 CSP 限制），已切换离线助手"); });
  }

  /* ───────── 9. UI 构建 ───────── */
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
    fab.appendChild(el("span", "ai-fab-dot"));

    var backdrop = el("div", "ai-backdrop");
    backdrop.id = "aiBackdrop";

    var panel = el("div", "ai-panel");
    panel.id = "aiPanel";
    panel.innerHTML =
      "<div class='ai-head'>" +
        "<div class='ai-avatar'>🧭</div>" +
        "<div style='flex:1'><div class='ai-title'>旅行 AI 助手</div>" +
        "<div class='ai-sub' id='aiCtx'>离线知识库 · 内置</div></div>" +
        "<button class='ai-gear' id='aiGear' title='设置'>⚙</button>" +
        "<button class='ai-x' id='aiClose' title='关闭'>×</button>" +
      "</div>" +
      "<div class='ai-msgs' id='aiMsgs'></div>" +
      "<div class='ai-chips' id='aiChips'></div>" +
      "<div class='ai-input-bar'>" +
        "<textarea id='aiInput' rows='1' placeholder='问行程、账单、去哪吃，或让我直接生成…'></textarea>" +
        "<button class='ai-send' id='aiSend'>↑</button>" +
      "</div>" +
      "<div class='ai-settings' id='aiSettings'>" +
        "<label><input type='checkbox' id='aiLlmOn'/> 启用大模型（OpenAI 兼容接口，可选）</label>" +
        "<label>Base URL</label><input type='text' id='aiBase' placeholder='https://api.openai.com/v1'/>" +
        "<label>API Key</label><input type='password' id='aiKey' placeholder='sk-...'/>" +
        "<label>模型名</label><input type='text' id='aiModel' placeholder='gpt-4o-mini'/>" +
        "<div class='ai-hint'>留空则使用内置离线助手。浏览器直连大模型可能因跨域(CORS)或 CSP 被拦，属正常现象。</div>" +
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
      settings: panel.querySelector("#aiSettings"),
      ctxLine: panel.querySelector("#aiCtx"),
    };

    fab.addEventListener("click", openPanel);
    backdrop.addEventListener("click", closePanel);
    panel.querySelector("#aiClose").addEventListener("click", closePanel);
    panel.querySelector("#aiSend").addEventListener("click", send);
    panel.querySelector("#aiGear").addEventListener("click", function () { dom.settings.classList.toggle("show"); });
    dom.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    dom.input.addEventListener("input", function () {
      this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 96) + "px";
    });

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
        model: panel.querySelector("#aiModel").value.trim(),
      };
      if (nc.enabled && !safeBaseURL(rawBase)) {
        toast("Base URL 不合法：仅支持 https，且不能是本机/内网地址，已暂不启用大模型");
        nc.enabled = false;
      }
      llmSave(nc);
      pushBot(nc.enabled && nc.apiKey && nc.baseURL ? "已启用大模型接入 ✅ 现在可以像聊天一样自由对话。" : "已保存。未填 Key 或取消勾选时，仍使用内置离线助手。");
      dom.settings.classList.remove("show");
    });

    refreshChips();
    // 页面变化时更新上下文提示与快捷提问（由 app.js 的 onHash 派发）
    document.addEventListener("web:pagechange", refreshChips);
  }

  /** 快捷提问随当前页面变化 —— AI 跟着用户所在页面走，不是固定的一组问题 */
  var CHIPS = {
    "*": ["成都吃什么", "杭州最佳季节", "帮我生成成都3天行程", "我今天花了多少", "行程体检"],
    "pages/index/index": ["帮我生成成都3天行程", "杭州5日游怎么安排", "西安有哪些必去", "去海边要带什么"],
    "pages/today/today": ["今天还剩几项安排", "我今天花了多少", "还差几天出发", "打包清单进度"],
    "pages/plan/plan": ["行程体检", "哪天最累", "看第2天地图", "总花费和预算对比"],
    "pages/more/more": ["足迹点亮几座城", "帮我生成西安4天行程", "打开使用指南", "数据怎么备份"],
    "pages/myguides/myguides": ["帮我生成重庆3天行程", "行程体检", "打开我的攻略"],
    "pages/help/help": ["打开旅途应急", "生成一份行程", "打开使用指南"],
    "subpkg/food/food": ["成都吃什么", "西安必吃清单", "看美食地图", "生成成都3天行程"],
    "subpkg/map/map": ["看第2天地图", "哪天最累", "今天还剩几项安排", "打开美食页"],
    "subpkg/ledger/ledger": ["我今天花了多少", "总花费和预算对比", "怎么 AA 分账", "行程体检"],
    "subpkg/prep/prep": ["还差几项没准备", "打包清单进度", "打开出行准备", "还差几天出发"],
    "subpkg/spotsearch/spotsearch": ["重庆有哪些必去", "按标签找景点", "生成重庆3天行程"],
    "subpkg/toolkit/toolkit": ["打开旅行百宝箱", "行程体检", "生成一份行程"],
    "subpkg/assistant/assistant": ["成都吃什么", "杭州最佳季节", "打开本地速查"],
    "subai/deep/deep": ["这个城市怎么避坑", "生成一份行程", "看第2天地图"],
    "subpkg/guide/guide": ["怎么用这个应用", "打开使用指南", "帮我生成成都3天行程"],
  };
  function refreshChips() {
    if (!dom.chips) return;
    var ctx = context();
    var list = CHIPS[ctx.path] || CHIPS["*"];
    dom.chips.innerHTML = "";
    list.forEach(function (t) {
      var b = el("button", "ai-chip", escapeHtml(t));
      b.addEventListener("click", function () { dom.input.value = t; send(); });
      dom.chips.appendChild(b);
    });
    if (dom.ctxLine) dom.ctxLine.textContent = "当前：" + ctx.title + " · 离线内置";
  }

  function openPanel() {
    dom.panel.classList.add("open");
    dom.backdrop.classList.add("show");
    dom.fab.style.display = "none";
    refreshChips();
    setTimeout(function () { dom.input.focus(); }, 220);
    if (!dom._welcomed) {
      dom._welcomed = true;
      whenReady(function () {
        var ctx = context();
        pushBot("你好，我是旅行攻略生成器的内置助手 🧭 现在在 <b>" + escapeHtml(ctx.title) +
          "</b> 页。\n" + siteSummary(ctx) +
          "\n我能查离线美食/景点、读你的账本与行程状态，也能直接生成行程并带你过去。");
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
    var m = el("div", "ai-msg bot", "<div class='ai-bubble'>" + html + "</div>");
    if (actions && actions.length) {
      actions.forEach(function (a) {
        var btn = el("button", "ai-act", escapeHtml(a.label));
        btn.addEventListener("click", function () {
          if (APP.goQuery) APP.goQuery(a.path, a.query || {}, a.mode || "push");
          else if (APP.go) APP.go(a.path);
          closePanel();
        });
        m.querySelector(".ai-bubble").appendChild(btn);
      });
    }
    dom.msgs.appendChild(m); scroll();
    history.push({ user: false, text: String(html).replace(/<[^>]+>/g, "") });
  }
  function pushTyping() {
    var m = el("div", "ai-msg bot", "<div class='ai-bubble'><div class='ai-typing'><span></span><span></span><span></span></div></div>");
    m.id = "aiTyping";
    dom.msgs.appendChild(m); scroll();
  }
  function clearTyping() { var t = document.getElementById("aiTyping"); if (t) t.remove(); }
  function scroll() { dom.msgs.scrollTop = dom.msgs.scrollHeight; }

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

  function goTo(path, query, mode) {
    if (APP.goQuery) APP.goQuery(path, query || {}, mode || "push");
    else if (APP.go) APP.go(path);
  }

  function send() {
    var v = (dom.input.value || "").trim();
    if (!v) return;
    if (v.length > 2000) { v = v.slice(0, 2000) + "…"; toast("已截断到 2000 字上限"); }
    dom.input.value = ""; dom.input.style.height = "auto";
    pushUser(v);
    var ctx = context();

    if (llmEnabled()) {
      pushTyping();
      callLLM(history.slice(0, -1), ctx, function (txt) {
        clearTyping(); pushBot(escapeHtml(txt).replace(/\n/g, "<br/>"));
      }, function (err) {
        clearTyping(); pushBot("⚠️ " + escapeHtml(err) + "\n已回退到内置离线助手：");
        var r = buildReply(v, ctx); pushBot(r.html, r.actions); applyAuto(r);
      });
      return;
    }

    pushTyping();
    whenReady(function () {
      setTimeout(function () {
        clearTyping();
        var r = buildReply(v, ctx);
        pushBot(r.html, r.actions);
        applyAuto(r);
      }, 320);
    });
  }
  function applyAuto(r) {
    if (!r || !r.auto) return;
    setTimeout(function () { goTo(r.auto, r.query || {}, r.mode || "push"); }, 160);
  }

  /* ───────── 10. 对外 API + 启动 ───────── */
  APP.__webAI = {
    ask: function (text) { openPanel(); dom.input.value = String(text || ""); send(); },
    // reply 只算不渲染：网页其它模块（以及 tools/web/smoke.mjs）可直接复用同一套离线问答
    reply: function (text, ctx) { return buildReply(text, ctx || context()); },
    go: goTo,
    context: context,
    generatePlan: generatePlan,
    open: openPanel,
    close: closePanel,
  };

  function init() {
    if (document.getElementById("aiFab")) return;
    buildUI();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
