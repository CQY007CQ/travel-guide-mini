#!/usr/bin/env node
/**
 * tools/test/_test-food-render.mjs —— v1.19.200 美食页「假空态」回归
 *
 * 背景：用户实机截图报障，行程页明明有「北京·4天3晚」攻略，美食页却显示「先去生成攻略」。
 * 根因链：
 *  ① subpkg/food/food.js 的 _renderCity() 在 sorted.map() 里裸调用 _repClass(s.rep)；
 *     而 _repClass 是 Page(SafePage({...})) 配置里的**对象方法简写**，不会在词法作用域
 *     创建同名绑定 → 只要本城有名店数据（北京 32 家）就必抛 ReferenceError。
 *  ② _renderShow() 外层 try/catch 把任何渲染异常都吞掉并 setData({hasPlan:false})，
 *     于是「渲染崩溃」被伪装成「没有攻略」，且没有任何提示可查。
 *
 * 断言：
 *  A. vm 跑真实 _renderCity（真实 FOOD_SPOTS 数据）不抛错、名店有数据、repKey 正确
 *  B. vm 跑真实 _renderShow：无 plan / 有 plan / 渲染抛错三分支行为正确
 *  C. 全仓静态扫描「页面对象方法被裸调用」为 0（防整个类别回潮）
 *  D. 静态护栏 + 版本一致性
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import vm from "vm";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const T = require("../../utils/travel.js");
const FM = require("../../subpkg/utils/food-map.js");
// v1.20.6：food.js 的坐标判定已抽到 subpkg/utils/coord.js。本单测用 vm 只执行「方法体」，
// 不会跑顶层 require，因此新模块依赖必须显式注入 ctx，否则方法里会抛 ReferenceError。
// 今后若 _renderCity / _renderShow 再引入新的顶层依赖，记得同步在下方两个 ctx 里注入。
const { hasCoord } = require("../../subpkg/utils/coord.js");

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

// 方法定义体 → 函数表达式（沿用项目既有 vm 沙盒约定）
const grab = (src, name) => {
  const re = new RegExp(name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(src);
  if (!m) throw new Error("method not found: " + name);
  const i = m.index;
  const j = src.indexOf("\n  },", i);
  if (j < 0) throw new Error("method body not closed: " + name);
  return src.slice(i, j + 4).replace(re, "function(" + m[1] + "){");
};

const FOOD = read("subpkg/food/food.js");
const fnCity = grab(FOOD, "_renderCity");
const fnRep = grab(FOOD, "_repClass");
const fnShow = grab(FOOD, "_renderShow");
const VMCORE = { console, Object, Array, Math, Number, String, Boolean, RegExp, JSON, Date };

async function main() {
  try { await T.ready(); } catch (e) {
    console.log("  ✗ FAIL: 数据就绪失败 " + (e && e.message)); process.exit(1);
  }

  // ---------- A. 真实数据渲染 ----------
  {
    const ctx = Object.assign({ T, FM, hasCoord }, VMCORE);
    vm.createContext(ctx);
    const rep = vm.runInContext("(" + fnRep + ")", ctx);
    let applied = 0, threw = null;
    const page = {
      data: {},
      setData(d) { Object.assign(this.data, d); },
      _apply() { applied++; },
      _repClass: rep
    };
    try { vm.runInContext("(" + fnCity + ")", ctx).call(page, "北京", "mid"); }
    catch (e) { threw = e; }
    ok("北京名店渲染不再抛 ReferenceError", !threw, threw && (threw.name + ": " + threw.message));
    ok("名店列表有数据（北京 32 家）", !!page._allShops && page._allShops.length > 0,
      "实得 " + (page._allShops || []).length);
    ok("每条名店 repKey 均为字符串（this._repClass 生效）",
      !!page._allShops && page._allShops.every(s => typeof s.repKey === "string"));
    ok("名店副标题无多余分隔点", !!page._allShops && page._allShops.every(s => !/^\s*·/.test(s.sub || "")));
    ok("setData 写入城市名", page.data.cityName === "北京");
    ok("_apply 被调用一次", applied === 1);
    ok("_repClass 口碑映射正确",
      rep("老字号") === "old" && rep("本地人常去") === "local"
      && rep("游客打卡") === "tourist" && rep("市井烟火") === "street"
      && rep("宴请名店") === "fine" && rep("未知") === "");
  }

  // ---------- B. _renderShow 三分支 ----------
  const runShow = (opt = {}) => {
    const state = { toasts: [], logs: [], theme: 0, cityCalls: [], sets: [] };
    const plan = opt.plan === "none" ? null : (opt.plan || { cityName: "北京", days: [{}, {}, {}, {}], budget: "mid" });
    // VMCORE 先铺底，自定义 mock 后写，否则真实 console 会覆盖捕获用的 mock
    const ctx = Object.assign({}, VMCORE, {
      hasCoord,
      app: { globalData: { plan } },
      T: {
        citiesOf: () => [{ name: "太原" }, { name: "大同" }],
        activeCityOf: () => "太原",
        themeMode: () => "light",
        fontScale: () => 1,
        applyNav: () => {}
      },
      console: { error: (...a) => state.logs.push(a.map(String).join(" ")) },
      EL: { push: (label) => state.logs.push(label) },
      wx: { showToast: (o) => state.toasts.push(o && o.title) },
      setTimeout: (fn) => { fn(); return 0; }
    });
    vm.createContext(ctx);
    const page = {
      data: { hasPlan: false },
      setData(d) { Object.assign(this.data, d); state.sets.push(d); },
      _theme() { state.theme++; },
      _renderCity(city, budget) {
        state.cityCalls.push([city, budget]);
        if (opt.cityFail) throw new Error("renderCity boom");
      }
    };
    vm.runInContext("(" + fnShow + ")", ctx).call(page);
    return { state, page };
  };

  {
    const r = runShow({ plan: "none" });
    ok("无攻略：hasPlan=false（真空态）", r.page.data.hasPlan === false);
    ok("无攻略：不弹错误提示、不渲染城市", r.state.toasts.length === 0 && r.state.cityCalls.length === 0);
  }
  {
    const r = runShow();
    ok("有攻略：hasPlan=true", r.page.data.hasPlan === true);
    ok("有攻略：按城市渲染（北京 / mid）",
      r.state.cityCalls.length === 1 && r.state.cityCalls[0][0] === "北京" && r.state.cityCalls[0][1] === "mid",
      JSON.stringify(r.state.cityCalls));
    ok("有攻略：无错误提示", r.state.toasts.length === 0);
  }
  {
    const r = runShow({ cityFail: true });
    ok("渲染抛错：不再伪装成「先去生成攻略」（hasPlan 仍为 true）", r.page.data.hasPlan === true);
    ok("渲染抛错：给可见 toast「加载失败」",
      r.state.toasts.some(t => /加载失败/.test(t || "")), JSON.stringify(r.state.toasts));
    ok("渲染抛错：写 errlog 可回溯", r.state.logs.some(x => /food\._renderShow/.test(x)));
    ok("渲染抛错：console.error 留痕", r.state.logs.some(x => /渲染失败/.test(x)));
  }
  {
    const r = runShow({ plan: { isProv: true, province: "山西", cityName: "", days: [{}], budget: "mid" } });
    ok("省域行程：不再被判成空态，按首站城市渲染",
      r.page.data.hasPlan === true && r.state.cityCalls.length === 1 && r.state.cityCalls[0][0] === "太原",
      JSON.stringify(r.state.cityCalls));
  }

  // ---------- C. 全仓静态扫描：页面对象方法不得被裸调用 ----------
  const KW = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else",
    "do", "try", "typeof", "new", "delete", "void", "in", "of", "with", "throw", "case",
    "default", "await", "yield", "instanceof", "const", "let", "var"]);
  const files = [];
  const walk = (rel) => {
    const full = path.join(ROOT, rel);
    for (const name of readdirSync(full)) {
      const p = path.join(rel, name), fp = path.join(ROOT, p);
      if (statSync(fp).isDirectory()) walk(p);
      else if (name.endsWith(".js")) files.push(p);
    }
  };
  for (const d of ["pages", "subpkg", "subai", "subdata"]) walk(d);
  const hits = [];
  for (const f of files) {
    const s = read(f);
    const lines = s.split("\n");
    const names = new Set();
    for (const m of s.matchAll(/^  ([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
      if (!KW.has(m[1])) names.add(m[1]);
    }
    for (const nm of names) {
      const re = new RegExp("(?<![\\w$.])" + nm.replace(/[$]/g, "\\$") + "\\s*\\(", "g");
      for (const m of s.matchAll(re)) {
        const ln = s.slice(0, m.index).split("\n").length - 1;
        const text = (lines[ln] || "").trim();
        if (new RegExp("^" + nm.replace(/[$]/g, "\\$") + "\\s*\\(").test(text)) continue; // 定义行
        if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue;
        hits.push(f + ":" + (ln + 1) + " " + nm);
      }
    }
  }
  ok("全仓 " + files.length + " 个页面 JS 无「对象方法裸调用」", hits.length === 0, hits.join("; "));

  // ---------- D. 静态护栏 ----------
  ok("food.js 用 this._repClass 而非裸调用", FOOD.includes("repKey: this._repClass(s.rep)"));
  ok("_renderShow 用 entered 区分「无行程」与「渲染失败」", fnShow.includes("entered"));
  ok("_renderShow 失败时保留 hasPlan:true", /if \(entered\)[\s\S]*hasPlan:\s*true/.test(fnShow));
  ok("map / prep 同类静默 catch 已加留痕",
    read("subpkg/map/map.js").includes('EL.push("map._renderShow"')
    && read("subpkg/prep/prep.js").includes('EL.push("prep._renderShow"'));
  ok("美食页空态文案仍在（未误改 UI）", read("subpkg/food/food.wxml").includes("先去生成攻略"));

  const ver = (s) => (s.match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
  const cfgVer = JSON.parse(read("project.config.json")).version;
  const srcVer = ver(read("tools/_src-backup/travel.js"));
  const outVer = ver(read("utils/travel.js"));
  ok("真源 / 产物 / project.config.json 版本一致",
    !!cfgVer && srcVer === cfgVer && outVer === cfgVer,
    [srcVer, outVer, cfgVer].join(" / "));

  console.log("  美食页渲染回归: " + (n - fail) + "/" + n + " 通过");
  if (fail) process.exit(1);
  console.log("  ✔ 假空态与作用域异常均已固化为护栏");
}

main().catch((e) => { console.error(e); process.exit(1); });
