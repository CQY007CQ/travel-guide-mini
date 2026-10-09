// v1.19.2 体验优化批次 2（新手可理解性 + 遗留 bug）
import fs from "fs";

const EDITS = {
  /* ============ 遗留 bug：plan.js onMove 缺判空 ============ */
  "pages/plan/plan.js": [
    [`onMove(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const dir = Number(e.currentTarget.dataset.dir);
  const plan = app.globalData.plan;
  const items = plan.days[di].items;`,
     `onMove(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);
  const dir = Number(e.currentTarget.dataset.dir);
  const plan = app.globalData.plan;
  if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
  const items = plan.days[di].items;`]
  ],

  /* ============ 首页：出发地默认值说明 + 节奏含义解释 ============ */
  "pages/index/index.js": [
    ['    showCustom: false, customAmt: "", budgetHint: "",',
     '    showCustom: false, customAmt: "", budgetHint: "", paceHint: "", fromHint: "",'],

    [`    const budgetHint = (bk === "custom") ? "" : (BUD[bk] || "");
    this.setData({ advChips: chips, budgetHint });`,
     `    const budgetHint = (bk === "custom") ? "" : (BUD[bk] || "");
    // v1.19.2：节奏用「轻松/平衡/特种兵」三个词对新手不可解，补一句具体差别
    const PACE_HINT = [
      "每天 2–3 个景点，午后留出休息和闲逛时间",
      "每天 3–5 个景点，游玩与休息大致对半，适合大多数人",
      "每天 5 个以上、早出晚归，适合体力好、想把景点刷满的人"
    ];
    const paceHint = PACE_HINT[d.paceIdx] || "";
    // v1.19.2：出发地默认是太原，外地新手未必注意到可以改，而它直接影响「怎么去」的交通建议
    const fromHint = (d.fromIdx === d.defFromIdx && d.fromIdx >= 0)
      ? "当前为默认出发地（太原），点一下可改成你的城市 —— 会影响「怎么去」的交通建议"
      : "";
    this.setData({ advChips: chips, budgetHint, paceHint, fromHint });`]
  ],

  "pages/index/index.wxml": [
    [`      <picker mode="selector" range="{{paces}}" value="{{paceIdx}}" bindchange="onPaceChange">
        <view class="field-row">
          <text class="field-label">行程节奏</text>
          <text class="field-value">{{paces[paceIdx]}}<text class="arrow">›</text></text>
        </view>
      </picker>`,
     `      <picker mode="selector" range="{{paces}}" value="{{paceIdx}}" bindchange="onPaceChange">
        <view class="field-row">
          <text class="field-label">行程节奏</text>
          <text class="field-value">{{paces[paceIdx]}}<text class="arrow">›</text></text>
        </view>
      </picker>
      <!-- v1.19.2：把「轻松/平衡/特种兵」翻译成每天几个景点，新手才选得动 -->
      <view class="pk-sub" wx:if="{{paceHint}}">{{paceHint}}</view>`],

    [`        <view class="field-row" data-mode="from" bindtap="openPicker">
          <text class="field-label">出发地</text>
          <text class="field-value {{fromCityObj ? 'pick-value' : ''}}">{{fromTxt}}<text class="arrow">›</text></text>
        </view>`,
     `        <view class="field-row" data-mode="from" bindtap="openPicker">
          <text class="field-label">出发地</text>
          <text class="field-value {{fromCityObj ? 'pick-value' : ''}}">{{fromTxt}}<text class="arrow">›</text></text>
        </view>
        <!-- v1.19.2：默认出发地容易被外地用户忽略，而它决定交通建议 -->
        <view class="pk-sub" wx:if="{{fromHint}}">{{fromHint}}</view>`],

    [`    <view class="note">想玩的景点优先安排</view>`,
     `    <view class="note">勾选的景点优先安排 · 生成后可在「行程」页逐条换景点、调顺序</view>`]
  ],

  /* ============ 地图页：把「≈ / 导航」两种状态讲清楚 ============ */
  "pages/map/map.wxml": [
    [`      <view class="tip-inner dim" wx:if="{{list.length}}">数字 = 游览顺序，点行直接导航</view>`,
     `      <!-- v1.19.2：新手看不懂「≈ 看方向」是什么意思，这里把两种状态一次讲清 -->
      <view class="tip-inner dim" wx:if="{{list.length}}">数字 = 当天游览顺序，点行直接导航；标「≈」的是只精确到城市级的点，点开先看大致方向，到现场再用地图搜店名 / 景点名</view>`]
  ]
};

let failures = [];
const out = {};
for (const [file, pairs] of Object.entries(EDITS)) {
  let src = fs.readFileSync(file, "utf8");
  let hits = 0;
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    if (n !== 1) { failures.push(`${file}: 期望 1 次实际 ${n} 次 → ${from.slice(0, 60).replace(/\n/g, "⏎")}`); continue; }
    src = src.replace(from, to);
    hits++;
  }
  out[file] = src;
  console.log(`${file}: ${hits}/${pairs.length}`);
}
if (failures.length) {
  console.error("\n❌ 未命中，放弃全部写入：");
  failures.forEach(f => console.error("   " + f));
  process.exit(1);
}
for (const [file, src] of Object.entries(out)) fs.writeFileSync(file, src);
console.log("\n✅ 批次 2 全部写入成功");
