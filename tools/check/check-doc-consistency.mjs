/**
 * tools/check/check-doc-consistency.mjs —— 考核材料「数字口径一致性」门禁
 *
 * 为什么要有这道门禁（v1.19.201）：
 *   曾经出现过两类「代码是新的、材料是旧的」事故：
 *     ① 推荐引擎单测把 month 硬编码为 10，运行时却按当前月算 —— 单测全绿，
 *        11 月现场演示「沙漠戈壁 摄影 四天」却推出南昌/张家口，敦煌掉第 7；
 *     ② 计划书 / PPT / 讲稿仍写 1.19.111、26 项回归、35 条断言、旧榜单，
 *        而真实版本已迭代多轮，评委现场一核对就穿帮。
 *   这类问题不会报错、不会让 allcheck 变红，只能靠「动态真值 vs 材料文本」比对发现。
 *
 * 真值一律现算，禁止在材料或本文件里写死：
 *   · 版本号        ← project.config.json / 真源 / 产物三处一致
 *   · 回归步数      ← allcheck.sh 中 step 调用数
 *   · 推荐单测项数  ← 实跑 tools/test/_test-recommend.mjs 解析
 *   · 演示榜单      ← 实跑 utils/recommend.js（当前月）
 *
 * 归档材料（outputs/archive/**）、历史变更单（docs/changelog/**）、
 * 工作日志（.workbuddy/memory/**）按定义保留当时口径，不在本门禁追责范围内。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.resolve(ROOT, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : "")); }
}
function read(p) { return fs.readFileSync(p, "utf8"); }

/* ── ① 动态真值 ── */
console.log("【动态真值】");
const ide = JSON.parse(read(path.join(ROOT, "project.config.json")));
const VER = ide.version;
const srcVer = (read(path.join(ROOT, "tools/_src-backup/travel.js")).match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
const outVer = (read(path.join(ROOT, "utils/travel.js")).match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
const allcheck = read(path.join(ROOT, "allcheck.sh"));
const STEPS = (allcheck.match(/^step\s+"/gm) || []).length;
const testRun = spawnSync(process.execPath, [path.join(ROOT, "tools/test/_test-recommend.mjs")], { encoding: "utf8" });
const ASSERT = Number((String(testRun.stdout || "").match(/回归通过[：:]\s*(\d+)\s*项/) || [])[1] || 0);
const MONTH = new Date().getMonth() + 1;
ok("版本号单一真源（IDE / 真源 / 产物）", VER && VER === srcVer && VER === outVer,
  [VER, srcVer, outVer].join(" / "));
ok("allcheck 步数可解析（" + STEPS + " 步）", STEPS > 0);
ok("推荐单测项数可解析（" + ASSERT + " 项）", ASSERT > 0 && testRun.status === 0);
console.log("    真值：版本 " + VER + " ｜ 回归 " + STEPS + " 步 ｜ 单测 " + ASSERT + " 项 ｜ 当前 " + MONTH + " 月");

/* ── ② 材料文本提取（docx / pptx / md） ── */
function unzip(p, member) {
  try { return execFileSync("unzip", ["-p", p, member], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) { return ""; }
}
function xmlText(xml) {
  return [...xml.matchAll(/<(?:(?:w:t)|(?:a:t))(?:\s[^>]*)?>([\s\S]*?)<\/(?:(?:w:t)|(?:a:t))>/g)]
    .map(m => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
    .join(" ");
}
function materialText(p) {
  if (!fs.existsSync(p)) return null;
  if (p.endsWith(".docx")) return xmlText(unzip(p, "word/document.xml"));
  if (p.endsWith(".pptx")) {
    const list = (() => {
      try { return execFileSync("unzip", ["-Z1", p], { encoding: "utf8" }); } catch (e) { return ""; }
    })();
    return list.split("\n")
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n.trim()))
      .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]))
      .map(n => xmlText(unzip(p, n.trim()))).join("\n");
  }
  return read(p);
}

// 第三列 external=true：交付材料放在仓库父目录（outputs/），不随仓库分发。
// CI 的 actions/checkout 只检出仓库自身，父目录必然为空 —— 旧版把这几项当必填，
// 导致 #15~#39 连续 25 次 CI 全红，而本机因文件齐全一直全绿（环境差异，非代码缺陷）。
const MATERIALS = [
  ["考核计划书", path.join(OUT, "旅行攻略生成器-考核计划书.docx"), true],
  ["考核演示 PPT", path.join(OUT, "旅行攻略生成器-考核演示.pptx"), true],
  ["考核整改与答辩方案", path.join(OUT, "考核整改与答辩方案.md"), true],
  ["模拟考核评分报告", path.join(OUT, "模拟考核评分报告.md"), true],
  ["仓库 README", path.join(ROOT, "README.md"), false],
  ["功能清单", path.join(ROOT, "docs/assessment/功能清单.md"), false],
  ["演示讲稿", path.join(ROOT, "docs/assessment/演示讲稿.md"), false]
];
// 环境判定：外部材料一份都没有 → CI / 干净 checkout，仅跳过这 4 项。
// 本机开发环境只要检测到任意一份，就要求全部齐全（缺一份照样 fail），
// 避免「本地材料被误删 / 拷漏」被这个跳过逻辑静默放过。
const externalCount = MATERIALS.filter(m => m[2]).length;
const externalPresent = MATERIALS.filter(m => m[2] && fs.existsSync(m[1])).length;
const skipExternal = externalPresent === 0;
const ACTIVE = MATERIALS.filter(m => !m[2] || !skipExternal);
if (skipExternal) {
  console.log("【环境判定】CI / 干净 checkout：仓库父目录无交付材料，跳过 " + externalCount + " 份外部材料口径校验");
  console.log("    本机检测到任意一份即要求全部齐全；仓库内材料与全部代码侧动态真值仍逐项校验");
}
const texts = {};
console.log("【材料可读性】");
for (const [label, p] of ACTIVE) {
  const t = materialText(p);
  texts[label] = t || "";
  ok(label + " 可读且非空", !!t && t.length > 100, t ? String(t.length) + " 字符" : "读取失败");
}

/* ── ③ 版本号口径 ── */
console.log("【版本号口径】");
const STALE_VER = ["1.19.110", "1.19.111", "1.19.123", "1.19.192", "1.19.198", "1.19.200"];
for (const [label] of ACTIVE) {
  const t = texts[label];
  const stale = STALE_VER.filter(v => t.indexOf(v) >= 0);
  ok(label + "：无过期「当前版本」数字", stale.length === 0, stale.join(","));
}
for (const [label] of ACTIVE) {
  ok(label + "：含当前版本 " + VER, texts[label].indexOf(VER) >= 0);
}

/* ── ④ 数字口径：与动态真值比对 ── */
console.log("【回归项数 / 单测项数口径】");
const CN_NUM = { 二十五: 25, 二十六: 26, 二十七: 27, 二十九: 29, 三十五: 35, 五十一: 51, 五十五: 55, 五十六: 56, 五十七: 57, 五十八: 58, 五十九: 59, 六十: 60, 六十一: 61 };
let numTotal = 0, numBad = [];
for (const [label] of ACTIVE) {
  const t = texts[label];
  // 「26 / 26 项」「55/55」等分数式
  for (const m of t.matchAll(/(\d+)\s*\/\s*(\d+)\s*(?:项|步|全量回归|全绿)/g)) {
    numTotal++;
    if (Number(m[1]) !== STEPS || Number(m[2]) !== STEPS) numBad.push(label + "：" + m[0].trim());
  }
  // 「二十六项检查」「51 项全量回归」
  for (const m of t.matchAll(/([一二三四五六七八九十]+|\d+)\s*项\s*(?:检查|全量回归|回归|检查全部通过)/g)) {
    numTotal++;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]];
    if (n === undefined || n !== STEPS) numBad.push(label + "：" + m[0].trim() + "（真值 " + STEPS + "）");
  }
  // 断言数只对「推荐引擎单测」语境校验：仓库 README 里还有旅途应急(288)、
  // 菜名匹配(16) 等其它单测的真实条数，把它们当成口径漂移会误报。
  // 用句子切分定位语境，避免相邻行互相污染；黑名单仍会兜住旧值。
  const assertSents = t.split(/[。；;\n]/).filter(sent =>
    /[0-9一二三四五六七八九十]+\s*[条项]\s*断言/.test(sent) &&
    !(/[_\w-]*_test-(?!recommend)[a-z0-9-]+\.mjs/.test(sent) && !/推荐引擎|_test-recommend/.test(sent)));
  const assertText = assertSents.join(" ");
  for (const m of assertText.matchAll(/(\d+)\s*[条项]\s*断言/g)) {
    numTotal++;
    if (Number(m[1]) !== ASSERT) numBad.push(label + "：" + m[0].trim() + "（真值 " + ASSERT + "）");
  }
  for (const m of assertText.matchAll(/([一二三四五六七八九十]+)\s*[条项]\s*断言/g)) {
    numTotal++;
    const n = CN_NUM[m[1]];
    if (n === undefined || n !== ASSERT) numBad.push(label + "：" + m[0].trim() + "（真值 " + ASSERT + "）");
  }
  const noAssertNeeded = ["功能清单", "演示讲稿"].indexOf(label) >= 0;
  ok(label + "：推荐引擎单测断言数有被校验到", assertSents.length > 0 || noAssertNeeded, assertSents.length + " 句");
}
ok("材料中 " + numTotal + " 处回归/断言数字全部等于动态真值", numBad.length === 0, numBad.slice(0, 6).join(" ; "));

const STALE_PHRASES = [
  "26/26", "26 / 26", "25/25", "29 项", "35 条断言", "32 条断言",
  "二十六项检查", "回归 25 项", "24 → 25 步", "材料写 35 条", "材料写 26",
  "src=1.19.111", "古镇类首推平遥", "温泉类首推博尔塔拉", "平遥位列第一",
];
console.log("【过期话术黑名单】");
let staleHits = [];
for (const [label] of ACTIVE) {
  for (const s of STALE_PHRASES) if (texts[label].indexOf(s) >= 0) staleHits.push(label + "：" + s);
}
ok(ACTIVE.length + " 份材料无已知过期话术", staleHits.length === 0, staleHits.slice(0, 8).join(" ; "));

/* ── ⑤ 榜单口径：必须标注月份 + 可复现命令，杜绝写死后再次漂移 ── */
console.log("【榜单时令口径】");
const BOARD_LABELS = ["考核计划书", "考核演示 PPT", "考核整改与答辩方案"];
for (const label of BOARD_LABELS.filter(l => ACTIVE.some(m => m[0] === l))) {
  const t = texts[label];
  ok(label + "：标注榜单实测月份", /2026\s*年\s*11\s*月|11\s*月实测/.test(t));
  ok(label + "：给出可复现命令 demo.sh", t.indexOf("demo.sh") >= 0);
}
// 旧榜单整串不得残留
const OLD_BOARDS = [
  "平遥、黔东南（镇远）、凤凰、贺州（黄姚）、哈密",
  "秦皇岛、青岛、烟台、威海、三亚",
  "敦煌、阿拉善盟、张掖、酒泉、和田",
  "博尔塔拉、鞍山、咸宁、河源、铜仁",
  "平遥 · 黔东南（镇远） · 凤凰 · 贺州（黄姚） · 哈密",
];
let oldBoardHits = [];
for (const [label] of ACTIVE) for (const b of OLD_BOARDS) if (texts[label].indexOf(b) >= 0) oldBoardHits.push(label + "：" + b);
ok("材料中无旧版四组实测榜单整串", oldBoardHits.length === 0, oldBoardHits.slice(0, 5).join(" ; "));

/* ── ⑥ 代码侧「硬编码时间」防回潮 ── */
console.log("【硬编码时间防回潮】");
const recTest = read(path.join(ROOT, "tools/test/_test-recommend.mjs"));
const fuzz = read(path.join(ROOT, "tools/test/_fuzz-recommend.mjs"));
const engine = read(path.join(ROOT, "utils/recommend.js"));
ok("_test-recommend.mjs 不再硬编码 month: 10", !/month:\s*10(?![0-9])/.test(recTest));
ok("_test-recommend.mjs 使用运行时当前月", /MONTH_NOW\s*=\s*new Date\(\)\.getMonth\(\)\s*\+\s*1/.test(recTest));
ok("_test-recommend.mjs 覆盖 1–12 月", /MONTHS\s*=\s*Array\.from\(\{\s*length:\s*12/.test(recTest));
ok("_fuzz-recommend.mjs 不再硬编码 month: 10", !/month:\s*10(?![0-9])/.test(fuzz));
ok("推荐引擎季节分项已收敛且按主题强度缩放", /seasonHit:\s*6/.test(engine) && /relStrength/.test(engine));
ok("推荐引擎保留字面误命中降权", /weakHitPenalty/.test(engine) && /noHitPenalty/.test(engine));

// 有意固定样本的豁免：这些文件里的固定日期是「输入样本」，不是时令断言，
// 必须在源码里写明豁免理由，防止后人误删或误当成漂移。
const EXEMPT = [
  ["tools/check/check-new.mjs", "固定输入样本"],
  ["tools/test/_test-daily-insp.mjs", "固定输入样本"],
];
for (const [f, tag] of EXEMPT) {
  ok(f + " 的固定日期已标注「" + tag + "」豁免理由", read(path.join(ROOT, f)).indexOf(tag) >= 0);
}

/* ── ⑦ 演示脚本与运行时榜单一致 ── */
console.log("【演示脚本可复现性】");
const R = require(path.join(ROOT, "utils/recommend.js"));
const CASES = ["古镇 人少 三天", "海边亲子游 五天 舒适", "沙漠戈壁 摄影 四天", "温泉放松 周末 两天"];
const board = CASES.map(q => ({ q, names: R.recommend(q, { month: MONTH, topN: 5 }).list.map(x => x.name) }));
ok("当前月四组榜单均非空且互不相同", board.every(b => b.names.length === 5) && new Set(board.map(b => b.names.join(","))).size === 4);
ok("沙漠榜首仍为高置信沙漠目的地", ["敦煌", "阿拉善盟", "喀什"].indexOf(board[2].names[0]) >= 0, board[2].names.join(","));
const demo = read(path.join(ROOT, "tools/dev/demo.sh"));
ok("demo.sh 四组需求与门禁一致", CASES.every(q => demo.indexOf(q) >= 0));
console.log("    " + board.map(b => b.q + " → " + b.names.join("/")).join("\n    "));

/* ── 汇总 ── */
console.log("");
if (fail === 0) {
  console.log("材料口径一致性门禁通过：" + pass + " 项（版本 " + VER + " / 回归 " + STEPS + " 步 / 单测 " + ASSERT + " 项 / " + MONTH + " 月）");
  process.exit(0);
} else {
  console.log("材料口径一致性门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
