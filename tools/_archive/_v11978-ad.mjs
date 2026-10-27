// v1.19.78：深玩页接「激励视频解锁」
// 规则（务必保持）：当前行程相关的那座城永远免费；切换到其他城市才需要解锁；
// 未开通流量主 / 广告不可用 → AD.unlocked() 恒为 true → 天然全解锁，UI 自动隐藏。
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
  fs.writeFileSync(abs, s.replace(needle, repl));
  console.log(`✓ [${label}] ${file}`);
}

// ── deep.js：引入 ad + data 字段 ──
once(
  "subai/deep/deep.js",
  `const A = require("../../utils/aicontent.js");`,
  `const A = require("../../utils/aicontent.js");\nconst AD = require("../../utils/ad.js");`,
  "deep.js/require"
);

once(
  "subai/deep/deep.js",
  `    cur: null,\n    msg: ""\n  },`,
  `    cur: null,\n    msg: "",\n    // 免费城（从行程页带进来的那座，永远免费）+ 广告位状态\n    freeCity: "",\n    adOn: false,\n    allUnlocked: true\n  },`,
  "deep.js/data"
);

// ── deep.js：onLoad 记下免费城、刷新解锁态 ──
once(
  "subai/deep/deep.js",
  `      this.setData({ ready: true, cities: cities, curName: curName, msg: cities.length ? "" : "内容暂未就绪" });`,
  `      this.setData({
        ready: true, cities: cities, curName: curName, freeCity: curName,
        adOn: AD.available(), allUnlocked: AD.unlocked(),
        msg: cities.length ? "" : "内容暂未就绪"
      });`,
  "deep.js/onLoad"
);

// ── deep.js：切换城市时的解锁逻辑 ──
once(
  "subai/deep/deep.js",
  `  onPick(e) {
    const c = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.c) || "";
    if (!c || c === this.data.curName) return;
    this._pick(c);
  },`,
  `  onPick(e) {
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
  },`,
  "deep.js/onPick"
);

// ── deep.wxml：chips 下的说明行 ──
once(
  "subai/deep/deep.wxml",
  `    <!-- 一句话速览 -->`,
  `    <view class="dp-note" wx:if="{{adOn && !allUnlocked && cities.length > 1}}">带进来的这座城免费看 · 切到别的城市需解锁（当天有效）</view>

    <!-- 一句话速览 -->`,
  "deep.wxml/note"
);

// ── deep.wxss ──
const wAbs = P("subai/deep/deep.wxss");
let w = fs.readFileSync(wAbs, "utf8");
if (w.indexOf(".dp-note") >= 0) {
  console.error("✗ [deep.wxss] .dp-note 已存在，拒绝重复追加");
  process.exitCode = 1;
} else {
  w = w.replace(/\s*$/, "") + `
.dp-note { margin: 4rpx 6rpx 0; font-size: calc(22rpx * var(--fs, 1)); color: var(--t4, #7d92ab); line-height: 1.6; }
`;
  fs.writeFileSync(wAbs, w);
  console.log("✓ [deep.wxss] 样式已追加");
}
