/**
 * tools/prompt/pool.mjs —— v1.20.11 元提示词候选池（零依赖，纯 Node，可复跑幂等）
 *
 * 目标：为「升级晨的旅行助手 v1.20.10」这一真实任务，规模化生成 16 条
 *      不同侧重点的候选提示词，全部由 8 个可调维度的**条款库**渲染而成，
 *      因此每条都是可独立执行的完整提示词，而不是标签组合。
 *
 * 8 个可调维度（每维 5 档，取值 1..5）：
 *   推理深度 / 输出篇幅 / 格式严格度 / 情感倾向 / 术语密度 / 检索依赖 / 自检强度 / 风险姿态
 *
 * 为什么用「渲染」而不是手写 16 份全文：
 *   · 手写 16 份必然出现条款措辞漂移，比对时就分不清「分数差来自设计还是来自笔误」；
 *   · 渲染保证除被调维度外，其余条款逐字相同，差异归因才成立。
 *
 * 设计红线（源自本轮 2025+ 检索材料）：
 *   · 指令层级冲突会实质降低模型表现（OpenAI GPT-5 Prompting Guide）→ 故实现
 *     detectConflicts()，把「深推 × 极简」「高术语 × 热忱」这类互斥组合标出来，
 *     而不是让它们静默进候选池等到评分阶段才露馅。
 *   · 输出侧只放「可核验的推理摘要」，不倒出原始思维流（Qwen3：历史中不含思考内容）。
 *
 * 用法：node tools/prompt/pool.mjs [--md out.md]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── 一、维度定义（档位标签只用于人读，评分侧一律用 1..5 数值） ──
export const DIMS = [
  { key: "depth",     name: "推理深度",   levels: ["直给", "浅推", "标准", "加权", "深推"] },
  { key: "length",    name: "输出篇幅",   levels: ["极简", "精简", "标准", "详尽", "完整"] },
  { key: "format",    name: "格式严格度", levels: ["自由", "半结构", "结构", "强结构", "字段级"] },
  { key: "tone",      name: "情感倾向",   levels: ["冷静", "克制", "中性", "温和", "热忱"] },
  { key: "jargon",    name: "术语密度",   levels: ["零术语", "低", "中", "高", "专业"] },
  { key: "retrieval", name: "检索依赖",   levels: ["零检索", "可选", "建议", "强制", "强制引用"] },
  { key: "selfcheck", name: "自检强度",   levels: ["无", "一次", "分项", "分项复跑", "分项复跑红队"] },
  { key: "risk",      name: "风险姿态",   levels: ["极保守", "保守", "稳健", "积极", "进取"] },
];

// ── 二、条款库：每维每档一句话，渲染时按档位取用 ──
const C = {
  depth: [
    "直接给结论与行动，不解释依据。",
    "先给结论，再补 1 句依据。",
    "先厘清意图与已知条件，再给结论与依据。",
    "先厘清意图与已知条件，再列出候选路径并比较取舍，最后给结论与依据。",
    "先厘清意图与已知条件，再列候选路径与取舍理由，逐条标注证据来源与不确定性，最后给结论、依据与「若证据不足则如何」。",
  ],
  length: [
    "总篇幅 ≤300 字，只保留结论与第一个动作。",
    "总篇幅 ≤600 字，每节 ≤2 条。",
    "总篇幅 ≤1200 字，每节 ≤4 条。",
    "总篇幅 ≤2500 字，允许分节展开与举例。",
    "总篇幅 ≤5000 字，允许完整分节、表格与逐项展开。",
  ],
  format: [
    "用自然段作答，不强制标题。",
    "分点作答，节标题用「一、二、三」。",
    "固定四节：结论 / 依据 / 待确认 / 下一步。节标题各占一行，不得调序。",
    "固定四节：结论 / 依据 / 待确认 / 下一步；每节标题独占一行，结论节首句必须是任务复述。",
    "输出为固定字段清单，字段名与顺序锁定：`task` / `restate` / `evidence` / `chain` / `verdict` / `actions` / `risks` / `selfcheck`；每个字段一行，空字段写 `NONE`，不得新增字段、不得改字段名。",
  ],
  tone: [
    "语气冷静，不加任何修饰。",
    "语气克制，不用感叹句。",
    "语气中性，专业陈述。",
    "语气温和，可用「建议」「可以考虑」。",
    "语气热忱，可用感叹与鼓励句。",
  ],
  jargon: [
    "不使用任何专业术语，全部用日常说法。",
    "术语尽量换成日常说法，必须用时首次出现加一句解释。",
    "术语照常使用，不做额外解释。",
    "偏好行业术语（如「门禁」「棘轮」「真源」「分块」「回流」），不解释。",
    "全程使用专业工程术语，允许缩写（如 gate / ratchet / SSOT / fail-fast / idempotent）。",
  ],
  retrieval: [
    "不检索，仅凭上下文作答。",
    "可选检索：需要外部事实时才查。",
    "建议检索：涉及版本、数量、政策时先查再答。",
    "强制检索：动笔前必须先从外部知识库取回真实材料，作为上下文再作答。",
    "强制检索并引用：动笔前必须取回真实材料；每条关键结论后须标出来源（标题或 URL），无来源的结论必须删除或降级为「待确认」。",
  ],
  selfcheck: [
    "无自检环节。",
    "交付前通读一遍，改错别字。",
    "交付前逐项自检：错别字 / 逻辑漏洞 / 代码 bug / 数据准确性，各给一行结论。",
    "交付前逐项自检四类问题并**复跑一次**关键校验（能脚本化的脚本化），两次结果不一致以复跑为准。",
    "交付前逐项自检四类问题、复跑关键校验，并做一轮红队：主动假设自己是错的，列出 3 条最可能出错的判断及其反证方式。",
  ],
  risk: [
    "遇到不确定一律停下来提问，不推进。",
    "保守：只做已确认的事，任何猜测都要显式标注「未核实」。",
    "稳健：按证据推进，证据不足处显式标注并给出补齐办法。",
    "积极：允许在低风险处自行决策，事后集中说明假设。",
    "进取：优先推进最大化收益的动作，风险点后置说明。",
  ],
};

// ── 三、公共骨架（所有候选逐字共享，保证差异只来自被调维度） ──
const SKELETON = {
  identity: [
    "你是「晨的旅行助手」项目的资深工程师兼提示词工程师。该项目是一个微信小程序（AppID wxa365d49bc3366f95，lib 3.8.12，当前版本 v1.20.10），",
    "同时在 outputs/miniprogram-travel/ 下维护一份同源网页版。你只对这个真实仓库负责，不为演示编写虚构代码。",
  ].join(""),
  boundary: [
    "能力边界（不可越）：",
    "· 只能依据随附的真实仓库事实与检索到的真实材料作答；仓库里没有的数字一律不得出现。",
    "· 不得编造：景点、票价、坐标、医院名、评分、评价、政策文号、接口配额。",
    "· 不得改动门禁口径（allcheck.sh 锁 61 步）、不得下调阈值来「让检查变绿」。",
    "· 不得启动图形界面、不得动用户个人目录。",
    "· 涉及用户本人身份的动作（平台提审、账号授权、密钥轮换）只列出、不代做。",
  ].join("\n"),
  restate: "开始前用你自己的话复述一次任务目标、输入事实与交付物，确认无误再继续。",
  vote: [
    "对关键判断（改什么、不改什么、优先级排序）独立生成 3 条互不参照的推理链，",
    "分别给出结论；再按「出现频次最高且内部无矛盾」选一条作为最终结论，",
    "并在输出中说明三条链是否有分歧、分歧点在哪。",
  ].join(""),
};

// ── 四、16 条候选（8 维向量 + 侧重点命名） ──
// 顺序：depth, length, format, tone, jargon, retrieval, selfcheck, risk
export const CANDIDATES = [
  { id: "C01", name: "极简直给", focus: "把结论与第一个动作压到最短", v: [1, 1, 2, 3, 1, 1, 1, 3] },
  { id: "C02", name: "轻量随行", focus: "低门槛、零术语、可直接照做", v: [2, 2, 2, 3, 1, 2, 1, 3] },
  { id: "C03", name: "标准通用", focus: "四节结构 + 中性语气的基线款", v: [3, 3, 3, 3, 2, 3, 2, 3] },
  { id: "C04", name: "结构派", focus: "强结构 + 结构决定评分可复算", v: [3, 3, 5, 2, 3, 4, 3, 2] },
  { id: "C05", name: "严谨审计", focus: "证据链优先，允许长文逐条溯源", v: [4, 4, 5, 2, 4, 5, 4, 1] },
  { id: "C06", name: "检索优先", focus: "强制先取外部材料再动笔", v: [3, 3, 4, 3, 3, 5, 3, 2] },
  { id: "C07", name: "深推慢想", focus: "多路径比较 + 标注不确定性", v: [5, 4, 4, 2, 3, 4, 4, 2] },
  { id: "C08", name: "风险守门", focus: "红队自检 + 极保守推进", v: [3, 3, 5, 2, 3, 4, 5, 1] },
  { id: "C09", name: "交付物导向", focus: "以验收口径倒推交付形态", v: [3, 4, 5, 3, 3, 4, 4, 3] },
  { id: "C10", name: "保守克制", focus: "不确定就停，绝不猜测", v: [2, 2, 3, 2, 2, 3, 3, 1] },
  { id: "C11", name: "数据实证", focus: "每个数字都要能在仓库里查到", v: [4, 4, 4, 2, 4, 5, 3, 2] },
  { id: "C12", name: "全链自检", focus: "自检复跑写进流程而非附录", v: [3, 3, 4, 3, 3, 4, 5, 2] },
  { id: "C13", name: "工程字段级", focus: "输出即机器可校验的字段清单", v: [4, 3, 5, 2, 4, 5, 4, 3] },
  { id: "C14", name: "热忱陪同", focus: "低术语 + 高情绪价值", v: [3, 3, 3, 5, 2, 3, 2, 4] },
  { id: "C15", name: "极深全量", focus: "所有维度拉满（压力样本）", v: [5, 5, 5, 2, 5, 5, 5, 2] },
  { id: "C16", name: "平衡收敛", focus: "各维中高位，追求无短板", v: [4, 4, 4, 3, 3, 4, 4, 2] },
];

// ── 五、指令冲突检测（硬冲突=条款互斥；软冲突=需显式优先级才能共存） ──
const HARD_RULES = [
  { when: (d) => d.depth >= 4 && d.length <= 2, why: "要求深推却把篇幅限到极简：推理空间与字数预算互斥" },
  { when: (d) => d.jargon >= 4 && d.tone >= 4, why: "高术语密度与热忱口吻争夺同一表达预算：同一句话既要术语又要感叹" },
  { when: (d) => d.risk >= 4 && d.retrieval >= 5, why: "进取姿态与强制引用冲突：无来源就要删结论，进取动作无法落地" },
  { when: (d) => d.selfcheck >= 5 && d.length <= 2, why: "五项自检 + 红队无处安放：极简篇幅装不下自检结论" },
  { when: (d) => d.format >= 5 && d.length <= 1, why: "字段级格式至少需要 8 行，与 ≤300 字上限直接对撞" },
];

const SOFT_RULES = [
  { when: (d) => d.risk >= 4 && d.format >= 5, why: "进取与字段级硬格式相互挤压：需显式写「格式优先于推进速度」" },
  { when: (d) => d.jargon >= 4 && d.length <= 2, why: "高术语 + 精简篇幅：术语解释与字数预算需要取舍" },
  { when: (d) => d.depth >= 5 && d.selfcheck >= 4, why: "深推 + 分项复跑自检：易把输出写成过程日志，需限定「只输出结论与自检结论」" },
  { when: (d) => d.retrieval >= 4 && d.length <= 2, why: "强制引用 + 精简篇幅：来源标注会挤占正文预算" },
];

export function toVec(arr) {
  const d = {};
  DIMS.forEach((dim, i) => { d[dim.key] = arr[i]; });
  return d;
}

export function detectConflicts(vec) {
  const hard = HARD_RULES.filter((r) => r.when(vec)).map((r) => r.why);
  const soft = SOFT_RULES.filter((r) => r.when(vec)).map((r) => r.why);
  return { hard, soft };
}

// ── 六、渲染：把 8 维向量渲染成一条可独立执行的完整提示词 ──
export function render(cand) {
  const d = toVec(cand.v);
  const L = [];
  L.push(`# 候选 ${cand.id} · ${cand.name}`);
  L.push(`> 侧重点：${cand.focus}`);
  L.push("");
  L.push("## 角色");
  L.push(SKELETON.identity);
  L.push("");
  L.push("## 任务");
  L.push("对当前仓库（v1.20.10）做一次可落地的升级评估，产出「改什么、为什么改、怎么验证」的方案。");
  L.push("");
  L.push("## 执行步骤");
  L.push("1. 复述确认：" + SKELETON.restate);
  L.push("2. 取事实：" + C.retrieval[d.retrieval - 1]);
  L.push("3. 推理：" + C.depth[d.depth - 1]);
  L.push("4. 多链投票：" + SKELETON.vote);
  L.push("5. 自检：" + C.selfcheck[d.selfcheck - 1]);
  L.push("");
  L.push("## 输出格式");
  L.push(C.format[d.format - 1]);
  L.push("");
  L.push("## 语言与篇幅");
  L.push(`语气：${C.tone[d.tone - 1]}`);
  L.push(`用词：${C.jargon[d.jargon - 1]}`);
  L.push(`篇幅：${C.length[d.length - 1]}`);
  L.push("");
  L.push("## 约束");
  L.push(C.risk[d.risk - 1]);
  L.push(SKELETON.boundary);
  return L.join("\n");
}

export function vecToText(v) {
  return DIMS.map((dim, i) => `${dim.name}=${v[i]}`).join(" / ");
}

// ── 七、自检出口：冲突 × 向量合法性 ──
export function auditPool() {
  const issues = [];
  for (const c of CANDIDATES) {
    if (c.v.length !== DIMS.length) issues.push(`${c.id} 向量长度 ${c.v.length} ≠ ${DIMS.length}`);
    if (c.v.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) issues.push(`${c.id} 存在越界档位`);
    const { hard } = detectConflicts(toVec(c.v));
    if (hard.length) issues.push(`${c.id} 硬冲突 ${hard.length} 条：${hard[0]}`);
  }
  const ids = new Set(CANDIDATES.map((c) => c.id));
  if (ids.size !== CANDIDATES.length) issues.push("候选 id 不唯一");
  const sigs = new Set(CANDIDATES.map((c) => c.v.join(",")));
  if (sigs.size !== CANDIDATES.length) issues.push("存在向量完全相同的候选（差异归因失效）");
  return issues;
}

function main() {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf("--md");
  const mdPath = mi >= 0 ? argv[mi + 1] : "";

  const issues = auditPool();
  console.log(`候选池：${CANDIDATES.length} 条 × ${DIMS.length} 维`);
  if (issues.length) {
    console.log("自检问题：");
    issues.forEach((s) => console.log("  ✗ " + s));
    process.exitCode = 1;
    return;
  }
  console.log("自检：0 问题（向量合法 / id 唯一 / 无重复向量 / 无硬冲突）");
  for (const c of CANDIDATES) {
    const { soft } = detectConflicts(toVec(c.v));
    console.log(`  ${c.id} ${c.name.padEnd(6, "　")} ${vecToText(c.v)}${soft.length ? `  ⚠软冲突${soft.length}` : ""}`);
  }

  if (mdPath) {
    const out = [];
    out.push("# 候选提示词池 v1.20.11（16 条 × 8 维）");
    out.push("");
    out.push("生成器：`node tools/prompt/pool.mjs`。本文件由脚本产出，手改会被下一次生成覆盖。");
    out.push("");
    out.push("| ID | 侧重点 | 八维向量 | 软冲突 |");
    out.push("| --- | --- | --- | --- |");
    for (const c of CANDIDATES) {
      const { soft } = detectConflicts(toVec(c.v));
      out.push(`| ${c.id} | ${c.name}：${c.focus} | ${vecToText(c.v)} | ${soft.length} |`);
    }
    out.push("");
    for (const c of CANDIDATES) out.push("---", "", render(c));
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, out.join("\n") + "\n", "utf8");
    console.log(`已写出：${path.relative(process.cwd(), mdPath)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
