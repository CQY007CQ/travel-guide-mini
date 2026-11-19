#!/usr/bin/env node
/**
 * tools/test/_test-pick-perf.mjs —— v1.20.12 城市选择器性能回归
 *
 * 修的是什么（先量后改，实测数据）：
 *   · 全站 751 城，选择器「全部」视图一次 setData 全量列表 ≈ 35KB，且要渲染 751 行；
 *   · 旧 `_allCities()` 无缓存，每敲一个字都重建 751 个对象再 filter 再 setData —— 三重开销；
 *   · 同文件的 `onPickKw2`（想玩池）早在 v1.19.2 就加了 180ms 防抖，`onPickKw` 漏了。
 *
 * 断言（都是行为断言，不是「源码里有某串字」）：
 *   ① 连打 N 个字，只触发 1 次过滤：中间 setData 只回显 pickKw，不碰 pickList
 *   ② 关键词立即回显（打字手感不变，防抖不吞输入）
 *   ③ 每次输入都取消上一次挂起的定时器（防抖真的在防，不是排队）
 *   ④ 列表上限 300；pickMore = 命中数 − 已下发数
 *   ⑤ 截断不改变顺序与内容（前 300 条与全量前 300 条逐项相同 → chooseFromPicker 的下标仍对）
 *   ⑥ `_allCities()` 命中缓存（第二次调用返回同一引用）
 *   ⑦ 关键词过滤在防抖之后仍然生效（不是把过滤丢了）
 *
 * 用法：node tools/test/_test-pick-perf.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
process.chdir(ROOT);

const require2 = createRequire(import.meta.url);
const T = require2("../../utils/travel.js");
const M_FORM = require2("../../pages/index/m-form.js");
const M_CONFIG = require2("../../pages/index/m-config.js");
const M_GEN = require2("../../pages/index/m-generate.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

/* ── 假定时器：接管 setTimeout/clearTimeout，手动 flush ── */
const timers = new Map();
let tid = 1;
const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
const installFakeTimers = () => {
  timers.clear();
  globalThis.setTimeout = (fn, ms) => { const id = tid++; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
};
const restoreTimers = () => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; };
const flushTimers = () => {
  const pending = [...timers.values()];
  timers.clear();
  pending.forEach((t) => t.fn());
};

/** 造一个假页面实例：方法按真实运行时的 Object.assign 合并（否则 this._pickSrc 取不到） */
function fakePage(data) {
  const calls = [];
  const page = Object.assign(
    {},
    M_GEN, M_CONFIG, M_FORM,
    {
      data: Object.assign({ pickMode: "dest", pickProv: "", pickKw: "", pickList: [], pickMore: 0, fromList: [], provinces: [] }, data || {}),
      setData(obj) { calls.push(obj); Object.assign(this.data, obj); },
      calls,
    }
  );
  page.calls = calls;
  return page;
}

await T.ready();

console.log("== 城市选择器性能与正确性 ==");

/* ── ⑥ 城市表缓存 ── */
{
  const page = fakePage();
  const a = M_GEN._allCities.call(page);
  const b = M_GEN._allCities.call(page);
  ok("城市表非空（数据已就绪）", a.length > 300, "len=" + a.length);
  ok("第二次调用命中缓存（返回同一引用）", a === b);
  ok("缓存写入后页面持有它", page._allCitiesCache === a);
}

/* ── ①②③ 防抖：连打 5 个字只过滤一次，关键词每次立即回显 ── */
{
  const page = fakePage();
  installFakeTimers();
  const chars = ["北", "北京", "北京市", "北京 故", "北京 故宫"];
  for (const kw of chars) M_FORM.onPickKw.call(page, { detail: { value: kw } });

  const listWritesDuringTyping = page.calls.filter((c) => "pickList" in c).length;
  const kwEchoes = page.calls.filter((c) => "pickKw" in c).length;
  ok("连打 5 字期间不写 pickList（过滤被防抖挡住）", listWritesDuringTyping === 0, "写了 " + listWritesDuringTyping + " 次");
  ok("关键词每次都立即回显（打字手感不变）", kwEchoes === chars.length, kwEchoes + "/" + chars.length);
  ok("挂起的定时器只有 1 个（前面的都被取消）", timers.size === 1, "实际 " + timers.size);

  flushTimers();
  const listWritesAfter = page.calls.filter((c) => "pickList" in c).length;
  ok("flush 后正好过滤 1 次", listWritesAfter === 1, "实际 " + listWritesAfter);
  restoreTimers();

  /* ── ⑦ 过滤仍然生效：最后一个关键词是「北京 故宫」，匹配必为 0 或很少 ── */
  const kwed = page.data.pickList;
  ok("防抖后仍按最后关键词过滤（不是把过滤丢了）",
    kwed.length < 50 && kwed.every((x) => x.name.includes("北京 故宫") || String(x.province).includes("北京 故宫")),
    "len=" + kwed.length);
}

/* ── ④⑤ 渲染窗口上限与下标一致性 ── */
{
  const page = fakePage({ pickKw: "" });
  const src = M_GEN._allCities.call(page);
  M_CONFIG._applyPickList.call(page, src);
  ok("全部省份视图总量 > 300（确有截断必要）", src.length > 300, "len=" + src.length);
  ok("pickList 上限 300", page.data.pickList.length === 300, "len=" + page.data.pickList.length);
  ok("pickMore = 命中数 − 下发数", page.data.pickMore === src.length - 300,
    "pickMore=" + page.data.pickMore + " 期望=" + (src.length - 300));
  const same = page.data.pickList.every((x, i) => x.name === src[i].name && x.province === src[i].province);
  ok("截断不改变顺序（chooseFromPicker 的下标仍指向同一城市）", same);

  // 关键词收敛到上限以内时，pickMore 必须归零，提示行要消失
  const one = src[0].name.slice(0, 1);
  const p2 = fakePage({ pickKw: one });
  M_CONFIG._applyPickList.call(p2, src);
  const matched = src.filter((x) => x.name.includes(one) || String(x.province).includes(one)).length;
  ok("关键词命中数 ≤300 时 pickMore=0（提示行不出现）",
    matched > 300 ? p2.data.pickMore === matched - 300 : p2.data.pickMore === 0,
    "matched=" + matched + " pickMore=" + p2.data.pickMore);
}

/* ── 切省份要取消挂起的输入定时器（否则 180ms 后用旧关键词覆盖） ── */
{
  const page = fakePage();
  installFakeTimers();
  M_FORM.onPickKw.call(page, { detail: { value: "北京" } });
  ok("输入后有 1 个挂起定时器", timers.size === 1);
  const prov = T.provinces()[0] || "";
  M_FORM.onPickProv.call(page, { currentTarget: { dataset: { p: prov } } });
  ok("切省份取消了挂起的输入定时器", timers.size === 0, "剩 " + timers.size);
  ok("切省份后关键词被清空", page.data.pickKw === "");
  restoreTimers();
}

console.log("\n" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
