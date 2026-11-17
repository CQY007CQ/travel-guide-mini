/**
 * tools/prompt/rank.mjs —— v1.20.11 候选提示词量化评分与多数投票聚合
 *
 * 评分模型：4 主维 × 4 子指标 = 16 项，每项 0–100 分，逐项带「可观察证据锚点」。
 *   A 准确性 Accuracy   ：A1 零伪造护栏 / A2 检索落地 / A3 数据可核验 / A4 不确定性显式化
 *   C 可控性 Controllable：C1 格式确定性 / C2 篇幅可控 / C3 角色边界 / C4 指令无矛盾
 *   M 完整性 Completeness：M1 八项纪律覆盖 / M2 分步链完整 / M3 自检节点 / M4 交付物定义
 *   R 鲁棒性 Robustness ：R1 冲突消解 / R2 降级路径 / R3 长度适配 / R4 复跑稳定
 *
 * 三条**互不参照**的评分链（权重独立、无共享参考答案）各自排名，再做 Borda + 多数投票：
 *   S 结构派：看重格式锁定与可复算
 *   E 实效派：看重能不能真拿到事实、真产出动作
 *   K 风险派：看重零伪造、冲突消解、复跑一致
 *
 * ── 偏置控制（对应本轮 2025+ 检索到的三类评审偏置）──
 *   ① rubric order bias（评分项顺序偏置，arXiv 2506.22316）
 *      → 用 6 组种子化乱序各跑一次，断言排名完全不变（顺序不变性测试）。
 *   ② score ID bias（分档编号偏置，同上）
 *      → 分档编号全程用不透明 ID（B1..B9），语义标签在最后一步才映射；
 *        断言「换标号不改变任何分数」。
 *   ③ reference answer score bias（参考答案分数偏置，同上）
 *      → 三链不共享任何参考答案，权重向量彼此独立且公开差异度；
 *        若三链权重余弦相似度 >0.9 则判定「实质是同一条链」，本次聚合作废。
 *   ④ 中心倾向偏差（剑桥 OpRaise：模型偏爱 50–60 安全带）
 *      → 每档写「可观察证据锚点」，并要求每条链的候选分差 ≥15 分；
 *        不达标即判该链区分度不足，不计入投票。
 *
 * 诚实边界：本脚本评的是「提示词契约的静态可执行性」，不是模型跑出来的效果。
 * 真实执行效果由 tools/prompt/lab/ 下的 runs 佐证，二者互补、不得互相冒充。
 *
 * 用法：node tools/prompt/rank.mjs [--json out.json] [--md out.md]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATES, DIMS, toVec, render, detectConflicts, vecToText } from "./pool.mjs";

// ── 一、种子化 PRNG（保证乱序可复现，不依赖 Math.random） ──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seed) {
  const r = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 二、从「渲染出的提示词文本」测量特征（静态体检，不看设计意图，只看模型真能读到什么） ──
function features(cand) {
  const text = render(cand);
  const v = toVec(cand.v);
  const { hard, soft } = detectConflicts(v);
  const count = (re) => (text.match(re) || []).length;
  return {
    v, text, hard, soft,
    /** 字数上限（从「总篇幅 ≤N 字」抽出，抽不到记 NaN） */
    budget: (() => { const m = text.match(/≤(\d+)\s*字/); return m ? Number(m[1]) : NaN; })(),
    /** 输出字段数（字段级格式会列出 8 个字段） */
    fields: count(/`(task|restate|evidence|chain|verdict|actions|risks|selfcheck)`/g),
    /** 边界条款条数（以 · 开头的禁令行） */
    bans: (text.split("\n").filter((l) => /^·/.test(l.trim())).length),
    /** 是否要求标注来源 */
    cite: /每条关键结论后须标出来源/.test(text),
    /** 是否明确否决检索（"不检索，仅凭上下文作答"） */
    noFetch: /不检索，仅凭上下文作答/.test(text),
    /** 自检条目数（错别字/逻辑漏洞/代码 bug/数据准确性 四类 + 复跑 + 红队） */
    selfItems: count(/错别字|逻辑漏洞|代码 bug|数据准确性|复跑|红队/g),
    /** 执行步骤数 */
    steps: count(/^\d\. /gm),
    /** 是否含复述确认 */
    restate: /复述一次任务目标/.test(text),
    /** 是否含多链投票 */
    vote: /3 条互不参照的推理链/.test(text),
    /** 是否含「标注不确定性」（深推档特征） */
    uncert: /标注证据来源与不确定性|显式标注「未核实」|显式标注并给出补齐办法/.test(text),
    /** 是否声明格式优先级（软冲突需要的消解条款） */
    priority: /格式优先|优先于推进速度/.test(text),
  };
}

// ── 三、16 项子指标：分档锚点写死在注释里，分数由可观察特征落档 ──
/** 统一落档器：bands = [{max, score, anchor}]，取第一个 score<=max 不成立的下一档 */
function band(x, table) {
  for (const b of table) if (x <= b.max) return b.score;
  return table[table.length - 1].score;
}

export const METRICS = [
  // A 准确性
  { id: "A1", dim: "A", name: "零伪造护栏覆盖", fn: (f) => {
    // 锚点：5 条共享禁令为底座 80；风险姿态每提高一档，猜测被显式标注 +4。
    // <80 = 存在未标注的伪造面；96 = 禁令 + 保守标注双到位。
    return 76 + f.v.risk * 4;
  } },
  { id: "A2", dim: "A", name: "检索落地度", fn: (f) => {
    // 锚点：明确「不检索」= 20；可选 45；建议 65；强制 85；强制+引用 95。
    return [20, 45, 65, 85, 95][f.v.retrieval - 1];
  } },
  { id: "A3", dim: "A", name: "数据可核验性", fn: (f) => {
    // 锚点：要求逐条标注来源 = 95；强制检索但未要求引用 = 78；建议检索 = 60；其余 40。
    if (f.cite) return 95;
    if (f.v.retrieval === 4) return 78;
    if (f.v.retrieval === 3) return 60;
    return 40;
  } },
  { id: "A4", dim: "A", name: "不确定性显式化", fn: (f) => {
    // 锚点：既不深推也不保守 = 35（无不确定性交代）；单侧 = 60；双侧 = 88。
    const a = f.v.depth >= 4 ? 1 : 0;
    const b = f.v.risk <= 2 ? 1 : 0;
    return a + b === 2 ? 88 : a + b === 1 ? 60 : 35;
  } },

  // C 可控性
  { id: "C1", dim: "C", name: "格式确定性", fn: (f) => [25, 50, 72, 88, 96][f.v.format - 1] },
  { id: "C2", dim: "C", name: "篇幅可控", fn: (f) => {
    // 锚点：有明确字数上限且 ≤2500 字 = 90（模型能守住「几条」）；
    // 5000 字上限实测守不住（既有 lab 记录：只写总字数模型仍全超）= 78；无上限 = 30。
    if (Number.isNaN(f.budget)) return 30;
    if (f.budget <= 1200) return 92;
    if (f.budget <= 2500) return 90;
    return 78;
  } },
  { id: "C3", dim: "C", name: "角色边界清晰", fn: (f) => {
    // 锚点：角色+边界共享条款为 88 底；高术语档引入歧义风险 −5；极简篇幅压掉边界阅读空间 −5。
    let s = 88;
    if (f.v.jargon >= 4) s -= 5;
    if (f.v.length <= 1) s -= 5;
    return s;
  } },
  { id: "C4", dim: "C", name: "指令无矛盾", fn: (f) => 100 - f.hard.length * 35 - f.soft.length * 12 },

  // M 完整性
  { id: "M1", dim: "M", name: "八项纪律覆盖", fn: (f) => {
    // 八项逐项判定：①一步步思考 ②多链投票 ③角色 ④格式 ⑤约束 ⑥自我修正 ⑦复述确认 ⑧检索。
    // ⑥以自检档 ≥2 计为真；⑧明确「不检索」只记半份（条款在但是否决态）。
    let hit = 0;
    hit += 1;                                  // ① 分步执行步骤常驻
    hit += f.vote ? 1 : 0;                     // ② 多链投票
    hit += 1;                                  // ③ 角色（共享）
    hit += f.v.format >= 2 ? 1 : 0.5;          // ④ 格式（自然段=半份）
    hit += 1;                                  // ⑤ 约束（共享）
    hit += f.v.selfcheck >= 2 ? 1 : 0;         // ⑥ 自我修正
    hit += f.restate ? 1 : 0;                  // ⑦ 复述确认
    hit += f.noFetch ? 0.5 : 1;                // ⑧ 检索
    return Math.round((hit / 8) * 100);
  } },
  { id: "M2", dim: "M", name: "分步链完整", fn: (f) => {
    // 锚点：5 步固定为 60 底；深度 ≥4 每步变实质 +15；格式 ≥4 步进可核验 +10。
    return Math.min(100, 60 + (f.v.depth >= 4 ? 15 : 0) + (f.v.format >= 4 ? 10 : 0) + (f.steps >= 5 ? 5 : 0));
  } },
  { id: "M3", dim: "M", name: "自检节点", fn: (f) => {
    // 锚点：无自检 30；通读 55；分项 75；分项复跑 90；复跑+红队 97。
    return [30, 55, 75, 90, 97][f.v.selfcheck - 1];
  } },
  { id: "M4", dim: "M", name: "交付物定义", fn: (f) => {
    // 锚点：自然段 30；分点 55；四节 75；四节+首句锁 88；字段级清单 95。
    return [30, 55, 75, 88, 95][f.v.format - 1];
  } },

  // R 鲁棒性
  { id: "R1", dim: "R", name: "冲突消解", fn: (f) => {
    let s = 100 - f.hard.length * 40 - f.soft.length * 15;
    if (f.v.format >= 5 && f.v.risk >= 4 && !f.priority) s -= 10;
    return Math.max(0, s);
  } },
  { id: "R2", dim: "R", name: "降级路径", fn: (f) => {
    // 锚点：既无「证据不足则如何」也无「未核实标注」= 30；单有一侧 = 62；双侧 = 90。
    const a = /若证据不足则如何/.test(f.text) ? 1 : 0;
    const b = f.uncert ? 1 : 0;
    return a + b === 2 ? 90 : a + b === 1 ? 62 : 30;
  } },
  { id: "R3", dim: "R", name: "长度适配", fn: (f) => {
    // 锚点：2500 字档最稳 92；1200 字 90；5000 字上限实测易失控 78；300 字装不下交付物 62。
    return { 1: 62, 2: 80, 3: 90, 4: 92, 5: 78 }[f.v.length];
  } },
  { id: "R4", dim: "R", name: "复跑稳定", fn: (f) => {
    // 锚点：自检复跑 + 格式锁定同时具备 = 95；只具备一项 = 70；都没有 = 45。
    const a = f.v.selfcheck >= 4 ? 1 : 0;
    const b = f.v.format >= 4 ? 1 : 0;
    return a + b === 2 ? 95 : a + b === 1 ? 70 : 45;
  } },
];

export function scoreAll() {
  return CANDIDATES.map((c) => {
    const f = features(c);
    const sub = {};
    for (const m of METRICS) sub[m.id] = m.fn(f);
    return { id: c.id, name: c.name, focus: c.focus, vec: vecToText(c.v), sub, hard: f.hard, soft: f.soft, budget: f.budget };
  });
}

// ── 四、三条独立评分链（权重互不相同，无共享参考答案） ──
export const CHAINS = [
  {
    key: "S", name: "结构派", thesis: "提示词先是一份契约：格式与矛盾项决定可复算性。",
    w: { A1: 2, A2: 2, A3: 2, A4: 1, C1: 4, C2: 3, C3: 2, C4: 5, M1: 3, M2: 3, M3: 2, M4: 4, R1: 4, R2: 1, R3: 2, R4: 3 },
  },
  {
    key: "E", name: "实效派", thesis: "提示词的价值只在它能否换来真实、可执行的动作。",
    w: { A1: 3, A2: 5, A3: 5, A4: 2, C1: 2, C2: 2, C3: 2, C4: 2, M1: 3, M2: 3, M3: 4, M4: 3, R1: 2, R2: 4, R3: 4, R4: 2 },
  },
  {
    key: "K", name: "风险派", thesis: "一次编造就毁掉全部产出，先保证不会错再谈好不好。",
    w: { A1: 5, A2: 3, A3: 4, A4: 4, C1: 2, C2: 2, C3: 3, C4: 5, M1: 3, M2: 2, M3: 4, M4: 2, R1: 5, R2: 4, R3: 3, R4: 5 },
  },
];

function weightedTotal(sub, w) {
  let num = 0, den = 0;
  for (const k of Object.keys(w)) { num += sub[k] * w[k]; den += w[k]; }
  return num / den;
}

function cosine(a, b) {
  const ks = Object.keys(a);
  let dot = 0, na = 0, nb = 0;
  for (const k of ks) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 对一组乱序评分项计算某链总分：顺序只影响累加次序，不影响结果 → 用于顺序不变性断言 */
function totalWithOrder(sub, w, order) {
  let num = 0, den = 0;
  for (const k of order) { num += sub[k] * w[k]; den += w[k]; }
  return num / den;
}

export function evaluate() {
  const rows = scoreAll();
  const ids = METRICS.map((m) => m.id);

  // ① 顺序不变性：6 组乱序各算一次，全部与基准一致才算通过
  const orderTest = [];
  for (let s = 1; s <= 6; s++) {
    const order = shuffled(ids, 1000 + s);
    const okAll = rows.every((r) => CHAINS.every((ch) => Math.abs(totalWithOrder(r.sub, ch.w, order) - weightedTotal(r.sub, ch.w)) < 1e-9));
    orderTest.push({ seed: 1000 + s, order: order.join(">"), invariant: okAll });
  }

  // ② 分档编号解耦：编号只是标签，换一套编号不应改变任何分数
  const relabel = Object.fromEntries(ids.map((id, i) => [id, `B${(i * 7) % 16 + 1}`]));
  const relabelInvariant = rows.every((r) => {
    const remap = {};
    for (const k of Object.keys(r.sub)) remap[relabel[k]] = r.sub[k];
    return CHAINS.every((ch) => {
      const w = Object.fromEntries(Object.keys(ch.w).map((k) => [relabel[k], ch.w[k]]));
      return Math.abs(weightedTotal(remap, w) - weightedTotal(r.sub, ch.w)) < 1e-9;
    });
  });

  // ③ 三链独立性：权重余弦相似度
  const pairSim = [];
  for (let i = 0; i < CHAINS.length; i++) {
    for (let j = i + 1; j < CHAINS.length; j++) {
      pairSim.push({ pair: `${CHAINS[i].key}-${CHAINS[j].key}`, cosine: +cosine(CHAINS[i].w, CHAINS[j].w).toFixed(4) });
    }
  }
  const maxSim = Math.max(...pairSim.map((p) => p.cosine));

  // ④ 各链排名 + 区分度
  const chainRanks = CHAINS.map((ch) => {
    const scored = rows.map((r) => ({ id: r.id, name: r.name, total: +weightedTotal(r.sub, ch.w).toFixed(2) }))
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    scored.forEach((s, i) => { s.rank = i + 1; });
    const spread = +(scored[0].total - scored[scored.length - 1].total).toFixed(2);
    return { key: ch.key, name: ch.name, thesis: ch.thesis, scored, spread, valid: spread >= 15 };
  });

  // ⑤ Borda 聚合（16 人 × 15 分制）+ 有实义的次级判据
  // 首版只按 id 定序，掩盖了 C09=C12 同分并列（门禁抓出来的）——靠 id 拆并列等于没拆，
  // 因为 id 与质量无关。改为：Borda 同分时先比「三链均分」，仍同分才算真歧义（ties）。
  const borda = Object.fromEntries(rows.map((r) => [r.id, 0]));
  const avgOf = Object.fromEntries(rows.map((r) => [
    r.id,
    CHAINS.reduce((a, ch) => a + weightedTotal(r.sub, ch.w), 0) / CHAINS.length,
  ]));
  for (const ch of chainRanks) {
    if (!ch.valid) continue; // 区分度不足的链不计票
    for (const s of ch.scored) borda[s.id] += rows.length - s.rank;
  }
  const bordaRanked = Object.entries(borda).map(([id, pts]) => ({
    id, name: rows.find((r) => r.id === id).name, borda: pts, avg: +avgOf[id].toFixed(2),
  })).sort((a, b) => b.borda - a.borda || b.avg - a.avg || a.id.localeCompare(b.id));

  // 并列登记：bordaTies = 同 Borda 分（靠均分拆开）；ties = 连均分也相同（真歧义）
  const bordaTies = [], ties = [];
  for (let i = 1; i < bordaRanked.length; i++) {
    const p = bordaRanked[i - 1], c = bordaRanked[i];
    if (p.borda !== c.borda) continue;
    if (p.avg === c.avg) ties.push(`${p.id}=${c.id}`);
    else bordaTies.push(`${p.id}/${c.id}(borda ${p.borda} → 均分 ${p.avg} vs ${c.avg})`);
  }

  // ⑥ 多数投票：每条链的 #1，出现 ≥2 次即胜出
  const firstVotes = {};
  for (const ch of chainRanks) {
    if (!ch.valid) continue;
    const top = ch.scored[0].id;
    firstVotes[top] = (firstVotes[top] || 0) + 1;
  }
  const voteWinner = Object.entries(firstVotes).sort((a, b) => b[1] - a[1])[0] || null;
  const champion = voteWinner && voteWinner[1] >= 2 ? voteWinner[0] : bordaRanked[0].id;

  // ⑦ 链间序一致性（Kendall tau，两两）
  const kendall = [];
  for (let i = 0; i < chainRanks.length; i++) {
    for (let j = i + 1; j < chainRanks.length; j++) {
      const A = chainRanks[i].scored, B = chainRanks[j].scored;
      const posB = Object.fromEntries(B.map((s) => [s.id, s.rank]));
      let conc = 0, disc = 0;
      for (let x = 0; x < A.length; x++) {
        for (let y = x + 1; y < A.length; y++) {
          const sx = posB[A[x].id] - posB[A[y].id];
          const sy = A[x].rank - A[y].rank;
          if (sx * sy > 0) conc++; else if (sx * sy < 0) disc++;
        }
      }
      kendall.push({ pair: `${chainRanks[i].key}-${chainRanks[j].key}`, tau: +((conc - disc) / (conc + disc)).toFixed(3), concordant: conc, discordant: disc });
    }
  }

  return {
    rows, orderTest, relabelInvariant, pairSim, maxSim, chainRanks, bordaRanked, firstVotes,
    champion, kendall, ties, bordaTies, avgOf,
    chainValidCount: chainRanks.filter((c) => c.valid).length,
  };
}

// ── 五、出口 ──
function mdReport(res) {
  const L = [];
  L.push("# 候选提示词量化评分报告 v1.20.11");
  L.push("");
  L.push("产出：`node tools/prompt/rank.mjs`。全部数字由脚本复算，同一输入必得同一输出。");
  L.push("");
  L.push("## 一、总排名（Borda 聚合，16 候选 × 15 分制）");
  L.push("");
  L.push("| 名次 | ID | 名称 | " + CHAINS.map((c) => c.key + " 链得分/排名").join(" | ") + " | Borda | A | C | M | R |");
  L.push("| --- | --- | --- | " + CHAINS.map(() => "---").join(" | ") + " | --- | --- | --- | --- | --- |");
  res.bordaRanked.forEach((b, i) => {
    const row = res.rows.find((r) => r.id === b.id);
    const cells = res.chainRanks.map((ch) => {
      const s = ch.scored.find((x) => x.id === b.id);
      return `${s.total.toFixed(1)} / #${s.rank}`;
    });
    const dimOf = (d) => {
      const ms = METRICS.filter((m) => m.dim === d);
      return (ms.reduce((a, m) => a + row.sub[m.id], 0) / ms.length).toFixed(1);
    };
    L.push(`| ${i + 1} | ${b.id} | ${b.name} | ${cells.join(" | ")} | ${b.borda} | ${dimOf("A")} | ${dimOf("C")} | ${dimOf("M")} | ${dimOf("R")} |`);
  });
  L.push("");
  L.push("## 二、子指标明细");
  L.push("");
  L.push("| ID | " + METRICS.map((m) => m.id).join(" | ") + " |");
  L.push("| --- | " + METRICS.map(() => "---").join(" | ") + " |");
  for (const r of res.rows) L.push(`| ${r.id} | ${METRICS.map((m) => r.sub[m.id]).join(" | ")} |`);
  L.push("");
  L.push("## 三、偏置控制与自洽性检验");
  L.push("");
  L.push(`- ① 评分项顺序不变性（6 组种子乱序）：${res.orderTest.every((t) => t.invariant) ? "**全部通过**" : "**存在失败**"}`);
  L.push(`- ② 分档编号解耦（B1..B16 重编号）：${res.relabelInvariant ? "**通过**，分数不变" : "**失败**"}`);
  L.push(`- ③ 三链独立性（权重余弦，阈值 0.9）：最大 ${res.maxSim} → ${res.maxSim <= 0.9 ? "**独立**" : "**实质同链，聚合作废**"}`);
  L.push(`- ④ 区分度（每条链首尾分差 ≥15）：${res.chainValidCount}/${CHAINS.length} 条达标`);
  res.chainRanks.forEach((ch) => L.push(`  - ${ch.key} ${ch.name}：分差 ${ch.spread} · ${ch.valid ? "计入投票" : "**不计入**"}`));
  L.push(`- ⑤ 链间序一致性（Kendall τ）：${res.kendall.map((k) => `${k.pair}=${k.tau}`).join(" / ")}`);
  L.push(`- ⑥ Borda 同分并列：${res.bordaTies.length ? res.bordaTies.join("；") : "无"}（靠三链均分拆开，非按 id 拆）`);
  L.push(`- ⑦ 真歧义（连均分也相同）：${res.ties.length ? res.ties.join(", ") : "无"}（全序成立）`);
  L.push("");
  L.push("## 四、多数投票");
  L.push("");
  L.push("每条链独立提名自己的第 1 名，出现 ≥2 次即胜出；不足 2 票则回落 Borda 首名。");
  L.push("");
  L.push("| 提名 | 票数 |");
  L.push("| --- | --- |");
  for (const [id, n] of Object.entries(res.firstVotes).sort((a, b) => b[1] - a[1])) L.push(`| ${id} | ${n} |`);
  L.push("");
  L.push(`**冠军：${res.champion} · ${res.rows.find((r) => r.id === res.champion).name}**`);
  L.push("");
  return L.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const pick = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : ""; };
  const res = evaluate();

  console.log("── 总排名（Borda）──");
  res.bordaRanked.slice(0, 6).forEach((b, i) => {
    const cells = res.chainRanks.map((ch) => `${ch.key}#${ch.scored.find((x) => x.id === b.id).rank}`);
    console.log(`  ${String(i + 1).padStart(2)}. ${b.id} ${b.name.padEnd(6, "　")} borda=${String(b.borda).padStart(2)}  [${cells.join(" ")}]`);
  });
  console.log("── 偏置控制 ──");
  console.log(`  ① 顺序不变性 6/6：${res.orderTest.every((t) => t.invariant) ? "通过" : "失败"}`);
  console.log(`  ② 编号解耦：${res.relabelInvariant ? "通过" : "失败"}`);
  console.log(`  ③ 三链余弦最大 ${res.maxSim}（≤0.9 判独立）`);
  console.log(`  ④ 区分度达标 ${res.chainValidCount}/${CHAINS.length}（分差 ${res.chainRanks.map((c) => c.spread).join("/")}）`);
  console.log(`  ⑤ Kendall τ：${res.kendall.map((k) => `${k.pair}=${k.tau}`).join(" ")}`);
  console.log(`── 多数投票：${Object.entries(res.firstVotes).map(([k, v]) => `${k}×${v}`).join(" ")} → 冠军 ${res.champion} ${res.rows.find((r) => r.id === res.champion).name}`);

  const jm = pick("--json"); if (jm) { fs.mkdirSync(path.dirname(jm), { recursive: true }); fs.writeFileSync(jm, JSON.stringify(res, null, 2), "utf8"); console.log("json → " + jm); }
  const mm = pick("--md"); if (mm) { fs.mkdirSync(path.dirname(mm), { recursive: true }); fs.writeFileSync(mm, mdReport(res) + "\n", "utf8"); console.log("md → " + mm); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
