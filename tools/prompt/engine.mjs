/**
 * tools/prompt/engine.mjs —— 提示词工程流水线（零依赖，纯 Node）
 *
 * 两段规格落地：
 *   一、提示词八项纪律：分步思考 / 多链投票 / 角色边界 / 格式强制 / 约束 /
 *       自我修正 / 复述确认 / 检索注入（RAG）
 *   二、自动化四步：元模板 → 批量变体 → 自动评分 → 迭代优化 → 终极提示词
 *
 * 设计原则：
 *   · 不联网、不调用大模型、不编造执行结果 —— 评分是对「提示词文本契约」的静态体检，
 *     与 prompt-lab 的真机执行评测互补（后者有真实 runs/*.md 证据）。
 *   · 所有分数可复算：同一输入必得同一输出，便于纳入门禁防回潮。
 *
 * 用法：node tools/prompt/engine.mjs [--json out.json]
 */

// ── 一、元提示模板：固定身份 / 行为规则 / 能力边界 / 格式 / 约束 / 八项纪律 ──
export const META = {
  identity: "你是「晨的旅行助手」的旅行管家，服务于一个离线优先的微信小程序用户。",
  behavior: [
    "分步思考：先厘清意图，再检索本机上下文，最后作答",
    "多链投票：复杂问题独立生成 ≥2 条思维链，按逻辑自洽度多数投票",
    "复述确认：开始前用一句话复述用户问题与已知条件",
    "自我修正：输出前检查错别字、逻辑漏洞、数据准确性"
  ],
  boundary: [
    "只依据随附的本机真实上下文与公开常识作答",
    "不编造景点、票价、坐标、医院、营业时间、评分与评价",
    "不生成伪行程；完整行程/订票/支付引导去 App 内对应功能",
    "急症第一句提示拨打 120，明确不替代医生"
  ],
  format: [
    "简体中文、分点、克制 emoji",
    "固定四段：结论 / 依据 / 共识度 / 提示",
    "依据必须标注来自「本机上下文」还是「公开常识」"
  ],
  constraints: [
    "必须使用 2025 年之后的政策与市场信息，旧数据需标注年份",
    "不加入主观臆断；不确定的信息明确说「暂无数据」",
    "篇幅 ≤ 400 字；每条建议必须可操作"
  ],
  disciplines: ["cot", "vote", "role", "format", "constraint", "selfcheck", "restate", "rag"]
};

// 八个纪律的可插拔文本片段（变体通过开关与措辞强度微调）
const D = {
  cot: "【分步思考】先列出意图→已知条件→推理步骤→结论，不得跳步。",
  vote: "【多链投票】对复杂问题独立生成 2-3 条思维链，逐条检验与上下文的一致性，取出现频率最高且最自洽的结论；分歧时如实说明。",
  role: "【角色边界】你是旅行管家，不是搜索引擎也不是医生；只给可操作建议，不做重决定。",
  format: "【格式强制】严格按「结论/依据/共识度/提示」四段输出，每段独立成行，不得增删段落。",
  constraint: "【约束】只用 2025 年后的政策与市场信息；不编造、不臆断、不加入未核实的数字；缺失信息写「暂无数据」。",
  selfcheck: "【自我修正】输出前逐项自检：错别字、前后矛盾、数据是否与上下文一致；发现问题就地改正后再输出。",
  restate: "【复述确认】开头用一句话复述「你要什么 + 已知条件」，再进入正文。",
  rag: "【检索增强】事实优先取自随附的「本机上下文」；引用时标明来源段落；上下文未覆盖的用公开常识并标注。"
};

// 差异化维度：推理深度 / 篇幅 / 格式严格度 / 情感倾向 / 术语比例
export const DIMENSIONS = {
  depth: ["brief", "standard", "deep"],
  length: ["tiny", "mid", "long"],
  strict: ["loose", "normal", "strict"],
  tone: ["neutral", "warm", "terse"],
  jargon: ["low", "mid", "high"]
};

/**
 * 生成 10-20 个候选变体。
 * 变体不是随机文本，而是「元模板的纪律开关 + 五维参数」的确定性组合。
 */
export function generateVariants(n = 14) {
  const presets = [
    { name: "通用均衡",       depth: "standard", length: "mid",   strict: "normal", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "极简速答",       depth: "brief",    length: "tiny",  strict: "loose",  tone: "terse",  toneOn: false, jargon: "low",  off: ["vote", "restate"] },
    { name: "深度专家",       depth: "deep",     length: "long",  strict: "strict", tone: "neutral", toneOn: false, jargon: "high", off: [] },
    { name: "暖心陪伴",       depth: "standard", length: "mid",   strict: "loose",  tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
    { name: "多链投票强化",   depth: "deep",     length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "检索优先",       depth: "standard", length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: ["vote"] },
    { name: "小白向导",       depth: "standard", length: "mid",   strict: "loose",  tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
    { name: "商务差旅",       depth: "brief",    length: "short", strict: "strict", tone: "terse",  toneOn: false, jargon: "high", off: ["restate"] },
    { name: "亲子出游",       depth: "standard", length: "mid",   strict: "normal", tone: "warm",   toneOn: true,  jargon: "low",  off: [] },
    { name: "硬核数据",       depth: "deep",     length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "high", off: ["restate"] },
    { name: "极客可控",       depth: "brief",    length: "tiny",  strict: "strict", tone: "terse",  toneOn: false, jargon: "high", off: ["vote", "restate"] },
    { name: "安抚情绪",       depth: "brief",    length: "mid",   strict: "loose",  tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote", "selfcheck"] },
    { name: "严谨学术",       depth: "deep",     length: "long",  strict: "strict", tone: "neutral", toneOn: false, jargon: "high", off: [] },
    { name: "轻量对话",       depth: "brief",    length: "short", strict: "loose",  tone: "neutral", toneOn: false, jargon: "low",  off: ["vote", "selfcheck", "restate"] },
    { name: "格式优先",       depth: "standard", length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "证据链强化",     depth: "deep",     length: "long",  strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: ["restate"] },
    { name: "快速决策",       depth: "standard", length: "short", strict: "normal", tone: "terse",  toneOn: false, jargon: "mid",  off: ["vote"] },
    { name: "长辈友好",       depth: "standard", length: "mid",   strict: "normal", tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
    { name: "零臆断",         depth: "deep",     length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "平衡收敛",       depth: "standard", length: "mid",   strict: "normal", tone: "neutral", toneOn: false, jargon: "mid",  off: [] }
  ];
  return presets.slice(0, Math.max(10, Math.min(20, n))).map((p, i) => {
    const parts = [META.identity];
    for (const k of META.disciplines) if (!p.off.includes(k)) parts.push(D[k]);
    parts.push("【行为】" + META.behavior.join("；"));
    parts.push("【能力边界】" + META.boundary.join("；"));
    if (p.toneOn) parts.push("【语气】温和耐心，避免生硬说教。");
    if (p.jargon === "low") parts.push("【术语】避免专业术语，用日常表达。");
    return {
      id: "V" + String(i + 1).padStart(2, "0"),
      name: p.name,
      params: { depth: p.depth, length: p.length, strict: p.strict, tone: p.tone, jargon: p.jargon },
      text: parts.join("\n")
    };
  });
}

// ── 三、自动评分：准确性 / 可控性 / 完整性 / 鲁棒性（静态可复算） ──
export function scoreVariant(v) {
  const t = v.text, p = v.params;
  const has = (k) => t.includes("【" + ({ cot: "分步思考", vote: "多链投票", role: "角色边界", format: "格式强制", constraint: "约束", selfcheck: "自我修正", restate: "复述确认", rag: "检索增强" })[k] + "】");

  // 准确性：检索增强 + 约束年份 + 不编造 + 来源标注
  const accuracy = 20 * (has("rag") ? 1 : 0) + 20 * (/2025/.test(t) ? 1 : 0)
    + 20 * (/不编造|不臆断/.test(t) ? 1 : 0) + 20 * (/来源|标明/.test(t) ? 1 : 0)
    + 20 * (/暂无数据|不确定/.test(t) ? 1 : 0);

  // 可控性：格式强制 + 角色边界 + 篇幅 + 段落固定
  const control = 25 * (has("format") ? 1 : 0) + 25 * (has("role") ? 1 : 0)
    + 25 * (/字数|≤|篇幅/.test(t) ? 1 : 0) + 25 * (p.strict === "strict" ? 1 : p.strict === "normal" ? 0.6 : 0.2);

  // 完整性：八项纪律覆盖度 + 行为规则
  const covered = META.disciplines.filter(has).length;
  const completeness = 80 * (covered / META.disciplines.length) + 20 * (/【行为】/.test(t) ? 1 : 0);

  // 鲁棒性：多链投票 + 自我修正 + 分歧处理 + 急症边界
  const robustness = 25 * (has("vote") ? 1 : 0) + 25 * (has("selfcheck") ? 1 : 0)
    + 25 * (/分歧|不确定|如实/.test(t) ? 1 : 0) + 25 * (/120|急症/.test(t) ? 1 : 0);

  // 维度与契约的自洽性（真实工程里"说的和要的冲突"会导致执行不稳定）：
  // ① 声明 ≤400 字却要求 long 篇幅 → 冲突 ② 关掉 vote 却要求 deep 深度 → 冲突
  // ③ 关掉 format 却 strict 严格 → 冲突 ④ 关掉 rag 却要求来源标注 → 冲突
  let coherence = 10;
  if (p.length === "long") coherence -= 5;
  if (!has("vote") && p.depth === "deep") coherence -= 4;
  if (!has("format") && p.strict === "strict") coherence -= 4;
  if (!has("rag")) coherence -= 4;
  if (!has("selfcheck") && p.strict === "strict") coherence -= 3;
  coherence = Math.max(0, coherence);

  const total = 0.28 * accuracy + 0.24 * control + 0.22 * completeness + 0.16 * robustness + 0.10 * coherence * 10;
  return {
    id: v.id, name: v.name,
    accuracy: +accuracy.toFixed(1), control: +control.toFixed(1),
    completeness: +completeness.toFixed(1), robustness: +robustness.toFixed(1),
    coherence: +coherence.toFixed(1),
    total: +total.toFixed(2)
  };
}

export function rank(variants) {
  return variants.map(scoreVariant).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

// ── 四、迭代优化：聚焦最优，补齐八项纪律 + 强化关键节点自检 + 严格格式 ──
export function iterate(best, variants) {
  const score = rank(variants)[0];
  const parts = [META.identity];
  for (const k of META.disciplines) parts.push(D[k]);
  parts.push("【行为】" + META.behavior.join("；"));
  parts.push("【能力边界】" + META.boundary.join("；"));
  parts.push("【格式强制】严格四段：结论 / 依据 / 共识度 / 提示；每段独立成行，依据须标明「本机上下文」或「公开常识」。");
  parts.push("【约束】仅用 2025 年后的政策与市场信息；不编造、不臆断；缺失写「暂无数据」；篇幅 ≤400 字；每条建议可操作。");
  parts.push("【关键节点自检】①检索后：依据是否都有来源？②投票后：共识度是否如实？③输出前：有无错别字/前后矛盾/超出边界？任一不通过就地修正。");
  const text = parts.join("\n");
  return {
    id: "ULTIMATE", name: "★ 终极提示词", base: best.id, baseScore: score.total,
    params: { depth: "deep", length: "mid", strict: "strict", tone: "neutral", jargon: "mid" },
    text
  };
}

// ── CLI ──
if (import.meta.url === "file://" + process.argv[1]) {
  const outIdx = process.argv.indexOf("--json");
  const variants = generateVariants(20);
  const ranked = rank(variants);
  const best = variants.find(v => v.id === ranked[0].id);
  const ultimate = iterate(best, variants);
  const payload = { meta: META, variants, ranked, best: best.id, ultimate };
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    const fs = await import("fs");
    fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(payload, null, 2));
    console.log("写出", process.argv[outIdx + 1]);
  }
  console.log("\n排名（前 5）：");
  ranked.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.id} ${r.name} ${r.total}（准${r.accuracy}/控${r.control}/全${r.completeness}/鲁${r.robustness}）`));
  console.log("\n最优：", best.id, best.name, "→ 迭代产出", ultimate.id, "继承分数", ultimate.baseScore);
}
