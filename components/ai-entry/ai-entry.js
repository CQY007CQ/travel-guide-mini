// components/ai-entry/ai-entry.js —— 全站统一「问 AI」悬浮入口组件（**主包**公共组件）
// 任何页面引入即可获得一个固定悬浮的 AI 按钮：点一下跳到 assistant 的对应场景深链，
// 并带入当前行程城市，让 AI 在「这座城 · 这几天」的语境下回答。AI 大脑在 assistant 页，
// 不在本组件，故本组件几乎零逻辑、零体积。
//
// v1.20.17 修的真 bug：本组件曾放在 subpkg/ai-entry/，而 subai/deep/deep 是**另一个分包**的页面。
// 微信禁止跨分包引用自定义组件 —— 运行期报 `Component is not found in path "subpkg/ai-entry/ai-entry"`
// 且**静默不渲染**（deep 页的 AI 入口从来没出现过）。主包页靠 componentPlaceholder 侥幸能用，
// 分包页没有这层兜底就直接失效。共享组件只有放主包才对所有包成立，故迁到 components/。
// 代价：主包 +约 4KB（raw 1418→1422KB / 1536KB 线），换来 15 个页面路径统一、无占位符依赖。
//
// v1.20.6 增强：跳转前用 ai-context.js 按 topic 采集「这一页此刻的真实数据」，
// 存进 globalData.__aiPageCtx（纯内存、5 分钟失效、限长 1200 字），助手页读取后注入 grounding。
// 这样 17 个入口无需各自改代码，AI 就知道你是在账本页（真实花费）还是美食页（真实店数）发问。
const T = require("../../utils/travel.js");
const AIContext = require("./ai-context.js");

Component({
  properties: {
    // 场景 key（对应 ai-brain SCENARIOS 的 key）：spotsearch/ledger/travelsvc/guide/help-emergency 等
    topic: { type: String, value: "" },
    label: { type: String, value: "问问 AI" },
    // v1.20.7：显式城市（首页等「尚未生成行程、只是选中了目的地」的场景可带 city="{{cityName}}"）
    city: { type: String, value: "" },
    // v1.20.7：inline=true 渲染为内嵌胶囊/横条（用于 tabBar 主包页，避免悬浮 FAB 压住 tabBar）
    inline: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      let city = this.data.city || "";
      let app = null, plan = null;
      try { app = getApp(); plan = app && app.globalData && app.globalData.plan; } catch (e) {}
      if (!city && plan) {
        try { city = ((T && T.activeCityOf) ? T.activeCityOf(plan) : "") || plan.cityName || ""; } catch (e) {}
      }
      // 页面级真实上下文：只采本机数据，不联网、不落盘；任一环节异常都不影响跳转。
      try {
        if (app && app.globalData) {
          const text = AIContext.build(this.data.topic, { city: city, plan: plan });
          app.globalData.__aiPageCtx = {
            topic: this.data.topic || "", city: city, text: text, ts: Date.now()
          };
        }
      } catch (e) {}
      let url = "/subpkg/assistant/assistant?topic=" + encodeURIComponent(this.data.topic || "");
      if (city) url += "&city=" + encodeURIComponent(city);
      try { wx.navigateTo({ url: url }); } catch (e) {}
    }
  }
});
