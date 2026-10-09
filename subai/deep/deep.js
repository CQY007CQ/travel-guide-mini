// deep：城市深度玩法 —— 本地节奏 / 避坑清单 / 取景机位 / 顺手加一日
// 内容为随分包下发的离线文本（由团队人工整理，非实时 AI 生成），
// 票价、班次、开放时间以官方渠道当日公告为准。
const A = require("../../utils/aicontent.js");
const AD = require("../../utils/ad.js");

// 打包提示：内容文件与本页同属 subai 分包，用静态字面量 require 一次，
// 确保 ignoreUploadUnusedFiles 开启时也不会被当成未使用文件剔除。
require("../data/ai-deep.js");

const BLOCK_ICON = {
  "本地人的节奏": "bulb",
  "避坑清单": "shield",
  "取景机位": "camera",
  "顺手加一日": "route"
};

/** 把原始内容块转换成 WXML 可直接渲染的形状（序号在 JS 预计算，模板零逻辑） */
function shape(city, raw) {
  const blocks = (raw.blocks || []).map((b, bi) => ({
    k: String(bi),
    t: b.t || "",
    icon: BLOCK_ICON[b.t] || "star",
    items: (b.items || []).map((x, i) => ({ k: String(bi) + "_" + i, x: x })),
    trips: (b.trips || []).map((x, i) => ({
      k: String(bi) + "_t" + i,
      name: x.name || "",
      meta: x.meta || "",
      why: x.why || ""
    }))
  }));
  const total = blocks.reduce((n, b) => n + b.items.length + b.trips.length, 0);
  return {
    name: city,
    updated: A.updatedAt(),
    blocks: blocks,
    total: total,
    teasers: (raw.teaser || []).map((x, i) => ({ k: "tz" + i, x: x }))
  };
}

Page({
  onShareAppMessage() {
    const n = this.data.cur && this.data.cur.name;
    return {
      title: (n ? n + " · " : "") + "一份本地人视角的深度玩法清单",
      path: "/subai/deep/deep" + (n ? "?city=" + encodeURIComponent(n) : "")
    };
  },

  data: {
    ready: false,
    cities: [],
    curName: "",
    cur: null,
    msg: "",
    // 免费城（从行程页带进来的那座，永远免费）+ 广告位状态
    freeCity: "",
    adOn: false,
    allUnlocked: true
  },

  onLoad(q) {
    const want = (q && q.city) ? String(q.city) : "";
    A.initDeep().then(() => {
      const cities = A.deepCities();
      let curName = want;
      if (!curName || !A.hasDeep(curName)) curName = cities[0] || "";
      this.setData({
        ready: true, cities: cities, curName: curName, freeCity: curName,
        adOn: AD.available(), allUnlocked: AD.unlocked(),
        msg: cities.length ? "" : "内容暂未就绪"
      });
      if (curName) this._pick(curName);
    }).catch(() => {
      this.setData({ ready: true, msg: "内容加载失败，可下拉重试" });
    });
  },

  onPullDownRefresh() {
    this.onLoad({ city: this.data.curName });
    setTimeout(() => { try { wx.stopPullDownRefresh(); } catch (e) {} }, 300);
  },

  _pick(name) {
    const raw = A.deepOf(name);
    if (!raw) return;
    const cur = shape(name, raw);
    this.setData({ cur: cur, curName: name });
    try { wx.setNavigationBarTitle({ title: name + " · 深度玩法" }); } catch (e) {}
  },

  onPick(e) {
    const c = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.c) || "";
    if (!c || c === this.data.curName) return;
    // 这座城是「从行程带进来的」或已解锁 → 直接看
    if (c === this.data.freeCity || !AD.available() || AD.unlocked()) { this._pick(c); return; }
    wx.showModal({
      title: "解锁全部城市",
      content: "当前行程这座城免费看。要看其他城市的完整深玩清单，需要看一次约 15 秒的短片（当天有效，不看也能回来）。",
      confirmText: "看短片解锁",
      cancelText: "先不看",
      success: (r) => {
        if (!r.confirm) return;
        AD.watch().then((okd) => {
          const un = AD.unlocked();
          try { this.setData({ allUnlocked: un }); } catch (err) {}
          if (okd && un) this._pick(c);
          else wx.showToast({ title: "这次没解锁，可以先看这座城", icon: "none" });
        });
      }
    });
  },

  onCopy() {
    const cur = this.data.cur;
    if (!cur) return;
    const lines = [cur.name + " · 深度玩法（" + cur.updated + " 整理）"];
    for (const b of cur.blocks) {
      lines.push("", "【" + b.t + "】");
      for (const it of b.items) lines.push("· " + it.x);
      for (const tp of b.trips) lines.push("· " + tp.name + "（" + tp.meta + "）—— " + tp.why);
    }
    lines.push("", "票价与班次以官方渠道当日公告为准。");
    try {
      wx.setClipboardData({ data: lines.join("\n") });
    } catch (e) {}
  }
});
