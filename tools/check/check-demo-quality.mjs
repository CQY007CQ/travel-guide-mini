// 演示质量 / Console 告警防回潮门禁（v1.19.197）
//
// 背景：2026-11-07 下午演示前排查发现，开发者工具 Console 里稳定复现的告警
// 并非「热重载假象」，而是 4 个真实代码缺陷；代码质量面板另有一项「主包内
// 存在主包未使用的 JS」。这些问题的共同点是——本地编译、真机调试、原有 46 步
// allcheck 全都发现不了，只有打开开发者工具才能看见。故把结论固化为静态门禁。
//
// 覆盖：
//   1) sysTheme light 分支漏提前返回 → 每次冷启动调用废弃 getSystemInfoSync
//   2) _sysFontLevel 新接口存在却仍回退旧接口 → 同类废弃告警
//   3) utils/data.js 模块加载期跨分包同步 require manifest → 生产可能失败
//   4) 动态配置把 undefined 写进 setData → 「Setting data field ... invalid」
//   5) pushRecent 去重键含 days/depart → recents 重复 city → wx:key 重复告警
//   6) 3 个只被分包引用的 JS 放在主包 → 代码质量面板「未使用 JS」未通过
//   7) APP_VER 真源 / 压缩产物 / project.config.json 三处版本一致
//
// 用法：node tools/check/check-demo-quality.mjs（由 allcheck.sh 调用）

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => fs.existsSync(path.join(ROOT, rel));
const slice = (s, from, to) => {
  const i = s.indexOf(from);
  if (i < 0) throw new Error("找不到片段起点: " + from);
  const j = to ? s.indexOf(to, i + from.length) : -1;
  return j < 0 ? s.slice(i) : s.slice(i, j);
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const count = (s, needle) => s.split(needle).length - 1;

const checks = [
  ["sysTheme：新接口返回即定案，浅色主题不再掉进废弃兜底", () => {
    const s = slice(read("tools/_src-backup/travel.js"), "function sysTheme()", "// 实际生效主题");
    must(s.includes('return b.theme === "dark" ? "dark" : "light";'), "缺少 dark/light 一次性返回");
    must(!s.includes('if (b.theme === "dark") return "dark";'), "旧写法回潮：light 会继续调用 getSystemInfoSync");
  }],
  ["_sysFontLevel：仅新接口整体不可用才回退废弃 API", () => {
    const s = slice(read("tools/_src-backup/travel.js"), "function _sysFontLevel()", "function fontScale()");
    // 去掉注释行：历史注释里也提到过这个 API 名，不能拿来做位置比较
    const code = s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    must(code.includes("if (!hasNew)"), "缺少 hasNew 守卫");
    must(code.indexOf("if (!hasNew)") < code.indexOf("wx.getSystemInfoSync()"),
      "废弃 API 调用出现在守卫之前");
  }],
  ["废弃 API 仅保留 2 处兼容兜底，且产物与真源一致", () => {
    const src = read("tools/_src-backup/travel.js");
    const out = read("utils/travel.js");
    // 真源用「带括号的调用」计数（注释里的 API 名不算）；产物经 terser 去注释后
    // 每处兜底会留下 1 次存在性检查 + 1 次调用，共 4 次引用。
    must(count(src, "wx.getSystemInfoSync()") === 2, "真源里废弃 API 调用数应为 2（两处兜底）");
    must(count(out, "getSystemInfoSync") === 4, "压缩产物里废弃 API 引用数应为 4");
  }],
  ["data.js：微信端禁止跨分包同步 require manifest", () => {
    const src = read("utils/data.js");
    must(src.includes('if (typeof require.async === "function")'), "缺少微信端环境守卫");
    const guard = src.indexOf('if (typeof require.async === "function")');
    const req = src.indexOf('require(' + '"../subdata/data/_manifest.js")');
    must(req > guard, "跨分包 require 发生在环境守卫之前，生产仍会告警");
  }],
  ["SafePage：统一清洗 setData 中的 undefined", () => {
    const s = read("utils/app.js");
    must(s.includes("function __stripUndefined"), "缺少 __stripUndefined");
    must(s.includes("function __patchSetData"), "缺少 __patchSetData");
    must(s.includes("__patchSetData(this)"), "SafePage 未接入清洗");
    must(s.includes("config.onLoad = function"), "缺少 onLoad 注入点");
  }],
  ["最近玩过：按城市唯一，杜绝 wx:key 重复", () => {
    const t = read("tools/_src-backup/travel.js");
    must(t.includes('String(x.city || "") === String(item.city)'), "pushRecent 去重键回潮");
    const i = read("pages/index/index.js");
    must(i.includes("function _uniqRecent"), "首页缺少 _uniqRecent 兜底（历史脏数据仍会重复）");
    must(count(i, "_uniqRecent(T.getRecent())") >= 3, "recents 展示未全部去重");
  }],
  ["首页：省份索引越界钳制 + provName 空串兜底", () => {
    const i = read("pages/index/index.js");
    must(i.includes("if (!isFinite(i) || i < 0 || i >= provs.length) i = 0;"), "_fillProv 缺少 idx 钳制");
    must(i.includes("provName: prov, cityIdx"), "provName 未使用兜底后的 prov");
    must(i.includes('provName: cfg.provName || ""'), "草稿恢复缺少 provName 兜底");
  }],
  ["代码质量：3 个分包专用 JS 已迁出主包", () => {
    const pairs = [
      ["utils/ad.js", "subai/utils/ad.js"],
      ["utils/food-map.js", "subpkg/utils/food-map.js"],
      ["utils/spotsearch.js", "subpkg/utils/spotsearch.js"]
    ];
    for (const [oldP, newP] of pairs) {
      must(!has(oldP), oldP + " 仍留在主包");
      must(has(newP), newP + " 不存在");
    }
    // 断言文本里不能直接写出完整的 require("../xxx")：check-deps.mjs 的静态正则
    // 会把这段「待检查的字符串」当成真实依赖去解析，从而误报缺失。故拼接构造。
    const REF = (prefix, tail) => "require(" + '"' + prefix + tail + '"' + ")";
    must(read("subai/deep/deep.js").includes(REF("../", "utils/ad.js")), "ad 引用未更新");
    must(read("subpkg/food/food.js").includes(REF("../", "utils/food-map.js")), "food-map 引用未更新");
    must(read("subpkg/spotsearch/spotsearch.js").includes(REF("../", "utils/spotsearch.js")), "spotsearch 引用未更新");
    must(read("subpkg/utils/spotsearch.js").includes(REF("../../", "utils/spot-tags.js")), "迁移后内部相对路径未更新");
    must(read("tools/test/_test-foodmap.mjs").includes("../../subpkg/utils/food-map.js"), "foodmap 单测路径未更新");
    must(read("tools/test/_test-spotsearch.mjs").includes("./subpkg/utils/spotsearch.js"), "spotsearch 单测路径未更新");
  }],
  ["异常兜底不得伪装成空态（我的攻略 / 助手候选）", () => {
    // v1.19.200 教训：catch 把渲染异常吞掉并置「无数据」状态，页面就变成「你还没生成过」。
    // v1.19.205 同类：我的攻略读取存档失败时显示「还没有收藏的攻略」，用户会以为存档丢了。
    const g = read("pages/myguides/myguides.js");
    const w = read("pages/myguides/myguides.wxml");
    must(/loadErr\s*:\s*false/.test(g), "myguides 缺少 loadErr 初始状态");
    must(/EL\.push\(\s*"myguides\._load"/.test(g), "myguides 读取失败未留痕到 errlog");
    must(/loadErr\s*:\s*true/.test(g), "myguides 读取失败未标记 loadErr");
    must(/reload\s*\(\s*\)/.test(g), "myguides 未提供重试入口");
    must(/wx:if="\{\{loadErr\}\}"/.test(w), "myguides.wxml 未区分「读取失败」与「没有存档」");
    must(/bindtap="reload"/.test(w), "myguides.wxml 缺少重试按钮");
    // 旧写法（catch 里直接 list:[] + empty:true 且无 loadErr）不得回潮
    must(!/catch\s*\(e\)\s*\{\s*this\.setData\(\{\s*list:\s*\[\],\s*empty:\s*true\s*\}\s*\);\s*\}/.test(g),
      "myguides 回潮：catch 又把失败伪装成空列表");
    const a = read("subpkg/assistant/assistant.js");
    must(/EL\.push\(\s*"assistant\.planSpots"/.test(a), "assistant 候选读取失败未留痕");
    must(/EL\.push\(\s*"assistant\.syncKeeps"/.test(a), "assistant 收藏读取失败未留痕");
    return "2 页 4 处已留痕";
  }],
  ["使用指南：字号单一真源 + 版本动态显示 + 直达链接有效", () => {
    const g = read("subpkg/guide/guide.js");
    const w = read("subpkg/guide/guide.wxml");
    // 只看代码行：注释里回顾历史缺陷时提到旧键名，不算回潮
    const code = g.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    must(!/miniGuideFzV1/.test(code), "guide.js 仍在读遗留的私有字号键");
    must(!/S\.(get|set)\s*\(/.test(code), "guide.js 仍在直接读写页面私有 store");
    must(/onLoad\(\)[\s\S]{0,500}T\.fontScale\(\)/.test(g), "guide.js onLoad 未使用全局字号");
    must(/ver:\s*T\.APP_VER/.test(g), "guide.js 未提供动态版本号");
    must(/v\{\{ver\}\}/.test(w), "guide.wxml 未显示动态版本号");
    // 直达链接必须真实注册；tab 判定必须与 app.json.tabBar.list 一致
    // （与「更多」页历史故障同类：漏配一个路径，用户点了就是没反应）
    const cfg = JSON.parse(read("app.json"));
    const registered = new Set(cfg.pages || []);
    (cfg.subPackages || []).forEach((s) => (s.pages || []).forEach((p) =>
      registered.add(s.root.replace(/\/$/, "") + "/" + p)));
    const tabs = new Set(((cfg.tabBar && cfg.tabBar.list) || []).map((x) => "/" + x.pagePath));
    const urls = [...g.matchAll(/url:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
    must(urls.length >= 15, "使用指南直达链接数量异常（疑似漏配）");
    urls.forEach((u) => must(registered.has(u.slice(1)), "未在 app.json 注册的直达链接: " + u));
    const isTabLine = (g.match(/const isTab = \[([^\]]+)\]/) || [])[1] || "";
    const declared = [...isTabLine.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
    must(declared.length === tabs.size && declared.every((u) => tabs.has(u)),
      "guide.js 的 tabBar 判定与 app.json.tabBar.list 不一致");
    return `字号/版本已收敛，${urls.length} 条直达链接有效`;
  }],
  ["版本一致性：真源 / 产物 / IDE 配置", () => {
    const a = (read("tools/_src-backup/travel.js").match(/const APP_VER = "([^"]+)"/) || [])[1];
    const b = (read("utils/travel.js").match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
    const c = JSON.parse(read("project.config.json")).version;
    must(a && a === b && a === c, `版本不一致 src=${a} out=${b} ide=${c}`);
    return `v${a}`;
  }],
  ["回归链自身：网页版步骤不吃空 NODE / 不吞管道失败", () => {
    const sh = read("allcheck.sh");
    const line = (sh.match(/^step "网页版 构建与引擎冒烟[^\n]*/m) || [])[0] || "";
    must(line, "allcheck.sh 缺少「网页版 构建与引擎冒烟」步骤");
    // NODE 是父 shell 局部变量、未 export：写进 bash -c 的单引号脚本体会取到空串，
    // 症状是 "bash: : command not found"（v1.20.0 夜间全量回归实测）。
    must(/"\$1"/.test(line) && /_ "\$NODE"/.test(line),
      "网页版步骤未用位置参数传 NODE，子 shell 里 $NODE 为空");
    must(!/bash -c '[^']*"\$NODE/.test(line), "网页版步骤仍在 bash -c 脚本体内引用 $NODE");
    // 管道 smoke.mjs | tail -4 不开 pipefail 时退出码取 tail，smoke 失败也会假绿。
    must(/set -o pipefail/.test(line), "网页版步骤未开 pipefail，smoke 失败会被 tail 吞掉");
    return "NODE 显式传参 + pipefail";
  }],
  ["发布代码洁净度：无调试 console.log / debugger / eval / new Function", () => {
    // 2026-11-09 代码质量检测前置：把「生产包残留调试语句 / 动态执行」固化为门禁防回潮。
    // 只扫随包发布的手写与构建产物；不含工具链（tools/）与 MB 级生成产物（web/lib/{modules,data,tpl}.js）。
    // console.error / console.warn 属有意错误留痕，不在禁止之列。
    const files = [];
    const push = (rel) => { if (has(rel)) files.push(rel); };
    push("app.js"); push("web/app.js"); push("web/lib/runtime.js");
    const walk = (dir) => {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) return;
      for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = dir.replace(/\/$/, "") + "/" + ent.name;
        if (ent.isDirectory()) walk(rel);
        else if (/\.js$/.test(ent.name)) files.push(rel);
      }
    };
    walk("utils"); walk("pages"); walk("subpkg");
    const PATS = [
      [/\bconsole\.(log|debug|info)\s*\(/, "console.log"],
      [/\bdebugger\b/, "debugger"],
      [/\beval\s*\(/, "eval("],
      [/\bnew\s+Function\s*\(/, "new Function("]
    ];
    const hits = [];
    for (const f of files) {
      const lines = read(f).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*(\/\/|\*|\/\*)/.test(ln)) continue;   // 跳过纯注释行（历史注释常提到这些词）
        for (const [rx, tag] of PATS) if (rx.test(ln)) { hits.push(f + ":" + (i + 1) + " " + tag); break; }
      }
      if (hits.length > 20) break;
    }
    must(!hits.length, "存在调试/动态执行残留: " + hits.slice(0, 8).join("；"));
    return files.length + " 个发布 JS 洁净";
  }]
];

let failed = 0;
console.log("──────────────────────────────────────────────");
for (const [name, fn] of checks) {
  try {
    const detail = fn();
    console.log("  ✓ " + name + (detail ? "  " + detail : ""));
  } catch (e) {
    console.log("  ✗ FAIL: " + name + " —— " + e.message);
    failed++;
  }
}
if (failed) {
  console.log(`\n❌ 演示质量门禁失败 ${failed} 项`);
  process.exit(1);
}
console.log(`\n✅ 演示质量门禁通过（${checks.length} 项），Console / 代码质量面板修复未回潮`);
