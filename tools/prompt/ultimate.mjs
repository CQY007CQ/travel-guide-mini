/**
 * tools/prompt/ultimate.mjs —— v1.20.11 终极提示词的加载器与自检出口
 *
 * 提示词正文放在 ultimate.md（纯 Markdown），本脚本只负责：
 *   ① 加载与自适应（输出到 docs / 供工具链读取）
 *   ② 结构自检：8 字段是否齐全、3 个卡点是否在、五级优先级是否成链、矛盾三条是否消解
 *   ③ 与冠军 C15 的差异登记：逐条说明「为什么不是照抄冠军」
 *
 * 冠军判定与升级理由见文件末尾 DIFF_FROM_CHAMPION。
 *
 * 用法：node tools/prompt/ultimate.mjs [--md out.md] [--check]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ULTIMATE_PATH = path.join(HERE, "ultimate.md");

export function loadUltimate() {
  return fs.readFileSync(ULTIMATE_PATH, "utf8");
}

/** 冠军 C15 的已知弱点 → 终极版对应修复（可被门禁逐条核验） */
export const DIFF_FROM_CHAMPION = [
  {
    weakness: "C2=78 / R3=78：单一 5000 字上限，实测模型守不住总字数",
    fix: "改分层配额（正文 ≤1200 / actions+risks ≤600 / selfcheck ≤200）+ 超配额时的删减顺序",
    probe: /正文（task…verdict）≤1200 字/,
  },
  {
    weakness: "C4=88：深推 + 五项自检会把答案写成过程日志（软冲突）",
    fix: "显式写「思考过程不外倒，只把每阶段一句话结论写进字段」+ 自检独立占字段不计正文配额",
    probe: /思考过程不外倒/,
  },
  {
    weakness: "C3=83：术语密度拉满，读者反而更难读",
    fix: "保留工程术语但要求首现一句话解释",
    probe: /首次出现时用一句话解释/,
  },
  {
    weakness: "C05 暴露的缺口：A4=88（会标不确定性）但 R2=30（无降级路径），二者互不覆盖",
    fix: "把「标注不确定」与「证据不足怎么补」拆成两条独立条款分别写",
    probe: /降级为「待确认」并写清怎么确认/,
  },
  {
    weakness: "C13 暴露的缺口：R2=62，同样只有一侧",
    fix: "同上，双侧补齐",
    probe: /不确定就写明不确定，并给出「怎么才能确定」的具体下一步/,
  },
  // ── 以下三条来自真跑（C05/C13/C15 各跑一遍同题），不是静态推理出来的 ──
  {
    weakness: "真跑暴露①：三份都没给出可复现的计数命令（两份写 11、一份写 12，实为 11）。" +
              "且我自己的单行 grep 也数错过——漏掉跨行调用的 today-proactive，只得 10：注释是对的，错的是尺子",
    fix: "数量类数字必须自己数、附可复现命令，并验证计数工具能覆盖跨行写法；注释数字只作线索",
    probe: /数量类数字必须自己数，且要验证计数工具本身/,
  },
  {
    weakness: "真跑暴露②：四类自检的字面落地率 0/3，模型都换成自己的分类（事实/格式/边界/动作）",
    fix: "selfcheck 五条逐字锁标签，不许换词、不许合并",
    probe: /逐字以「错别字：」「逻辑漏洞：」/,
  },
  {
    weakness: "真跑暴露③：格式自洽仅 17–50 分，无一家严守自述格式（C13 只命中 1/6 项）",
    fix: "8 个字段名逐字出现、各占一行，不许改写成中文标题、不许合并",
    probe: /8 个字段名必须\*\*逐字出现/,
  },
];

/** 必备结构断言：缺任何一条，终极提示词就不成其为终极 */
export const REQUIRED = [
  { name: "角色身份", re: /## 0\. 角色（固定身份 \/ 行为规则 \/ 能力边界）/ },
  { name: "复述确认", re: /## 1\. 任务复述确认/ },
  { name: "检索先于推理", re: /## 2\. 事实获取（★ 必须先于推理）/ },
  { name: "分步思维链四阶段", re: /## 3\. 分步思维链（四阶段/ },
  { name: "三条独立链 + 多数投票", re: /3 条互不参照的推理链[\s\S]{0,80}多数投票/ },
  { name: "三处自我检查卡点", re: /CP1[\s\S]{0,400}CP2[\s\S]{0,400}CP3/ },
  { name: "字段级输出格式", re: /## 5\. 输出格式（字段级锁定/ },
  { name: "分层篇幅配额", re: /## 6\. 语言与篇幅（分层配额/ },
  { name: "五级冲突裁决", re: /## 7\. 冲突裁决/ },
  { name: "项目业务约束", re: /## 8\. 业务约束/ },
  { name: "思考开关", re: /## 9\. 思考开关/ },
  { name: "复述闭环收尾", re: /READY: 已按 8 字段交付/ },
];

const FIELDS = ["task", "restate", "evidence", "chain", "verdict", "actions", "risks", "selfcheck"];

export function checkStructure(text = loadUltimate()) {
  const fails = [];
  for (const r of REQUIRED) if (!r.re.test(text)) fails.push("缺必备段落：" + r.name);
  for (const f of FIELDS) if (!new RegExp(`\\| ${f} \\|`).test(text)) fails.push("缺输出字段：" + f);
  const prio = (text.match(/^\d\. \*\*/gm) || []).length;
  if (prio < 5) fails.push(`冲突裁决优先级不足 5 级（现 ${prio}）`);
  for (const d of DIFF_FROM_CHAMPION) if (!d.probe.test(text)) fails.push("冠军弱点未修复：" + d.weakness.slice(0, 28));
  const greedy = /greedy decoding/.test(text);
  if (!greedy) fails.push("缺「禁用 greedy decoding」（Qwen3 官方采样建议）");
  const noThinkHistory = /历史只保留最终输出/.test(text);
  if (!noThinkHistory) fails.push("缺「历史不回填思考内容」（Qwen3 多轮建议）");
  return fails;
}

function main() {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf("--md");
  const text = loadUltimate();
  if (mi >= 0 && argv[mi + 1]) {
    fs.mkdirSync(path.dirname(argv[mi + 1]), { recursive: true });
    fs.writeFileSync(argv[mi + 1], text, "utf8");
    console.log("md → " + argv[mi + 1]);
    return;
  }
  const fails = checkStructure(text);
  console.log(`终极提示词：${text.length} 字 / 必备段落 ${REQUIRED.length} 条 / 输出字段 ${FIELDS.length} 个 / 冠军弱点修复 ${DIFF_FROM_CHAMPION.length} 条`);
  if (fails.length) { fails.forEach((f) => console.log("  ✗ " + f)); process.exitCode = 1; return; }
  console.log(`结构自检：全部通过（含冠军弱点 ${DIFF_FROM_CHAMPION.length} 条修复、Qwen3 采样与多轮建议）`);
  if (argv.includes("--check")) console.log("--check 模式：仅校验，不写文件");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
