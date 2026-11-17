#!/usr/bin/env node
// tools/test/_test-v11977-drag.mjs —— v1.19.77 行程页拖拽排序回归（vm 抽真实 handler 源码执行）
// 目的：① 位移/落位算法不错位 ② 时段属于「坑位」不被景点带走 ③ 框架行不可动
//      ④ 异常不破坏数据 ⑤ 量不准时不启动但必须给用户反馈（2026-11-17 补）
//
// 历史（勿再删）：本测试原读单文件 pages/plan/plan.js，靠 indexOf(" onDragStart") ~ indexOf(" onMove")
// 截取方法体。T4 拆分把 onDragStart/Move/End 搬到 pages/plan/p-edit.js 且 onMove 排在其前面，
// 截取区间反了 → 直接报「✗ 抽不到 handler 源码」，随后在「资源管理器轻量化」提交里被当作坏文件删除，
// 而 _test-plan-handlers.mjs 的注释仍写着「拖拽已另有本文件覆盖」→ 拖拽交互实际零覆盖且无人发现。
// 现改为 pageSrc()（页面 + 同目录 p-* 模块拼成一份源码，见 tools/lib/page-src.mjs）+ 逐方法抽取，
// 拆分后依旧有效。凡「按单文件正则抽取」的测试，拆分后必然失效，一律走 pageSrc()。
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { pageSrc } from "../lib/page-src.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_JS = path.join(__dirname, "..", "..", "pages", "plan", "plan.js");
const src = pageSrc(PLAN_JS);

// 逐方法抽取：从「\n <name>(...) {」起，到其后第一个 1 空格缩进的「\n },」止（p-edit.js 的模块对象成员缩进）。
// 不用「两个方法名之间」的区间截取 —— 方法顺序一变就整段失效（本文件被删的直接原因）。
function grab(name) {
  const re = new RegExp("\n " + name + "\\(([^)]*)\\)\\s*\\{");
  const m = re.exec(src);
  if (!m) throw new Error("method not found: " + name);
  const close = src.indexOf("\n },", m.index);
  if (close < 0) throw new Error("method body not closed: " + name);
  return src.slice(m.index + 1, close + 3).replace(re, "function(" + m[1] + ")");
}

const HANDLERS = ["onDragStart", "onDragMove", "onDragEnd"].map(grab).join(",");

/* ---- 桩 ---- */
let toast = [];
let notes = [];
let pendingExec = () => {};
const wx = {
  showToast: (o) => toast.push(o.title),
  vibrateShort: () => {},
  createSelectorQuery: () => ({ in: () => ({ selectAll: () => ({ boundingClientRect: () => ({}) }), exec: (cb) => pendingExec(cb) }) })
};
const EL = { note: (scope, err, extra) => { notes.push(scope + "|" + (typeof err === "string" ? err : "err") + "|" + (extra || "")); } };
const T = { normalizeDayItems: (arr) => { arr.__normalized = true; } };
const isFrame = (n) => /抵达|返程|出发|回程/.test(String(n || ""));
const app = { globalData: { plan: null } };
let saved = 0;

function makePage(view, plan) {
  app.globalData.plan = plan;
  const p = {
    _drag: null, _suppressTap: false, _dragHintAt: 0,
    data: { view, dragOn: false, dragDi: -1, dragI: -1, dragSh: [] },
    setData(o) { Object.assign(this.data, o); },
    _save() { saved++; }
  };
  const sandbox = { wx, EL, T, isFrame, app, console, setTimeout, Date, Math, Array, Number, String, Object };
  vm.createContext(sandbox);
  vm.runInContext("var page = this;", sandbox);
  vm.runInContext(`page.__h = {${HANDLERS}};`, sandbox);
  for (const k of Object.keys(sandbox.__h)) p[k] = sandbox.__h[k].bind(p);
  return p;
}

let pass = 0, bad = 0;
function ck(name, cond, extra) { if (cond) { pass++; console.log(`✔ ${name}`); } else { bad++; console.log(`✗ ${name}${extra ? " → " + extra : ""}`); } }
function rectsOf(n, top0) { const r = []; for (let i = 0; i < n; i++) r.push({ top: top0 + i * 110, height: 100 }); return r; }
function planOf(n) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ name: "景点" + i, period: ["上午", "上午", "下午", "下午", "晚上", "晚上"][i] || "下午" });
  return { days: [{ items }] };
}
function viewOf(plan) { return [{ items: plan.days[0].items.map((it, i) => ({ ix: i, f: isFrame(it.name), name: it.name, period: it.period })) }]; }

/* ---------- 用例 1：第 1 个往下拖到第 3 位 ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(5);
  const p = makePage(viewOf(plan), plan);
  const rects = rectsOf(5, 200);           // 中位：250 360 470 580 690
  pendingExec = (cb) => cb([rects]);

  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 250 }] });
  ck("用例1 · 拖拽已启动", p.data.dragOn === true && p.data.dragI === 0);

  p.onDragMove({ touches: [{ clientY: 490 }] });   // dy=240 → myMid 250→490
  ck("用例1 · 落位索引 = 2", p._drag.to === 2, "to=" + (p._drag && p._drag.to));
  ck("用例1 · 被拖条目位移 = 手指位移", (p.data.dragSh[0] || "").indexOf("translateY(240.0px)") >= 0, p.data.dragSh[0]);
  ck("用例1 · 让位条目上移 -110", p.data.dragSh[1] === "transform:translateY(-110.0px)" && p.data.dragSh[2] === "transform:translateY(-110.0px)", p.data.dragSh[1] + " / " + p.data.dragSh[2]);
  ck("用例1 · 未涉及条目不位移", p.data.dragSh[3] === "" && p.data.dragSh[4] === "", p.data.dragSh[3] + "/" + p.data.dragSh[4]);

  p.onDragEnd();
  const names = plan.days[0].items.map(x => x.name).join(",");
  ck("用例1 · 顺序 = 1,2,0,3,4", names === "景点1,景点2,景点0,景点3,景点4", names);
  const pers = plan.days[0].items.map(x => x.period).join(",");
  ck("用例1 · 时段仍在坑位上（不被景点带走）", pers === "上午,上午,下午,下午,晚上", pers);
  ck("用例1 · 已持久化 + 行文归一", saved === 1 && plan.days[0].items.__normalized === true);
  ck("用例1 · 状态已复位", p.data.dragOn === false && p.data.dragDi === -1 && p.data.dragSh.length === 0);
  ck("用例1 · 拖后屏蔽误触展开", p._suppressTap === true);
}

/* ---------- 用例 2：最后一条往上拖到首位 ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(4);
  const p = makePage(viewOf(plan), plan);
  const rects = rectsOf(4, 100);           // 中位：150 260 370 480
  pendingExec = (cb) => cb([rects]);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "3" } }, touches: [{ clientY: 480 }] });
  p.onDragMove({ touches: [{ clientY: 130 }] });   // dy=-350 → 480→130
  ck("用例2 · 落位索引 = 0", p._drag.to === 0, "to=" + (p._drag && p._drag.to));
  ck("用例2 · 让位条目下移 +110", p.data.dragSh[0] === "transform:translateY(110.0px)" && p.data.dragSh[2] === "transform:translateY(110.0px)", p.data.dragSh[0] + "/" + p.data.dragSh[2]);
  ck("用例2 · 被拖条目位移 = -350", (p.data.dragSh[3] || "").indexOf("translateY(-350.0px)") >= 0, p.data.dragSh[3]);
  p.onDragEnd();
  const names = plan.days[0].items.map(x => x.name).join(",");
  ck("用例2 · 顺序 = 3,0,1,2", names === "景点3,景点0,景点1,景点2", names);
}

/* ---------- 用例 3：多次 move 连续跟手（落位随手指回退） ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(5);
  const p = makePage(viewOf(plan), plan);
  const rects = rectsOf(5, 200);
  pendingExec = (cb) => cb([rects]);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 250 }] });
  p.onDragMove({ touches: [{ clientY: 490 }] });
  ck("用例3 · 拖到第 3 位", p._drag.to === 2, "to=" + (p._drag && p._drag.to));
  p.onDragMove({ touches: [{ clientY: 300 }] });   // 手指回退 → dy=50 → 落位回到 0
  ck("用例3 · 手指回退后落位同步回退", p._drag.to === 0, "to=" + (p._drag && p._drag.to));
  p.onDragEnd();
  ck("用例3 · 回退后不产生任何变更", saved === 0 && plan.days[0].items.map(x => x.name).join(",") === "景点0,景点1,景点2,景点3,景点4");
}

/* ---------- 用例 4：不动（纯点一下手柄）零变更 ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(3);
  const p = makePage(viewOf(plan), plan);
  pendingExec = (cb) => cb([rectsOf(3, 100)]);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "1" } }, touches: [{ clientY: 260 }] });
  p.onDragEnd();
  ck("用例4 · 未移动则零写入", saved === 0 && plan.days[0].items.map(x => x.name).join(",") === "景点0,景点1,景点2");
}

/* ---------- 用例 5：框架行（抵达/返程）不可拖、也不可被拖到 ---------- */
{
  toast = []; saved = 0;
  const plan = { days: [{ items: [{ name: "抵达西安", period: "上午" }, { name: "兵马俑", period: "上午" }, { name: "返程", period: "晚上" }] }] };
  const p = makePage(viewOf(plan), plan);
  pendingExec = (cb) => cb([rectsOf(3, 100)]);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  ck("用例5 · 抵达行拒绝拖动", p.data.dragOn === false && toast.join("").indexOf("不能调序") >= 0, toast.join("|"));

  toast = []; saved = 0;
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "1" } }, touches: [{ clientY: 260 }] });
  p.onDragMove({ touches: [{ clientY: 460 }] });   // dy=200 → 中位 260→460 > 370 → to=2（返程坑位）
  ck("用例5 · 落位确实指向框架坑位", p._drag.to === 2, "to=" + (p._drag && p._drag.to));
  p.onDragEnd();
  ck("用例5 · 拖到框架坑位被拒且数据不变", saved === 0 && plan.days[0].items.map(x => x.name).join(",") === "抵达西安,兵马俑,返程",
    plan.days[0].items.map(x => x.name).join(","));
}

/* ---------- 用例 6：量不准（条目数对不上）不启动，但要给用户反馈 + 留诊断 ----
   2026-11-17 测控 D-2：原实现 rects 条数不符直接 return，无提示无日志，
   用户只会觉得「按住拖没反应」。现在要求：① 不启动（防错位）② 提示一次可用路径 ③ 记一条诊断。 */
{
  toast = []; saved = 0; notes = [];
  const plan = planOf(3);
  const p = makePage(viewOf(plan), plan);
  pendingExec = (cb) => cb([[{ top: 10, height: 10 }]]);   // 只量到 1 条
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  ck("用例6 · 量不准不启动", p.data.dragOn === false && p._drag === null);
  ck("用例6 · 给了可见提示（指向 ↑↓ 替代路径）", toast.length === 1 && toast[0].indexOf("↑↓") >= 0, toast.join("|"));
  ck("用例6 · 留了诊断日志（scope=plan）", notes.length === 1 && notes[0].indexOf("plan|") === 0, notes.join(" / "));

  // 节流：3 秒内连按不重复弹提示（否则手指反复按会刷屏）
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  ck("用例6 · 3 秒内连按只提示一次", toast.length === 1, "toast=" + toast.length);
  // 超过 3 秒后再按应重新提示
  p._dragHintAt = Date.now() - 4000;
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  ck("用例6 · 超 3 秒后重新提示", toast.length === 2, "toast=" + toast.length);
}

/* ---------- 用例 7：脏事件（缺 clientY / 缺 touches）不崩溃，且 touchend 能收尾 ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(3);
  const p = makePage(viewOf(plan), plan);
  pendingExec = (cb) => cb([rectsOf(3, 100)]);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  p.onDragMove({ touches: [{}] });      // 缺 clientY
  p.onDragMove({});                     // 缺 touches
  ck("用例7 · 脏事件不崩溃、数据未变", saved === 0 && plan.days[0].items.map(x => x.name).join(",") === "景点0,景点1,景点2");
  p.onDragEnd();
  ck("用例7 · touchend 后状态完全复位", p.data.dragOn === false && p._drag === null && p.data.dragSh.length === 0);
}

/* ---------- 用例 8：plan 缺失 / 天越界 时不崩 ---------- */
{
  toast = []; saved = 0;
  const plan = planOf(3);
  const p = makePage(viewOf(plan), plan);
  pendingExec = (cb) => cb([rectsOf(3, 100)]);
  p.onDragStart({ currentTarget: { dataset: { di: "9", i: "0" } }, touches: [{ clientY: 150 }] });  // 天越界
  ck("用例8 · 天越界不启动", p.data.dragOn === false);
  p.onDragStart({ currentTarget: { dataset: { di: "0", i: "0" } }, touches: [{ clientY: 150 }] });
  p.onDragMove({ touches: [{ clientY: 400 }] });
  app.globalData.plan = null;           // 落位瞬间行程被清空
  let threw = false;
  try { p.onDragEnd(); } catch (e) { threw = true; }
  ck("用例8 · 落位时 plan 丢失也不抛错", !threw && p.data.dragOn === false);
}

console.log(`\n${pass} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
