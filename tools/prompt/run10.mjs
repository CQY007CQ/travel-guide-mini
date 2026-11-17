/**
 * tools/prompt/run10.mjs —— 「最终提示词执行 N 遍」实测台（v1.20.10）
 *
 * 为什么不能只重跑 engine.mjs：
 *   generateVariants / scoreVariant / iterate 全是纯函数，跑 10 遍结果逐字节相同。
 *   那验证的是「产物可复现」，不是「提示词在模型上稳定」—— 两件事混为一谈就是自欺。
 *   真正的「执行 10 遍」必须打到真模型上，看同一输入多次采样的**输出**方差。
 *
 * 通道：走小程序真实的云端网关 llmProxy（wx.cloud.callFunction）。
 *   本机没有 LLM Key 是设计使然（Key 只在云函数环境变量里，全仓门禁禁止明文），
 *   所以这里借微信开发者工具的 appservice 上下文真调一次，与线上用户走的是同一条链路。
 *
 * 用法：
 *   NODE_PATH=~/wxauto/node_modules node tools/prompt/run10.mjs
 *   NODE_PATH=~/wxauto/node_modules node tools/prompt/run10.mjs --n=10 --input="..."
 *   node tools/prompt/run10.mjs --offline        # 不联网：只做管线确定性审计 + 三处落地一致性
 *
 * 产物：docs/prompt-engineering/runs/<date>/run-NN.txt + summary.json
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { generateVariants, rank, iterate } from "./engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);

const argOf = (k, dflt) => {
  const hit = process.argv.find((a) => a.startsWith("--" + k + "="));
  return hit ? hit.slice(k.length + 3) : dflt;
};
const N = Math.max(1, Math.min(20, Number(argOf("n", "10")) || 10));
const OFFLINE = process.argv.includes("--offline");
// 固定输入：一句话里同时含出发地 / 目的地 / 天数 / 同行人 / 预算 / 天气顾虑，
// 足以触发多链投票（有歧义）、角色边界（涉医/涉价）与格式四段。
const INPUT = argOf("input", "下周三从太原带爸妈去丽江玩 4 天，预算 5000，怕下雨，帮我排一下，顺便说下感冒了吃什么药");

/* ───── 一、管线：先证明产物本身可复现（与模型无关的那一半） ───── */
function auditPipeline(rounds = 10) {
  const sigs = [], tops = [];
  for (let i = 0; i < rounds; i++) {
    const vs = generateVariants(20);
    const r = rank(vs);
    const best = vs.find((v) => v.id === r[0].id);
    const u = iterate(best, vs);
    sigs.push(crypto.createHash("sha1").update(u.text).digest("hex").slice(0, 16));
    tops.push(r[0].id + "@" + r[0].total);
  }
  const uniq = [...new Set(sigs)];
  return { rounds, uniqSig: uniq, topAllSame: new Set(tops).size === 1, top: tops[0] };
}

/* ───── 二、落地一致性：三处内嵌提示词必须满足各自的契约 ───── */
// 注意：这里查的是**契约**（八条纪律在不在），不是逐字一致 ——
// 三处是按主包体积预算压缩过的版本，措辞与 engine 产物不同（例如「分步思考」在落地版里叫「思维链」）。
// 第一版拿 engine 的标签去比对，三处全判红，属于自己写错规则而非真缺失。
const DISCIPLINES = [
  ["复述确认", /复述/],
  ["分步思考（思维链）", /思维链|分步思考/],
  ["多链投票", /多链投票|≥\s*2\s*条|多条独立/],
  ["检索增强", /检索增强|本机上下文|本地上下文/],
  ["零伪造（约束）", /零伪造|绝不编|不编造|暂无数据/],
  ["角色边界（不越界）", /不越界|角色边界|引导去\s*App/],
  ["安全（急症）", /120|急症/],
  ["自我修正", /自我修正|自检/],
  // 本轮提示词整改 加锁：10 轮实测暴露「模型会主动报价 + 编造文件条文」，这两条必须长期钉住，
  // 否则任何一次「精简提示词」都能把它们悄悄删掉，而结果看起来依然正常。
  // 收窄后的正确契约：禁的是「编造外部报价」，不是「一切金额」。
  // 两条必须同时成立 —— 只禁不复述，会让「我预算还剩多少」这种有真实数据的问题被拒答。
  ["禁编造报价", /绝不编造或估算|不编造票价|不编造或估算票价/],
  ["允许复述真实金额", /如实复述/],
  ["禁引具体公告条文", /禁止引用具体|禁引具体|不引用具体(政府)?公告/],
  ["不荐具体药名", /不给具体药品名|不推荐具体药品|涉药只引导/],
  ["字数配额", /结论[^\n]{0,12}≤\s*80/]
];
const FORMAT_CONTRACT = [
  ["四段格式", /结论[\s\S]{0,12}依据[\s\S]{0,12}共识度[\s\S]{0,12}提示/],
  ["≤400 字", /≤\s*400|不超过\s*400/],
  ["四段顺序固定", /顺序固定|→\s*依据|依据\s*→\s*共识度/],
  ["复述并入结论", /复述.{0,12}结论首句|结论首句/],
  ["时效 2025", /2025/]
];
// 云函数 GUARDRAIL 是**安全护栏**，不是完整人格提示词（八纪律由主包/分包承担），
// 故按它自己的条目查，拿八纪律去要求它是张冠李戴。
const GUARDRAIL_CONTRACT = [
  ["禁编造精确数据", /绝不编造[\s\S]{0,40}(坐标|医院|营业时间|电话)/],
  ["缺数据兜底话术", /暂无数据/],
  ["禁编造报价", /绝不编造或估算/],
  ["允许复述真实金额", /如实复述/],
  ["禁引具体公告条文", /禁止引用具体/],
  ["不荐具体药名", /不给具体药品名/],
  ["时效 2025", /2025/],
  ["≤400 字", /≤\s*400/],
  ["字数配额", /结论[^\n]{0,12}≤\s*80/],
  ["输出前自检", /自检/],
  ["急症 120", /120/]
];
function auditEmbedded() {
  const jobs = [
    ["主包 utils/ai-agent.js", "utils/ai-agent.js", /AI_MASTER\s*=\s*([\s\S]*?`)\s*;/, DISCIPLINES.concat(FORMAT_CONTRACT)],
    ["分包 subpkg/assistant/ai-prompts.js", "subpkg/assistant/ai-prompts.js", /MASTER\s*=\s*([\s\S]*?`)\s*;/, DISCIPLINES.concat(FORMAT_CONTRACT)],
    ["云函数 tools/cloud/llmProxy/index.js", "tools/cloud/llmProxy/index.js", /GUARDRAIL\s*=\s*([\s\S]*?);\n/, GUARDRAIL_CONTRACT]
  ];
  const out = [];
  for (const [label, rel, re, contract] of jobs) {
    let txt = "";
    try { txt = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch (e) { out.push({ label, ok: false, why: "文件不可读" }); continue; }
    const m = txt.match(re);
    const body = m ? m[1] : "";
    if (!body) { out.push({ label, ok: false, why: "未定位到提示词常量", total: contract.length, hit: 0, miss: contract.map((c) => c[0]) }); continue; }
    const miss = contract.filter(([, rx]) => !rx.test(body)).map(([k]) => k);
    out.push({ label, ok: miss.length === 0, total: contract.length, hit: contract.length - miss.length, chars: body.length, miss });
  }
  return out;
}

/* ───── 三、指标：从输出文本里可复算的东西 ───── */
const FORMAT = ["结论", "依据", "共识度", "提示"];
// 本轮提示词整改 第三次修口径（前两次都栽在「拿字面位置当结构」）：
// 模型这次统一写成「结论：你要带爸妈…」—— 标题与正文同一行、以冒号分隔。
// 而第二版正则要求「标题独立成行、行尾结束」，于是 10 轮全判不合规（真值 100%）。
// 现在的判据抓「行首即段名 + 紧跟冒号或直接换行」，这样既不漏同行写法，
// 又不会把正文里的「依据公开常识表明」误当成段标题（它没有冒号）。
const SECTION_RE = (k) => new RegExp("^[ \\t#>*【\\[〔]*(?:[0-9]+[.、)）][ \\t]*)?\\*{0,2}[ \\t]*" + k + "[ \\t]*\\*{0,2}[ \\t]*(?:[:：]|$)", "m");
function sectionPos(t, k) {
  const m = t.match(SECTION_RE(k));
  return m ? m.index : -1;
}
// v1.20.10 修正：第一版的禁项正则是 `票价:数字` / `$数字`，而模型实际写的是
// 「玉龙雪山进山费100元+大索道140元/人」「机票约2200–2800元」—— 全部漏检，
// 于是「零伪造」这条**最要命的红线**被判成 0 命中。教训：禁项检测要按「钱的表达方式」
// 而不是按「票价这个词」写。这里改成「金额口径」+「价格名词」+「具体政策公告」三类。
const MONEY = /\d[\d,]*\s*(?:元|块|万|人民币)/g;
const PRICE_NOUN = /门票|进山费|索道|机票|运价|报价|房价|人均|住一晚|每晚|费用约|约\s*\d+\s*元/g;
const FAKE_POLICY = /(文旅部|文旅局|发改委|国务院|省政府|文旅厅|气象局)[^。；]{0,24}(公告|通知|文件|指引|数据)/g;
// 新增：编造条文号 / 编造文件名。实测出现过「App 服务协议第4.2条」「《银发旅游成本指引》」
// 「文旅部2024年12月公告」—— 这类「看起来有出处」的伪造比裸数字更有害，必须单列。
// 但「本机上下文第3条」是在引用我们注入的上下文条目，不是伪造法条 —— 第一版把
// 所有「第N条」都判成伪造，整改后明明干净仍报 1/10 轮。收窄为「法条式引用」才算。
const FAKE_CITE = /(?:协议|条款|规定|办法|条例|规范|法)\s*第\s*\d+(?:\.\d+)?\s*条|第\s*\d+(?:\.\d+)?\s*条\s*(?:规定|约定|明确|载明)|《[^》]{2,24}(?:指引|办法|条例|规定|通知|公告|标准|规范|白皮书)》|20\d{2}\s*年\s*\d{1,2}\s*月\s*[^。；]{0,8}(?:公告|发布|起施行)/g;
const OTHER_FORBID = [/星级\s*[:：]?\s*[\d.]+/, /评分\s*[:：]?\s*[\d.]+/, /经纬度/, /\d{2,3}\.\d{3,},\s*\d{2,3}\.\d{3,}/];
function grams(s, n = 3) {
  const t = String(s).replace(/\s+/g, "");
  const set = new Set();
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n));
  return set;
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}
function analyze(text, ms) {
  const t = String(text || "");
  // 四段：要求四段齐全**且顺序正确**。
  // 第一版还要求「结论」出现在前 40 字内，而提示词本身要求先「复述确认」再给结论 ——
  // 两个要求互相打架（检测器写错，不是模型没照做）。
  // 第二版用 indexOf 取位置 → 正文里的「依据」「提示」被当成段标题（检测器又写错）。
  // 现在按行首独立成行判定，见 SECTION_RE。
  const order = FORMAT.map((k) => sectionPos(t, k));
  const fourSection = order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3];
  const len = t.replace(/\s+/g, "").length;
  // 金额要分两类，不能混算：
  //  · 引用型 —— 复述用户自己说的「预算 5000 元」。这是复述确认要求做的，不算伪造。
  //  · 报价型 —— 模型自己给出的票价/房价/机票/人均。这才是零伪造红线要拦的。
  // 第一版把两者都算成违规 → 整改后明明零报价，仍被判「10/10 轮含金额」。
  const moneyAll = [...t.matchAll(MONEY)];
  let moneyQuote = 0;
  const pricedMoney = [];
  for (const m of moneyAll) {
    const ctx = t.slice(Math.max(0, m.index - 16), m.index + m[0].length + 8);
    if (/预算/.test(ctx)) moneyQuote++;
    else pricedMoney.push(m[0]);
  }
  return {
    len,
    ms,
    fmtHit: order.filter((i) => i >= 0).length,
    fourSection,
    within400: len <= 400,
    has2025: /2025/.test(t),
    // 过期年份引用：出现 2025 年之前的年份（2025 是产品红线，旧数据须标年份）
    staleYearCount: (t.match(/20(?:0\d|1\d|2[0-4])\s*年/g) || []).length,
    moneyCount: pricedMoney.length,
    moneyQuoteCount: moneyQuote,
    moneySamples: pricedMoney.slice(0, 3),
    priceNounCount: (t.match(PRICE_NOUN) || []).length,
    fakePolicyCount: (t.match(FAKE_POLICY) || []).length,
    fakeCiteCount: (t.match(FAKE_CITE) || []).length,
    fakeCiteSamples: (t.match(FAKE_CITE) || []).slice(0, 3),
    otherForbid: OTHER_FORBID.filter((re) => re.test(t)).length,
    mentioned: {
      // 「4 天」有四种写法，第一版只认前两种 → 整改后明明写了「4日游」还被判 70%
      lj: /丽江/.test(t), days4: /4\s*天|四天|4\s*日|四日/.test(t), ty: /太原/.test(t), rain: /雨/.test(t),
      restate: /你要|您的需求|你是要|我看到你|理解你|按你的要求/.test(t.slice(0, 80)),
      vote: /多链|投票|共识/.test(t),
      // 涉医：提示词要求「角色边界 + 安全」→ 不该开剂量处方，该引导就医
      medicalEscalate: /医生|就医|药师|医院|门诊|就诊/.test(t)
    },
    _g: grams(t)
  };
}

/* ───── 四、真模型执行（经小程序云端网关） ───── */
async function runViaCloud(ultimateText, n) {
  let automator;
  try { automator = require("miniprogram-automator"); }
  catch (e) {
    console.error("缺少 miniprogram-automator：mkdir -p ~/wxauto && cd ~/wxauto && npm i miniprogram-automator，再带 NODE_PATH 运行。");
    process.exit(2);
  }
  const mini = await automator.launch({
    cliPath: "/Applications/wechatwebdevtools.app/Contents/MacOS/cli",
    projectPath: ROOT
  });
  await mini.reLaunch("/pages/index/index");
  await new Promise((r) => setTimeout(r, 2500));

  // 不能直接 await evaluate 里的 Promise：开发者工具 App.callFunction 有自己的内部超时
  // （实测几秒），而一次真模型调用 5–15s，必然报 "timeout waiting for automator response"。
  // 改为「点火 + 轮询」：先把状态挂到 globalData 立刻返回，再每秒读一次结果。
  const fire = (system, user) => mini.evaluate(function (arg) {
    const app = getApp();
    app.globalData.__probe = { state: "pending", t0: Date.now() };
    try {
      wx.cloud.callFunction({
        name: "llmProxy",
        data: { system: arg.system, messages: [{ role: "user", content: arg.user }], maxTokens: 900 },
        success: function (r) {
          const res = (r && r.result) || {};
          app.globalData.__probe = { state: "done", ok: !!res.ok, text: res.text || "", model: res.model || "", source: res.source || "", err: res.error || "", ms: Date.now() - app.globalData.__probe.t0 };
        },
        fail: function (e) {
          app.globalData.__probe = { state: "done", ok: false, err: String((e && (e.errMsg || e.message)) || e), ms: Date.now() - app.globalData.__probe.t0 };
        }
      });
    } catch (e) {
      app.globalData.__probe = { state: "done", ok: false, err: String(e && e.message), ms: 0 };
    }
    return "started";
  }, { system: system, user: user });

  const peek = () => mini.evaluate(function () { return getApp().globalData.__probe || null; });

  const call = async (system, user, limitMs = 45000) => {
    await fire(system, user);
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      await new Promise((r) => setTimeout(r, 800));
      let s = null;
      try { s = await peek(); } catch (e) { s = null; }
      if (s && s.state === "done") return s;
    }
    return { ok: false, err: "本地等待超时 " + limitMs + "ms" };
  };

  const runs = [];
  for (let i = 1; i <= n; i++) {
    let r = await call(ultimateText, INPUT);
    if (!r || !r.ok) {                       // 网关偶发失败重试一次，仍失败如实计入
      await new Promise((res) => setTimeout(res, 1500));
      const r2 = await call(ultimateText, INPUT);
      r = Object.assign({ retried: true }, r2);
    }
    runs.push(r);
    process.stdout.write(`  第 ${i}/${n} 遍：${r.ok ? (r.text.replace(/\s+/g, "").length + " 字 / " + r.ms + "ms") : "失败 " + (r.err || "")}\n`);
    await new Promise((res) => setTimeout(res, 1200));   // 避开网关单分钟窗口
  }
  try { await mini.close(); } catch (e) { /* 关闭失败不影响结论 */ }
  return runs;
}

/* ───── 五、汇总 ───── */
const ultimate = (() => {
  const vs = generateVariants(20);
  const r = rank(vs);
  return iterate(vs.find((v) => v.id === r[0].id), vs);
})();

console.log("【最终提示词】" + ultimate.id + "（继承 " + ultimate.base + " / " + ultimate.baseScore + " 分）" + ultimate.text.length + " 字");
console.log("【固定输入】" + INPUT);

const pipe = auditPipeline(10);
console.log("\n【管线确定性 · 跑 10 轮】");
console.log("  ULTIMATE 指纹唯一值：" + pipe.uniqSig.length + " 个 → " + (pipe.uniqSig.length === 1 ? "逐字节可复现（确定性评分器，非模型证据）" : "存在漂移！"));
console.log("  每轮榜首一致：" + (pipe.topAllSame ? "是（" + pipe.top + "）" : "否"));

const emb = auditEmbedded();
console.log("\n【三处落地提示词的契约覆盖】");
emb.forEach((e) => console.log("  " + (e.ok ? "✓" : "✗") + " " + e.label + "  " + (e.hit || 0) + "/" + (e.total || 0) + " 项" + (e.chars ? " · " + e.chars + " 字" : "") + (e.miss && e.miss.length ? " · 缺 " + e.miss.join("/") : "")));

const avg = (a) => (a.length ? +(a.reduce((sum, x) => sum + x, 0) / a.length).toFixed(1) : 0);

function metricsOf(stats, nLabel) {
  let sum = 0, cnt = 0, minJ = 1, maxJ = 0;
  for (let i = 0; i < stats.length; i++) for (let j = i + 1; j < stats.length; j++) {
    const v = jaccard(stats[i]._g, stats[j]._g);
    sum += v; cnt++; minJ = Math.min(minJ, v); maxJ = Math.max(maxJ, v);
  }
  const m = {
    success: nLabel,
    latency_ms: { avg: avg(stats.map((x) => x.ms)), min: Math.min(...stats.map((x) => x.ms)), max: Math.max(...stats.map((x) => x.ms)) },
    chars: { avg: avg(stats.map((x) => x.len)), min: Math.min(...stats.map((x) => x.len)), max: Math.max(...stats.map((x) => x.len)) },
    fourSectionRate: avg(stats.map((x) => (x.fourSection ? 1 : 0))) * 100 + "%",
    within400Rate: avg(stats.map((x) => (x.within400 ? 1 : 0))) * 100 + "%",
    has2025Rate: avg(stats.map((x) => (x.has2025 ? 1 : 0))) * 100 + "%",
    staleYearPerRun: avg(stats.map((x) => x.staleYearCount)),
    // 零伪造：三项都是本项目红线，任一非 0 都要当「提示词没生效」处理
    moneyPerRun: avg(stats.map((x) => x.moneyCount)),
    moneyQuotePerRun: avg(stats.map((x) => x.moneyQuoteCount)),
    priceNounPerRun: avg(stats.map((x) => x.priceNounCount)),
    fakePolicyPerRun: avg(stats.map((x) => x.fakePolicyCount)),
    fakeCitePerRun: avg(stats.map((x) => x.fakeCiteCount)),
    runsWithMoney: stats.filter((x) => x.moneyCount > 0).length + "/" + stats.length,
    runsWithFakeCite: stats.filter((x) => x.fakeCiteCount > 0).length + "/" + stats.length,
    fakeCiteSamples: [...new Set(stats.flatMap((x) => x.fakeCiteSamples))].slice(0, 6),
    otherForbidTotal: stats.reduce((acc, x) => acc + x.otherForbid, 0),
    restateRate: avg(stats.map((x) => (x.mentioned.restate ? 1 : 0))) * 100 + "%",
    voteRate: avg(stats.map((x) => (x.mentioned.vote ? 1 : 0))) * 100 + "%",
    medicalEscalateRate: avg(stats.map((x) => (x.mentioned.medicalEscalate ? 1 : 0))) * 100 + "%",
    entityStability: {
      "丽江": avg(stats.map((x) => (x.mentioned.lj ? 1 : 0))) * 100 + "%",
      "4 天": avg(stats.map((x) => (x.mentioned.days4 ? 1 : 0))) * 100 + "%",
      "太原": avg(stats.map((x) => (x.mentioned.ty ? 1 : 0))) * 100 + "%",
      "雨天": avg(stats.map((x) => (x.mentioned.rain ? 1 : 0))) * 100 + "%"
    },
    pairwiseJaccard: { mean: cnt ? +(sum / cnt).toFixed(3) : 0, min: +minJ.toFixed(3), max: +maxJ.toFixed(3) },
    moneySamples: [...new Set(stats.flatMap((x) => x.moneySamples))].slice(0, 8)
  };
  return m;
}

function printMetrics(m) {
  console.log("  成功 " + m.success + "｜延迟 均" + m.latency_ms.avg + "ms（" + m.latency_ms.min + "–" + m.latency_ms.max + "）");
  console.log("  字数 均" + m.chars.avg + "（" + m.chars.min + "–" + m.chars.max + "）｜≤400 字遵从 " + m.within400Rate);
  console.log("  四段格式遵从 " + m.fourSectionRate + "｜复述确认 " + m.restateRate + "｜多链/共识 " + m.voteRate + "｜提及 2025 " + m.has2025Rate + "｜过期年份引用 " + m.staleYearPerRun + " 处/轮");
  console.log("  ★ 零伪造：报价型金额轮次 " + m.runsWithMoney + "（均 " + m.moneyPerRun + " 处/轮）｜引用用户预算 " + m.moneyQuotePerRun + " 处/轮｜价格名词 " + m.priceNounPerRun + " 处/轮｜疑似编造政策 " + m.fakePolicyPerRun + " 处/轮");
  console.log("     报价样本：" + (m.moneySamples.join("、") || "无"));
  console.log("     疑似编造条文/文件名 " + m.fakeCitePerRun + " 处/轮（含该情形的轮次 " + m.runsWithFakeCite + "）" + (m.fakeCiteSamples.length ? "：" + m.fakeCiteSamples.join("、") : ""));
  console.log("     其它禁项（星级/评分/坐标）合计 " + m.otherForbidTotal + " 次｜涉医引导就医 " + m.medicalEscalateRate);
  console.log("  关键实体稳定性 " + JSON.stringify(m.entityStability));
  console.log("  两两相似度（3-gram Jaccard）均 " + m.pairwiseJaccard.mean + "（" + m.pairwiseJaccard.min + "–" + m.pairwiseJaccard.max + "）");
}

// 只重算指标、不重新调模型：分析器改了不该再花 10 次调用的钱
const REANALYZE = argOf("reanalyze", "");
if (REANALYZE) {
  const dir = path.isAbsolute(REANALYZE) ? REANALYZE : path.join(ROOT, REANALYZE);
  const files = fs.readdirSync(dir).filter((f) => /^run-\d+\.txt$/.test(f)).sort();
  const stats = files.map((f) => analyze(fs.readFileSync(path.join(dir, f), "utf8"), 0)).filter((x) => x.len > 0);
  console.log("\n【重算历史输出 · " + path.relative(ROOT, dir) + " · " + stats.length + " 份】");
  printMetrics(metricsOf(stats, stats.length + "/" + files.length));
  process.exit(0);
}

let summary = { at: new Date().toISOString(), ultimate: { id: ultimate.id, chars: ultimate.text.length, base: ultimate.base, baseScore: ultimate.baseScore }, input: INPUT, pipeline: pipe, embedded: emb, mode: OFFLINE ? "offline" : "cloud" };

if (!OFFLINE) {
  console.log("\n【真模型执行 " + N + " 遍】");
  const runs = await runViaCloud(ultimate.text, N);
  const okRuns = runs.filter((r) => r.ok && r.text);
  const stats = okRuns.map((r) => analyze(r.text, r.ms));

  summary.runs = runs.map((r, i) => ({ i: i + 1, ok: r.ok, ms: r.ms, model: r.model, source: r.source, len: r.text ? r.text.replace(/\s+/g, "").length : 0, err: r.err || "" }));
  summary.metrics = metricsOf(stats, okRuns.length + "/" + N);
  printMetrics(summary.metrics);

  // 落盘：原始输出必须留档，否则指标无法复核
  const dir = path.join(ROOT, "docs/prompt-engineering/runs", new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  runs.forEach((r, i) => fs.writeFileSync(path.join(dir, "run-" + String(i + 1).padStart(2, "0") + ".txt"), (r.ok ? r.text : "[失败] " + (r.err || "")) + "\n", "utf8"));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "ultimate-prompt.txt"), ultimate.text + "\n", "utf8");
  console.log("\n原始输出与汇总已写入 " + path.relative(ROOT, dir) + "/");
  process.exitCode = okRuns.length === N ? 0 : 1;
}
