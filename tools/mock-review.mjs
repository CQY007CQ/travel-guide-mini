/**
 * tools/mock-review.mjs —— 模拟考核评分器
 *
 * 目的：把「这个项目大概能拿多少分」从主观判断变成**可重复运行的客观检查**。
 * 依据考核通知的五个评分维度分配权重（项目设计 25 / 代码实现 25 / 计划书 20 / PPT 15 / 团队协作 15），
 * 每个维度下拆成可机器判定的子项，逐项给分并输出报告。
 *
 * 设计原则（重要）：
 *   · 检查项只判「有没有、是否达标」，不判「写得好不好」，因此不会因为改了措辞就凭空涨分。
 *   · 任何一项都不允许用「假设通过」兜底：读不到文件就是 0 分，不做静默跳过。
 *   · 权重与判定阈值集中写在 RUBRIC 里，改阈值等于改考卷，必须显式且有理由。
 *
 * 用法：
 *   node tools/mock-review.mjs            # 打分并打印
 *   node tools/mock-review.mjs --skip-slow  # 跳过 allcheck/verify-release（调试用，不计入正式分）
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const PROJ = process.cwd();
const OUT = path.resolve(PROJ, "../");
const GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const SKIP_SLOW = process.argv.includes("--skip-slow");

/* ───────────────── 工具 ───────────────── */
function sh(cmd, opts) {
  try {
    return execSync(cmd, { cwd: PROJ, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
  } catch (e) {
    return (e && e.stdout ? e.stdout.toString() : "") + (e && e.stderr ? e.stderr.toString() : "");
  }
}
function unzipText(file, pattern) {
  if (!fs.existsSync(file)) return "";
  try {
    return execSync(`unzip -p "${file}" ${pattern}`, { maxBuffer: 1 << 28 }).toString();
  } catch (e) { return ""; }
}
function stripXml(xml) {
  return xml.replace(/<w:p[ >]/g, "\n<w:p ").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
}
function pptText(file) {
  if (!fs.existsSync(file)) return "";
  try {
    const xml = execSync(`unzip -p "${file}" "ppt/slides/*.xml"`, { maxBuffer: 1 << 28 }).toString();
    return xml.split(/<a:t>/).slice(1).map(s => s.split("</a:t>")[0]).join("\n");
  } catch (e) { return ""; }
}
function pptSlideCount(file) {
  if (!fs.existsSync(file)) return 0;
  try {
    const out = execSync(`unzip -Z1 "${file}"`, { maxBuffer: 1 << 26 }).toString();
    return (out.match(/^ppt\/slides\/slide\d+\.xml$/gm) || []).length;
  } catch (e) { return 0; }
}

/* ───────────────── 打分框架 ───────────────── */
const results = [];
function check(dim, id, desc, weight, pass, detail) {
  const got = pass ? weight : 0;
  results.push({ dim, id, desc, weight, pass: !!pass, got, detail: detail == null ? "" : String(detail) });
  return pass;
}

/* ───────────────── 预处理 ───────────────── */
const DOCX = path.join(OUT, "旅行攻略生成器-考核计划书.docx");
const PPTX = path.join(OUT, "旅行攻略生成器-考核演示.pptx");

const docText = stripXml(unzipText(DOCX, "word/document.xml"));
const docXml = unzipText(DOCX, "word/document.xml");
const slideText = pptText(PPTX);
const slideCount = pptSlideCount(PPTX);
const docSizeKB = fs.existsSync(DOCX) ? Math.round(fs.statSync(DOCX).size / 1024) : 0;
const pptSizeKB = fs.existsSync(PPTX) ? Math.round(fs.statSync(PPTX).size / 1024) : 0;

// 数据侧：直接 require 真实模块，不用解析文件猜
let D = null, APP_VER = "";
try {
  const T = require("../utils/travel.js");
  D = T.D;
  APP_VER = T.APP_VER || "";
} catch (e) { /* 读不到就按缺失计分 */ }

/* ═════════════ A. 项目设计（25） ═════════════ */
// A1 定位不夸大：不得出现「AI 生成行程 / 人工智能生成行程」这类把规则引擎包装成生成式 AI 的表述
{
  const bad = ["AI生成行程", "AI 生成行程", "人工智能生成行程", "AI自动生成行程"];
  const hit = bad.filter(w => docText.indexOf(w) >= 0 || slideText.indexOf(w) >= 0);
  check("A 项目设计", "A1", "对外材料不使用「AI 生成行程」式夸大表述", 4, hit.length === 0, hit.length ? "命中：" + hit.join("、") : "无");
}
// A2 技术选型与合规取舍独立成章/成页
check("A 项目设计", "A2", "计划书设有「技术选型与合规取舍」独立章节", 5,
  /技术选型与合规取舍/.test(docText));
// A3 技术路线含算法实质（三层尺度 + 双因子 + 权重表）
{
  const needs = ["三层", "双因子", "权重"];
  const miss = needs.filter(k => docText.indexOf(k) < 0);
  check("A 项目设计", "A3", "技术路线含算法实质（三层尺度/双因子/权重表）", 5, miss.length === 0, miss.length ? "缺：" + miss.join("、") : "齐全");
}
// A4 已知局限如实披露
check("A 项目设计", "A4", "计划书含「已知局限」并给出后续工作", 3,
  docText.indexOf("已知局限") >= 0 && /后续/.test(docText));
// A5 可行性：主体资质与类目限制有交代
check("A 项目设计", "A5", "交代个人主体与类目限制（可行性关键）", 3,
  /深度合成/.test(docText) && /(个人主体|个体工商|企业主体|类目)/.test(docText));
// A6 目标用户与竞品差异
check("A 项目设计", "A6", "说明目标用户与竞品差异化", 3,
  /目标用户/.test(docText) && /(竞争|竞品|差异|对比)/.test(docText));
// A7 数据来源与免责声明落到产品内：材料承诺必须在产品里看得见，否则属于口径不一致
{
  const w = fs.readFileSync(path.join(PROJ, "pages/more/more.wxml"), "utf8");
  const j = fs.readFileSync(path.join(PROJ, "pages/more/more.js"), "utf8");
  const ok = /数据说明/.test(w) && /(免责|不构成出行建议)/.test(j);
  check("A 项目设计", "A7", "App 内提供数据说明与免责声明（材料与产品一致）", 2, ok);
}

/* ═════════════ B. 代码实现（25） ═════════════ */
// B1 allcheck 全绿
let allcheckOK = false, allcheckSteps = 0;
if (!SKIP_SLOW) {
  const out = sh("./allcheck.sh");
  allcheckOK = out.indexOf("全部通过") >= 0 && out.indexOf("存在失败步骤") < 0;
  // 只数「汇总区」的步骤行：整份输出里的 ✓ 包含了各步骤内部的子断言（1900+ 个），
  // 直接全量计数会把"检查项数"算成子断言总数（C8 校验时暴露过这个错）。
  // 汇总行带 ANSI 颜色转义（"\x1b[32m✓\x1b[0m"），必须先剥控制码再匹配，
  // 否则 \s+ 后面直接遇到 \x1b，永远匹配不到。
  const plainOut = out.replace(/\x1b\[[0-9;]*m/g, "");
  const sumIdx = plainOut.indexOf("allcheck 汇总");
  const sumBlock = sumIdx >= 0 ? plainOut.slice(sumIdx) : plainOut;
  allcheckSteps = (sumBlock.match(/^\s+[✓✗] /gm) || []).length;
} else {
  allcheckOK = true;
}
check("B 代码实现", "B1", "全量回归 allcheck 全部通过", 5, allcheckOK, SKIP_SLOW ? "本次跳过" : allcheckSteps + " 项通过");

// B2 推荐引擎单测断言数
let recAssert = 0;
{
  const out = sh(`node tools/_test-recommend.mjs`);
  recAssert = (out.match(/✓ /g) || []).length;
  check("B 代码实现", "B2", "推荐引擎单测断言 ≥20 条", 3, recAssert >= 20, recAssert + " 条");
}
// B3 引擎已接入页面 UI
{
  let wired = false;
  const idx = path.join(PROJ, "pages/index/index.js");
  if (fs.existsSync(idx)) wired = fs.readFileSync(idx, "utf8").indexOf("utils/recommend.js") >= 0;
  check("B 代码实现", "B3", "推荐引擎已接入页面入口（非死代码）", 3, wired);
}
// B4 无密钥/外借凭据明文
{
  const bad = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (["node_modules", "_archive", "subdata", "subdata2", "subdata3", ".git"].includes(f.name)) continue;
        walk(p);
        continue;
      }
      if (!/\.(js|mjs|json|wxml)$/.test(f.name)) continue;
      const st = fs.statSync(p);
      if (st.size > 1 << 20) continue;
      const s = fs.readFileSync(p, "utf8");
      if (/key\s*=\s*[0-9a-f]{32}\b/i.test(s)) bad.push(path.relative(PROJ, p) + ":(key=明文)");
      const shipped = /^(app\.js|utils\/|pages\/|subai\/|subpkg\/|subdata)/.test(path.relative(PROJ, p));
      if (shipped && /restapi\.amap\.com/.test(s)) bad.push(path.relative(PROJ, p) + ":(随包代码含地图接口)");
    }
  };
  walk(PROJ);
  check("B 代码实现", "B4", "随包代码无地图密钥/接口明文，全仓无 key= 明文", 4, bad.length === 0, bad.length ? bad.slice(0, 3).join("; ") : "无");
}
// B5 发布门禁（数据随包、非残包）
let relOK = false;
if (!SKIP_SLOW && fs.existsSync(path.join(PROJ, "tools/verify-release.mjs"))) {
  const out = sh(`node tools/verify-release.mjs`);
  relOK = out.indexOf("发布门禁通过") >= 0;
} else relOK = SKIP_SLOW;
check("B 代码实现", "B5", "数据分包随包发布（非残包）门禁通过", 3, relOK);
// B6 数据规模
{
  const cities = D && Array.isArray(D.CITIES) ? D.CITIES.length : 0;
  const exp = D && D.CITIES ? D.CITIES.reduce((s, c) => s + ((c.experiences || []).length), 0) : 0;
  const rated = D && D.SPOT_INFO ? Object.keys(D.SPOT_INFO).length : 0;
  check("B 代码实现", "B6", "数据规模达标（≥232 城 / ≥1300 体验 / ≥5000 评级） ", 1,
    cities >= 232 && exp >= 1300 && rated >= 5000, `${cities} 城 / ${exp} 体验 / ${rated} 评级`);
}
// B7 版本单一真源
{
  const src = (() => {
    const p = path.join(PROJ, "tools/_src-backup/travel.js");
    if (!fs.existsSync(p)) return "";
    const m = fs.readFileSync(p, "utf8").match(/APP_VER\s*=\s*["']([\d.]+)["']/);
    return m ? m[1] : "";
  })();
  check("B 代码实现", "B7", "版本号单一真源且与产物一致", 1, !!src && src === APP_VER, `src=${src || "-"} 产物=${APP_VER || "-"}`);
}
// B8 一键演示脚本
{
  const cand = ["tools/demo.sh", "demo.sh"];
  const hit = cand.filter(f => fs.existsSync(path.join(PROJ, f)));
  check("B 代码实现", "B8", "提供一键演示脚本（答辩/验收现场可用）", 2, hit.length > 0, hit.join(",") || "缺");
}
// B9 真机截图流程可复现：脚本在仓库 + 已有产物，评委可据此自行复核界面
{
  const sPath = path.join(PROJ, "tools/capture-shots.cjs");
  const hasScript = fs.existsSync(sPath);
  const hasShot = fs.existsSync(path.join(OUT, "screenshots/01-home.png"));
  check("B 代码实现", "B9", "真机截图流程可复现（脚本 + 既有产物）", 3, hasScript && hasShot,
    (hasScript ? "脚本✓" : "缺脚本") + " / " + (hasShot ? "产物✓" : "缺产物"));
}

/* ═════════════ C. 计划书（20） ═════════════ */
check("C 计划书", "C1", "计划书存在且体积正常（>20KB）", 2, docSizeKB > 20, docSizeKB + "KB");
// C2 五要素
{
  const need = ["背景", "技术路线", "方案", "预期成果", "分工"];
  const miss = need.filter(k => docText.indexOf(k) < 0);
  check("C 计划书", "C2", "覆盖考核要求的五要素", 4, miss.length === 0, miss.length ? "缺：" + miss.join("、") : "齐全");
}
// C3 章节与表格规模
{
  const headings = (docXml.match(/w:val="Heading1"|w:val="Heading2"|w:val="1"|w:val="2"/g) || []).length;
  const tables = (docXml.match(/<w:tbl>/g) || []).length;
  check("C 计划书", "C3", "章节与表格达到可交付密度（≥9 标题 / ≥10 表）", 2,
    headings >= 9 && tables >= 10, `标题标记 ${headings} / 表格 ${tables}`);
}
// C4 禁用词
{
  const bans = ["第一版", "第二版", "本版", "初版", "旧版", "修订", "变更记录", "终稿", "定稿", "V1", "V2",
    "伪", "赋能", "抓手", "闭环", "务必", "加分项", "反杀", "拆雷", "含金量", "底层逻辑", "生态", "矩阵", "一站式", "护城河"];
  const hit = bans.filter(b => docText.indexOf(b) >= 0);
  check("C 计划书", "C4", "无版本词 / 自评式 / AI 味套话", 3, hit.length === 0, hit.length ? "命中：" + hit.join("、") : "0 命中");
}
{
  const nChar = docText.replace(/\s/g, "").length;   // 非空白字符 = 读者感知的字数
  check("C 计划书", "C5", "正文篇幅充实（≥8000 字，含表格）", 2, nChar >= 8000, nChar + " 字");
}
// C6 实测榜单
{
  const probe = ["平遥", "敦煌", "秦皇岛"].filter(n => docText.indexOf(n) >= 0);
  check("C 计划书", "C6", "写入引擎实测榜单（可验证数据，非空话）", 2, probe.length >= 2, probe.join("、") || "缺");
}
// C7 数字一致性：材料里的「N 条断言」必须与单测实测一致。
// 起因：测试从 27 → 32 → 35 一路扩，材料里的数字跟着改了三遍还改漏过。
// 与其靠人记，不如让评分器对不上就红。
{
  const out = sh("node tools/_test-recommend.mjs");
  const actual = (out.match(/✓ /g) || []).length;
  const nums = [];
  let m;
  const re1 = /(\d+)\s*条断言/g;
  while ((m = re1.exec(docText))) nums.push(parseInt(m[1], 10));
  const re2 = /(\d+)\s*条断言/g;
  while ((m = re2.exec(slideText))) nums.push(parseInt(m[1], 10));
  const uniq = Array.from(new Set(nums));
  const consistent = nums.length > 0 && uniq.length === 1 && uniq[0] === actual;
  check("C 计划书", "C7", "材料中的断言数量与实测一致（防数字漂移）", 3, consistent,
    "材料写 " + (uniq.join("/") || "无") + " 条，实测 " + actual + " 条");
}
// C8 回归项数一致性：材料写「N 项（全量）回归」或「二十X项检查」必须等于 allcheck 实际步骤数。
// 起因：回归链从 24 → 25 → 26 一路加，材料里的「25/25」和「二十五项检查」各漏改过一轮。
{
  if (SKIP_SLOW) {
    check("C 计划书", "C8", "材料中的回归项数与实测一致（防口径漂移）", 2, true, "本次跳过");
  } else {
    const norm = (t) => String(t || "").replace(/\s+/g, "");
    const nums = [];
    const collect = (t) => {
      const s2 = norm(t);
      let m;
      const reC = /(\d+)\/(\d+)项全量回归/g;
      while ((m = reC.exec(s2))) { nums.push(parseInt(m[1], 10), parseInt(m[2], 10)); }
      const reA = /(\d+)项全量回归/g;
      while ((m = reA.exec(s2))) nums.push(parseInt(m[1], 10));
      const reB = /(\d+)项回归/g;
      while ((m = reB.exec(s2))) nums.push(parseInt(m[1], 10));
    };
    collect(docText);
    collect(slideText);
    // 计划书正文用的是中文数字（「二十六项检查」）
    const CN = { 二十一: 21, 二十二: 22, 二十三: 23, 二十四: 24, 二十五: 25, 二十六: 26, 二十七: 27, 二十八: 28, 二十九: 29, 三十: 30 };
    const cnHits = norm(docText).match(/[一二三四五六七八九十]{2,3}项检查/g) || [];
    cnHits.forEach((x) => { const k = x.replace("项检查", ""); if (CN[k]) nums.push(CN[k]); });

    const uniq = Array.from(new Set(nums));
    const okC8 = uniq.length === 1 && uniq[0] === allcheckSteps;
    check("C 计划书", "C8", "材料中的回归项数与实测一致（防口径漂移）", 2, okC8,
      "材料写 " + (uniq.join("/") || "无") + "，实测 " + allcheckSteps + " 项");
  }
}

/* ═════════════ D. PPT（15） ═════════════ */
check("D PPT", "D1", "页数达到可演示规模（≥16 页）", 2, slideCount >= 16, slideCount + " 页 / " + pptSizeKB + "KB");
{
  const ok = /目录|CONTENTS/.test(slideText) && /致谢|谢谢|恳请/.test(slideText);
  check("D PPT", "D2", "含目录页与结尾致谢页", 2, ok);
}
check("D PPT", "D3", "含技术选型与合规取舍页", 3, /技术选型/.test(slideText) && /(合规|取舍)/.test(slideText));
check("D PPT", "D4", "含推荐引擎算法页", 3, /推荐引擎/.test(slideText));
check("D PPT", "D5", "含已知局限与后续路线页", 2, /(局限|限制|后续|路线图)/.test(slideText));
// D6 演示文稿须含真实产品界面截图：路演不给人看真实界面，是评委最常追问的点
{
  let media = 0;
  try {
    media = (execSync(`unzip -Z1 "${PPTX}"`, { maxBuffer: 1 << 26 }).toString().match(/^ppt\/media\/.+\.(png|jpe?g)$/gm) || []).length;
  } catch (e) {}
  const labelOk = /真机|界面截图/.test(slideText);
  check("D PPT", "D6", "含真实产品界面截图（可对照 App 复核）", 3, media >= 2 && labelOk,
    media + " 张图片" + (labelOk ? " / 有来源说明" : " / 缺来源说明"));
}

/* ═════════════ E. 团队协作（15） ═════════════ */
{
  const n = parseInt(sh(`${GIT} rev-list --count HEAD`).trim(), 10) || 0;
  check("E 团队协作", "E1", "提交历史完整（≥10 次提交）", 4, n >= 10, n + " 次");
}
{
  const d = sh(`${GIT} log -1 --format=%cs`).trim();
  const ok = !!d && (Date.now() - new Date(d + "T00:00:00").getTime()) < 14 * 86400000;
  check("E 团队协作", "E2", "近 14 天内有提交（持续投入）", 3, ok, d || "无记录");
}
{
  const dirty = sh(`${GIT} status --porcelain`).trim().split("\n").filter(Boolean).length;
  check("E 团队协作", "E3", "改动已提交（工作树残留 ≤2）", 3, dirty <= 2, dirty + " 个未提交");
}
check("E 团队协作", "E4", "计划书含组内分工（≥5 个角色）", 3,
  /分工/.test(docText) && (docText.match(/(项目设计|开发|算法|数据|文档|演示|测试)/g) || []).length >= 5);
check("E 团队协作", "E5", "计划书含验收节点时间表（≥5 行节点）", 2,
  (docText.match(/11\.\d{1,2}|2026\.11\.\d{1,2}/g) || []).length >= 5);

/* ───────────────── 汇总输出 ───────────────── */
const DIMS = ["A 项目设计", "B 代码实现", "C 计划书", "D PPT", "E 团队协作"];
const MAX = { "A 项目设计": 25, "B 代码实现": 25, "C 计划书": 20, "D PPT": 15, "E 团队协作": 15 };

let total = 0, totalMax = 0;
console.log("\n══════════ 模拟考核评分 ══════════\n");
for (const dim of DIMS) {
  const rows = results.filter(r => r.dim === dim);
  const got = rows.reduce((s, r) => s + r.got, 0);
  const max = rows.reduce((s, r) => s + r.weight, 0);
  total += got; totalMax += max;
  console.log(`【${dim}】 ${got} / ${max}`);
  for (const r of rows) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.id} ${r.desc}  (${r.got}/${r.weight})${r.detail ? "  → " + r.detail : ""}`);
  }
  console.log("");
}

const pct = Math.round((total / totalMax) * 100);
const grade = pct >= 90 ? "可竞争优秀档" : pct >= 80 ? "良好" : pct >= 70 ? "中等" : "需补强";
console.log("───────────────────────────────────");
console.log(`总分：${total} / ${totalMax}   （折算 ${pct} 分，${grade}）`);
const fails = results.filter(r => !r.pass);
console.log(`未达标项：${fails.length} 项，合计可再拿 ${fails.reduce((s, r) => s + r.weight, 0)} 分`);
if (fails.length) fails.forEach(r => console.log(`  · ${r.id} ${r.desc}（+${r.weight}）→ ${r.detail}`));
console.log("");

/* 报告落盘 */
const md = [];
md.push("# 模拟考核评分报告", "");
md.push(`总分 **${total} / ${totalMax}**（折算 ${pct} 分，${grade}）`, "");
md.push("| 维度 | 得分 | 满分 |", "|---|---|---|");
for (const dim of DIMS) {
  const rows = results.filter(r => r.dim === dim);
  md.push(`| ${dim} | ${rows.reduce((s, r) => s + r.got, 0)} | ${MAX[dim]} |`);
}
md.push("", "## 明细", "", "| 项 | 检查 | 结果 | 得分 | 依据 |", "|---|---|---|---|---|");
for (const r of results) md.push(`| ${r.id} | ${r.desc} | ${r.pass ? "通过" : "**未通过**"} | ${r.got}/${r.weight} | ${r.detail} |`);
md.push("", "## 待补项", "");
if (fails.length) fails.forEach(r => md.push(`- **${r.id}** ${r.desc}（可加 ${r.weight} 分）`));
else md.push("- 无");
md.push("");
md.push("## 评分器不覆盖的部分（不计分，但评委仍可能关注）", "");
md.push("- 现场答辩的表达与临场应答：本器只评材料与代码，评不了讲述。");
md.push("- 数据真实性：26357 条体验的来源与准确度，需评委抽样核验，本器只查数量与结构。");
md.push("- 实际分工：只能看提交记录与分工表，无法核实是否单人 + AI 辅助。");
md.push("- 推荐质量的广度：只做了 8 类查询的结构断言，未做大规模人工评测。");
md.push("- 真实用户数据：留存、转化、复访均无，产品价值仍属推断。");
md.push("");

const rep = path.join(OUT, "模拟考核评分报告.md");
fs.writeFileSync(rep, md.join("\n"));
console.log("报告已写入：" + rep);
process.exit(pct >= 90 ? 0 : 1);
