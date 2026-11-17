/**
 * tools/prompt/verify-output.mjs —— v1.20.11 真跑产出的输出侧体检（零依赖）
 *
 * 与 rank.mjs 的分工：
 *   rank.mjs  评「提示词契约」的静态可执行性（输入侧）
 *   本脚本    评「模型真跑出来的答案」（输出侧）—— 事实可核验率等，只有真跑才有得测
 *
 * 四项输出侧指标（都基于可观察证据，不做主观打分）：
 *   G1 事实可核验率：抽取答案里所有数字型断言，逐条回仓库/事实清单核对，命中率
 *   G2 格式自洽度：答案是否遵守了它自己声明的输出格式
 *   G3 自检落地度：四类自检（错别字/逻辑漏洞/代码 bug/数据准确性）是否真给了结论
 *   G4 动作可执行性：可落地动作条数（带文件路径或命令或验收口径的才算）
 *
 * 用法：node tools/prompt/verify-output.mjs <output.md> [--json out.json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// ── 二、抽取数字型断言 ──
// 覆盖：版本号 1.20.10 / 带单位数量 359KB、61 步、872 城 / 百分比 / 大整数
const NUM_PATTERNS = [
  /\b\d+\.\d+\.\d+\b/g,                 // 版本号
  /\b\d+(?:\.\d+)?\s?(?:KB|MB|GB)\b/g,  // 体积
  /\b\d+\s?(?:步|城|个|条|家|点|行|层|项|处|篇|轮|类|次|天)/g,
  /\b\d{2,}\b/g,                        // 两位以上整数
];

function extractAssertions(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  const seen = new Set();
  const out = [];
  for (const re of NUM_PATTERNS) {
    for (const m of body.match(re) || []) {
      const key = m.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function norm(s) { return String(s).replace(/\s+/g, " "); }

// ── 事实清单单独留存：只有「清单里查得到」才算输入侧已核验 ──
// 首版把整个仓库拼成语料库做 substring 匹配，结果三份答案的 G1 全是 100%——
// 语料库几十万字符，任何两位数字都能命中，**这是假绿**（与「断言源码含某串字 ≠ 断言行为」同源）。
// 改为三分类：清单内 / 有来源标注 / 无据。
const FACTS = (() => {
  try { return fs.readFileSync(path.join(HERE, "lab", "v1211-facts.md"), "utf8"); } catch { return ""; }
})();

const SOURCE_RE = /(?:[\w./-]+\.(?:js|mjs|json|wxml|wxss|md|sh|py)\b|\bnode\s+tools\/|\.\/allcheck\.sh|\bdu\s+-sk|\bgrep\s|check-[a-z-]+|_test-[a-z-]+)/;

/** 判定单个数字断言：facts=清单内 / cited=同段给了来源 / unbacked=无据
 *  注意必须只看「含该 token 的那些行」——首版把全部行都传进来，只要文中有任意一条带来源，
 *  所有数字都会被判成 cited，等于没查。 */
function classify(token, lines) {
  if (FACTS.includes(token)) return "facts";
  const bare = token.replace(/[^\d.]/g, "");
  if (bare && FACTS.includes(bare)) return "facts";
  const own = lines.filter((l) => l.includes(token));
  return own.some((l) => SOURCE_RE.test(l)) ? "cited" : "unbacked";
}

// ── 三、格式自洽 / 自检落地 / 动作可执行 ──
const FORMAT_PROBES = [
  { key: "四节结构", re: /结论[\s\S]{0,40}依据[\s\S]{0,40}待确认[\s\S]{0,40}下一步/ },
  { key: "字段清单", re: /(^|\n)\s*[`*]{0,2}(task|restate|evidence|chain|verdict|actions|risks|selfcheck)[`*]{0,2}\s*[:：]/m },
  { key: "复述段", re: /(复述|我的理解|任务理解)/ },
  { key: "投票/多链", re: /(链\s*[1231-3]|三条链|多数投票|链一|链二|链三)/ },
  { key: "编号步骤", re: /(^|\n)\s*\d[.、]\s+\S/m },
  { key: "表格", re: /\|[^\n|]+\|[^\n|]+\|/ },
];

function scoreFormatSelfConsistency(text) {
  const hit = FORMAT_PROBES.filter((p) => p.re.test(text)).map((p) => p.key);
  return { hit, score: Math.round((hit.length / FORMAT_PROBES.length) * 100) };
}

const SELFCHECK_PROBES = [
  { key: "错别字", re: /错别字/ },
  { key: "逻辑漏洞", re: /逻辑(漏洞|问题|缺口)/ },
  { key: "代码bug", re: /(代码\s?bug|代码缺陷|代码问题)/i },
  { key: "数据准确性", re: /数据(准确性|准确|核对|校验)/ },
  { key: "复跑", re: /(复跑|重跑|再跑一次|重新运行)/ },
];

function scoreSelfCheck(text) {
  const hit = SELFCHECK_PROBES.filter((p) => p.re.test(text)).map((p) => p.key);
  return { hit, score: Math.round((hit.length / SELFCHECK_PROBES.length) * 100) };
}

function countActions(text) {
  // 输出有两种分段风格：单行内用 ①②③，或每行用 "1. " 起头。两种都要认——
  // 首版只认 ①②③，导致终极真跑（用 "1. " 编号）被判 0 条，是判据自身的假阴性。
  const parts = text.split(/(?=[①②③④⑤⑥⑦⑧⑨]|^\d+\. )/m).filter(Boolean);
  const acts = parts.filter((s) => /[①②③④⑤⑥⑦⑧⑨]|^P?\d*\.?\s/.test(s.slice(0, 4)) && (SOURCE_RE.test(s) || /验收|断言|门禁/.test(s)));
  const withPath = acts.filter((s) => /[\w/-]+\.(?:js|mjs|json|wxml|wxss|md|sh)\b/.test(s));
  return { total: acts.length, withPath: withPath.length };
}

// ── 四、主流程 ──
export function verify(file) {
  const raw = fs.readFileSync(file, "utf8");
  const text = raw.replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split("\n");
  const asserts = extractAssertions(text);
  const detail = asserts.map((t) => ({ token: t, verdict: classify(t, lines) }));
  const nFacts = detail.filter((d) => d.verdict === "facts").length;
  const nCited = detail.filter((d) => d.verdict === "cited").length;
  const nBad = detail.filter((d) => d.verdict === "unbacked");
  const fmt = scoreFormatSelfConsistency(text);
  const self = scoreSelfCheck(text);
  const act = countActions(text);
  return {
    file: path.relative(process.cwd(), file),
    chars: text.length,
    G1: {
      total: asserts.length, facts: nFacts, cited: nCited, unbacked: nBad.length,
      rate: asserts.length ? +((nFacts + nCited) / asserts.length).toFixed(4) : 0,
      unbackedList: nBad.map((d) => d.token),
    },
    G2: fmt, G3: self, G4: act,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const ji = argv.indexOf("--json");
  // 参数值本身不是文件：把 --json 后面的那个值剔除，否则会被当成待检文件（实测踩过）。
  // 注意 --json 缺席时 ji = -1，ji+1 = 0 会把第一个文件也剔掉 → 必须判断 ji >= 0。
  const files = argv.filter((a, i) => !a.startsWith("--") && !(ji >= 0 && i === ji + 1));
  if (!files.length) { console.error("用法: node tools/prompt/verify-output.mjs <output.md> [...] [--json out.json]"); process.exitCode = 2; return; }
  const res = files.map(verify);
  for (const r of res) {
    console.log(`${r.file}`);
    console.log(`  字数 ${r.chars} | G1 可核验 ${r.G1.facts + r.G1.cited}/${r.G1.total} = ${(r.G1.rate * 100).toFixed(1)}%（清单内 ${r.G1.facts} / 带来源 ${r.G1.cited} / 无据 ${r.G1.unbacked}）`);
    console.log(`  G2 格式自洽 ${r.G2.score} [${r.G2.hit.join("/")}]`);
    console.log(`  G3 自检落地 ${r.G3.score} [${r.G3.hit.join("/")}]`);
    console.log(`  G4 动作 ${r.G4.total} 条（含明确文件路径 ${r.G4.withPath}）`);
    if (r.G1.unbackedList.length) console.log(`  无据数字：${r.G1.unbackedList.slice(0, 12).join(", ")}${r.G1.unbackedList.length > 12 ? ` …共${r.G1.unbackedList.length}` : ""}`);
  }
  if (ji >= 0) { fs.writeFileSync(argv[ji + 1], JSON.stringify(res, null, 2), "utf8"); console.log("json → " + argv[ji + 1]); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
