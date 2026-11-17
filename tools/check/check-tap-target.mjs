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
 *   抢占——后来的元素盖住先前的，点击落到错的按钮上。本仓已确认 3 处属于这种：
 *     · .rc-x   父级 .recent-chip 绑 bindtap="applyFav" → 扩热区会把「应用」误触成「删除」
 *     · .mr-x   左侧紧邻「＋」天数步进按钮
 *     · .op     「想玩 / 导航 / 移除」四个相邻且含破坏性操作
 *   安全改法需要重排（拉开间距或改成滑动/长按），必须有视觉验证。因此这里固化为
 *   「不许变多」的棘轮 + 逐条登记原因，等有人能看真机时再按清单重排。
 *
 * 不新增 allcheck 步数：串在既有 step 里跑（加减步会触发考核材料校验失败）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HARD = 60;      // 低于此值必须登记
const RECO = 88;      // 通用建议下限（只统计）

/* 已登记的「固定高度 < 60rpx 的可点元素」。cls → 原因（为什么不能直接放大）。
 * 修好一处就删一条 —— 门禁会检查登记是否过期（不再小于硬线 / class 已消失）并判红。 */
const REGISTRY = {
  "tl-credit": "图片角落的来源标注（30rpx），非功能区；扩热区会在卡片角上形成吞点击的死区",
  "mc-x":      "想玩缺口的移除 ✕（34rpx），与名称文字同处一个 chip，左扩会抢占名称区域导致误删 → 需重排",
  "rc-x":      "父级 .recent-chip 绑 bindtap=applyFav，扩热区会把「应用」误触成「删除」→ 绝不可单方面扩",
  "mr-x":      "左侧紧邻「＋」天数步进按钮，扩热区会抢步进点击",
  "cell-x":    "缩略图右上角删除 ✕（40rpx），热区与图片本体重叠",
  "tk-dot":    "装备步骤指示点（42rpx），横向密集排列且同时承担跳转",
  "op":        "「想玩 / 导航 / 移除」四个相邻按钮（44rpx）且含破坏性操作，扩热区互相抢占 → 需重排",
  "wx-close":  "天气卡关闭 ✕（44rpx），行内与文案紧邻",
  "w-del":     "想玩删除（48rpx），与同排 .op-btn 间距 16rpx，扩到 ≥64rpx 即与本行按钮重叠",
  "ps-del":    "多站列表删除（48rpx），同上：与相邻按钮的间距不足以再扩",
  "ps-close":  "站点卡关闭（52rpx），行内与站点名相邻",
  "step-btn":  "出行天数步进按钮（56rpx），紧邻天数数字",
  "sop":       "行程条操作按钮（58rpx），与条目文案同一行",
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
    const cm = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
    if (!cm) continue;
    for (const c of cm[1].split(/\s+/)) {
      if (!c || c.includes("{{")) continue;   // 动态 class 无法静态判定，跳过（不假装覆盖）
      if (!tapClasses.has(c)) tapClasses.set(c, new Set());
      tapClasses.get(c).add(path.relative(ROOT, f));
    }
  }
}

/* ② 这些 class 的高度：取 max(固定 height, min-height, 透明扩热区) */
// 「透明扩热区」= ::before/::after 且**不画任何可见内容**（无 background / border / box-shadow / color）。
// 这条过滤不能省：本仓有大量装饰伪元素（时间线圆点 .tl-item::before 13rpx、分组折叠 chevron
// .group-title::after 14rpx、左侧金条 .group-title::before 8x22rpx），它们尺寸很小但**完全不是**
// 触达面积。第一版把伪元素一律当热区，于是把 .tl-item（整行，靠 padding 撑高）误判成 13rpx，
// 门禁自己造假红 —— 判据写错比漏判更浪费时间。
const PAINTS = /(?:^|;)\s*(?:background|background-color|border|border-\w+|box-shadow|color|outline)\s*:/;
const geo = new Map();            // cls -> { fixed, after }
for (const f of files.filter((x) => x.endsWith(".wxss"))) {
  const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    for (const sel of m[1].split(",").map((s) => s.trim())) {
      const plain = /^\.([A-Za-z0-9_-]+)$/.exec(sel);
      const pseudo = /^\.([A-Za-z0-9_-]+)::?(?:after|before)$/.exec(sel);
      const cls = plain ? plain[1] : (pseudo ? pseudo[1] : null);
      if (!cls || !tapClasses.has(cls)) continue;
      const g = geo.get(cls) || { fixed: 0, after: 0 };
      const px = (re) => { const r = re.exec(body); return r ? Number(r[1]) : 0; };
      if (plain) {
        const h = px(/(?:^|;)\s*height\s*:\s*(-?[\d.]+)rpx/);
        const mh = px(/(?:^|;)\s*min-height\s*:\s*(-?[\d.]+)rpx/);
        if (h || mh) g.fixed = Math.max(g.fixed, h, mh);
      } else if (!PAINTS.test(body)) {
        // 纯透明伪元素才当扩热区
        g.after = Math.max(g.after,
          px(/(?:^|;)\s*width\s*:\s*(-?[\d.]+)rpx/),
          px(/(?:^|;)\s*height\s*:\s*(-?[\d.]+)rpx/));
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
  const eff = Math.max(g.fixed, g.after);
  if (!eff) continue;                        // 没声明高度（由 padding/内容撑起）→ 静态无法判定，不装作覆盖
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
