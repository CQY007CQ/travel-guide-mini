// v1.19.78 广告回归：用 mock wx 在 vm 里跑真实的 utils/ad.js
// 关键：验证「没开广告 = 全放行」，以及「看完才解锁、半程退出不给奖励」
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const requireNode = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "utils/ad.js"), "utf8");

const A_REAL = requireNode(ROOT + "/utils/aicontent.js");
const RAW = requireNode(ROOT + "/subai/data/ai-deep.js");

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

/** 造一个 ad 模块实例；cfg 可覆盖 ENABLED / AD_UNIT_ID */
function buildAd(cfg) {
  let s = SRC;
  if (cfg && cfg.enabled !== undefined) s = s.replace(/const ENABLED = [^;]+;/, "const ENABLED = " + cfg.enabled + ";");
  if (cfg && cfg.unit !== undefined) s = s.replace(/const AD_UNIT_ID = [^;]+;/, "const AD_UNIT_ID = " + JSON.stringify(cfg.unit) + ";");
  const store = new Map();
  const wx = {
    getStorageSync(k) { return store.has(k) ? store.get(k) : ""; },
    setStorageSync(k, v) { store.set(k, String(v)); },
    createRewardedVideoAd(opt) {
      const inst = {
        _unit: opt && opt.adUnitId,
        _close: null, _err: null,
        onClose(cb) { inst._close = cb; },
        onError(cb) { inst._err = cb; },
        load() { return inst._loadRes(); },
        show() { return inst._showRes(); },
        _loadRes: () => Promise.resolve(),
        _showRes: () => Promise.resolve()
      };
      wx.__ad = inst;
      return inst;
    }
  };
  const ctx = { wx, console, Date, JSON, Number, String, Object, Promise, setTimeout, Math, setInterval, module: { exports: {} }, exports: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(s, ctx, { filename: "ad.js" });
  return { mod: ctx.module.exports, wx };
}

console.log("\n── 未开通流量主（默认出厂状态）──");
{
  const { mod, wx } = buildAd({});
  ok("available = false", mod.available() === false);
  ok("unlocked = true（fail-open，内容全解锁）", mod.unlocked() === true);
  const r = await mod.watch();
  ok("watch 直接放行 true", r === true);
  ok("根本没创建广告实例", !wx.__ad);
}

console.log("\n── 已开通 + 未解锁 ──");
let ad1;
{
  const b = buildAd({ enabled: true, unit: "adunit-test123" });
  const mod = b.mod;
  ad1 = b;
  ok("available = true", mod.available() === true);
  ok("unlocked = false", mod.unlocked() === false);
  const p = mod.watch();
  await new Promise((r) => setTimeout(r, 10));
  ok("已创建激励视频实例", !!b.wx.__ad);
  ok("广告位 ID 正确传入", b.wx.__ad && b.wx.__ad._unit === "adunit-test123");
  // 模拟：完整看完
  b.wx.__ad._close({ isEnded: true });
  const res = await p;
  ok("看完 → watch 返回 true", res === true);
  ok("看完 → 已写入解锁状态", mod.unlocked() === true);
}

console.log("\n── 半程退出不给奖励 ──");
{
  const b = buildAd({ enabled: true, unit: "adunit-test456" });
  const mod = b.mod;
  const p = mod.watch();
  await new Promise((r) => setTimeout(r, 10));
  b.wx.__ad._close({ isEnded: false });
  const res = await p;
  ok("没看完 → watch 返回 false", res === false);
  ok("没看完 → 仍未解锁", mod.unlocked() === false);
}

console.log("\n── 广告加载失败 → 放行 ──");
{
  const b = buildAd({ enabled: true, unit: "adunit-test789" });
  const mod = b.mod;
  b.wx.createRewardedVideoAd = (o) => {
    return {
      onClose() {}, onError() {},
      load: () => Promise.reject(new Error("no fill")),
      show: () => Promise.reject(new Error("no fill"))
    };
  };
  const res = await mod.watch();
  ok("加载失败仍放行 true", res === true);
}

console.log("\n── 已解锁后不再重复看广告 ──");
{
  const b = buildAd({ enabled: true, unit: "adunit-x" });
  // 先播一次拿到解锁
  const p = b.mod.watch();
  await new Promise((r) => setTimeout(r, 10));
  b.wx.__ad._close({ isEnded: true });
  await p;
  let created = 0;
  const cnt = b.wx.createRewardedVideoAd;
  b.wx.createRewardedVideoAd = (o) => { created++; return cnt(o); };
  const again = await b.mod.watch();
  ok("第二次直接放行", again === true);
  ok("没有再创建实例", created === 0, String(created));
}

console.log("\n── deep 页：切城解锁逻辑 ──");
{
  const pageSrc = fs.readFileSync(path.join(ROOT, "subai/deep/deep.js"), "utf8");
  function buildPage(store, adMod) {
    const wx = {
      getStorageSync(k) { return store.has(k) ? store.get(k) : ""; },
      setStorageSync(k, v) { store.set(k, String(v)); },
      showModal(o) { wx.__modal = o; },
      showToast() {},
      setNavigationBarTitle() {},
      createRewardedVideoAd: () => ({ onClose() {}, onError() {}, load: () => Promise.resolve(), show: () => Promise.resolve() })
    };
    let cfg = null;
    const ctx = {
      wx, console, Date, JSON, Number, String, Object, Promise, setTimeout, Math, Array, encodeURIComponent, Error,
      Page: (o) => { cfg = o; },
      module: { exports: {} }, exports: {},
      require(p) {
        if (String(p).indexOf("ad.js") >= 0) return adMod;
        if (String(p).indexOf("aicontent") >= 0) return A_REAL;
        if (String(p).indexOf("ai-deep") >= 0) return RAW;
        return {};
      }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(pageSrc, ctx, { filename: "deep.js" });
    return { cfg, wx };
  }
  const store = new Map();
  const { cfg, wx } = buildPage(store, buildAd({}).mod);
  await A_REAL.initDeep();
  const page = Object.assign({}, cfg);
  page.data = cfg.data;
  let picked = [];
  page.setData = (d) => { Object.assign(page.data, d); };
  page._pick = (c) => { picked.push(c); };

  page.data.freeCity = "西安"; page.data.curName = "西安";
  page.data.adOn = false; page.data.allUnlocked = true;
  cfg.onPick.call(page, { currentTarget: { dataset: { c: "西安" } } });
  ok("切到自己（免费城）→ 直接看", wx.__modal === undefined && picked.length === 0);

  cfg.onPick.call(page, { currentTarget: { dataset: { c: "上海" } } });
  ok("广告未开通 → 切别的城也不拦截", wx.__modal === undefined && picked.join() === "上海");
}

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
