#!/usr/bin/env node
/**
 * tools/check/check-tap-target.mjs —— 可点元素触达尺寸门禁（棘轮）
 *
 * 为什么有这条门禁：
 *   v1.20.8 做了配色对比度整改（check-qa-rails A 组），但**尺寸**一直没护栏。实测全仓
 *   可点 class 268 个，其中 197 个在 wxss 里声明了固定高度，**20 个 < 88rpx**，最小 30rpx
 *   （≈15px，不到通用触达下限 44pt 的 1/3）。这类按钮用户点不中时不会报错、不会留日志，
 *   只会表现为「点了没反应」——功能在，但用不了。
 *
 * 判据分两档（为什么要分档）：
 *   硬线 60rpx：低于此值几乎必然点不中（30–58rpx 这批），必须登记在 REGISTRY 里并写明
 *               「为什么不能直接放大」。新增低于 60rpx 的可点元素立刻判红。
 *   建议线 88rpx：60–88rpx 只统计不判红。这批（68/72/76/84rpx）实际可用，
 *               一刀切卡死会把「高度由行内容撑起」的正常布局也逼成改样式凑数。
 *
 * 为什么本门禁只登记不自动修：
 *   扩热区的常规做法（min-height / padding / ::after 透明热区）在**相邻可点元素**上会互相
 *   抢占——后来的元素盖住先前的，点击落到错的按钮上。v1.20.26 逐条核对相邻关系后，13 处里
 *   10 处用「可见尺寸不变 + 透明 ::after 扩到 60rpx」修好（视觉零变化）；剩下 3 处是真的没有
 *   安全扩法，理由写在 REGISTRY 里：
 *     · .tl-credit 在 96rpx 缩略图内、整行绑 onToggle → 扩了就把「展开」变「看版权」
 *     · .rc-x      父级绑 applyFav，chip 内 gap 10rpx → 左扩吃「应用」、右扩吃邻 chip
 *     · .op        三颗按钮竖向排列 gap 仅 6rpx 且含破坏性「移除」→ 必然重叠
 *   这三处的正解都是重排/改交互，必须有视觉验证，因此固化为「不许变多」的棘轮 + 逐条登记原因。
 *
 * 不新增 allcheck 步数：串在既有 step 里跑（加减步会触发考核材料校验失败）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HARD = 60;      // 低于此值必须登记
const RECO = 88;      // 通用建议下限（只统计）

/* 已登记的「触达尺寸 < 60rpx 的可点元素」。cls → 原因（为什么不能直接放大）。
 * 修好一处就删一条 —— 门禁会检查登记是否过期（不再小于硬线 / class 已消失）并判红。
 *
 * v1.20.26：13 处里 10 处已用「可见尺寸不变 + 透明 ::after 扩热区」修好并从本表删除
 * （.mc-x .mr-x .cell-x .tk-dot .wx-close .w-del .ps-del .ps-close .step-btn .sop）。
 * 剩下 3 处是**物理上没有安全扩法**的，理由按实际相邻关系重写过，不再是「大概会抢点击」。 */
const REGISTRY = {
  "tl-credit": "图片来源 © 标注（30rpx），位于 96rpx 缩略图内、且整行 .tl-item 绑 onToggle；扩到 60rpx 会占掉缩略图 39% 并把「展开行程」误触成「看版权」。正解是把来源信息移进展开面板，属布局改版",
  "rc-x":      "父级 .recent-chip 绑 bindtap=applyFav（应用该城市），chip 内 gap 仅 10rpx、右侧 padding 8rpx；左扩吃「应用」、右扩越过 chip 边界吃相邻 chip，任何单方面扩都会把「应用」变成「删除」。正解是 ✕ 外置或改长按删除",
  "op":        "「想玩 / 导航 / 移除」三颗 44rpx 按钮在 .tl-ops 里**竖向排列、gap 仅 6rpx**，扩到 60rpx 必然与上下相邻按钮重叠，而其中一颗是破坏性「移除」。正解是把 .tl-ops 改横向排列并重排行尾，需真机视觉确认",
};

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [
  ...walk(path.join(ROOT, "pages")),
  ...walk(path.join(ROOT, "subpkg")),
  path.join(ROOT, "app.wxss"),
].filter((f) => /\.(wxml|wxss)$/.test(f));

/* ① 可点元素用到的 class（bindtap / catchtap / bindlongpress 都算可点） */
const tapClasses = new Map();     // cls -> Set(相对路径)
for (const f of files.filter((x) => x.endsWith(".wxml"))) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/<([a-zA-Z-]+)([^>]*)>/g)) {
    const attrs = m[2];
    if (!/\b(?:bind|catch)(?:tap|longpress|longtap)\s*=/.test(attrs)) continue;
    // 注意：不能用 /\bclass\s*=/ —— `\b` 在 `hover-class=` 的 `-c` 之间同样成立，
    // 于是会把 hover-class 的值当成 class 读走（v1.20.23 加按下反馈时被这条踩到：
    // tapClasses 从 200+ 骤降到 6，13 处已登记元素全部误报「class 已不存在」）。
    // 判据自身造假红比漏判更费时间，这里显式排除前面是 `-` 或单词字符的情况。
    const cm = /(?<![-\w])class\s*=\s*"([^"]*)"/.exec(attrs);
    if (!cm) continue;
    for (const c of cm[1].split(/\s+/)) {
      if (!c || c.includes("{{")) continue;   // 动态 class 无法静态判定，跳过（不假装覆盖）
      if (!tapClasses.has(c)) tapClasses.set(c, new Set());
      tapClasses.get(c).add(path.relative(ROOT, f));
    }
  }
}

/* ② 这些 class 的高度：取 max(固定 height, min-height, 透明扩热区) */
/* v1.20.26：口径从「只看高度」升级为「看宽高较小者」。
 * 原判据只读 height，于是一个 200rpx 宽 × 20rpx 高的长条按钮会被判成合格——那不是触达面积够，
 * 是尺子量错了维度。实测按 min(宽,高) 复核，全仓仍是同一批 13 个元素（没有因为改口径冒出新红），
 * 说明这次加强不会给后来者制造假红，可以放心收紧。
 * 宽度同样只在**显式声明**时才参与判定：由内容撑开的宽度无法静态得知，不假装覆盖。 */
// 「透明扩热区」= ::before/::after 且**不画任何可见内容**（无 background / border / box-shadow / color）。
// 这条过滤不能省：本仓有大量装饰伪元素（时间线圆点 .tl-item::before 13rpx、分组折叠 chevron
// .group-title::after 14rpx、左侧金条 .group-title::before 8x22rpx），它们尺寸很小但**完全不是**
// 触达面积。第一版把伪元素一律当热区，于是把 .tl-item（整行，靠 padding 撑高）误判成 13rpx，
// 门禁自己造假红 —— 判据写错比漏判更浪费时间。
const PAINTS = /(?:^|;)\s*(?:background|background-color|border|border-\w+|box-shadow|color|outline)\s*:/;
const geo = new Map();            // cls -> { fixed, fixedW, afterW, afterH }
for (const f of files.filter((x) => x.endsWith(".wxss"))) {
  const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    for (const sel of m[1].split(",").map((s) => s.trim())) {
      const plain = /^\.([A-Za-z0-9_-]+)$/.exec(sel);
      const pseudo = /^\.([A-Za-z0-9_-]+)::?(?:after|before)$/.exec(sel);
      const cls = plain ? plain[1] : (pseudo ? pseudo[1] : null);
      if (!cls || !tapClasses.has(cls)) continue;
      const g = geo.get(cls) || { fixed: 0, fixedW: 0, afterW: 0, afterH: 0 };
      const px = (re) => { const r = re.exec(body); return r ? Number(r[1]) : 0; };
      if (plain) {
        const h = px(/(?:^|;)\s*height\s*:\s*(-?[\d.]+)rpx/);
        const mh = px(/(?:^|;)\s*min-height\s*:\s*(-?[\d.]+)rpx/);
        const w = px(/(?:^|;)\s*width\s*:\s*(-?[\d.]+)rpx/);
        const mw = px(/(?:^|;)\s*min-width\s*:\s*(-?[\d.]+)rpx/);
        if (h || mh) g.fixed = Math.max(g.fixed, h, mh);
        if (w || mw) g.fixedW = Math.max(g.fixedW, w, mw);
      } else if (!PAINTS.test(body)) {
        // 纯透明伪元素才当扩热区；宽和高分别记，不能只用 max —— 100×20 的热区不算达标
        g.afterW = Math.max(g.afterW, px(/(?:^|;)\s*width\s*:\s*(-?[\d.]+)rpx/));
        g.afterH = Math.max(g.afterH, px(/(?:^|;)\s*height\s*:\s*(-?[\d.]+)rpx/));
      }
      geo.set(cls, g);
    }
  }
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail ? "  → " + detail : "")); }
}

console.log("【可点元素触达尺寸】");
const tooSmall = [];    // < HARD
const advisory = [];    // HARD..RECO
for (const [cls, g] of geo) {
  const H = Math.max(g.fixed, g.afterH);
  const W = Math.max(g.fixedW, g.afterW);
  if (!H) continue;                          // 高度没声明（由 padding/内容撑起）→ 静态无法判定，不装作覆盖
  const eff = W ? Math.min(H, W) : H;        // 宽高都已知时取较小者：触达面积由短边决定
  if (eff < HARD) tooSmall.push({ cls, eff, files: [...(tapClasses.get(cls) || [])] });
  else if (eff < RECO) advisory.push({ cls, eff });
}
tooSmall.sort((a, b) => a.eff - b.eff);

const unregistered = tooSmall.filter((x) => !REGISTRY[x.cls]);
ok("显式固定高度 < " + HARD + "rpx 的可点元素都已登记（现有 " + tooSmall.length + " 处，未登记 " + unregistered.length + " 处）",
  unregistered.length === 0,
  unregistered.map((x) => "." + x.cls + "=" + x.eff + "rpx（" + x.files.slice(0, 1).join("") + "）").join(" / "));

// 过期登记：已放大到硬线以上 / class 已不存在 → 要求清掉，避免清单腐烂成"永远不用管"的白名单
const stale = [];
for (const cls of Object.keys(REGISTRY)) {
  const stillSmall = tooSmall.some((x) => x.cls === cls);
  if (!stillSmall) stale.push(cls + (geo.has(cls) ? "（已 ≥" + HARD + "rpx，请从 REGISTRY 删除）" : "（class 已不存在，请删除登记）"));
}
ok("登记清单无过期项（改好了要删登记，否则清单会腐烂）", stale.length === 0, stale.join(" / "));

const worst = tooSmall.slice(0, 5).map((x) => "." + x.cls + "=" + x.eff + "rpx").join("、");
ok("最小触达尺寸不低于 24rpx（低于此值等同不可点）", !tooSmall.length || tooSmall[0].eff >= 24, worst || "无");

/* ③ 按下反馈覆盖率（v1.20.23 新增）
 *
 * 为什么和「触达尺寸」放同一条门禁：两者解决的是同一个症状——「点了没反应」。
 * 尺寸不够是点不中；没有按下反馈是「点中了但看不见任何变化」。
 *
 * 实测背景：全站 344 个可点 <view>/<text> 此前 hover-class 命中 0。
 * 而真机分包页 navigateTo 要 1100~1330ms（微信创建页面实例的框架成本，原生层改不动），
 * 我们自己 onLoad/onShow 只要 6~138ms —— 用户感知的「卡」几乎全在这段空白里。
 * 没有按下反馈 = 按下后 1 秒多毫无响应，这才是体感差的直接来源。
 *
 * 覆盖范围必须是**全部四个包**（pages/subpkg/subai/components）。只扫 pages 会漏掉
 * subai 与共享组件——本仓已因「check-ai-reach 只 filter(/^pages\//)」漏掉 subai/deep
 * 跨分包组件失效而踩过一次坑，这里不再重犯。
 *
 * <button> 不要求：微信内置 button-hover 已提供按下态。
 */
const PKG_DIRS = ["pages", "subpkg", "subai", "components"];
const wxmlAll = [];
for (const d of PKG_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) wxmlAll.push(...walk(abs).filter((f) => f.endsWith(".wxml")));
}
const noHover = [];
let tapTotal = 0;
for (const f of wxmlAll) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/<([a-zA-Z-]+)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    // 只认 tap 类绑定：longpress 是长按，按下态不适用，不强制
    if (!/\b(?:bindtap|catchtap)\s*=/.test(attrs)) continue;
    if (tag === "button") continue;            // 内置 button-hover
    tapTotal++;
    if (/\bhover-class\s*=/.test(attrs)) continue;
    noHover.push(path.relative(ROOT, f) + " <" + tag + ">");
  }
}
ok("可点元素都带按下反馈（" + tapTotal + " 个，缺失 " + noHover.length + " 个）",
  noHover.length === 0,
  noHover.slice(0, 8).join(" / ") + (noHover.length > 8 ? " …" : ""));

// 反馈样式必须真实存在，否则属性写了也只是空挂（断言「源码里有某串字」≠ 断言生效）
const appCss = fs.readFileSync(path.join(ROOT, "app.wxss"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
ok("app.wxss 里确实定义了 .tap-hover（否则 hover-class 空挂）",
  /\.tap-hover\s*\{[^}]*opacity\s*:/.test(appCss));

// 反向护栏：新建页面若整体忘了写反馈，单看「缺失 0 个」会假绿（0 个可点元素也满足）
ok("按下反馈扫描确实覆盖到四个包（防扫描范围塌缩成空集）",
  PKG_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d))).length >= 3 && tapTotal >= 300,
  "扫描 " + wxmlAll.length + " 个 wxml / 可点 " + tapTotal + " 个");

console.log("  建议档（" + HARD + "–" + RECO + "rpx，不判红）共 " + advisory.length + " 处：" +
  advisory.map((x) => "." + x.cls + "=" + x.eff).join("、"));
console.log("  硬线以下已登记 " + Math.min(tooSmall.length, Object.keys(REGISTRY).length) + " 处：" + worst);

console.log("");
if (fail === 0) {
  console.log("触达尺寸门禁通过：" + pass + " 项（硬线 " + HARD + "rpx / 建议线 " + RECO + "rpx / 已登记 " + Object.keys(REGISTRY).length + " 处待重排）");
  process.exit(0);
}
console.log("触达尺寸门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
process.exit(1);
