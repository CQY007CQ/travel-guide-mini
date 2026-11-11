// subpkg/ai-entry/ai-entry.js —— 全站统一「问 AI」悬浮入口组件（分包内复用，零主包体积）
// 任何分包页引入即可获得一个固定悬浮的 AI 按钮：点一下跳到 assistant 的对应场景深链，
// 并带入当前行程城市，让 AI 在「这座城 · 这几天」的语境下回答。AI 大脑在 assistant 页，
// 不在本组件，故本组件几乎零逻辑、零体积，可安全织入任意分包页。
const T = require("../../utils/travel.js");

Component({
  properties: {
    // 场景 key（对应 ai-brain SCENARIOS 的 key）：spotsearch/ledger/travelsvc/guide/help-emergency 等
    topic: { type: String, value: "" },
    label: { type: String, value: "问问 AI" }
  },
  methods: {
    onTap() {
      let city = "";
      try {
        const app = getApp();
        const plan = app && app.globalData && app.globalData.plan;
        if (plan) city = ((T && T.activeCityOf) ? T.activeCityOf(plan) : "") || plan.cityName || "";
      } catch (e) {}
      let url = "/subpkg/assistant/assistant?topic=" + encodeURIComponent(this.data.topic || "");
      if (city) url += "&city=" + encodeURIComponent(city);
      try { wx.navigateTo({ url: url }); } catch (e) {}
    }
  }
});
