const { getAppSafe, SafePage, onShowRender } = require("../../utils/app.js");
const AN = require("../../utils/analytics.js");   // 轻量使用统计（本地计数，失败静默）
// ledger：旅行记账 · 当日与总计对比 · 日期/付款人/AA 分账/导出 CSV
const T = require("../../utils/travel.js");
const S = require("../../utils/store.js");   // v1.11：统一存储封装
const app = getAppSafe();

// 分类配色（占比图例用）
const CAT_COLORS = {
  "餐饮": "#e8c877", "门票": "#7dd3fc", "交通": "#a3e0a0",
  "住宿": "#c4b5fd", "购物": "#f9a8d4", "其他": "#94a3b8"
};

// v1.20.3 修复：删除账单的照片清理定时器放在「模块作用域」，而非页面实例 this 上。
// 原因：微信在页面 onUnload 时会销毁该页面挂起的 setTimeout；若用户删账后 6 秒内离开记账页，
// 挂在 this 上的清文件定时器被一并取消 → 照片文件与存储条目永久残留（即「项目删除后照片还存在」）。
// 模块级定时器随小程序进程存活，不受单页卸载影响；且按账单 id 各挂一个，互不清退。
const _billImgCleanups = {};

Page(SafePage({
  // v1.17.12：补上转发入口 —— 微信规则：只有定义了 onShareAppMessage 的页面，右上角菜单才显示「转发」
  onShareAppMessage() {
    return { title: "旅行花了多少？分类记账，每日明细一目了然", path: "/pages/index/index" };
  },

  data: {
    fz: 1,
    td: false,
    items: [],
    total: 0,
    today: 0,
    amt: "",
    name: "",
    cat: "餐饮",
    cats: ["餐饮", "门票", "交通", "住宿", "购物", "其他"],
    // P2：日期 / 付款人 / AA
    date: "",
    payer: "我",
    share: 1,
    // v1.11：删除未使用的 payers（setData 每次会连它一起序列化，白交学费）
    perHint: "0",
    dateFilter: "all",  // all | today | trip
    tripStart: "", tripEnd: "",
    catSums: [],   // 分类占比统计（占比图）
    budTxt: "", over: false, budPct: 0,   // 预算参考 gauge
    // v1.7：月度汇总 + 凭证图片
    monthly: null,
    // v1.6：每日额度 / 花费预测 / 同行人 / 搜索筛选
    dbud: null, forecast: null, mates: [], mateInput: "",
    kw: "", catFilter: "", filteredN: 0,
    // v1.8.4：多行程账本 / 人情 / 凭证 / 速记短语
    // 2026-10-29：移除外币选择与汇率换算，只记人民币（用户反馈：不需要他国货币）
    tripFilter: "__all", curSig: "", curLabel: "",   // v1.11：删除未使用的 trips
    iou: [], iouMate: "", iouWhat: "", iouAmt: "", iouDir: "lend", iouSt: null,
    vouchN: 0, phrases: [],
    // v1.8.5：本周统计 / 删除撤销胶囊
    week: null, undoRow: null, week7: null, mstory: null,
    // 2026-10-29：三组折叠 —— 记账页原本 20 个区块平铺，核心操作被图表夹在中间；
    // 改为「核心在前、分析/分账/详细表单折叠」，默认只留统计+一句话记账+明细。
    secDetail: false, secStats: false, secSocial: false
  },

    _theme() { const d = T.themeMode() === "dark"; this.setData({ td: d }); T.applyNav(); },
  onLoad() { this.__boot = T.ready().catch(() => null); },
  onShow() { onShowRender(this, "ledger"); },
  _renderShow() {
    try { this._theme(); } catch (e) {}
    // v1.19.204：凭证照片迁移（旧「日期#下标」键 → 账单 id）并清理孤儿照片，杜绝串图与残留
    try { T.migrateBillImgs(); } catch (e) {}
    try { T.purgeOrphanBillImgs(); } catch (e) {}
    // v1.8.5 C7：默认分类记忆上次
    try {
      const lc = S.get("miniLedgerLastCatV1", "");
      if (this.data.cats.indexOf(lc) >= 0 && this.data.cat !== lc) this.setData({ cat: lc });
    } catch (e) {}
    // v1.19.2：_sync 内含周统计/结算/AA 分摊等多处解引用，任一脏数据抛错都会冲出 onShow 白屏，
    // 与全项目「onShow 全兜底」的约定不一致 —— 这里补齐兜底。
    try { this._sync(); } catch (e) { try { wx.showToast({ title: "账本刷新异常，数据未丢失", icon: "none" }); } catch (_) {} }
    // 默认日期 = 今天；AA 人数 = 当前行程人数
    try {
      const plan = app && app.globalData && app.globalData.plan;
      const people = (plan && plan.people) ? plan.people : 1;
      const tripStart = plan && plan.days && plan.days[0] ? String(plan.days[0].date).slice(0, 10) : "";
      const tripEnd = plan && plan.days && plan.days.length ? String(plan.days[plan.days.length - 1].date).slice(0, 10) : "";
      this.setData({ share: people, tripStart, tripEnd, tripStartTx: tripStart.slice(5), tripEndTx: tripEnd.slice(5), date: T.fmtLocalDate(new Date()) });
    } catch (e) { this.setData({ date: T.fmtLocalDate(new Date()) }); }
  },

  /* ---- v1.8.4 A4：行程账本切换 ---- */
  onTrip(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.tripFilter) return;
    this.setData({ tripFilter: k });
    this._sync();
  },

  _sync() {
    // 只读一次 storage：__all/子集都从同一引用派生，保证 shown._src 能用 indexOf 命中原始下标
    const all = T.getLedger();
    // v1.8.4 A4：多行程账本（默认「全部」；可切到当前行程或历史某段）
    const planG = app && app.globalData && app.globalData.plan;
    const curSig = (planG && planG.days && planG.days.length) ? T.tripSigOf(planG) : "";
    const curLabel = curSig ? (curSig.split("|")[0] || "本次行程") : "";
    const tf = this.data.tripFilter;
    const src = (!tf || tf === "__all")
      ? all
      : all.filter(x => (tf === "__other") ? !x.trip : (x.trip === tf));
    let filtered = src;
    if (this.data.dateFilter === "today") {
      const t = T.fmtLocalDate(new Date());
      filtered = src.filter(x => String(x.date).slice(0, 10) === t);
    } else if (this.data.dateFilter === "trip" && this.data.tripStart && this.data.tripEnd) {
      filtered = src.filter(x => String(x.date).slice(0, 10) >= this.data.tripStart &&
                                  String(x.date).slice(0, 10) <= this.data.tripEnd);
    }
    // v1.6：分类筛选 + 关键词搜索
    const cf = this.data.catFilter || "";
    if (cf) filtered = filtered.filter(x => (x.cat || "其他") === cf);
    const kw = String(this.data.kw || "").trim();
    if (kw) filtered = filtered.filter(x => String(x.name || "").indexOf(kw) >= 0 || String(x.cat || "").indexOf(kw) >= 0);
    const shown = filtered.slice(0, 50).map((x, idx) => {
      const amt = Math.round(Number(x.amt) || 0);
      const share = Math.max(1, parseInt(x.share, 10) || 1);
      const per = +(amt / share).toFixed(2);
      return {
        i: idx,
        _src: all.indexOf(x),
        _id: x.id || "",
        date: String(x.date).slice(5).replace("-", "/"),
        rdate: String(x.date).slice(0, 10),
        cat: x.cat, name: x.name, amt, payer: x.payer || "我", share, per,
        img: T.getBillImg(x.id) || ""
      };
    });
    // 分类占比（按当前行程账本口径；不看日期/关键词筛选，看该账本结构）
    const totalAll = src.reduce((a, x) => a + (Number(x.amt) || 0), 0);
    const byCat = {};
    src.forEach(x => { const c = x.cat || "其他"; byCat[c] = (byCat[c] || 0) + (Number(x.amt) || 0); });
    const catSums = Object.keys(byCat)
      .map(c => ({
        cat: c,
        amt: Math.round(byCat[c]),
        pct: totalAll > 0 ? Math.round(byCat[c] / totalAll * 100) : 0,
        color: CAT_COLORS[c] || "#94a3b8"
      }))
      .sort((a, b) => b.amt - a.amt);
    // v1.7：月度汇总（条形对比，相对最高月）
    const mRaw = T.ledgerMonthly();
    const mMax = mRaw.months.length ? Math.max.apply(null, mRaw.months.map(m => m.total)) : 0;
    const monthly = {
      months: mRaw.months.map(m => Object.assign({}, m, { pct: mMax ? Math.max(6, Math.round(m.total / mMax * 100)) : 0 })),
      worst: mRaw.worst, best: mRaw.best
    };

    // 账本金额口径（同 totalSpent 的脏数据过滤：>0 且 <=1e6）
    const sumN = l => l.reduce((s, x) => { const a = Number(x.amt); return isFinite(a) && a > 0 && a <= 1e6 ? s + a : s; }, 0);
    const todayTxt = T.fmtLocalDate(new Date());
    const totalN = Math.round(sumN(src));
    const todayN = Math.round(sumN(src.filter(x => String(x.date).slice(0, 10) === todayTxt)));

    // 预算参考 gauge：只在「本次行程 / 全部」口径下展示（避免与其它行程账本混算误导）
    const isCurView = !curSig || this.data.tripFilter === "__all" || this.data.tripFilter === curSig;
    let budTxt = "", over = false, budPct = 0;
    try {
      const plan = app && app.globalData && app.globalData.plan;
      if (isCurView && plan && plan.days && plan.days.length) {
        const bo = T.budgetTotalObj(plan);
        const raw = bo && bo.totalBudget;
        let totalBud = 0;
        if (typeof raw === "number") totalBud = raw;
        else if (typeof raw === "string") {
          const nums = raw.split("-").map(Number).filter(n => isFinite(n) && n > 0);
          if (nums.length) totalBud = nums.reduce((a, b) => a + b, 0) / nums.length;
        }
        if (totalBud > 0) {
          const spent = Math.round(T.totalSpent());
          over = spent > totalBud;
          budPct = Math.min(100, Math.round(spent / totalBud * 100));
          budTxt = "已花 ¥" + spent + " / 预算 ¥" + Math.round(totalBud) +
            (over ? " · 已超预算，收一收啦" : " · 在预算内，继续玩");
        }
      }
    } catch (e) {}
    // v1.8.4 凭证缩略（当前口径下有凭证图的账）
    const vouch = (shown || []).filter(x => x.img);
    this._vouch = vouch.map(x => ({ img: x.img, name: x.name || "", date: x.date }));
    // v1.8.5 C6：本周统计（当前账本口径；保留 src 供「复制本周账单」用）
    this._src = src;
    const week = T.weekSpent(src);
    // v1.9：近 7 日柱状（当前口径）+ 本月一句话复盘
    const w7raw = T.weekBars(src);
    const week7 = Object.assign({}, w7raw, { sum: w7raw.days.reduce((a, d) => a + d.amt, 0) });
    const mstory = T.monthStory(src);
    // v1.8.4 A6 人情往来
    const iou = T.iouList();
    // v1.8.4 A4 行程 chips
    const tripOpts = [{ key: "__all", label: "全部账本" }];
    if (curSig) tripOpts.push({ key: curSig, label: "本次 · " + curLabel });
    T.ledgerTrips().forEach(t => { if (t.key !== "__all" && t.key !== curSig) tripOpts.push({ key: t.key, label: t.label }); });
    this.setData({
      items: shown,
      total: totalN,
      today: todayN,
      dayBars: T.spendByDay(10),
      catSums, budTxt, over, budPct,
      settle: T.settleUp(),
      monthly: monthly.months.length ? monthly : null,
      split: T.budgetSplit(app && app.globalData && app.globalData.plan),
      // v1.6
      dbud: T.dailyBudget(app && app.globalData && app.globalData.plan),
      forecast: T.spendForecast(app && app.globalData && app.globalData.plan),
      mates: T.getMates(),
      filteredN: filtered.length,
      allN: all.length,
      // v1.8.4
      tripOptions: tripOpts, curSig, curLabel,
      vouchN: vouch.length,
      iou, iouSt: T.iouStats(),
      phrases: T.quickPhrases(),
      week,
      week7, mstory
    });
  },

  /* ---- v1.6：搜索 / 分类筛选 ---- */
  onKw(e) { this.setData({ kw: e.detail.value }); this._sync(); },
  clearKw() { this.setData({ kw: "" }); this._sync(); },
  onCatFilter(e) {
    const c = e.currentTarget.dataset.c || "";
    this.setData({ catFilter: this.data.catFilter === c ? "" : c });
    this._sync();
  },

  /* ---- v1.6：同行人管理 ---- */
  onMateInput(e) { this.setData({ mateInput: e.detail.value }); },
  addMate() {
    const n = String(this.data.mateInput || "").trim();
    if (!n) { wx.showToast({ title: "先输入名字", icon: "none" }); return; }
    if (!T.addMate(n)) { wx.showToast({ title: "已经在名单里了", icon: "none" }); return; }
    this.setData({ mateInput: "", mates: T.getMates() });
    wx.showToast({ title: "已加入 " + n, icon: "none" });
  },
  delMate(e) {
    const i = Number(e.currentTarget.dataset.i);
    T.delMate(i);
    this.setData({ mates: T.getMates() });
  },
  pickPayer(e) {
    const n = e.currentTarget.dataset.n || "";
    this.setData({ payer: n });
    wx.showToast({ title: "付款人：" + n, icon: "none", duration: 1200 });
  },

  /* ---- v1.5：一句话记账（「打车 32」→ 金额 + 分类自动识别） ---- */
  onQuickInput(e) {
    const v = e.detail.value;
    this.setData({ quick: v, quickParsed: T.parseQuickBill(v) });
  },
  onQuickAdd() {
    const p = T.parseQuickBill(this.data.quick);
    if (!p) { wx.showToast({ title: "带上金额，如：打车 32", icon: "none" }); return; }
    const cny = this._toCny(p.amt);
    if (!(cny > 0)) { wx.showToast({ title: "金额无法换算", icon: "none" }); return; }
    let name = p.name;
    T.addLedger(cny, p.cat, name, this.data.payer, this.data.share, this.data.date, this.data.curSig);
    // v1.8.5 C7：记忆本次分类
    S.set("miniLedgerLastCatV1", p.cat || "餐饮");
    this.setData({ quick: "", quickParsed: null });
    wx.showToast({ title: "已记 ¥" + cny + " · " + p.cat, icon: "none" });
    this._sync();
  },

  // 金额归一：只支持人民币，保留两位取整防浮点尾巴（外币与汇率换算已于 2026-10-29 移除）
  _toCny(v) { return Math.round(Number(v) * 100) / 100; },

  // v1.8.4 A10：速记短语 chips（一句话记账）
  onPhrase(e) {
    const p = e.currentTarget.dataset.p;
    if (!p) return;
    this.setData({ quick: p, quickParsed: T.parseQuickBill(p) });
  },

  // v1.8.4 A7：凭证集中浏览
  onVouchShow() {
    if (!this._vouch || !this._vouch.length) { wx.showToast({ title: "暂无凭证", icon: "none" }); return; }
    wx.previewImage({ urls: this._vouch.map(x => x.img) });
  },

  /* ---- v1.8.4 A6：人情往来 ---- */
  onIouMate(e) { this.setData({ iouMate: e.detail.value }); },
  onIouWhat(e) { this.setData({ iouWhat: e.detail.value }); },
  onIouAmt(e) { this.setData({ iouAmt: e.detail.value }); },
  onIouDir(e) {
    const d = e.currentTarget.dataset.d;
    if (d === "lend" || d === "borrow") this.setData({ iouDir: d });
  },
  addIou() {
    const mate = String(this.data.iouMate || "").trim();
    const amt = parseFloat(this.data.iouAmt);
    if (!mate) { wx.showToast({ title: "写谁的名字", icon: "none" }); return; }
    if (!(amt > 0)) { wx.showToast({ title: "金额要大于 0", icon: "none" }); return; }
    T.addIou(mate, this.data.iouWhat, amt, this.data.iouDir);
    this.setData({ iouMate: "", iouWhat: "", iouAmt: "", iou: T.iouList(), iouSt: T.iouStats() });
    wx.showToast({ title: this.data.iouDir === "lend" ? "已记 借出 ¥" + amt : "已记 借入 ¥" + amt, icon: "none" });
  },
  onIouDone(e) {
    const i = Number(e.currentTarget.dataset.i);
    T.toggleIou(i);
    this.setData({ iou: T.iouList(), iouSt: T.iouStats() });
  },
  onIouDel(e) {
    const i = Number(e.currentTarget.dataset.i);
    const x = this.data.iou[i];
    if (!x) return;
    const self = this;
    wx.showModal({
      title: "删除这笔往来？",
      content: (x.dir === "lend" ? "借出" : "借入") + " " + x.mate + " ¥" + x.amt,
      confirmColor: "#cc3d3d",
      success(r) { if (r.confirm) { T.delIou(i); self.setData({ iou: T.iouList(), iouSt: T.iouStats() }); } }
    });
  },
  onCatPick(e) { this.setData({ cat: e.currentTarget.dataset.c }); },

  /* ---- AA 结算：复制结清方案到剪贴板 ---- */
  copySettle() {
    const s = this.data.settle;
    if (!s) { wx.showToast({ title: "先记几笔账", icon: "none" }); return; }
    wx.setClipboardData({
      data: s.text,
      success: () => wx.showToast({ title: "已复制结算方案", icon: "success" })
    });
  },

  // AA 人均实时预计算（WXML 不能做除法）
  _refreshPer(v) {
    const share = Math.max(1, parseInt(this.data.share, 10) || 1);
    const a = parseFloat(v);
    this.setData({ perHint: a > 0 ? (a / share).toFixed(2) : "0" });
  },

  onCatChange(e) { const i = Number(e.detail.value); if (i >= 0 && i < this.data.cats.length) this.setData({ cat: this.data.cats[i] }); },
  onAmt(e) { const v = e.detail.value; this.setData({ amt: v }); this._refreshPer(v); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onPayerChange(e) { this.setData({ payer: e.detail.value.trim() || "我" }); },
  onDatePick(e) { this.setData({ date: e.detail.value }); },
  onShareMinus() { if (this.data.share > 1) { this.setData({ share: this.data.share - 1 }); this._refreshPer(this.data.amt); } },
  onSharePlus() { if (this.data.share < 20) { this.setData({ share: this.data.share + 1 }); this._refreshPer(this.data.amt); } },
  onFilter(e) { this.setData({ dateFilter: e.currentTarget.dataset.f }); this._sync(); },

  add() {
    const amt = parseFloat(this.data.amt);
    if (!(amt > 0)) { wx.showToast({ title: "请输入金额", icon: "none" }); return; }
    const cny = this._toCny(amt);
    if (!(cny > 0)) { wx.showToast({ title: "金额无法换算", icon: "none" }); return; }
    let name = this.data.name.trim();
    T.addLedger(cny, this.data.cat, name, this.data.payer, this.data.share, this.data.date, this.data.curSig);
    // v1.8.5 C7：记忆本次分类
    S.set("miniLedgerLastCatV1", this.data.cat || "餐饮");
    this.setData({ amt: "", name: "", perHint: "0" });
    wx.showToast({ title: "已记一笔（¥" + cny + "）", icon: "none" });
    this._sync();
  },

  // v1.8.5 C8：删除账单（可 6 秒内撤销，防误删）
  del(e) {
    const i = Number(e.currentTarget.dataset.i);
    const row = this.data.items[i];
    if (!row) return;
    if (row._src == null) return;
    const all = T.getLedger();
    const removed = all[row._src];
    if (!removed) return;
    const removedId = removed.id;
    const removedImg = T.getBillImg(removedId);
    T.delLedger(row._src);
    this._lastDel = removed;
    this._lastDelIdx = row._src;
    this._lastDelId = removedId;
    this._lastDelImg = removedImg;
    // 先弹撤销胶囊，再刷新列表（任何渲染问题都不影响可撤销性）
    this.setData({ undoRow: { name: removed.name || "这笔账", amt: Math.round(Number(removed.amt) || 0) } });
    // v1.20.3：清理定时器放到模块作用域（见顶部 _billImgCleanups），不受页面卸载影响
    clearTimeout(_billImgCleanups[removedId]);
    // v1.19.204：删除后照片并不立即删文件，等 6 秒撤销窗口结束再清，确保撤销可恢复且不残留
    _billImgCleanups[removedId] = setTimeout(() => {
      try { T.delBillImg(removedId, removedImg); } catch (e) {}
      delete _billImgCleanups[removedId];
    }, 6000);
    this._sync();
  },
  undoDel() {
    const o = this._lastDel;
    if (!o) { this.setData({ undoRow: null }); return; }
    clearTimeout(_billImgCleanups[this._lastDelId]);
    delete _billImgCleanups[this._lastDelId];
    const list = T.getLedger();
    list.splice(Math.min(this._lastDelIdx || 0, list.length), 0, o);
    if (!S.set(T.LEDGER_KEY, list)) { wx.showToast({ title: "保存失败，请清理存储后重试", icon: "none" }); return; }
    // v1.19.204：撤销删除时把照片条目接回账单 id（文件尚未删除，无需重拷）
    try { if (this._lastDelId && this._lastDelImg) T.relinkBillImg(this._lastDelId, this._lastDelImg); } catch (e) {}
    this._lastDel = null; this._lastDelId = null; this._lastDelImg = null;
    this.setData({ undoRow: null });
    this._sync();
    wx.showToast({ title: "已恢复这笔记账", icon: "success" });
  },

  // v1.8.5 C6：复制「本周账单」可读文本（对账 / 记周账）
  copyWeek() {
    const txt = T.weekLedgerTxt(this._src);
    if (!txt || txt.indexOf("合计") < 0) { wx.showToast({ title: "本周还没有账单", icon: "none" }); return; }
    wx.setClipboardData({
      data: txt,
      success: () => wx.showToast({ title: "本周账单已复制", icon: "success" })
    });
  },

  // P2：导出 CSV
  /* ---------- 2026-10-29：记账页分组折叠（详细记账 / 看数据 / 同行分账） ---------- */
  toggleSec(e) {
    const s = String(e.currentTarget.dataset.s || "");
    if (s === "detail") this.setData({ secDetail: !this.data.secDetail });
    else if (s === "stats") this.setData({ secStats: !this.data.secStats });
    else if (s === "social") this.setData({ secSocial: !this.data.secSocial });
  },

  /* ---------- v1.7：消费凭证图片 ---------- */
  pickBillImg(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.data.items[i];
    if (!it) return;
    const self = this;
    if (it.img) {
      wx.showActionSheet({
        itemList: ["查看凭证", "重新选择"],
        success(r) {
          if (r.tapIndex === 0) { wx.previewImage({ urls: [it.img] }); return; }
          self._chooseBillImg(it);
        },
        fail() {}
      });
      return;
    }
    this._chooseBillImg(it);
  },
  _chooseBillImg(it) {
    const self = this;
    wx.chooseMedia({
      count: 1, mediaType: ["image"], sizeType: ["compressed"],
      success(res) {
        try {
          const tmp = res.tempFiles[0].tempFilePath;
          const fs = wx.getFileSystemManager();
          const dir = wx.env.USER_DATA_PATH + "/bill_imgs";
          try { fs.mkdirSync(dir, true); } catch (e) {}
          const dst = dir + "/" + Date.now() + "_" + Math.floor(Math.random() * 1000) + ".png";
          fs.copyFileSync(tmp, dst);
          T.setBillImg(it._id, dst);
          self._sync();
          wx.showToast({ title: "凭证已存", icon: "success" });
        } catch (err) {
          wx.showToast({ title: "保存失败", icon: "none" });
        }
      },
      fail() {}
    });
  },

  // v1.8.5 C6：导出菜单（本周账单 / 全部 CSV 收纳进一个动作）
  onExportMenu() {
    const self = this;
    wx.showActionSheet({
      itemList: ["复制本周账单（对账 / 记周账）", "导出全部 CSV"],
      success(r) {
        if (r.tapIndex === 0) self.copyWeek();
        else self.exportCSV();
      }
    });
  },

  exportCSV() {
    const csv = T.exportLedgerCSV();
    if (!csv || csv.length < 30) { wx.showToast({ title: "暂无数据", icon: "none" }); return; }
    wx.setClipboardData({
      data: csv,
      success: () => wx.showModal({
        title: "已复制到剪贴板",
        content: "CSV 含 " + (csv.split("\n").length - 1) + " 行账目 · 黏贴到 Excel / WPS / Numbers / 微信文件助手",
        showCancel: false,
        confirmText: "好的"
      })
    });
  }
}));
