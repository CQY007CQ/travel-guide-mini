/**
 * tools/check/check-prompt-lab.mjs —— v1.20.11 提示词实验室防回潮门禁
 *
 * 串进 allcheck.sh 既有「审计整改 + AI 全场景守卫」那一步，**不新增顶层步数**（锁 61 步）。
 *
 * 守的契约：
 *   ① 候选池自洽：向量合法、id 唯一、无重复向量、无硬冲突
 *   ② 评分模型偏置控制全部通过：顺序不变性 / 编号解耦 / 三链独立 / 区分度达标
 *   ③ 聚合结果确定：连跑两次排名与冠军逐字相同（幂等）
 *   ④ 落盘不漂移：docs 下的候选池与评分报告与重新生成的结果逐字一致
 *   ⑤ 真跑产出可核验：lab/runs-v1211 下三份 output 的事实可核验率不低于 80%
 *
 * 一旦有人改了条款库/权重却没重新生成文档，④ 会判红——这是本门禁的主要价值。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`[ok]   ${name}`);
  else { console.log(`[FAIL] ${name}${detail ? " · " + detail : ""}`); fails++; }
};

const pool = await import(path.join(ROOT, "tools/prompt/pool.mjs"));
const rank = await import(path.join(ROOT, "tools/prompt/rank.mjs"));

// ── ① 候选池自洽 ──
{
  const issues = pool.auditPool();
  ok("候选池 16 条 × 8 维自洽（向量合法/id 唯一/无重复/无硬冲突）", issues.length === 0, issues.slice(0, 3).join(" | "));
  ok("候选数量在 10–20 之间（规模化生成区间）", pool.CANDIDATES.length >= 10 && pool.CANDIDATES.length <= 20, String(pool.CANDIDATES.length));
}

// ── ② 偏置控制 ──
const res = rank.evaluate();
{
  ok("偏置①评分项顺序不变（6 组种子乱序）", res.orderTest.every((t) => t.invariant),
    res.orderTest.filter((t) => !t.invariant).map((t) => t.seed).join(","));
  ok("偏置②分档编号解耦（B1..B16 重编号分数不变）", res.relabelInvariant);
  ok("偏置③三链权重独立（余弦 ≤ 0.9）", res.maxSim <= 0.9, String(res.maxSim));
  ok("偏置④各链区分度达标（首尾分差 ≥ 15）", res.chainValidCount === rank.CHAINS.length,
    res.chainRanks.map((c) => `${c.key}:${c.spread}`).join(" "));
  ok("Borda 全序无并列", res.ties.length === 0, res.ties.join(","));
}

// ── ③ 幂等 ──
{
  const res2 = rank.evaluate();
  const a = JSON.stringify({ b: res.bordaRanked, c: res.champion, f: res.firstVotes });
  const b = JSON.stringify({ b: res2.bordaRanked, c: res2.champion, f: res2.firstVotes });
  ok("评分聚合幂等（连跑两次排名/冠军/票数一致）", a === b);
}

// ── ④ 落盘不漂移 ──
{
  const NODE = process.execPath;
  const candMd = path.join(ROOT, "docs/prompt-engineering/candidates-v1211.md");
  const rankMd = path.join(ROOT, "docs/prompt-engineering/rank-v1211.md");
  const tmp = path.join(ROOT, ".prompt-check-tmp");
  fs.mkdirSync(tmp, { recursive: true });
  try {
    execFileSync(NODE, [path.join(ROOT, "tools/prompt/pool.mjs"), "--md", path.join(tmp, "c.md")], { stdio: "pipe" });
    execFileSync(NODE, [path.join(ROOT, "tools/prompt/rank.mjs"), "--md", path.join(tmp, "r.md")], { stdio: "pipe" });
    const same = (p1, p2) => fs.existsSync(p1) && fs.readFileSync(p1, "utf8") === fs.readFileSync(p2, "utf8");
    ok("候选池文档与生成结果一致（改条款库须重新生成）", same(candMd, path.join(tmp, "c.md")));
    ok("评分报告文档与生成结果一致（改权重须重新生成）", same(rankMd, path.join(tmp, "r.md")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── ⑤ 真跑产出可核验 ──
{
  const vout = await import(path.join(ROOT, "tools/prompt/verify-output.mjs"));
  const dir = path.join(ROOT, "tools/prompt/lab/runs-v1211");
  const outs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /-output\.md$/.test(n)) : [];
  ok("真跑产出齐全（C05/C13/C15 三份）", outs.length === 3, outs.join(","));
  let bad = [];
  for (const f of outs) {
    const r = vout.verify(path.join(dir, f));
    if (r.G1.rate < 0.8) bad.push(`${f}:${(r.G1.rate * 100).toFixed(1)}%`);
  }
  ok("真跑产出事实可核验率 ≥ 80%", bad.length === 0, bad.join(" "));
}

console.log(fails === 0 ? "\n提示词实验室门禁：全部通过" : `\n提示词实验室门禁：${fails} 项失败`);
if (fails) process.exitCode = 1;
