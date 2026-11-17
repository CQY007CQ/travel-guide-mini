#!/usr/bin/env node
/**
 * tools/check/check-observability.mjs —— 「静默失败」可观测性门禁（v1.20.8 / T1）
 *
 * 要解决的问题（T1 原文）：
 *   全仓 300+ 处 `catch{}` 里，有一批落在「用户能感知到失败」的链路上（AI、云同步、
 *   天气、地图、存储、支付）。这些地方失败后既不报错、也不改界面、也不留任何记录 ——
 *   用户只看到「点了没反应」，开发侧连「到底是不是走了降级分支」都无从判断。
 *   验收标准：关键外部依赖不可用时，**要么正常、要么留下可检索痕迹**，禁止两者都不是。
 *
 * 这条门禁怎么判「要么正常、要么有痕迹」：
 *   ① 有统一出口：utils/errlog.js 暴露 note()/noteStats()，带去重与有界缓冲
 *      （不允许各页面自己 console.warn 一套格式，那样没法检索也没法断言）。
 *   ② 契约模块零裸空 catch：外部依赖层（cloud/store/weather/map/lens/errlog）里
 *      不允许出现「既不 note()、又没有一行说明」的 catch。
 *   ③ 关键降级点逐个点名：AI 回落、云不可用、天气接口错、地图上下文、存储写失败…
 *      每处都必须在源码里能搜到 note(...)，避免「有人把痕迹删掉」而门禁不知道。
 *   ④ 全仓空 catch 棘轮：总数只能降不能升。新增静默吞失败会立刻判红。
 *   ⑤ 运行时行为：note() 去重、计数正确、传入循环对象/undefined 也不抛错
 *      （它自己就在 catch 里跑，抛错等于把降级变成崩溃）。
 *
 * 不接入 allcheck.sh 的新 step：串在既有「审计整改 + AI 全场景守卫」step 里一起跑，
 * 保持 61 步口径不变（加减步会连带触发考核材料校验失败）。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const req = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : "")); }
}

/* 注释先滤掉再匹配：本仓已有先例 —— 不滤注释时，文档/注释里出现 `catch (e) {}`
   会被当成真代码，导致门禁对着一行说明文字报红。 */
// 判定「静默吞掉」必须精确到注释边界，不能用「先删注释再匹配」的粗活：
//   · 文档注释里常出现 `catch (e) {}` 的示例文字（本文件自己也这么写）—— 那不是代码，不能算；
//   · 反过来，行内 `catch (e) { /* 理由 */ }` 里的说明正是「剩余每处带一行说明」的载体 ——
//     如果先把块注释删掉，这条会被误判成静默。
// 所以这里做一次轻量扫描：先算出注释区间，再只统计「起点不在注释里、且花括号内除空格外什么都没有」的 catch。
// 顺带跳过字符串字面量（本项目有大量文案里带 // 与 /*，按行截断会把整行代码误伤）。
function commentRanges(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { const st = i; while (i < src.length && src[i] !== "\n") i++; out.push([st, i]); continue; }
    if (c === "/" && src[i + 1] === "*") { const st = i; i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; out.push([st, i]); continue; }
    i++;
  }
  return out;
}
// 返回「裸空 catch」所在行号数组
function bareEmptyLines(src) {
  const ranges = commentRanges(src);
  const lines = [];
  for (const m of src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g)) {
    if ((m[1] || "").trim() !== "") continue;
    const pos = m.index;
    if (ranges.some(([a, b]) => pos >= a && pos < b)) continue;
    lines.push(src.slice(0, pos).split("\n").length);
  }
  return lines;
}

/* ───────── ① 统一痕迹出口 ───────── */
console.log("【痕迹出口】");
const errlog = read("utils/errlog.js");
ok("utils/errlog.js 提供 note()", /function note\(/.test(errlog) && /module\.exports\s*=\s*\{[^}]*\bnote\b/.test(errlog));
ok("utils/errlog.js 提供 noteStats()", /function noteStats\(/.test(errlog) && /module\.exports\s*=\s*\{[^}]*noteStats/.test(errlog));
ok("note() 带去重（同一 scope+消息只落一条）", /_seen\[key\]/.test(errlog) && /\.n\+\+/.test(errlog));
// 这里只断言「有上限常量」；真正的「写超了会被裁掉」改在 ⑤b 里真跑验证。
// 原先还断言 /while \(list\.length > CAP\)/ —— 那是把内部变量名当契约，改个变量名就假红，
// 而变量名对了也不代表裁剪真的生效（同类的「断言字面量而非行为」问题本轮已踩两次）。
ok("errlog 缓冲有上限（不会无界增长）", /const CAP\s*=\s*\d+/.test(errlog));
ok("note() 自身吞掉内部异常（不把降级变成崩溃）", /catch \(e3\) \{ return 0; \}/.test(errlog));
ok("没有第二套痕迹模块（禁止 diag.js 这类重复实现）", !fs.existsSync(path.join(ROOT, "utils/diag.js")));

/* ───────── ② 契约模块零裸空 catch ───────── */
console.log("【契约模块（外部依赖层）】");
// 手写文件直接读；build-min 产物要读真源（压缩会把注释与说明全删掉）
// 接入层（外部依赖的真正落点）：不允许任何裸空 catch —— 这里每吞一次失败，
//   用户就会觉得「AI/天气/存储坏了但没人知道」。build-min 产物要读真源（压缩会把说明全删）。
const CONTRACT_STRICT = [
  ["utils/cloud.js", "utils/cloud.js"],
  ["utils/errlog.js", "utils/errlog.js"],
  ["utils/store.js", "tools/_src-backup/store.js"],
  ["utils/weather.js", "tools/_src-backup/weather.js"],
];
// 页面层：catch 数量大且多为可选能力探测（如 wx.xxx 存在性），
//   不要求逐个清零，只要求「已接入统一痕迹出口 + 关键降级点留痕（见 ③）」。
const CONTRACT_WIRED = [
  ["subpkg/map/map.js", "subpkg/map/map.js"],
  ["subpkg/lens/lens.js", "subpkg/lens/lens.js"],
  ["pages/index/index.js", "pages/index/index.js"],
];

for (const [label, file] of CONTRACT_STRICT) {
  const bare = bareEmptyLines(read(file));
  ok(label + "：无裸空 catch（要么留痕、要么一行说明）", bare.length === 0,
    bare.length ? "行 " + bare.join(",") : "");
}
for (const [label, file] of CONTRACT_STRICT.concat(CONTRACT_WIRED)) {
  if (label === "utils/errlog.js") continue; // 出口自身不需要引用自己
  ok(label + "：已接入 errlog.note", /errlog\.js|EL\.note\(|_note\(/.test(read(file)));
}

/* ───────── ③ 关键降级点逐个点名（防「痕迹被删掉」） ───────── */
console.log("【关键降级点留痕】");
const POINTS = [
  ["云开发 init 失败 → 云同步/云端 AI 整体降级", "utils/cloud.js", /云开发 init 失败/],
  ["云函数调用失败（同步/云端 AI 的直接失败点）", "utils/cloud.js", /云函数调用失败/],
  ["whoami 失败 → 回落本地 uid（跨端行程对不上）", "utils/cloud.js", /whoami 失败/],
  ["本地 uid 读写失败 → 匿名兜底", "utils/cloud.js", /匿名 uid/],
  ["云端 AI 不可用 → 回落离线引擎", "utils/cloud.js", /云端回答不可用/],
  ["云端识图不可用", "utils/cloud.js", /云端识图不可用/],
  ["图片上传失败（识物降级为纯文字）", "utils/cloud.js", /图片上传失败/],
  ["AI 上下文单维缺失（grounding 降级）", "utils/cloud.js", /上下文·预算维度缺失/],
  ["存储写入失败（配额满）", "tools/_src-backup/store.js", /写入失败（可能配额已满）/],
  ["存储读取失败", "tools/_src-backup/store.js", /读取失败: /],
  ["存储删除失败", "tools/_src-backup/store.js", /删除失败: /],
  ["天气接口错误码（Key/配额/参数）", "tools/_src-backup/weather.js", /接口错误: /],
  ["天气响应解析失败", "tools/_src-backup/weather.js", /响应解析失败/],
  ["天气重试耗尽", "tools/_src-backup/weather.js", /重试/],
  ["地图上下文创建失败（定位/视野联动失效）", "subpkg/map/map.js", /地图上下文创建失败/],
  ["相机/选图打不开", "subpkg/lens/lens.js", /相机\/选图打开失败/],
  ["首页初始化降级", "pages/index/index.js", /首页初始化降级/],
  // v1.20.13：AI 记忆/上下文链路的静默失败补留痕（原先只剩 1 条余量，等于逼着后来者继续吞）
  ["AI 会话记忆读取失败（多轮上下文按空继续）", "utils/ai-agent.js", /会话记忆读取失败/],
  ["AI 会话记忆落盘失败（冷启动后跨页衔接失效）", "utils/ai-agent.js", /记忆\/时效基准落盘失败/],
  ["AI 记入会话失败（本轮回答不写回上下文）", "utils/ai-agent.js", /记入会话记忆失败/],
  ["AI 清空会话失败（用户以为已清）", "utils/ai-agent.js", /清空会话失败/],
  ["离线大脑会话快照读取失败", "subpkg/assistant/ai-brain.js", /会话快照读取失败/],
  ["离线大脑会话快照落盘失败", "subpkg/assistant/ai-brain.js", /会话快照落盘失败/],
  ["AI grounding 取名失败（易诱发泛话/臆造）", "subpkg/assistant/ai-context.js", /取真实店名\/景点名失败/],
];
const lost = POINTS.filter(([, file, re]) => !re.test(read(file))).map(([n]) => n);
ok(POINTS.length + " 个关键降级点全部留痕", lost.length === 0, lost.slice(0, 5).join(" ; "));

/* ───────── ④ 全仓空 catch 棘轮：只降不升 ───────── */
console.log("【静默失败棘轮】");
// 基线 = v1.20.8 完成 T1 插桩后的实测值（同口径：滤注释、只统计体为空的 catch）。
// 只能往下改；新增静默吞失败会立即超过基线而判红。
// v1.20.13：把 AI 记忆/上下文链路 7 处静默吞失败改成 errlog 留痕，实测 395 → 388，基线随之下调。
const BASELINE = 388;
const SKIP = new Set(["node_modules", ".git", "web", "tools", "docs", "shots", ".qr", ".cloudbase"]);
const SKIP_FILE = /data-packed|team-food3|modules\.js|tpl\.js/;
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
let emptyCount = 0;
for (const abs of walk(ROOT)) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
  if (SKIP_FILE.test(rel)) continue;
  emptyCount += bareEmptyLines(fs.readFileSync(abs, "utf8")).length;
}
ok("全仓空 catch 不高于基线 " + BASELINE + "（实测 " + emptyCount + "）", emptyCount <= BASELINE);

/* ───────── ⑤ 运行时行为：note 去重 / 不抛错 / 统计正确 ───────── */
console.log("【运行时行为】");
const EL = req(path.join(ROOT, "utils/errlog.js"));
ok("note() 在 Node 环境（无 wx）也不抛错", (() => {
  try { EL.note("selftest", new Error("boom"), "自检"); return true; } catch (e) { return false; }
})());
const beforeKinds = EL.noteStats().kinds;
EL.note("selftest2", "同一个错误", "第一次");
EL.note("selftest2", "同一个错误", "第二次（应被去重合并）");
const st = EL.noteStats();
// 去重的判据是「种类只多 1」，而 total 会累加次数 —— 这正是不刷屏又能看出反复失败的设计。
ok("同 scope+同消息只落一条（种类 +1、次数累加）", st.kinds === beforeKinds + 1,
  "kinds " + beforeKinds + "→" + st.kinds + " / total " + st.total);
ok("noteStats() 能按 scope 归类", typeof st.byScope === "object" && Object.keys(st.byScope).length > 0);
ok("传入 undefined / 循环引用对象都不抛错", (() => {
  try {
    EL.note("selftest3", undefined);
    const cyc = {}; cyc.self = cyc;
    EL.note("selftest3", cyc);
    return true;
  } catch (e) { return false; }
})());
ok("noteStats 三字段齐全", "total" in st && "kinds" in st && "byScope" in st);

/* ───────── ⑤b 存储失败诊断：必须「带操作与键名」，且不被存储写失败反噬 ─────────
 * 2026-11-17 实测到的真漏洞：store.js 的 _note 被调成 `_note("store", e, "写入失败: " + k)`，
 * 三实参对两形参 → 多出的 "store" 被当成消息，落盘内容恒为 `store · Error: ...`，
 * 真正的「操作类型 + 键名」被第三个实参吞掉；去重键退化成 `store|store`，
 * 读/写/删/JSON 解析四类失败共用一桶，只有第一条能落盘。
 *
 * 本文件此前的 ③ 只断言「源码里存在 写入失败（可能配额已满） 这串字」——字符串在，
 * 不代表消息到得了读者手里，于是这个漏洞一路绿灯。所以这里改成**真跑一遍**：
 * 模拟 setStorageSync 全失败，断言 recent() 里能读出「哪个键、哪种操作」。
 * 顺带覆盖同源第二个坑：存储写不进去时 errlog 自己也在写盘，没有内存兜底的话
 * 最需要日志的时刻 recent() 恒为空（日志被自己吞掉）。
 */
console.log("【存储失败诊断（真跑）】");
const { installWxShim } = await import(new URL("../test/_wx-shim.mjs", import.meta.url));
installWxShim({ failOn: "set" });          // 任何 setStorageSync 都抛「配额满」
const STORE_P = path.join(ROOT, "utils/store.js");
const EL_P = path.join(ROOT, "utils/errlog.js");
const _drop = (p) => { try { delete req.cache[req.resolve(p)]; } catch (e) { /* 未加载过则忽略 */ } };
_drop(STORE_P); _drop(EL_P);               // 丢掉上面 ⑤ 用过的实例（_seen/_mem 是模块级状态）
const S2 = req(STORE_P);
const EL2 = req(EL_P);
let setOkA = null, setOkB = null;
try { setOkA = S2.set("diagKeyA", 1); setOkB = S2.set("diagKeyB", 2); } catch (e) { /* 下面断言会体现 */ }
const diagLogs = EL2.recent();
const diagText = diagLogs.map((x) => String(x && x.msg || "")).join("\n");
ok("存储写失败仍如实返回 false（调用方可降级）", setOkA === false && setOkB === false);ok("诊断里带得上操作类型（写入失败）", /写入失败/.test(diagText), diagText.slice(0, 120));
ok("诊断里带得上具体键名（A / B 各自留痕，不共用去重桶）",
  /diagKeyA/.test(diagText) && /diagKeyB/.test(diagText), diagText.slice(0, 200));
ok("存储满时日志自身仍可读（内存兜底，不被自己的写盘失败吞掉）", diagLogs.length >= 2, "条数 " + diagLogs.length);
ok("两类键失败记为两种（去重未退化成 store|store）", EL2.noteStats().kinds >= 2, "kinds=" + EL2.noteStats().kinds);
// 缓冲上限：真灌 40 条看会不会被裁到 CAP（原先是断言内部变量名，改个名字就假红、名字对了也不代表真裁）
try { EL2.clear(); } catch (e) { /* ignore */ }
for (let i = 0; i < 40; i++) EL2.push("flood", new Error("flood-" + i));
const floodLen = EL2.recent().length;
ok("缓冲上限真的生效（灌 40 条只留 " + floodLen + " 条，不无界增长）", floodLen > 0 && floodLen <= 30, "len=" + floodLen);
ok("超上限时挤掉最旧的（保留最后一条）", /flood-39$/.test(String((EL2.recent().slice(-1)[0] || {}).msg || "")), "尾条 " + String((EL2.recent().slice(-1)[0] || {}).msg || ""));
try { EL2.clear(); } catch (e) { /* ignore */ }
ok("clear() 同时清内存与磁盘（否则日志面板清不掉）", EL2.count() === 0, "count=" + EL2.count());
try { delete globalThis.wx; } catch (e) { /* ignore */ }
_drop(STORE_P); _drop(EL_P);               // 不留垫片污染：后续段落一律在无 wx 的真实降级路径上跑

/* ───────── ⑥ 断网降级契约：有提示 + 有痕迹 ───────── */
console.log("【断网/失败降级契约】");
const assistant = read("subpkg/assistant/assistant.js");
ok("AI 失败有用户可见降级文案", /离线|降级|失败|稍后再试/.test(assistant));
ok("AI 失败痕迹由统一出口记录（cloud.aiChat）", /EL\.note\("ai"/.test(read("utils/cloud.js")));
const lens = read("subpkg/lens/lens.js");
ok("识物失败给真实地点对照清单（不是白屏/静默）", /_openLocalCompare/.test(lens));
ok("识物不宣称离线识别（零伪造）", !/离线识别(?:无需联网|免联网)/.test(lens));

/* ───────── ⑥b Promise 拒绝也必须留痕 ─────────
 * 小程序的 Promise 拒绝不进 onError，只进 onUnhandledRejection。缺这个钩子时，
 * 全仓 36 处 .then / 一批 async 函数的失败在线上**完全无声**（调试器里能看到，真机看不到）。
 * 这里锁两件事：钩子在、且走统一出口（不是自己 console.warn 一套格式）。 */
const appSrc = read("app.js");
ok("App 声明了 onUnhandledRejection（Promise 拒绝不会进 onError）", /onUnhandledRejection\s*\(\s*res\s*\)/.test(appSrc));
ok("onUnhandledRejection 走统一痕迹出口 errlog", /EL\.push\(\s*"app\.unhandledRejection"/.test(appSrc));
ok("onUnhandledRejection 自身整体包了 try（兜底逻辑不许成为新崩溃源）",
  (() => {
    const i = appSrc.indexOf("onUnhandledRejection");
    if (i < 0) return false;
    const seg = appSrc.slice(i, i + 900);
    return /try\s*\{/.test(seg) && /catch\s*\(/.test(seg);
  })());
console.log("");
if (fail === 0) {
  console.log("可观测性门禁通过：" + pass + " 项（空 catch " + emptyCount + " / 基线 " + BASELINE + "）");
  process.exit(0);
}
console.log("可观测性门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
process.exit(1);
