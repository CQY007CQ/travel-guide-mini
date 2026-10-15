#!/usr/bin/env node
// tools/_test-v11989-sharetitle.mjs —— v1.19.89「分享即种草 + 行后种草」vm 单测
// 覆盖：index/today 的 onShareAppMessage 动态种草标题（真实 dailyInspire 数据）、
// 异常/无行程回退路径、today 行中场景保留功能文案、after 分支行后种草接线、WXML 结构。
import { readFileSync } from "fs";
import { createRequire } from "module";
import vm from "vm";
const require = createRequire(import.meta.url);
const T = require("../utils/travel.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name + (extra ? "  " + extra : ""));
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  " + extra : "")); }
};
const grab = (file, name) => {
  const s = readFileSync(file, "utf8");
  const re = new RegExp(name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(s);
  if (!m) throw new Error("method not found: " + name);
  const i = m.index;
  const j = s.indexOf("\n  },", i);
  return s.slice(i, j + 4).replace(re, "function(" + m[1] + "){");
};

// ---------- 1. index.onShareAppMessage：真实数据种草标题 ----------
{
  const src = grab("pages/index/index.js", "onShareAppMessage");
  const ctx = { T: T, Date, Math };
  vm.createContext(ctx);
  const page = { __shareImg: null };
  const ret = vm.runInContext("(" + src + ")", ctx).call(page);
  const today = T.dailyInspire(1);
  const m = new Date().getMonth() + 1;
  ok("index：种草标题含「N月的」+「正当时」", ret.title.indexOf(m + "月的") >= 0 && ret.title.indexOf("正当时") >= 0, ret.title);
  ok("index：标题含今日城市名（确定性=对方打开看到同一座）", today.length && ret.title.indexOf(today[0].name) >= 0);
  ok("index：标题 == shareTitle（单一逻辑源直连）", today.length === 1 && ret.title === today[0].shareTitle);
  ok("index：标题 ≤ 32 字（微信卡片最佳长度）", ret.title.length <= 32, "len=" + ret.title.length);
  ok("index：path 落首页（灵感卡所在地）", ret.path === "/pages/index/index");

  // 回退：dailyInspire 抛错 → 原功能文案
  const ctx2 = { T: { D: { CITIES: { length: 751 } }, dailyInspire() { throw new Error("not ready"); } }, Date, Math };
  vm.createContext(ctx2);
  const ret2 = vm.runInContext("(" + src + ")", ctx2).call({});
  ok("index：数据未就绪回退原文案（不崩）", ret2.title.indexOf("旅行攻略生成器") >= 0 && ret2.title.indexOf("751") >= 0, ret2.title);
}

// ---------- 2. today.onShareAppMessage：无行程种草 / 行中功能 ----------
{
  const src = grab("pages/today/today.js", "onShareAppMessage");
  // 无行程 → 种草
  const ctx = { T: T, getApp: () => ({ globalData: { plan: null } }), Date, Math };
  vm.createContext(ctx);
  const ret = vm.runInContext("(" + src + ")", ctx).call({});
  const today = T.dailyInspire(1);
  const m = new Date().getMonth() + 1;
  ok("today 无行程：种草标题", ret.title.indexOf(m + "月的") >= 0 && (!today.length || ret.title === today[0].shareTitle), ret.title);
  ok("today 无行程：标题 ≤ 32 字", ret.title.length <= 32, "len=" + ret.title.length);

  // 行中（有行程）→ 原功能文案
  const ctx2 = { T: T, getApp: () => ({ globalData: { plan: { cityName: "太原", days: [{ items: [] }] } } }), Date, Math };
  vm.createContext(ctx2);
  const ret2 = vm.runInContext("(" + src + ")", ctx2).call({});
  ok("today 行中：保留功能文案（给同伴看安排的场景）", ret2.title.indexOf("旅行途中神器") >= 0, ret2.title);
}

// ---------- 3. 行后种草接线（refresh after 分支 + WXML） ----------
{
  const js = readFileSync("pages/today/today.js", "utf8");
  const iAfter = js.indexOf("out.daysSince = st.daysSince;");
  const seg = js.slice(iAfter, js.indexOf("this.setData({ hasPlan: true", iAfter));
  ok("today refresh：after 分支调用 dailyInspire（行后种草）", seg.indexOf("dailyInspire") >= 0);

  const wxml = readFileSync("pages/today/today.wxml", "utf8");
  // 注意：after 块内有嵌套 <block>（totalMoney），不能按第一个 </block> 截取，改全文件断言
  const tapCount = (wxml.match(/bindtap="onInspTap"/g) || []).length;
  ok("WXML：after 块含「下一程」灵感卡（行后种草）", wxml.indexOf("下一程 · 今日正当时") >= 0);
  ok("WXML：灵感卡绑定 onInspTap 共 2 处（空态 + 行后）+ wx:if insp", tapCount === 2 && wxml.indexOf("{{insp.length}}") >= 0, "taps=" + tapCount);
  const o = (wxml.match(/\{\{/g) || []).length, c = (wxml.match(/\}\}/g) || []).length;
  ok("WXML：mustache 全平衡（防 74:1 上传炸）", o === c, o + "/" + c);

  // shareTitle 数据层口径：真实数据下 12 个月全部 ≤32 字且格式正确
  let tOk = true; const tBad = [];
  for (let mo = 1; mo <= 12; mo++) {
    for (const d of [1, 15, 28]) {
      const r = T.dailyInspire(1, new Date(2026, mo - 1, d));
      if (!r.length) { tOk = false; tBad.push(mo + "/" + d + " 空"); continue; }
      const t = r[0].shareTitle;
      if (!(t && t.length <= 32 && t.indexOf("正当时：") >= 0 && t.indexOf("离线攻略") >= 0)) { tOk = false; tBad.push(mo + "/" + d + " " + t); }
    }
  }
  ok("shareTitle：12 个月 × 3 日期全格式正确且 ≤32 字", tOk, tBad.slice(0, 3).join(" ") || "全通过");
}

console.log(fail ? "\n❌ " + fail + " 项失败" : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
