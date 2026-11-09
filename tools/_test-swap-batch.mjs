#!/usr/bin/env node
/**
 * tools/_test-swap-batch.mjs —— v1.19.198「换一批」交互回归
 *
 * 背景：用户实测「行程增强」页「一键换景点」卡片的「换一批」按钮点了没反应。
 * 排查确认不是样式遮挡、也不是 bindtap 丢失，而是算法确定性：
 *   refreshAlts() 只重复调用 refresh() → _altsOf(plan, cn) → T.swapSpotFor(plan, first.name, cn)，
 *   而旧 swapSpotFor() 收集到 5 条同类候选即 break，固定参数永远返回同一批结果，
 *   界面数据没变化，用户自然感知为「点不动」。
 *
 * 修复：swapSpotFor(plan, spotName, cityName, offset, limit) 先收集全部同类候选，
 *   再按 start = (offset * limit) % all.length 轮转取批；boost 页维护 altPage 并给出 toast。
 *
 * 断言：
 *  1) 运行时：offset 0 / 1 两批在候选充足的城市必须不同（核心不变量，防回潮）
 *  2) 运行时：默认调用（省略 offset/limit）仍与旧版「取前 5 条」一致，旧调用方不受影响
 *  3) 运行时：批内无重复、字段完整、条数受 limit 约束
 *  4) 运行时：轮转若干批后能回到第一批，且空/脏参数不抛错
 *  5) 静态：boost 页已移除「一键换景点」（该卡只列候选、无法真正替换，用户反馈未实装）
 *  6) 静态：真源 swapSpotFor 仍保留 offset/limit 签名，三处版本一致
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const T = require("../utils/travel.js");
const D = require("../utils/data.js");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};
const sig = (list) => (list || []).map((x) => String(x && x.name)).join("|");

// ---------- 1~4. 运行时：真实数据上的分批轮转 ----------
const CITIES = ["北京", "苏州", "杭州", "西安", "成都", "大理", "桂林", "南京", "上海", "重庆"];
let diffCount = 0, covered = 0;
for (const city of CITIES) {
  const list = (D.SPOT_COORDS && D.SPOT_COORDS[city]) || [];
  const target = String((list[0] || [])[0] || "");
  if (!target || list.length < 12) continue;
  covered++;
  const plan = { cityName: city, days: [{ cityName: city, items: [{ name: target }] }] };
  const p0 = T.swapSpotFor(plan, target, city, 0, 4) || [];
  const p1 = T.swapSpotFor(plan, target, city, 1, 4) || [];
  ok(city + "：第一批非空且不超过 4 条", p0.length > 0 && p0.length <= 4, "实得 " + p0.length);
  ok(city + "：第二批非空且不超过 4 条", p1.length > 0 && p1.length <= 4, "实得 " + p1.length);
  if (sig(p0) !== sig(p1)) diffCount++;
  for (const [tag, batch] of [["第一批", p0], ["第二批", p1]]) {
    const names = (batch || []).map((x) => x && x.name);
    ok(city + "：" + tag + "批内无同名重复", new Set(names).size === names.length);
    ok(city + "：" + tag + "字段完整", (batch || []).every(
      (x) => x && typeof x.name === "string" && Array.isArray(x.tags) && typeof x.note === "string"));
  }
  // 默认调用 = 旧版「取前 5 条」，保证问答 / fuzz 等旧调用方行为不变
  const dflt = T.swapSpotFor(plan, target, city) || [];
  const five = T.swapSpotFor(plan, target, city, 0, 5) || [];
  ok(city + "：默认调用最多 5 条", dflt.length > 0 && dflt.length <= 5, "实得 " + dflt.length);
  ok(city + "：默认调用与 offset=0,limit=5 一致", sig(dflt) === sig(five));

  // 轮转一圈后应回到第一批（周期存在），且中途不抛错。
  // 周期 = 候选数 / gcd(limit, 候选数)，实测杭州 133 批、成都 95 批，故上限给到 400。
  let back = false;
  try {
    for (let off = 1; off <= 400; off++) {
      const b = T.swapSpotFor(plan, target, city, off, 4) || [];
      if (sig(b) === sig(p0)) { back = true; break; }
    }
  } catch (e) { back = false; }
  ok(city + "：批次轮转后能回到第一批", back);
}
ok("覆盖城市数 >= 8", covered >= 8, "实得 " + covered);
// 核心：候选充足的城市每一座都必须能换出不同的一批；只要有一座失败就说明轮转被回退
ok("所有覆盖城市第 1/2 批结果均不同（换一批真的会变）", diffCount === covered,
  diffCount + "/" + covered + " 座变化");

// 脏参数不崩
let robust = true;
try {
  const bad = [
    T.swapSpotFor(null, "", ""),
    T.swapSpotFor({}, "故宫", "北京"),
    T.swapSpotFor({ days: null }, "故宫", "北京", 1, 4),
    T.swapSpotFor({ cityName: "北京", days: [{ items: [] }] }, "", "", -3, 0)
  ];
  robust = bad.every((x) => Array.isArray(x));
} catch (e) { robust = false; }
ok("空 plan / 空名称 / 负 offset 均返回数组不抛错", robust);

// ---------- 5. 静态：boost 页已移除「一键换景点」（该卡只列候选、无法真正替换，用户反馈未实装）----------
const boostJs = read("subdata/boost/boost.js");
const boostWxml = read("subdata/boost/boost.wxml");
ok("boost.wxml 不再有「一键换景点」卡片", !boostWxml.includes("一键换景点"));
ok("boost.js 不再有 refreshAlts / _altsOf / altPage",
  !/refreshAlts\s*\(/.test(boostJs) && !/_altsOf\s*\(/.test(boostJs) && !/altPage/.test(boostJs));
ok("boost.wxml 不再绑定 alts / refreshAlts",
  !boostWxml.includes("{{alts}}") && !boostWxml.includes('bindtap="refreshAlts"'));
ok("boost.wxml 不再有「交通」估算卡", !boostWxml.includes("calcTrans"));
ok("boost.js 不再有 calcTrans / cityA / cityB",
  !/calcTrans\s*\(/.test(boostJs) && !/cityA/.test(boostJs) && !/cityB/.test(boostJs));

// ---------- 6. 静态：真源签名与三处版本一致 ----------
const src = read("tools/_src-backup/travel.js");
const out = read("utils/travel.js");
const ide = JSON.parse(read("project.config.json")).version;
ok("真源 swapSpotFor 保留 offset/limit 签名",
  /function swapSpotFor\(plan,\s*spotName,\s*cityName,\s*offset,\s*limit\)/.test(src));
ok("真源按 (offset * limit) % 候选数轮转", /\(\s*off\s*\*\s*lim\s*\)\s*%\s*all\.length/.test(src));
const ver = (s) => (s.match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
// 以 IDE 配置为期望值动态比对，避免每次升版都要改测试（v1.19.199 教训）
ok("真源 / 产物 / project.config.json 版本一致",
  !!ide && ver(src) === ide && ver(out) === ide,
  [ver(src), ver(out), ide].join(" / "));

console.log("  换一批分批回归: " + (n - fail) + "/" + n + " 通过（覆盖 " + covered + " 城，"
  + diffCount + " 城第 1/2 批不同）");
if (fail) process.exit(1);
console.log("  ✔ 换一批真的会变");
