// v1.19.77 · 任务#405 拖拽排序（行程内景点手动调序）
// 只改页面层：pages/plan/plan.{js,wxml,wxss}，绝不碰 utils/ 与数据管道。
// 每条替换断言「恰好命中 1 次」。
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const F = {
  js: path.join(ROOT, "pages/plan/plan.js"),
  wxml: path.join(ROOT, "pages/plan/plan.wxml"),
  wxss: path.join(ROOT, "pages/plan/plan.wxss")
};

const edits = [];
function once(file, from, to, tag) { edits.push({ file, from, to, tag }); }

/* ── 1. wxml：条目加天级类名 + 拖拽位移 style + 拖动态类名 ── */
once(F.wxml,
`        <view class="tl-item {{open === i + di * 100 ? 'open' : ''}}{{it.wished ? ' wish-hit' : ''}}"
              wx:for="{{day.items}}" wx:key="ix" wx:for-index="i" wx:for-item="it"
              data-di="{{di}}" data-ix="{{it.ix}}" bindtap="onToggle">`,
`        <!-- v1.19.77：dd{{di}} 供 createSelectorQuery 按天定位；dragSh[i] 为 JS 预计算的位移（WXML 零逻辑） -->
        <view class="tl-item dd{{di}} {{open === i + di * 100 ? 'open' : ''}}{{it.wished ? ' wish-hit' : ''}}{{dragOn && dragDi === di && dragI === i ? ' dragging' : ''}}"
              wx:for="{{day.items}}" wx:key="ix" wx:for-index="i" wx:for-item="it"
              style="{{dragOn && dragDi === di ? dragSh[i] : ''}}"
              data-di="{{di}}" data-ix="{{it.ix}}" bindtap="onToggle">`,
"wxml/tl-item");

/* ── 2. wxml：行尾加拖拽手柄（catchtouch 只挂手柄，页面滚动完全不受影响） ── */
once(F.wxml,
`          <view class="tl-ops">
            <view wx:if="{{!it.f}}" class="op {{it.wished ? 'wish-on' : ''}}" data-di="{{di}}" data-ix="{{it.ix}}" catchtap="onWish" title="想玩">`,
`          <view class="tl-ops">
            <!-- v1.19.77：拖动排序手柄。刻意只挂在这颗小按钮上 —— 若把 catchtouchmove 挂到整个条目，
                 手指按在行程上就没法滑页面了。手柄很小、且本身没有点击语义，按住即拖。 -->
            <view wx:if="{{!it.f}}" class="op grip" data-di="{{di}}" data-i="{{i}}"
                  catchtouchstart="onDragStart" catchtouchmove="onDragMove"
                  catchtouchend="onDragEnd" catchtouchcancel="onDragEnd">
              <view class="grip-col"><view class="gd"></view><view class="gd"></view><view class="gd"></view></view>
              <view class="grip-col"><view class="gd"></view><view class="gd"></view><view class="gd"></view></view>
            </view>
            <view wx:if="{{!it.f}}" class="op {{it.wished ? 'wish-on' : ''}}" data-di="{{di}}" data-ix="{{it.ix}}" catchtap="onWish" title="想玩">`,
"wxml/grip");

/* ── 3. wxml：底部提示补一句手柄说明 ── */
once(F.wxml,
`  <view class="tip">点行展开可换景点 / 百科 / 打卡 / 调序</view>`,
`  <view class="tip">点行展开可换景点 / 百科 / 打卡 / 调序 · 按住右侧手柄可直接拖动</view>`,
"wxml/tip");

/* ── 4. js data：拖拽状态 ── */
once(F.js,
`  topDays: [], dsActive: -1
 },`,
`  topDays: [], dsActive: -1,
  // v1.19.77：拖动排序（dragSh 为逐条预计算的 transform 字符串，WXML 只做数组取值）
  dragOn: false, dragDi: -1, dragI: -1, dragSh: []
 },`,
"js/data");

/* ── 5. js：onToggle 屏蔽「刚拖完顺手展开」 ── */
once(F.js,
` onToggle(e) {
  const di = Number(e.currentTarget.dataset.di);`,
` onToggle(e) {
  if (this._suppressTap) return;   // v1.19.77：刚拖完排序，别顺手把详情展开了
  const di = Number(e.currentTarget.dataset.di);`,
"js/onToggle-guard");

/* ── 6. js：拖拽三个 handler ── */
once(F.js,
` onMove(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);`,
` /* ═══ v1.19.77 · 按住手柄拖动排序（同一天内） ═══
    语义与既有 onMove 保持一致：时段（上午/下午/晚上）属于「坑位」而不是景点，
    拖动只是景点换坑位，落位后把原坑位的时段贴回新顺序，再走 normalizeDayItems 归一行文。
    全程 try/catch，任何一步异常都退化为「没动过」，绝不破坏行程数据。 */
 onDragStart(e) {
  try {
   const di = Number(e.currentTarget.dataset.di);
   const i = Number(e.currentTarget.dataset.i);
   const day = this.data.view[di];
   if (!day || !day.items || day.items.length < 2) return;
   if (day.items[i] && day.items[i].f) { wx.showToast({ title: "抵达 / 返程不能调序", icon: "none" }); return; }
   const q = wx.createSelectorQuery().in(this);
   q.selectAll(".dd" + di).boundingClientRect();
   q.exec(res => {
    try {
     let rects = (res && res[0]) || [];
     if (!Array.isArray(rects)) rects = [];
     rects = rects.filter(r => r && typeof r.top === "number");
     if (rects.length !== day.items.length) return;   // 量不准就干脆不开始，避免错位
     this._drag = { di, from: i, to: i, rects, started: false, startY: 0, lastSh: "" };
     this.setData({ dragOn: true, dragDi: di, dragI: i, dragSh: rects.map(() => "") });
     try { wx.vibrateShort({ type: "light" }); } catch (_) {}
    } catch (err) { this._drag = null; this.setData({ dragOn: false, dragDi: -1, dragI: -1, dragSh: [] }); }
   });
  } catch (err) { this._drag = null; }
 },

 onDragMove(e) {
  const d = this._drag;
  if (!d) return;
  try {
   const t = e.touches && e.touches[0];
   if (!t || typeof t.clientY !== "number") return;
   const y = t.clientY;
   if (!d.started) { d.startY = y; d.started = true; }
   const dy = y - d.startY;
   const rects = d.rects, from = d.from, n = rects.length;
   const myMid = rects[from].top + (rects[from].height || 0) / 2;
   let to = from;
   for (let k = from + 1; k < n; k++) { if (myMid + dy > rects[k].top + (rects[k].height || 0) / 2) to = k; }
   if (to === from) { for (let k = from - 1; k >= 0; k--) { if (myMid + dy < rects[k].top + (rects[k].height || 0) / 2) to = k; } }
   d.to = to;
   const sh = [];
   for (let j = 0; j < n; j++) {
    let v = 0;
    if (j === from) v = dy;
    else if (to > from && j > from && j <= to) v = rects[j - 1].top - rects[j].top;
    else if (to < from && j >= to && j < from) v = rects[j + 1].top - rects[j].top;
    sh.push(v ? "transform:translateY(" + v.toFixed(1) + "px)" : "");
   }
   const key = sh.join("|");
   if (key !== d.lastSh) { d.lastSh = key; this.setData({ dragSh: sh }); }
  } catch (err) { this.onDragEnd(); }
 },

 onDragEnd() {
  const d = this._drag;
  this._drag = null;
  this.setData({ dragOn: false, dragDi: -1, dragI: -1, dragSh: [] });
  if (!d) return;
  this._suppressTap = true;
  setTimeout(() => { this._suppressTap = false; }, 400);
  const from = d.from, to = d.to, di = d.di;
  if (!d.started || to === from) return;
  try {
   const plan = app.globalData.plan;
   if (!plan || !plan.days || !plan.days[di] || !plan.days[di].items) return;
   const items = plan.days[di].items;
   const n = items.length;
   if (from < 0 || to < 0 || from >= n || to >= n) return;
   if (isFrame(items[from].name) || isFrame(items[to].name)) { wx.showToast({ title: "抵达 / 返程不能调序", icon: "none" }); return; }
   const periods = items.map(x => x.period);          // 时段跟着坑位走
   const arr = items.slice();
   arr.splice(to, 0, arr.splice(from, 1)[0]);
   for (let k = 0; k < n; k++) { arr[k].period = periods[k]; items[k] = arr[k]; }
   try { T.normalizeDayItems(items); } catch (_) {}
   this._save();
   try { wx.vibrateShort({ type: "light" }); } catch (_) {}
   wx.showToast({ title: "已移到第 " + (to + 1) + " 位", icon: "none" });
  } catch (err) { wx.showToast({ title: "调序失败，展开后用 ↑↓ 也行", icon: "none" }); }
 },

 onMove(e) {
  const di = Number(e.currentTarget.dataset.di), ix = Number(e.currentTarget.dataset.ix);`,
"js/drag-handlers");

/* ── 7. wxss：手柄 + 拖动态 ── */
once(F.wxss,
`.op-ic { width: 26rpx; height: 26rpx; }`,
`.op-ic { width: 26rpx; height: 26rpx; }

/* ═══ v1.19.77 · 拖动排序手柄 + 拖动态 ═══ */
.op.grip { flex-direction: row; align-items: center; justify-content: center; gap: 0; height: 56rpx; background: transparent; }
.grip-col { display: flex; flex-direction: column; gap: 4rpx; }
.grip-col + .grip-col { margin-left: 5rpx; }
.gd { width: 5rpx; height: 5rpx; border-radius: 50%; background: currentColor; opacity: .8; }
.tl-item { transition: background .25s, transform .18s ease; }
.tl-item.dragging {
  transition: none;
  z-index: 6;
  background: linear-gradient(90deg, rgba(212,169,78,.16), rgba(212,169,78,.05) 70%);
  box-shadow: 0 10rpx 28rpx rgba(0, 0, 0, .16), inset 4rpx 0 0 #d4a94e;
  border-radius: 18rpx;
}
.tl-item.dragging .gd { opacity: 1; }`,
"wxss/drag-style");

/* ── 执行 ── */
let fail = 0;
for (const ed of edits) {
  const src = fs.readFileSync(ed.file, "utf8");
  const n = src.split(ed.from).length - 1;
  if (n !== 1) { console.error(`✗ [${ed.tag}] 命中 ${n} 次（期望 1）— 已跳过`); fail++; continue; }
  fs.writeFileSync(ed.file, src.replace(ed.from, ed.to));
  console.log(`✔ [${ed.tag}] 已写入`);
}
if (fail) { console.error(`\n共 ${fail} 条失败（失败项已跳过，未做破坏性写入）。`); process.exit(1); }
console.log(`\n全部 ${edits.length} 条替换完成。`);
