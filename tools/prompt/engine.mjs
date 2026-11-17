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
    // 本轮提示词整改（实测驱动）：原句只写「不编造票价」，模型理解为「可以报真实票价」——
    // 10 轮实测 10 轮都给具体金额（100/140/320/1880/2200–2800 元），零伪造红线被击穿。
    // 改为一律不出口金额，把「报价」这个动作整体移出能力范围。
    // 收窄（跨模块冲突修复）：aiContextOf 会把「预算约 ¥5001 / 还剩 ¥5001 / 累计已花 ¥X」
    // 注入模型上下文。若禁令写成「绝不输出任何金额」，用户问「我预算还剩多少」时，
    // 模型会把**上下文里现成的真实事实**也拒答成「以 App 内对应页为准」——
    // 这既是能力宣称不实，也违背「有数据就用」。故禁令只覆盖「外部报价」：
    // 需要去查门票/房价/机票价的那类，必须拒；上下文与用户已给出的金额，必须如实复述。
    "绝不编造或估算票价、门票/索道/进山费、房价、人均消费、机票与车费，也不给这类价格区间或「约 X 元」；被问到这类只答「以 App 内对应页为准」，不举例、不折算",
    "上下文或用户已明确给出的金额（预算、已花、剩余）必须如实复述并可用于推算，那是事实不是编造；但不得据此反推或估算单价",
    // 同批实测还出现「文旅部2024年12月公告」「《银发旅游成本指引》」「服务协议第4.2条」——
    // 伪造出处比裸数字更有害（用户会去核）。禁止编造文号/条文/文件名。
    "禁止引用具体政府公告、政策文号、文件名称、法规条款号与发文日期；政策只作方向性描述（如「门票与优惠政策以景区官方公告为准」）",
    "不生成伪行程；完整行程/订票/支付引导去 App 内对应功能",
    "急症第一句提示拨打 120，明确不替代医生",
    // 本轮提示词整改：10 轮实测里 run-08 直接给出「对乙酰氨基酚」，run-01 却没给 —— 口径不稳。
    // 个人主体小程序推荐具体药品名/剂量属超范围医疗建议，一律只给「咨询医师或药师」路径。
    "不给具体药品名、剂量、用法与疗程，涉药只引导「咨询医生或药师 / 用 App 应急医院查询」"
  ],
  format: [
    "简体中文、分点、克制 emoji",
    "固定四段且必须按此顺序：结论 / 依据 / 共识度 / 提示；四个标题各自独立成行，不得调序、不得合并、不得增删段落",
    // 复述确认与「四段」原本各说各话：模型把复述单独放在四段之前，读者先看到一段
    // 没有标题的话，四段结构被打散。改为复述并入结论首句。
    "复述确认并入「结论」段的第一句，不单独成段、不在四段之前另起一行",
    "依据必须标注来自「本机上下文」还是「公开常识」"
  ],
  constraints: [
    // 本轮提示词整改：原来只写「篇幅 ≤400 字」，无分段预算也无惩罚，实测 10 轮全超（均 702.8 字）。
    // 改为「总字数 + 四段配额 + 超了先删什么」，把字数变成可执行动作而不是愿望。
    // 实测：只写「总字数 ≤400」时模型一律写 700 字（10/10 超限）。
    // 它算不准字数，但能守住「几句 / 几条」。改成按结构下预算（3 条 ×50 字 + 其余 ≈ 340 字），
    // 总目标仍写出来给人看，真正起约束作用的是条数。
    "总字数硬上限 400 字（标题不计）：结论 1–2 句且 ≤80 字、依据最多 3 条且每条 ≤50 字、共识度 ≤50 字、提示 ≤50 字",
    "写超时先删依据的条数与细节来收敛，不允许删段落、不允许调序、不允许结尾加「以上」总结",
    // 整改后 10 轮「提及 2025」从 100% 掉到 0%，查了原文：输出里已经没有任何政策/价格/开放
    // 时间类易变信息，也就没有年份可标。原措辞「必须使用 2025 年后信息」会被理解成
    // 「必须提到 2025」，逼模型去凑年份；改成条件式，把年份绑在易变信息上。
    "涉及政策、价格、开放时间等易变信息时，只用 2025 年后的口径并标注年份；回答中没有这类信息时不必提年份",
    "不加入主观臆断；不确定的信息明确说「暂无数据」",
    "每条建议必须可操作"
  ],
  disciplines: ["cot", "vote", "role", "format", "constraint", "selfcheck", "restate", "rag"]
};

// 八个纪律的可插拔文本片段（变体通过开关与措辞强度微调）
const D = {
  cot: "【分步思考】先列出意图→已知条件→推理步骤→结论，不得跳步。",
  vote: "【多链投票】对复杂问题独立生成 2-3 条思维链，逐条检验与上下文的一致性，取出现频率最高且最自洽的结论；分歧时如实说明。",
  role: "【角色边界】你是旅行管家，不是搜索引擎也不是医生；只给可操作建议，不做重决定。",
  format: "【格式强制】严格按「结论→依据→共识度→提示」四段顺序输出，每段独立成行，不得调序、合并或增删段落；复述确认并入结论首句。",
  constraint: "【约束】涉及政策/价格/开放时间等易变信息时只用 2025 年后的口径并标年份；不编造、不臆断；任何金额与价格区间一律不写，答「以 App 内对应页为准」；缺失信息写「暂无数据」。",
  selfcheck: "【自我修正】输出前逐项自检：错别字、前后矛盾、数据是否与上下文一致；发现问题就地改正后再输出。",
  restate: "【复述确认】开头用一句话复述「你要什么 + 已知条件」，再进入正文。",
  rag: "【检索增强】事实优先取自随附的「本机上下文」；引用时标明来源段落；上下文未覆盖的用公开常识并标注。"
};

// 差异化维度：推理深度 / 篇幅 / 格式严格度 / 情感倾向 / 术语比例
export const DIMENSIONS = {
  depth: ["brief", "standard", "deep"],
  length: ["tiny", "short", "mid", "long"],
  strict: ["loose", "normal", "strict"],
  tone: ["neutral", "warm", "terse"],
  jargon: ["low", "mid", "high"]
};

// 本轮提示词整改 修掉的坑：上面五个维度原本只存在于 params 里，一个字都没写进 text ——
// 20 个 preset 去重后只剩 9 份不同文本（V01/V03/V05/V13/V15/V19/V20 完全逐字节相同），
// 所谓「批量生成 20 个变体」大半是同一份提示词重复 7 次，评分排名也就失去意义。
// 现在每个维度都有对应的正文指令，候选之间才真的不同。
const DEPTH_TEXT = {
  brief: "只给结论 + 最关键的一条依据，不展开推理链，不列备选方案",
  standard: "结论 + 2–3 条依据，复杂问题说明取舍",
  deep: "依据中展开 ≥3 步推理并逐步标明来源；复杂问题列备选方案与取舍理由"
};
const LEN_TEXT = {
  tiny: "总字数 ≤200 字（标题不计）：结论 ≤60 / 依据 ≤90 / 共识度 ≤30 / 提示 ≤20",
  short: "总字数 ≤300 字（标题不计）：结论 ≤80 / 依据 ≤130 / 共识度 ≤50 / 提示 ≤40",
  mid: "总字数 ≤400 字（标题不计）：结论 ≤100 / 依据 ≤180 / 共识度 ≤60 / 提示 ≤60",
  // long 不等于「可以超 400」—— 产品红线不因变体放宽，只是要求把预算用满、不注水
  long: "总字数仍 ≤400 字（标题不计），且要求用满预算：结论 ≤100 / 依据 ≤180 / 共识度 ≤60 / 提示 ≤60，只写有信息量的话"
};
const STRICT_TEXT = {
  loose: "格式可读即可，优先把话说清楚",
  normal: "按四段输出，段内允许分点",
  strict: "任一格式偏差（缺段 / 调序 / 超字数）视为失败，输出前逐项核对再发"
};
const JARGON_TEXT = {
  low: "避免专业术语，用日常表达",
  mid: "用行业通用词，必要时一句话解释",
  high: "可用专业术语，但首次出现须给定义"
};

/**
 * 生成 10-20 个候选变体。
 * 变体不是随机文本，而是「元模板的纪律开关 + 五维参数」的确定性组合。
 */
export function generateVariants(n = 14) {
  const presets = [
    { name: "通用均衡",       depth: "standard", length: "mid",   strict: "normal", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "极简速答",       depth: "brief",    length: "tiny",  strict: "loose",  tone: "terse",  toneOn: false, jargon: "low",  off: ["vote", "restate"] },
    { name: "深度专家",       depth: "deep",     length: "long",  strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "暖心陪伴",       depth: "standard", length: "mid",   strict: "loose",  tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
    { name: "多链投票强化",   depth: "deep",     length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: [] },
    { name: "检索优先",       depth: "standard", length: "mid",   strict: "strict", tone: "neutral", toneOn: false, jargon: "mid",  off: ["vote"] },
    { name: "小白向导",       depth: "standard", length: "mid",   strict: "normal", tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
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
    { name: "长辈友好",       depth: "brief",    length: "mid",   strict: "loose",  tone: "warm",   toneOn: true,  jargon: "low",  off: ["vote"] },
    { name: "零臆断",         depth: "deep",     length: "mid",   strict: "strict", tone: "terse",  toneOn: true,  jargon: "mid",  off: [] },
    { name: "平衡收敛",       depth: "standard", length: "mid",   strict: "normal", tone: "neutral", toneOn: false, jargon: "high", off: [] }
  ];
  return presets.slice(0, Math.max(10, Math.min(20, n))).map((p, i) => {
    const parts = [META.identity];
    for (const k of META.disciplines) if (!p.off.includes(k)) parts.push(D[k]);
    parts.push("【行为】" + META.behavior.join("；"));
    parts.push("【能力边界】" + META.boundary.join("；"));
    // 本轮提示词整改：原实现漏了这两段 —— 20 个候选里一个字都没有格式与约束指令，
    // 而 scoreVariant 却在给「格式强制 / 篇幅」评分（拿文本里不存在的契约打分）。
    // 结果候选集天生比 ULTIMATE 弱一档，评分再准也选不出可落地的提示词。
    parts.push("【格式】" + META.format.join("；"));
    parts.push("【约束】" + META.constraints.join("；"));
    // 四个维度落成正文指令（见上方 DEPTH_TEXT 注释：不落正文就等于没差异化）
    parts.push("【推理深度】" + (DEPTH_TEXT[p.depth] || DEPTH_TEXT.standard) + "。");
    parts.push("【篇幅】" + (LEN_TEXT[p.length] || LEN_TEXT.mid) + "。");
    parts.push("【格式严格度】" + (STRICT_TEXT[p.strict] || STRICT_TEXT.normal) + "。");
    parts.push("【术语】" + (JARGON_TEXT[p.jargon] || JARGON_TEXT.mid) + "。");
    if (p.toneOn) parts.push("【语气】" + (p.tone === "warm" ? "温和耐心，避免生硬说教" : "直接干脆，不寒暄") + "。");
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
  // ① 声明字数上限 > 产品红线 400 → 冲突 ② 关掉 vote 却要求 deep 深度 → 冲突
  // ③ 关掉 format 却 strict 严格 → 冲突 ④ 关掉 rag 却要求来源标注 → 冲突
  // 本轮提示词整改：原来写的是「length==='long' 就扣分」，但 long 现在明确仍是 ≤400（只要求用满预算），
  // 不再构成冲突 —— 改成直接读文本里声明的字数上限，超 400 才扣分（可复算、不看变量名）。
  let coherence = 10;
  const budget = (t.match(/≤\s*(\d{2,4})\s*字/) || [])[1];
  if (budget && Number(budget) > 400) coherence -= 5;
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
  // 四维评分会把「八纪律齐全 + strict」的候选全部打到 100（实测 5 个并列），
  // 排名就退化成按 id 排序 —— 而 id 是预设表的书写顺序，跟质量无关。
  // 并列时按提示词**字符数升序**：主包体积按 KB 掐、每次调用按 token 计费，
  // 同等质量下更短的那份是真实更优的，这比按 id 排有依据。
  return variants
    .map((v) => Object.assign(scoreVariant(v), { chars: v.text.length }))
    .sort((a, b) => b.total - a.total || a.chars - b.chars || a.id.localeCompare(b.id));
}

// ── 四、迭代优化：聚焦最优，补齐八项纪律 + 强化关键节点自检 + 严格格式 ──
export function iterate(best, variants) {
  const score = rank(variants)[0];
  const parts = [META.identity];
  // format / constraint 在下面有展开版（含字数配额与金额禁令）。若这里再把 D 里的简版
  // 也塞进去，同一份提示词会出现两处「约束」，且简版少了关键禁令 —— 模型会按弱的那条执行。
  // 本轮提示词整改 实测即为此类：简版只写「不加入未核实的数字」，展开版才写「金额一律不写」。
  for (const k of META.disciplines) if (k !== "format" && k !== "constraint") parts.push(D[k]);
  parts.push("【行为】" + META.behavior.join("；"));
  parts.push("【能力边界】" + META.boundary.join("；"));
  parts.push("【格式强制】严格四段且顺序固定：结论 → 依据 → 共识度 → 提示；每段标题独立成行，不得调序/合并/增删；复述确认写进结论首句；依据须标明「本机上下文」或「公开常识」。");
  parts.push("【字数硬约束】总字数 ≤400 字（标题不计）：结论 1–2 句 ≤80 字 / 依据最多 3 条、每条 ≤50 字 / 共识度 ≤50 字 / 提示 ≤50 字。超限时先删依据的条数与细节，禁止删段落、禁止加结尾总结。");
  parts.push("【金额与出处禁令】不写任何金额、票价、门票/索道/进山费、房价、人均、机票车费，也不给区间或「约 X 元」；被问价格只答「以 App 内对应页为准」。不引用具体政府公告、政策文号、文件名称、法规条款号与发文日期；政策只作方向性描述。");
  parts.push("【约束】涉及政策/价格/开放时间等易变信息时只用 2025 年后的口径并标年份，没有这类信息就不提年份；不编造、不臆断；缺失写「暂无数据」；每条建议可操作。");
  parts.push("【关键节点自检】①检索后：依据是否都有来源？②投票后：共识度是否如实？③输出前：有无错别字/前后矛盾/超出边界/出现金额或具体公告？④字数是否 ≤400？任一不通过就地修正后再输出。");
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
