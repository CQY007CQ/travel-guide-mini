#!/usr/bin/env node
/**
 * tools/_test-share-img.mjs —— v1.19.199「生成分享图」真机失败回归
 *
 * 背景：用户实机截图报障，行程页点「生成分享图」稳定弹「生成失败」。
 * 根因（4 条同向叠加）：
 *  ① wx.canvasToTempFilePath 完全用默认参数：canvas.width/height 已按 dpr 放大，
 *     而 destWidth/destHeight 默认还要再乘一次像素密度，高 dpr 安卓机直接申请超大图 → fail；
 *  ② 画布 CSS 尺寸 600×2400 与实际绘制逻辑尺寸 600×H 不一致，默认导出区域越界；
 *  ③ 画布放在 left:-10000rpx 视口外，部分真机渲染剔除 → fields({node:true}) 取不到节点；
 *  ④ 绘制后立刻导出，部分安卓 GPU 未提交。
 * 另外三个失败阶段原本都 toast 同一句「生成失败」，无法定位。
 *
 * 断言（vm 抽 onShareImg 真代码跑）：显式导出矩形 / dpr 钳位 / 节点重试 / 导出三档降级 /
 * 分阶段提示 / 成功链路，加上 wxml、wxss、_ensureShareCard 与版本一致性静态护栏。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import vm from "vm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const PLAN_JS = "pages/plan/plan.js";

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

// 方法定义体 → 函数表达式（沿用 _test-v11988-sharecard.mjs 的成熟约定）
const grab = (name) => {
  const s = read(PLAN_JS);
  const re = new RegExp(name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(s);
  if (!m) throw new Error("method not found: " + name);
  const i = m.index;
  const j = s.indexOf("\n  },", i);
  if (j < 0) throw new Error("method body not closed: " + name);
  return s.slice(i, j + 4).replace(re, "function(" + m[1] + "){");
};
const fnShare = grab("onShareImg");
const srcCard = read(PLAN_JS).slice(read(PLAN_JS).indexOf("_ensureShareCard()"));

const MODEL = {
  W: 600, H: 1312, padX: 40, cityName: "西安",
  days: [], spots: 12, mode: "平衡舒适", daysN: 4
};

function run(opt = {}) {
  const state = {
    loading: 0, hidden: 0, toasts: [], exports: [], queries: 0,
    menu: 0, saved: 0, preview: 0, logs: [], transforms: []
  };
  const ctx2d = {
    scale: () => {},
    setTransform: (a, b, c, d, e, f) => state.transforms.push([a, b, c, d, e, f])
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx2d,
    requestAnimationFrame: (cb) => cb()
  };
  const wx = {
    showLoading: () => state.loading++,
    hideLoading: () => state.hidden++,
    showToast: (o) => state.toasts.push(o && o.title),
    getWindowInfo: () => ({ pixelRatio: opt.dpr === undefined ? 3 : opt.dpr }),
    createSelectorQuery: () => {
      const q = {
        in() { return this; },
        select() { return this; },
        fields() { return this; },
        exec(cb) {
          state.queries++;
          const give = state.queries > (opt.nodeFailUntil || 0);
          cb(give ? [{ node: canvas, size: true }] : [{}]);
        }
      };
      return q;
    },
    canvasToTempFilePath: (o) => {
      state.exports.push(o);
      if (state.exports.length <= (opt.exportFailTimes || 0)) {
        if (o.fail) o.fail({ errMsg: "mock export fail" });
        return;
      }
      if (o.success) o.success({ tempFilePath: "wxfile://tmp_poster.png" });
    },
    showShareImageMenu: opt.noMenu ? undefined : (o) => {
      state.menu++;
      if (opt.menuFail && o.fail) o.fail();
    },
    saveImageToPhotosAlbum: (o) => { state.saved++; if (o.success) o.success(); },
    previewImage: () => state.preview++
  };
  const ctx = {
    wx,
    app: { globalData: { plan: { cityName: "西安", days: [{}, {}, {}, {}] } } },
    console: { warn: (...a) => state.logs.push(a.map(String).join(" ")) },
    EL: { push: (label) => state.logs.push(label) },
    setTimeout: (fn) => { fn(); return 0; },
    app_global_unused: null
  };
  delete ctx.app_global_unused;
  vm.createContext(ctx);
  const page = {
    __posterBusy: false,
    _posterModel: () => Object.assign({}, MODEL),
    _drawPoster: () => { if (opt.drawFail) throw new Error("draw boom"); }
  };
  vm.runInContext("(" + fnShare + ")", ctx).call(page);
  return { state, canvas, page };
}

// ---------- 1. 成功路径：显式导出矩形 + dpr 钳位 ----------
{
  const { state, canvas, page } = run({ dpr: 3 });
  ok("成功：showLoading 与 hideLoading 配对", state.loading === 1 && state.hidden === 1);
  ok("成功：无失败提示", state.toasts.length === 0, JSON.stringify(state.toasts));
  ok("dpr=3 被钳到 2（画布 1200×2624）", canvas.width === 1200 && canvas.height === 2624,
    canvas.width + "×" + canvas.height);
  ok("setTransform 按 dpr 设置且不被 scale 叠加", state.transforms.length === 1
    && state.transforms[0][0] === 2 && state.transforms[0][3] === 2);
  ok("导出只调一次", state.exports.length === 1, "实得 " + state.exports.length);
  const o = state.exports[0] || {};
  ok("导出显式 width/height = 逻辑尺寸 600×1312", o.width === 600 && o.height === 1312,
    o.width + "×" + o.height);
  ok("导出显式 destWidth/destHeight = 物理尺寸 1200×2624（不再二次乘密度）",
    o.destWidth === 1200 && o.destHeight === 2624, o.destWidth + "×" + o.destHeight);
  ok("导出指定 x/y 与 fileType", o.x === 0 && o.y === 0 && o.fileType === "png");
  ok("导出传入 canvas 节点", !!o.canvas);
  ok("成功走 showShareImageMenu", state.menu === 1);
  ok("成功后释放 __posterBusy", page.__posterBusy === false);
}

// ---------- 2. 节点重试 ----------
{
  const r = run({ nodeFailUntil: 1 });
  ok("节点首次取不到时重试并能成功", r.state.queries === 2 && r.state.exports.length === 1
    && r.state.toasts.length === 0, "queries=" + r.state.queries);
}
{
  const r = run({ nodeFailUntil: 99 });
  ok("节点始终取不到：最多查 3 次后停", r.state.queries === 3, "实得 " + r.state.queries);
  ok("节点失败提示可区分（画布未就绪）", r.state.toasts.some(t => /画布未就绪/.test(t || "")),
    JSON.stringify(r.state.toasts));
  ok("节点失败写 errlog 便于真机回溯", r.state.logs.some(x => /onShareImg\.node/.test(x)));
  ok("节点失败释放 __posterBusy", r.page.__posterBusy === false);
}

// ---------- 3. 导出三档降级 ----------
{
  const r = run({ exportFailTimes: 1 });
  ok("第一档导出失败后自动降级第二档", r.state.exports.length === 2, "实得 " + r.state.exports.length);
  const o2 = r.state.exports[1] || {};
  ok("第二档按物理像素口径（width = canvas.width）", o2.width === 1200 && o2.height === 2624
    && o2.destWidth === 1200 && o2.destHeight === 2624, o2.width + "×" + o2.height);
  ok("降级后成功无失败提示", r.state.toasts.length === 0);
  ok("降级写分阶段日志", r.state.logs.some(x => /export\.variant0/.test(x)));
}
{
  const r = run({ exportFailTimes: 99 });
  ok("三档全失败：共尝试 3 次后停", r.state.exports.length === 3, "实得 " + r.state.exports.length);
  ok("导出失败提示可区分（导出失败）", r.state.toasts.some(t => /导出失败/.test(t || "")),
    JSON.stringify(r.state.toasts));
  ok("导出失败释放 __posterBusy", r.page.__posterBusy === false);
}
{
  const r = run({ drawFail: true });
  ok("绘图抛错提示可区分（绘图失败）", r.state.toasts.some(t => /绘图失败/.test(t || "")),
    JSON.stringify(r.state.toasts));
  ok("绘图抛错不会继续导出", r.state.exports.length === 0);
  ok("绘图抛错写 errlog", r.state.logs.some(x => /onShareImg\.draw/.test(x)));
}

// ---------- 4. 成功后的分发链路 ----------
{
  const r = run({ noMenu: true });
  ok("无 showShareImageMenu 时回退存相册", r.state.saved === 1 && r.state.menu === 0);
}
{
  const r = run({ menuFail: true });
  ok("分享菜单失败时回退存相册", r.state.saved === 1);
}

// ---------- 5. 静态护栏 ----------
const wxml = read("pages/plan/plan.wxml");
const wxss = read("pages/plan/plan.wxss");
ok("wxml 仍有离屏 canvas #shareCanvas", /<canvas[^>]+id="shareCanvas"[^>]+type="2d"/.test(wxml)
  || /<canvas[^>]+type="2d"[^>]+id="shareCanvas"/.test(wxml));
// 只校验 .share-canvas 规则块本身：注释里会提到旧的 -10000rpx，不能把注释算成违规
const canvasRule = (wxss.match(/\.share-canvas\s*\{[^}]*\}/) || [""])[0];
ok("wxss 规则块不再把画布放到 -10000rpx 视口外", !!canvasRule && !/left:\s*-10000rpx/.test(canvasRule));
ok("wxss 规则块用 left:0 让节点留在视口内", /left:\s*0\s*;/.test(canvasRule));
ok("wxss 保留 z-index:-1 与极低透明度（节点参与渲染但不可见）",
  /z-index:\s*-1/.test(canvasRule) && /opacity:\s*0\.01/.test(canvasRule));
ok("onShareImg 源码含显式 destWidth 与等一帧导出",
  fnShare.includes("destWidth") && fnShare.includes("requestAnimationFrame"));
ok("onShareImg 源码含分阶段日志", fnShare.includes("EL.push"));
ok("_ensureShareCard 同步修了显式导出矩形", srcCard.includes("destWidth") && srcCard.includes("width: m.W"));
ok("_ensureShareCard 避让海报绘制（__posterBusy）", srcCard.includes("__posterBusy"));

const ver = (s) => (s.match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
const cfgVer = JSON.parse(read("project.config.json")).version;
const srcVer = ver(read("tools/_src-backup/travel.js"));
const outVer = ver(read("utils/travel.js"));
// 以 IDE 配置为期望值动态比对，避免每次升版都要改测试
ok("真源 / 产物 / project.config.json 版本一致",
  !!cfgVer && srcVer === cfgVer && outVer === cfgVer,
  [srcVer, outVer, cfgVer].join(" / "));

console.log("  分享图导出回归: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
console.log("  ✔ 真机四根因均已固化为护栏");
