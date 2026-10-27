// v1.19.77 · 任务#406 视觉微动效
// ① 每日卡错落入场（仅首次进入该页时，编辑/打卡后不再重放，避免闪屏）
// ② 按钮按压反馈 ③ 天导航 chip 过渡 ④ 时间线展开更软的缓动
// 全部走 CSS + JS 预计算，WXML 不做任何表达式运算。
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const F = {
  app: path.join(ROOT, "app.wxss"),
  js: path.join(ROOT, "pages/plan/plan.js"),
  wxml: path.join(ROOT, "pages/plan/plan.wxml"),
  wxss: path.join(ROOT, "pages/plan/plan.wxss")
};
const edits = [];
const once = (file, from, to, tag) => edits.push({ file, from, to, tag });

/* ── 1. app.wxss：按压反馈工具类（含减少动画偏好的降级） ── */
once(F.app,
`@media (prefers-reduced-motion: reduce) {
  .fb-fade, .fb-fade-d1, .fb-fade-d2, .fb-fade-d3, .fb-pulse { animation: none; }
}`,
`@media (prefers-reduced-motion: reduce) {
  .fb-fade, .fb-fade-d1, .fb-fade-d2, .fb-fade-d3, .fb-pulse { animation: none; }
}

/* v1.19.77 · 微动效：按压缩放（给"摸得到"的反馈，不影响布局） */
.fx-press { transition: transform .16s cubic-bezier(.2, .9, .3, 1), background .18s ease, opacity .18s ease; }
.fx-press:active { transform: scale(.955); }

/* 卡片错落入场：延迟由 JS 预计算后写进 style（WXML 不做运算） */
.fx-stagger { animation: fb-fade-up .42s ease both; }

@media (prefers-reduced-motion: reduce) {
  .fx-press, .fx-press:active { transform: none; transition: none; }
  .fx-stagger { animation: none; }
}`,
"app/fx");

/* ── 2. wxml：每日卡入场类与延迟都由 JS 给 ── */
once(F.wxml,
`    <view class="day-card card fb-fade" id="d{{di}}">`,
`    <!-- v1.19.77：仅首次进入行程页时错落入场；编辑/打卡重渲染不再重放，避免整页闪一下 -->
    <view class="day-card card {{day.anim}}" id="d{{di}}" style="{{day.ads}}">`,
"wxml/day-card");

/* ── 3. js：_render 里预计算 anim / ads ── */
once(F.js,
`  const view = plan.days.map((d, di) => ({
   di,
   dateText: fmt(d.date),`,
`  // v1.19.77：入场动效只在「进入页面」那一次放；__animOn 由 _renderShow 置位，渲染即消费掉
  const anim = this.__animOn === true;
  this.__animOn = false;
  const view = plan.days.map((d, di) => ({
   di,
   anim: anim ? "fx-stagger" : "",
   ads: (anim && di > 0) ? ("animation-delay:" + Math.min(di, 5) * 60 + "ms") : "",
   dateText: fmt(d.date),`,
"js/anim-field");

/* ── 4. js：_renderShow 置位 ── */
once(F.js,
`    if (!this.data.hasPlan) this.setData({ hasPlan: true });
    this._render(plan);`,
`    if (!this.data.hasPlan) this.setData({ hasPlan: true });
    this.__animOn = true;   // v1.19.77：进页才放错落入场动效
    this._render(plan);`,
"js/anim-flag");

/* ── 5. wxss：按压反馈 / chip 过渡 / 展开缓动 ── */
once(F.wxss,
`.tl-item.dragging .gd { opacity: 1; }`,
`.tl-item.dragging .gd { opacity: 1; }

/* ═══ v1.19.77 · 视觉微动效 ═══ */
/* ① 按压反馈：所有"点得到"的控件统一 160ms 回弹，比只换底色更有触感 */
.sop, .tool, .df-btn, .d-btn, .w-btn, .ck-slim, .ck-copy, .cn-save, .wx-retry, .day-map {
  transition: transform .16s cubic-bezier(.2, .9, .3, 1), background .18s ease, opacity .18s ease;
}
.sop:active, .tool:active, .df-btn:active, .d-btn:active, .w-btn:active,
.ck-slim:active, .ck-copy:active, .cn-save:active, .wx-retry:active, .day-map:active {
  transform: scale(.955);
}
/* ② 天导航 chip：选中态与按压都有过渡，不再是硬切 */
.ds-chip { transition: transform .18s cubic-bezier(.2, .9, .3, 1), background .22s ease, border-color .22s ease; }
.ds-chip:active { transform: scale(.93); }
/* ③ 时间线展开：详情面板用更软的缓动淡入，条目底色同步过渡 */
.spot-detail { animation: sdIn .3s cubic-bezier(.2, .9, .3, 1) both; }
.tl-item.open { transition: background .28s ease, box-shadow .28s ease; }
/* ④ 减少动画偏好：把上面这些过渡一起关掉 */
@media (prefers-reduced-motion: reduce) {
  .sop, .tool, .df-btn, .d-btn, .w-btn, .ck-slim, .ck-copy, .cn-save, .wx-retry, .day-map, .ds-chip { transition: none; }
  .sop:active, .tool:active, .df-btn:active, .d-btn:active, .w-btn:active,
  .ck-slim:active, .ck-copy:active, .cn-save:active, .wx-retry:active, .day-map:active, .ds-chip:active { transform: none; }
  .spot-detail { animation: none; }
}`,
"wxss/motion");

let fail = 0;
for (const ed of edits) {
  const src = fs.readFileSync(ed.file, "utf8");
  const n = src.split(ed.from).length - 1;
  if (n !== 1) { console.error(`✗ [${ed.tag}] 命中 ${n} 次（期望 1）— 已跳过`); fail++; continue; }
  fs.writeFileSync(ed.file, src.replace(ed.from, ed.to));
  console.log(`✔ [${ed.tag}] 已写入`);
}
if (fail) { console.error(`\n共 ${fail} 条失败（失败项已跳过）。`); process.exit(1); }
console.log(`\n全部 ${edits.length} 条替换完成。`);
