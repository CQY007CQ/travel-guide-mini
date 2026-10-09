// v1.19.78 提醒回归：mock wx 跑真实 utils/remind.js
// 重点验证「没配模板 ID 就不出现订阅选项、不会弹没用的授权框」
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const ROOT = path.resolve(process.cwd());
const requireNode = createRequire(import.meta.url);
const SRC = fs.readFileSync(path.join(ROOT, "utils/remind.js"), "utf8");

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

function build(cfg) {
  let s = SRC;
  if (cfg && cfg.cloud !== undefined) s = s.replace(/const USE_CLOUD = [^;]+;/, "const USE_CLOUD = " + cfg.cloud + ";");
  if (cfg && cfg.tmpl) s = s.replace(/const TMPL_IDS = [^;]+;/, "const TMPL_IDS = " + JSON.stringify(cfg.tmpl) + ";");
  const store = new Map();
  const log = { cal: null, sub: 0, fn: 0, modal: null };
  const wx = {
    getStorageSync(k) { return store.has(k) ? store.get(k) : ""; },
    setStorageSync(k, v) { store.set(k, String(v)); },
    addPhoneCalendar(o) { log.cal = o; o.success && o.success(); },
    requestSubscribeMessage(o) { log.sub++; o.success && o.success({}); },
    cloud: cfg && cfg.cloudReady ? { callFunction(o) { log.fn++; o.success && o.success({}); } } : undefined
  };
  const ctx = { wx, console, Date, JSON, Number, String, Object, Array, Promise, Math, isNaN, setTimeout, module: { exports: {} }, exports: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(s, ctx, { filename: "remind.js" });
  return { mod: ctx.module.exports, wx, log, store };
}

function future(n) {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x) => (x < 10 ? "0" + x : String(x));
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

console.log("\n── 默认出厂（未开通云开发 / 未填模板）──");
{
  const b = build({});
  ok("subscribeAvailable = false", b.mod.subscribeAvailable() === false);
  ok("cloudReady = false", b.mod.cloudReady() === false);
  const r = await b.mod.requestSubscribe();
  ok("requestSubscribe 不发请求（直接放行空结果）", Array.isArray(r) && r.length === 0 && b.log.sub === 0);
  const rr = await b.mod.scheduleCloud({ date: future(1) });
  ok("scheduleCloud 返回 false", rr === false && b.log.fn === 0);
}

console.log("\n── 本地队列 CRUD ──");
{
  const b = build({});
  ok("初始为空", b.mod.list().length === 0);
  const a = b.mod.add({ date: future(3), city: "西安", title: "西安 · 出发当天", planId: "P1" });
  ok("新增成功", !!a && a.date === future(3));
  const again = b.mod.add({ date: future(3), city: "西安", title: "重复", planId: "P1" });
  ok("同 planId 同日去重", again.id === a.id && b.mod.list().length === 1);
  b.mod.add({ date: future(1), city: "上海", title: "上海 · 出发当天", planId: "P2" });
  ok("两条不同 -> 2 条", b.mod.list().length === 2);
  ok("list 按日期升序", b.mod.list()[0].city === "上海");
  ok("upcoming(7) 命中 2 条", b.mod.upcoming(7).length === 2);
  ok("upcoming(2) 命中 1 条", b.mod.upcoming(2).length === 1);
  const due = b.mod.add({ date: future(0), city: "杭州", title: "杭州 · 出发当天", planId: "P3" });
  ok("到期未读 -> dueToday 命中", b.mod.dueToday().length === 1 && b.mod.dueToday()[0].id === due.id);
  b.mod.ack(due.id);
  ok("ack 后不再提示", b.mod.dueToday().length === 0);
  b.mod.remove(a.id);
  ok("remove 生效", b.mod.list().length === 2);
  b.mod.clear();
  ok("clear 生效", b.mod.list().length === 0);
}

console.log("\n── 加入手机日历（离线兜底）──");
{
  const b = build({});
  const r = await b.mod.addToCalendar({ date: future(2), title: "成都 · 出发当天", note: "5 天行程" });
  ok("返回成功 true", r === true);
  ok("标题正确写入", b.log.cal && b.log.cal.title === "成都 · 出发当天");
  ok("时间取当天 8:00", b.log.cal && b.log.cal.startTime * 1000 === new Date(future(2) + " 08:00:00").getTime());
  ok("提前 1 小时响铃", b.log.cal && b.log.cal.alarmOffset === 3600);
  const bad = await b.mod.addToCalendar({ date: "" });
  ok("空日期不写入、返回 false", bad === false);
  const b2 = build({});
  delete b2.wx.addPhoneCalendar;
  const r2 = await b2.mod.addToCalendar({ date: future(2) });
  ok("环境不支持 -> false（不抛错）", r2 === false);
}

console.log("\n── 已配云端：订阅 + 云调度 ──");
{
  const b = build({ cloud: true, tmpl: ["tmpl-a"], cloudReady: true });
  ok("subscribeAvailable = true", b.mod.subscribeAvailable() === true);
  ok("cloudReady = true", b.mod.cloudReady() === true);
  await b.mod.requestSubscribe();
  ok("真的发了授权请求", b.log.sub === 1);
  const okr = await b.mod.scheduleCloud({ date: future(1), city: "广州" });
  ok("云调用成功 true", okr === true && b.log.fn === 1);
}

console.log("\n── 配置云端但环境没有 wx.cloud ──");
{
  const b = build({ cloud: true, tmpl: ["tmpl-a"], cloudReady: false });
  ok("cloudReady = false（自动降级）", b.mod.cloudReady() === false);
  const r = await b.mod.scheduleCloud({ date: future(1) });
  ok("降级返回 false，调用方会走日历", r === false);
}

console.log("\n── plan 页：工具项与逻辑 ──");
{
  const src = fs.readFileSync(path.join(ROOT, "pages/plan/plan.js"), "utf8");
  ok("plan.wxml 有出发提醒按钮", fs.readFileSync(path.join(ROOT, "pages/plan/plan.wxml"), "utf8").indexOf('catchtap="onRemind"') >= 0);
  ok("plan.js 引入 remind", src.indexOf('require("../../utils/remind.js")') >= 0);
  ok("进页调用了 _checkDueRemind", src.indexOf("this._checkDueRemind();") >= 0);
  ok("存在 onRemind / _remindItem", src.indexOf("onRemind()") >= 0 && src.indexOf("_remindItem(plan)") >= 0);

  const R = build({}).mod;
  let cfg = null;
  const sheet = {};
  const wx = {
    getStorageSync: () => "", setStorageSync() {}, showToast() {}, showModal(o) { cfg.__modal = o; },
    addPhoneCalendar(o) { o.success && o.success(); }, showActionSheet(o) { sheet.o = o; }
  };
  const ctx = {
    wx, console, Date, JSON, Number, String, Object, Array, Promise, Math, setTimeout,
    getApp: () => ({ globalData: { plan: { id: "P9", cityName: "西安", days: [{ date: future(2) }] } } }),
    Page: (o) => { cfg = o; }, module: { exports: {} }, exports: {},
    require(p) { return String(p).indexOf("remind") >= 0 ? R : {}; }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "plan.js" });
  const page = Object.assign({}, cfg);
  page.data = {};
  page.setData = () => {};
  cfg.onRemind.call(page);
  ok("弹出操作表", !!sheet.o);
  ok("第一项永远是加日历", sheet.o.itemList[0].indexOf("加入手机日历") >= 0);
  ok("未配置订阅 → 不出现订阅项", sheet.o.itemList.length === 1, JSON.stringify(sheet.o.itemList));
  sheet.o.success({ tapIndex: 0 });
  await new Promise((r) => setTimeout(r, 10));
  ok("选日历 → 写入本地队列", R.list().length === 1 && R.list()[0].via === "calendar");
  ok("记录带上 planId 与城市", R.list()[0].planId === "P9" && R.list()[0].city === "西安");
}

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + `：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
