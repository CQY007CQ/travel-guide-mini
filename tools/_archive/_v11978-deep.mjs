// v1.19.78：把「城市深度玩法」接进行程页
// 每条替换都必须「恰好命中 1 次」，否则直接 fail —— 防止静默漏改 / 重复插入
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const P = (p) => path.join(ROOT, p);

function once(file, needle, repl, label) {
  const abs = P(file);
  let s = fs.readFileSync(abs, "utf8");
  const n = s.split(needle).length - 1;
  if (n !== 1) {
    console.error(`✗ [${label}] 命中 ${n} 次（期望 1 次）→ ${file}`);
    process.exitCode = 1;
    return;
  }
  s = s.replace(needle, repl);
  fs.writeFileSync(abs, s);
  console.log(`✓ [${label}] ${file}`);
}

// ───────── 1. plan.js：引入 holder ─────────
once(
  "pages/plan/plan.js",
  `const W = require("../../utils/weather.js");`,
  `const W = require("../../utils/weather.js");\nconst A = require("../../utils/aicontent.js");`,
  "plan.js/require"
);

// ───────── 2. plan.js：data 增加 deep ─────────
once(
  "pages/plan/plan.js",
  `  dragOn: false, dragDi: -1, dragI: -1, dragSh: []\n },`,
  `  dragOn: false, dragDi: -1, dragI: -1, dragSh: [],\n  // v1.19.78：城市深度玩法（随 subai 分包懒加载；未收录城市保持 null → UI 自动不显示）\n  deep: null\n },`,
  "plan.js/data"
);

// ───────── 3. plan.js：渲染后触发深玩加载 ─────────
once(
  "pages/plan/plan.js",
  `  this._maybeLoadWx(plan);\n },`,
  `  this._maybeLoadWx(plan);\n  this._loadDeep(plan);\n },`,
  "plan.js/call"
);

// ───────── 4. plan.js：新增方法 ─────────
once(
  "pages/plan/plan.js",
  ` // v1.8.5 C1/C2/C4：行程体检融合`,
  ` // v1.19.78：深度玩法 —— 从「主城 + 各站」里挑第一座有内容的城市，展示 3 条速览
 // 设计原则：内容是增强项，加载失败 / 城市未收录都静默降级为不显示，绝不阻塞行程本身
 _planCities(plan) {
  const out = [];
  const push = (v) => {
   const s = String(v == null ? "" : v).trim();
   if (s && out.indexOf(s) < 0) out.push(s);
  };
  try { push(plan.cityName); } catch (e) {}
  try {
   const ss = plan.segments || [];
   for (let i = 0; i < ss.length; i++) push(ss[i].city || ss[i].cityName || ss[i].name);
  } catch (e) {}
  return out;
 },
 _loadDeep(plan) {
  const cands = this._planCities(plan);
  if (!cands.length) return;
  try {
   A.initDeep().then(() => {
    let hit = null;
    for (let i = 0; i < cands.length; i++) {
     if (A.hasDeep(cands[i])) { hit = cands[i]; break; }
    }
    if (!hit) return;
    const raw = A.deepOf(hit);
    if (!raw) return;
    let total = 0;
    const bs = raw.blocks || [];
    for (let i = 0; i < bs.length; i++) total += ((bs[i].items || []).length + (bs[i].trips || []).length);
    const teasers = (raw.teaser || []).slice(0, 3);
    // 渲染期可能已切走 / 已生成新行程，用 try 包住避免异步落地时页面已卸载
    try {
     this.setData({
      deep: { city: hit, updated: A.updatedAt(), total: total, teasers: teasers }
     });
    } catch (e) {}
   }).catch(() => {});
  } catch (e) {}
 },
 onDeep() {
  const d = this.data.deep;
  if (!d || !d.city) return;
  try {
   wx.navigateTo({ url: "/subai/deep/deep?city=" + encodeURIComponent(d.city) });
  } catch (e) {}
 },

 // v1.8.5 C1/C2/C4：行程体检融合`,
  "plan.js/methods"
);

// ───────── 5. plan.wxml：行程列表后插入深玩卡 ─────────
once(
  "pages/plan/plan.wxml",
  `  <view class="tip">点行展开可换景点 / 百科 / 打卡 / 调序 · 按住右侧手柄可直接拖动</view>`,
  `  <!-- v1.19.78：城市深度玩法（内容随 subai 分包懒加载；未收录城市自动不显示） -->
  <view class="card dpp-card" wx:if="{{deep}}">
    <view class="dpp-head">
      <view class="dpp-t"><image class="ic" src="/images/icons/bulb.png"/>{{deep.city}} · 深度玩法</view>
      <text class="dpp-u dim">{{deep.updated}} 整理</text>
    </view>
    <view class="dpp-li" wx:for="{{deep.teasers}}" wx:key="*this"><text class="dpp-dot"></text>{{item}}</view>
    <view class="dpp-more" bindtap="onDeep">看全部 {{deep.total}} 条本地玩法 ›</view>
  </view>

  <view class="tip">点行展开可换景点 / 百科 / 打卡 / 调序 · 按住右侧手柄可直接拖动</view>`,
  "plan.wxml/card"
);

// ───────── 6. plan.wxss：样式 ─────────
const WXSS = `
/* ── v1.19.78：城市深度玩法（内容随 subai 分包懒加载） ───────────────── */
.dpp-card { margin-top: 20rpx; padding: 24rpx 26rpx 22rpx; background: var(--strip-bg, linear-gradient(135deg, rgba(212,169,78,.18) 0%, rgba(212,169,78,.05) 60%, #fff 100%)); }
.dpp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12rpx; }
.dpp-t { display: flex; align-items: center; gap: 10rpx; font-size: calc(29rpx * var(--fs, 1)); font-weight: 700; color: var(--t1, #18233a); }
.dpp-u { flex: none; font-size: calc(22rpx * var(--fs, 1)); }
.dpp-li { display: flex; align-items: flex-start; gap: 12rpx; margin-top: 12rpx; color: var(--tx-2, #46536b); font-size: calc(26rpx * var(--fs, 1)); line-height: 1.65; }
.dpp-dot { flex: none; width: 10rpx; height: 10rpx; margin-top: 16rpx; border-radius: 50%; background: var(--gold, #d4a94e); }
.dpp-more {
  margin-top: 18rpx; padding: 14rpx 22rpx; border-radius: 999rpx; text-align: center;
  background: var(--gold, #d4a94e); color: var(--on-gold, #fff);
  font-size: calc(26rpx * var(--fs, 1)); font-weight: 600;
  transition: transform .18s ease, opacity .18s ease;
}
.dpp-more:active { transform: scale(.965); opacity: .9; }
@media (prefers-reduced-motion: reduce) { .dpp-more { transition: none; } }
`;
const wAbs = P("pages/plan/plan.wxss");
let w = fs.readFileSync(wAbs, "utf8");
if (w.indexOf(".dpp-card") >= 0) {
  console.error("✗ [plan.wxss] 已存在 .dpp-card，拒绝重复追加");
  process.exitCode = 1;
} else {
  fs.writeFileSync(wAbs, w.replace(/\s*$/, "") + "\n" + WXSS);
  console.log("✓ [plan.wxss] 样式已追加");
}
